import React, { useState, useEffect, useContext, useRef, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { Equipment, EQUIPMENT_STATUS, EQUIPMENT_STATUS_OPTIONS, displayEquipmentStatus } from "../../../utils/models/Equipment";
import { MaintenanceHistory } from "../../../utils/models/MaintenanceHistory";
import { RepairHistory } from "../../../utils/models/RepairHistory";
import { EquipmentPart } from "../../../utils/models/EquipmentPart";
import {
  displayRepairRequestStatus,
  isOpenRepairRequestStatus,
} from "../../../utils/models/RepairRequest";
import {
  query,
  collection,
  getDocs,
  limit,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  where,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format, addDays, addWeeks, addMonths, addYears } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  ArrowPathRoundedSquareIcon,
  BriefcaseIcon,
  PencilSquareIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import toast from "react-hot-toast";

import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css'
/**
 * ✅ IMPORTANT:
 * Keep these components OUTSIDE EquipmentDetail
 * so they do NOT remount on every keystroke (focus loss).
 */
const inputBase =
  "w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500";

const Badge = ({ tone = "gray", children }) => {
  const tones = {
    gray: "bg-gray-100 text-gray-800",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    yellow: "bg-yellow-100 text-yellow-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
};

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
    {children}
  </div>
);

const DetailActionButton = ({ label, icon: Icon, tone = "blue", onClick }) => {
  const toneClasses =
    tone === "amber"
      ? "text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100"
      : tone === "green"
        ? "text-green-700 bg-green-50 border-green-200 hover:bg-green-100"
        : "text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition ${toneClasses}`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
};

const ModalShell = ({ title, children, onClose, footer }) => (
  <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
    <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">{title}</h3>
          <p className="text-sm text-gray-500 mt-1">Fill out the details below.</p>
        </div>
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-xl bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center text-gray-700"
          aria-label="Close"
          type="button"
        >
          ✕
        </button>
      </div>
      {children}
      {footer && <div className="mt-6">{footer}</div>}
    </div>
  </div>
);

/**
 * ✅ Helper: compute nextServiceDate from lastServiceDate + frequency number + unit string
 * serviceFrequency: number
 * serviceFrequencyEvery: "Day" | "Week" | "Month" | "Year"
 */
const computeNextServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
  if (!lastServiceDate) return null;

  const n = Number(serviceFrequency);
  if (!Number.isFinite(n) || n <= 0) return null;

  const base = new Date(lastServiceDate);
  if (Number.isNaN(base.getTime())) return null;

  switch (serviceFrequencyEvery) {
    case "Day":
      return addDays(base, n);
    case "Week":
      return addWeeks(base, n);
    case "Month":
      return addMonths(base, n);
    case "Year":
      return addYears(base, n);
    default:
      return null;
  }
};

const CUSTOM_CATALOG_VALUE = "__custom__";
const DEFAULT_MAINTENANCE_NAME = "Clean";

const todayDateInputValue = () => format(new Date(), "yyyy-MM-dd");

const dateInputToLocalDate = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const companyUserDisplayName = (user = {}) =>
  user.userName || user.name || user.fullName || user.displayName || user.email || "";

const companyUserRecordId = (user = {}) => user.userId || user.id || "";

const equipmentDisplayName = (equipment = {}) =>
  [equipment.name, equipment.make, equipment.model].filter(Boolean).join(" ") || equipment.type || "Equipment";

const buildEquipmentCreatePath = (equipment = {}) => {
  let path = "/company/equipment/createNew";
  if (!equipment.customerId) return path;

  path += `/${equipment.customerId}`;
  if (!equipment.serviceLocationId) return path;

  path += `/${equipment.serviceLocationId}`;
  if (!equipment.bodyOfWaterId) return path;

  return `${path}/${equipment.bodyOfWaterId}`;
};

const EquipmentDetail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { recentlySelectedCompany } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const { equipmentId } = useParams();

  const [equipment, setEquipment] = useState({});
  const [edit, setEdit] = useState(false);
  const [outstandingRepairRequests, setOutstandingRepairRequests] = useState([]);
  const [outstandingJobs, setOutstandingJobs] = useState([]);
  const [loadingOutstandingWork, setLoadingOutstandingWork] = useState(false);

  // ✅ prevents re-hydration while editing
  const hasHydratedRef = useRef(false);

  // Edit Equipment States
  const [category, setCategory] = useState("");
  const [typeId, setTypeId] = useState("");
  const [cleanFilterPressure, setCleanFilterPressure] = useState("");
  const [currentPressure, setCurrentPressure] = useState("");
  const [dateInstalled, setDateInstalled] = useState(null);

  const [lastServiceDate, setLastServiceDate] = useState(null);
  const [nextServiceDate, setNextServiceDate] = useState(null);

  const [make, setMake] = useState("");
  const [makeId, setMakeId] = useState("");
  const [model, setModel] = useState("");
  const [modelId, setModelId] = useState("");
  const [universalEquipmentId, setUniversalEquipmentId] = useState("");
  const [manualPdfLink, setManualPdfLink] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [needsService, setNeedsService] = useState(false);

  // ✅ per your spec:
  // serviceFrequency = number (e.g. 3)
  // serviceFrequencyEvery = unit string ("Day" | "Week" | "Month" | "Year")
  const [serviceFrequency, setServiceFrequency] = useState(""); // keep as string for input
  const [serviceFrequencyEvery, setServiceFrequencyEvery] = useState(""); // unit string

  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");

  const [showServiceHistoryModal, setShowServiceHistoryModal] = useState(false);
  const [showRepairHistoryModal, setShowRepairHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMakeModelModal, setShowMakeModelModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceDate, setReplaceDate] = useState(todayDateInputValue);
  const [addReplacementAfterSave, setAddReplacementAfterSave] = useState(true);
  const [isReplacingEquipment, setIsReplacingEquipment] = useState(false);

  // Company Users
  const [companyUsers, setCompanyUsers] = useState([]);

  // Maintenance modal fields
  const [maintenanceName, setMaintenanceName] = useState(DEFAULT_MAINTENANCE_NAME);
  const [maintenanceDate, setMaintenanceDate] = useState(todayDateInputValue);
  const [maintenancePerformedBy, setMaintenancePerformedBy] = useState("Company");
  const [maintenanceCompanyUserId, setMaintenanceCompanyUserId] = useState("");
  const [maintenanceCustomerName, setMaintenanceCustomerName] = useState("");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [mostRecentMaintenance, setMostRecentMaintenance] = useState(null);

  // Repair modal fields
  const [repairName, setRepairName] = useState("");
  const [repairDate, setRepairDate] = useState(todayDateInputValue);
  const [repairPerformedBy, setRepairPerformedBy] = useState("Company");
  const [repairCompanyUserId, setRepairCompanyUserId] = useState("");
  const [repairCustomerName, setRepairCustomerName] = useState("");
  const [repairPartsReplaced, setRepairPartsReplaced] = useState([]);
  const [currentPart, setCurrentPart] = useState("");
  const [repairNotes, setRepairNotes] = useState("");
  const [mostRecentRepair, setMostRecentRepair] = useState(null);
  const [mostRecentRepairPartNames, setMostRecentRepairPartNames] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [equipmentMakes, setEquipmentMakes] = useState([]);
  const [equipmentModels, setEquipmentModels] = useState([]);
  const [catalogTypeId, setCatalogTypeId] = useState(CUSTOM_CATALOG_VALUE);
  const [catalogMakeId, setCatalogMakeId] = useState(CUSTOM_CATALOG_VALUE);
  const [catalogEquipmentId, setCatalogEquipmentId] = useState(CUSTOM_CATALOG_VALUE);

  const openMaintenanceModal = useCallback(() => {
    setMaintenanceName(DEFAULT_MAINTENANCE_NAME);
    setMaintenanceDate(todayDateInputValue());
    setMaintenancePerformedBy("Company");
    setMaintenanceCompanyUserId((current) => current || companyUsers?.[0]?.id || "");
    setMaintenanceCustomerName(equipment?.customerName || "");
    setMaintenanceNotes("");
    setShowServiceHistoryModal(true);
  }, [companyUsers, equipment?.customerName]);

  const handleMaintenancePerformedByChange = (value) => {
    setMaintenancePerformedBy(value);
    if (value === "Customer") {
      setMaintenanceCustomerName(equipment?.customerName || "");
    }
  };

  useEffect(() => {
    const action = location.state?.equipmentAction;
    if (!action) return;

    if (action === "recordMaintenance") {
      openMaintenanceModal();
    } else if (action === "recordRepair") {
      setShowRepairHistoryModal(true);
    } else if (action === "editMakeModel") {
      setShowMakeModelModal(true);
    }

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate, openMaintenanceModal]);

  // -----------------------------
  // Load company users list
  // -----------------------------
  useEffect(() => {
    if (!recentlySelectedCompany) return;

    (async () => {
      try {
        const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
        const snap = await getDocs(query(usersRef, orderBy("userName", "asc")));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCompanyUsers(data);

        if (data.length) {
          setMaintenanceCompanyUserId((prev) => prev || data[0].id);
          setRepairCompanyUserId((prev) => prev || data[0].id);
        }
      } catch (e) {
        console.error("Error loading company users:", e);
        setCompanyUsers([]);
      }
    })();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    const fetchEquipmentTypes = async () => {
      try {
        const typesSnap = await getDocs(query(collection(db, "universal", "equipment", "equipmentTypes"), orderBy("name", "asc")));
        setEquipmentTypes(typesSnap.docs.map((typeDoc) => ({ id: typeDoc.id, ...typeDoc.data() })));
      } catch (error) {
        console.error("Error loading universal equipment types:", error);
        setEquipmentTypes([]);
      }
    };

    fetchEquipmentTypes();
  }, []);

  useEffect(() => {
    if (!catalogTypeId || catalogTypeId === CUSTOM_CATALOG_VALUE) {
      setEquipmentMakes([]);
      return;
    }

    const fetchEquipmentMakes = async () => {
      try {
        const makesSnap = await getDocs(
          query(
            collection(db, "universal", "equipment", "equipmentMakes"),
            where("types", "array-contains", catalogTypeId)
          )
        );
        setEquipmentMakes(makesSnap.docs.map((makeDoc) => ({ id: makeDoc.id, ...makeDoc.data() })));
      } catch (error) {
        console.error("Error loading universal equipment makes:", error);
        setEquipmentMakes([]);
      }
    };

    fetchEquipmentMakes();
  }, [catalogTypeId]);

  useEffect(() => {
    if (!catalogTypeId || catalogTypeId === CUSTOM_CATALOG_VALUE || !catalogMakeId || catalogMakeId === CUSTOM_CATALOG_VALUE) {
      setEquipmentModels([]);
      return;
    }

    const fetchEquipmentModels = async () => {
      try {
        const modelsSnap = await getDocs(
          query(
            collection(db, "universal", "equipment", "equipment"),
            where("typeId", "==", catalogTypeId),
            where("makeId", "==", catalogMakeId)
          )
        );
        setEquipmentModels(modelsSnap.docs.map((modelDoc) => ({ id: modelDoc.id, ...modelDoc.data() })));
      } catch (error) {
        console.error("Error loading universal equipment models:", error);
        setEquipmentModels([]);
      }
    };

    fetchEquipmentModels();
  }, [catalogTypeId, catalogMakeId]);

  // -----------------------------
  // Load equipment + live history
  // -----------------------------
  useEffect(() => {
    if (!equipmentId || !recentlySelectedCompany) return;

    let unsubMaintenance = null;
    let unsubRepair = null;

    (async () => {
      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const snapEquipment = Equipment.fromFirestore(docSnap);
          setEquipment(snapEquipment);

          // ✅ hydrate form only if NOT editing
          if (!edit) {
            setCategory(snapEquipment.type || "");
            setCleanFilterPressure(snapEquipment.cleanFilterPressure ?? "");
            setCurrentPressure(snapEquipment.currentPressure ?? "");
            setDateInstalled(snapEquipment.dateInstalled || null);

            setLastServiceDate(snapEquipment.lastServiceDate || null);
            setNextServiceDate(snapEquipment.nextServiceDate || null);

            setMake(snapEquipment.make || "");
            setMakeId(snapEquipment.makeId || "");
            setModel(snapEquipment.model || "");
            setModelId(snapEquipment.modelId || "");
            setUniversalEquipmentId(snapEquipment.universalEquipmentId || snapEquipment.modelId || "");
            setManualPdfLink(snapEquipment.manualPdfLink || "");
            setTypeId(snapEquipment.typeId || "");
            setCatalogTypeId(snapEquipment.typeId || CUSTOM_CATALOG_VALUE);
            setCatalogMakeId(snapEquipment.makeId || CUSTOM_CATALOG_VALUE);
            setCatalogEquipmentId(snapEquipment.universalEquipmentId || snapEquipment.modelId || CUSTOM_CATALOG_VALUE);
            setName(snapEquipment.name || "");
            setIsActive(!!snapEquipment.isActive);
            setNeedsService(!!snapEquipment.needsService);

            // ✅ store frequency in your desired shapes
            setServiceFrequency(
              snapEquipment.serviceFrequency !== undefined && snapEquipment.serviceFrequency !== null
                ? String(snapEquipment.serviceFrequency)
                : ""
            );
            setServiceFrequencyEvery(snapEquipment.serviceFrequencyEvery || "");

            setStatus(displayEquipmentStatus(snapEquipment.status || ""));
            setNotes(snapEquipment.notes || "");
            hasHydratedRef.current = true;
          } else if (!hasHydratedRef.current) {
            // fallback hydrate once if needed
            setCategory(snapEquipment.type || "");
            setCleanFilterPressure(snapEquipment.cleanFilterPressure ?? "");
            setCurrentPressure(snapEquipment.currentPressure ?? "");
            setDateInstalled(snapEquipment.dateInstalled || null);

            setLastServiceDate(snapEquipment.lastServiceDate || null);
            setNextServiceDate(snapEquipment.nextServiceDate || null);

            setMake(snapEquipment.make || "");
            setMakeId(snapEquipment.makeId || "");
            setModel(snapEquipment.model || "");
            setModelId(snapEquipment.modelId || "");
            setUniversalEquipmentId(snapEquipment.universalEquipmentId || snapEquipment.modelId || "");
            setManualPdfLink(snapEquipment.manualPdfLink || "");
            setTypeId(snapEquipment.typeId || "");
            setCatalogTypeId(snapEquipment.typeId || CUSTOM_CATALOG_VALUE);
            setCatalogMakeId(snapEquipment.makeId || CUSTOM_CATALOG_VALUE);
            setCatalogEquipmentId(snapEquipment.universalEquipmentId || snapEquipment.modelId || CUSTOM_CATALOG_VALUE);
            setName(snapEquipment.name || "");
            setIsActive(!!snapEquipment.isActive);
            setNeedsService(!!snapEquipment.needsService);

            setServiceFrequency(
              snapEquipment.serviceFrequency !== undefined && snapEquipment.serviceFrequency !== null
                ? String(snapEquipment.serviceFrequency)
                : ""
            );
            setServiceFrequencyEvery(snapEquipment.serviceFrequencyEvery || "");

            setStatus(displayEquipmentStatus(snapEquipment.status || ""));
            setNotes(snapEquipment.notes || "");
            hasHydratedRef.current = true;
          }

          const serviceHistoryRef = collection(docRef, "serviceHistory");

          const maintenanceLiveQ = query(
            serviceHistoryRef,
            where("type", "==", "Maintenance"),
            orderBy("date", "desc"),
            limit(1)
          );

          const repairLiveQ = query(
            serviceHistoryRef,
            where("type", "==", "Repair"),
            orderBy("date", "desc"),
            limit(1)
          );

          unsubMaintenance = onSnapshot(maintenanceLiveQ, (snap) => {
            if (snap.empty) {
              setMostRecentMaintenance(null);
              console.log("Received No Maintance Record")
              return;
            }
            console.log("Received Maintance Record")
            setMostRecentMaintenance(MaintenanceHistory.fromFirestore(snap.docs[0]));
          });

          unsubRepair = onSnapshot(repairLiveQ, async (snap) => {
            if (snap.empty) {
              setMostRecentRepair(null);
              setMostRecentRepairPartNames([]);
              console.log("Received No Repair Record")
              return;
            }
            console.log("Received Repair Record")
            const repair = RepairHistory.fromFirestore(snap.docs[0]);
            setMostRecentRepair(repair);

            const partsRef = collection(docRef, "parts");
            const ids = Array.isArray(repair.partIds) ? repair.partIds : [];
            if (!ids.length) {
              setMostRecentRepairPartNames([]);
              return;
            }

            try {
              const nameResults = await Promise.all(
                ids.map(async (pid) => {
                  const pSnap = await getDoc(doc(partsRef, pid));
                  if (!pSnap.exists()) return null;
                  const part = EquipmentPart.fromFirestore(pSnap);
                  return part.name || null;
                })
              );
              setMostRecentRepairPartNames(nameResults.filter(Boolean));
            } catch (e) {
              console.error("Error loading part names:", e);
              setMostRecentRepairPartNames([]);
            }
          });
        } else {
          console.log("No such document!");
        }
      } catch (error) {
        console.error("Equipment Data Error!:", error);
      }
    })();

    return () => {
      if (typeof unsubMaintenance === "function") unsubMaintenance();
      if (typeof unsubRepair === "function") unsubRepair();
    };
  }, [equipmentId, recentlySelectedCompany, edit]);

  useEffect(() => {
    const fetchOutstandingWork = async () => {
      if (!equipmentId || !recentlySelectedCompany) return;

      try {
        setLoadingOutstandingWork(true);

        const repairRequestsRef = collection(db, "companies", recentlySelectedCompany, "repairRequests");
        const repairSnap = await getDocs(
          query(repairRequestsRef, where("equipmentId", "==", equipmentId), limit(50))
        );
        const requests = repairSnap.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
          .filter((request) => isOpenRepairRequestStatus(request.status))
          .sort((a, b) => getDateMillis(b.date || b.createdAt) - getDateMillis(a.date || a.createdAt));

        const jobsRef = collection(db, "companies", recentlySelectedCompany, "workOrders");
        const jobsQuery = equipment?.customerId
          ? query(jobsRef, where("customerId", "==", equipment.customerId), limit(75))
          : query(jobsRef, where("equipmentId", "==", equipmentId), limit(75));
        const jobsSnap = await getDocs(jobsQuery);

        const jobs = await Promise.all(
          jobsSnap.docs.map(async (jobDoc) => {
            const jobData = { id: jobDoc.id, ...jobDoc.data() };
            let equipmentTasks = [];

            try {
              const taskSnap = await getDocs(
                query(collection(jobDoc.ref, "tasks"), where("equipmentId", "==", equipmentId))
              );
              equipmentTasks = taskSnap.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }));
            } catch (error) {
              console.error("Error loading equipment-linked job tasks:", error);
            }

            return {
              ...jobData,
              equipmentTasks,
            };
          })
        );

        const unfinishedJobs = jobs
          .filter((job) => job.equipmentId === equipmentId || job.equipmentTasks.length > 0)
          .filter((job) => {
            const operationStatus = String(job.operationStatus || "").trim().toLowerCase();
            const billingStatus = String(job.billingStatus || "").trim().toLowerCase();
            return operationStatus !== "finished" && billingStatus !== "paid" && billingStatus !== "expired";
          })
          .sort((a, b) => getDateMillis(b.dateCreated || b.createdAt) - getDateMillis(a.dateCreated || a.createdAt));

        setOutstandingRepairRequests(requests);
        setOutstandingJobs(unfinishedJobs);
      } catch (error) {
        console.error("Error loading outstanding equipment work:", error);
        setOutstandingRepairRequests([]);
        setOutstandingJobs([]);
      } finally {
        setLoadingOutstandingWork(false);
      }
    };

    fetchOutstandingWork();
  }, [equipmentId, recentlySelectedCompany, equipment?.customerId]);

  /**
   * ✅ Recalculate nextServiceDate live while editing
   */
  const computedNextServiceDate = useMemo(() => {
    return computeNextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery);
  }, [lastServiceDate, serviceFrequency, serviceFrequencyEvery]);

  const getDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "number") return new Date(value);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const getDateMillis = (value) => {
    const date = getDateValue(value);
    return date ? date.getTime() : 0;
  };


  useEffect(() => {
    if (!edit) return;
    setNextServiceDate(computedNextServiceDate);
  }, [edit, computedNextServiceDate]);

  const handleSave = async () => {
    if (!requirePermission("64", "update equipment")) return;

    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);

      const next = computeNextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery);

      await updateDoc(docRef, {
        type: category,
        typeId,
        cleanFilterPressure,
        currentPressure,
        dateInstalled,

        lastServiceDate,
        nextServiceDate: next,

        make,
        makeId,
        model,
        modelId,
        universalEquipmentId,
        manualPdfLink,
        name,
        isActive,
        needsService,

        // ✅ save in your desired shapes:
        serviceFrequency: serviceFrequency === "" ? null : Number(serviceFrequency),
        serviceFrequencyEvery: serviceFrequencyEvery || "",

        status,
        notes,
      });

      setEquipment((prev) => ({
        ...prev,
        type: category,
        typeId,
        cleanFilterPressure,
        currentPressure,
        dateInstalled,

        lastServiceDate,
        nextServiceDate: next,

        make,
        makeId,
        model,
        modelId,
        universalEquipmentId,
        manualPdfLink,
        name,
        isActive,
        needsService,

        serviceFrequency: serviceFrequency === "" ? null : Number(serviceFrequency),
        serviceFrequencyEvery: serviceFrequencyEvery || "",

        status,
        notes,
      }));

      setEdit(false);
    } catch (error) {
      console.error("Error updating equipment:", error);
    }
  };

  const handleSaveMakeModel = async () => {
    if (!requirePermission("64", "update equipment")) return;

    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);

      await updateDoc(docRef, {
        type: category,
        typeId,
        make,
        makeId,
        model,
        modelId,
        universalEquipmentId,
        manualPdfLink,
      });

      setEquipment((prev) => ({
        ...prev,
        type: category,
        typeId,
        make,
        makeId,
        model,
        modelId,
        universalEquipmentId,
        manualPdfLink,
      }));

      setShowMakeModelModal(false);
      toast.success("Make and model updated");
    } catch (error) {
      console.error("Error updating equipment make/model:", error);
      toast.error("Failed to update make and model");
    }
  };

  const openReplaceModal = () => {
    setReplaceDate(todayDateInputValue());
    setAddReplacementAfterSave(true);
    setShowReplaceModal(true);
  };

  const handleReplaceEquipment = async () => {
    if (!requirePermission("64", "replace equipment")) return;

    const dateUninstalled = dateInputToLocalDate(replaceDate);
    if (!dateUninstalled) {
      toast.error("Choose a date uninstalled");
      return;
    }

    try {
      setIsReplacingEquipment(true);
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);
      const updates = {
        isActive: false,
        active: false,
        dateUninstalled,
        needsService: false,
        nextServiceDate: null,
        status: EQUIPMENT_STATUS.REPLACED,
      };

      await updateDoc(docRef, updates);

      setEquipment((prev) => ({
        ...prev,
        ...updates,
      }));
      setIsActive(false);
      setStatus(EQUIPMENT_STATUS.REPLACED);
      setShowReplaceModal(false);
      toast.success("Equipment marked as replaced");

      if (addReplacementAfterSave) {
        navigate(buildEquipmentCreatePath(equipment), {
          state: {
            replacementContext: {
              replacesEquipmentId: equipmentId,
              replacedEquipmentName: equipmentDisplayName(equipment),
              dateUninstalled: dateUninstalled.toISOString(),
              customerId: equipment?.customerId || "",
              serviceLocationId: equipment?.serviceLocationId || "",
              bodyOfWaterId: equipment?.bodyOfWaterId || "",
            },
          },
        });
      }
    } catch (error) {
      console.error("Error replacing equipment:", error);
      toast.error("Failed to mark equipment as replaced");
    } finally {
      setIsReplacingEquipment(false);
    }
  };

  const handleDelete = async () => {
    if (!requirePermission("66", "delete equipment")) return;

    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);
      await deleteDoc(docRef);
      navigate("/company/equipment");
    } catch (error) {
      console.error("Error deleting equipment:", error);
    }
  };

  const handleCreateMaintenance = async () => {
    if (!requirePermission("64", "update equipment")) return;

    try {
      const maintenanceDateValue = dateInputToLocalDate(maintenanceDate);
      if (!maintenanceDateValue) {
        toast.error("Choose a maintenance date");
        return;
      }

      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);

      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(docRef, "serviceHistory", serviceId);

      const performedBy = maintenancePerformedBy;
      const selectedCompanyUser = companyUsers.find((u) => u.id === maintenanceCompanyUserId);
      const techId = performedBy === "Company" ? companyUserRecordId(selectedCompanyUser) : "";
      const techName =
        performedBy === "Company" ? companyUserDisplayName(selectedCompanyUser) : (maintenanceCustomerName || "").trim();

      const newMaintenanceRecord = {
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
      };

      await setDoc(serviceHistoryDoc, newMaintenanceRecord);

      // ✅ compute next based on maintenance date + current schedule
      const next = computeNextServiceDate(maintenanceDateValue, serviceFrequency, serviceFrequencyEvery);

      await updateDoc(docRef, {
        lastServiceDate: maintenanceDateValue,
        nextServiceDate: next,
      });

      setEquipment((prev) => ({
        ...prev,
        lastServiceDate: maintenanceDateValue,
        nextServiceDate: next,
      }));

      toast.success("Maintenance Record saved");
      // keep edit-form in sync too
      setLastServiceDate(maintenanceDateValue);
      setNextServiceDate(next);

      setShowServiceHistoryModal(false);
      setMaintenanceName(DEFAULT_MAINTENANCE_NAME);
      setMaintenanceDate(todayDateInputValue());
      setMaintenancePerformedBy("Company");
      setMaintenanceCompanyUserId(companyUsers?.[0]?.id || "");
      setMaintenanceCustomerName(equipment?.customerName || "");
      setMaintenanceNotes("");
    } catch (error) {

      toast.error("Failed to create Maintenance Record");
      console.error("Error creating maintenance history:", error);
    }
  };

  const handleCreateRepair = async () => {
    if (!requirePermission("64", "update equipment")) return;

    try {
      const repairDateValue = dateInputToLocalDate(repairDate);
      if (!repairDateValue) {
        toast.error("Choose a repair date");
        return;
      }

      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);

      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(docRef, "serviceHistory", serviceId);

      const partsRef = collection(docRef, "parts");

      const partIds = [];
      for (const partName of repairPartsReplaced) {
        const cleanName = (partName || "").trim();
        if (!cleanName) continue;

        const partId = "com_equ_par_" + uuidv4();
        const partDoc = doc(partsRef, partId);

        await setDoc(
          partDoc,
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

      const performedBy = repairPerformedBy;
      const selectedCompanyUser = companyUsers.find((u) => u.id === repairCompanyUserId);
      const techId = performedBy === "Company" ? companyUserRecordId(selectedCompanyUser) : "";
      const techName = performedBy === "Company" ? companyUserDisplayName(selectedCompanyUser) : (repairCustomerName || "").trim();

      const newRepairRecord = {
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
      };

      await setDoc(serviceHistoryDoc, newRepairRecord);

      setShowRepairHistoryModal(false);
      setRepairName("");
      setRepairDate(todayDateInputValue());
      setRepairPerformedBy("Company");
      setRepairCompanyUserId(companyUsers?.[0]?.id || "");
      setRepairCustomerName("");
      setRepairPartsReplaced([]);
      setCurrentPart("");
      setRepairNotes("");
    } catch (error) {
      console.error("Error creating repair history:", error);
    }
  };

  const addPart = () => {
    const value = (currentPart || "").trim();
    if (!value) return;
    setRepairPartsReplaced((prev) => [...prev, value]);
    setCurrentPart("");
  };

  const removePart = (index) => {
    setRepairPartsReplaced((prev) => prev.filter((_, i) => i !== index));
  };

  const getEquipmentDisplayName = () =>
    [
      equipment?.name,
      equipment?.make,
      equipment?.model,
    ].filter(Boolean).join(" ") || equipment?.type || "Equipment";

  const buildEquipmentContext = (jobIntent = "") => ({
    jobIntent,
    equipmentId: equipment?.id || equipmentId || "",
    equipmentName: getEquipmentDisplayName(),
    customerId: equipment?.customerId || "",
    customerName: equipment?.customerName || "",
    serviceLocationId: equipment?.serviceLocationId || "",
    bodyOfWaterId: equipment?.bodyOfWaterId || "",
    type: equipment?.type || "",
    make: equipment?.make || "",
    model: equipment?.model || "",
    name: equipment?.name || "",
  });

  const createEquipmentJob = (jobIntent) => {
    navigate("/company/jobs/createNew", {
      state: {
        equipmentContext: buildEquipmentContext(jobIntent),
        jobIntent,
      },
    });
  };

  const handleCatalogTypeChange = (value) => {
    setCatalogTypeId(value);
    setCatalogMakeId(CUSTOM_CATALOG_VALUE);
    setCatalogEquipmentId(CUSTOM_CATALOG_VALUE);
    setEquipmentModels([]);
    setMakeId("");
    setModelId("");
    setUniversalEquipmentId("");
    setManualPdfLink("");

    if (value === CUSTOM_CATALOG_VALUE) {
      setTypeId("");
      return;
    }

    const selected = equipmentTypes.find((item) => item.id === value);
    setTypeId(selected?.id || "");
    setCategory(selected?.name || "");
    setMake("");
    setModel("");
  };

  const handleCatalogMakeChange = (value) => {
    setCatalogMakeId(value);
    setCatalogEquipmentId(CUSTOM_CATALOG_VALUE);
    setModelId("");
    setUniversalEquipmentId("");
    setManualPdfLink("");

    if (value === CUSTOM_CATALOG_VALUE) {
      setMakeId("");
      return;
    }

    const selected = equipmentMakes.find((item) => item.id === value);
    setMakeId(selected?.id || "");
    setMake(selected?.name || "");
    setModel("");
  };

  const handleCatalogEquipmentChange = (value) => {
    setCatalogEquipmentId(value);

    if (value === CUSTOM_CATALOG_VALUE) {
      setModelId("");
      setUniversalEquipmentId("");
      setManualPdfLink("");
      return;
    }

    const selected = equipmentModels.find((item) => item.id === value);
    setModel(selected?.model || selected?.name || "");
    setModelId(selected?.id || "");
    setUniversalEquipmentId(selected?.id || "");
    setManualPdfLink(selected?.manualPdfLink || "");
    if (!name.trim()) setName(selected?.name || selected?.model || "");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>

            <Link
              to="/company/equipment"
              className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >&larr; Back to Equipment List</Link>
            <h2 className="text-3xl font-bold text-gray-800">Equipment</h2>
            <p className="text-gray-600 mt-1">
              <span className="font-semibold text-gray-800">{equipment?.name || "—"}</span>{" "}
              <Link
                to={`/company/customers/details/${equipment?.customerId}/locations`}
                className="hover:text-blue-800"
              >
                <span className="text-gray-400">•</span> {equipment?.customerName || "—"}
              </Link>
            </p>
          </div>

          <div className="flex items-center gap-2">

            {!edit ? (
              can("64") && (
              <button
                onClick={() => {
                  hasHydratedRef.current = true;
                  setEdit(true);
                }}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                type="button"
              >
                Edit
              </button>
              )
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  type="button"
                >
                  Save
                </button>
                <button
                  onClick={() => setEdit(false)}
                  className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                  type="button"
                >
                  Cancel
                </button>
                {can("66") && (
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
                    type="button"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4">
          <div className="flex flex-wrap gap-2">
            {can("64") && (
              <>
                <DetailActionButton
                  label="Edit Make/Model"
                  icon={PencilSquareIcon}
                  onClick={() => setShowMakeModelModal(true)}
                />
                <DetailActionButton
                  label="Record Maintenance"
                  icon={WrenchScrewdriverIcon}
                  tone="green"
                  onClick={openMaintenanceModal}
                />
                <DetailActionButton
                  label="Record Repair"
                  icon={WrenchScrewdriverIcon}
                  tone="amber"
                  onClick={() => setShowRepairHistoryModal(true)}
                />
                {equipment?.isActive && (
                  <DetailActionButton
                    label="Replace Equipment"
                    icon={ArrowPathRoundedSquareIcon}
                    tone="amber"
                    onClick={openReplaceModal}
                  />
                )}
              </>
            )}

            {can("22") && (
              <>
                <DetailActionButton
                  label="Create Maintenance Job"
                  icon={BriefcaseIcon}
                  tone="green"
                  onClick={() => createEquipmentJob("maintenance")}
                />
                <DetailActionButton
                  label="Create Repair Job"
                  icon={BriefcaseIcon}
                  tone="amber"
                  onClick={() => createEquipmentJob("repair")}
                />
              </>
            )}
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-gray-800">Outstanding Work</h3>
              <p className="text-sm text-gray-500 mt-1">Open repair requests and unfinished jobs tied to this equipment.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={outstandingRepairRequests.length ? "red" : "green"}>
                {outstandingRepairRequests.length} Repair Request{outstandingRepairRequests.length === 1 ? "" : "s"}
              </Badge>
              <Badge tone={outstandingJobs.length ? "yellow" : "green"}>
                {outstandingJobs.length} Job{outstandingJobs.length === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>

          {loadingOutstandingWork ? (
            <p className="mt-5 text-gray-500">Loading outstanding work...</p>
          ) : outstandingRepairRequests.length === 0 && outstandingJobs.length === 0 ? (
            <p className="mt-5 text-gray-500">No outstanding work is connected to this equipment.</p>
          ) : (
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <h4 className="font-bold text-gray-800">Repair Requests</h4>
                <div className="mt-3 space-y-2">
                  {outstandingRepairRequests.length ? (
                    outstandingRepairRequests.map((request) => {
                      const requestDate = getDateValue(request.date || request.createdAt);
                      return (
                        <Link
                          key={request.id}
                          to={`/company/repair-requests/detail/${request.id}`}
                          className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-blue-300 transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-gray-800">{request.description || "Repair Request"}</p>
                              <p className="mt-1 text-xs text-gray-500">
                                {requestDate ? format(requestDate, "MMM d, yyyy") : "No date"}
                              </p>
                            </div>
                            <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-bold text-yellow-800">
                              {displayRepairRequestStatus(request.status)}
                            </span>
                          </div>
                        </Link>
                      );
                    })
                  ) : (
                    <p className="text-sm text-gray-500">No unresolved repair requests.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <h4 className="font-bold text-gray-800">Jobs</h4>
                <div className="mt-3 space-y-2">
                  {outstandingJobs.length ? (
                    outstandingJobs.map((job) => (
                      <Link
                        key={job.id}
                        to={`/company/jobs/detail/${job.id}`}
                        className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-blue-300 transition"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-gray-800">{job.internalId || "Job"}</p>
                            <p className="mt-1 text-sm text-gray-600">{job.description || job.type || "Job"}</p>
                            {job.equipmentTasks?.length ? (
                              <p className="mt-1 text-xs text-gray-500">
                                {job.equipmentTasks.length} equipment task{job.equipmentTasks.length === 1 ? "" : "s"}
                              </p>
                            ) : null}
                          </div>
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">
                            {job.operationStatus || "—"}
                          </span>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No unfinished jobs.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Detail Card */}
        <div className="bg-white shadow-lg rounded-xl p-6">
          {!edit ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={equipment?.isActive ? "green" : "gray"}>{equipment?.isActive ? "Active" : "Inactive"}</Badge>
                <Badge tone={equipment?.needsService ? "red" : "green"}>
                  {equipment?.needsService ? "Needs Service" : "No Service Needed"}
                </Badge>
                {equipment?.status ? <Badge tone="blue">{displayEquipmentStatus(equipment.status)}</Badge> : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</p>
                  <p className="mt-1 text-gray-800 font-semibold">{equipment?.type || "—"}</p>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Make</p>
                    {can("64") && (
                      <button
                        type="button"
                        onClick={() => setShowMakeModelModal(true)}
                        className="text-xs font-bold text-blue-700 hover:text-blue-900"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-gray-800 font-semibold">{equipment?.make || "—"}</p>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Model</p>
                    {can("64") && (
                      <button
                        type="button"
                        onClick={() => setShowMakeModelModal(true)}
                        className="text-xs font-bold text-blue-700 hover:text-blue-900"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-gray-800 font-semibold">{equipment?.model || "—"}</p>
                </div>
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Installed</p>
                  <p className="mt-1 text-gray-800 font-semibold">
                    {equipment?.dateInstalled ? format(equipment.dateInstalled, "PP") : "N/A"}
                  </p>
                </div>
                {!equipment?.isActive && (
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Uninstalled</p>
                    <p className="mt-1 text-gray-800 font-semibold">
                      {equipment?.dateUninstalled ? format(equipment.dateUninstalled, "PP") : "N/A"}
                    </p>
                  </div>
                )}
                {
                  equipment.needsService ? (<>
                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Clean Filter Pressure</p>
                      <p className="mt-1 text-gray-800 font-semibold">{equipment?.cleanFilterPressure ?? "—"}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Pressure</p>
                      <p className="mt-1 text-gray-800 font-semibold">{equipment?.currentPressure ?? "—"}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Service</p>
                      <p className="mt-1 text-gray-800 font-semibold">
                        {equipment?.lastServiceDate ? format(equipment.lastServiceDate, "PP") : "N/A"}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Next Service</p>
                      <p className="mt-1 text-gray-800 font-semibold">
                        {equipment?.nextServiceDate ? format(equipment.nextServiceDate, "PP") : "N/A"}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Service Frequency</p>
                      <p className="mt-1 text-gray-800 font-semibold">
                        {equipment?.serviceFrequency && equipment?.serviceFrequencyEvery
                          ? `${equipment.serviceFrequency} ${equipment.serviceFrequencyEvery}`
                          : "—"}
                      </p>
                    </div>
                  </>) : (<></>)
                }
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</p>
                <p className="mt-2 text-gray-700 whitespace-pre-wrap">{equipment?.notes || "—"}</p>
              </div>

              {equipment?.manualPdfLink && (
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Catalog Manual</p>
                  <a
                    href={equipment.manualPdfLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block font-semibold text-blue-700 hover:text-blue-900"
                  >
                    View Manual
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <h3 className="text-xl font-bold text-gray-800">Edit Equipment</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputBase} />
                </Field>

                <Field label="Category">
                  <input
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setTypeId("");
                      setCatalogTypeId(CUSTOM_CATALOG_VALUE);
                    }}
                    className={inputBase}
                  />
                </Field>

                <Field label="Make">
                  <input
                    value={make}
                    onChange={(e) => {
                      setMake(e.target.value);
                      setMakeId("");
                      setCatalogMakeId(CUSTOM_CATALOG_VALUE);
                    }}
                    className={inputBase}
                  />
                </Field>

                <Field label="Model">
                  <input
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setModelId("");
                      setUniversalEquipmentId("");
                      setManualPdfLink("");
                      setCatalogEquipmentId(CUSTOM_CATALOG_VALUE);
                    }}
                    className={inputBase}
                  />
                </Field>

                <Field label="Date Installed">
                  <DatePicker
                    showIcon
                    selected={dateInstalled || null}
                    onChange={(e) => setDateInstalled(e)}
                    dateFormat="MM/dd/yyyy"
                    isClearable
                    className={inputBase}
                    icon={
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="1em"
                        height="1em"
                        viewBox="0 0 48 48"
                      >
                        <mask id="ipSApplication0">
                          <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="4">
                            <path strokeLinecap="round" d="M40.04 22v20h-32V22"></path>
                            <path
                              fill="#fff"
                              d="M5.842 13.777C4.312 17.737 7.263 22 11.51 22c3.314 0 6.019-2.686 6.019-6a6 6 0 0 0 6 6h1.018a6 6 0 0 0 6-6c0 3.314 2.706 6 6.02 6c4.248 0 7.201-4.265 5.67-8.228L39.234 6H8.845l-3.003 7.777Z"
                            ></path>
                          </g>
                        </mask>
                        <path
                          fill="currentColor"
                          d="M0 0h48v48H0z"
                          mask="url(#ipSApplication0)"
                        ></path>
                      </svg>
                    }
                  />
                </Field>
                <Field label="Needs Service">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={needsService}
                      onChange={(e) => setNeedsService(e.target.checked)}
                      className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-gray-700 font-semibold">{needsService ? "Yes" : "No"}</span>
                  </div>
                </Field>

                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputBase}>
                    {status === EQUIPMENT_STATUS.REPLACED && (
                      <option value={EQUIPMENT_STATUS.REPLACED}>{EQUIPMENT_STATUS.REPLACED}</option>
                    )}
                    {EQUIPMENT_STATUS_OPTIONS.map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                </Field>
                {
                  needsService ? (<>
                    <Field label="Clean Filter Pressure">
                      <input value={cleanFilterPressure} onChange={(e) => setCleanFilterPressure(e.target.value)} className={inputBase} />
                    </Field>

                    <Field label="Current Pressure">
                      <input value={currentPressure} onChange={(e) => setCurrentPressure(e.target.value)} className={inputBase} />
                    </Field>

                    {/* ✅ Date picker + drives nextServiceDate */}
                    {/* <Field label="Last Service Date">
                      <input
                        type="date"
                        value={lastServiceDate ? format(lastServiceDate, "yyyy-MM-dd") : ""}
                        onChange={(e) => setLastServiceDate(e.target.value ? new Date(e.target.value) : null)}
                        className={inputBase}
                      />
                    </Field> */}
                    <Field label="Last Service Date">
                      <DatePicker
                        showIcon
                        selected={lastServiceDate || null}
                        onChange={(e) => setLastServiceDate(e)}
                        dateFormat="MM/dd/yyyy"
                        isClearable
                        className={inputBase}
                        icon={
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="1em"
                            height="1em"
                            viewBox="0 0 48 48"
                          >
                            <mask id="ipSApplication0">
                              <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="4">
                                <path strokeLinecap="round" d="M40.04 22v20h-32V22"></path>
                                <path
                                  fill="#fff"
                                  d="M5.842 13.777C4.312 17.737 7.263 22 11.51 22c3.314 0 6.019-2.686 6.019-6a6 6 0 0 0 6 6h1.018a6 6 0 0 0 6-6c0 3.314 2.706 6 6.02 6c4.248 0 7.201-4.265 5.67-8.228L39.234 6H8.845l-3.003 7.777Z"
                                ></path>
                              </g>
                            </mask>
                            <path
                              fill="currentColor"
                              d="M0 0h48v48H0z"
                              mask="url(#ipSApplication0)"
                            ></path>
                          </svg>
                        }
                      />
                    </Field>

                    <Field label="Next Service Date (auto)">
                      <input
                        type="date"
                        value={nextServiceDate ? format(nextServiceDate, "yyyy-MM-dd") : ""}
                        readOnly
                        className={`${inputBase} bg-gray-50`}
                      />
                    </Field>

                    <Field label="Service Frequency (number)">
                      <input
                        type="number"
                        min="0"
                        value={serviceFrequency}
                        onChange={(e) => setServiceFrequency(e.target.value)}
                        className={inputBase}
                        placeholder="e.g. 3"
                      />
                    </Field>

                    <Field label="Service Frequency Every">
                      <select value={serviceFrequencyEvery} onChange={(e) => setServiceFrequencyEvery(e.target.value)} className={inputBase}>
                        <option value="">Select…</option>
                        <option value="Day">Day</option>
                        <option value="Week">Week</option>
                        <option value="Month">Month</option>
                        <option value="Year">Year</option>
                      </select>
                    </Field>

                  </>) : (<>
                  </>)
                }

                <Field label="Is Active">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-gray-700 font-semibold">{isActive ? "Active" : "Inactive"}</span>
                  </div>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Notes">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputBase} rows={4} />
                  </Field>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* History Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Maintenance */}
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Most Recent Maintenance</h3>
                <p className="text-sm text-gray-500 mt-1">Log service and keep the schedule up to date.</p>
              </div>
              {can("64") && (
                <button
                  onClick={openMaintenanceModal}
                  className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  type="button"
                >
                  New
                </button>
              )}
            </div>

            <div className="mt-5">
              {mostRecentMaintenance ? (
                <div className="space-y-2 text-gray-700">
                  <p>
                    <span className="font-semibold text-gray-800">Name:</span> {mostRecentMaintenance.name || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Date:</span>{" "}
                    {mostRecentMaintenance.date ? format(mostRecentMaintenance.date, "PP") : "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Performed By:</span> {mostRecentMaintenance.performedBy || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Tech:</span> {mostRecentMaintenance.techName || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Notes:</span> {mostRecentMaintenance.description || "—"}
                  </p>

                  <Link
                    to={`/company/equipment/detail/${equipmentId}/service-history`}
                    className="inline-block mt-2 font-semibold text-blue-600 hover:text-blue-800"
                  >
                    See More →
                  </Link>
                </div>
              ) : (
                <p className="text-gray-500">No maintenance history found.</p>
              )}
            </div>
          </div>

          {/* Repair */}
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Most Recent Repair</h3>
                <p className="text-sm text-gray-500 mt-1">Track repairs and replaced parts.</p>
              </div>
              {can("64") && (
                <button
                  onClick={() => setShowRepairHistoryModal(true)}
                  className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  type="button"
                >
                  New
                </button>
              )}
            </div>

            <div className="mt-5">
              {mostRecentRepair ? (
                <div className="space-y-2 text-gray-700">
                  <p>
                    <span className="font-semibold text-gray-800">Name:</span> {mostRecentRepair.name || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Date:</span>{" "}
                    {mostRecentRepair.date ? format(mostRecentRepair.date, "PP") : "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Performed By:</span> {mostRecentRepair.performedBy || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Tech:</span> {mostRecentRepair.techName || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Parts:</span>{" "}
                    {mostRecentRepairPartNames.length ? mostRecentRepairPartNames.join(", ") : "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Notes:</span> {mostRecentRepair.description || "—"}
                  </p>

                  <Link
                    to={`/company/equipment/detail/${equipmentId}/service-history`}
                    className="inline-block mt-2 font-semibold text-blue-600 hover:text-blue-800"
                  >
                    See More →
                  </Link>
                </div>
              ) : (
                <p className="text-gray-500">No repair history found.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showReplaceModal && (
        <ModalShell
          title="Replace Equipment"
          onClose={() => setShowReplaceModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowReplaceModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
                disabled={isReplacingEquipment}
              >
                Cancel
              </button>
              <button
                onClick={handleReplaceEquipment}
                className="py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400"
                type="button"
                disabled={isReplacingEquipment}
              >
                {isReplacingEquipment
                  ? "Saving..."
                  : addReplacementAfterSave
                    ? "Mark Replaced and Add New"
                    : "Mark Replaced"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              This will mark {equipmentDisplayName(equipment)} as inactive and set its status to Replaced.
            </div>

            <Field label="Date Uninstalled">
              <input
                type="date"
                value={replaceDate}
                onChange={(event) => setReplaceDate(event.target.value)}
                className={inputBase}
              />
            </Field>

            <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <input
                type="checkbox"
                checked={addReplacementAfterSave}
                onChange={(event) => setAddReplacementAfterSave(event.target.checked)}
                className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block font-semibold text-gray-800">Add replacement equipment next</span>
                <span className="mt-1 block text-sm text-gray-600">
                  The new equipment form will open with this customer, service location, and body of water selected.
                </span>
              </span>
            </label>
          </div>
        </ModalShell>
      )}

      {/* -----------------------------
          Make / Model Modal
         ----------------------------- */}
      {showMakeModelModal && (
        <ModalShell
          title="Edit Make and Model"
          onClose={() => setShowMakeModelModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowMakeModelModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMakeModel}
                className="py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                type="button"
              >
                Save
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4">
            <Field label="Catalog Type">
              <select
                value={catalogTypeId}
                onChange={(e) => handleCatalogTypeChange(e.target.value)}
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
                <input value={category} onChange={(e) => { setCategory(e.target.value); setTypeId(""); }} className={inputBase} />
              </Field>
            )}

            <Field label="Make">
              <select
                value={catalogMakeId}
                onChange={(e) => handleCatalogMakeChange(e.target.value)}
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
                  value={make}
                  onChange={(e) => { setMake(e.target.value); setMakeId(""); }}
                  className={`${inputBase} mt-2`}
                  placeholder="Custom Make"
                />
              )}
            </Field>

            <Field label="Model">
              <select
                value={catalogEquipmentId}
                onChange={(e) => handleCatalogEquipmentChange(e.target.value)}
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
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setModelId("");
                    setUniversalEquipmentId("");
                    setManualPdfLink("");
                  }}
                  className={`${inputBase} mt-2`}
                  placeholder="Custom Model"
                />
              )}
            </Field>

            {manualPdfLink && (
              <a
                href={manualPdfLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-blue-600 hover:text-blue-800"
              >
                View selected catalog manual
              </a>
            )}
          </div>
        </ModalShell>
      )}

      {/* -----------------------------
          Maintenance Modal
         ----------------------------- */}
      {showServiceHistoryModal && (
        <ModalShell
          title="Create Maintenance Record"
          onClose={() => setShowServiceHistoryModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowServiceHistoryModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateMaintenance}
                className="py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                type="button"
              >
                Create
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4">
            <Field label="Name">
              <input value={maintenanceName} onChange={(e) => setMaintenanceName(e.target.value)} className={inputBase} />
            </Field>

            <Field label="Date">
              <input
                type="date"
                value={maintenanceDate}
                onChange={(e) => setMaintenanceDate(e.target.value)}
                className={inputBase}
              />
            </Field>

            <Field label="Performed By">
              <select value={maintenancePerformedBy} onChange={(e) => handleMaintenancePerformedByChange(e.target.value)} className={inputBase}>
                <option value="Company">Company</option>
                <option value="Customer">Customer</option>
              </select>
            </Field>

            {maintenancePerformedBy === "Company" ? (
              <Field label="Company User">
                <select value={maintenanceCompanyUserId} onChange={(e) => setMaintenanceCompanyUserId(e.target.value)} className={inputBase}>
                  {companyUsers.length === 0 ? (
                    <option value="">No company users found</option>
                  ) : (
                    companyUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {companyUserDisplayName(u) || "Technician"}
                      </option>
                    ))
                  )}
                </select>
              </Field>
            ) : (
              <Field label="Customer Name">
                <input value={maintenanceCustomerName} onChange={(e) => setMaintenanceCustomerName(e.target.value)} className={inputBase} />
              </Field>
            )}

            <Field label="Notes">
              <textarea value={maintenanceNotes} onChange={(e) => setMaintenanceNotes(e.target.value)} className={inputBase} rows={4} />
            </Field>
          </div>
        </ModalShell>
      )}

      {/* -----------------------------
          Repair Modal
         ----------------------------- */}
      {showRepairHistoryModal && (
        <ModalShell
          title="Create Repair Record"
          onClose={() => setShowRepairHistoryModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRepairHistoryModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRepair}
                className="py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                type="button"
              >
                Create
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4">
            <Field label="Name">
              <input value={repairName} onChange={(e) => setRepairName(e.target.value)} className={inputBase} />
            </Field>

            <Field label="Date">
              <input
                type="date"
                value={repairDate}
                onChange={(e) => setRepairDate(e.target.value)}
                className={inputBase}
              />
            </Field>

            <Field label="Performed By">
              <select value={repairPerformedBy} onChange={(e) => setRepairPerformedBy(e.target.value)} className={inputBase}>
                <option value="Company">Company</option>
                <option value="Customer">Customer</option>
              </select>
            </Field>

            {repairPerformedBy === "Company" ? (
              <Field label="Company User">
                <select value={repairCompanyUserId} onChange={(e) => setRepairCompanyUserId(e.target.value)} className={inputBase}>
                  {companyUsers.length === 0 ? (
                    <option value="">No company users found</option>
                  ) : (
                    companyUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {companyUserDisplayName(u) || "Technician"}
                      </option>
                    ))
                  )}
                </select>
              </Field>
            ) : (
              <Field label="Customer Name">
                <input value={repairCustomerName} onChange={(e) => setRepairCustomerName(e.target.value)} className={inputBase} />
              </Field>
            )}

            <Field label="Parts Replaced">
              <div className="flex gap-2">
                <input value={currentPart} onChange={(e) => setCurrentPart(e.target.value)} className={inputBase} />
                <button
                  onClick={addPart}
                  className="shrink-0 py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                  type="button"
                >
                  Add
                </button>
              </div>

              {!!repairPartsReplaced.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {repairPartsReplaced.map((part, idx) => (
                    <span
                      key={`${part}-${idx}`}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm font-semibold"
                    >
                      {part}
                      <button
                        onClick={() => removePart(idx)}
                        className="text-gray-500 hover:text-red-600 font-bold"
                        aria-label="Remove part"
                        type="button"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Notes">
              <textarea value={repairNotes} onChange={(e) => setRepairNotes(e.target.value)} className={inputBase} rows={4} />
            </Field>
          </div>
        </ModalShell>
      )}

      {/* -----------------------------
          Delete Modal
         ----------------------------- */}
      {showDeleteModal && (
        <ModalShell
          title="Delete Equipment"
          onClose={() => setShowDeleteModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
              >
                Cancel
              </button>
              <button

                onClick={async () => {
                  await handleDelete();
                }}
                className="py-2 px-5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition"
                type="button"
              >
                Delete
              </button>
            </div>
          }
        >
          <p className="text-gray-700">Are you sure you want to delete this equipment? This action cannot be undone.</p>
        </ModalShell>
      )}
    </div>
  );
};

export default EquipmentDetail;
