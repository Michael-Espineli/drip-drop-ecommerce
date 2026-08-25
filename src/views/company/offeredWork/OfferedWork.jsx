import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import toast from "react-hot-toast";
import {
  FiArrowUpRight,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiEdit2,
  FiFilter,
  FiGift,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiSettings,
  FiUser,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  ACCEPT_OFFERED_WORK_PERMISSION_ID,
  APPROVE_OFFERED_WORK_PERMISSION_ID,
  CREATE_OFFERED_WORK_PERMISSION_ID,
  INCENTIVIZE_OFFERED_WORK_PERMISSION_ID,
  SPLIT_OFFERED_WORK_PERMISSION_ID,
  UPDATE_OFFERED_WORK_PERMISSION_ID,
  VIEW_ALL_OFFERED_WORK_PERMISSION_ID,
} from "../../../utils/companyPermissions";
import {
  COMPANY_WIDE_SETTINGS_DOC_ID,
  DEFAULT_COMPANY_WORK_SETTINGS,
  normalizeCompanyWorkSettings,
  workOfferAssignmentStatusFor,
  workOfferPostingStatusFor,
} from "../../../utils/companyWorkSettings";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  WORK_OFFER_CATEGORY_FILTERS,
  WORK_OFFER_INCENTIVE_TYPES,
  WORK_OFFER_STATUS_FILTERS,
  WORK_OFFER_TYPE_FILTERS,
  buildWorkOfferSearchText,
  getWorkOfferBasePayCents,
  getWorkOfferCanSelfSchedule,
  getWorkOfferCategoryText,
  getWorkOfferEstimatedPayCents,
  getWorkOfferIncentiveCents,
  getWorkOfferIncentiveText,
  getWorkOfferTargetText,
  getWorkOfferTaskCount,
  getWorkOfferTypeText,
  isAcceptedReadyToScheduleWorkOffer,
  isAcceptedWorkOffer,
  isOpenWorkOffer,
  isScheduledWorkOffer,
  normalizedWorkOfferStatusKey,
  normalizeWorkOfferIncentive,
  normalizeWorkOfferStatus,
  workOfferMatchesStatusFilter,
} from "../../../utils/workOffers";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(millis));
};

const formatDateTime = (value) => {
  const millis = toMillis(value);
  if (!millis) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(millis));
};

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(value || 0) || 0) / 100);

const centsFromDollars = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
};

const formatDurationMinutes = (minutes) => {
  const value = Number(minutes || 0);
  if (!value) return "-";

  const hours = Math.floor(value / 60);
  const mins = value % 60;

  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
};

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const dateAtStartOfDay = (dateValue) => {
  const date = new Date(`${dateValue || todayInputDate()}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
};

const dateAtEndOfDay = (dateValue) => {
  const date = new Date(`${dateValue || todayInputDate()}T23:59:59`);
  date.setHours(23, 59, 59, 999);
  return date;
};

const dayNameFromDate = (dateValue) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(dateAtStartOfDay(dateValue));

const statusClasses = (status) => {
  const normalized = normalizedWorkOfferStatusKey(status);

  if (["sent", "posted", "viewed", "pending", "open", "draft", "offered"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (["pending approval", "acceptance pending approval"].includes(normalized)) {
    return "border-orange-200 bg-orange-50 text-orange-800";
  }

  if (normalized === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["scheduled", "in progress", "inprogress"].includes(normalized)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (normalized === "completed") return "border-slate-200 bg-slate-100 text-slate-700";
  if (["rejected", "cancelled", "canceled", "expired"].includes(normalized)) return "border-rose-200 bg-rose-50 text-rose-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
};

const makeId = (prefix) => `${prefix}_${uuidv4()}`;

const getCompanyUserId = (item = {}) =>
  item.userId || item.id || item.docId || item.companyUserId || "";

const getCompanyUserName = (item = {}) =>
  item.userName ||
  item.name ||
  item.displayName ||
  [item.firstName, item.lastName].filter(Boolean).join(" ") ||
  item.email ||
  "Technician";

const getCompanyUserWorkerType = (item = {}) => {
  const workerType = item.workerType;
  if (!workerType) return "Not Assigned";
  if (typeof workerType === "string") return workerType;
  return workerType.rawValue || workerType.value || workerType.name || "Not Assigned";
};

const sortCompanyUsersByName = (users = []) =>
  [...users].sort((left, right) => getCompanyUserName(left).localeCompare(getCompanyUserName(right)));

const normalizeBoard = (boardDoc) => {
  const data = boardDoc.data ? boardDoc.data() : boardDoc;
  return {
    id: boardDoc.id || data.id || "",
    ...data,
    name: data.name || "Work Board",
    memberUserIds: Array.isArray(data.memberUserIds) ? data.memberUserIds : [],
    memberCompanyUserDocIds: Array.isArray(data.memberCompanyUserDocIds) ? data.memberCompanyUserDocIds : [],
    memberNames: Array.isArray(data.memberNames) ? data.memberNames : [],
  };
};

const currentUserIdsFor = ({ user, dataBaseUser, companyUserAccess }) =>
  [
    user?.uid,
    user?.id,
    dataBaseUser?.userId,
    dataBaseUser?.id,
    companyUserAccess?.userId,
    companyUserAccess?.companyUserId,
    companyUserAccess?.id,
  ]
    .filter(Boolean)
    .map(String);

const uniqueStrings = (values = []) => [...new Set(values.filter(Boolean).map(String))];

const routeStopIdsFor = (route = {}) => {
  const data = route || {};
  return uniqueStrings([
    ...(Array.isArray(data.serviceStopsIds) ? data.serviceStopsIds : []),
    ...(Array.isArray(data.serviceStopIds) ? data.serviceStopIds : []),
    ...(Array.isArray(data.order) ? data.order.map((item) => item.serviceStopId || item.id) : []),
  ]);
};

const routeNameFor = (route = {}) => {
  const data = route || {};
  return data.name || [data.techName || data.tech, data.day || formatDate(data.date)].filter(Boolean).join(" - ") || "Route";
};

const serviceStopLabel = (stop = {}) =>
  [
    stop.customerName,
    stop.serviceLocationName,
    stop.address?.streetAddress || stop.serviceLocationAddress,
    stop.type || stop.serviceStopTypeName,
  ].filter(Boolean).join(" - ") || stop.id || "Service stop";

const offerBoardIds = (offer = {}) =>
  uniqueStrings([
    offer.boardId,
    ...(Array.isArray(offer.boardIds) ? offer.boardIds : []),
  ]);

const offerBoardNames = (offer = {}) =>
  uniqueStrings([
    offer.boardName,
    ...(Array.isArray(offer.boardNames) ? offer.boardNames : []),
  ]);

const offerServiceStopIds = (offer = {}) =>
  uniqueStrings([
    offer.serviceStopId,
    offer.scheduledServiceStopId,
    ...(Array.isArray(offer.serviceStopIds) ? offer.serviceStopIds : []),
    ...(Array.isArray(offer.serviceStopsIds) ? offer.serviceStopsIds : []),
    ...(Array.isArray(offer.routeServiceStopIds) ? offer.routeServiceStopIds : []),
  ]);

const userCanSeeBoardOffer = ({ offer, currentUserIds, userBoardIds }) => {
  const boardIds = offerBoardIds(offer);
  if (boardIds.length > 0) return boardIds.some((boardId) => userBoardIds.has(boardId));

  const memberIds = uniqueStrings([
    ...(Array.isArray(offer.boardMemberUserIds) ? offer.boardMemberUserIds : []),
    ...(Array.isArray(offer.boardMemberCompanyUserDocIds) ? offer.boardMemberCompanyUserDocIds : []),
  ]);
  if (memberIds.length > 0) return memberIds.some((memberId) => currentUserIds.includes(memberId));

  return offer.postedToBoard || offer.isBoardPost;
};

const workOfferVisibleToUser = ({ offer, currentUserIds, userBoardIds, canViewAll }) => {
  if (canViewAll) return true;
  if (!offer) return false;

  const directIds = uniqueStrings([
    offer.offeredToUserId,
    offer.receiverId,
    offer.workerId,
    offer.acceptedByUserId,
    offer.assignedTechnicianId,
    offer.routeTechId,
    offer.originalTechnicianId,
    offer.createdByUserId,
  ]);
  if (directIds.some((id) => currentUserIds.includes(id))) return true;

  if (offer.postedToBoard || offer.isBoardPost || offerBoardIds(offer).length > 0) {
    return userCanSeeBoardOffer({ offer, currentUserIds, userBoardIds });
  }

  return false;
};

const approvedStatusForOffer = (offer = {}) =>
  getWorkOfferTypeText(offer) === "Direct User" ? "Sent" : "Posted";

const emptyOfferForm = (currentUserId = "") => ({
  offerType: "Internal Board",
  workOfferCategory: "fullRoute",
  routeDate: todayInputDate(),
  routeId: "",
  routeTechId: currentUserId,
  selectedStopIds: [],
  boardIds: [],
  directUserId: "",
  jobId: "",
  title: "",
  notes: "",
  estimatedMinutes: "",
  basePayAmount: "",
  allowsTechnicianSelfScheduling: true,
  incentiveType: "none",
  incentiveAmount: "",
  incentivePercentage: "",
  incentiveNotes: "",
});

const SummaryTile = ({ icon: Icon, label, value, detail, tone = "slate" }) => {
  const toneClasses = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    slate: "border-slate-200 bg-white text-slate-700",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg border ${toneClasses[tone] || toneClasses.slate}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
};

const OfferedWork = () => {
  const {
    recentlySelectedCompany,
    user,
    dataBaseUser,
    companyUserAccess,
    name,
  } = useContext(Context);
  const { can, requirePermission, permissionsReady } = useCompanyPermissions();
  const [offers, setOffers] = useState([]);
  const [boards, setBoards] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [companySettings, setCompanySettings] = useState(DEFAULT_COMPANY_WORK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [boardFilter, setBoardFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [schedulingFilter, setSchedulingFilter] = useState("all");
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [offerForm, setOfferForm] = useState(() => emptyOfferForm());
  const [savingOffer, setSavingOffer] = useState(false);
  const [creationLoading, setCreationLoading] = useState(false);
  const [activeRoutes, setActiveRoutes] = useState([]);
  const [recurringRoutes, setRecurringRoutes] = useState([]);
  const [routeStops, setRouteStops] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [boardModalOpen, setBoardModalOpen] = useState(false);
  const [boardForm, setBoardForm] = useState({ id: "", name: "", memberUserIds: [] });
  const [savingBoard, setSavingBoard] = useState(false);
  const [incentiveOffer, setIncentiveOffer] = useState(null);
  const [incentiveForm, setIncentiveForm] = useState({
    type: "none",
    amount: "",
    percentage: "",
    notes: "",
  });
  const [savingIncentive, setSavingIncentive] = useState(false);

  const currentUserIds = useMemo(
    () => currentUserIdsFor({ user, dataBaseUser, companyUserAccess }),
    [user, dataBaseUser, companyUserAccess]
  );
  const currentUserId = currentUserIds[0] || "";
  const currentCompanyUser =
    companyUsers.find((item) => currentUserIds.includes(String(getCompanyUserId(item)))) ||
    companyUsers.find((item) => String(item.email || "").toLowerCase() === String(user?.email || dataBaseUser?.email || "").toLowerCase()) ||
    null;
  const currentCompanyUserId = currentCompanyUser ? getCompanyUserId(currentCompanyUser) : currentUserId;
  const currentCompanyUserName = currentCompanyUser ? getCompanyUserName(currentCompanyUser) : name || user?.displayName || user?.email || "Technician";

  const canViewAllOffers = can(VIEW_ALL_OFFERED_WORK_PERMISSION_ID);
  const canCreateOffers = can(CREATE_OFFERED_WORK_PERMISSION_ID);
  const canManageOffers = can(UPDATE_OFFERED_WORK_PERMISSION_ID) || canViewAllOffers;
  const canSplitOffers = can(SPLIT_OFFERED_WORK_PERMISSION_ID);
  const canAddIncentives = can(INCENTIVIZE_OFFERED_WORK_PERMISSION_ID);
  const canApproveOffers = can(APPROVE_OFFERED_WORK_PERMISSION_ID);
  const canAcceptOffers = can(ACCEPT_OFFERED_WORK_PERMISSION_ID);

  const userBoardIds = useMemo(() => {
    const ids = new Set();
    boards.forEach((board) => {
      const members = uniqueStrings([
        ...(board.memberUserIds || []),
        ...(board.memberCompanyUserDocIds || []),
      ]);
      if (members.some((memberId) => currentUserIds.includes(memberId))) {
        ids.add(board.id);
      }
    });
    return ids;
  }, [boards, currentUserIds]);

  const loadOffers = async () => {
    if (!recentlySelectedCompany) {
      setOffers([]);
      setBoards([]);
      setCompanyUsers([]);
      setCompanySettings(DEFAULT_COMPANY_WORK_SETTINGS);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [offersSnap, boardsSnap, usersSnap, settingsSnap] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "workOffers")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "workOfferBoards")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
        getDoc(doc(db, "companies", recentlySelectedCompany, "settings", COMPANY_WIDE_SETTINGS_DOC_ID)),
      ]);

      setOffers(offersSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      setBoards(boardsSnap.docs.map(normalizeBoard).sort((a, b) => a.name.localeCompare(b.name)));
      setCompanyUsers(sortCompanyUsersByName(usersSnap.docs.map((item) => ({ id: item.id, ...item.data() }))));
      setCompanySettings(normalizeCompanyWorkSettings(settingsSnap.exists() ? settingsSnap.data() : {}));
    } catch (error) {
      console.error("Failed to load offered work:", error);
      toast.error("Failed to load offered work.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany]);

  const visibleOffers = useMemo(() => (
    offers.filter((offer) => workOfferVisibleToUser({
      offer,
      currentUserIds,
      userBoardIds,
      canViewAll: canViewAllOffers,
    }))
  ), [canViewAllOffers, currentUserIds, offers, userBoardIds]);

  const technicianOptions = useMemo(() => {
    const names = [...new Set(visibleOffers.map(getWorkOfferTargetText).filter((techName) => techName && techName !== "Internal Board"))]
      .sort((a, b) => a.localeCompare(b));

    return [{ value: "all", label: "All Technicians" }, ...names.map((techName) => ({ value: techName, label: techName }))];
  }, [visibleOffers]);

  const boardOptions = useMemo(() => [
    { value: "all", label: "All Boards" },
    { value: "direct", label: "Direct Offers" },
    ...boards.map((board) => ({ value: board.id, label: board.name })),
  ], [boards]);

  const summary = useMemo(() => {
    const open = visibleOffers.filter(isOpenWorkOffer);
    const accepted = visibleOffers.filter(isAcceptedWorkOffer);
    const ready = visibleOffers.filter(isAcceptedReadyToScheduleWorkOffer);
    const scheduled = visibleOffers.filter(isScheduledWorkOffer);
    const board = visibleOffers.filter((offer) => getWorkOfferTypeText(offer).toLowerCase() === "internal board");
    const selfSchedule = visibleOffers.filter(getWorkOfferCanSelfSchedule);
    const incentives = visibleOffers.reduce((total, offer) => total + getWorkOfferIncentiveCents(offer), 0);

    return {
      total: visibleOffers.length,
      open: open.length,
      accepted: accepted.length,
      ready: ready.length,
      scheduled: scheduled.length,
      board: board.length,
      selfSchedule: selfSchedule.length,
      incentives,
      estimatedPayCents: visibleOffers.reduce((total, offer) => total + getWorkOfferEstimatedPayCents(offer), 0),
    };
  }, [visibleOffers]);

  const filteredOffers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return visibleOffers
      .filter((offer) => workOfferMatchesStatusFilter(offer, statusFilter))
      .filter((offer) => {
        if (typeFilter === "all") return true;
        return getWorkOfferTypeText(offer).toLowerCase() === typeFilter;
      })
      .filter((offer) => {
        if (categoryFilter === "all") return true;
        return (offer.workOfferCategory || offer.workCategory || "") === categoryFilter;
      })
      .filter((offer) => {
        if (boardFilter === "all") return true;
        if (boardFilter === "direct") return getWorkOfferTypeText(offer) === "Direct User";
        return offerBoardIds(offer).includes(boardFilter);
      })
      .filter((offer) => {
        if (technicianFilter === "all") return true;
        return getWorkOfferTargetText(offer) === technicianFilter;
      })
      .filter((offer) => {
        if (schedulingFilter === "all") return true;
        if (schedulingFilter === "self") return getWorkOfferCanSelfSchedule(offer);
        if (schedulingFilter === "admin") return !getWorkOfferCanSelfSchedule(offer) && !isScheduledWorkOffer(offer);
        if (schedulingFilter === "scheduled") return isScheduledWorkOffer(offer);
        if (schedulingFilter === "unscheduled") return !(offer.serviceStopId || offer.scheduledServiceStopId);
        return true;
      })
      .filter((offer) => !term || buildWorkOfferSearchText(offer).includes(term))
      .sort((left, right) => {
        const readyDifference =
          Number(isAcceptedReadyToScheduleWorkOffer(right)) - Number(isAcceptedReadyToScheduleWorkOffer(left));
        if (readyDifference !== 0) return readyDifference;

        const openDifference = Number(isOpenWorkOffer(right)) - Number(isOpenWorkOffer(left));
        if (openDifference !== 0) return openDifference;

        return toMillis(right.createdAt || right.postedAt || right.sentAt) -
          toMillis(left.createdAt || left.postedAt || left.sentAt);
      });
  }, [boardFilter, categoryFilter, schedulingFilter, searchTerm, statusFilter, technicianFilter, typeFilter, visibleOffers]);

  const routeOptions = useMemo(() => {
    const dateDay = dayNameFromDate(offerForm.routeDate);
    const activeOptions = activeRoutes.map((route) => ({
      id: route.id,
      source: "activeRoutes",
      route,
      label: `${routeNameFor(route)} (${routeStopIdsFor(route).length} stops)`,
    }));
    const recurringOptions = recurringRoutes
      .filter((route) => !route.day || route.day === dateDay)
      .map((route) => ({
        id: route.id,
        source: "recurringRoutes",
        route,
        label: `${routeNameFor(route)} (${routeStopIdsFor(route).length} planned stops)`,
      }));

    return [...activeOptions, ...recurringOptions];
  }, [activeRoutes, recurringRoutes, offerForm.routeDate]);

  const selectedRouteOption = routeOptions.find((option) => `${option.source}:${option.id}` === offerForm.routeId) || null;
  const selectedRoute = selectedRouteOption?.route || null;
  const selectedRouteStopIds = routeStopIdsFor(selectedRoute);
  const selectedRouteStops = routeStops.filter((stop) => selectedRouteStopIds.includes(stop.id));
  const selectedJob = jobs.find((job) => job.id === offerForm.jobId) || null;
  const offerBasePayCents = centsFromDollars(offerForm.basePayAmount);
  const offerIncentive = normalizeWorkOfferIncentive({
    incentive: {
      type: offerForm.incentiveType,
      amountCents: centsFromDollars(offerForm.incentiveAmount),
      percentage: Number(offerForm.incentivePercentage || 0),
      notes: offerForm.incentiveNotes || "",
    },
  });
  const offerIncentiveCents =
    offerIncentive.type === "flat"
      ? offerIncentive.amountCents
      : offerIncentive.type === "percentage"
        ? Math.round(offerBasePayCents * (offerIncentive.percentage / 100))
        : 0;
  const effectiveOfferIncentive = offerIncentiveCents > 0 ? offerIncentive : normalizeWorkOfferIncentive();
  const offerEstimatedTotalCents = offerBasePayCents + offerIncentiveCents;

  useEffect(() => {
    if (!offerModalOpen || !recentlySelectedCompany) return undefined;

    let cancelled = false;

    const loadCreationContext = async () => {
      setCreationLoading(true);

      try {
        const [activeRoutesSnap, routeStopsSnap, recurringRoutesSnap, jobsSnap] = await Promise.all([
          getDocs(query(
            collection(db, "companies", recentlySelectedCompany, "activeRoutes"),
            where("date", ">=", dateAtStartOfDay(offerForm.routeDate)),
            where("date", "<=", dateAtEndOfDay(offerForm.routeDate))
          )),
          getDocs(query(
            collection(db, "companies", recentlySelectedCompany, "serviceStops"),
            where("serviceDate", ">=", dateAtStartOfDay(offerForm.routeDate)),
            where("serviceDate", "<=", dateAtEndOfDay(offerForm.routeDate))
          )),
          getDocs(collection(db, "companies", recentlySelectedCompany, "recurringRoutes")),
          getDocs(query(collection(db, "companies", recentlySelectedCompany, "workOrders"), firestoreLimit(100))),
        ]);

        if (cancelled) return;
        setActiveRoutes(activeRoutesSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((route) => !route.duplicateOf));
        setRouteStops(routeStopsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
        setRecurringRoutes(recurringRoutesSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
        setJobs(jobsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (error) {
        console.error("Failed to load offer creation context:", error);
        toast.error("Could not load routes and jobs for offer creation.");
      } finally {
        if (!cancelled) setCreationLoading(false);
      }
    };

    loadCreationContext();

    return () => {
      cancelled = true;
    };
  }, [offerForm.routeDate, offerModalOpen, recentlySelectedCompany]);

  useEffect(() => {
    if (!offerModalOpen || offerForm.routeId || routeOptions.length === 0) return;
    setOfferForm((current) => ({ ...current, routeId: `${routeOptions[0].source}:${routeOptions[0].id}` }));
  }, [offerForm.routeId, offerModalOpen, routeOptions]);

  const openCreateOfferModal = () => {
    if (!requirePermission(CREATE_OFFERED_WORK_PERMISSION_ID, "create offered work")) return;
    setOfferForm(emptyOfferForm(currentCompanyUserId));
    setOfferModalOpen(true);
  };

  const closeCreateOfferModal = () => {
    if (savingOffer) return;
    setOfferModalOpen(false);
  };

  const updateOfferForm = (field, value) => {
    setOfferForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "workOfferCategory" && value === "fullRoute") next.selectedStopIds = [];
      if (field === "offerType" && value === "Direct User") next.boardIds = [];
      if (field === "offerType" && value === "Internal Board") next.directUserId = "";
      if (field === "routeId") next.selectedStopIds = [];
      return next;
    });
  };

  const toggleOfferBoard = (boardId) => {
    setOfferForm((current) => {
      const ids = new Set(current.boardIds || []);
      if (ids.has(boardId)) ids.delete(boardId);
      else ids.add(boardId);
      return { ...current, boardIds: [...ids] };
    });
  };

  const toggleRouteStop = (stopId) => {
    setOfferForm((current) => {
      const ids = new Set(current.selectedStopIds || []);
      if (ids.has(stopId)) ids.delete(stopId);
      else ids.add(stopId);
      return { ...current, selectedStopIds: [...ids] };
    });
  };

  const updateRelatedServiceStopsForOffer = async ({ offer, assigneeId = "", assigneeName = "", incentive = null }) => {
    const serviceStopIds = offerServiceStopIds(offer);
    if (!recentlySelectedCompany || serviceStopIds.length === 0) return;

    const updates = {
      updatedAt: serverTimestamp(),
      workOfferId: offer.id,
      assignedFromWorkOffer: Boolean(assigneeId),
    };

    if (assigneeId) {
      updates.techId = assigneeId;
      updates.tech = assigneeName || "Technician";
    }

    if (incentive) {
      updates.workOfferIncentive = incentive;
      updates.workOfferIncentiveEstimatedCents =
        incentive.type === "flat"
          ? incentive.amountCents
          : getWorkOfferIncentiveCents({ ...offer, incentive });
    }

    await Promise.all(serviceStopIds.map((serviceStopId) =>
      updateDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId), updates)
    ));
  };

  const saveOffer = async () => {
    if (!requirePermission(CREATE_OFFERED_WORK_PERMISSION_ID, "create offered work")) return;
    if (!recentlySelectedCompany) return;

    const isManagementPosting = canManageOffers && offerForm.routeTechId && offerForm.routeTechId !== currentCompanyUserId;
    const settings = normalizeCompanyWorkSettings(companySettings);
    const isRouteOffer = ["fullRoute", "partialRoute"].includes(offerForm.workOfferCategory);

    if (isManagementPosting && !settings.managementCanOfferAnyWork) {
      toast.error("Management route posting is disabled in company settings.");
      return;
    }
    if (!isManagementPosting && offerForm.workOfferCategory === "fullRoute" && !settings.technicianCanOfferFullRoutes) {
      toast.error("Technician full-route offers are disabled.");
      return;
    }
    if (!isManagementPosting && offerForm.workOfferCategory === "partialRoute" && !settings.technicianCanOfferPartialRoutes) {
      toast.error("Technician partial-route offers are disabled.");
      return;
    }
    if (!isManagementPosting && offerForm.workOfferCategory === "oneOffJob" && !settings.technicianCanOfferOneOffJobs) {
      toast.error("Technician one-off job offers are disabled.");
      return;
    }
    if (offerForm.workOfferCategory === "partialRoute" && !canSplitOffers) {
      toast.error("You do not have permission to split offered work.");
      return;
    }
    if (isRouteOffer && !selectedRoute) {
      toast.error("Select a route before creating the offer.");
      return;
    }
    if (offerForm.workOfferCategory === "partialRoute" && offerForm.selectedStopIds.length === 0) {
      toast.error("Select at least one route stop for a partial route offer.");
      return;
    }
    if (offerForm.offerType === "Direct User" && !offerForm.directUserId) {
      toast.error("Select a technician for a direct offer.");
      return;
    }
    if (offerForm.offerType === "Internal Board" && offerForm.boardIds.length === 0) {
      toast.error("Select at least one work offer board.");
      return;
    }

    const routeTech =
      companyUsers.find((item) => getCompanyUserId(item) === offerForm.routeTechId) ||
      currentCompanyUser ||
      null;
    const directUser = companyUsers.find((item) => getCompanyUserId(item) === offerForm.directUserId) || null;
    const selectedBoards = boards.filter((board) => offerForm.boardIds.includes(board.id));
    const isBoardPost = offerForm.offerType === "Internal Board";
    const status = workOfferPostingStatusFor({ offerType: offerForm.offerType, settings });
    const id = makeId("comp_work_offer");
    const selectedStopIds =
      offerForm.workOfferCategory === "partialRoute"
        ? uniqueStrings(offerForm.selectedStopIds)
        : selectedRouteStopIds;
    const title =
      offerForm.title.trim() ||
      (isRouteOffer
        ? `${getCompanyUserName(routeTech)} route coverage`
        : selectedJob?.internalId || selectedJob?.description || "One-off work");
    const incentiveEstimatedPayLine = offerIncentiveCents > 0
      ? {
        id: "offer_estimate_work_offer_incentive",
        sourceTaskId: null,
        source: "Work Offer Incentive",
        title: "Work Offer Incentive",
        rateAmountCents: offerIncentiveCents,
        rateType: "Manual",
        quantity: 1,
        quantityUnit: "Each",
        totalAmountCents: offerIncentiveCents,
        calculationStatus: "Calculated",
        notes: effectiveOfferIncentive.notes || "Management incentive added to this work offer.",
      }
      : null;

    const payload = {
      id,
      companyId: recentlySelectedCompany,
      offerType: offerForm.offerType,
      status,
      companyApprovalRequired: status === "Pending Approval",
      acceptanceApprovalRequired: settings.workOffersRequireApprovalBeforeAssignment,
      title,
      description: offerForm.notes.trim(),
      notes: offerForm.notes.trim(),
      workOfferCategory: offerForm.workOfferCategory,
      sourceType: offerForm.workOfferCategory,
      postedToBoard: isBoardPost,
      isBoardPost,
      boardIds: isBoardPost ? selectedBoards.map((board) => board.id) : [],
      boardNames: isBoardPost ? selectedBoards.map((board) => board.name) : [],
      boardName: isBoardPost ? selectedBoards.map((board) => board.name).join(", ") : "",
      boardMemberUserIds: isBoardPost ? uniqueStrings(selectedBoards.flatMap((board) => board.memberUserIds || [])) : [],
      offeredToUserId: isBoardPost ? "" : getCompanyUserId(directUser),
      offeredToUserName: isBoardPost ? "" : getCompanyUserName(directUser),
      offeredToWorkerType: isBoardPost ? "Not Assigned" : getCompanyUserWorkerType(directUser),
      allowsTechnicianSelfScheduling: offerForm.allowsTechnicianSelfScheduling,
      canTechnicianSchedule: offerForm.allowsTechnicianSelfScheduling,
      routeId: isRouteOffer ? selectedRoute.id : "",
      routeSource: isRouteOffer ? selectedRouteOption.source : "",
      routeName: isRouteOffer ? routeNameFor(selectedRoute) : "",
      routeDate: isRouteOffer ? Timestamp.fromDate(dateAtStartOfDay(offerForm.routeDate)) : null,
      routeTechId: isRouteOffer ? getCompanyUserId(routeTech) : "",
      routeTechName: isRouteOffer ? getCompanyUserName(routeTech) : "",
      originalTechnicianId: isRouteOffer ? getCompanyUserId(routeTech) : "",
      originalTechnicianName: isRouteOffer ? getCompanyUserName(routeTech) : "",
      routeOfferMode: offerForm.workOfferCategory === "partialRoute" ? "partial" : "whole",
      routeSplitAllowed: offerForm.workOfferCategory === "partialRoute",
      routeServiceStopIds: selectedStopIds,
      serviceStopIds: selectedStopIds,
      serviceStopsIds: selectedStopIds,
      stopCount: selectedStopIds.length,
      jobId: offerForm.workOfferCategory === "oneOffJob" ? selectedJob?.id || "" : "",
      jobInternalId: offerForm.workOfferCategory === "oneOffJob" ? selectedJob?.internalId || "" : "",
      jobName: offerForm.workOfferCategory === "oneOffJob" ? selectedJob?.description || selectedJob?.type || selectedJob?.internalId || title : "",
      customerId: selectedJob?.customerId || "",
      customerName: selectedJob?.customerName || "",
      serviceLocationId: selectedJob?.serviceLocationId || "",
      serviceLocationName: selectedJob?.serviceLocationName || "",
      proposedStartDate: isRouteOffer ? Timestamp.fromDate(dateAtStartOfDay(offerForm.routeDate)) : null,
      proposedEndDate: null,
      estimatedMinutes: Number(offerForm.estimatedMinutes || 0),
      paySource: offerBasePayCents > 0 ? "Offered Amount" : "Technician Rate",
      offeredAmountCents: offerBasePayCents,
      estimatedBasePayCents: offerBasePayCents,
      estimatedLaborCents: offerBasePayCents,
      estimatedPayCents: canAddIncentives ? offerEstimatedTotalCents : offerBasePayCents,
      estimatedPayTotalCents: canAddIncentives ? offerEstimatedTotalCents : offerBasePayCents,
      estimatedPayWithIncentiveCents: canAddIncentives ? offerEstimatedTotalCents : offerBasePayCents,
      incentive: canAddIncentives ? effectiveOfferIncentive : normalizeWorkOfferIncentive(),
      incentiveType: canAddIncentives ? effectiveOfferIncentive.type : "none",
      incentiveAmountCents: canAddIncentives ? effectiveOfferIncentive.amountCents : 0,
      incentivePercentage: canAddIncentives ? effectiveOfferIncentive.percentage : 0,
      incentiveEstimatedCents: canAddIncentives ? offerIncentiveCents : 0,
      estimatedPayLines: [
        ...(offerBasePayCents > 0 ? [{
          id: "offer_estimate_base_amount",
          sourceTaskId: null,
          source: "Manual Adjustment",
          title: "Base Offer Pay",
          rateAmountCents: offerBasePayCents,
          rateType: "Manual",
          quantity: 1,
          quantityUnit: "Each",
          totalAmountCents: offerBasePayCents,
          calculationStatus: "Calculated",
          notes: "Base pay entered for this work offer.",
        }] : []),
        ...(incentiveEstimatedPayLine && canAddIncentives ? [incentiveEstimatedPayLine] : []),
      ],
      estimatedPayNotes: "Estimate only. Final payroll is generated from completed service stop work.",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUserId: user?.uid || currentCompanyUserId || "",
      createdByUserName: name || user?.displayName || user?.email || currentCompanyUserName,
      offeredByUserId: user?.uid || currentCompanyUserId || "",
      offeredByUserName: name || user?.displayName || user?.email || currentCompanyUserName,
      sentAt: !isBoardPost && status === "Sent" ? serverTimestamp() : null,
      postedAt: isBoardPost && status === "Posted" ? serverTimestamp() : null,
      acceptedAt: null,
      acceptedByUserId: "",
      acceptedByUserName: "",
      assignedTechnicianId: "",
      assignedTechnicianName: "",
      assignmentStatus: "",
      rejectedAt: null,
      completedAt: null,
      adminNotes: offerForm.notes.trim(),
      workerNotes: "",
    };

    setSavingOffer(true);

    try {
      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOffers", id), payload, { merge: true });
      setOffers((current) => [{
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
        postedAt: isBoardPost && status === "Posted" ? new Date() : null,
        sentAt: !isBoardPost && status === "Sent" ? new Date() : null,
      }, ...current]);
      setOfferModalOpen(false);
      toast.success("Work offer created.");
    } catch (error) {
      console.error("Failed to create work offer:", error);
      toast.error("Could not create work offer.");
    } finally {
      setSavingOffer(false);
    }
  };

  const acceptOffer = async (offer) => {
    if (!requirePermission(ACCEPT_OFFERED_WORK_PERMISSION_ID, "accept offered work")) return;
    if (!recentlySelectedCompany || !offer?.id) return;

    const assignmentStatus = workOfferAssignmentStatusFor(companySettings);
    const autoAssign = assignmentStatus === "Assigned";
    const nextStatus = autoAssign ? "Accepted" : "Acceptance Pending Approval";
    const acceptedByUserId = currentCompanyUserId || user?.uid || "";
    const acceptedByUserName = currentCompanyUserName || name || user?.email || "Technician";
    const updates = {
      status: nextStatus,
      assignmentStatus,
      acceptedAt: serverTimestamp(),
      acceptedByUserId,
      acceptedByUserName,
      acceptedByEmail: user?.email || dataBaseUser?.email || "",
      updatedAt: serverTimestamp(),
      ...(autoAssign ? {
        assignedTechnicianId: acceptedByUserId,
        assignedTechnicianName: acceptedByUserName,
        assignedAt: serverTimestamp(),
      } : {}),
    };

    try {
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOffers", offer.id), updates);
      if (autoAssign) {
        await updateRelatedServiceStopsForOffer({
          offer,
          assigneeId: acceptedByUserId,
          assigneeName: acceptedByUserName,
          incentive: normalizeWorkOfferIncentive(offer),
        });
      }
      setOffers((current) => current.map((item) =>
        item.id === offer.id
          ? { ...item, ...updates, acceptedAt: new Date(), updatedAt: new Date() }
          : item
      ));
      toast.success(autoAssign ? "Work offer accepted and assigned." : "Work offer acceptance sent for approval.");
    } catch (error) {
      console.error("Failed to accept work offer:", error);
      toast.error("Could not accept that work offer.");
    }
  };

  const approveOffer = async (offer) => {
    if (!requirePermission(APPROVE_OFFERED_WORK_PERMISSION_ID, "approve offered work")) return;
    if (!recentlySelectedCompany || !offer?.id) return;

    const statusKey = normalizedWorkOfferStatusKey(offer.status);
    const approvingAcceptance = statusKey === "acceptance pending approval";
    const nextStatus = approvingAcceptance ? "Accepted" : approvedStatusForOffer(offer);
    const updates = {
      status: nextStatus,
      companyApprovalRequired: false,
      updatedAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
      approvedByUserId: user?.uid || "",
      approvedByUserName: name || user?.displayName || user?.email || "Company user",
      ...(approvingAcceptance ? {
        assignmentStatus: "Assigned",
        assignedTechnicianId: offer.acceptedByUserId || "",
        assignedTechnicianName: offer.acceptedByUserName || "",
        assignedAt: serverTimestamp(),
      } : {
        postedAt: getWorkOfferTypeText(offer) === "Internal Board" ? serverTimestamp() : offer.postedAt || null,
        sentAt: getWorkOfferTypeText(offer) === "Direct User" ? serverTimestamp() : offer.sentAt || null,
      }),
    };

    try {
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOffers", offer.id), updates);
      if (approvingAcceptance && offer.acceptedByUserId) {
        await updateRelatedServiceStopsForOffer({
          offer,
          assigneeId: offer.acceptedByUserId,
          assigneeName: offer.acceptedByUserName,
          incentive: normalizeWorkOfferIncentive(offer),
        });
      }
      setOffers((current) => current.map((item) =>
        item.id === offer.id
          ? { ...item, ...updates, updatedAt: new Date(), approvedAt: new Date() }
          : item
      ));
      toast.success(approvingAcceptance ? "Work offer assignment approved." : "Work offer approved.");
    } catch (error) {
      console.error("Failed to approve work offer:", error);
      toast.error("Could not approve that work offer.");
    }
  };

  const openIncentiveModal = (offer) => {
    if (!requirePermission(INCENTIVIZE_OFFERED_WORK_PERMISSION_ID, "add work offer incentives")) return;
    const incentive = normalizeWorkOfferIncentive(offer);
    setIncentiveOffer(offer);
    setIncentiveForm({
      type: incentive.type,
      amount: incentive.amountCents ? String((incentive.amountCents / 100).toFixed(2)) : "",
      percentage: incentive.percentage ? String(incentive.percentage) : "",
      notes: incentive.notes || "",
    });
  };

  const saveIncentive = async () => {
    if (!requirePermission(INCENTIVIZE_OFFERED_WORK_PERMISSION_ID, "add work offer incentives")) return;
    if (!recentlySelectedCompany || !incentiveOffer?.id) return;

    const basePayCents = getWorkOfferBasePayCents(incentiveOffer);
    const nextIncentive = normalizeWorkOfferIncentive({
      incentive: {
        type: incentiveForm.type,
        amountCents: centsFromDollars(incentiveForm.amount),
        percentage: Number(incentiveForm.percentage || 0),
        notes: incentiveForm.notes,
      },
    });
    const incentiveCents =
      nextIncentive.type === "flat"
        ? nextIncentive.amountCents
        : nextIncentive.type === "percentage"
          ? Math.round(basePayCents * (nextIncentive.percentage / 100))
          : 0;
    const effectiveIncentive = incentiveCents > 0 ? nextIncentive : normalizeWorkOfferIncentive();
    const estimatedTotal = basePayCents + incentiveCents;
    const updates = {
      incentive: effectiveIncentive,
      incentiveType: effectiveIncentive.type,
      incentiveAmountCents: effectiveIncentive.amountCents,
      incentivePercentage: effectiveIncentive.percentage,
      incentiveEstimatedCents: incentiveCents,
      estimatedBasePayCents: basePayCents,
      estimatedPayCents: estimatedTotal,
      estimatedPayTotalCents: estimatedTotal,
      estimatedPayWithIncentiveCents: estimatedTotal,
      updatedAt: serverTimestamp(),
      incentiveUpdatedAt: serverTimestamp(),
      incentiveUpdatedByUserId: user?.uid || "",
      incentiveUpdatedByName: name || user?.displayName || user?.email || "Company user",
    };

    setSavingIncentive(true);

    try {
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOffers", incentiveOffer.id), updates);
      if (companySettings.workOfferIncentivesCreatePayrollLines) {
        await updateRelatedServiceStopsForOffer({
          offer: { ...incentiveOffer, ...updates },
          incentive: effectiveIncentive,
        });
      }
      setOffers((current) => current.map((item) =>
        item.id === incentiveOffer.id ? { ...item, ...updates, updatedAt: new Date() } : item
      ));
      setIncentiveOffer(null);
      toast.success(incentiveCents > 0 ? "Incentive saved." : "Incentive removed.");
    } catch (error) {
      console.error("Failed to save incentive:", error);
      toast.error("Could not save the incentive.");
    } finally {
      setSavingIncentive(false);
    }
  };

  const openBoardModal = () => {
    if (!requirePermission(UPDATE_OFFERED_WORK_PERMISSION_ID, "manage work offer boards")) return;
    setBoardForm({ id: "", name: "", memberUserIds: [] });
    setBoardModalOpen(true);
  };

  const editBoard = (board) => {
    setBoardForm({
      id: board.id,
      name: board.name || "",
      memberUserIds: uniqueStrings(board.memberUserIds || []),
    });
  };

  const toggleBoardMember = (userId) => {
    setBoardForm((current) => {
      const ids = new Set(current.memberUserIds || []);
      if (ids.has(userId)) ids.delete(userId);
      else ids.add(userId);
      return { ...current, memberUserIds: [...ids] };
    });
  };

  const saveBoard = async () => {
    if (!requirePermission(UPDATE_OFFERED_WORK_PERMISSION_ID, "manage work offer boards")) return;
    if (!recentlySelectedCompany) return;
    if (!boardForm.name.trim()) {
      toast.error("Board name is required.");
      return;
    }

    const selectedMembers = companyUsers.filter((member) => boardForm.memberUserIds.includes(getCompanyUserId(member)));
    const boardId = boardForm.id || makeId("work_offer_board");
    const payload = {
      id: boardId,
      companyId: recentlySelectedCompany,
      name: boardForm.name.trim(),
      memberUserIds: selectedMembers.map(getCompanyUserId),
      memberCompanyUserDocIds: selectedMembers.map((member) => member.id).filter(Boolean),
      memberNames: selectedMembers.map(getCompanyUserName),
      updatedAt: serverTimestamp(),
      updatedByUserId: user?.uid || "",
      updatedByName: name || user?.displayName || user?.email || "Company user",
      ...(!boardForm.id ? {
        createdAt: serverTimestamp(),
        createdByUserId: user?.uid || "",
        createdByName: name || user?.displayName || user?.email || "Company user",
      } : {}),
    };

    setSavingBoard(true);

    try {
      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOfferBoards", boardId), payload, { merge: true });
      setBoards((current) => {
        const nextBoards = [normalizeBoard(payload), ...current.filter((board) => board.id !== boardId)];
        return nextBoards.sort((a, b) => a.name.localeCompare(b.name));
      });
      setBoardForm({ id: "", name: "", memberUserIds: [] });
      toast.success("Work offer board saved.");
    } catch (error) {
      console.error("Failed to save work offer board:", error);
      toast.error("Could not save work offer board.");
    } finally {
      setSavingBoard(false);
    }
  };

  const canOfferSelectedCategory = (category) => {
    if (canManageOffers && companySettings.managementCanOfferAnyWork) return true;
    if (category === "fullRoute") return companySettings.technicianCanOfferFullRoutes;
    if (category === "partialRoute") return companySettings.technicianCanOfferPartialRoutes && canSplitOffers;
    if (category === "oneOffJob") return companySettings.technicianCanOfferOneOffJobs;
    if (category === "recurringWork") return companySettings.technicianCanOfferRecurringWork;
    return false;
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company operations</p>
              <h1 className="mt-1 text-3xl font-bold text-slate-950">Offered Work</h1>
              <p className="mt-1 text-sm text-slate-500">
                Route coverage, partial routes, direct offers, board posts, incentives, and accepted work.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/company/settings/company-wide"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <FiSettings className="h-4 w-4" />
                Settings
              </Link>
              {canManageOffers && (
                <button
                  type="button"
                  onClick={openBoardModal}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <FiUsers className="h-4 w-4" />
                  Boards
                </button>
              )}
              <button
                type="button"
                onClick={loadOffers}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <FiRefreshCw className="h-4 w-4" />
                Refresh
              </button>
              {canCreateOffers && (
                <button
                  type="button"
                  onClick={openCreateOfferModal}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                >
                  <FiPlus className="h-4 w-4" />
                  Offer Work
                </button>
              )}
            </div>
          </div>

          {permissionsReady && !canViewAllOffers && (
            <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
              Showing direct offers, your route offers, and board posts from boards you belong to.
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryTile icon={FiClock} label="Open Offers" value={summary.open} detail={`${summary.board} board posts included`} tone="amber" />
          <SummaryTile icon={FiCalendar} label="Ready to Schedule" value={summary.ready} detail={`${summary.accepted} accepted total`} tone="green" />
          <SummaryTile icon={FiCheckCircle} label="Scheduled" value={summary.scheduled} detail={`${summary.selfSchedule} can self-schedule`} tone="blue" />
          <SummaryTile icon={FiGift} label="Incentives" value={moneyFromCents(summary.incentives)} detail="Added to offer pay" tone="green" />
          <SummaryTile icon={FiDollarSign} label="Estimated Pay" value={moneyFromCents(summary.estimatedPayCents)} detail={`${summary.total} visible offers`} tone="violet" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-1 gap-3 p-5 xl:grid-cols-[minmax(260px,1fr)_repeat(6,minmax(145px,170px))]">
            <label className="relative block">
              <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search offered work..."
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="relative block">
              <FiFilter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {WORK_OFFER_STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {WORK_OFFER_CATEGORY_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {WORK_OFFER_TYPE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={boardFilter}
              onChange={(event) => setBoardFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {boardOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={technicianFilter}
              onChange={(event) => setTechnicianFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {technicianOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={schedulingFilter}
              onChange={(event) => setSchedulingFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All Scheduling</option>
              <option value="self">Tech Can Schedule</option>
              <option value="admin">Admin Schedules</option>
              <option value="scheduled">Scheduled</option>
              <option value="unscheduled">Unscheduled</option>
            </select>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>Showing {filteredOffers.length} of {visibleOffers.length} visible offer{visibleOffers.length === 1 ? "" : "s"}</div>
            <div>{statusFilter === "all" ? "All statuses" : statusFilter} - {categoryFilter === "all" ? "All work" : categoryFilter}</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm font-medium text-slate-500">Loading offered work...</div>
          ) : filteredOffers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">No offered work found.</p>
              <p className="mt-1 text-sm text-slate-500">Adjust the search or filters to see more offers.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Work</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Audience</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Source</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Scope</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Pay</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Created</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredOffers.map((offer) => {
                    const targetText = getWorkOfferTargetText(offer);
                    const typeText = getWorkOfferTypeText(offer);
                    const status = normalizeWorkOfferStatus(offer.status);
                    const statusKey = normalizedWorkOfferStatusKey(status);
                    const jobPath = offer.jobId ? `/company/jobs/detail/${offer.jobId}` : "/company/jobs/operations";
                    const basePayCents = getWorkOfferBasePayCents(offer);
                    const incentiveCents = getWorkOfferIncentiveCents(offer);
                    const totalPayCents = getWorkOfferEstimatedPayCents(offer);
                    const showAccept = canAcceptOffers && isOpenWorkOffer(offer) && statusKey !== "pending approval";
                    const showApprove = canApproveOffers && ["pending approval", "acceptance pending approval"].includes(statusKey);

                    return (
                      <tr key={offer.id} className="align-top transition hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="max-w-sm">
                            <p className="font-semibold text-slate-950">
                              {offer.title || offer.name || offer.serviceStopTypeName || "Offered Work"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {[offer.jobInternalId || offer.jobName || offer.jobId, getWorkOfferCategoryText(offer)].filter(Boolean).join(" - ") || "No job reference"}
                            </p>
                            {(offer.proposedStartDate || offer.routeDate) && (
                              <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                                <FiCalendar className="h-3.5 w-3.5" />
                                {formatDateTime(offer.proposedStartDate || offer.routeDate)}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClasses(status)}`}>
                            {status}
                          </span>
                          {isAcceptedReadyToScheduleWorkOffer(offer) && (
                            <span className="mt-2 block text-xs font-semibold text-emerald-700">Ready</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-start gap-2 text-sm text-slate-700">
                            <FiUser className="mt-0.5 h-4 w-4 text-slate-400" />
                            <div>
                              <p className="font-semibold">{targetText}</p>
                              <p className="text-xs text-slate-500">
                                {typeText === "Internal Board" ? offerBoardNames(offer).join(", ") || "Board post" : typeText}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-sm font-semibold text-slate-800">{offer.routeName || offer.jobName || offer.customerName || "-"}</p>
                          <p className="mt-1 text-xs text-slate-500">{offer.routeTechName || offer.serviceLocationName || offer.address?.streetAddress || "-"}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-sm font-semibold text-slate-800">
                            {offer.stopCount || offerServiceStopIds(offer).length || getWorkOfferTaskCount(offer)} item{(offer.stopCount || offerServiceStopIds(offer).length || getWorkOfferTaskCount(offer)) === 1 ? "" : "s"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{formatDurationMinutes(offer.estimatedMinutes)}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-sm font-semibold text-slate-800">{moneyFromCents(totalPayCents)}</p>
                          {incentiveCents > 0 ? (
                            <p className="mt-1 text-xs font-semibold text-emerald-700">
                              {getWorkOfferIncentiveText(offer)} on {moneyFromCents(basePayCents)}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-slate-500">{offer.paySource || "Pay snapshot"}</p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600">{formatDate(offer.createdAt)}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex flex-col items-end gap-2">
                            {showApprove && (
                              <button
                                type="button"
                                onClick={() => approveOffer(offer)}
                                className="inline-flex items-center justify-end gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                              >
                                Approve
                                <FiCheckCircle className="h-4 w-4" />
                              </button>
                            )}
                            {showAccept && (
                              <button
                                type="button"
                                onClick={() => acceptOffer(offer)}
                                className="inline-flex items-center justify-end gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                              >
                                Accept
                                <FiCheckCircle className="h-4 w-4" />
                              </button>
                            )}
                            {canAddIncentives && (
                              <button
                                type="button"
                                onClick={() => openIncentiveModal(offer)}
                                className="inline-flex items-center justify-end gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Incentive
                                <FiGift className="h-4 w-4" />
                              </button>
                            )}
                            <Link
                              to={jobPath}
                              className="inline-flex items-center justify-end gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              Open
                              <FiArrowUpRight className="h-4 w-4" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {offerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Offer Work</h2>
                <p className="mt-1 text-sm text-slate-500">Post route coverage, route stops, or one-off job work.</p>
              </div>
              <button
                type="button"
                onClick={closeCreateOfferModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close offer work modal"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Work Type</span>
                  <select
                    value={offerForm.workOfferCategory}
                    onChange={(event) => updateOfferForm("workOfferCategory", event.target.value)}
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    {WORK_OFFER_CATEGORY_FILTERS.filter((item) => item.value !== "all").map((item) => (
                      <option key={item.value} value={item.value} disabled={!canOfferSelectedCategory(item.value)}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Offer To</span>
                  <select
                    value={offerForm.offerType}
                    onChange={(event) => updateOfferForm("offerType", event.target.value)}
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="Internal Board">Work Offer Board</option>
                    <option value="Direct User">Direct Technician</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Estimated Minutes</span>
                  <input
                    type="number"
                    min="0"
                    value={offerForm.estimatedMinutes}
                    onChange={(event) => updateOfferForm("estimatedMinutes", event.target.value)}
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>

              {["fullRoute", "partialRoute"].includes(offerForm.workOfferCategory) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">Route Date</span>
                      <input
                        type="date"
                        value={offerForm.routeDate}
                        onChange={(event) => updateOfferForm("routeDate", event.target.value)}
                        className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                      />
                    </label>

                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">Route Owner</span>
                      <select
                        value={offerForm.routeTechId}
                        onChange={(event) => updateOfferForm("routeTechId", event.target.value)}
                        disabled={!canManageOffers}
                        className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                      >
                        {companyUsers.map((tech) => (
                          <option key={getCompanyUserId(tech)} value={getCompanyUserId(tech)}>
                            {getCompanyUserName(tech)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">Route</span>
                      <select
                        value={offerForm.routeId}
                        onChange={(event) => updateOfferForm("routeId", event.target.value)}
                        className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                      >
                        <option value="">{creationLoading ? "Loading routes..." : "Select route"}</option>
                        {routeOptions
                          .filter((option) => !offerForm.routeTechId || option.route.techId === offerForm.routeTechId || option.route.userId === offerForm.routeTechId)
                          .map((option) => (
                            <option key={`${option.source}:${option.id}`} value={`${option.source}:${option.id}`}>
                              {option.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>

                  {offerForm.workOfferCategory === "partialRoute" && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-700">Route Stops</p>
                        <button
                          type="button"
                          onClick={() => updateOfferForm("selectedStopIds", offerForm.selectedStopIds.length === selectedRouteStopIds.length ? [] : selectedRouteStopIds)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {offerForm.selectedStopIds.length === selectedRouteStopIds.length ? "Clear" : "Select All"}
                        </button>
                      </div>
                      <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
                        {selectedRouteStops.length === 0 ? (
                          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                            No service stops found for this route date.
                          </p>
                        ) : selectedRouteStops.map((stop) => {
                          const checked = offerForm.selectedStopIds.includes(stop.id);
                          return (
                            <label key={stop.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm hover:bg-blue-50">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleRouteStop(stop.id)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                              />
                              <span>
                                <span className="block font-semibold text-slate-800">{serviceStopLabel(stop)}</span>
                                <span className="mt-1 block text-xs text-slate-500">{formatDateTime(stop.serviceDate)}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {offerForm.workOfferCategory === "oneOffJob" && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Job</span>
                    <select
                      value={offerForm.jobId}
                      onChange={(event) => updateOfferForm("jobId", event.target.value)}
                      className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="">No linked job</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {[job.internalId, job.customerName, job.description || job.type].filter(Boolean).join(" - ") || job.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {offerForm.offerType === "Internal Board" ? (
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Boards</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {boards.length === 0 ? (
                        <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                          Create a work offer board before posting to a board.
                        </p>
                      ) : boards.map((board) => {
                        const checked = offerForm.boardIds.includes(board.id);
                        return (
                          <label key={board.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm hover:bg-blue-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOfferBoard(board.id)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                            <span>
                              <span className="block font-semibold text-slate-800">{board.name}</span>
                              <span className="mt-1 block text-xs text-slate-500">{board.memberNames.length} member{board.memberNames.length === 1 ? "" : "s"}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Technician</span>
                    <select
                      value={offerForm.directUserId}
                      onChange={(event) => updateOfferForm("directUserId", event.target.value)}
                      className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="">Select technician</option>
                      {companyUsers.map((tech) => (
                        <option key={getCompanyUserId(tech)} value={getCompanyUserId(tech)}>
                          {getCompanyUserName(tech)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Title</span>
                  <input
                    value={offerForm.title}
                    onChange={(event) => updateOfferForm("title", event.target.value)}
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                    placeholder="Route coverage, one-off work, or job title"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Base Pay</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={offerForm.basePayAmount}
                    onChange={(event) => updateOfferForm("basePayAmount", event.target.value)}
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>

                {canAddIncentives && (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Incentive</span>
                    <select
                      value={offerForm.incentiveType}
                      onChange={(event) => updateOfferForm("incentiveType", event.target.value)}
                      className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      {WORK_OFFER_INCENTIVE_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {canAddIncentives && offerForm.incentiveType === "flat" && (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Incentive Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={offerForm.incentiveAmount}
                      onChange={(event) => updateOfferForm("incentiveAmount", event.target.value)}
                      className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                    />
                  </label>
                )}

                {canAddIncentives && offerForm.incentiveType === "percentage" && (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Incentive Percent</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={offerForm.incentivePercentage}
                      onChange={(event) => updateOfferForm("incentivePercentage", event.target.value)}
                      className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                    />
                  </label>
                )}
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Base Pay</p>
                    <p className="mt-1 font-bold text-emerald-950">{moneyFromCents(offerBasePayCents)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Incentive</p>
                    <p className="mt-1 font-bold text-emerald-950">{moneyFromCents(canAddIncentives ? offerIncentiveCents : 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Offer Total</p>
                    <p className="mt-1 font-bold text-emerald-950">{moneyFromCents(canAddIncentives ? offerEstimatedTotalCents : offerBasePayCents)}</p>
                  </div>
                </div>
                {canAddIncentives && offerForm.incentiveType !== "none" && (
                  <textarea
                    rows={2}
                    value={offerForm.incentiveNotes}
                    onChange={(event) => updateOfferForm("incentiveNotes", event.target.value)}
                    className="mt-3 w-full rounded-md border border-emerald-200 bg-white p-3 text-sm text-emerald-950"
                    placeholder="Incentive notes"
                  />
                )}
              </div>

              <div>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Notes</span>
                  <textarea
                    rows={3}
                    value={offerForm.notes}
                    onChange={(event) => updateOfferForm("notes", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm"
                  />
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <input
                  type="checkbox"
                  checked={offerForm.allowsTechnicianSelfScheduling}
                  onChange={(event) => updateOfferForm("allowsTechnicianSelfScheduling", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-sm font-semibold text-slate-700">Allow technician self-scheduling</span>
              </label>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeCreateOfferModal}
                disabled={savingOffer}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveOffer}
                disabled={savingOffer}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {savingOffer ? "Creating..." : "Create Offer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {boardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Work Offer Boards</h2>
                <p className="mt-1 text-sm text-slate-500">Boards control which technicians can see internal offers.</p>
              </div>
              <button
                type="button"
                onClick={() => setBoardModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100"
                aria-label="Close board manager"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-3">
                {boards.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    No work offer boards yet.
                  </div>
                ) : boards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    onClick={() => editBoard(board)}
                    className="flex w-full items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50"
                  >
                    <span>
                      <span className="block font-semibold text-slate-950">{board.name}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {board.memberNames.length ? board.memberNames.join(", ") : "No members"}
                      </span>
                    </span>
                    <FiEdit2 className="mt-1 h-4 w-4 text-slate-400" />
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Board Name</span>
                  <input
                    value={boardForm.name}
                    onChange={(event) => setBoardForm((current) => ({ ...current, name: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>

                <div className="mt-4">
                  <p className="text-sm font-semibold text-slate-700">Members</p>
                  <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                    {companyUsers.map((member) => {
                      const memberId = getCompanyUserId(member);
                      const checked = boardForm.memberUserIds.includes(memberId);
                      return (
                        <label key={memberId} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBoardMember(memberId)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                          <span>
                            <span className="block font-semibold text-slate-800">{getCompanyUserName(member)}</span>
                            <span className="mt-1 block text-xs text-slate-500">{getCompanyUserWorkerType(member)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBoardForm({ id: "", name: "", memberUserIds: [] })}
                    className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    New
                  </button>
                  <button
                    type="button"
                    onClick={saveBoard}
                    disabled={savingBoard}
                    className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {savingBoard ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {incentiveOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Offer Incentive</h2>
                <p className="mt-1 text-sm text-slate-500">{incentiveOffer.title || "Offered Work"}</p>
              </div>
              <button
                type="button"
                onClick={() => setIncentiveOffer(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100"
                aria-label="Close incentive editor"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Type</span>
                  <select
                    value={incentiveForm.type}
                    onChange={(event) => setIncentiveForm((current) => ({ ...current, type: event.target.value }))}
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    {WORK_OFFER_INCENTIVE_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {incentiveForm.type === "flat" && (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={incentiveForm.amount}
                      onChange={(event) => setIncentiveForm((current) => ({ ...current, amount: event.target.value }))}
                      className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                    />
                  </label>
                )}

                {incentiveForm.type === "percentage" && (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Percent</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={incentiveForm.percentage}
                      onChange={(event) => setIncentiveForm((current) => ({ ...current, percentage: event.target.value }))}
                      className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                    />
                  </label>
                )}
              </div>

              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-emerald-800">Base pay</span>
                  <span className="font-bold text-emerald-950">{moneyFromCents(getWorkOfferBasePayCents(incentiveOffer))}</span>
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Notes</span>
                <textarea
                  rows={3}
                  value={incentiveForm.notes}
                  onChange={(event) => setIncentiveForm((current) => ({ ...current, notes: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm"
                />
              </label>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setIncentiveOffer(null)}
                disabled={savingIncentive}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveIncentive}
                disabled={savingIncentive}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {savingIncentive ? "Saving..." : "Save Incentive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfferedWork;
