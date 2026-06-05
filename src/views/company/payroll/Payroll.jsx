import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { Link } from "react-router-dom";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { v4 as uuidv4 } from "uuid";

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const dateFromValue = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shortDate = (value) => {
  const date = dateFromValue(value);
  return date ? date.toLocaleDateString() : "-";
};

const isoDate = (date) => date.toISOString().slice(0, 10);

const isoDateTime = (value) => {
  const date = dateFromValue(value);
  return date ? date.toISOString() : "";
};

const debugDateTime = (value) => isoDateTime(value) || "-";

const serializeForDebug = (value) => {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeForDebug);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeForDebug(nestedValue)])
    );
  }
  return value;
};

const csvCell = (value) => {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
};

const downloadCsv = (fileName, rows) => {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const statusLabel = (value) =>
  String(value || "unknown")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const StatCard = ({ title, value, subtitle }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
  </div>
);

const StatusPill = ({ status }) => (
  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
    {statusLabel(status)}
  </span>
);

const DetailField = ({ label, value, accent }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 break-words text-sm font-semibold ${accent ? "text-blue-700" : "text-slate-900"}`}>
      {value === null || value === undefined || value === "" ? "-" : String(value)}
    </p>
  </div>
);

const emptyPaymentForm = () => ({
  paidDate: isoDate(new Date()),
  paymentMode: "manual",
  paymentReference: "",
  exportBatchId: "",
  exportProvider: "",
  paidNotes: "",
});

const defaultPaySettings = (companyId) => ({
  companyId,
  payMode: "productionOnly",
  routePaySource: "serviceStopAndCompletedTasks",
  taskPaySource: "technicianRateThenTaskContractedRate",
  hourlyPaySource: "none",
  allowMultipleWorkTypesPerStop: true,
  defaultStackBehavior: "stackable",
  allowTechnicianRateOverrides: true,
  allowManualPayAdjustments: false,
  payCommercialAsSeparateWorkType: true,
  paySpaAsSeparateWorkType: true,
  payPerBodyOfWater: true,
  commercialMultiBodyPayStyle: "basePlusAdditionalBodyRate",
  lockPayAfterApproval: true,
  recalculateUnapprovedPayWhenRatesChange: true,
});

const hourlyPaySettings = (companyId) => ({
  ...defaultPaySettings(companyId),
  payMode: "hourlyOnly",
  routePaySource: "none",
  taskPaySource: "none",
  hourlyPaySource: "activeRouteDuration",
  allowMultipleWorkTypesPerStop: false,
  payCommercialAsSeparateWorkType: false,
  paySpaAsSeparateWorkType: false,
  payPerBodyOfWater: false,
  commercialMultiBodyPayStyle: "singleCommercialRate",
});

const hybridPaySettings = (companyId) => ({
  ...defaultPaySettings(companyId),
  payMode: "hybrid",
  hourlyPaySource: "activeRouteDuration",
});

const normalizePaySettingsForIos = (settings = {}, companyId = "") => {
  const normalized = {
    ...defaultPaySettings(companyId),
    ...settings,
    companyId,
  };

  if (normalized.hourlyPaySource === "activeRouteLog") {
    normalized.hourlyPaySource = "activeRouteLogs";
  }

  return normalized;
};

const emptyRateForm = () => ({
  technicianId: "",
  workTypeId: "",
  payBasis: "serviceStop",
  rateType: "flatPerStop",
  amount: "",
  effectiveStartDate: isoDate(new Date()),
  status: "active",
  reason: "",
});

const rateTypeOptions = ["flatPerStop", "flatPerTask", "hourly", "perBodyOfWater", "perServiceLocation", "percentage", "manual"];
const payBasisOptions = ["serviceStop", "serviceStopTask", "technicianHourly", "manualAdjustment"];
const payModeOptions = ["productionOnly", "hourlyOnly", "hybrid"];
const routePaySourceOptions = ["serviceStop", "completedTasks", "serviceStopAndCompletedTasks", "hourlyServiceStopDuration", "hourlyTaskActualTime", "none"];
const taskPaySourceOptions = ["technicianRate", "taskContractedRate", "technicianRateThenTaskContractedRate", "taskContractedRateThenTechnicianRate", "hourlyActualTime", "hourlyEstimatedTime", "none"];
const hourlyPaySourceOptions = ["activeRouteDuration", "activeRouteLogs", "serviceStopDuration", "taskActualTime", "none"];
const stackBehaviorOptions = ["stackable", "exclusive", "replacesBase", "modifier"];
const commercialMultiBodyPayStyleOptions = ["singleCommercialRate", "sameRatePerBodyOfWater", "basePlusAdditionalBodyRate"];
const rateStatusOptions = ["active", "scheduled", "draft", "expired", "archived"];

const dollarsToCents = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const displayWorkTitle = (item) =>
  item.taskName ||
  item.workTypeName ||
  item.serviceStopTypeName ||
  item.displayTitle ||
  "Payroll Line";

const rateTypeLabel = (item) => {
  const isMissingRate =
    item?.calculationStatus === "needsReview" &&
    !item?.rateId &&
    !item?.technicianRateId &&
    Number(item?.rateAmountCents || 0) === 0;

  return isMissingRate ? "Missing Rate" : statusLabel(item?.rateType);
};

const Payroll = ({ mode = "payroll" }) => {
  const isSetupMode = mode === "setup";
  const { recentlySelectedCompany, user } = useContext(Context);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return isoDate(date);
  });
  const [endDate, setEndDate] = useState(() => isoDate(new Date()));
  const [lineItems, setLineItems] = useState([]);
  const [statements, setStatements] = useState([]);
  const [payrollBatches, setPayrollBatches] = useState([]);
  const [settingsForm, setSettingsForm] = useState(() => defaultPaySettings(""));
  const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
  const [companyWorkTypes, setCompanyWorkTypes] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [technicianRates, setTechnicianRates] = useState([]);
  const [rateForm, setRateForm] = useState(emptyRateForm);
  const [editingRateId, setEditingRateId] = useState("");
  const [activeTab, setActiveTab] = useState(isSetupMode ? "overview" : "lineItems");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [savingAction, setSavingAction] = useState("");
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [detailLineItem, setDetailLineItem] = useState(null);

  useEffect(() => {
    setActiveTab((currentTab) => {
      const setupTabs = ["overview", "stopPay", "rates", "settings"];
      const payrollTabs = ["lineItems", "statements", "batches"];
      const allowedTabs = isSetupMode ? setupTabs : payrollTabs;
      return allowedTabs.includes(currentTab) ? currentTab : allowedTabs[0];
    });
  }, [isSetupMode]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setLineItems([]);
      setStatements([]);
      setPayrollBatches([]);
      setSettingsForm(defaultPaySettings(""));
      setCompanyServiceStopTypes([]);
      setCompanyWorkTypes([]);
      setCompanyUsers([]);
      setTechnicianRates([]);
      setRateForm(emptyRateForm());
      setEditingRateId("");
      return;
    }

    const loadPayroll = async () => {
      setLoading(true);
      setError("");

      try {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T23:59:59`);

        const lineItemsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayLineItems");
        const lineItemsQuery = query(
          lineItemsRef,
          where("completedDate", ">=", start),
          where("completedDate", "<=", end)
        );

        const statementsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayStatements");
        const batchesRef = collection(db, "companies", recentlySelectedCompany, "payrollBatches");
        const settingsRef = doc(db, "companies", recentlySelectedCompany, "paySettings", "main");
        const serviceStopTypesRef = collection(db, "companies", recentlySelectedCompany, "companyServiceStopTypes");
        const workTypesRef = collection(db, "companies", recentlySelectedCompany, "companyWorkTypes");
        const companyUsersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
        const technicianRatesRef = collection(db, "companies", recentlySelectedCompany, "technicianRates");

        const [
          lineItemsSnap,
          statementsSnap,
          batchesSnap,
          settingsSnap,
          serviceStopTypesSnap,
          workTypesSnap,
          companyUsersSnap,
          technicianRatesSnap,
        ] = await Promise.all([
          getDocs(lineItemsQuery),
          getDocs(statementsRef),
          getDocs(batchesRef),
          getDoc(settingsRef),
          getDocs(serviceStopTypesRef),
          getDocs(workTypesRef),
          getDocs(companyUsersRef),
          getDocs(technicianRatesRef),
        ]);

        const nextLineItems = lineItemsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => (dateFromValue(b.completedDate)?.getTime() || 0) - (dateFromValue(a.completedDate)?.getTime() || 0));

        const nextStatements = statementsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((statement) => {
            const statementStart = dateFromValue(statement.startDate);
            const statementEnd = dateFromValue(statement.endDate);
            if (!statementStart || !statementEnd) return true;
            return statementStart <= end && statementEnd >= start;
          })
          .sort((a, b) => (dateFromValue(b.startDate)?.getTime() || 0) - (dateFromValue(a.startDate)?.getTime() || 0));

        const nextBatches = batchesSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((batch) => {
            const batchStart = dateFromValue(batch.startDate);
            const batchEnd = dateFromValue(batch.endDate);
            if (!batchStart || !batchEnd) return true;
            return batchStart <= end && batchEnd >= start;
          })
          .sort((a, b) => (dateFromValue(b.createdAt)?.getTime() || 0) - (dateFromValue(a.createdAt)?.getTime() || 0));

        setLineItems(nextLineItems);
        setStatements(nextStatements);
        setPayrollBatches(nextBatches);
        const nextPaySettings = normalizePaySettingsForIos(
          settingsSnap.exists() ? settingsSnap.data() : {},
          recentlySelectedCompany
        );
        setSettingsForm(nextPaySettings);
        setCompanyServiceStopTypes(
          serviceStopTypesSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")))
        );
        setCompanyWorkTypes(
          workTypesSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")))
        );
        setCompanyUsers(
          companyUsersSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => String(a.userName || a.name || "").localeCompare(String(b.userName || b.name || "")))
        );
        setTechnicianRates(
          technicianRatesSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => (dateFromValue(b.effectiveStartDate)?.getTime() || 0) - (dateFromValue(a.effectiveStartDate)?.getTime() || 0))
        );
      } catch (err) {
        console.error("Error loading payroll:", err);
        setError("Could not load payroll data.");
      } finally {
        setLoading(false);
      }
    };

    loadPayroll();
  }, [recentlySelectedCompany, startDate, endDate]);

  const summary = useMemo(() => {
    const activeItems = lineItems.filter((item) => !item.voidedAt);
    const totalCents = activeItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
    const needsReview = activeItems.filter((item) => item.calculationStatus === "needsReview").length;
    const approved = activeItems.filter((item) => item.approvedAt).length;
    const paid = activeItems.filter((item) => item.paidAt).length;
    const approvedUnpaidItems = activeItems.filter(
      (item) =>
        !item.paidAt &&
        !item.exportBatchId &&
        (item.approvedAt || item.calculationStatus === "approved")
    );
    const approvedUnpaidCents = approvedUnpaidItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);

    return { activeItems, totalCents, needsReview, approved, paid, approvedUnpaidItems, approvedUnpaidCents };
  }, [lineItems]);

  const currentUserId = user?.uid || user?.id || "";

  const lineItemsForStatement = (statement) => {
    const ids = new Set(Array.isArray(statement.lineItemIds) ? statement.lineItemIds : []);
    return lineItems.filter((item) => ids.has(item.id) || item.payStatementId === statement.id);
  };

  const statementLineItemIds = (statement) => {
    const ids = new Set(Array.isArray(statement.lineItemIds) ? statement.lineItemIds : []);
    lineItems
      .filter((item) => item.payStatementId === statement.id)
      .forEach((item) => ids.add(item.id));
    return [...ids];
  };

  const setActionNotice = (message = "") => {
    setActionError("");
    setActionMessage(message);
  };

  const setActionFailure = (message) => {
    setActionMessage("");
    setActionError(message);
  };

  const updateLocalLineItem = (id, payload) => {
    setLineItems((items) => items.map((item) => (item.id === id ? { ...item, ...payload } : item)));
  };

  const updateLocalStatement = (id, payload) => {
    setStatements((items) => items.map((item) => (item.id === id ? { ...item, ...payload } : item)));
  };

  const updateLocalBatch = (payload) => {
    setPayrollBatches((items) => [payload, ...items.filter((item) => item.id !== payload.id)]);
  };

  const workerName = (technicianId) => {
    const worker = companyUsers.find((item) => item.userId === technicianId || item.id === technicianId);
    return worker?.userName || worker?.name || worker?.displayName || technicianId || "-";
  };

  const workTypeName = (workTypeId) => {
    const workType = companyWorkTypes.find((item) => item.id === workTypeId);
    return workType?.name || (workTypeId ? workTypeId : "General");
  };

  const serviceStopTypeWorkTypeNames = (type) => {
    const ids = Array.isArray(type.defaultWorkTypeIds) ? type.defaultWorkTypeIds : [];
    if (ids.length === 0) return "No default work types";
    return ids.map(workTypeName).join(", ");
  };

  const savePaySettings = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;
    const actionKey = "save-pay-settings";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const payload = {
        ...normalizePaySettingsForIos(settingsForm, recentlySelectedCompany),
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };
      await setDoc(doc(db, "companies", recentlySelectedCompany, "paySettings", "main"), payload, { merge: true });
      setSettingsForm(payload);
      setActionNotice("Payroll settings saved.");
    } catch (err) {
      console.error("Error saving payroll settings:", err);
      setActionFailure("Could not save payroll settings.");
    } finally {
      setSavingAction("");
    }
  };

  const applyPaySettingsPreset = (presetName) => {
    const presetSettings = {
      production: defaultPaySettings(recentlySelectedCompany || ""),
      hourly: hourlyPaySettings(recentlySelectedCompany || ""),
      hybrid: hybridPaySettings(recentlySelectedCompany || ""),
    }[presetName];

    if (!presetSettings) return;
    setSettingsForm((form) => ({
      ...form,
      ...presetSettings,
      companyId: recentlySelectedCompany || form.companyId || "",
    }));
  };

  const saveServiceStopTypeWorkTypes = async (serviceStopTypeId, selectedIds) => {
    if (!recentlySelectedCompany || !serviceStopTypeId) return;
    const actionKey = `save-stop-type-${serviceStopTypeId}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const cleanIds = [...new Set((selectedIds || []).filter(Boolean))];
      const payload = {
        defaultWorkTypeIds: cleanIds,
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyServiceStopTypes", serviceStopTypeId), payload);
      setCompanyServiceStopTypes((types) =>
        types.map((type) => (type.id === serviceStopTypeId ? { ...type, ...payload } : type))
      );
      setActionNotice("Service stop type payroll mapping saved.");
    } catch (err) {
      console.error("Error saving service stop type work types:", err);
      setActionFailure("Could not save that service stop type mapping.");
    } finally {
      setSavingAction("");
    }
  };

  const editTechnicianRate = (rate) => {
    setEditingRateId(rate.id);
    setRateForm({
      technicianId: rate.technicianId || "",
      workTypeId: rate.workTypeId || "",
      payBasis: rate.payBasis || "serviceStop",
      rateType: rate.rateType || "flatPerStop",
      amount: String(Number(rate.amountCents || 0) / 100),
      effectiveStartDate: isoDate(dateFromValue(rate.effectiveStartDate) || new Date()),
      status: rate.status || "active",
      reason: rate.reason || "",
    });
  };

  const resetRateForm = () => {
    setEditingRateId("");
    setRateForm(emptyRateForm());
  };

  const saveTechnicianRate = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;
    if (!rateForm.technicianId) {
      setActionFailure("Select a technician before saving a rate.");
      return;
    }
    if (rateForm.payBasis !== "technicianHourly" && !rateForm.workTypeId) {
      setActionFailure("Select a work type for non-hourly technician rates.");
      return;
    }

    const actionKey = "save-technician-rate";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const rateId = editingRateId || `comp_tech_rate_${uuidv4()}`;
      const payload = {
        id: rateId,
        companyId: recentlySelectedCompany,
        technicianId: rateForm.technicianId,
        payBasis: rateForm.payBasis,
        workTypeId: rateForm.payBasis === "technicianHourly" ? null : rateForm.workTypeId,
        amountCents: dollarsToCents(rateForm.amount),
        rateType: rateForm.rateType,
        effectiveStartDate: new Date(`${rateForm.effectiveStartDate || isoDate(new Date())}T12:00:00`),
        effectiveEndDate: null,
        status: rateForm.status,
        reason: rateForm.reason.trim() || null,
        ratePlanId: technicianRates.find((rate) => rate.id === editingRateId)?.ratePlanId || "web_manual_rate_plan",
        createdAt: technicianRates.find((rate) => rate.id === editingRateId)?.createdAt || new Date(),
        createdByUserId: technicianRates.find((rate) => rate.id === editingRateId)?.createdByUserId || currentUserId,
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };
      await setDoc(doc(db, "companies", recentlySelectedCompany, "technicianRates", rateId), payload, { merge: true });
      setTechnicianRates((rates) =>
        [payload, ...rates.filter((rate) => rate.id !== rateId)].sort(
          (a, b) => (dateFromValue(b.effectiveStartDate)?.getTime() || 0) - (dateFromValue(a.effectiveStartDate)?.getTime() || 0)
        )
      );
      resetRateForm();
      setActionNotice("Technician rate saved.");
    } catch (err) {
      console.error("Error saving technician rate:", err);
      setActionFailure("Could not save technician rate.");
    } finally {
      setSavingAction("");
    }
  };

  const lineItemsForBatch = (batch) => {
    const ids = new Set(Array.isArray(batch.lineItemIds) ? batch.lineItemIds : []);
    return lineItems.filter((item) => ids.has(item.id) || item.exportBatchId === batch.id);
  };

  const buildApprovalPayload = () => ({
    approvedAt: new Date(),
    approvedByUserId: currentUserId,
  });

  const buildPaymentPayload = () => {
    const paidDate = paymentForm.paidDate || isoDate(new Date());
    const paymentMode = paymentForm.paymentMode || "manual";
    const paymentReference = paymentForm.paymentReference.trim();
    const exportBatchId = paymentForm.exportBatchId.trim();
    const exportProvider = paymentMode === "batch" ? paymentForm.exportProvider.trim() || "batch" : "manual";
    const externalReferenceId = paymentReference || exportBatchId || null;
    const paidNotes = paymentForm.paidNotes.trim();

    return {
      paidAt: new Date(`${paidDate}T12:00:00`),
      paidByUserId: currentUserId,
      paymentMode,
      paymentSource: paymentMode,
      paymentReference: paymentReference || null,
      exportBatchId: paymentMode === "batch" ? exportBatchId || null : null,
      exportProvider,
      externalReferenceId,
      paidNotes: paidNotes || null,
    };
  };

  const createPayrollBatch = async () => {
    if (!recentlySelectedCompany || summary.approvedUnpaidItems.length === 0) return;
    const actionKey = "create-payroll-batch";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const now = new Date();
      const batchId = `payroll_batch_${uuidv4()}`;
      const batchPayload = {
        id: batchId,
        companyId: recentlySelectedCompany,
        status: "draft",
        startDate: new Date(`${startDate}T00:00:00`),
        endDate: new Date(`${endDate}T23:59:59`),
        lineItemIds: summary.approvedUnpaidItems.map((item) => item.id),
        lineItemCount: summary.approvedUnpaidItems.length,
        totalCents: summary.approvedUnpaidCents,
        paymentMode: "batch",
        paymentSource: "batch",
        exportProvider: "pending",
        externalReferenceId: null,
        createdAt: now,
        createdByUserId: currentUserId,
        updatedAt: now,
      };
      const linePayload = {
        exportBatchId: batchId,
        paymentMode: "batch",
        paymentSource: "batch",
        payrollBatchStatus: "draft",
        batchedAt: now,
        batchedByUserId: currentUserId,
      };
      const firestoreBatch = writeBatch(db);
      const batchRef = doc(db, "companies", recentlySelectedCompany, "payrollBatches", batchId);
      firestoreBatch.set(batchRef, batchPayload);

      summary.approvedUnpaidItems.forEach((item) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
        firestoreBatch.update(lineRef, linePayload);
      });

      await firestoreBatch.commit();
      updateLocalBatch(batchPayload);
      setLineItems((items) =>
        items.map((item) =>
          batchPayload.lineItemIds.includes(item.id) ? { ...item, ...linePayload } : item
        )
      );
      setActionNotice(`Created payroll batch with ${batchPayload.lineItemCount} line item(s).`);
    } catch (err) {
      console.error("Error creating payroll batch:", err);
      setActionFailure("Could not create payroll batch.");
    } finally {
      setSavingAction("");
    }
  };

  const exportPayrollBatchCsv = async (payrollBatch) => {
    if (!recentlySelectedCompany || !payrollBatch?.id) return;
    const batchLineItems = lineItemsForBatch(payrollBatch);

    if (batchLineItems.length === 0) {
      setActionFailure("No loaded line items are linked to this payroll batch.");
      return;
    }

    const actionKey = `export-payroll-batch-${payrollBatch.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const now = new Date();
      const exportReference = `CSV ${now.toLocaleString()}`;
      const fileName = `payroll_batch_${payrollBatch.id}_${isoDate(now)}.csv`;
      const rows = [
        [
          "batchId",
          "lineItemId",
          "companyId",
          "technicianId",
          "technicianName",
          "workerType",
          "source",
          "completedDate",
          "displayTitle",
          "workTypeName",
          "rateType",
          "quantity",
          "quantityUnit",
          "rateAmountCents",
          "totalAmountCents",
          "calculationStatus",
          "approvedAt",
          "paidAt",
          "customerName",
          "serviceLocationAddress",
          "jobId",
          "jobInternalId",
        ],
        ...batchLineItems.map((item) => [
          payrollBatch.id,
          item.id,
          item.companyId || recentlySelectedCompany,
          item.technicianId || "",
          item.technicianName || "",
          item.workerType || "",
          item.source || "",
          isoDateTime(item.completedDate),
          item.displayTitle || "",
          item.workTypeName || "",
          item.rateType || "",
          item.quantity || "",
          item.quantityUnit || "",
          item.rateAmountCents || 0,
          item.totalAmountCents || 0,
          item.calculationStatus || "",
          isoDateTime(item.approvedAt),
          isoDateTime(item.paidAt),
          item.customerName || "",
          item.serviceLocationAddress || "",
          item.jobId || "",
          item.jobInternalId || "",
        ]),
      ];

      downloadCsv(fileName, rows);

      const batchPayload = {
        status: "exported",
        exportedAt: now,
        exportedByUserId: currentUserId,
        exportProvider: "csv",
        externalReferenceId: exportReference,
        csvFileName: fileName,
        updatedAt: now,
      };
      const linePayload = {
        exportBatchId: payrollBatch.id,
        payrollBatchStatus: "exported",
        exportedAt: now,
        exportedByUserId: currentUserId,
        exportProvider: "csv",
        externalReferenceId: exportReference,
      };
      const firestoreBatch = writeBatch(db);
      const batchRef = doc(db, "companies", recentlySelectedCompany, "payrollBatches", payrollBatch.id);
      firestoreBatch.update(batchRef, batchPayload);

      batchLineItems.forEach((item) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
        firestoreBatch.update(lineRef, linePayload);
      });

      await firestoreBatch.commit();
      updateLocalBatch({ ...payrollBatch, ...batchPayload });
      setLineItems((items) =>
        items.map((item) =>
          batchLineItems.some((lineItem) => lineItem.id === item.id) ? { ...item, ...linePayload } : item
        )
      );
      setActionNotice(`Exported ${batchLineItems.length} payroll line item(s) to CSV.`);
    } catch (err) {
      console.error("Error exporting payroll batch:", err);
      setActionFailure("Could not export payroll batch.");
    } finally {
      setSavingAction("");
    }
  };

  const approveLineItem = async (item) => {
    if (!recentlySelectedCompany || !item?.id) return;
    const actionKey = `approve-line-${item.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const payload = { ...buildApprovalPayload(), calculationStatus: "approved" };
      const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
      await updateDoc(lineRef, payload);
      updateLocalLineItem(item.id, payload);
      setActionNotice("Line item approved.");
    } catch (err) {
      console.error("Error approving payroll line item:", err);
      setActionFailure("Could not approve that payroll line item.");
    } finally {
      setSavingAction("");
    }
  };

  const approveStatement = async (statement) => {
    if (!recentlySelectedCompany || !statement?.id) return;
    const actionKey = `approve-statement-${statement.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const approvalPayload = buildApprovalPayload();
      const statementPayload = { ...approvalPayload, status: "approved" };
      const linePayload = { ...approvalPayload, calculationStatus: "approved" };
      const batch = writeBatch(db);
      const statementRef = doc(db, "companies", recentlySelectedCompany, "technicianPayStatements", statement.id);
      batch.update(statementRef, statementPayload);

      const eligibleLineIds = statementLineItemIds(statement).filter((id) => {
        const line = lineItems.find((item) => item.id === id);
        return !line || (line.calculationStatus !== "paid" && line.calculationStatus !== "voided");
      });

      eligibleLineIds.forEach((id) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", id);
        batch.update(lineRef, linePayload);
      });

      await batch.commit();
      updateLocalStatement(statement.id, statementPayload);
      setLineItems((items) =>
        items.map((item) => (eligibleLineIds.includes(item.id) ? { ...item, ...linePayload } : item))
      );
      setActionNotice("Statement approved.");
    } catch (err) {
      console.error("Error approving payroll statement:", err);
      setActionFailure("Could not approve that payroll statement.");
    } finally {
      setSavingAction("");
    }
  };

  const openPaymentModal = (targetType, target) => {
    const isBatch = targetType === "batch";
    setPaymentForm({
      ...emptyPaymentForm(),
      paymentMode: isBatch ? "batch" : "manual",
      paymentReference: target?.paymentReference || "",
      exportBatchId: isBatch ? target?.id || "" : target?.exportBatchId || "",
      exportProvider: isBatch ? target?.exportProvider || "csv" : target?.exportProvider || "",
      paidNotes: target?.paidNotes || "",
    });
    setPaymentModal({ targetType, target });
    setActionNotice();
  };

  const closePaymentModal = () => {
    if (savingAction) return;
    setPaymentModal(null);
    setPaymentForm(emptyPaymentForm());
  };

  const markLineItemPaid = async (item) => {
    if (!recentlySelectedCompany || !item?.id) return;
    const actionKey = `pay-line-${item.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = item.approvedAt ? {} : buildApprovalPayload();
      const payload = {
        ...approvalPayload,
        ...paymentPayload,
        calculationStatus: "paid",
      };
      const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
      await updateDoc(lineRef, payload);
      updateLocalLineItem(item.id, payload);
      setPaymentModal(null);
      setActionNotice("Line item marked paid.");
    } catch (err) {
      console.error("Error marking payroll line item paid:", err);
      setActionFailure("Could not mark that payroll line item paid.");
    } finally {
      setSavingAction("");
    }
  };

  const markStatementPaid = async (statement) => {
    if (!recentlySelectedCompany || !statement?.id) return;
    const actionKey = `pay-statement-${statement.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = statement.approvedAt ? {} : buildApprovalPayload();
      const statementPayload = {
        ...approvalPayload,
        ...paymentPayload,
        status: "paid",
      };
      const linePaymentPayload = {
        ...paymentPayload,
        calculationStatus: "paid",
        payStatementId: statement.id,
      };
      const batch = writeBatch(db);
      const statementRef = doc(db, "companies", recentlySelectedCompany, "technicianPayStatements", statement.id);
      batch.update(statementRef, statementPayload);

      const linkedLineIds = statementLineItemIds(statement);
      linkedLineIds.forEach((id) => {
        const line = lineItems.find((item) => item.id === id);
        const lineApprovalPayload = line?.approvedAt ? {} : approvalPayload;
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", id);
        batch.update(lineRef, {
          ...lineApprovalPayload,
          ...linePaymentPayload,
        });
      });

      await batch.commit();
      updateLocalStatement(statement.id, statementPayload);
      setLineItems((items) =>
        items.map((item) =>
          linkedLineIds.includes(item.id)
            ? {
                ...item,
                ...(item.approvedAt ? {} : approvalPayload),
                ...linePaymentPayload,
              }
            : item
        )
      );
      setPaymentModal(null);
      setActionNotice("Statement marked paid.");
    } catch (err) {
      console.error("Error marking payroll statement paid:", err);
      setActionFailure("Could not mark that payroll statement paid.");
    } finally {
      setSavingAction("");
    }
  };

  const markBatchPaid = async (payrollBatch) => {
    if (!recentlySelectedCompany || !payrollBatch?.id) return;
    const batchLineItems = lineItemsForBatch(payrollBatch);

    if (batchLineItems.length === 0) {
      setActionFailure("No loaded line items are linked to this payroll batch.");
      return;
    }

    const actionKey = `pay-batch-${payrollBatch.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = buildApprovalPayload();
      const batchPayload = {
        ...paymentPayload,
        status: "paid",
        paidLineItemCount: batchLineItems.length,
        updatedAt: new Date(),
      };
      const linePaymentPayload = {
        ...paymentPayload,
        exportBatchId: payrollBatch.id,
        payrollBatchStatus: "paid",
        calculationStatus: "paid",
      };
      const firestoreBatch = writeBatch(db);
      const batchRef = doc(db, "companies", recentlySelectedCompany, "payrollBatches", payrollBatch.id);

      firestoreBatch.update(batchRef, batchPayload);
      batchLineItems.forEach((item) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
        firestoreBatch.update(lineRef, {
          ...(item.approvedAt ? {} : approvalPayload),
          ...linePaymentPayload,
        });
      });

      await firestoreBatch.commit();
      updateLocalBatch({ ...payrollBatch, ...batchPayload });
      setLineItems((items) =>
        items.map((item) => {
          const linkedLine = batchLineItems.find((lineItem) => lineItem.id === item.id);
          if (!linkedLine) return item;
          return {
            ...item,
            ...(item.approvedAt ? {} : approvalPayload),
            ...linePaymentPayload,
          };
        })
      );
      setPaymentModal(null);
      setActionNotice(`Marked ${batchLineItems.length} payroll line item(s) paid from batch.`);
    } catch (err) {
      console.error("Error marking payroll batch paid:", err);
      setActionFailure("Could not mark that payroll batch paid.");
    } finally {
      setSavingAction("");
    }
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!paymentModal) return;
    if (paymentModal.targetType === "statement") {
      await markStatementPaid(paymentModal.target);
    } else if (paymentModal.targetType === "batch") {
      await markBatchPaid(paymentModal.target);
    } else {
      await markLineItemPaid(paymentModal.target);
    }
  };

  const closeDetailModal = () => {
    setDetailLineItem(null);
  };

  const renderLineItems = () => {
    if (summary.activeItems.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No payroll line items found for this date range.</div>;
    }

    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Work</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.activeItems.map((item) => {
              const isPaid = Boolean(item.paidAt) || item.calculationStatus === "paid";
              const isApproved = Boolean(item.approvedAt) || item.calculationStatus === "approved" || isPaid;
              const isVoided = item.calculationStatus === "voided";

              return (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{shortDate(item.completedDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{item.technicianName || "Worker"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="font-medium">{displayWorkTitle(item)}</div>
                    <div className="text-xs text-slate-500">{rateTypeLabel(item)} · {Number(item.quantity || 0)} {item.quantityUnit || "each"}</div>
                    {item.paymentReference ? <div className="mt-1 text-xs text-slate-500">Ref: {item.paymentReference}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.customerName || item.serviceLocationAddress || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusPill status={isPaid ? "paid" : item.calculationStatus} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(item.totalAmountCents)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailLineItem(item)}
                        className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        onClick={() => approveLineItem(item)}
                        disabled={isApproved || isVoided || savingAction === `approve-line-${item.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingAction === `approve-line-${item.id}` ? "Saving" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openPaymentModal("lineItem", item)}
                        disabled={isPaid || isVoided}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Mark Paid
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderStatements = () => {
    if (statements.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No pay statements found for this date range.</div>;
    }

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {statements.map((statement) => {
          const isPaid = Boolean(statement.paidAt) || statement.status === "paid";
          const isApproved = Boolean(statement.approvedAt) || statement.status === "approved" || isPaid;
          const linkedLines = lineItemsForStatement(statement);

          return (
            <div key={statement.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">{statement.statementReference || statement.technicianName || "Pay Statement"}</p>
                  <p className="text-sm text-slate-500">{shortDate(statement.startDate)} - {shortDate(statement.endDate)}</p>
                  <p className="mt-1 text-xs text-slate-500">{linkedLines.length || statement.lineItemIds?.length || 0} linked line item(s)</p>
                  {statement.paymentReference ? <p className="mt-1 text-xs text-slate-500">Payment ref: {statement.paymentReference}</p> : null}
                </div>
                <StatusPill status={isPaid ? "paid" : statement.status} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subtotal</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(statement.subtotalCents)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Adjustments</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(statement.adjustmentCents)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(statement.totalCents)}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => approveStatement(statement)}
                  disabled={isApproved || savingAction === `approve-statement-${statement.id}`}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction === `approve-statement-${statement.id}` ? "Saving" : "Approve Statement"}
                </button>
                <button
                  type="button"
                  onClick={() => openPaymentModal("statement", statement)}
                  disabled={isPaid}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark Paid
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderBatches = () => {
    if (payrollBatches.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No payroll batches found for this date range.</div>;
    }

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {payrollBatches.map((batch) => {
          const batchLineItems = lineItemsForBatch(batch);
          const isExporting = savingAction === `export-payroll-batch-${batch.id}`;
          const isPaid = Boolean(batch.paidAt) || batch.status === "paid";

          return (
            <div key={batch.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">{batch.batchReference || "Payroll batch"}</p>
                  <p className="text-sm text-slate-500">{shortDate(batch.startDate)} - {shortDate(batch.endDate)}</p>
                  {batch.externalReferenceId ? <p className="mt-1 text-xs text-slate-500">{batch.externalReferenceId}</p> : null}
                </div>
                <StatusPill status={isPaid ? "paid" : batch.status || "draft"} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lines</p>
                  <p className="font-bold text-slate-900">{batch.lineItemCount || batch.lineItemIds?.length || batchLineItems.length || 0}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(batch.totalCents)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</p>
                  <p className="font-bold text-slate-900">{statusLabel(batch.exportProvider || "pending")}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>{isPaid ? `Paid ${shortDate(batch.paidAt)}` : batch.exportedAt ? `Exported ${shortDate(batch.exportedAt)}` : `Created ${shortDate(batch.createdAt)}`}</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => exportPayrollBatchCsv(batch)}
                    disabled={isExporting || batchLineItems.length === 0}
                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isExporting ? "Exporting" : batch.status === "exported" || isPaid ? "Export CSV Again" : "Export CSV"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openPaymentModal("batch", batch)}
                    disabled={isPaid || batchLineItems.length === 0}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Mark Paid
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSettings = () => (
    <form onSubmit={savePaySettings} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Payroll Settings</h2>
          <p className="mt-1 text-sm text-slate-500">These fields mirror the iOS CompanyPaySettings document.</p>
        </div>
        <button
          type="submit"
          disabled={savingAction === "save-pay-settings"}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingAction === "save-pay-settings" ? "Saving" : "Save Settings"}
        </button>
      </div>

      <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Quick Setup</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyPaySettingsPreset("production")}
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
          >
            Production Pay Defaults
          </button>
          <button
            type="button"
            onClick={() => applyPaySettingsPreset("hourly")}
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
          >
            Hourly Pay Defaults
          </button>
          <button
            type="button"
            onClick={() => applyPaySettingsPreset("hybrid")}
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
          >
            Hybrid Pay Defaults
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-semibold text-slate-700">
          Pay mode
          <select
            value={settingsForm.payMode || "productionOnly"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, payMode: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {payModeOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Route pay source
          <select
            value={settingsForm.routePaySource || "serviceStopAndCompletedTasks"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, routePaySource: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {routePaySourceOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Task pay source
          <select
            value={settingsForm.taskPaySource || "technicianRateThenTaskContractedRate"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, taskPaySource: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {taskPaySourceOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Hourly pay source
          <select
            value={settingsForm.hourlyPaySource || "none"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, hourlyPaySource: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {hourlyPaySourceOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Default stacking
          <select
            value={settingsForm.defaultStackBehavior || "stackable"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, defaultStackBehavior: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {stackBehaviorOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Commercial Multi-BOW style
          <select
            value={settingsForm.commercialMultiBodyPayStyle || "basePlusAdditionalBodyRate"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, commercialMultiBodyPayStyle: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {commercialMultiBodyPayStyleOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[
          ["allowMultipleWorkTypesPerStop", "Multiple work types per stop"],
          ["allowTechnicianRateOverrides", "Technician rate overrides"],
          ["allowManualPayAdjustments", "Manual pay adjustments"],
          ["payCommercialAsSeparateWorkType", "Commercial separate work type"],
          ["paySpaAsSeparateWorkType", "Spa separate work type"],
          ["payPerBodyOfWater", "Pay per body of water"],
          ["lockPayAfterApproval", "Lock after approval"],
          ["recalculateUnapprovedPayWhenRatesChange", "Recalculate unapproved pay"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={Boolean(settingsForm[key])}
              onChange={(event) => setSettingsForm((form) => ({ ...form, [key]: event.target.checked }))}
              className="h-4 w-4"
            />
          </label>
        ))}
      </div>
    </form>
  );

  const renderSetupOverview = () => {
    const flowSteps = [
      {
        title: "Schedule Stop",
        subtitle: "Route, job, or recurring stop",
        example: "Example: weekly pool route",
      },
      {
        title: "Pick Stop Type",
        subtitle: "What kind of work is being scheduled",
        example: "Example: Weekly Route",
      },
      {
        title: "Pays As",
        subtitle: "Payroll work created from that stop",
        example: "Example: Route",
      },
      {
        title: "Technician Rate",
        subtitle: "Worker-specific pay for that work",
        example: "Example: Michael · $80",
      },
      {
        title: "Payroll Line",
        subtitle: "Review, approve, batch, and mark paid",
        example: "Example: calculated line item",
      },
    ];

    return (
      <div className="grid gap-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-900">Payroll Setup Flow</h2>
            <p className="text-sm text-slate-500">One scheduled stop becomes one or more payroll lines through this path.</p>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-5">
            {flowSteps.map((step, index) => (
              <div key={step.title} className="relative rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{index + 1}</div>
                <h3 className="mt-3 text-sm font-bold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-xs text-slate-600">{step.subtitle}</p>
                <p className="mt-3 rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-700">{step.example}</p>
                {index < flowSteps.length - 1 ? (
                  <div className="absolute -right-2 top-1/2 hidden h-4 w-4 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-blue-300 lg:block" />
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => setActiveTab("stopPay")}
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="text-base font-bold text-slate-900">Stop Pay Setup</h3>
            <p className="mt-2 text-sm text-slate-600">Choose which payroll work types each scheduled service stop type creates.</p>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rates")}
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="text-base font-bold text-slate-900">Technician Rates</h3>
            <p className="mt-2 text-sm text-slate-600">Set each technician's amount for each payroll work type.</p>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="text-base font-bold text-slate-900">Pay Rules</h3>
            <p className="mt-2 text-sm text-slate-600">Control approval behavior, route pay source, task pay source, and recalculation.</p>
          </button>
        </section>
      </div>
    );
  };

  const renderStopPaySetup = () => (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
          <h2 className="text-lg font-bold text-slate-900">Stop Pay Setup</h2>
          <p className="text-sm text-slate-500">Connect each scheduled service stop type to the payroll work it should create.</p>
        </div>
        <div className="mt-4 grid gap-4">
          {companyServiceStopTypes.length === 0 ? (
            <p className="text-sm text-slate-500">No service stop types found.</p>
          ) : companyServiceStopTypes.map((type) => {
            const selectedIds = new Set(Array.isArray(type.defaultWorkTypeIds) ? type.defaultWorkTypeIds : []);
            return (
              <div key={type.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900">{type.name || "Service stop type"}</h3>
                    <p className="mt-1 text-sm text-slate-500">{serviceStopTypeWorkTypeNames(type)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => saveServiceStopTypeWorkTypes(type.id, [...selectedIds])}
                    disabled={savingAction === `save-stop-type-${type.id}`}
                    className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingAction === `save-stop-type-${type.id}` ? "Saving" : "Save Mapping"}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {companyWorkTypes.map((workType) => (
                    <label key={workType.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        defaultChecked={selectedIds.has(workType.id)}
                        onChange={(event) => {
                          if (event.target.checked) {
                            selectedIds.add(workType.id);
                          } else {
                            selectedIds.delete(workType.id);
                          }
                        }}
                      />
                      <span>{workType.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
  );

  const renderTechnicianRates = () => (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
          <h2 className="text-lg font-bold text-slate-900">Technician Rates</h2>
          <p className="text-sm text-slate-500">Create or update the rate rows used by iOS PayEngine and web estimates.</p>
        </div>
        <form onSubmit={saveTechnicianRate} className="mt-4 grid gap-4 lg:grid-cols-6">
          <label className="text-sm font-semibold text-slate-700 lg:col-span-2">
            Technician
            <select value={rateForm.technicianId} onChange={(event) => setRateForm((form) => ({ ...form, technicianId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Select technician</option>
              {companyUsers.map((worker) => <option key={worker.id} value={worker.userId || worker.id}>{worker.userName || worker.name || "Technician"}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700 lg:col-span-2">
            Work type
            <select value={rateForm.workTypeId} onChange={(event) => setRateForm((form) => ({ ...form, workTypeId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">General / hourly</option>
              {companyWorkTypes.map((workType) => <option key={workType.id} value={workType.id}>{workType.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Pay basis
            <select value={rateForm.payBasis} onChange={(event) => setRateForm((form) => ({ ...form, payBasis: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {payBasisOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Rate type
            <select value={rateForm.rateType} onChange={(event) => setRateForm((form) => ({ ...form, rateType: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {rateTypeOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Amount
            <input type="number" step="0.01" value={rateForm.amount} onChange={(event) => setRateForm((form) => ({ ...form, amount: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Effective
            <input type="date" value={rateForm.effectiveStartDate} onChange={(event) => setRateForm((form) => ({ ...form, effectiveStartDate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Status
            <select value={rateForm.status} onChange={(event) => setRateForm((form) => ({ ...form, status: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {rateStatusOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700 lg:col-span-3">
            Notes
            <input type="text" value={rateForm.reason} onChange={(event) => setRateForm((form) => ({ ...form, reason: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="flex items-end gap-2 lg:col-span-2">
            <button type="submit" disabled={savingAction === "save-technician-rate"} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {savingAction === "save-technician-rate" ? "Saving" : editingRateId ? "Update Rate" : "Add Rate"}
            </button>
            {editingRateId ? (
              <button type="button" onClick={resetRateForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Technician</th>
                <th className="px-4 py-3">Work Type</th>
                <th className="px-4 py-3">Basis</th>
                <th className="px-4 py-3">Rate</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {technicianRates.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No technician rates found.</td></tr>
              ) : technicianRates.map((rate) => (
                <tr key={rate.id}>
                  <td className="px-4 py-3 font-semibold text-slate-900">{workerName(rate.technicianId)}</td>
                  <td className="px-4 py-3 text-slate-700">{workTypeName(rate.workTypeId)}</td>
                  <td className="px-4 py-3 text-slate-600">{statusLabel(rate.payBasis)}</td>
                  <td className="px-4 py-3 text-slate-700">{moneyFromCents(rate.amountCents)} · {statusLabel(rate.rateType)}</td>
                  <td className="px-4 py-3"><StatusPill status={rate.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => editTechnicianRate(rate)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
  );

  const tabItems = isSetupMode
    ? [
      ["overview", "Overview"],
      ["stopPay", "Stop Pay Setup"],
      ["rates", "Technician Rates"],
      ["settings", "Pay Rules"],
    ]
    : [
      ["lineItems", "Line Items"],
      ["statements", "Statements"],
      ["batches", "Batches"],
    ];

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{isSetupMode ? "Payroll Setup" : "Payroll"}</h1>
            <p className="mt-1 text-slate-600">
              {isSetupMode
                ? "Configure how scheduled work turns into technician pay."
                : "Review, approve, batch, export, and mark technician pay as paid."}
            </p>
          </div>
          {isSetupMode ? (
            <Link
              to="/company/payroll"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Payroll
            </Link>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              <Link
                to="/company/payroll/setup"
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Payroll Setup
              </Link>
              <button
                type="button"
                onClick={createPayrollBatch}
                disabled={summary.approvedUnpaidItems.length === 0 || savingAction === "create-payroll-batch"}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction === "create-payroll-batch" ? "Creating" : "Create Batch"}
              </button>
            </div>
          )}
        </header>

        {!isSetupMode ? (
          <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Payroll total" value={moneyFromCents(summary.totalCents)} subtitle={`${summary.activeItems.length} active line item(s)`} />
            <StatCard title="Needs review" value={summary.needsReview} subtitle="Line items requiring attention" />
            <StatCard title="Approved" value={summary.approved} subtitle="Approved line items" />
            <StatCard title="Ready to batch" value={moneyFromCents(summary.approvedUnpaidCents)} subtitle={`${summary.approvedUnpaidItems.length} approved unpaid line(s)`} />
            <StatCard title="Paid" value={summary.paid} subtitle="Marked paid internally" />
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap gap-2">
          {tabItems.map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {actionMessage ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{actionMessage}</div> : null}
        {actionError ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{actionError}</div> : null}
        {loading ? <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">Loading payroll...</div> : null}
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        {!loading && !error && !isSetupMode && activeTab === "lineItems" ? renderLineItems() : null}
        {!loading && !error && !isSetupMode && activeTab === "statements" ? renderStatements() : null}
        {!loading && !error && !isSetupMode && activeTab === "batches" ? renderBatches() : null}
        {!loading && !error && isSetupMode && activeTab === "overview" ? renderSetupOverview() : null}
        {!loading && !error && isSetupMode && activeTab === "stopPay" ? renderStopPaySetup() : null}
        {!loading && !error && isSetupMode && activeTab === "rates" ? renderTechnicianRates() : null}
        {!loading && !error && isSetupMode && activeTab === "settings" ? renderSettings() : null}
      </div>
      {paymentModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={submitPayment} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Mark Paid</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {paymentModal.targetType === "statement"
                    ? paymentModal.target.statementReference || paymentModal.target.technicianName || "Pay statement"
                    : paymentModal.targetType === "batch"
                      ? paymentModal.target.batchReference || paymentModal.target.id || "Payroll batch"
                      : displayWorkTitle(paymentModal.target)}
                </p>
              </div>
              <button type="button" onClick={closePaymentModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="text-sm font-semibold text-slate-700">
                Paid date
                <input
                  type="date"
                  value={paymentForm.paidDate}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paidDate: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Payment source
                <select
                  value={paymentForm.paymentMode}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paymentMode: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="manual">Manual entry</option>
                  <option value="batch">Batch/export reference</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Reference
                <input
                  type="text"
                  value={paymentForm.paymentReference}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paymentReference: event.target.value }))}
                  placeholder={paymentForm.paymentMode === "manual" ? "Check number, cash note, ACH ref" : "Provider transaction or export ref"}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              {paymentForm.paymentMode === "batch" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Batch ID
                    <input
                      type="text"
                      value={paymentForm.exportBatchId}
                      onChange={(event) => setPaymentForm((form) => ({ ...form, exportBatchId: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Export provider
                    <input
                      type="text"
                      value={paymentForm.exportProvider}
                      onChange={(event) => setPaymentForm((form) => ({ ...form, exportProvider: event.target.value }))}
                      placeholder="CSV, Gusto, ADP"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              ) : null}

              <label className="text-sm font-semibold text-slate-700">
                Notes
                <textarea
                  value={paymentForm.paidNotes}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paidNotes: event.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closePaymentModal} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(savingAction)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction ? "Saving" : "Mark Paid"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {detailLineItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Payroll Line Detail</h2>
                <p className="mt-1 text-sm text-slate-500">{detailLineItem.displayTitle || detailLineItem.workTypeName || "Payroll line"}</p>
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Status" value={detailLineItem.calculationStatus} accent />
                <DetailField label="Total" value={moneyFromCents(detailLineItem.totalAmountCents)} accent />
                <DetailField label="Completed" value={debugDateTime(detailLineItem.completedDate)} />
                <DetailField label="Source" value={detailLineItem.source} />
                <DetailField label="Technician" value={detailLineItem.technicianName || (detailLineItem.technicianId ? "Assigned technician" : "")} accent />
                <DetailField label="Worker Type" value={detailLineItem.workerType} />
                <DetailField label="Company" value={detailLineItem.companyName || (detailLineItem.companyId || recentlySelectedCompany ? "Selected company" : "")} />
                <DetailField label="Service Stop" value={detailLineItem.serviceStopInternalId || (detailLineItem.serviceStopId ? "Service stop" : "")} accent />
                <DetailField label="Service Stop Type" value={detailLineItem.serviceStopTypeName} />
                <DetailField label="Job" value={detailLineItem.jobInternalId || (detailLineItem.jobId ? "Job" : "")} />
                <DetailField label="Task" value={detailLineItem.displayTitle || detailLineItem.workTypeName || (detailLineItem.serviceStopTaskId || detailLineItem.taskId ? "Task" : "")} />
                <DetailField label="Work Type" value={detailLineItem.workTypeName || (detailLineItem.workTypeId ? "General" : "")} accent />
                <DetailField label="Pay Basis" value={detailLineItem.payBasis} accent />
                <DetailField label="Rate Type" value={rateTypeLabel(detailLineItem)} />
                <DetailField label="Rate Amount" value={moneyFromCents(detailLineItem.rateAmountCents)} />
                <DetailField label="Quantity" value={`${Number(detailLineItem.quantity || 0)} ${detailLineItem.quantityUnit || ""}`.trim()} />
                <DetailField label="Rate" value={rateTypeLabel(detailLineItem) || (detailLineItem.rateId || detailLineItem.technicianRateId ? "Rate" : "")} />
                <DetailField label="Pay Statement" value={detailLineItem.payStatementReference || (detailLineItem.payStatementId ? "Payroll statement" : "")} />
                <DetailField label="Export Batch" value={detailLineItem.exportBatchReference || (detailLineItem.exportBatchId ? "Export batch" : "")} />
                <DetailField label="Payment Ref" value={detailLineItem.paymentReference || detailLineItem.externalReferenceId} />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Context</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-semibold">Title:</span> {detailLineItem.displayTitle || detailLineItem.workTypeName || "-"}</p>
                    <p><span className="font-semibold">Customer:</span> {detailLineItem.customerName || "-"}</p>
                    <p><span className="font-semibold">Address:</span> {detailLineItem.serviceLocationAddress || "-"}</p>
                    <p><span className="font-semibold">Created:</span> {debugDateTime(detailLineItem.createdAt)}</p>
                    <p><span className="font-semibold">Updated:</span> {debugDateTime(detailLineItem.updatedAt)}</p>
                    <p><span className="font-semibold">Approved:</span> {debugDateTime(detailLineItem.approvedAt)}</p>
                    <p><span className="font-semibold">Paid:</span> {debugDateTime(detailLineItem.paidAt)}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Debug Notes</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-semibold">Calculation notes:</span> {detailLineItem.calculationNotes || detailLineItem.notes || "-"}</p>
                    <p><span className="font-semibold">Void reason:</span> {detailLineItem.voidReason || "-"}</p>
                    <p><span className="font-semibold">Payment notes:</span> {detailLineItem.paidNotes || "-"}</p>
                    <p><span className="font-semibold">Raw status:</span> {detailLineItem.status || "-"}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-950 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-200">Raw Firestore Data</h3>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(serializeForDebug(detailLineItem), null, 2))}
                    className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    Copy JSON
                  </button>
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-100">
                  {JSON.stringify(serializeForDebug(detailLineItem), null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Payroll;
