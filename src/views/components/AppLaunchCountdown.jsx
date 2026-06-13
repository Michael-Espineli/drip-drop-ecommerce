import React, { useEffect, useMemo, useState } from 'react';

export const toFeatureFlagDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatReleaseDate = (value) => {
  const date = toFeatureFlagDate(value);
  if (!date) return null;

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const getCountdownParts = (targetDate, now) => {
  if (!targetDate) return null;

  const remaining = Math.max(targetDate.getTime() - now, 0);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    { label: 'Days', value: days },
    { label: 'Hours', value: hours },
    { label: 'Minutes', value: minutes },
    { label: 'Seconds', value: seconds },
  ];
};

export default function AppLaunchCountdown({
  releaseDate,
  loading = false,
  title = 'Drip Drop is almost live',
  body = 'Company creation opens when the launch flag is turned on.',
  variant = 'light',
  className = '',
}) {
  const [now, setNow] = useState(() => Date.now());
  const targetDate = useMemo(() => toFeatureFlagDate(releaseDate), [releaseDate]);
  const countdownParts = useMemo(() => getCountdownParts(targetDate, now), [targetDate, now]);
  const formattedDate = useMemo(() => formatReleaseDate(releaseDate), [releaseDate]);
  const isDark = variant === 'dark';

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const wrapClass = isDark
    ? 'border border-white/20 bg-white/10 text-white shadow-xl backdrop-blur'
    : 'border border-cyan-100 bg-white text-slate-900 shadow-lg';
  const eyebrowClass = isDark ? 'text-cyan-100' : 'text-cyan-700';
  const bodyClass = isDark ? 'text-cyan-50' : 'text-slate-600';
  const tileClass = isDark
    ? 'border border-white/15 bg-slate-950/20 text-white'
    : 'border border-slate-200 bg-slate-50 text-slate-950';

  return (
    <div className={`rounded-md p-5 ${wrapClass} ${className}`}>
      <p className={`text-xs font-bold uppercase tracking-wide ${eyebrowClass}`}>
        {loading ? 'Checking launch status' : 'Company creation opens soon'}
      </p>
      <h2 className="mt-2 text-2xl font-extrabold leading-tight md:text-3xl">{title}</h2>
      <p className={`mt-2 text-sm leading-6 md:text-base ${bodyClass}`}>{body}</p>

      {formattedDate && (
        <p className={`mt-3 text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>
          Release date: {formattedDate}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {countdownParts ? (
          countdownParts.map((part) => (
            <div key={part.label} className={`rounded-md px-3 py-3 text-center ${tileClass}`}>
              <div className="text-2xl font-black tabular-nums md:text-3xl">
                {String(part.value).padStart(2, '0')}
              </div>
              <div className={`mt-1 text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-cyan-100' : 'text-slate-500'}`}>
                {part.label}
              </div>
            </div>
          ))
        ) : (
          <div className={`col-span-2 rounded-md px-4 py-3 text-sm font-semibold sm:col-span-4 ${tileClass}`}>
            {loading ? 'Loading the launch date...' : 'Launch date coming soon.'}
          </div>
        )}
      </div>
    </div>
  );
}
