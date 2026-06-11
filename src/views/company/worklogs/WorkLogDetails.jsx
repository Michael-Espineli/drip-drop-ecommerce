import React, { useState, useEffect, useContext } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { differenceInMinutes, format } from 'date-fns';
import { WorkLogMap } from '../../components/WorkLogMap';

const getDateValue = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (value, fallback = 'N/A') => {
    const date = getDateValue(value);
    return date ? format(date, 'PP p') : fallback;
};

const formatTime = (value, fallback = 'Open') => {
    const date = getDateValue(value);
    return date ? format(date, 'p') : fallback;
};

const formatDuration = (start, end, hoursWorked) => {
    if (hoursWorked || hoursWorked === 0) return `${Number(hoursWorked || 0)} hours`;

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

const DetailItem = ({ label, value }) => (
    <div className="py-3 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-lg font-semibold text-gray-800">{value || 'N/A'}</p>
    </div>
);

const WorkLogDetails = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { workLogId, id } = useParams();
    const logId = workLogId || id;

    const [log, setLog] = useState(null);
    const [route, setRoute] = useState(null);
    const [locations, setLocations] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!logId || !recentlySelectedCompany) return;

        const fetchLog = async () => {
            setIsLoading(true);
            try {
                const workLogRef = doc(db, 'companies', recentlySelectedCompany, 'workLogs', logId);
                const activeRouteLogRef = doc(db, 'companies', recentlySelectedCompany, 'activeRouteLogs', logId);
                const [workLogSnap, activeRouteLogSnap] = await Promise.all([
                    getDoc(workLogRef),
                    getDoc(activeRouteLogRef),
                ]);

                const selectedSnap = workLogSnap.exists() ? workLogSnap : activeRouteLogSnap.exists() ? activeRouteLogSnap : null;

                if (!selectedSnap) {
                    toast.error("Work log not found.");
                    navigate('/company/workLogs');
                    return;
                }

                const fetchedLog = { id: selectedSnap.id, ...selectedSnap.data() };
                setLog(fetchedLog);

                const activeRouteId = fetchedLog.activeRouteId || fetchedLog.routeId;
                if (!activeRouteId) {
                    setRoute(null);
                    setLocations([]);
                    return;
                }

                const [routeSnap, locationsSnap] = await Promise.all([
                    getDoc(doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', activeRouteId)),
                    getDocs(query(
                        collection(db, 'companies', recentlySelectedCompany, 'activeRouteLocations'),
                        where('activeRouteId', '==', activeRouteId)
                    )),
                ]);

                setRoute(routeSnap.exists() ? { id: routeSnap.id, ...routeSnap.data() } : null);
                setLocations(locationsSnap.docs
                    .map(locationDoc => ({ id: locationDoc.id, ...locationDoc.data() }))
                    .sort((left, right) => (
                        (getDateValue(left.time)?.getTime() || 0) - (getDateValue(right.time)?.getTime() || 0)
                    )));
            } catch (error) {
                console.error("Error fetching work log: ", error);
                toast.error("Failed to load work log details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchLog();
    }, [logId, recentlySelectedCompany, navigate]);

    if (isLoading) {
        return <div className="text-center p-10">Loading work log details...</div>;
    }

    if (!log) {
        return null;
    }

    const start = log.startTime || log.clockInAt || log.startedAt || log.dateCreated || log.date;
    const end = log.endTime || log.clockOutAt || log.endedAt || log.completedAt;
    const totalPay = log.rate && log.hoursWorked ? `$${(Number(log.hoursWorked || 0) * Number(log.rate || 0)).toFixed(2)}` : null;

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="mx-auto max-w-5xl">
                <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Work Log Details</h1>
                        <p className="mt-1 text-gray-600">Review the clocked segment and open route locations when needed.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {locations.length ? (
                            <a
                                href="#locations"
                                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
                            >
                                See Locations
                            </a>
                        ) : null}
                        <button
                            onClick={() => navigate('/company/workLogs')}
                            className='rounded-lg bg-gray-200 px-5 py-2 text-sm font-semibold text-gray-800 shadow-md transition hover:bg-gray-300'
                        >
                            Back to Logs
                        </button>
                    </div>
                </header>

                <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
                    <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
                        <div className="space-y-4">
                            <DetailItem label="Type" value={getLogType(log)} />
                            <DetailItem label="Employee Name" value={log.userName || route?.techName} />
                            <DetailItem label="Route" value={route?.name || route?.routeName || route?.techName || log.activeRouteId || log.routeId} />
                            <DetailItem label="Job/Task" value={log.jobName || log.taskName} />
                        </div>
                        <div className="space-y-4">
                            <DetailItem label="Started" value={formatDateTime(start)} />
                            <DetailItem label="Ended" value={formatTime(end)} />
                            <DetailItem label="Duration" value={formatDuration(start, end, log.hoursWorked)} />
                            <DetailItem label="Total Pay" value={totalPay} />
                        </div>
                    </div>

                    <div className="mt-8 border-t border-gray-200 pt-6">
                        <h3 className="mb-2 text-xl font-bold text-gray-800">Notes</h3>
                        <p className="whitespace-pre-wrap text-gray-700">{log.notes || log.description || 'No notes were provided for this entry.'}</p>
                    </div>
                </div>

                <section id="locations" className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
                    <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">Route Locations</h2>
                            <p className="text-sm text-gray-500">GPS breadcrumbs are shown here instead of on the work log list.</p>
                        </div>
                        <span className="text-sm font-semibold text-gray-600">{locations.length} point{locations.length === 1 ? '' : 's'}</span>
                    </div>

                    {locations.length ? (
                        <div className="overflow-hidden rounded-xl border border-gray-200">
                            <WorkLogMap logs={locations} />
                        </div>
                    ) : (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                            No route locations were recorded for this log.
                        </div>
                    )}

                    <div className="mt-4">
                        <Link
                            to="/company/route-dashboard"
                            className="text-sm font-semibold text-blue-600 hover:underline"
                        >
                            Open route dashboard
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default WorkLogDetails;
