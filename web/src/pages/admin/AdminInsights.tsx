import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { BarList, StatTile, pct } from '../../components/Charts';
import ErrorState from '../../components/ErrorState';
import { coCurricularExportUrl, fetchInsights } from '../../services/adminService';
import type { InsightGroup, Insights } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { downloadFile } from '../../utils/eventActions';

/**
 * Admin insights (blueprint §6 "Reports & analytics", V4): participation by
 * department and year, demand by category, attendance and no-shows,
 * organizer performance, with CSV export and the co-curricular records export (V5).
 */

const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

const csvCell = (v: unknown) => {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};
const toCsv = (rows: Record<string, unknown>[]) => {
  const header = Object.keys(rows[0] ?? {});
  return [header.map(csvCell).join(','), ...rows.map(r => header.map(h => csvCell(r[h])).join(','))].join('\r\n') + '\r\n';
};

const GroupTable = ({ title, rows, name }: { title: string; rows: InsightGroup[]; name: string }) => (
  <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <button type="button" className="btn btn-secondary text-sm" disabled={rows.length === 0} onClick={() => downloadFile(`${name}.csv`, toCsv(rows as unknown as Record<string, unknown>[]), 'text/csv;charset=utf-8')}>
        <Download className="w-4 h-4 mr-1" />
        CSV
      </button>
    </div>
    {rows.length === 0 ? (
      <p className="text-sm text-gray-600">No events in this period.</p>
    ) : (
      <>
        <BarList
          caption={`${title}: seats filled`}
          max={100}
          format={v => `${v}%`}
          data={rows.map(r => ({ label: r.name, value: r.fillRate ?? 0, suffix: 'filled', detail: `${r.registrations} registered of ${r.capacity} seats · ${r.waitlisted} waitlisted · ${r.events} events` }))}
        />
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="text-left text-gray-600">
              <tr>
                {['Name', 'Events', 'Registered', 'Waitlisted', 'Attended', 'Attendance', 'No-shows', 'Rating'].map(h => (
                  <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.name}>
                  <th scope="row" className="py-2 pr-4 font-medium text-gray-900 text-left">{r.name}</th>
                  <td className="py-2 pr-4 tabular-nums">{r.events}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.registrations}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.waitlisted}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.attended}</td>
                  <td className="py-2 pr-4 tabular-nums">{pct(r.attendanceRate)}</td>
                  <td className="py-2 pr-4 tabular-nums">{pct(r.noShowRate)}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.averageRating ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )}
  </section>
);

const AdminInsights = () => {
  const [from, setFrom] = useState(monthsAgo(6));
  const [to, setTo] = useState(monthsAgo(-6));
  // The range that was last applied; editing the date inputs doesn't reload until Apply.
  const [range, setRange] = useState({ from, to });
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchInsights(`${range.from}T00:00:00Z`, `${range.to}T23:59:59Z`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load insights.');
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setRange({ from, to });
  };

  return (
    <div className="space-y-8 max-w-5xl">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Insights</h1>
        <p className="text-gray-600">Participation and demand across the university, for events starting in the chosen period.</p>
      </div>

      <form onSubmit={apply} className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div>
          <label htmlFor="from" className="label">From</label>
          <input id="from" type="date" className="input-field" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="to" className="label">To</label>
          <input id="to" type="date" className="input-field" value={to} min={from} onChange={e => setTo(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary">Apply</button>
        <a href={coCurricularExportUrl(`${from}T00:00:00Z`, `${to}T23:59:59Z`)} className="btn btn-secondary sm:ml-auto">
          <Download className="w-4 h-4 mr-2" />
          Co-curricular records (CSV)
        </a>
      </form>
      <p className="text-xs text-gray-500 -mt-6">The co-curricular export lists every attended event per student, with hours and certificate IDs, for the university's records system.</p>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile label="events" value={data.totals.events} />
            <StatTile label="registrations" value={data.totals.registrations} />
            <StatTile label="students taking part" value={data.totals.uniqueStudents} />
            <StatTile label="attended" value={data.totals.attended} />
            <StatTile label="no-show rate" value={pct(data.totals.noShowRate)} />
            <StatTile label="average rating" value={data.totals.averageRating ?? '—'} />
          </div>

          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-900">Participation by department and year</h2>
              <button type="button" className="btn btn-secondary text-sm" disabled={data.byCohort.length === 0} onClick={() => downloadFile('participation-by-cohort.csv', toCsv(data.byCohort), 'text/csv;charset=utf-8')}>
                <Download className="w-4 h-4 mr-1" />
                CSV
              </button>
            </div>
            {data.byCohort.length === 0 ? (
              <p className="text-sm text-gray-600">No registrations in this period.</p>
            ) : (
              <BarList
                caption="Registrations by department and year"
                data={data.byCohort.map(c => ({
                  label: `${c.department}${c.year ? ` · year ${c.year}` : ''}`,
                  value: c.registrations,
                  suffix: `(${c.students} students)`,
                  detail: `${c.attended} attended · attendance ${pct(c.attendanceRate)}`,
                }))}
              />
            )}
          </section>

          <GroupTable title="Demand by category" rows={data.byCategory} name="demand-by-category" />
          <GroupTable title="Organizer performance" rows={data.byOrganization} name="organizer-performance" />
        </>
      )}
    </div>
  );
};

export default AdminInsights;
