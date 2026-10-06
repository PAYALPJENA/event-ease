import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, CloudOff, RefreshCw, Search, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { checkIn, fetchCheckInStats, fetchDoorEvent, fetchRoster, syncCheckIns } from '../../services/adminService';
import type { CheckInOutcome, CheckInStats, RosterEntry, ScanInput } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { formatShortDate, formatTime, formatTimeRange } from '../../utils/format';

/**
 * Door check-in (blueprint §5 Check-in, §8.3 #6). Used by the event's
 * organizers and admins, and by check-in volunteers assigned to it (§2.2).
 *
 * - Camera scanner: the browser's BarcodeDetector where available, jsQR otherwise.
 * - Manual lookup by name, roll number or registration ID.
 * - Offline queue: scans made without a connection are kept on this device
 *   (localStorage) with the time of the scan, and synced when back online.
 *   While offline the pass can't be verified (the signature needs the
 *   server), so the screen shows the name from the cached participant list
 *   and says the scan is waiting to be confirmed.
 */

interface QueuedScan extends ScanInput {
  clientId: string;
  scannedAt: string;
  label: string;
}

type Tone = 'success' | 'warning' | 'error' | 'queued';
interface ResultCard {
  tone: Tone;
  title: string;
  detail?: string;
}

const DEVICE = 'Web scanner';
/** crypto.randomUUID needs HTTPS or localhost; the id only has to be unique on this device. */
const clientId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const REPEAT_SCAN_MS = 4000;

const storage = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the queue still works for this session.
    }
  },
};

/** Reads the (unverified) registration and event ids from a pass token. Offline use only. */
const peekToken = (token: string): { r: string; e: string } | null => {
  try {
    const [data] = token.split('.');
    const json = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { r?: unknown; e?: unknown };
    return typeof payload.r === 'string' && typeof payload.e === 'string' ? { r: payload.r, e: payload.e } : null;
  } catch {
    return null;
  }
};

const who = (o: CheckInOutcome) => (o.student ? `${o.student.name} · ${o.student.universityId}` : undefined);

const describe = (o: CheckInOutcome, event: { title: string }): ResultCard => {
  switch (o.result) {
    case 'checked_in':
      return { tone: 'success', title: `Checked in: ${o.student?.name ?? ''}`, detail: `${o.student?.universityId ?? ''} · ${o.registration?.code ?? ''}` };
    case 'already_checked_in':
      return { tone: 'warning', title: 'Already checked in', detail: `${who(o) ?? ''} · at ${o.checkedInAt ? formatTime(o.checkedInAt) : '—'}` };
    case 'cancelled':
      return { tone: 'error', title: 'Registration cancelled', detail: who(o) };
    case 'not_confirmed':
      return { tone: 'error', title: 'Registration not confirmed', detail: `${who(o) ?? ''} · still waiting for payment, documents or a waitlist seat` };
    case 'wrong_event':
      return { tone: 'error', title: 'Pass is for a different event', detail: `This door is for ${event.title}.` };
    case 'too_early':
      return { tone: 'error', title: 'Check-in not open yet', detail: 'Doors open 2 hours before the start.' };
    case 'ended':
      return { tone: 'error', title: 'Event has ended', detail: who(o) };
    default:
      return { tone: 'error', title: 'Pass not recognised', detail: 'The QR code is not a valid EventEase pass.' };
  }
};

const toneStyles: Record<Tone, { box: string; icon: typeof CheckCircle2 }> = {
  success: { box: 'bg-green-50 border-green-300 text-green-900', icon: CheckCircle2 },
  warning: { box: 'bg-amber-50 border-amber-300 text-amber-900', icon: AlertTriangle },
  error: { box: 'bg-red-50 border-red-300 text-red-900', icon: XCircle },
  queued: { box: 'bg-slate-50 border-slate-300 text-slate-900', icon: CloudOff },
};

// Minimal typing for the Shape Detection API (not yet in TypeScript's DOM lib).
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

const AdminCheckIn = () => {
  const { id = '' } = useParams<{ id: string }>();
  const queueKey = `ee-checkin-queue-${id}`;
  const rosterKey = `ee-checkin-roster-${id}`;

  const { isStaff } = useAuth();
  const [event, setEvent] = useState<{ id: string; title: string; startsAt: string; endsAt: string } | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>(() => storage.read(rosterKey, []));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>(() => storage.read(queueKey, []));
  const [online, setOnline] = useState(navigator.onLine);
  const [result, setResult] = useState<ResultCard | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastScan = useRef<{ value: string; at: number } | null>(null);
  const busy = useRef(false);
  const syncInFlight = useRef(false);

  const saveQueue = useCallback(
    (next: QueuedScan[]) => {
      setQueue(next);
      storage.write(queueKey, next);
    },
    [queueKey]
  );

  const loadRoster = useCallback(async () => {
    const list = await fetchRoster(id);
    setRoster(list);
    storage.write(rosterKey, list);
  }, [id, rosterKey]);

  useEffect(() => {
    fetchDoorEvent(id)
      .then(setEvent)
      .catch(err => setLoadError(err instanceof ApiError ? err.message : 'Unable to load the event.'));
    loadRoster().catch(() => undefined); // offline: keep the cached roster
  }, [id, loadRoster]);

  // Live counter while online.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const poll = () =>
      fetchCheckInStats(id)
        .then(s => !cancelled && setStats(s))
        .catch(() => undefined);
    void poll();
    const timer = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, online]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const feedback = (card: ResultCard) => {
    setResult(card);
    try {
      navigator.vibrate?.(card.tone === 'success' ? 80 : [60, 60, 60]);
    } catch {
      // Vibration isn't available everywhere.
    }
  };

  const enqueue = useCallback(
    (scan: ScanInput, label: string) => {
      const item: QueuedScan = { ...scan, clientId: clientId(), scannedAt: new Date().toISOString(), device: DEVICE, label };
      const next = [...storage.read<QueuedScan[]>(queueKey, []), item];
      saveQueue(next);
    },
    [queueKey, saveQueue]
  );

  const sync = useCallback(async () => {
    const pending = storage.read<QueuedScan[]>(queueKey, []);
    if (pending.length === 0 || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    try {
      const res = await syncCheckIns(
        id,
        pending.map(({ label: _label, ...scan }) => scan)
      );
      const done = new Set(res.results.map(r => r.clientId));
      saveQueue(storage.read<QueuedScan[]>(queueKey, []).filter(q => !done.has(q.clientId)));
      setStats(res.stats);
      const ok = res.results.filter(r => r.result === 'checked_in').length;
      const problems = res.results.length - ok;
      setResult({
        tone: problems ? 'warning' : 'success',
        title: `Synced ${res.results.length} offline scan${res.results.length === 1 ? '' : 's'}`,
        detail: `${ok} checked in${problems ? `, ${problems} need attention (already checked in, cancelled or invalid)` : ''}.`,
      });
      void loadRoster().catch(() => undefined);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'network_error')) {
        setResult({ tone: 'error', title: 'Sync failed', detail: err instanceof ApiError ? err.message : undefined });
      }
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [id, queueKey, saveQueue, loadRoster]);

  // Sync automatically when the page opens online, and when the connection comes back.
  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  const rosterById = useMemo(() => new Map(roster.map(p => [p.id, p])), [roster]);

  const submit = useCallback(
    async (scan: ScanInput) => {
      if (!event || busy.current) return;
      busy.current = true;
      try {
        // Offline: queue it, with what the cached list can tell us.
        const queueOffline = () => {
          const regId = scan.registrationId ?? (scan.token ? peekToken(scan.token)?.r : undefined);
          const eventId = scan.token ? peekToken(scan.token)?.e : event.id;
          if (scan.token && !eventId) return feedback({ tone: 'error', title: 'Pass not recognised', detail: 'The QR code is not a valid EventEase pass.' });
          if (eventId !== event.id) return feedback({ tone: 'error', title: 'Pass is for a different event', detail: `This door is for ${event.title}.` });
          const person = regId ? rosterById.get(regId) : undefined;
          const alreadyQueued = storage.read<QueuedScan[]>(queueKey, []).some(
            q => (q.token && q.token === scan.token) || (q.registrationId && q.registrationId === regId)
          );
          if (alreadyQueued) return feedback({ tone: 'warning', title: 'Already scanned on this device', detail: person ? `${person.name} · ${person.universityId}` : undefined });
          if (person?.status === 'cancelled') return feedback({ tone: 'error', title: 'Registration cancelled', detail: `${person.name} · ${person.universityId}` });
          enqueue(scan, person ? `${person.name} · ${person.universityId}` : 'Unknown pass');
          feedback({
            tone: 'queued',
            title: person ? `Saved offline: ${person.name}` : 'Saved offline',
            detail: person?.checkedInAt
              ? 'The list says they already checked in; this will be confirmed on sync.'
              : 'It will be verified when this device is back online.',
          });
        };

        if (!navigator.onLine) return queueOffline();
        try {
          const outcome = await checkIn(id, { ...scan, device: DEVICE });
          setStats(outcome.stats);
          feedback(describe(outcome, event));
          if (outcome.result === 'checked_in' && outcome.registration) {
            setRoster(list => list.map(p => (p.id === outcome.registration!.id ? { ...p, status: 'checked_in', checkedInAt: outcome.checkedInAt ?? null } : p)));
          }
        } catch (err) {
          if (err instanceof ApiError && err.code === 'network_error') {
            setOnline(false);
            queueOffline();
          } else {
            feedback({ tone: 'error', title: 'Could not check in', detail: err instanceof ApiError ? err.message : undefined });
          }
        }
      } finally {
        busy.current = false;
      }
    },
    [event, id, enqueue, queueKey, rosterById]
  );

  // ---------- Camera ----------

  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;

    const decode = async (): Promise<string | null> => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return null;
      if (detector) {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue ?? null;
      }
      const width = Math.min(640, video.videoWidth);
      const height = Math.round((video.videoHeight / video.videoWidth) * width);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      return jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    };

    let lastTick = 0;
    const loop = async (time: number) => {
      if (stopped) return;
      if (time - lastTick > 250) {
        lastTick = time;
        try {
          const value = await decode();
          const now = Date.now();
          if (value && !(lastScan.current && lastScan.current.value === value && now - lastScan.current.at < REPEAT_SCAN_MS)) {
            lastScan.current = { value, at: now };
            await submit({ token: value });
          }
        } catch {
          // A frame that fails to decode is normal; keep scanning.
        }
      }
      frame = requestAnimationFrame(t => void loop(t));
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(s => {
        if (stopped) {
          s.getTracks().forEach(t => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play();
        }
        frame = requestAnimationFrame(t => void loop(t));
      })
      .catch(() => {
        setCameraError('Camera unavailable. Allow camera access, or use manual lookup below.');
        setCameraOn(false);
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [cameraOn, submit]);

  // ---------- Manual lookup ----------

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return roster
      .filter(p => p.name.toLowerCase().includes(q) || p.universityId.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [roster, search]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (matches.length === 1 && matches[0].status !== 'cancelled') void submit({ registrationId: matches[0].id });
  };

  if (loadError) return <p role="alert" className="py-12 text-center text-red-600">{loadError}</p>;
  if (!event) return <p role="status" className="py-12 text-center text-gray-500">Loading…</p>;

  const Icon = result ? toneStyles[result.tone].icon : null;
  const cachedCheckedIn = roster.filter(p => p.checkedInAt).length;
  const cachedExpected = roster.filter(p => !['cancelled', 'waitlist_expired', 'waitlisted'].includes(p.status)).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <Link to={isStaff ? '/admin' : '/volunteering'} className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        {isStaff ? 'Back to Organizer' : 'Back to Volunteering'}
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-1">Check-in</h1>
          <p className="text-gray-600">
            {event.title} · {formatShortDate(event.startsAt)} · {formatTimeRange(event.startsAt, event.endsAt)}
          </p>
        </div>
        <div className="text-right" aria-live="polite">
          <p className="text-3xl font-extrabold text-gray-900">
            {stats ? stats.checkedIn : cachedCheckedIn}
            <span className="text-lg font-medium text-gray-500"> / {stats ? stats.expected : cachedExpected}</span>
          </p>
          <p className="text-sm text-gray-600">checked in</p>
        </div>
      </div>

      {!online && (
        <p className="flex items-center text-sm text-slate-800 bg-slate-100 border border-slate-200 rounded-lg px-4 py-3">
          <CloudOff className="w-4 h-4 mr-2 shrink-0" />
          Offline. Scans are saved on this device and synced when the connection returns.
        </p>
      )}

      {queue.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-900">
          <p className="flex-1">
            {queue.length} scan{queue.length === 1 ? '' : 's'} waiting to sync: {queue.slice(-3).map(q => q.label).join(', ')}
            {queue.length > 3 ? '…' : ''}
          </p>
          <button type="button" onClick={() => void sync()} disabled={!online || syncing} className="btn btn-secondary">
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}

      {/* Result of the last scan */}
      <div role="status" aria-live="assertive" aria-atomic="true">
        {result && Icon && (
          <div className={`flex items-start gap-3 rounded-2xl border-2 p-5 ${toneStyles[result.tone].box}`}>
            <Icon className="w-8 h-8 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xl font-bold">{result.title}</p>
              {result.detail && <p className="text-sm mt-1">{result.detail}</p>}
            </div>
          </div>
        )}
      </div>

      <section aria-labelledby="scanner-heading" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="scanner-heading" className="text-lg font-bold text-gray-900">Scan passes</h2>
          <button type="button" onClick={() => { setCameraError(null); setCameraOn(on => !on); }} className={cameraOn ? 'btn btn-secondary' : 'btn btn-primary'}>
            {cameraOn ? <CameraOff className="w-4 h-4 mr-2" /> : <Camera className="w-4 h-4 mr-2" />}
            {cameraOn ? 'Stop camera' : 'Start camera'}
          </button>
        </div>
        {cameraError && <p role="alert" className="text-sm text-red-600">{cameraError}</p>}
        <div className={cameraOn ? 'relative overflow-hidden rounded-xl bg-black aspect-[4/3]' : 'hidden'}>
          <video ref={videoRef} muted playsInline className="w-full h-full object-cover" aria-label="Camera preview" />
          <div className="pointer-events-none absolute inset-[18%] border-4 border-white/80 rounded-2xl" aria-hidden="true" />
        </div>
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
        {!cameraOn && <p className="text-sm text-gray-600">Point the camera at the QR code on a student's pass. Each pass can only be used once.</p>}
      </section>

      <section aria-labelledby="manual-heading" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <h2 id="manual-heading" className="text-lg font-bold text-gray-900">Manual lookup</h2>
        <form onSubmit={onSearch} className="relative">
          <label htmlFor="lookup" className="sr-only">Name, roll number or registration ID</label>
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id="lookup"
            className="input-field pl-9"
            placeholder="Name, roll number or registration ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
          />
        </form>
        {search.trim().length >= 2 && matches.length === 0 && <p className="text-sm text-gray-600">No registered student matches “{search.trim()}”.</p>}
        {matches.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {matches.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-600 font-mono">{p.universityId} · {p.code}</p>
                </div>
                {p.status === 'cancelled' ? (
                  <span className="text-sm text-red-600">Cancelled</span>
                ) : p.checkedInAt ? (
                  <span className="text-sm text-indigo-700">In at {formatTime(p.checkedInAt)}</span>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => void submit({ registrationId: p.id })}>
                    Check in
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500">
          The participant list is saved on this device for offline lookup ({roster.length} people).{' '}
          <button type="button" className="text-indigo-600 hover:underline" onClick={() => void loadRoster().catch(() => undefined)} disabled={!online}>
            Refresh list
          </button>
        </p>
      </section>
    </div>
  );
};

export default AdminCheckIn;
