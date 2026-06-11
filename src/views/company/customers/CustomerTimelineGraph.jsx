import React, { useEffect, useMemo, useState } from 'react';
import Chart from 'react-apexcharts';
import { format } from 'date-fns';

const DAY_MS = 24 * 60 * 60 * 1000;

const parseAmount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const average = (values) => {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const measurementKey = (item) => item.universalTemplateId || item.templateId || item.name || item.id || 'Unknown';

const measurementName = (item, fallback) => {
    const name = item.name || fallback;
    return item.UOM ? `${name} (${item.UOM})` : name;
};

const eventGroupStyles = {
    serviceStop: { dot: 'bg-blue-600', rail: '#2563eb', chip: 'bg-blue-50 text-blue-700 border-blue-100' },
    workOrder: { dot: 'bg-violet-500', rail: '#8b5cf6', chip: 'bg-violet-50 text-violet-700 border-violet-100' },
    equipmentMaintenance: { dot: 'bg-amber-500', rail: '#f59e0b', chip: 'bg-amber-50 text-amber-700 border-amber-100' },
    equipmentRepair: { dot: 'bg-red-500', rail: '#ef4444', chip: 'bg-red-50 text-red-700 border-red-100' },
    equipmentReading: { dot: 'bg-cyan-500', rail: '#06b6d4', chip: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
    waterFill: { dot: 'bg-indigo-500', rail: '#6366f1', chip: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    waterEmpty: { dot: 'bg-orange-500', rail: '#f97316', chip: 'bg-orange-50 text-orange-700 border-orange-100' },
    repairRequest: { dot: 'bg-red-500', rail: '#ef4444', chip: 'bg-red-50 text-red-700 border-red-100' },
    purchase: { dot: 'bg-lime-600', rail: '#65a30d', chip: 'bg-lime-50 text-lime-700 border-lime-100' },
    salesAgreement: { dot: 'bg-sky-500', rail: '#0ea5e9', chip: 'bg-sky-50 text-sky-700 border-sky-100' },
    salesSubscription: { dot: 'bg-teal-500', rail: '#14b8a6', chip: 'bg-teal-50 text-teal-700 border-teal-100' },
    salesInvoice: { dot: 'bg-fuchsia-500', rail: '#d946ef', chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100' },
    salesPayment: { dot: 'bg-emerald-500', rail: '#10b981', chip: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
};

const chartPalette = ['#0891b2', '#16a34a', '#7c3aed', '#dc2626', '#ea580c', '#2563eb'];

const getDateValue = (event) => event.date instanceof Date ? event.date.getTime() : new Date(event.date).getTime();

const toDateInputValue = (value) => Number.isFinite(value) ? format(new Date(value), 'yyyy-MM-dd') : '';

const parseDateInputValue = (value, endOfDay = false) => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const quickRangeOptions = [
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
    { label: '1Y', days: 365 },
];

const buildMeasurementSeries = (events, field, type, limit, { positiveOnly = false } = {}) => {
    const stats = new Map();

    events.forEach((event) => {
        const measurements = Array.isArray(event[field]) ? event[field] : [];
        measurements.forEach((item) => {
            const amount = parseAmount(item.amount);
            if (amount === null || (positiveOnly && amount <= 0)) return;
            const key = measurementKey(item);
            const current = stats.get(key) || {
                key,
                name: measurementName(item, field === 'readings' ? 'Reading' : 'Dosage'),
                count: 0,
            };
            current.count += 1;
            stats.set(key, current);
        });
    });

    const selected = Array.from(stats.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit);

    return selected.map((measurement) => ({
        name: measurement.name,
        type,
        data: events
            .map((event) => {
                const measurements = Array.isArray(event[field]) ? event[field] : [];
                const values = measurements
                    .filter((item) => measurementKey(item) === measurement.key)
                    .map((item) => parseAmount(item.amount))
                    .filter((amount) => amount !== null && (!positiveOnly || amount > 0));

                if (values.length === 0) return null;

                const y = field === 'dosages'
                    ? values.reduce((sum, value) => sum + value, 0)
                    : average(values);

                return {
                    x: getDateValue(event),
                    y: Number(y.toFixed(2)),
                };
            })
            .filter(Boolean),
    })).filter((series) => series.data.length > 0);
};

const getTrendDirection = (series) => {
    if (!series || series.data.length < 2) return 'No prior reading';
    const latest = series.data[series.data.length - 1].y;
    const previous = series.data[series.data.length - 2].y;
    const delta = latest - previous;
    if (Math.abs(delta) < 0.01) return 'Flat';
    return delta > 0 ? `Up ${delta.toFixed(2)}` : `Down ${Math.abs(delta).toFixed(2)}`;
};

const buildAnnotations = (events) => events.slice(-14).map((event) => {
    const style = eventGroupStyles[event.type] || eventGroupStyles.serviceStop;
    return {
        x: getDateValue(event),
        borderColor: style.rail,
        strokeDashArray: 3,
        label: {
            orientation: 'horizontal',
            borderColor: style.rail,
            text: event.label,
            style: {
                background: style.rail,
                color: '#ffffff',
                fontSize: '10px',
                fontWeight: 600,
            },
        },
    };
});

const getChartOptions = ({
    annotations,
    title,
    colors = chartPalette,
    rangeStart,
    rangeEnd,
}) => ({
    chart: {
        id: title,
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: 'inherit',
    },
    colors,
    dataLabels: { enabled: false },
    stroke: {
        curve: 'smooth',
        width: 3,
    },
    fill: {
        opacity: [1, 0.85, 0.75, 0.7],
    },
    grid: {
        borderColor: '#e2e8f0',
        strokeDashArray: 4,
        padding: { left: 8, right: 16 },
    },
    legend: {
        position: 'top',
        horizontalAlign: 'left',
        fontSize: '12px',
        markers: { radius: 8 },
    },
    markers: {
        size: 4,
        strokeWidth: 2,
    },
    tooltip: {
        x: { format: 'MMM dd, yyyy' },
        shared: true,
        intersect: false,
    },
    xaxis: {
        type: 'datetime',
        min: rangeStart,
        max: rangeEnd,
        labels: {
            style: { colors: '#64748b', fontSize: '11px' },
            datetimeUTC: false,
        },
        axisBorder: { color: '#cbd5e1' },
        axisTicks: { color: '#cbd5e1' },
    },
    yaxis: {
        decimalsInFloat: 2,
        labels: {
            style: { colors: '#64748b', fontSize: '11px' },
            formatter: (value) => Number.isFinite(value) ? value.toFixed(1) : value,
        },
    },
    annotations: { xaxis: annotations },
});

const percentageForDate = (date, start, end) => {
    if (!start || !end || start === end) return 50;
    return Math.min(100, Math.max(0, ((date - start) / (end - start)) * 100));
};

const EventRail = ({ events, rangeStart, rangeEnd }) => {
    if (events.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No maintenance, equipment, service, or body-of-water events in this timeline yet.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <div className="relative min-w-[720px] rounded-xl border border-slate-200 bg-slate-50 px-5 pb-5 pt-8">
                <div className="absolute left-5 right-5 top-12 h-1 rounded-full bg-slate-200" />
                <div className="relative h-28">
                    {events.map((event, index) => {
                        const style = eventGroupStyles[event.type] || eventGroupStyles.serviceStop;
                        const left = percentageForDate(getDateValue(event), rangeStart, rangeEnd);
                        const top = 6 + (index % 4) * 24;

                        return (
                            <div
                                key={event.id}
                                className="absolute -translate-x-1/2"
                                style={{ left: `${left}%`, top }}
                            >
                                <div className={`mx-auto h-4 w-4 rounded-full border-2 border-white shadow ${style.dot}`} />
                                <div className="mt-2 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center shadow-sm">
                                    <p className="truncate text-[11px] font-semibold text-slate-800">{event.label}</p>
                                    <p className="text-[10px] text-slate-500">{format(event.date, 'MMM d')}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-500">
                    <span>{format(new Date(rangeStart), 'MMM d, yyyy')}</span>
                    <span>{format(new Date(rangeEnd), 'MMM d, yyyy')}</span>
                </div>
            </div>
        </div>
    );
};

const CustomerTimelineGraph = ({ timeline }) => {
    const fullRange = useMemo(() => {
        const ranges = timeline.map(getDateValue).filter(Number.isFinite);
        const fallback = Date.now();
        return {
            start: ranges.length ? Math.min(...ranges) : fallback,
            end: ranges.length ? Math.max(...ranges) : fallback,
        };
    }, [timeline]);

    const [rangeInputs, setRangeInputs] = useState({
        start: toDateInputValue(fullRange.start),
        end: toDateInputValue(fullRange.end),
    });

    useEffect(() => {
        setRangeInputs({
            start: toDateInputValue(fullRange.start),
            end: toDateInputValue(fullRange.end),
        });
    }, [fullRange.start, fullRange.end]);

    const selectedRangeStart = parseDateInputValue(rangeInputs.start) ?? fullRange.start;
    const selectedRangeEnd = parseDateInputValue(rangeInputs.end, true) ?? fullRange.end;
    const hasInvalidRange = selectedRangeStart > selectedRangeEnd;

    const {
        chemistryEvents,
        markerEvents,
        readingSeries,
        dosageSeries,
        annotations,
        rangeStart,
        rangeEnd,
    } = useMemo(() => {
        const chronological = [...timeline].sort((a, b) => getDateValue(a) - getDateValue(b));
        const rangedTimeline = hasInvalidRange
            ? []
            : chronological.filter((event) => {
                const value = getDateValue(event);
                return Number.isFinite(value) && value >= selectedRangeStart && value <= selectedRangeEnd;
            });
        const chemistry = rangedTimeline.filter((event) => event.type === 'chemistry');
        const markers = rangedTimeline.filter((event) => event.type !== 'chemistry');

        return {
            chemistryEvents: chemistry,
            markerEvents: markers,
            readingSeries: buildMeasurementSeries(chemistry, 'readings', 'line', 4, { positiveOnly: true }),
            dosageSeries: buildMeasurementSeries(chemistry, 'dosages', 'line', 5),
            annotations: buildAnnotations(markers),
            rangeStart: selectedRangeStart,
            rangeEnd: selectedRangeEnd,
        };
    }, [hasInvalidRange, selectedRangeEnd, selectedRangeStart, timeline]);

    const handleRangeInputChange = (field) => (event) => {
        setRangeInputs((current) => ({
            ...current,
            [field]: event.target.value,
        }));
    };

    const applyQuickRange = (days) => {
        const nextEnd = fullRange.end;
        const nextStart = Math.max(fullRange.start, nextEnd - (days * DAY_MS));
        setRangeInputs({
            start: toDateInputValue(nextStart),
            end: toDateInputValue(nextEnd),
        });
    };

    const resetRange = () => {
        setRangeInputs({
            start: toDateInputValue(fullRange.start),
            end: toDateInputValue(fullRange.end),
        });
    };

    const maintenanceCount = markerEvents.filter((event) => event.type === 'equipmentMaintenance').length;
    const equipmentCount = markerEvents.filter((event) => event.type === 'equipmentRepair').length;
    const equipmentReadingCount = markerEvents.filter((event) => event.type === 'equipmentReading').length;
    const waterCount = markerEvents.filter((event) => event.type === 'waterFill' || event.type === 'waterEmpty').length;
    const serviceCount = markerEvents.filter((event) => event.type === 'serviceStop' || event.type === 'workOrder').length;
    const billingCount = markerEvents.filter((event) => ['salesAgreement', 'salesSubscription', 'salesInvoice', 'salesPayment', 'purchase'].includes(event.type)).length;

    const summaryCards = [
        { label: 'Reading points', value: readingSeries.reduce((total, item) => total + item.data.length, 0) },
        { label: 'Dosage points', value: dosageSeries.reduce((total, item) => total + item.data.length, 0) },
        { label: 'Maintenance', value: maintenanceCount },
        { label: 'Equipment history', value: equipmentCount },
        { label: 'Equipment readings', value: equipmentReadingCount },
        { label: 'Body of water', value: waterCount },
        { label: 'Service history', value: serviceCount },
        { label: 'Billing', value: billingCount },
    ];

    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h4 className="text-sm font-bold text-slate-900">Timeline Date Range</h4>
                        <p className="text-xs text-slate-500">
                            Filters the event overlay, reading trends, and dosage activity.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end">
                        <label className="text-xs font-semibold text-slate-600">
                            From
                            <input
                                type="date"
                                value={rangeInputs.start}
                                min={toDateInputValue(fullRange.start)}
                                max={rangeInputs.end || toDateInputValue(fullRange.end)}
                                onChange={handleRangeInputChange('start')}
                                className="mt-1 block h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                            />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">
                            To
                            <input
                                type="date"
                                value={rangeInputs.end}
                                min={rangeInputs.start || toDateInputValue(fullRange.start)}
                                max={toDateInputValue(fullRange.end)}
                                onChange={handleRangeInputChange('end')}
                                className="mt-1 block h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                            />
                        </label>
                        <div className="flex h-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                            {quickRangeOptions.map((option) => (
                                <button
                                    key={option.label}
                                    type="button"
                                    onClick={() => applyQuickRange(option.days)}
                                    className="border-r border-slate-200 px-3 text-xs font-bold text-slate-600 transition last:border-r-0 hover:bg-white hover:text-slate-900"
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={resetRange}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
                        >
                            All
                        </button>
                    </div>
                </div>
                {hasInvalidRange && (
                    <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        Start date must be before the end date.
                    </p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
                {summaryCards.map((card) => (
                    <div key={card.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-2xl font-bold text-slate-900">{card.value}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{card.label}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h4 className="text-sm font-bold text-slate-900">System Event Overlay</h4>
                        <p className="text-xs text-slate-500">
                            Maintenance, equipment, service, and body-of-water events aligned to the same dates as chemistry.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(eventGroupStyles).map(([type, style]) => (
                            <span key={type} className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${style.chip}`}>
                                {type.replace(/([A-Z])/g, ' $1').trim()}
                            </span>
                        ))}
                    </div>
                </div>
                <EventRail events={markerEvents} rangeStart={rangeStart} rangeEnd={rangeEnd} />
            </div>

            <div className="grid grid-cols-1 gap-5">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                            <h4 className="text-sm font-bold text-slate-900">Reading Trends</h4>
                            <p className="text-xs text-slate-500">Most common readings plotted over time.</p>
                        </div>
                        {readingSeries[0] && (
                            <span className="rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                                {getTrendDirection(readingSeries[0])}
                            </span>
                        )}
                    </div>
                    {readingSeries.length > 0 ? (
                        <Chart
                            options={getChartOptions({
                                annotations,
                                title: 'customer-reading-trends',
                                rangeStart,
                                rangeEnd,
                            })}
                            series={readingSeries}
                            type="line"
                            height={320}
                        />
                    ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                            No numeric readings found yet.
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="mb-3">
                        <h4 className="text-sm font-bold text-slate-900">Dosage Activity</h4>
                        <p className="text-xs text-slate-500">Most common dosages plotted as totals by stop date.</p>
                    </div>
                    {dosageSeries.length > 0 ? (
                        <Chart
                            options={getChartOptions({
                                annotations,
                                title: 'customer-dosage-activity',
                                colors: ['#7c3aed', '#ea580c', '#0891b2', '#16a34a', '#dc2626'],
                                rangeStart,
                                rangeEnd,
                            })}
                            series={dosageSeries}
                            type="line"
                            height={320}
                        />
                    ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                            No numeric dosages found yet.
                        </div>
                    )}
                </div>
            </div>

            {chemistryEvents.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Add readings or dosages from service stops to populate the trend charts.
                </div>
            )}
        </div>
    );
};

export default CustomerTimelineGraph;
