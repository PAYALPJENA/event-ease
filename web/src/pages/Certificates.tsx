import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Award, BadgeCheck, Copy, Download, ShieldAlert } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import { ApiError } from '../services/api';
import { fetchMyCertificates, verifyCertificate } from '../services/studentService';
import type { Verification } from '../services/studentService';
import type { Certificate } from '../types/event';
import { downloadFile } from '../utils/eventActions';
import { formatLongDate } from '../utils/format';

/**
 * Certificates (blueprint §4.13): the student's list, a printable certificate
 * (save as PDF from the print dialog), and the public verification page at
 * /verify/{code} that anyone with the link can open.
 */

const verifyUrl = (code: string) => `${window.location.origin}/verify/${code}`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A standalone printable certificate. Opening it and choosing "Save as PDF" gives the PDF. */
const certificateHtml = async (c: Certificate) => {
  const qr = await QRCode.toDataURL(verifyUrl(c.code), { margin: 1, width: 160 });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(c.title)}</title>
<style>
@page { size: A4 landscape; margin: 0 }
body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #1f2937; }
.page { box-sizing: border-box; width: 297mm; height: 210mm; padding: 18mm; }
.frame { border: 3px double #4338ca; height: 100%; box-sizing: border-box; padding: 16mm; text-align: center; position: relative; }
h1 { font-size: 34pt; margin: 0 0 6mm; color: #312e81; letter-spacing: 1px; }
.name { font-size: 28pt; margin: 8mm 0 4mm; border-bottom: 1px solid #9ca3af; display: inline-block; padding: 0 12mm 2mm; }
p { font-size: 13pt; margin: 2mm 0; }
.meta { position: absolute; bottom: 12mm; left: 16mm; right: 16mm; display: flex; justify-content: space-between; align-items: flex-end; font-family: Arial, sans-serif; font-size: 9pt; text-align: left; }
.qr { text-align: center; }
</style></head><body><div class="page"><div class="frame">
<p style="font-family:Arial,sans-serif;letter-spacing:3px;font-size:10pt;color:#6b7280">CENTURION UNIVERSITY OF TECHNOLOGY AND MANAGEMENT</p>
<h1>${c.kind === 'winner' ? 'Certificate of Achievement' : 'Certificate of Participation'}</h1>
<p>This certifies that</p>
<div class="name">${escapeHtml(c.holderName)}</div>
<p>${c.kind === 'winner' ? `was awarded <strong>${escapeHtml(c.title.split(' — ')[0])}</strong> at` : 'participated in'}</p>
<p style="font-size:18pt;margin-top:4mm"><strong>${escapeHtml(c.event.title)}</strong></p>
<p>organized by ${escapeHtml(c.issuer)} on ${escapeHtml(formatLongDate(c.event.startsAt))}</p>
<div class="meta"><div>Certificate ID: <strong>${c.code}</strong><br>Issued ${escapeHtml(formatLongDate(c.issuedAt))}<br>Verify at ${escapeHtml(verifyUrl(c.code))}</div>
<div class="qr"><img src="${qr}" width="110" height="110" alt=""><br>Scan to verify</div></div>
</div></div><script>window.onload = () => window.print();</script></body></html>`;
};

export const MyCertificates = () => {
  const [certs, setCerts] = useState<Certificate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () => {
    setError(null);
    fetchMyCertificates()
      .then(setCerts)
      .catch(err => setError(err instanceof ApiError ? err.message : 'Unable to load your certificates.'));
  };
  useEffect(load, []);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">My Certificates</h1>
        <p className="text-gray-600">Download a certificate, or share its verification link so anyone can check it's genuine.</p>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !certs ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : certs.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm">
          <Award className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">No certificates yet. Organizers issue them after events you attend.</p>
          <Link to="/explore" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">Browse events</Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {certs.map(c => (
            <li key={c.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col md:flex-row md:items-center gap-4">
              <Award className={`w-10 h-10 shrink-0 ${c.kind === 'winner' ? 'text-amber-500' : 'text-indigo-500'}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-gray-900">{c.title}</h2>
                <p className="text-sm text-gray-600">{c.issuer} · {formatLongDate(c.event.startsAt)} · <span className="font-mono">{c.code}</span></p>
                {c.revokedAt && <p className="text-sm text-red-600">This certificate has been revoked.</p>}
              </div>
              {!c.revokedAt && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      const html = await certificateHtml(c);
                      const win = window.open('', '_blank');
                      if (win) {
                        win.document.write(html);
                        win.document.close();
                      } else {
                        downloadFile(`${c.code}.html`, html, 'text/html;charset=utf-8');
                      }
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(verifyUrl(c.code));
                        setCopied(c.code);
                      } catch {
                        setCopied(null);
                      }
                    }}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {copied === c.code ? 'Link copied' : 'Copy share link'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Public verification page (no sign-in needed). */
export const VerifyCertificate = () => {
  const { code = '' } = useParams<{ code: string }>();
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    verifyCertificate(code)
      .then(setResult)
      .catch(() => setError('Unable to check this certificate right now. Please try again.'));
  }, [code]);

  if (error) return <p role="alert" className="py-24 text-center text-red-600">{error}</p>;
  if (!result) return <p role="status" className="py-24 text-center text-gray-500">Checking certificate…</p>;

  const c = result.certificate;
  return (
    <div className="max-w-xl mx-auto py-12">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-lg p-8 text-center space-y-4">
        {result.valid && c ? (
          <>
            <BadgeCheck className="w-16 h-16 text-green-600 mx-auto" aria-hidden="true" />
            <h1 className="text-2xl font-extrabold text-green-800">Genuine certificate</h1>
            <dl className="text-left text-sm space-y-2 bg-gray-50 rounded-xl p-4">
              <div className="flex justify-between gap-4"><dt className="text-gray-600">Awarded to</dt><dd className="font-semibold text-gray-900 text-right">{c.holderName}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-600">For</dt><dd className="text-gray-900 text-right">{c.title}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-600">Event date</dt><dd className="text-gray-900 text-right">{formatLongDate(c.eventDate)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-600">Issued by</dt><dd className="text-gray-900 text-right">{c.issuer}, Centurion University</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-600">Certificate ID</dt><dd className="font-mono text-gray-900">{c.code}</dd></div>
            </dl>
          </>
        ) : (
          <>
            <ShieldAlert className="w-16 h-16 text-red-600 mx-auto" aria-hidden="true" />
            <h1 className="text-2xl font-extrabold text-red-800">{result.revoked ? 'This certificate was revoked' : 'Certificate not found'}</h1>
            <p className="text-gray-700">
              {result.revoked
                ? `EventEase issued ${code.toUpperCase()}, but it is no longer valid${result.revokeReason ? `: ${result.revokeReason}` : '.'}`
                : `There is no EventEase certificate with the ID ${code.toUpperCase()}. Check the ID and try again.`}
            </p>
          </>
        )}
        <p className="text-xs text-gray-500">Verified by EventEase, Centurion University of Technology and Management.</p>
      </div>
    </div>
  );
};
