import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  query,
  collection,
  getDocs,
  limit,
  where,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  orderBy,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from "react-select";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { removeRecurringServiceStopFromPlannedRoutes } from "../../../utils/recurringRouteSync";
import { salesCollectionNames } from "../../../utils/models/Sales";
import { recurringFrequencyToAgreementService } from "../../../utils/sales/agreementCadence";
import { appConfirm } from "../../../utils/appDialog";
import { reportAppError } from "../../../utils/errorReporting";
import ShareItemButton from "../../components/share/ShareItemButton";

import { v4 as uuidv4 } from 'uuid';
const functions = getFunctions();

const jobTaskTypeOptions = [
  "Basic",
  "Clean",
  "Clean Filter",
  "Maintenance",
  "Repair",
  "Empty Water",
  "Fill Water",
  "Inspection",
  "Install",
  "Remove",
  "Replace",
];

const getDateValue = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateValue = (value, dateFormat = "MMM d, yyyy") => {
  const date = getDateValue(value);
  return date ? format(date, dateFormat) : "—";
};

const normalizeDurationHistoryPoint = (docSnap) => {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    ...data,
    durationMinutes: Number(data.durationMinutes || 0),
    completedAt: getDateValue(data.completedAt),
    serviceDate: getDateValue(data.serviceDate),
    createdAt: getDateValue(data.createdAt),
    updatedAt: getDateValue(data.updatedAt),
  };
};

const RecurringServiceStopDetails = () => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    user,
    dataBaseUser,
    accountType,
  } = useContext(Context);
  const { recurringServiceStopId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(() => (
    searchParams.get("edit") === "1" || searchParams.get("edit") === "true"
  ));

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [serviceStopList, setServiceStopList] = useState([]);
  const [pastServiceStopList, setPastServiceStopList] = useState([]);
  const [recurringServiceStopTasks, setRecurringServiceStopTasks] = useState([]);
  const [durationHistory, setDurationHistory] = useState([]);
  const [loadingDurationHistory, setLoadingDurationHistory] = useState(false);
  const [durationAction, setDurationAction] = useState("");
  const [estimatedTimeInput, setEstimatedTimeInput] = useState("");

  const [showAddTask, setShowAddTask] = useState(false);
  const [savingTask, setSavingTask] = useState(false);

  const [newTask, setNewTask] = useState({
    name: "",
    description: "",
    type: "",
    contractedRate: "",
    estimatedTime: "",
    status: "Not Finished",
  });

  const [recurringServiceStop, setRecurringServiceStop] = useState({
    id: "",
    internalId: "",
    type: "",
    typeId: "",
    typeImage: "",
    customerId: "",
    customerName: "",

    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    latitude: "",
    longitude: "",

    tech: "",
    techId: "",
    dateCreated: "",
    startDate: "",
    endDate: "",
    noEndDate: "",
    frequency: "",
    day: "",
    daysOfWeek: "",
    lastCreated: "",

    serviceLocationId: "",
    estimatedTime: "",
    estimatedDuration: "",
    adaptiveEstimatedDuration: "",
    durationStats: {},
    durationEstimateSource: "",
    durationEstimateUpdatedAt: "",
    otherCompany: "",
    laborContractId: "",
    contractedCompanyId: "",
    salesAgreementId: "",
    salesBillingSubscriptionId: "",
  });

  const frequencyOptions = useMemo(
    () =>
      ["Weekly", "Twice Weekly", "Three Times Weekly", "Biweekly", "Monthly", "Every 2 Weeks", "Every 4 Weeks", "Custom"].map((v) => ({
        value: v,
        label: v,
      })),
    []
  );

  const daysOptions = useMemo(
    () =>
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => ({
        value: d,
        label: d,
      })),
    []
  );

  const [selectedFrequency, setSelectedFrequency] = useState(null);
  const [selectedDays, setSelectedDays] = useState([]);
  const errorContext = useMemo(() => ({
    userId: user?.uid || dataBaseUser?.id || dataBaseUser?.uid || "",
    userEmail: user?.email || dataBaseUser?.email || "",
    accountType: accountType || dataBaseUser?.accountType || "",
    companyId: recentlySelectedCompany || "",
    companyName: recentlySelectedCompanyName || "",
  }), [accountType, dataBaseUser, recentlySelectedCompany, recentlySelectedCompanyName, user]);

  const reportDetailsError = useCallback((error, options = {}) => (
    reportAppError(error, {
      context: errorContext,
      source: "recurring-service-stop-detail-page",
      where: options.where || "RecurringServiceStopDetails",
      title: options.title,
      description: options.description,
      severity: options.severity || "error",
      data: {
        recurringServiceStopId,
        recurringServiceStopInternalId: recurringServiceStop.internalId || "",
        customerId: recurringServiceStop.customerId || "",
        technicianId: recurringServiceStop.techId || "",
        ...options.data,
      },
    })
  ), [
    errorContext,
    recurringServiceStop.customerId,
    recurringServiceStop.internalId,
    recurringServiceStop.techId,
    recurringServiceStopId,
  ]);

  const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 12,
    colors: {
      ...theme.colors,
      primary25: "#EFF6FF",
      primary: "#2563EB",
      neutral0: "#FFFFFF",
      neutral20: "#D1D5DB",
      neutral30: "#9CA3AF",
    },
  });

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      minHeight: 44,
      borderRadius: 12,
      borderColor: state.isFocused ? "#2563EB" : "#D1D5DB",
      boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.25)" : "none",
      "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#9CA3AF" },
    }),
    menu: (base) => ({ ...base, borderRadius: 12, overflow: "hidden" }),
  };

  const loadDurationHistory = useCallback(async () => {
    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    try {
      setLoadingDurationHistory(true);
      const historyQuery = query(
        collection(
          db,
          "companies",
          recentlySelectedCompany,
          "recurringServiceStop",
          recurringServiceStopId,
          "durationHistory"
        ),
        orderBy("completedAt", "desc"),
        limit(50)
      );
      const historySnap = await getDocs(historyQuery);
      setDurationHistory(
        historySnap.docs
          .map(normalizeDurationHistoryPoint)
          .filter((point) => point.includedInAverage !== false)
      );
    } catch (error) {
      console.error("Failed to load duration history:", error);
      await reportDetailsError(error, {
        where: "RecurringServiceStopDetails.loadDurationHistory",
        title: "Recurring service stop duration history failed to load",
        description: "The recurring service stop detail page could not load duration history.",
      });
      toast.error("Failed to load duration history");
    } finally {
      setLoadingDurationHistory(false);
    }
  }, [recentlySelectedCompany, recurringServiceStopId, reportDetailsError]);

  const refreshDurationSummary = useCallback(async () => {
    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    const rssRef = doc(
      db,
      "companies",
      recentlySelectedCompany,
      "recurringServiceStop",
      recurringServiceStopId
    );
    const rssSnap = await getDoc(rssRef);
    if (!rssSnap.exists()) return;

    const rssData = rssSnap.data() || {};
    const nextEstimatedTime = rssData.estimatedTime ?? rssData.estimatedDuration ?? "";

    setRecurringServiceStop((prev) => ({
      ...prev,
      estimatedTime: nextEstimatedTime,
      estimatedDuration: rssData.estimatedDuration ?? nextEstimatedTime,
      adaptiveEstimatedDuration: rssData.adaptiveEstimatedDuration ?? "",
      durationStats: rssData.durationStats || {},
      durationEstimateSource: rssData.durationEstimateSource || "",
      durationEstimateUpdatedAt: rssData.durationEstimateUpdatedAt || "",
    }));
    setEstimatedTimeInput(nextEstimatedTime === "" || nextEstimatedTime === null ? "" : String(nextEstimatedTime));
  }, [recentlySelectedCompany, recurringServiceStopId]);

  useEffect(() => {
    loadDurationHistory();
  }, [loadDurationHistory]);

  useEffect(() => {
    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    (async () => {
      try {
        setLoading(true);

        const docRef = doc(
          db,
          "companies",
          recentlySelectedCompany,
          "recurringServiceStop",
          recurringServiceStopId
        );
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          toast.error("Recurring service stop not found");
          setLoading(false);
          return;
        }

        const rssData = docSnap.data();

        setRecurringServiceStop((prev) => ({
          ...prev,
          id: rssData.id,
          internalId: rssData.internalId,
          type: rssData.type,
          typeId: rssData.typeId,
          typeImage: rssData.typeImage,
          customerId: rssData.customerId,
          customerName: rssData.customerName,

          streetAddress: rssData.address?.streetAddress || "",
          city: rssData.address?.city || "",
          state: rssData.address?.state || "",
          zip: rssData.address?.zip || "",
          latitude: rssData.address?.latitude || "",
          longitude: rssData.address?.longitude || "",

          tech: rssData.tech,
          techId: rssData.techId,
          dateCreated: rssData.dateCreated,
          startDate: rssData.startDate,
          endDate: rssData.endDate,
          noEndDate: rssData.noEndDate,
          frequency: rssData.frequency,
          day: rssData.day,
          daysOfWeek: rssData.daysOfWeek || "",
          lastCreated: rssData.lastCreated,

          serviceLocationId: rssData.serviceLocationId,
          estimatedTime: rssData.estimatedTime ?? rssData.estimatedDuration ?? "",
          estimatedDuration: rssData.estimatedDuration ?? rssData.estimatedTime ?? "",
          adaptiveEstimatedDuration: rssData.adaptiveEstimatedDuration ?? "",
          durationStats: rssData.durationStats || {},
          durationEstimateSource: rssData.durationEstimateSource || "",
          durationEstimateUpdatedAt: rssData.durationEstimateUpdatedAt || "",
          otherCompany: rssData.otherCompany,
          laborContractId: rssData.laborContractId,
          contractedCompanyId: rssData.contractedCompanyId,
          salesAgreementId: rssData.salesAgreementId || "",
          salesBillingSubscriptionId: rssData.salesBillingSubscriptionId || "",
        }));
        const loadedEstimatedTime = rssData.estimatedTime ?? rssData.estimatedDuration ?? "";
        setEstimatedTimeInput(loadedEstimatedTime === "" || loadedEstimatedTime === null ? "" : String(loadedEstimatedTime));

        let tasks = [];

        if (Array.isArray(rssData.tasks)) {
          tasks = rssData.tasks;
        } else if (Array.isArray(rssData.serviceTasks)) {
          tasks = rssData.serviceTasks;
        } else if (Array.isArray(rssData.recurringServiceStopTasks)) {
          tasks = rssData.recurringServiceStopTasks;
        }

        setRecurringServiceStopTasks(tasks);

        const start = rssData.startDate?.toDate?.()
          ? format(rssData.startDate.toDate(), "MMMM d, yyyy")
          : "";
        const end = rssData.endDate?.toDate?.()
          ? format(rssData.endDate.toDate(), "MMMM d, yyyy")
          : "";

        setStartDate(start);
        setEndDate(end);

        const freq = rssData.frequency
          ? { value: rssData.frequency, label: rssData.frequency }
          : null;
        setSelectedFrequency(freq);

        const daysRaw = rssData.daysOfWeek;
        const daysArr = Array.isArray(daysRaw)
          ? daysRaw
          : typeof daysRaw === "string"
            ? daysRaw.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
        setSelectedDays(daysArr.map((d) => ({ value: d, label: d })));

        const qUpcoming = query(
          collection(db, "companies", recentlySelectedCompany, "serviceStops"),
          where("recurringServiceStopId", "==", recurringServiceStopId),
          where("serviceDate", ">=", new Date())
        );

        const upSnap = await getDocs(qUpcoming);
        setServiceStopList(
          upSnap.docs.map((d) => {
            const data = d.data();
            const date = data.serviceDate?.toDate?.()
              ? format(data.serviceDate.toDate(), "MMMM d, yyyy")
              : "N/A";
            return {
              id: data.id || d.id,
              tech: data.tech,
              techId: data.techId || "",
              customerName: data.customerName,
              streetAddress: data.address?.streetAddress || "",
              jobId: data.jobId || "",
              jobInternalId: data.jobInternalId || "",
              internalId: data.internalId,
              operationStatus: data.operationStatus || "",
              serviceLocationId: data.serviceLocationId || "",
              laborContractId: data.laborContractId || "",
              date,
            };
          })
        );

        const qPast = query(
          collection(db, "companies", recentlySelectedCompany, "serviceStops"),
          where("recurringServiceStopId", "==", recurringServiceStopId),
          where("serviceDate", "<", new Date()),
          limit(5)
        );

        const pastSnap = await getDocs(qPast);
        setPastServiceStopList(
          pastSnap.docs.map((d) => {
            const data = d.data();
            const date = data.serviceDate?.toDate?.()
              ? format(data.serviceDate.toDate(), "MMMM d, yyyy")
              : "N/A";
            return {
              id: data.id || d.id,
              tech: data.tech,
              customerName: data.customerName,
              streetAddress: data.address?.streetAddress || "",
              jobId: data.jobId,
              operationStatus: data.operationStatus || "",
              internalId: data.internalId,
              date,
            };
          })
        );
      } catch (error) {
        console.error(error);
        await reportDetailsError(error, {
          where: "RecurringServiceStopDetails.loadRecurringServiceStop",
          title: "Recurring service stop detail failed to load",
          description: "The recurring service stop detail page failed while loading the template, upcoming stops, past stops, or schedule metadata.",
          severity: "critical",
        });
        toast.error("Failed to load recurring service stop");
      } finally {
        setLoading(false);
      }
    })();
  }, [recentlySelectedCompany, recurringServiceStopId, reportDetailsError]);

  const deleteRSS = async (e) => {
    e.preventDefault();
    try {
      const ok = await appConfirm({
        title: "Delete Recurring Service Stop",
        message: "Delete this recurring service stop and all linked service stops? This cannot be undone.",
        confirmLabel: "Delete Stop",
        variant: "danger",
      });
      if (!ok) return;

      const callable = httpsCallable(functions, "deleteRecurringServiceStop");
      await callable({
        stopId: recurringServiceStopId,
        companyId: recentlySelectedCompany,
        includePastServiceStops: true,
      });
      await removeRecurringServiceStopFromPlannedRoutes({
        db,
        companyId: recentlySelectedCompany,
        recurringServiceStopId,
      });

      toast.success("Deleted");
      navigate("/company/recurringServiceStop");
    } catch (err) {
      console.error(err);
      await reportDetailsError(err, {
        where: "RecurringServiceStopDetails.deleteRSS",
        title: "Recurring service stop delete failed",
        description: "Deleting the recurring service stop or removing it from planned routes failed.",
        severity: "critical",
      });
      toast.error("Failed to delete");
    }
  };

  const editRSS = (e) => {
    e.preventDefault();
    setEdit(true);
  };

  const cancelEdit = (e) => {
    e.preventDefault();
    setEdit(false);

    setSelectedFrequency(
      recurringServiceStop.frequency
        ? { value: recurringServiceStop.frequency, label: recurringServiceStop.frequency }
        : null
    );

    const daysRaw = recurringServiceStop.daysOfWeek;
    const daysArr = Array.isArray(daysRaw)
      ? daysRaw
      : typeof daysRaw === "string"
        ? daysRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    setSelectedDays(daysArr.map((d) => ({ value: d, label: d })));
    setEstimatedTimeInput(
      recurringServiceStop.estimatedTime === undefined || recurringServiceStop.estimatedTime === null
        ? ""
        : String(recurringServiceStop.estimatedTime)
    );
  };

  const saveEdits = async (e) => {
    e.preventDefault();
    try {
      const rssRef = doc(
        db,
        "companies",
        recentlySelectedCompany,
        "recurringServiceStop",
        recurringServiceStopId
      );

      const frequency = selectedFrequency?.value || recurringServiceStop.frequency || "";
      const selectedDayValues = (selectedDays || []).map((d) => d.value).filter(Boolean);
      const daysOfWeek = selectedDayValues.join(",");
      const day = selectedDayValues[0] || recurringServiceStop.day || "";
      const serviceScheduleUpdate = recurringFrequencyToAgreementService({
        frequency,
        daysOfWeek,
        day,
      });

      await updateDoc(rssRef, {
        frequency,
        daysOfWeek,
        day,
        ...serviceScheduleUpdate,
        updatedAt: serverTimestamp(),
      });

      let linkedAgreementId = recurringServiceStop.salesAgreementId || "";
      let linkedBillingSubscriptionId = recurringServiceStop.salesBillingSubscriptionId || "";

      if (!linkedAgreementId) {
        const linkedAgreementsSnap = await getDocs(query(
          collection(db, salesCollectionNames.agreements),
          where("companyId", "==", recentlySelectedCompany),
          where("recurringServiceStopId", "==", recurringServiceStopId),
          limit(1)
        ));
        const linkedAgreementDoc = linkedAgreementsSnap.docs[0];
        linkedAgreementId = linkedAgreementDoc?.id || "";
        linkedBillingSubscriptionId = linkedBillingSubscriptionId || linkedAgreementDoc?.data()?.billingSubscriptionId || "";
      }

      const linkedWrites = [];
      if (linkedAgreementId) {
        linkedWrites.push(updateDoc(doc(db, salesCollectionNames.agreements, linkedAgreementId), {
          ...serviceScheduleUpdate,
          recurringServiceStopId,
          operationsSetupStatus: "recurringServiceStopCreated",
          operationsSetupUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      }

      if (linkedBillingSubscriptionId) {
        linkedWrites.push(updateDoc(doc(db, salesCollectionNames.billingSubscriptions, linkedBillingSubscriptionId), {
          ...serviceScheduleUpdate,
          recurringServiceStopId,
          operationsSetupStatus: "recurringServiceStopCreated",
          operationsSetupUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      }

      if (linkedWrites.length) await Promise.all(linkedWrites);

      setRecurringServiceStop((prev) => ({
        ...prev,
        frequency,
        daysOfWeek,
        day,
        ...serviceScheduleUpdate,
        salesAgreementId: linkedAgreementId || prev.salesAgreementId,
        salesBillingSubscriptionId: linkedBillingSubscriptionId || prev.salesBillingSubscriptionId,
      }));

      toast.success("Saved");
      setEdit(false);
    } catch (err) {
      console.error(err);
      await reportDetailsError(err, {
        where: "RecurringServiceStopDetails.saveEdits",
        title: "Recurring service stop schedule save failed",
        description: "Saving recurring service stop schedule changes or linked sales records failed.",
        data: {
          selectedFrequency: selectedFrequency?.value || "",
          selectedDays: (selectedDays || []).map((day) => day.value || day).join(","),
        },
      });
      toast.error("Failed to save changes");
    }
  };

  const runDurationAction = async (actionName, callback) => {
    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    try {
      setDurationAction(actionName);
      await callback();
      await Promise.all([refreshDurationSummary(), loadDurationHistory()]);
    } catch (error) {
      console.error(`Failed duration action ${actionName}:`, error);
      await reportDetailsError(error, {
        where: `RecurringServiceStopDetails.runDurationAction.${actionName}`,
        title: "Recurring service stop duration action failed",
        description: `The recurring service stop duration action "${actionName}" failed.`,
        data: {
          actionName,
          estimatedTimeInput,
        },
      });
      toast.error(error?.message || "Duration update failed");
    } finally {
      setDurationAction("");
    }
  };

  const saveManualEstimatedDuration = async () => {
    const estimateMinutes = Math.round(Number(estimatedTimeInput));
    if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) {
      toast.error("Estimated duration must be greater than 0 minutes");
      return;
    }

    await runDurationAction("saveEstimate", async () => {
      const callable = httpsCallable(functions, "setRecurringServiceStopEstimatedDuration");
      await callable({
        companyId: recentlySelectedCompany,
        recurringServiceStopId,
        estimatedMinutes: estimateMinutes,
      });
      toast.success("Estimated duration saved");
    });
  };

  const resetDurationToAverage = async () => {
    await runDurationAction("resetAverage", async () => {
      const callable = httpsCallable(functions, "recalculateRecurringServiceStopDurationEstimate");
      const result = await callable({
        companyId: recentlySelectedCompany,
        recurringServiceStopId,
      });
      const sampleCount = Number(result.data?.sampleCount || 0);
      if (sampleCount > 0) {
        toast.success("Estimate reset to historic average");
      } else {
        toast.error("No completed stop durations found");
      }
    });
  };

  const clearDurationHistory = async () => {
    if (!durationHistory.length) return;

    const ok = await appConfirm({
      title: "Clear Duration History",
      message: "Clear every duration data point for this recurring service stop? The current estimate will stay as the manual estimate.",
      confirmLabel: "Clear History",
      variant: "danger",
    });
    if (!ok) return;

    await runDurationAction("clearHistory", async () => {
      const callable = httpsCallable(functions, "clearRecurringServiceStopDurationHistory");
      await callable({
        companyId: recentlySelectedCompany,
        recurringServiceStopId,
      });
      toast.success("Duration history cleared");
    });
  };

  const deleteDurationPoint = async (point) => {
    const ok = await appConfirm({
      title: "Delete Duration Point",
      message: `Delete the ${formatMinutes(point.durationMinutes)} duration data point?`,
      confirmLabel: "Delete Point",
      variant: "danger",
    });
    if (!ok) return;

    await runDurationAction(`delete-${point.id}`, async () => {
      const callable = httpsCallable(functions, "deleteRecurringServiceStopDurationPoint");
      await callable({
        companyId: recentlySelectedCompany,
        recurringServiceStopId,
        durationPointId: point.id,
      });
      toast.success("Duration point deleted");
    });
  };

  const openInMaps = () => {
    const address = `${recurringServiceStop.streetAddress} ${recurringServiceStop.city} ${recurringServiceStop.state} ${recurringServiceStop.zip}`.trim();
    const url = `https://www.google.com/maps/place/${encodeURIComponent(address)}`;
    window.open(url, "_blank");
  };

  const formatCurrencyFromCents = (cents) => {
    const value = Number(cents || 0) / 100;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatMinutes = (minutes) => {
    if (!minutes && minutes !== 0) return "—";
    return `${minutes} min`;
  };

  const Field = ({ label, value, children }) => (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-gray-600">{label}</p>
      {children ? children : <p className="text-gray-800">{value || "—"}</p>}
    </div>
  );

  const handleNewTaskChange = (field, value) => {
    setNewTask((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const resetNewTaskForm = () => {
    setNewTask({
      name: "",
      description: "",
      type: "",
      contractedRate: "",
      estimatedTime: "",
      status: "Not Finished",
    });
  };

  const saveNewRecurringTask = async (e) => {
    e.preventDefault();

    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    if (!newTask.name.trim()) {
      toast.error("Task name is required");
      return;
    }

    if (!newTask.type) {
      toast.error("Task type is required");
      return;
    }

    try {
      setSavingTask(true);
      let recurringTaskId = "com_rss_tas_" + uuidv4()
      const recurringTaskPayload = {
        id: recurringTaskId,
        name: newTask.name.trim(),
        description: newTask.description.trim(),
        type: newTask.type,
        contractedRate: Number(newTask.contractedRate || 0),
        estimatedTime: Number(newTask.estimatedTime || 0),
        status: newTask.status || "Not Finished",
        isTaskGroup: false,
        taskGroupId: "",
        taskGroupTaskId: ""
      };

      const rssRef = doc(
        db,
        "companies",
        recentlySelectedCompany,
        "recurringServiceStop",
        recurringServiceStopId,
        "tasks",
        recurringTaskId
      );

      await setDoc(rssRef, recurringTaskPayload);

      const futureStopsQuery = query(
        collection(db, "companies", recentlySelectedCompany, "serviceStops"),
        where("recurringServiceStopId", "==", recurringServiceStopId),
        where("serviceDate", ">=", new Date())
      );

      const futureStopsSnap = await getDocs(futureStopsQuery);

      await Promise.all(
        futureStopsSnap.docs.map(async (serviceStopDoc) => {
          const stop = serviceStopDoc.data();
          const stopId = stop.id || serviceStopDoc.id;
          let serviceStopTaskId = "com_ss_tas_" + uuidv4()

          const serviceStopTaskPayload = {
            id: serviceStopTaskId,
            name: newTask.name.trim(),
            type: newTask.type,
            status: newTask.status || "Not Finished",
            contractedRate: Number(newTask.contractedRate || 0),
            estimatedTime: Number(newTask.estimatedTime || 0),
            customerApproval: false,
            actualTime: 0,

            workerId: stop.techId || recurringServiceStop.techId || "",
            workerType: stop.workerType || "",
            workerName: stop.tech || recurringServiceStop.tech || "",

            laborContractId: stop.laborContractId || recurringServiceStop.laborContractId || "",

            serviceStopId: {
              id: stopId,
              internalId: stop.internalId || "",
            },
            jobId: {
              id: stop.jobId || "",
              internalId: stop.jobInternalId || "",
            },
            recurringServiceStopId: {
              id: recurringServiceStopId,
              internalId: recurringServiceStop.internalId || "",
            },
            jobTaskId: "",
            recurringServiceStopTaskId: recurringTaskPayload.id,
            equipmentId: "",
            serviceLocationId: stop.serviceLocationId || recurringServiceStop.serviceLocationId || "",
            bodyOfWaterId: "",
            shoppingListItemId: "",
          };

          await setDoc(
            doc(
              db,
              "companies",
              recentlySelectedCompany,
              "serviceStops",
              stopId,
              "tasks",
              serviceStopTaskId
            ),
            serviceStopTaskPayload
          );
        })
      );

      setRecurringServiceStopTasks((prev) => [recurringTaskPayload, ...prev]);
      setShowAddTask(false);
      resetNewTaskForm();

      toast.success(
        `Task added to recurring stop and ${futureStopsSnap.docs.length} future service stop${futureStopsSnap.docs.length === 1 ? "" : "s"
        }`
      );
    } catch (error) {
      console.error(error);
      await reportDetailsError(error, {
        where: "RecurringServiceStopDetails.saveNewRecurringTask",
        title: "Recurring service stop task creation failed",
        description: "Adding a task to the recurring service stop and its future service stops failed.",
        data: {
          newTaskName: newTask.name,
          newTaskType: newTask.type,
        },
      });
      toast.error("Failed to add recurring task");
    } finally {
      setSavingTask(false);
    }
  };

  const durationStats = recurringServiceStop.durationStats || {};
  const currentEstimateMinutes = recurringServiceStop.estimatedTime ?? recurringServiceStop.estimatedDuration ?? "";
  const historicAverageMinutes = durationStats.averageMinutes ?? recurringServiceStop.historicalAverageDuration ?? null;
  const durationSampleCount = Number(durationStats.sampleCount ?? recurringServiceStop.historicalDurationSampleCount ?? durationHistory.length ?? 0);
  const durationSourceLabel = recurringServiceStop.durationEstimateSource === "durationHistory"
    ? "Historic Average"
    : recurringServiceStop.durationEstimateSource === "manual"
      ? "Manual"
      : "Default";
  const durationActionInProgress = Boolean(durationAction);
  const CompactServiceStopSection = ({ title, subtitle, stops, emptyMessage }) => (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-lg font-bold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
      </div>

      <div className="mt-4 max-h-[28rem] overflow-y-auto rounded-md border border-slate-200 bg-white">
        {stops?.length ? (
          stops.map((serviceStop) => (
            <button
              key={serviceStop.id}
              type="button"
              onClick={() => navigate(`/company/serviceStops/detail/${serviceStop.id}`)}
              className="block w-full border-b border-slate-100 px-3 py-3 text-left transition last:border-b-0 hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {serviceStop.internalId || "—"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{serviceStop.date || "N/A"}</p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                  {serviceStop.operationStatus || "Scheduled"}
                </span>
              </div>
              <p className="mt-2 truncate text-xs font-medium text-slate-600">
                {serviceStop.tech || "Unassigned"}
              </p>
            </button>
          ))
        ) : (
          <div className="px-3 py-5 text-sm text-slate-500">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-screen-xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-40 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link
                to="/company/recurringServiceStop"
                className="app-back-link"
              >
                &larr; Back to Recurring Service Stops
              </Link>
              <h1 className="text-3xl font-bold text-slate-950">Recurring Service Stop Detail</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                <span className="font-semibold text-slate-900">
                  {recurringServiceStop.internalId || "—"}
                </span>{" "}
                <span className="text-slate-400">•</span>{" "}
                {recurringServiceStop.customerName || "—"}
              </p>
            </div>

            {!edit ? (
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <ShareItemButton
                  type="recurringServiceStop"
                  recordId={recurringServiceStopId}
                  title={recurringServiceStop.type || recurringServiceStop.serviceStopType || "Recurring Service Stop"}
                  subtitle={[recurringServiceStop.customerName, recurringServiceStop.internalId, recurringServiceStop.frequency].filter(Boolean).join(" - ")}
                  companyId={recentlySelectedCompany}
                  customerId={recurringServiceStop.customerId}
                  collectionPath={`companies/${recentlySelectedCompany}/recurringServiceStop`}
                  webPath={`/company/recurringServiceStop/details/${recurringServiceStopId}`}
                />
                <Link
                  to="/company/recurringServiceStop"
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Back
                </Link>
                <button
                  onClick={editRSS}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <button
                  onClick={saveEdits}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteRSS}
                  className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">Details</h2>
                  <p className="text-sm text-slate-600">Core recurring stop information</p>
                </div>

                <button
                  onClick={openInMaps}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  title="Open in Google Maps"
                >
                  Open in Maps
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Internal Id" value={recurringServiceStop.internalId} />
                <Field label="Customer" value={recurringServiceStop.customerName} />
                <Field label="Street Address" value={recurringServiceStop.streetAddress} />
                <Field label="Tech" value={recurringServiceStop.tech} />
                <Field label="Start Date" value={startDate} />
                <Field label="End Date" value={recurringServiceStop.noEndDate ? "No End Date" : endDate} />

                <Field label="Frequency">
                  {!edit ? (
                    <p className="text-gray-800">{recurringServiceStop.frequency || "—"}</p>
                  ) : (
                    <Select
                      value={selectedFrequency}
                      options={frequencyOptions}
                      onChange={setSelectedFrequency}
                      isSearchable
                      placeholder="Select frequency"
                      theme={selectTheme}
                      styles={selectStyles}
                    />
                  )}
                </Field>

                <Field label="Day of Week">
                  {!edit ? (
                    <p className="text-gray-800">
                      {recurringServiceStop.daysOfWeek || recurringServiceStop.day || "—"}
                    </p>
                  ) : (
                    <Select
                      value={selectedDays}
                      options={daysOptions}
                      onChange={setSelectedDays}
                      isMulti
                      placeholder="Select days"
                      theme={selectTheme}
                      styles={selectStyles}
                    />
                  )}
                </Field>

                <Field label="Estimated Time" value={formatMinutes(recurringServiceStop.estimatedTime)} />
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Tasks</h3>
                  <p className="text-sm text-slate-600">Tasks configured for this recurring stop</p>
                </div>

                {!showAddTask && (
                  <button
                    onClick={() => setShowAddTask(true)}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Add Task
                  </button>
                )}
              </div>

              {showAddTask && (
                <form
                  onSubmit={saveNewRecurringTask}
                  className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-600">
                        Task Name
                      </label>
                      <input
                        type="text"
                        value={newTask.name}
                        onChange={(e) => handleNewTaskChange("name", e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2"
                        placeholder="Brush walls"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-600">
                        Type
                      </label>
                      <select
                        value={newTask.type}
                        onChange={(e) => handleNewTaskChange("type", e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                      >
                        <option value="">Select task type</option>
                        {jobTaskTypeOptions.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-600">
                        Contracted Rate (cents)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newTask.contractedRate}
                        onChange={(e) => handleNewTaskChange("contractedRate", e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2"
                        placeholder="2500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-600">
                        Estimated Time (mins)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newTask.estimatedTime}
                        onChange={(e) => handleNewTaskChange("estimatedTime", e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2"
                        placeholder="30"
                      />
                    </div>
                  </div>

                  <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
                    Saving this task will also add it to all future service stops tied to this recurring service stop.
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={savingTask}
                      className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingTask ? "Saving..." : "Save Task"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowAddTask(false);
                        resetNewTaskForm();
                      }}
                      className="inline-flex items-center justify-center rounded-md bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {!!recurringServiceStopTasks?.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                          Task Name
                        </th>
                        <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                          Type
                        </th>
                        <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                          Contracted Rate
                        </th>
                        <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                          Estimated Time
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200">
                      {recurringServiceStopTasks.map((task, index) => (
                        <tr key={task.id || `${task.name}-${index}`} className="transition-colors hover:bg-slate-50">
                          <td className="whitespace-nowrap p-4 font-medium text-slate-900">
                            {task.name || "—"}
                          </td>
                          <td className="whitespace-nowrap p-4 text-slate-700">
                            {task.type || "—"}
                          </td>
                          <td className="whitespace-nowrap p-4 text-slate-700">
                            {formatCurrencyFromCents(task.contractedRate)}
                          </td>
                          <td className="whitespace-nowrap p-4 text-slate-700">
                            {formatMinutes(task.estimatedTime)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500">
                  No tasks found.
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Adaptive Duration</h3>
                  <p className="text-sm text-slate-600">Historic stop timing and current estimate</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={resetDurationToAverage}
                    disabled={durationActionInProgress}
                    className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reset to Average
                  </button>
                  <button
                    type="button"
                    onClick={clearDurationHistory}
                    disabled={durationActionInProgress || durationHistory.length === 0}
                    className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear History
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Current Estimate" value={formatMinutes(currentEstimateMinutes)} />
                <Field label="Historic Average" value={formatMinutes(historicAverageMinutes)} />
                <Field label="Data Points" value={String(durationSampleCount)} />
                <Field label="Estimate Source" value={durationSourceLabel} />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 border-y border-slate-200 py-4 md:grid-cols-[minmax(180px,260px)_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-600">
                    Estimated Duration (mins)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={estimatedTimeInput}
                    onChange={(e) => setEstimatedTimeInput(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </div>

                <button
                  type="button"
                  onClick={saveManualEstimatedDuration}
                  disabled={durationActionInProgress}
                  className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {durationAction === "saveEstimate" ? "Saving..." : "Save Estimate"}
                </button>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full bg-white">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                        Service Stop
                      </th>
                      <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                        Completed
                      </th>
                      <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                        Tech
                      </th>
                      <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                        Duration
                      </th>
                      <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-slate-600">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {loadingDurationHistory ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-slate-500">
                          Loading duration history...
                        </td>
                      </tr>
                    ) : durationHistory.length ? (
                      durationHistory.map((point) => (
                        <tr key={point.id} className="transition-colors hover:bg-slate-50">
                          <td className="whitespace-nowrap p-4 text-slate-700">
                            {point.serviceStopId ? (
                              <Link
                                to={`/company/serviceStops/detail/${point.serviceStopId}`}
                                className="font-medium text-blue-600 hover:underline"
                              >
                                {point.serviceStopInternalId || point.serviceStopId}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="whitespace-nowrap p-4 text-slate-700">
                            {formatDateValue(point.completedAt || point.serviceDate, "MMM d, yyyy h:mm a")}
                          </td>
                          <td className="whitespace-nowrap p-4 text-slate-700">{point.techName || "—"}</td>
                          <td className="whitespace-nowrap p-4 font-medium text-slate-900">
                            {formatMinutes(point.durationMinutes)}
                          </td>
                          <td className="whitespace-nowrap p-4">
                            <button
                              type="button"
                              onClick={() => deleteDurationPoint(point)}
                              disabled={durationActionInProgress}
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {durationAction === `delete-${point.id}` ? "Deleting..." : "Delete"}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-6 text-slate-500">
                          No duration history found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </main>

          <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            <CompactServiceStopSection
              title="Upcoming Service"
              subtitle={`${serviceStopList.length} future service stop${serviceStopList.length === 1 ? "" : "s"}`}
              stops={serviceStopList}
              emptyMessage="No upcoming service stops found."
            />
            <CompactServiceStopSection
              title="Recent Service"
              subtitle={`${pastServiceStopList.length} recent service stop${pastServiceStopList.length === 1 ? "" : "s"}`}
              stops={pastServiceStopList}
              emptyMessage="No recent service stops found."
            />
          </aside>
        </div>
      </div>
    </div>
  );
};

export default RecurringServiceStopDetails;
