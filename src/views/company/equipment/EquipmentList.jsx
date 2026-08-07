import React, { useState, useEffect, useContext, useMemo } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { collection, doc, getDocs, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  EQUIPMENT_STATUS_OPTIONS,
  Equipment,
  displayEquipmentStatus,
  normalizeEquipmentStatus,
} from "../../../utils/models/Equipment";
import { addDays, addMonths, addWeeks, addYears, endOfToday, format, isBefore, isEqual } from "date-fns";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { EquipmentPart } from "../../../utils/models/EquipmentPart";
import { appAlert } from "../../../utils/appDialog";
import {
  AdjustmentsHorizontalIcon,
  BriefcaseIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { sortCompanyUsersByName } from "../../../utils/companyUsers";

const EMPTY_TOP_COUNTS = {
  all: 0,
  maintenance: 0,
  repair: 0,
  nonOperational: 0,
};

const DEFAULT_EQUIPMENT_FILTER = "maintenance";
const EQUIPMENT_FILTER_PATH_SEGMENTS = {
  all: "all-equipment",
  maintenance: "needs-maintenance",
  repair: "needs-repair",
  nonOperational: "non-operational",
};
const EQUIPMENT_FILTER_ALIASES = {
  all: "all",
  "all-equipment": "all",
  maintenance: "maintenance",
  "needs-maintenance": "maintenance",
  repair: "repair",
  "needs-repair": "repair",
  nonOperational: "nonOperational",
  "non-operational": "nonOperational",
};

const CUSTOM_CATALOG_VALUE = "__custom__";
const DEFAULT_MAINTENANCE_NAME = "Clean";
const inputBase =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";
const modalSecondaryButton =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50";
const modalPrimaryButton =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700";

const todayDateInputValue = () => format(new Date(), "yyyy-MM-dd");

const dateInputToLocalDate = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    {children}
  </div>
);

const ModalShell = ({ title, children, onClose, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
    <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">Make a quick update without leaving the list.</p>
        </div>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
          aria-label="Close"
          type="button"
        >
          x
        </button>
      </div>
      {children}
      {footer && <div className="mt-6">{footer}</div>}
    </div>
  </div>
);

const dateIsDue = (d) => {
  if (!d) return false;
  const dueThrough = endOfToday();
  return isBefore(d, dueThrough) || isEqual(d, dueThrough);
};

/**
 * Needs Maintenance filter rule:
 * Include an operational item if EITHER:
 * 1) status indicates maintenance
 * OR
 * 2) nextServiceDate is today or earlier
 */
const isNeedsMaintenance = (eq) => {
  if (!eq) return false;
  const status = normalizeEquipmentStatus(eq.status);
  if (status === "nonoperational") return false;

  const statusSaysMaintenance =
    status === "needsmaintenance" ||
    status === "maintenance" ||
    status === "needsservice";

  return statusSaysMaintenance || (eq.needsService === true && dateIsDue(eq.nextServiceDate));
};

const isNeedsRepair = (eq) => normalizeEquipmentStatus(eq?.status) === "needsrepair";
const isNonOperational = (eq) => normalizeEquipmentStatus(eq?.status) === "nonoperational";

const computeNextServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
  if (!lastServiceDate) return null;

  const amount = Number(serviceFrequency);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const base = new Date(lastServiceDate);
  if (Number.isNaN(base.getTime())) return null;

  if (serviceFrequencyEvery === "Day") return addDays(base, amount);
  if (serviceFrequencyEvery === "Week") return addWeeks(base, amount);
  if (serviceFrequencyEvery === "Month") return addMonths(base, amount);
  if (serviceFrequencyEvery === "Year") return addYears(base, amount);
  return null;
};

const sortableDateMillis = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();

  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isNaN(millis) ? null : millis;
};

const companyUserDisplayName = (user = {}) =>
  user.userName || user.name || user.fullName || user.displayName || user.email || "";

const companyUserRecordId = (user = {}) => user.userId || user.id || "";

const getEquipmentListMeta = (equipmentData = []) => ({
  types: [...new Set(equipmentData.map((item) => item.type))].filter(Boolean),
  topCounts: {
    all: equipmentData.length,
    maintenance: equipmentData.filter(isNeedsMaintenance).length,
    repair: equipmentData.filter(isNeedsRepair).length,
    nonOperational: equipmentData.filter(isNonOperational).length,
  },
});

const getQuickStatusOption = (status) => {
  const normalizedStatus = normalizeEquipmentStatus(status);
  if (!normalizedStatus) return "";
  if (normalizedStatus === "maintenance" || normalizedStatus === "needsservice") return "Needs Maintenance";
  return (
    EQUIPMENT_STATUS_OPTIONS.find(
      (statusOption) => normalizeEquipmentStatus(statusOption) === normalizedStatus
    ) || ""
  );
};

const getEquipmentFilterFromTab = (tabValue) =>
  EQUIPMENT_FILTER_ALIASES[tabValue] || DEFAULT_EQUIPMENT_FILTER;

const getEquipmentFilterPath = (filter) =>
  EQUIPMENT_FILTER_PATH_SEGMENTS[filter] || EQUIPMENT_FILTER_PATH_SEGMENTS[DEFAULT_EQUIPMENT_FILTER];

const TopFilterButton = ({ label, count, active, onClick }) => (
  <button
    onClick={onClick}
    type="button"
    className={[
      "flex items-center justify-between gap-3 w-full sm:w-auto",
      "rounded-md border px-4 py-2 text-sm font-bold shadow-sm transition",
      active
        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50",
    ].join(" ")}
  >
    <span>{label}</span>
    <span
      className={[
        "min-w-[34px] text-center px-2 py-0.5 rounded-full text-xs font-bold",
        active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700",
      ].join(" ")}
    >
      {count}
    </span>
  </button>
);

const QuickActionMenuItem = ({ label, icon: Icon, tone = "black", onClick }) => {
  const toneClasses =
    tone === "amber"
      ? "text-amber-700 hover:bg-amber-50"
    : tone === "green"
        ? "text-emerald-700 hover:bg-emerald-50"
        : "text-slate-900 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition ${toneClasses}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
};

const EquipmentDetailLink = ({ equipment, children }) => (
  <Link
    to={`/company/equipment/detail/${equipment.id}`}
    className="font-semibold text-slate-900 hover:text-blue-900 hover:underline"
  >
    {children || "—"}
  </Link>
);

export default function EquipmentList() {
  const navigate = useNavigate();
  const { tab } = useParams();
  const { recentlySelectedCompany } = useContext(Context);
  const { can } = useCompanyPermissions();

  const [equipmentList, setEquipmentList] = useState([]);
  const [filteredEquipmentList, setFilteredEquipmentList] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // ✅ NEW: routine maintenance filter (needsService)
  // "" | "true" | "false"
  const [needsServiceFilter, setNeedsServiceFilter] = useState("");

  const [sortBy, setSortBy] = useState("nextServiceDate");
  const [sortOrder, setSortOrder] = useState("asc");

  const [types, setTypes] = useState([]);
  const [topCounts, setTopCounts] = useState(EMPTY_TOP_COUNTS);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [equipmentError, setEquipmentError] = useState("");

  // all | maintenance | repair | nonOperational
  const [topFilter, setTopFilter] = useState(() => getEquipmentFilterFromTab(tab));
  const [openActionMenuId, setOpenActionMenuId] = useState("");
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const [activeQuickModal, setActiveQuickModal] = useState("");
  const [selectedQuickEquipment, setSelectedQuickEquipment] = useState(null);

  const [companyUsers, setCompanyUsers] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [equipmentMakes, setEquipmentMakes] = useState([]);
  const [equipmentModels, setEquipmentModels] = useState([]);
  const [catalogTypeId, setCatalogTypeId] = useState(CUSTOM_CATALOG_VALUE);
  const [catalogMakeId, setCatalogMakeId] = useState(CUSTOM_CATALOG_VALUE);
  const [catalogEquipmentId, setCatalogEquipmentId] = useState(CUSTOM_CATALOG_VALUE);
  const [quickName, setQuickName] = useState("");
  const [quickType, setQuickType] = useState("");
  const [quickTypeId, setQuickTypeId] = useState("");
  const [quickMake, setQuickMake] = useState("");
  const [quickMakeId, setQuickMakeId] = useState("");
  const [quickModel, setQuickModel] = useState("");
  const [quickModelId, setQuickModelId] = useState("");
  const [quickUniversalEquipmentId, setQuickUniversalEquipmentId] = useState("");
  const [quickManualPdfLink, setQuickManualPdfLink] = useState("");
  const [quickNotes, setQuickNotes] = useState("");
  const [quickStatus, setQuickStatus] = useState("");

  const [maintenanceName, setMaintenanceName] = useState(DEFAULT_MAINTENANCE_NAME);
  const [maintenanceDate, setMaintenanceDate] = useState(todayDateInputValue);
  const [maintenancePerformedBy, setMaintenancePerformedBy] = useState("Company");
  const [maintenanceCompanyUserId, setMaintenanceCompanyUserId] = useState("");
  const [maintenanceCustomerName, setMaintenanceCustomerName] = useState("");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");

  const [repairName, setRepairName] = useState("");
  const [repairDate, setRepairDate] = useState(todayDateInputValue);
  const [repairPerformedBy, setRepairPerformedBy] = useState("Company");
  const [repairCompanyUserId, setRepairCompanyUserId] = useState("");
  const [repairCustomerName, setRepairCustomerName] = useState("");
  const [repairPartsReplaced, setRepairPartsReplaced] = useState([]);
  const [currentPart, setCurrentPart] = useState("");
  const [repairNotes, setRepairNotes] = useState("");

  useEffect(() => {
    const nextFilter = getEquipmentFilterFromTab(tab);
    const canonicalTab = getEquipmentFilterPath(nextFilter);

    setTopFilter(nextFilter);

    if (tab !== canonicalTab) {
      navigate(`/company/equipment/${canonicalTab}`, { replace: true });
    }
  }, [tab, navigate]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setCompanyUsers([]);
      return;
    }

    let cancelled = false;

    const fetchCompanyUsers = async () => {
      try {
        const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
        const snap = await getDocs(query(usersRef, orderBy("userName", "asc")));
        const data = sortCompanyUsersByName(snap.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() })));

        if (!cancelled) {
          setCompanyUsers(data);
          if (data.length) {
            setMaintenanceCompanyUserId((current) => current || data[0].id);
            setRepairCompanyUserId((current) => current || data[0].id);
          }
        }
      } catch (error) {
        console.error("Error loading company users:", error);
        if (!cancelled) setCompanyUsers([]);
      }
    };

    fetchCompanyUsers();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    let cancelled = false;

    const fetchEquipmentTypes = async () => {
      try {
        const typesSnap = await getDocs(
          query(collection(db, "universal", "equipment", "equipmentTypes"), orderBy("name", "asc"))
        );
        if (!cancelled) {
          setEquipmentTypes(typesSnap.docs.map((typeDoc) => ({ id: typeDoc.id, ...typeDoc.data() })));
        }
      } catch (error) {
        console.error("Error loading universal equipment types:", error);
        if (!cancelled) setEquipmentTypes([]);
      }
    };

    fetchEquipmentTypes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!catalogTypeId || catalogTypeId === CUSTOM_CATALOG_VALUE) {
      setEquipmentMakes([]);
      return;
    }

    let cancelled = false;

    const fetchEquipmentMakes = async () => {
      try {
        const makesSnap = await getDocs(
          query(
            collection(db, "universal", "equipment", "equipmentMakes"),
            where("types", "array-contains", catalogTypeId)
          )
        );
        if (!cancelled) {
          setEquipmentMakes(makesSnap.docs.map((makeDoc) => ({ id: makeDoc.id, ...makeDoc.data() })));
        }
      } catch (error) {
        console.error("Error loading universal equipment makes:", error);
        if (!cancelled) setEquipmentMakes([]);
      }
    };

    fetchEquipmentMakes();

    return () => {
      cancelled = true;
    };
  }, [catalogTypeId]);

  useEffect(() => {
    if (
      !catalogTypeId ||
      catalogTypeId === CUSTOM_CATALOG_VALUE ||
      !catalogMakeId ||
      catalogMakeId === CUSTOM_CATALOG_VALUE
    ) {
      setEquipmentModels([]);
      return;
    }

    let cancelled = false;

    const fetchEquipmentModels = async () => {
      try {
        const modelsSnap = await getDocs(
          query(
            collection(db, "universal", "equipment", "equipment"),
            where("typeId", "==", catalogTypeId),
            where("makeId", "==", catalogMakeId)
          )
        );
        if (!cancelled) {
          setEquipmentModels(modelsSnap.docs.map((modelDoc) => ({ id: modelDoc.id, ...modelDoc.data() })));
        }
      } catch (error) {
        console.error("Error loading universal equipment models:", error);
        if (!cancelled) setEquipmentModels([]);
      }
    };

    fetchEquipmentModels();

    return () => {
      cancelled = true;
    };
  }, [catalogMakeId, catalogTypeId]);

  useEffect(() => {
    let cancelled = false;

    const fetchEquipment = async () => {
      if (!recentlySelectedCompany) {
        setEquipmentList([]);
        setTypes([]);
        setTopCounts(EMPTY_TOP_COUNTS);
        setEquipmentError("");
        setLoadingEquipment(false);
        return;
      }

      try {
        setLoadingEquipment(true);
        setEquipmentError("");

        const equipmentSnap = await getDocs(
          query(
            collection(db, "companies", recentlySelectedCompany, "equipment"),
            where("isActive", "==", true)
          )
        );
        const equipmentData = equipmentSnap.docs.map((equipmentDoc) => Equipment.fromFirestore(equipmentDoc));

        if (cancelled) return;

        setEquipmentList(equipmentData);
      } catch (error) {
        console.error("Equipment Data Error!:", error);
        if (!cancelled) {
          setEquipmentError("Could not load equipment for the selected view.");
          setEquipmentList([]);
          setTypes([]);
          setTopCounts(EMPTY_TOP_COUNTS);
        }
      } finally {
        if (!cancelled) {
          setLoadingEquipment(false);
        }
      }
    };

    fetchEquipment();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    const { types: uniqueTypes, topCounts: nextTopCounts } = getEquipmentListMeta(equipmentList);
    setTypes(uniqueTypes);
    setTopCounts(nextTopCounts);
  }, [equipmentList]);

  // -----------------------------
  // ✅ Unique customer count
  // -----------------------------
  const uniqueCustomerCount = useMemo(() => {
    const ids = new Set(
      (equipmentList || [])
        .map((e) => (e?.customerId ?? "").toString().trim())
        .filter(Boolean)
    );
    return ids.size;
  }, [equipmentList]);

  const maintenanceDueCount = topCounts.maintenance;

  useEffect(() => {
    let filtered = [...equipmentList];

    // Top filter
    if (topFilter === "maintenance") {
      filtered = filtered.filter(isNeedsMaintenance);
    } else if (topFilter === "repair") {
      filtered = filtered.filter(isNeedsRepair);
    } else if (topFilter === "nonOperational") {
      filtered = filtered.filter(isNonOperational);
    }

    // Search
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter((item) =>
        ["customerName", "type", "make", "model", "notes", "status"].some(
          (field) => item?.[field] && item[field].toString().toLowerCase().includes(s)
        )
      );
    }

    // Type dropdown
    if (typeFilter) {
      filtered = filtered.filter((item) => item?.type === typeFilter);
    }

    // ✅ NEW: Needs Service filter
    // "" => all
    // "true" => only eq.needsService === true
    // "false" => only eq.needsService === false
    if (needsServiceFilter === "true") {
      filtered = filtered.filter((item) => item?.needsService === true);
    } else if (needsServiceFilter === "false") {
      filtered = filtered.filter((item) => item?.needsService === false);
    }

    // Sort
    filtered.sort((a, b) => {
      const fieldA = a?.[sortBy];
      const fieldB = b?.[sortBy];

      // Dates
      if (sortBy === "nextServiceDate" || fieldA instanceof Date || fieldB instanceof Date) {
        const timeA = sortableDateMillis(fieldA);
        const timeB = sortableDateMillis(fieldB);

        if (timeA === null && timeB === null) return 0;
        if (timeA === null) return 1;
        if (timeB === null) return -1;

        const comparison = timeA - timeB;
        return sortOrder === "desc" ? comparison * -1 : comparison;
      }

      // Strings
      if (typeof fieldA === "string" && typeof fieldB === "string") {
        const comparison = fieldA.localeCompare(fieldB);
        return sortOrder === "desc" ? comparison * -1 : comparison;
      }

      // Fallback
      let comparison = 0;
      if (fieldA > fieldB) comparison = 1;
      else if (fieldA < fieldB) comparison = -1;
      return sortOrder === "desc" ? comparison * -1 : comparison;
    });

    setFilteredEquipmentList(filtered);
  }, [equipmentList, searchTerm, typeFilter, needsServiceFilter, sortBy, sortOrder, topFilter]);

  const handleSort = (field) => {
    const order = sortBy === field && sortOrder === "asc" ? "desc" : "asc";
    setSortBy(field);
    setSortOrder(order);
  };

  const handleTopFilterChange = (filter) => {
    setTopFilter(filter);
    navigate(`/company/equipment/${getEquipmentFilterPath(filter)}`);

    if (filter === "maintenance") {
      setSortBy("nextServiceDate");
      setSortOrder("asc");
    }
  };

  const getStatusClass = (status, maintenanceFlag) => {
    const s = normalizeEquipmentStatus(status);
    if (maintenanceFlag) return "bg-amber-50 text-amber-700";
    if (s === "needsmaintenance" || s === "maintenance" || s === "needsservice") return "bg-amber-50 text-amber-700";
    if (s === "needsrepair") return "bg-orange-50 text-orange-700";
    if (s === "nonoperational") return "bg-red-50 text-red-700";
    return "bg-slate-100 text-slate-700";
  };

  const getEquipmentDisplayName = (equipment) =>
    [
      equipment?.name,
      equipment?.make,
      equipment?.model,
    ].filter(Boolean).join(" ") || equipment?.type || "Equipment";

  const buildEquipmentContext = (equipment, jobIntent = "") => ({
    jobIntent,
    equipmentId: equipment?.id || "",
    equipmentName: getEquipmentDisplayName(equipment),
    customerId: equipment?.customerId || "",
    customerName: equipment?.customerName || "",
    serviceLocationId: equipment?.serviceLocationId || "",
    bodyOfWaterId: equipment?.bodyOfWaterId || "",
    type: equipment?.type || "",
    make: equipment?.make || "",
    model: equipment?.model || "",
    name: equipment?.name || "",
  });

  const updateEquipmentInLists = (equipmentId, updates) => {
    const applyUpdates = (equipment) =>
      equipment.id === equipmentId ? { ...equipment, ...updates } : equipment;

    setEquipmentList((current) => current.map(applyUpdates));
    setFilteredEquipmentList((current) => current.map(applyUpdates));
  };

  const closeQuickModal = () => {
    setActiveQuickModal("");
    setSelectedQuickEquipment(null);
  };

  const openQuickModal = (equipment, modalName) => {
    closeQuickActions();
    setSelectedQuickEquipment(equipment);
    setActiveQuickModal(modalName);

    if (modalName === "makeModel") {
      setQuickName(equipment.name || "");
      setQuickType(equipment.type || "");
      setQuickTypeId(equipment.typeId || "");
      setQuickMake(equipment.make || "");
      setQuickMakeId(equipment.makeId || "");
      setQuickModel(equipment.model || "");
      setQuickModelId(equipment.modelId || "");
      setQuickUniversalEquipmentId(equipment.universalEquipmentId || equipment.modelId || "");
      setQuickManualPdfLink(equipment.manualPdfLink || "");
      setQuickNotes(equipment.notes || "");
      setCatalogTypeId(equipment.typeId || CUSTOM_CATALOG_VALUE);
      setCatalogMakeId(equipment.makeId || CUSTOM_CATALOG_VALUE);
      setCatalogEquipmentId(equipment.universalEquipmentId || equipment.modelId || CUSTOM_CATALOG_VALUE);
    }

    if (modalName === "notes") {
      setQuickNotes(equipment.notes || "");
    }

    if (modalName === "status") {
      setQuickStatus(getQuickStatusOption(equipment.status));
    }

    if (modalName === "maintenance") {
      setMaintenanceName(DEFAULT_MAINTENANCE_NAME);
      setMaintenanceDate(todayDateInputValue());
      setMaintenancePerformedBy("Company");
      setMaintenanceCompanyUserId(companyUsers?.[0]?.id || "");
      setMaintenanceCustomerName(equipment.customerName || "");
      setMaintenanceNotes("");
    }

    if (modalName === "repair") {
      setRepairName("");
      setRepairDate(todayDateInputValue());
      setRepairPerformedBy("Company");
      setRepairCompanyUserId(companyUsers?.[0]?.id || "");
      setRepairCustomerName("");
      setRepairPartsReplaced([]);
      setCurrentPart("");
      setRepairNotes("");
    }
  };

  const createEquipmentJob = (equipment, jobIntent) => {
    navigate("/company/jobs/createNew", {
      state: {
        equipmentContext: buildEquipmentContext(equipment, jobIntent),
        jobIntent,
      },
    });
  };

  const handleCatalogTypeChange = (value) => {
    setCatalogTypeId(value);
    setCatalogMakeId(CUSTOM_CATALOG_VALUE);
    setCatalogEquipmentId(CUSTOM_CATALOG_VALUE);
    setEquipmentModels([]);
    setQuickMakeId("");
    setQuickModelId("");
    setQuickUniversalEquipmentId("");
    setQuickManualPdfLink("");

    if (value === CUSTOM_CATALOG_VALUE) {
      setQuickTypeId("");
      return;
    }

    const selected = equipmentTypes.find((item) => item.id === value);
    setQuickTypeId(selected?.id || "");
    setQuickType(selected?.name || "");
    setQuickMake("");
    setQuickModel("");
  };

  const handleCatalogMakeChange = (value) => {
    setCatalogMakeId(value);
    setCatalogEquipmentId(CUSTOM_CATALOG_VALUE);
    setQuickModelId("");
    setQuickUniversalEquipmentId("");
    setQuickManualPdfLink("");

    if (value === CUSTOM_CATALOG_VALUE) {
      setQuickMakeId("");
      return;
    }

    const selected = equipmentMakes.find((item) => item.id === value);
    setQuickMakeId(selected?.id || "");
    setQuickMake(selected?.name || "");
    setQuickModel("");
  };

  const handleCatalogEquipmentChange = (value) => {
    setCatalogEquipmentId(value);

    if (value === CUSTOM_CATALOG_VALUE) {
      setQuickModelId("");
      setQuickUniversalEquipmentId("");
      setQuickManualPdfLink("");
      return;
    }

    const selected = equipmentModels.find((item) => item.id === value);
    setQuickModel(selected?.model || selected?.name || "");
    setQuickModelId(selected?.id || "");
    setQuickUniversalEquipmentId(selected?.id || "");
    setQuickManualPdfLink(selected?.manualPdfLink || "");
    if (!quickName.trim()) setQuickName(selected?.name || selected?.model || "");
  };

  const handleSaveEquipment = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    const updates = {
      name: quickName,
      type: quickType,
      typeId: quickTypeId,
      make: quickMake,
      makeId: quickMakeId,
      model: quickModel,
      modelId: quickModelId,
      universalEquipmentId: quickUniversalEquipmentId,
      manualPdfLink: quickManualPdfLink,
      notes: quickNotes,
    };

    try {
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id),
        updates
      );
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Equipment updated");
    } catch (error) {
      console.error("Error updating equipment:", error);
      toast.error("Failed to update equipment");
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    const updates = { notes: quickNotes };

    try {
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id),
        updates
      );
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Notes updated");
    } catch (error) {
      console.error("Error updating equipment notes:", error);
      toast.error("Failed to update notes");
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    if (!quickStatus) {
      toast.error("Choose a status");
      return;
    }

    const updates = { status: quickStatus };

    try {
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id),
        updates
      );
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Status updated");
    } catch (error) {
      console.error("Error updating equipment status:", error);
      toast.error("Failed to update status");
    }
  };

  const handleCreateMaintenance = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    try {
      const maintenanceDateValue = dateInputToLocalDate(maintenanceDate);
      if (!maintenanceDateValue) {
        toast.error("Choose a maintenance date");
        return;
      }

      const equipmentRef = doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id);
      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(equipmentRef, "serviceHistory", serviceId);
      const selectedCompanyUser = companyUsers.find((user) => user.id === maintenanceCompanyUserId);
      const performedBy = maintenancePerformedBy;
      const techId = performedBy === "Company" ? companyUserRecordId(selectedCompanyUser) : "";
      const techName =
        performedBy === "Company"
          ? companyUserDisplayName(selectedCompanyUser)
          : (maintenanceCustomerName || "").trim();
      const nextServiceDate = computeNextServiceDate(
        maintenanceDateValue,
        selectedQuickEquipment.serviceFrequency,
        selectedQuickEquipment.serviceFrequencyEvery
      );

      await setDoc(serviceHistoryDoc, {
        id: serviceId,
        name: (maintenanceName || "").trim(),
        type: "Maintenance",
        date: maintenanceDateValue,
        performedBy,
        addedBy: "Manual",
        description: maintenanceNotes,
        techId,
        techName,
        jobId: "",
        partIds: [],
      });

      const updates = {
        lastServiceDate: maintenanceDateValue,
        nextServiceDate,
      };

      await updateDoc(equipmentRef, updates);
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Maintenance record saved");
    } catch (error) {
      console.error("Error creating maintenance history:", error);
      toast.error("Failed to create maintenance record");
    }
  };

  const handleMaintenancePerformedByChange = (value) => {
    setMaintenancePerformedBy(value);
    if (value === "Customer") {
      setMaintenanceCustomerName(selectedQuickEquipment?.customerName || "");
    }
  };

  const handleCreateRepair = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    try {
      const repairDateValue = dateInputToLocalDate(repairDate);
      if (!repairDateValue) {
        toast.error("Choose a repair date");
        return;
      }

      const equipmentRef = doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id);
      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(equipmentRef, "serviceHistory", serviceId);
      const partsRef = collection(equipmentRef, "parts");
      const partIds = [];

      for (const partName of repairPartsReplaced) {
        const cleanName = (partName || "").trim();
        if (!cleanName) continue;

        const partId = "com_equ_par_" + uuidv4();
        await setDoc(
          doc(partsRef, partId),
          EquipmentPart.toFirestore(
            new EquipmentPart({
              id: partId,
              name: cleanName,
              createdAt: new Date(),
            })
          )
        );
        partIds.push(partId);
      }

      const selectedCompanyUser = companyUsers.find((user) => user.id === repairCompanyUserId);
      const performedBy = repairPerformedBy;
      const techId = performedBy === "Company" ? companyUserRecordId(selectedCompanyUser) : "";
      const techName =
        performedBy === "Company" ? companyUserDisplayName(selectedCompanyUser) : (repairCustomerName || "").trim();

      await setDoc(serviceHistoryDoc, {
        id: serviceId,
        name: (repairName || "").trim(),
        type: "Repair",
        date: repairDateValue,
        performedBy,
        addedBy: "Manual",
        description: repairNotes,
        techId,
        techName,
        jobId: "",
        partIds,
      });

      closeQuickModal();
      toast.success("Repair record saved");
    } catch (error) {
      console.error("Error creating repair history:", error);
      toast.error("Failed to create repair record");
    }
  };

  const addPart = () => {
    const value = (currentPart || "").trim();
    if (!value) return;
    setRepairPartsReplaced((current) => [...current, value]);
    setCurrentPart("");
  };

  const removePart = (index) => {
    setRepairPartsReplaced((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const openActionEquipment = useMemo(
    () => filteredEquipmentList.find((equipment) => equipment.id === openActionMenuId) || null,
    [filteredEquipmentList, openActionMenuId]
  );

  const closeQuickActions = () => {
    setOpenActionMenuId("");
    setActionMenuPosition(null);
  };

  const toggleQuickActions = (equipmentId, event) => {
    if (openActionMenuId === equipmentId) {
      closeQuickActions();
      return;
    }

    const buttonRect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const left = Math.min(
      Math.max(8, buttonRect.right - menuWidth),
      window.innerWidth - menuWidth - 8
    );

    setOpenActionMenuId(equipmentId);
    setActionMenuPosition({
      top: buttonRect.bottom + 8,
      left,
    });
  };

  // -----------------------------
  // ✅ Excel download
  // -----------------------------
  const downloadExcel = () => {
    try {
      const rows = filteredEquipmentList.map((eq) => {
        const maintenanceFlag = isNeedsMaintenance(eq);

        return {
          Equipment: eq?.name || eq?.model || eq?.type || "Equipment",
          "Customer Name": eq?.customerName || "",
          Name: eq?.name || "",
          Make: eq?.make || "",
          Model: eq?.model || "",
          Type: eq?.type || "",
          Status: maintenanceFlag ? "Needs Maintenance" : displayEquipmentStatus(eq?.status || ""),
          "Needs Service (bool)": eq?.needsService ?? "",
          "Last Service Date": eq?.needsService && eq?.lastServiceDate ? format(eq.lastServiceDate, "yyyy-MM-dd") : "",
          "Next Service Date": eq?.needsService && eq?.nextServiceDate ? format(eq.nextServiceDate, "yyyy-MM-dd") : "",
          "Service Frequency": eq?.needsService ? eq?.serviceFrequency || "" : "",
          "Service Frequency Every": eq?.needsService ? eq?.serviceFrequencyEvery ?? "" : "",
          "Is Active": eq?.isActive ?? "",
          Notes: eq?.notes || "",
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Equipment");

      const fileName = `equipment_export_${format(new Date(), "yyyy-MM-dd_HH-mm")}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error("Excel export failed:", e);
      appAlert("Excel export failed. Check console for details.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company assets</p>
            <h2 className="mt-1 text-3xl font-bold text-slate-950">Equipment</h2>
            <p className="mt-1 text-sm text-slate-500">Track assets, service schedules, and operational status.</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                Customers shown: {uniqueCustomerCount}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                Equipment shown: {equipmentList.length}
              </span>
            </div>
          </div>

          {can("62") && (
            <Link
              to={"/company/equipment/createNew"}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create New
            </Link>
          )}
        </div>
        </section>

        {/* TOP FILTER BUTTONS */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TopFilterButton
            label="All Equipment"
            count={topCounts.all}
            active={topFilter === "all"}
            onClick={() => handleTopFilterChange("all")}
          />
          <TopFilterButton
            label="Needs Maintenance"
            count={topCounts.maintenance}
            active={topFilter === "maintenance"}
            onClick={() => handleTopFilterChange("maintenance")}
          />
          <TopFilterButton
            label="Needs Repair"
            count={topCounts.repair}
            active={topFilter === "repair"}
            onClick={() => handleTopFilterChange("repair")}
          />
          <TopFilterButton
            label="Non-Operational"
            count={topCounts.nonOperational}
            active={topFilter === "nonOperational"}
            onClick={() => handleTopFilterChange("nonOperational")}
          />
        </section>

        {maintenanceDueCount > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            <span className="font-bold">Maintenance Alert:</span> You have {maintenanceDueCount} item(s) needing maintenance (by status or due date).
          </div>
        )}

        {equipmentError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            {equipmentError}
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {/* Filters */}
          <div className="border-b border-slate-200 bg-white p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                onChange={(e) => setSearchTerm(e.target.value)}
                value={searchTerm}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 md:col-span-1"
                type="text"
                placeholder="Search customer, make, model, type, status, notes..."
              />

              <select
                onChange={(e) => setTypeFilter(e.target.value)}
                value={typeFilter}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All Types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              {/* ✅ Replaces the date box */}
              <select
                onChange={(e) => setNeedsServiceFilter(e.target.value)}
                value={needsServiceFilter}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Routine Service (All)</option>
                <option value="true">Routine Service: Yes</option>
                <option value="false">Routine Service: No</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>Showing {filteredEquipmentList.length} of {equipmentList.length} item{equipmentList.length === 1 ? "" : "s"}</div>
            <div>{topFilter === "all" ? "All equipment" : topFilter === "maintenance" ? "Needs maintenance" : topFilter === "repair" ? "Needs repair" : "Non-operational"} - {typeFilter || "All types"}</div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-slate-50">
                <tr>
                  {["customerName", "make", "model", "type", "nextServiceDate", "status"].map((field) => (
                    <th
                      key={field}
                      className="cursor-pointer select-none border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      onClick={() => handleSort(field)}
                    >
                      {field.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())}
                      {sortBy === field ? (sortOrder === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                  <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {loadingEquipment && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500">
                      Loading equipment...
                    </td>
                  </tr>
                )}

                {!loadingEquipment && filteredEquipmentList.map((equipment) => {
                  const maintenanceFlag = isNeedsMaintenance(equipment);
                  const actionMenuOpen = openActionMenuId === equipment.id;
                  const hasQuickActions = can("64") || can("22");

                  return (
                    <tr key={equipment.id} className="transition hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 text-sm">
                        <EquipmentDetailLink equipment={equipment}>
                          {equipment.customerName}
                        </EquipmentDetailLink>
                      </td>

                      <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                        <EquipmentDetailLink equipment={equipment}>
                          {equipment.make}
                        </EquipmentDetailLink>
                      </td>

                      <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                        <EquipmentDetailLink equipment={equipment}>
                          {equipment.model}
                        </EquipmentDetailLink>
                      </td>

                      <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                        {equipment.type}
                      </td>

                      <td
                        className={`whitespace-nowrap px-5 py-3 text-sm ${equipment.needsService && dateIsDue(equipment.nextServiceDate) ? "font-semibold text-red-600" : "text-slate-700"
                          }`}
                      >
                        {equipment.needsService && equipment.nextServiceDate ? format(equipment.nextServiceDate, "PP") : "—"}
                      </td>

                      <td className="whitespace-nowrap px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                            equipment.status,
                            maintenanceFlag
                          )}`}
                        >
                          {maintenanceFlag ? "Needs Maintenance" : displayEquipmentStatus(equipment.status)}
                        </span>
                      </td>

                      <td className="max-w-xs truncate whitespace-nowrap px-5 py-3 text-sm text-slate-700" title={equipment.notes}>
                        {equipment.notes}
                      </td>

                      <td className="relative min-w-[140px] px-5 py-3">
                        <div className="relative inline-flex">
                          <button
                            type="button"
                            disabled={!hasQuickActions}
                            onClick={(event) => toggleQuickActions(equipment.id, event)}
                            aria-haspopup="menu"
                            aria-expanded={actionMenuOpen}
                            aria-label="Open quick actions"
                            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <EllipsisVerticalIcon className="h-5 w-5" />
                            <span>Actions</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!loadingEquipment && filteredEquipmentList.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500">
                      No equipment found for the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {openActionEquipment && actionMenuPosition && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close quick actions"
              onClick={closeQuickActions}
            />
            <div
              role="menu"
              style={{
                top: actionMenuPosition.top,
                left: actionMenuPosition.left,
              }}
              className="fixed z-50 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-sm"
            >
              {can("64") && (
                <>
                  <QuickActionMenuItem
                    label="Edit Equipment"
                    icon={PencilSquareIcon}
                    onClick={() => openQuickModal(openActionEquipment, "makeModel")}
                  />
                  <QuickActionMenuItem
                    label="Edit Notes"
                    icon={DocumentTextIcon}
                    onClick={() => openQuickModal(openActionEquipment, "notes")}
                  />
                  <QuickActionMenuItem
                    label="Update Status"
                    icon={AdjustmentsHorizontalIcon}
                    onClick={() => openQuickModal(openActionEquipment, "status")}
                  />
                  <QuickActionMenuItem
                    label="Record Maintenance"
                    icon={WrenchScrewdriverIcon}
                    tone="green"
                    onClick={() => openQuickModal(openActionEquipment, "maintenance")}
                  />
                  <QuickActionMenuItem
                    label="Record Repair"
                    icon={WrenchScrewdriverIcon}
                    tone="amber"
                    onClick={() => openQuickModal(openActionEquipment, "repair")}
                  />
                </>
              )}
              {can("22") && (
                <>
                  <QuickActionMenuItem
                    label="Maintenance Job"
                    icon={BriefcaseIcon}
                    tone="green"
                    onClick={() => {
                      closeQuickActions();
                      createEquipmentJob(openActionEquipment, "maintenance");
                    }}
                  />
                  <QuickActionMenuItem
                    label="Repair Job"
                    icon={BriefcaseIcon}
                    tone="amber"
                    onClick={() => {
                      closeQuickActions();
                      createEquipmentJob(openActionEquipment, "repair");
                    }}
                  />
                </>
              )}
            </div>
          </>
        )}

        {activeQuickModal === "makeModel" && selectedQuickEquipment && (
          <ModalShell
            title="Edit Equipment"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEquipment}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Save
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <Field label="Equipment">
                <input
                  value={quickName}
                  onChange={(event) => setQuickName(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Catalog Type">
                <select
                  value={catalogTypeId}
                  onChange={(event) => handleCatalogTypeChange(event.target.value)}
                  className={inputBase}
                >
                  <option value={CUSTOM_CATALOG_VALUE}>Custom Type</option>
                  {equipmentTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>

              {catalogTypeId === CUSTOM_CATALOG_VALUE && (
                <Field label="Custom Type">
                  <input
                    value={quickType}
                    onChange={(event) => {
                      setQuickType(event.target.value);
                      setQuickTypeId("");
                    }}
                    className={inputBase}
                  />
                </Field>
              )}

              <Field label="Make">
                <select
                  value={catalogMakeId}
                  onChange={(event) => handleCatalogMakeChange(event.target.value)}
                  className={inputBase}
                  disabled={catalogTypeId !== CUSTOM_CATALOG_VALUE && !equipmentMakes.length}
                >
                  <option value={CUSTOM_CATALOG_VALUE}>Custom Make</option>
                  {equipmentMakes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {catalogMakeId === CUSTOM_CATALOG_VALUE && (
                  <input
                    value={quickMake}
                    onChange={(event) => {
                      setQuickMake(event.target.value);
                      setQuickMakeId("");
                    }}
                    className={`${inputBase} mt-2`}
                    placeholder="Custom Make"
                  />
                )}
              </Field>

              <Field label="Model">
                <select
                  value={catalogEquipmentId}
                  onChange={(event) => handleCatalogEquipmentChange(event.target.value)}
                  className={inputBase}
                  disabled={catalogMakeId !== CUSTOM_CATALOG_VALUE && !equipmentModels.length}
                >
                  <option value={CUSTOM_CATALOG_VALUE}>Custom Equipment</option>
                  {equipmentModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.model || item.name}
                    </option>
                  ))}
                </select>
                {catalogEquipmentId === CUSTOM_CATALOG_VALUE && (
                  <input
                    value={quickModel}
                    onChange={(event) => {
                      setQuickModel(event.target.value);
                      setQuickModelId("");
                      setQuickUniversalEquipmentId("");
                      setQuickManualPdfLink("");
                    }}
                    className={`${inputBase} mt-2`}
                    placeholder="Custom Model"
                  />
                )}
              </Field>

              {quickManualPdfLink && (
                <a
                  href={quickManualPdfLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                >
                  View selected catalog manual
                </a>
              )}

              <Field label="Notes">
                <textarea
                  value={quickNotes}
                  onChange={(event) => setQuickNotes(event.target.value)}
                  className={inputBase}
                  rows={4}
                />
              </Field>
            </div>
          </ModalShell>
        )}

        {activeQuickModal === "notes" && selectedQuickEquipment && (
          <ModalShell
            title="Edit Notes"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNotes}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Save
                </button>
              </div>
            }
          >
            <Field label="Notes">
              <textarea
                value={quickNotes}
                onChange={(event) => setQuickNotes(event.target.value)}
                className={inputBase}
                rows={6}
              />
            </Field>
          </ModalShell>
        )}

        {activeQuickModal === "status" && selectedQuickEquipment && (
          <ModalShell
            title="Update Status"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateStatus}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Save
                </button>
              </div>
            }
          >
            <Field label="Status">
              <select
                value={quickStatus}
                onChange={(event) => setQuickStatus(event.target.value)}
                className={inputBase}
              >
                <option value="" disabled>
                  Select status
                </option>
                {EQUIPMENT_STATUS_OPTIONS.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {statusOption}
                  </option>
                ))}
              </select>
            </Field>
          </ModalShell>
        )}

        {activeQuickModal === "maintenance" && selectedQuickEquipment && (
          <ModalShell
            title="Create Maintenance Record"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateMaintenance}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Create
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <Field label="Name">
                <input
                  value={maintenanceName}
                  onChange={(event) => setMaintenanceName(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Date">
                <input
                  type="date"
                  value={maintenanceDate}
                  onChange={(event) => setMaintenanceDate(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Performed By">
                <select
                  value={maintenancePerformedBy}
                  onChange={(event) => handleMaintenancePerformedByChange(event.target.value)}
                  className={inputBase}
                >
                  <option value="Company">Company</option>
                  <option value="Customer">Customer</option>
                </select>
              </Field>

              {maintenancePerformedBy === "Company" ? (
                <Field label="Company User">
                  <select
                    value={maintenanceCompanyUserId}
                    onChange={(event) => setMaintenanceCompanyUserId(event.target.value)}
                    className={inputBase}
                  >
                    {companyUsers.length === 0 ? (
                      <option value="">No company users found</option>
                    ) : (
                      companyUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {companyUserDisplayName(user) || "Technician"}
                        </option>
                      ))
                    )}
                  </select>
                </Field>
              ) : (
                <Field label="Customer Name">
                  <input
                    value={maintenanceCustomerName}
                    onChange={(event) => setMaintenanceCustomerName(event.target.value)}
                    className={inputBase}
                  />
                </Field>
              )}

              <Field label="Notes">
                <textarea
                  value={maintenanceNotes}
                  onChange={(event) => setMaintenanceNotes(event.target.value)}
                  className={inputBase}
                  rows={4}
                />
              </Field>
            </div>
          </ModalShell>
        )}

        {activeQuickModal === "repair" && selectedQuickEquipment && (
          <ModalShell
            title="Create Repair Record"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateRepair}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Create
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <Field label="Name">
                <input
                  value={repairName}
                  onChange={(event) => setRepairName(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Date">
                <input
                  type="date"
                  value={repairDate}
                  onChange={(event) => setRepairDate(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Performed By">
                <select
                  value={repairPerformedBy}
                  onChange={(event) => setRepairPerformedBy(event.target.value)}
                  className={inputBase}
                >
                  <option value="Company">Company</option>
                  <option value="Customer">Customer</option>
                </select>
              </Field>

              {repairPerformedBy === "Company" ? (
                <Field label="Company User">
                  <select
                    value={repairCompanyUserId}
                    onChange={(event) => setRepairCompanyUserId(event.target.value)}
                    className={inputBase}
                  >
                    {companyUsers.length === 0 ? (
                      <option value="">No company users found</option>
                    ) : (
                      companyUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {companyUserDisplayName(user) || "Technician"}
                        </option>
                      ))
                    )}
                  </select>
                </Field>
              ) : (
                <Field label="Customer Name">
                  <input
                    value={repairCustomerName}
                    onChange={(event) => setRepairCustomerName(event.target.value)}
                    className={inputBase}
                  />
                </Field>
              )}

              <Field label="Parts Replaced">
                <div className="flex gap-2">
                  <input
                    value={currentPart}
                    onChange={(event) => setCurrentPart(event.target.value)}
                    className={inputBase}
                  />
                  <button
                    onClick={addPart}
                    className="shrink-0 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    type="button"
                  >
                    Add
                  </button>
                </div>

                {!!repairPartsReplaced.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {repairPartsReplaced.map((part, index) => (
                      <span
                        key={`${part}-${index}`}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700"
                      >
                        {part}
                        <button
                          onClick={() => removePart(index)}
                          className="font-bold text-slate-500 hover:text-red-600"
                          aria-label="Remove part"
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Notes">
                <textarea
                  value={repairNotes}
                  onChange={(event) => setRepairNotes(event.target.value)}
                  className={inputBase}
                  rows={4}
                />
              </Field>
            </div>
          </ModalShell>
        )}

        {/* ✅ Download button at bottom */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={downloadExcel}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
          >
            Download Excel
          </button>
        </div>
      </div>
    </div>
  );
}
