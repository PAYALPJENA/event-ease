import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Award, Plus, Trash2, Trophy } from 'lucide-react';
import {
  fetchAdminEvent,
  fetchEventCertificates,
  fetchParticipants,
  fetchResults,
  issueCertificates,
  publishResults,
  revokeCertificate,
  saveRecap,
  saveResults,
} from '../../services/adminService';
import type { AdminEvent, IssuedCertificate, Participant } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { formatDateTime, formatShortDate } from '../../utils/format';

/**
 * After the event (blueprint §5 "Results & certificates", §7.1): enter and
 * publish results, issue and revoke certificates, and post the recap.
 */

interface ResultRow {
  key: string;
  position: number;
  title: string;
  /** "r:<registrationId>" or "t:<teamId>" */
  who: string;
}

const Panel = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
    <h2 className="flex items-center text-lg font-bold text-gray-900">
      {icon}
      {title}
    </h2>
    {children}
  </section>
);

const AdminWrapUp = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [attendees, setAttendees] = useState<Participant[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [published, setPublished] = useState(false);
  const [certs, setCerts] = useState<IssuedCertificate[]>([]);
  const [recap, setRecap] = useState('');
  const [gallery, setGallery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, participants, results, certificates] = await Promise.all([fetchAdminEvent(id), fetchParticipants(id), fetchResults(id), fetchEventCertificates(id)]);
      setEvent(e.event);
      setAttendees(participants.filter(p => p.status === 'attended' || p.status === 'checked_in'));
      setTeams(results.teams);
      setPublished(results.published);
      setRows(results.results.map(r => ({ key: r.id, position: r.position, title: r.title, who: r.teamId ? `t:${r.teamId}` : `r:${r.registrationId}` })));
      setCerts(certificates);
      setRecap(e.event.recap ?? '');
      setGallery(e.event.gallery.join('\n'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load this event.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p role="alert" className="py-12 text-center text-red-600">{error}</p>;
  if (!event) return <p role="status" className="py-12 text-center text-gray-500">Loading…</p>;
  if (event.phase !== 'completed') {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">After the event</h1>
        <p className="text-gray-600">Results, certificates and the recap open once {event.title} has ended.</p>
        <Link to="/admin" className="btn btn-primary">Back to Organizer</Link>
      </div>
    );
  }

  const isTeam = event.participation === 'team';
  const submitResults = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await saveResults(
        id,
        rows.map(r => ({ position: r.position, title: r.title.trim(), ...(r.who.startsWith('t:') ? { teamId: r.who.slice(2) } : { registrationId: r.who.slice(2) }) }))
      );
      return 'Results saved.';
    });
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-1">After the event: {event.title}</h1>
        <p className="text-gray-600">{formatShortDate(event.startsAt)} · {attendees.length} attended</p>
      </div>
      <p role="status" className="text-sm text-gray-800 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 [&:empty]:hidden">{message}</p>

      <Panel title="Results" icon={<Trophy className="w-5 h-5 mr-2 text-amber-500" />}>
        <p className="text-sm text-gray-600">
          {published ? 'Published — shown on the event page. Editing and saving updates them.' : 'Enter winners in order, save, then publish. Everyone who attended is notified.'}
        </p>
        <form onSubmit={submitResults} className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[4rem_1fr] sm:grid-cols-[4rem_1fr_1.4fr_auto] gap-2 items-end">
              <div>
                <label className="label" htmlFor={`pos-${r.key}`}>Place</label>
                <input id={`pos-${r.key}`} type="number" min={1} max={100} className="input-field" required value={r.position} onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, position: Number(e.target.value) } : x)))} />
              </div>
              <div>
                <label className="label" htmlFor={`title-${r.key}`}>Title</label>
                <input id={`title-${r.key}`} className="input-field" required minLength={2} maxLength={80} placeholder="Winner" value={r.title} onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, title: e.target.value } : x)))} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="label" htmlFor={`who-${r.key}`}>{isTeam ? 'Team' : 'Participant'}</label>
                <select id={`who-${r.key}`} className="input-field" required value={r.who} onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, who: e.target.value } : x)))}>
                  <option value="">Choose…</option>
                  {isTeam
                    ? teams.map(t => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)
                    : attendees.map(p => <option key={p.id} value={`r:${p.id}`}>{p.name} · {p.universityId}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-secondary text-red-600" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>
                <Trash2 className="w-4 h-4" />
                <span className="sr-only">Remove place {i + 1}</span>
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setRows(rs => [...rs, { key: `new-${Date.now()}`, position: rs.length + 1, title: rs.length === 0 ? 'Winner' : rs.length === 1 ? 'Runner-up' : '', who: '' }])}>
              <Plus className="w-4 h-4 mr-2" />
              Add a place
            </button>
            <button type="submit" disabled={busy} className="btn btn-secondary">Save results</button>
            <button
              type="button"
              disabled={busy || rows.length === 0}
              className="btn btn-primary"
              onClick={() =>
                run(async () => {
                  const r = await publishResults(id);
                  return `Results published. ${r.notified} attendees notified${r.certificatesIssued ? `, ${r.certificatesIssued} winner certificates issued` : ''}.`;
                })
              }
            >
              {published ? 'Publish again' : 'Publish results'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Certificates" icon={<Award className="w-5 h-5 mr-2 text-indigo-600" />}>
        {event.certificateRule === 'none' ? (
          <p className="text-sm text-gray-600">This event doesn't issue certificates.</p>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Rule: {event.certificateRule === 'attendance' ? 'participation for everyone who attended' : event.certificateRule === 'winners' ? 'winners only (issued when results are published)' : 'participation for attendees, plus winners'}.
              Issuing again only adds certificates that are missing, e.g. after late check-ins sync.
            </p>
            <button type="button" disabled={busy} className="btn btn-primary" onClick={() => run(async () => `${(await issueCertificates(id)).issued} certificates issued.`)}>
              Issue certificates
            </button>
            {certs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <caption className="sr-only">Issued certificates</caption>
                  <thead className="text-left text-gray-600">
                    <tr>
                      <th scope="col" className="py-2 pr-4 font-medium">Student</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Certificate</th>
                      <th scope="col" className="py-2 pr-4 font-medium">ID</th>
                      <th scope="col" className="py-2 pr-4 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {certs.map(c => (
                      <tr key={c.id}>
                        <td className="py-2 pr-4">{c.holderName}<span className="block text-xs text-gray-600 font-mono">{c.universityId}</span></td>
                        <td className="py-2 pr-4">{c.kind === 'winner' ? c.title : 'Participation'}<span className="block text-xs text-gray-600">{formatDateTime(c.issuedAt)}</span></td>
                        <td className="py-2 pr-4 font-mono"><Link to={`/verify/${c.code}`} className="text-indigo-600 hover:underline">{c.code}</Link></td>
                        <td className="py-2 pr-4 text-right">
                          {c.revokedAt ? (
                            <span className="text-red-600">Revoked</span>
                          ) : revoking?.id === c.id ? (
                            <form
                              className="flex gap-2 justify-end"
                              onSubmit={e => {
                                e.preventDefault();
                                void run(async () => {
                                  await revokeCertificate(id, c.id, revoking.reason.trim());
                                  setRevoking(null);
                                  return `Certificate ${c.code} revoked.`;
                                });
                              }}
                            >
                              <label htmlFor={`rv-${c.id}`} className="sr-only">Reason</label>
                              <input id={`rv-${c.id}`} className="input-field text-xs" required minLength={3} placeholder="Reason" value={revoking.reason} onChange={e => setRevoking({ id: c.id, reason: e.target.value })} />
                              <button type="submit" className="btn bg-red-600 text-white text-xs">Revoke</button>
                            </form>
                          ) : (
                            <button type="button" className="text-sm text-red-600 hover:underline" onClick={() => setRevoking({ id: c.id, reason: '' })}>
                              Revoke<span className="sr-only"> {c.code}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel title="Recap" icon={null}>
        <form
          className="space-y-3"
          onSubmit={e => {
            e.preventDefault();
            void run(async () => {
              await saveRecap(id, recap.trim() || null, gallery.split('\n').map(s => s.trim()).filter(Boolean));
              return 'Recap saved. It appears on the event page.';
            });
          }}
        >
          <div>
            <label htmlFor="recap" className="label">What happened (shown on the event page)</label>
            <textarea id="recap" className="input-field" rows={4} maxLength={5000} value={recap} onChange={e => setRecap(e.target.value)} />
          </div>
          <div>
            <label htmlFor="gallery" className="label">Photo links (one URL per line, up to 24)</label>
            <textarea id="gallery" className="input-field font-mono text-xs" rows={3} value={gallery} onChange={e => setGallery(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary">Save recap</button>
        </form>
      </Panel>
    </div>
  );
};

export default AdminWrapUp;
