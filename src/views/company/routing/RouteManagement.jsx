import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Link, useNavigate } from "react-router-dom";
import Select from "react-select";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathRoundedSquareIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";
import { getPlannedRouteOrder, getPlannedRouteRssIds } from "../../../utils/recurringRouteSync";
import {
  RSS_DAY_OPTIONS,
  RSS_FREQUENCY_OPTIONS,
  buildRecurringServiceStopUpdatePayload,
  formatDateInputValue,
  optionForValue,
  payTypeOptionFromDoc,
  recurringRoutePayTypeOptions,
  selectedPayTypeOptionForStop,
  selectedTechOptionForStop,
} from "../../../utils/recurringServiceStopEdit";

const functions = getFunctions();
const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const localStartOfTodayMs = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
};

const orderedRouteStops = (route) =>
  [...getPlannedRouteOrder(route)].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

const routeRssIds = (route) => getPlannedRouteRssIds(route, orderedRouteStops(route));

const stopCount = (route) => routeRssIds(route).length;

const routeTechnicianId = (route) => String(route?.techId || "");

const routeTechnicianLabel = (route, tech) => (
  tech?.label ||
  route?.techName ||
  route?.technicianName ||
  route?.tech ||
  route?.userName ||
  routeTechnicianId(route) ||
  "Unassigned technician"
);

const routeTitle = (route, tech, day) => (
  route?.description ||
  route?.name ||
  route?.routeName ||
  `${routeTechnicianLabel(route, tech)} ${day} Route`
);

const stopAddressLabel = (stop = {}) => {
  const address = stop.address || {};
  return [
    address.streetAddress || stop.streetAddress,
    address.city || stop.city,
    address.state || stop.state,
    address.zip || stop.zip,
  ].filter(Boolean).join(", ");
};

const stopTechnicianLabel = (stop = {}, techniciansById = new Map()) => {
  const techId = String(stop.techId || "");
  return stop.tech || techniciansById.get(techId)?.label || techId || "Unassigned";
};

const stopScheduleLabel = (stop = {}, techniciansById = new Map()) => (
  `${stop.day || stop.daysOfWeek || "No day"} - ${stopTechnicianLabel(stop, techniciansById)}`
);

const routeStopsForRoute = (route, recurringStopsById) => {
  const orderedStops = orderedRouteStops(route);
  const orderByRssId = new Map();
  orderedStops.forEach((item) => {
    if (item?.recurringServiceStopId) {
      orderByRssId.set(item.recurringServiceStopId, item);
    }
  });

  return routeRssIds(route).map((rssId, index) => {
    const routeOrderItem = orderByRssId.get(rssId) || {};
    const recurringStop = recurringStopsById.get(rssId) || null;

    return {
      ...routeOrderItem,
      ...(recurringStop || {}),
      id: rssId,
      recurringServiceStopId: rssId,
      routeOrderId: routeOrderItem.id || "",
      order: routeOrderItem.order || index + 1,
      customerName: recurringStop?.customerName || routeOrderItem.customerName || "",
      customerId: recurringStop?.customerId || routeOrderItem.customerId || "",
      address: recurringStop?.address || routeOrderItem.address || {},
      serviceLocationId: recurringStop?.serviceLocationId || routeOrderItem.locationId || "",
      type: recurringStop?.type || routeOrderItem.type || "",
      typeId: recurringStop?.typeId || routeOrderItem.typeId || "",
      typeImage: recurringStop?.typeImage || routeOrderItem.typeImage || "",
      missingRecurringStop: !recurringStop,
    };
  });
};

const RouteActionMenuItem = ({ label, icon: Icon, onClick, disabled = false, tone = "slate" }) => {
  const toneClasses = {
    blue: "text-blue-700 hover:bg-blue-50",
    green: "text-emerald-700 hover:bg-emerald-50",
    slate: "text-slate-800 hover:bg-slate-50",
  };

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${toneClasses[tone] || toneClasses.slate}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
};

const RouteStopList = ({ stops, techniciansById, onAssignStop }) => (
  <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
    {stops.length ? (
      <div className="space-y-2">
        {stops.map((stop, index) => (
          <div
            key={stop.recurringServiceStopId || `${stop.customerName}-${index}`}
            className="grid gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold text-slate-900">{stop.customerName || "Unnamed stop"}</p>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  {stop.internalId || "RSS"}
                </span>
                {stop.missingRecurringStop && (
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                    Missing record
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">{stopAddressLabel(stop) || "No address"}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">{stopScheduleLabel(stop, techniciansById)}</p>
            </div>
            <div className="flex flex-wrap justify-start gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => onAssignStop(stop)}
                disabled={stop.missingRecurringStop}
                className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                <AdjustmentsHorizontalIcon className="h-4 w-4" />
                Assign RSS
              </button>
              <Link
                to={`/company/recurringServiceStop/details/${stop.recurringServiceStopId}?edit=1`}
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open
              </Link>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
        No recurring service stops are attached to this route.
      </div>
    )}
  </div>
);

const RouteRow = ({
  day,
  tech,
  techniciansById,
  route,
  stops,
  expanded,
  actionsOpen,
  onToggleStops,
  onCloseActions,
  onToggleActions,
  onEdit,
  onAssignRoute,
  onMergeRoute,
  onAssignStop,
}) => {
  const routeHasStops = stops.length > 0;
  const stopPreview = stops
    .map((stop) => stop.customerName || stop.locationName || stopAddressLabel(stop) || "Unnamed stop")
    .filter(Boolean)
    .join(" -> ");

  return (
    <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-slate-100 px-5 py-4 md:grid-cols-[auto_220px_minmax(0,1fr)_auto] md:items-center">
        <button
          type="button"
          onClick={() => onToggleStops(route.id)}
          title={expanded ? "Hide stops" : "Show stops"}
          aria-label={expanded ? "Hide route stops" : "Show route stops"}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
        >
          {expanded ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
        </button>

        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{routeTechnicianLabel(route, tech)}</p>
          <p className="text-xs text-slate-500">{tech?.workerType || tech?.roleName || "Technician"}</p>
        </div>

        <div className="col-span-2 min-w-0 md:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-800">{routeTitle(route, tech, day)}</p>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{stops.length} stop(s)</span>
          </div>
          {routeHasStops ? (
            <p className="mt-1 line-clamp-1 text-sm text-slate-500">{stopPreview}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">No ordered stops on this route yet.</p>
          )}
        </div>

        <div className="col-span-2 flex flex-wrap justify-start gap-2 md:col-span-1 md:justify-end">
          <button
            type="button"
            onClick={() => onEdit(route)}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Edit
          </button>
          <div className="relative inline-flex justify-end">
            <button
              type="button"
              onClick={() => onToggleActions(route.id)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              title="Route actions"
            >
              <EllipsisVerticalIcon className="h-5 w-5" />
            </button>
            {actionsOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-10 cursor-default"
                  aria-label="Close route actions"
                  onClick={onCloseActions}
                />
                <div
                  className="absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-xl"
                  role="menu"
                >
                  <RouteActionMenuItem
                    label="Assign whole route"
                    icon={AdjustmentsHorizontalIcon}
                    tone="blue"
                    disabled={!routeHasStops}
                    onClick={() => onAssignRoute(route)}
                  />
                  <RouteActionMenuItem
                    label="Merge into route"
                    icon={ArrowPathRoundedSquareIcon}
                    tone="green"
                    disabled={!routeHasStops}
                    onClick={() => onMergeRoute(route)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <RouteStopList
          stops={stops}
          techniciansById={techniciansById}
          onAssignStop={onAssignStop}
        />
      )}
    </>
  );
};

const DaySection = ({
  day,
  routes,
  recurringStopsById,
  techniciansById,
  collapsed,
  onToggleCollapsed,
  onCreate,
  onEdit,
  expandedRouteIds,
  onToggleRouteStops,
  openActionRouteId,
  onToggleRouteActions,
  onCloseRouteActions,
  onAssignRoute,
  onMergeRoute,
  onAssignStop,
}) => {
  const totalStops = routes.reduce((total, route) => total + stopCount(route), 0);
  const collapseLabel = collapsed ? `Expand ${day}` : `Collapse ${day}`;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-lg bg-slate-50 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => onToggleCollapsed(day)}
            title={collapseLabel}
            aria-label={collapseLabel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
          >
            {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{day}</h2>
            <p className="text-sm text-slate-500">{routes.length} route(s), {totalStops} stop(s)</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCreate(day)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          New Route
        </button>
      </div>

      {collapsed ? null : routes.length ? (
        routes.map((route) => {
          const routeStops = routeStopsForRoute(route, recurringStopsById);

          return (
            <RouteRow
              key={route.id}
              day={day}
              tech={techniciansById.get(routeTechnicianId(route))}
              techniciansById={techniciansById}
              route={route}
              stops={routeStops}
              expanded={expandedRouteIds.has(route.id)}
              actionsOpen={openActionRouteId === route.id}
              onToggleStops={onToggleRouteStops}
              onCloseActions={onCloseRouteActions}
              onToggleActions={onToggleRouteActions}
              onEdit={onEdit}
              onAssignRoute={onAssignRoute}
              onMergeRoute={onMergeRoute}
              onAssignStop={(stop) => onAssignStop(route, stop)}
            />
          );
        })
      ) : (
        <div className="border-t border-slate-100 px-5 py-6 text-sm text-slate-500">No planned routes for this day.</div>
      )}
    </section>
  );
};

const RouteManagement = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const navigate = useNavigate();
  const [allRoutes, setAllRoutes] = useState([]);
  const [recurringStops, setRecurringStops] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState(null);
  const [techFilter, setTechFilter] = useState(null);
  const [collapsedDays, setCollapsedDays] = useState(() => new Set(daysOfWeek));
  const [expandedRouteIds, setExpandedRouteIds] = useState(() => new Set());
  const [openActionRouteId, setOpenActionRouteId] = useState("");
  const [assignmentModal, setAssignmentModal] = useState(null);
  const [assignmentDay, setAssignmentDay] = useState(null);
  const [assignmentTechnician, setAssignmentTechnician] = useState(null);
  const [assignmentDestinationRoute, setAssignmentDestinationRoute] = useState(null);
  const [savingAssignment, setSavingAssignment] = useState(false);

  const dayOptions = daysOfWeek.map((day) => ({ value: day, label: day }));

  const loadPlannedRouteData = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setAllRoutes([]);
      setRecurringStops([]);
      setTechnicians([]);
      setCompanyServiceStopTypes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const routesRef = collection(db, "companies", recentlySelectedCompany, "recurringRoutes");
      const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
      const recurringStopsRef = collection(db, "companies", recentlySelectedCompany, "recurringServiceStop");
      const payTypesRef = collection(db, "companies", recentlySelectedCompany, "companyPayTypes");
      const [routesSnapshot, usersSnapshot, recurringStopsSnapshot, payTypesSnapshot] = await Promise.all([
        getDocs(query(routesRef)),
        getDocs(query(usersRef)),
        getDocs(query(recurringStopsRef)),
        getDocs(query(payTypesRef)),
      ]);

      setAllRoutes(routesSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      setRecurringStops(recurringStopsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      setCompanyServiceStopTypes(payTypesSnapshot.docs.map(payTypeOptionFromDoc));
      setTechnicians(
        sortCompanyUsersByName(usersSnapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: data.userId || docSnap.id,
              userId: data.userId || docSnap.id,
              value: data.userId || docSnap.id,
              label: getCompanyUserDisplayName(data, docSnap.id),
              ...data,
            };
          })
          .filter((user) => String(user.status || "Active").toLowerCase() === "active")
        )
      );
    } catch (error) {
      console.error("Error fetching planned routes:", error);
      toast.error("Failed to load planned routes.");
    } finally {
      setIsLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadPlannedRouteData();
  }, [loadPlannedRouteData]);

  const visibleDays = useMemo(
    () => (dayFilter ? daysOfWeek.filter((day) => day === dayFilter.value) : daysOfWeek),
    [dayFilter]
  );

  const techniciansById = useMemo(() => {
    const nextTechnicians = new Map();
    technicians.forEach((tech) => {
      [tech.value, tech.userId, tech.id].filter(Boolean).forEach((id) => {
        nextTechnicians.set(String(id), tech);
      });
    });
    return nextTechnicians;
  }, [technicians]);

  const recurringStopsById = useMemo(() => {
    const nextStops = new Map();
    recurringStops.forEach((stop) => nextStops.set(String(stop.id), stop));
    return nextStops;
  }, [recurringStops]);

  const serviceStopTypeOptions = useMemo(
    () => recurringRoutePayTypeOptions(companyServiceStopTypes),
    [companyServiceStopTypes]
  );

  const routedTechnicianOptions = useMemo(() => {
    const optionsById = new Map();

    allRoutes.forEach((route) => {
      const techId = routeTechnicianId(route);
      if (!techId) return;

      const tech = techniciansById.get(techId);
      optionsById.set(techId, {
        ...(tech || {}),
        value: techId,
        label: routeTechnicianLabel(route, tech),
      });
    });

    return [...optionsById.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [allRoutes, techniciansById]);

  useEffect(() => {
    if (techFilter && !routedTechnicianOptions.some((tech) => tech.value === techFilter.value)) {
      setTechFilter(null);
    }
  }, [routedTechnicianOptions, techFilter]);

  const visibleRoutes = useMemo(
    () =>
      allRoutes.filter((route) => {
        const dayMatch = !dayFilter || route.day === dayFilter.value;
        const techMatch = !techFilter || routeTechnicianId(route) === techFilter.value;
        return dayMatch && techMatch;
      }),
    [allRoutes, dayFilter, techFilter]
  );

  const routesByDay = useMemo(() => {
    const nextRoutes = new Map(daysOfWeek.map((day) => [day, []]));

    visibleRoutes.forEach((route) => {
      if (!route.day) return;
      const dayRoutes = nextRoutes.get(route.day) || [];
      dayRoutes.push(route);
      nextRoutes.set(route.day, dayRoutes);
    });

    nextRoutes.forEach((dayRoutes) => {
      dayRoutes.sort((left, right) => {
        const leftTech = routeTechnicianLabel(left, techniciansById.get(routeTechnicianId(left)));
        const rightTech = routeTechnicianLabel(right, techniciansById.get(routeTechnicianId(right)));
        const leftTitle = routeTitle(left, techniciansById.get(routeTechnicianId(left)), left.day);
        const rightTitle = routeTitle(right, techniciansById.get(routeTechnicianId(right)), right.day);
        return leftTech.localeCompare(rightTech) || leftTitle.localeCompare(rightTitle);
      });
    });

    return nextRoutes;
  }, [visibleRoutes, techniciansById]);

  const totalStops = visibleRoutes.reduce((total, route) => total + stopCount(route), 0);
  const visibleTechnicianCount = useMemo(
    () => new Set(visibleRoutes.map((route) => routeTechnicianId(route)).filter(Boolean)).size,
    [visibleRoutes]
  );
  const visibleLocationCount = useMemo(() => {
    const locationIds = new Set();

    visibleRoutes.forEach((route) => {
      routeStopsForRoute(route, recurringStopsById).forEach((stop) => {
        const locationId = stop.serviceLocationId || stop.locationId || "";
        if (locationId) locationIds.add(String(locationId));
      });
    });

    return locationIds.size;
  }, [visibleRoutes, recurringStopsById]);
  const visibleCustomerCount = useMemo(() => {
    const customerIds = new Set();

    visibleRoutes.forEach((route) => {
      routeStopsForRoute(route, recurringStopsById).forEach((stop) => {
        const customerId = stop.customerId || stop.customerName || "";
        if (customerId) customerIds.add(String(customerId));
      });
    });

    return customerIds.size;
  }, [visibleRoutes, recurringStopsById]);
  const allVisibleDaysCollapsed = visibleDays.length > 0 && visibleDays.every((day) => collapsedDays.has(day));

  const destinationRouteOptions = useMemo(() => {
    const sourceRouteId = assignmentModal?.route?.id || "";
    return allRoutes
      .filter((route) => route.id !== sourceRouteId)
      .map((route) => {
        const tech = techniciansById.get(routeTechnicianId(route));
        return {
          value: route.id,
          label: `${route.day || "No day"} - ${routeTechnicianLabel(route, tech)} (${stopCount(route)} stops)`,
          route,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allRoutes, assignmentModal, techniciansById]);

  const assignmentStops = useMemo(() => {
    if (!assignmentModal) return [];
    if (assignmentModal.mode === "stop") return [assignmentModal.stop].filter(Boolean);
    return routeStopsForRoute(assignmentModal.route, recurringStopsById);
  }, [assignmentModal, recurringStopsById]);

  const technicianOptionForRoute = (route) => {
    const techId = routeTechnicianId(route);
    return selectedTechOptionForStop({
      tech: routeTechnicianLabel(route, techniciansById.get(techId)),
      techId,
    }, technicians);
  };

  const toggleDayCollapsed = (day) => {
    setCollapsedDays((current) => {
      const nextDays = new Set(current);
      if (nextDays.has(day)) {
        nextDays.delete(day);
      } else {
        nextDays.add(day);
      }
      return nextDays;
    });
  };

  const toggleAllVisibleDays = () => {
    setCollapsedDays((current) => {
      const nextDays = new Set(current);

      if (allVisibleDaysCollapsed) {
        visibleDays.forEach((day) => nextDays.delete(day));
      } else {
        visibleDays.forEach((day) => nextDays.add(day));
      }

      return nextDays;
    });
  };

  const toggleRouteStops = (routeId) => {
    setExpandedRouteIds((current) => {
      const nextRoutes = new Set(current);
      if (nextRoutes.has(routeId)) {
        nextRoutes.delete(routeId);
      } else {
        nextRoutes.add(routeId);
      }
      return nextRoutes;
    });
    setOpenActionRouteId("");
  };

  const toggleRouteActions = (routeId) => {
    setOpenActionRouteId((current) => (current === routeId ? "" : routeId));
  };

  const handleCreate = (day, tech = null) => {
    navigate("/company/route-builder", {
      state: {
        defaultDay: day,
        defaultTechnicianId: tech?.value || "",
      },
    });
  };

  const handleEdit = (route) => {
    navigate("/company/route-builder", { state: { templateToEdit: route } });
  };

  const openAssignmentModal = ({ mode, route, stop = null }) => {
    if (stop?.missingRecurringStop) {
      toast.error("This RSS record could not be loaded.");
      return;
    }

    const initialDay = mode === "merge" ? "" : (stop?.day || route?.day || "");
    const initialTechId = mode === "merge" ? "" : (stop?.techId || routeTechnicianId(route));
    const initialTech = mode === "merge"
      ? null
      : selectedTechOptionForStop({
        tech: stop?.tech || routeTechnicianLabel(route, techniciansById.get(initialTechId)),
        techId: initialTechId,
      }, technicians);

    setAssignmentModal({ mode, route, stop });
    setAssignmentDay(optionForValue(RSS_DAY_OPTIONS, initialDay, initialDay));
    setAssignmentTechnician(initialTech);
    setAssignmentDestinationRoute(null);
    setOpenActionRouteId("");
  };

  const closeAssignmentModal = () => {
    if (savingAssignment) return;
    setAssignmentModal(null);
    setAssignmentDay(null);
    setAssignmentTechnician(null);
    setAssignmentDestinationRoute(null);
  };

  const saveAssignment = async (event) => {
    event.preventDefault();
    if (!assignmentModal || !recentlySelectedCompany) return;

    const targetRoute = assignmentModal.mode === "merge" ? assignmentDestinationRoute?.route : null;
    const targetDay = targetRoute?.day || assignmentDay?.value || "";
    const targetTechnician = targetRoute ? technicianOptionForRoute(targetRoute) : assignmentTechnician;
    const loadedStops = assignmentStops.filter((stop) => stop?.id && !stop.missingRecurringStop);

    if (!loadedStops.length) {
      toast.error("No loaded RSS records were found for this action.");
      return;
    }

    if (loadedStops.length !== assignmentStops.length) {
      toast.error("Some RSS records could not be loaded. Refresh and try again.");
      return;
    }

    if (!targetDay || !targetTechnician?.value) {
      toast.error(assignmentModal.mode === "merge" ? "Select a destination route." : "Select a day and technician.");
      return;
    }

    setSavingAssignment(true);
    try {
      const callable = httpsCallable(functions, "updateRecurringServiceStop");
      const futureServiceStopsStartAt = localStartOfTodayMs();

      for (const stop of loadedStops) {
        const form = {
          payType: selectedPayTypeOptionForStop(stop, serviceStopTypeOptions),
          frequency: optionForValue(RSS_FREQUENCY_OPTIONS, stop.frequency, stop.frequency),
          technician: targetTechnician,
          day: optionForValue(RSS_DAY_OPTIONS, targetDay, targetDay),
          startDate: formatDateInputValue(stop.startDate),
          noEndDate: stop.noEndDate !== false,
          endDate: formatDateInputValue(stop.endDate),
        };
        const recurringServiceStopPayload = buildRecurringServiceStopUpdatePayload({
          stop,
          form,
          companyServiceStopTypes,
        });
        const result = await callable({
          companyId: recentlySelectedCompany,
          recurringServiceStop: recurringServiceStopPayload,
          syncRoute: true,
          destinationRouteId: targetRoute?.id || "",
          futureServiceStopsStartAt,
        });

        if (result.data?.success === false || (result.data?.status && Number(result.data.status) >= 400)) {
          throw new Error(result.data?.error || `Recurring service stop ${stop.internalId || stop.id} failed to update.`);
        }
      }

      const countLabel = `${loadedStops.length} RSS record${loadedStops.length === 1 ? "" : "s"}`;
      toast.success(assignmentModal.mode === "merge" ? `Merged ${countLabel}` : `Assigned ${countLabel}`);
      setAssignmentModal(null);
      setAssignmentDay(null);
      setAssignmentTechnician(null);
      setAssignmentDestinationRoute(null);
      await loadPlannedRouteData();
    } catch (error) {
      console.error("Error assigning planned route RSS:", error);
      toast.error(error.message || "Failed to assign recurring service stops.");
    } finally {
      setSavingAssignment(false);
    }
  };

  const assignmentModalTitle = assignmentModal?.mode === "merge"
    ? "Merge Route"
    : assignmentModal?.mode === "stop"
      ? "Assign RSS"
      : "Assign Whole Route";
  const assignmentModalSubtitle = assignmentModal?.mode === "stop"
    ? `${assignmentModal?.stop?.customerName || "Recurring stop"} - ${assignmentModal?.stop?.internalId || assignmentModal?.stop?.id || ""}`
    : assignmentModal?.route
      ? routeTitle(
        assignmentModal.route,
        techniciansById.get(routeTechnicianId(assignmentModal.route)),
        assignmentModal.route.day
      )
      : "";

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Operations</p>
              <h1 className="text-3xl font-bold text-slate-950">Planned Routes</h1>
              <p className="max-w-3xl text-sm text-slate-600">Recurring routes organized by day and technician.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleAllVisibleDays}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {allVisibleDaysCollapsed ? <ArrowsPointingOutIcon className="h-4 w-4" /> : <ArrowsPointingInIcon className="h-4 w-4" />}
                {allVisibleDaysCollapsed ? "Expand All" : "Collapse All"}
              </button>
              <Link
                to="/company/recurringServiceStop"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Recurring Service Stops
              </Link>
              <button
                type="button"
                onClick={() => handleCreate(null)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                New Route
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Routes</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleRoutes.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stops</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{totalStops}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Technicians</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleTechnicianCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Locations</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleLocationCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customers</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleCustomerCount}</p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[180px_1fr_1fr] md:items-center">
            <h2 className="font-semibold text-slate-800">Filters</h2>
            <Select options={dayOptions} value={dayFilter} onChange={setDayFilter} placeholder="Filter by day..." isClearable />
            <Select options={routedTechnicianOptions} value={techFilter} onChange={setTechFilter} placeholder="Filter by technician..." isLoading={isLoading} isClearable />
          </div>
        </section>

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">Loading routes...</div>
        ) : (
          <div className="space-y-4">
            {visibleDays.map((day) => (
              <DaySection
                key={day}
                day={day}
                routes={routesByDay.get(day) || []}
                recurringStopsById={recurringStopsById}
                techniciansById={techniciansById}
                collapsed={collapsedDays.has(day)}
                onToggleCollapsed={toggleDayCollapsed}
                onCreate={handleCreate}
                onEdit={handleEdit}
                expandedRouteIds={expandedRouteIds}
                onToggleRouteStops={toggleRouteStops}
                openActionRouteId={openActionRouteId}
                onToggleRouteActions={toggleRouteActions}
                onCloseRouteActions={() => setOpenActionRouteId("")}
                onAssignRoute={(route) => openAssignmentModal({ mode: "route", route })}
                onMergeRoute={(route) => openAssignmentModal({ mode: "merge", route })}
                onAssignStop={(route, stop) => openAssignmentModal({ mode: "stop", route, stop })}
              />
            ))}
          </div>
        )}
      </div>

      {assignmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={saveAssignment}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-950">{assignmentModalTitle}</h3>
                <p className="mt-1 text-sm text-slate-600">{assignmentModalSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={closeAssignmentModal}
                disabled={savingAssignment}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                title="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 overflow-y-auto px-5 py-5">
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
                <ReadonlyDatum label="RSS Records" value={assignmentStops.length} />
                <ReadonlyDatum
                  label="Current Day"
                  value={assignmentModal.stop?.day || assignmentModal.route?.day || "No day"}
                />
                <ReadonlyDatum
                  label="Current Tech"
                  value={
                    assignmentModal.stop
                      ? stopTechnicianLabel(assignmentModal.stop, techniciansById)
                      : routeTechnicianLabel(
                        assignmentModal.route,
                        techniciansById.get(routeTechnicianId(assignmentModal.route))
                      )
                  }
                />
              </div>

              {assignmentModal.mode === "merge" ? (
                <ModalField label="Destination Route">
                  <Select
                    value={assignmentDestinationRoute}
                    options={destinationRouteOptions}
                    onChange={setAssignmentDestinationRoute}
                    isSearchable
                    placeholder="Select route to merge into"
                  />
                </ModalField>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <ModalField label="Day">
                    <Select
                      value={assignmentDay}
                      options={RSS_DAY_OPTIONS}
                      onChange={setAssignmentDay}
                      isSearchable
                      placeholder="Select day"
                    />
                  </ModalField>
                  <ModalField label="Technician">
                    <Select
                      value={assignmentTechnician}
                      options={technicians}
                      onChange={setAssignmentTechnician}
                      isSearchable
                      placeholder="Select technician"
                    />
                  </ModalField>
                </div>
              )}

              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                This updates the recurring service stop templates, their future unfinished service stops, and planned-route membership.
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeAssignmentModal}
                disabled={savingAssignment}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAssignment}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {savingAssignment
                  ? "Saving..."
                  : assignmentModal.mode === "merge"
                    ? `Merge ${assignmentStops.length} RSS`
                    : assignmentModal.mode === "stop"
                      ? "Assign RSS"
                      : `Assign ${assignmentStops.length} RSS`}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const ModalField = ({ label, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);

const ReadonlyDatum = ({ label, value }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 truncate text-sm font-semibold text-slate-900">{value || "-"}</p>
  </div>
);

export default RouteManagement;
