
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from "../../../context/AuthContext";

const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const dateValue = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
    const date = dateValue(value);
    if (!date) return "No date";
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const normalizedDay = (stop) => {
    if (Array.isArray(stop.day)) return stop.day.join(", ");
    if (Array.isArray(stop.daysOfWeek)) return stop.daysOfWeek.join(", ");
    return stop.day || stop.daysOfWeek || "Unscheduled";
};

const stopStatus = (stop) => {
    const endDate = dateValue(stop.endDate);
    if (stop.noEndDate || !endDate) return { label: "Active", className: "bg-emerald-100 text-emerald-800" };
    if (endDate < new Date()) return { label: "Ended", className: "bg-slate-100 text-slate-600" };
    return { label: "Ends Scheduled", className: "bg-amber-100 text-amber-800" };
};

const RecurringServiceStopList = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();
    const [stops, setStops] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [dayFilter, setDayFilter] = useState("all");
    const [frequencyFilter, setFrequencyFilter] = useState("all");
    const [techFilter, setTechFilter] = useState("all");

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setIsLoading(false);
            return;
        }

        const stopsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop'));

        const unsubscribe = onSnapshot(stopsQuery, (snapshot) => {
            const stopsList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })).sort((a, b) => {
                const dayDelta = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
                if (Number.isFinite(dayDelta) && dayDelta !== 0) return dayDelta;
                return String(a.customerName || "").localeCompare(String(b.customerName || ""));
            });
            setStops(stopsList);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching recurring service stops:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();

    }, [recentlySelectedCompany]);

    const frequencyOptions = useMemo(
        () => Array.from(new Set(stops.map((stop) => stop.frequency).filter(Boolean))).sort(),
        [stops]
    );

    const techOptions = useMemo(
        () => Array.from(new Map(stops.map((stop) => [stop.techId || stop.tech || "unassigned", stop.tech || "Unassigned"]))).sort((a, b) => a[1].localeCompare(b[1])),
        [stops]
    );

    const visibleStops = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();

        return stops.filter((stop) => {
            const matchesSearch = !term || [
                stop.internalId,
                stop.customerName,
                stop.tech,
                stop.frequency,
                normalizedDay(stop),
                stop.address?.streetAddress,
                stop.serviceLocationId,
                stop.id,
            ].some((value) => String(value || "").toLowerCase().includes(term));

            const matchesDay = dayFilter === "all" || normalizedDay(stop).includes(dayFilter);
            const matchesFrequency = frequencyFilter === "all" || stop.frequency === frequencyFilter;
            const techKey = stop.techId || stop.tech || "unassigned";
            const matchesTech = techFilter === "all" || techKey === techFilter;

            return matchesSearch && matchesDay && matchesFrequency && matchesTech;
        });
    }, [dayFilter, frequencyFilter, searchTerm, stops, techFilter]);

    const stats = useMemo(() => {
        const active = stops.filter((stop) => stopStatus(stop).label === "Active").length;
        const ended = stops.filter((stop) => stopStatus(stop).label === "Ended").length;
        const routeLinked = stops.filter((stop) => stop.serviceLocationId && stop.techId && stop.day).length;
        return { active, ended, routeLinked };
    }, [stops]);

    const handleCreateNew = () => {
        navigate('/company/recurring-service-stops/create');
    };

    const handleRowClick = (stopId) => {
        navigate(`/company/recurringServiceStop/details/${stopId}`);
    }

    return (
        <div className='min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5'>
            <div className="w-full">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-3xl font-bold text-slate-900">Recurring Service Stops</h2>
                        <p className="mt-1 text-slate-600">Recurring stop templates that seed future service stops.</p>
                    </div>
                    <button
                        onClick={handleCreateNew}
                        className="rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                    >Create New</button>
                </div>

                <div className="mb-6 grid gap-4 md:grid-cols-4">
                    <SummaryCard label="Visible Stops" value={visibleStops.length} />
                    <SummaryCard label="Active" value={stats.active} />
                    <SummaryCard label="Ended" value={stats.ended} />
                    <SummaryCard label="Route Linked" value={stats.routeLinked} />
                </div>

                <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
                        <input
                            type="search"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Search customer, address, tech, internal ID..."
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                            <option value="all">All days</option>
                            {dayOrder.map((day) => <option key={day} value={day}>{day}</option>)}
                        </select>
                        <select value={frequencyFilter} onChange={(event) => setFrequencyFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                            <option value="all">All frequencies</option>
                            {frequencyOptions.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
                        </select>
                        <select value={techFilter} onChange={(event) => setTechFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                            <option value="all">All technicians</option>
                            {techOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    {isLoading ? (
                        <div className="p-8 text-center"><p className="text-slate-500">Loading stops...</p></div>
                    ) : visibleStops.length === 0 ? (
                        <div className="text-center p-8">
                            <h3 className="text-xl font-semibold text-slate-700">No Recurring Stops Found</h3>
                            <p className="text-slate-500 mt-2">Try adjusting filters or create a new recurring service stop.</p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stop</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Tech</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Day</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Frequency</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start / End</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th scope="col" className="relative px-6 py-3"><span className="sr-only">View</span></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {visibleStops.map(stop => {
                                    const status = stopStatus(stop);
                                    return (
                                    <tr key={stop.id} onClick={() => handleRowClick(stop.id)} className="hover:bg-gray-50 cursor-pointer">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-semibold text-slate-900">{stop.internalId || "—"}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{stop.customerName}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{stop.address?.streetAddress}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{stop.tech || 'Not Assigned'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{normalizedDay(stop)}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{stop.frequency}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{formatDate(stop.startDate)}</div>
                                            <div className="text-xs text-gray-500">{stop.noEndDate ? "No end date" : formatDate(stop.endDate)}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <span className="text-blue-600 hover:text-blue-900">View</span>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

const SummaryCard = ({ label, value }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{Number(value || 0).toLocaleString()}</p>
    </div>
);

export default RecurringServiceStopList;
