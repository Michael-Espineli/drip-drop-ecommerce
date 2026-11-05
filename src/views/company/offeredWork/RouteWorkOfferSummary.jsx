import React from 'react';

const duration = value => {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return 'Not available';
  const minutes = Math.ceil(Number(value));
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ''}` : `${minutes} min`;
};
const distance = value => value == null || !Number.isFinite(Number(value)) || Number(value) < 0
  ? 'Not available' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value))} mi`;

export default function RouteWorkOfferSummary({ offer, summary = offer.routeSummary, compact = false }) {
  if (!offer.routeId) return null;
  const hasHistory = summary?.timeSampleCount > 0 || summary?.distanceSampleCount > 0;
  const serviceMinutes = summary ? summary.serviceMinutes : Number(offer.estimatedMinutes) > 0 ? offer.estimatedMinutes : null;
  const facts = <><span>Total time: {duration(summary?.totalMinutes)}</span><span>Total distance: {distance(summary?.totalDistanceMiles)}</span></>;
  if (compact) return <div className="mt-1 space-y-1 text-xs text-theme-subtle">{hasHistory && <p>Typical totals</p>}<div className="flex flex-col gap-1">{facts}</div>{!summary?.timeSampleCount && serviceMinutes != null && <p>Service estimate: {duration(serviceMinutes)}; travel time unavailable.</p>}</div>;
  return <section aria-label="Route time and distance" className="rounded-lg border border-slate-200 p-4">
    <h3 className="font-bold">Route time &amp; distance</h3>
    <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">{facts}</div>
    {hasHistory && <p className="mt-2 text-sm text-slate-600">Typical totals from recent completed runs with the same stops. Total time includes service and travel.</p>}
    {summary?.totalMinutes == null && serviceMinutes != null && <p className="mt-2 text-sm text-slate-600">Service estimate: {duration(serviceMinutes)}. Travel time is unavailable.</p>}
    {!hasHistory && <p className="mt-2 text-sm text-slate-600">No matching completed route totals are available yet.</p>}
  </section>;
}
