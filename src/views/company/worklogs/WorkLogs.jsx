import React, { useState, useEffect, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { format, startOfDay, endOfDay, differenceInMinutes } from 'date-fns';

const getDateValue = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatTime = (value) => {
    const date = getDateValue(value);
    return date ? format(date, 'p') : 'Open';
};

const formatDuration = (start, end) => {
    const startDate = getDateValue(start);
    const endDate = getDateValue(end);

    if (!startDate || !endDate) return 'In progress';

    const minutes = Math.max(0, differenceInMinutes(endDate, startDate));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`;
    if (hours) return `${hours}h`;
    return `${remainingMinutes}m`;
};

const getLogType = (log = {}) => log.type || log.status || log.mode || 'Work Log';

const getLogTone = (type) => {
    const normalized = (type || '').toLowerCase();
    if (normalized.includes('break') || normalized.includes('lunch')) return 'bg-amber-50 text-amber-800 border-amber-200';
    if (normalized.includes('clock') || normalized.includes('start')) return 'bg-blue-50 text-blue-800 border-blue-200';
    if (normalized.includes('end') || normalized.includes('finished')) return 'bg-slate-100 text-slate-700 border-slate-200';
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
};

const WorkLogCard = ({ log, route }) => {
    const type = getLogType(log);
    const start = log.startTime || log.clockInAt || log.startedAt || log.dateCreated || log.date;
    const end = log.endTime || log.clockOutAt || log.endedAt || log.completedAt;
    const isOpen = !getDateValue(end);

    return (
        <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getLogTone(type)}`}>
                            {type}
                        </span>
                        {isOpen ? (
                            <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                                Current
                            </span>
                        ) : null}
                    </div>

                    <h3 className="mt-3 text-base font-semibold text-gray-900">
                        {log.userName || route?.techName || 'Unknown technician'}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                        {route?.name || route?.routeName || route?.techName || log.activeRouteId || 'Route not found'}
                    </p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm lg:min-w-[360px]">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Start</p>
                        <p className="mt-1 font-semibold text-gray-900">{formatTime(start)}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">End</p>
                        <p className="mt-1 font-semibold text-gray-900">{formatTime(end)}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Duration</p>
                        <p className="mt-1 font-semibold text-gray-900">{formatDuration(start, end)}</p>
                    </div>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                <Link
                    to={`/company/workLogs/${log.id}`}
                    className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-gray-800"
                >
                    View Details
                </Link>
                <Link
                    to={`/company/workLogs/${log.id}#locations`}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                    See Locations
                </Link>
            </div>
        </article>
    );
};

const WorkLogs = () => {
    const { recentlySelectedCompany } = useContext(Context);

    const [workLogs, setWorkLogs] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setRoutes([]);
            setWorkLogs([]);
            setIsLoading(false);
            return;
        }

        const fetchRoutes = async () => {
            const start = startOfDay(selectedDate);
            const end = endOfDay(selectedDate);

            const routesRef = collection(db, 'companies', recentlySelectedCompany, 'activeRoutes');
            const routesQuery = query(
                routesRef,
                where('date', '>=', start),
                where('date', '<=', end)
            );

            try {
                const querySnapshot = await getDocs(routesQuery);
                const fetchedRoutes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                setRoutes(fetchedRoutes);
                setSelectedRouteId(currentRouteId => (
                    currentRouteId && fetchedRoutes.some(route => route.id === currentRouteId) ? currentRouteId : ''
                ));
            } catch (error) {
                console.error("Error fetching routes: ", error);
                toast.error("Failed to fetch routes for the selected date.");
            }
        };

        fetchRoutes();
    }, [recentlySelectedCompany, selectedDate]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setWorkLogs([]);
            setIsLoading(false);
            return;
        }

        if (routes.length === 0) {
            setWorkLogs([]);
            setIsLoading(false);
            return;
        }

        const fetchWorkLogs = async () => {
            setIsLoading(true);
            try {
                const routeIds = selectedRouteId ? [selectedRouteId] : routes.map(route => route.id);
                const snapshots = await Promise.all(routeIds.map(routeId => {
                    const logsRef = collection(db, 'companies', recentlySelectedCompany, 'activeRouteLogs');
                    const logsQuery = query(logsRef, where('activeRouteId', '==', routeId));

                    return getDocs(logsQuery);
                }));

                const logs = snapshots.flatMap((snapshot, routeIndex) => (
                    snapshot.docs.map(doc => ({
                        id: doc.id,
                        routeId: routeIds[routeIndex],
                        ...doc.data(),
                    }))
                ));

                logs.sort((left, right) => (
                    (getDateValue(left.startTime || left.clockInAt || left.startedAt || left.dateCreated)?.getTime() || 0) -
                    (getDateValue(right.startTime || right.clockInAt || right.startedAt || right.dateCreated)?.getTime() || 0)
                ));

                setWorkLogs(logs);
            } catch (error) {
                console.error("Error fetching work logs: ", error);
                toast.error("Failed to fetch work logs.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchWorkLogs();
    }, [recentlySelectedCompany, routes, selectedRouteId]);

    const routeLookup = useMemo(() => (
        routes.reduce((lookup, route) => {
            lookup[route.id] = route;
            return lookup;
        }, {})
    ), [routes]);

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6'>
            <div className="max-w-7xl mx-auto">
                <header className="mb-6 rounded-lg bg-white p-4 shadow">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">Work Logs</h1>
                            <p className="mt-1 text-gray-600">Review clocked work, break, and lunch segments by route.</p>
                        </div>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                            <label className="flex items-center gap-2 font-semibold text-gray-700" htmlFor="date-picker">
                                Date:
                                <input
                                    id="date-picker"
                                    type="date"
                                    value={format(selectedDate, 'yyyy-MM-dd')}
                                    onChange={(event) => setSelectedDate(new Date(event.target.value))}
                                    className="rounded-md border border-gray-300 bg-white p-2 shadow-sm focus:ring-2 focus:ring-blue-500"
                                />
                            </label>
                            <label className="flex items-center gap-2 font-semibold text-gray-700" htmlFor="route-picker">
                                Route:
                                <select
                                    id="route-picker"
                                    value={selectedRouteId}
                                    onChange={(event) => setSelectedRouteId(event.target.value)}
                                    className="w-full rounded-md border border-gray-300 bg-white p-2 shadow-sm focus:ring-2 focus:ring-blue-500 sm:w-56"
                                    disabled={routes.length === 0}
                                >
                                    <option value="">{routes.length > 0 ? 'All routes' : 'No routes for date'}</option>
                                    {routes.map(route => (
                                        <option key={route.id} value={route.id}>{route.name || route.routeName || route.techName || route.id}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>
                </header>

                <section>
                    <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">Clocked Segments</h2>
                            <p className="text-sm text-gray-500">Locations are available from each log detail view.</p>
                        </div>
                        <p className="text-sm font-semibold text-gray-600">{workLogs.length} log{workLogs.length === 1 ? '' : 's'}</p>
                    </div>

                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="rounded-lg bg-white py-10 text-center text-gray-500 shadow-sm">Loading...</div>
                        ) : workLogs.length > 0 ? (
                            workLogs.map(log => (
                                <WorkLogCard
                                    key={log.id}
                                    log={log}
                                    route={routeLookup[log.activeRouteId] || routeLookup[log.routeId]}
                                />
                            ))
                        ) : (
                            <div className="rounded-lg bg-white py-10 text-center shadow-md">
                                <h3 className="text-lg font-semibold text-gray-700">No Logs Found</h3>
                                <p className="mt-1 text-gray-500">No clocked work, break, or lunch segments were recorded for this date.</p>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default WorkLogs;
