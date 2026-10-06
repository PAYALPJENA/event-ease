import type { ReactNode } from 'react';

/**
 * Small, accessible chart pieces for analytics (V4).
 *
 * - One hue (indigo) encodes magnitude; a light gray track shows the scale.
 *   No series colours, so identity never rests on colour: every bar carries
 *   its label and value as text (text uses text colours, not the bar colour).
 * - Bars are thin (8 px) with rounded data-ends, anchored at zero.
 * - Hovering or focusing a row highlights it and shows its detail line.
 * - The markup is a description list, so screen readers read label → value.
 */

export interface BarDatum {
  label: string;
  value: number;
  /** Shown after the value, e.g. "(42%)". */
  suffix?: string;
  /** Extra line shown on hover/focus. */
  detail?: string;
}

export const BarList = ({ data, max, format = v => v.toLocaleString('en-IN'), caption }: { data: BarDatum[]; max?: number; format?: (v: number) => string; caption: string }) => {
  const top = max ?? Math.max(1, ...data.map(d => d.value));
  return (
    <figure className="space-y-1">
      <figcaption className="sr-only">{caption}</figcaption>
      <dl className="space-y-2">
        {data.map(d => (
          <div key={d.label} tabIndex={0} className="group rounded-md px-2 py-1 -mx-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-gray-700 truncate">{d.label}</dt>
              <dd className="font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                {format(d.value)}
                {d.suffix && <span className="font-normal text-gray-600"> {d.suffix}</span>}
              </dd>
            </div>
            <div className="mt-1 h-2 rounded-full bg-gray-100" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-indigo-500 group-hover:bg-indigo-700 group-focus:bg-indigo-700"
                style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, Math.min(100, (d.value / top) * 100))}%` }}
              />
            </div>
            {d.detail && <p className="hidden group-hover:block group-focus:block mt-1 text-xs text-gray-600">{d.detail}</p>}
          </div>
        ))}
      </dl>
    </figure>
  );
};

/** A headline number (a "stat tile"): when one value is the answer, don't draw a chart. */
export const StatTile = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
    <p className="text-2xl font-extrabold text-gray-900 tabular-nums">{value}</p>
    <p className="text-xs text-gray-600">{label}</p>
    {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
  </div>
);

export const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
