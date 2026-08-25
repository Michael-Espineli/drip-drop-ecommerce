import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import { Link } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";

import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { db } from "../../../utils/config";
import { getCustomerTagOptions } from "../../../utils/customerTags";

const reportCatalog = [
  { value: "funReadingsDosages", label: "Fun Readings & Dosages", source: "daily reading and dosage ranges", category: "operations" },
  { value: "readings", label: "Readings & Dosages Summary", source: "stopData readings and dosages", category: "operations" },
  { value: "readingHealth", label: "Reading Health", source: "reading thresholds by pool", category: "operations" },
  { value: "readingPerformance", label: "Reading Performance", source: "stopData standards by user or customer", category: "performance" },
  { value: "pnlPerPool", label: "PNL Per Service Location", source: "service agreements by location, labor, chemicals", category: "performance" },
  { value: "pipeline", label: "Pipeline", source: "customerPipeline, lead sources, lost and fired reasons", category: "marketing" },
  { value: "chemicals", label: "Chemicals", source: "stopData dosages", category: "operations" },
  { value: "waste", label: "Waste", source: "linked dosages and purchased items", category: "performance" },
  { value: "users", label: "Users", source: "users, stops, jobs, purchases, payroll", category: "operations" },
  { value: "job", label: "Jobs", source: "workOrders, purchases, payroll", category: "operations" },
  { value: "vehicle", label: "Vehicle", source: "vehicals and activeRoutes", category: "operations" },
  { value: "purchases", label: "Purchases", source: "purchasedItems and database items", category: "finance" },
  { value: "payroll", label: "Payroll", source: "technician payroll line items", category: "finance" },
  { value: "futurePayroll", label: "Future Payroll", source: "unpaid payroll and scheduled service stop estimates", category: "finance" },
  { value: "pnl", label: "P.N.L.", source: "service agreements, jobs, purchases, payroll", category: "finance" },
  { value: "tax", label: "Tax", source: "purchases and invoiced jobs", category: "finance" },
];

const fixedGroupingReportTypes = new Set(["funReadingsDosages", "readingHealth", "readingPerformance", "pnlPerPool", "pipeline"]);
const payrollOnlyReportTypes = new Set(["payroll", "futurePayroll"]);

const readingOperatorOptions = [
  { value: "gt", label: "Over" },
  { value: "gte", label: "At or over" },
  { value: "lt", label: "Below" },
  { value: "lte", label: "At or below" },
  { value: "eq", label: "Equal to" },
];

const readingPerformanceViewOptions = [
  { value: "users", label: "User" },
  { value: "customers", label: "Customer" },
];

const groupOptions = [
  { value: "company", label: "Company" },
  { value: "user", label: "User" },
  { value: "customer", label: "Customer" },
];

const dateInputValue = (date) => format(date, "yyyy-MM-dd");

const dateRangeFromDates = (start, end) => ({
  start: dateInputValue(start),
  end: dateInputValue(end),
});

const dateRangePresets = [
  { value: "custom", label: "Custom", getRange: null },
  { value: "thisMonth", label: "This Month", getRange: () => dateRangeFromDates(startOfMonth(new Date()), endOfMonth(new Date())) },
  {
    value: "lastMonth",
    label: "Last Month",
    getRange: () => {
      const previousMonth = subMonths(new Date(), 1);
      return dateRangeFromDates(startOfMonth(previousMonth), endOfMonth(previousMonth));
    },
  },
  { value: "last7Days", label: "Last 7 Days", getRange: () => dateRangeFromDates(subDays(new Date(), 6), new Date()) },
  { value: "last30Days", label: "Last 30 Days", getRange: () => dateRangeFromDates(subDays(new Date(), 29), new Date()) },
  { value: "thisWeek", label: "This Week", getRange: () => dateRangeFromDates(startOfWeek(new Date()), endOfWeek(new Date())) },
  {
    value: "lastWeek",
    label: "Last Week",
    getRange: () => {
      const previousWeek = subDays(new Date(), 7);
      return dateRangeFromDates(startOfWeek(previousWeek), endOfWeek(previousWeek));
    },
  },
];

const defaultDateRange = () =>
  dateRangePresets.find((preset) => preset.value === "thisMonth").getRange();

const normalizeDocs = (snapshot) => snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

const reportLabel = (reportType) =>
  reportCatalog.find((report) => report.value === reportType)?.label || "Report";

const datePresetLabel = (value) =>
  dateRangePresets.find((preset) => preset.value === value)?.label || "Custom";

const readingTemplateKey = (template = {}) =>
  String(template.id || template.templateId || template.readingsTemplateId || template.universalTemplateId || "");

const readingTemplateLabel = (template = {}) =>
  [template.name || template.chemType || "Reading", template.UOM || template.uom || ""]
    .filter(Boolean)
    .join(" ")
    .trim();

const sortReadingTemplates = (templates = []) =>
  [...templates].sort((a, b) => readingTemplateLabel(a).localeCompare(readingTemplateLabel(b)));

const hasNumericValue = (value) => value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));

const parseReadingNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").replaceAll(",", "").trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const defaultReadingHealthFilterFor = (template = {}) => {
  const templateId = readingTemplateKey(template);
  if (hasNumericValue(template.highWarning)) {
    return { templateId, operator: "gt", threshold: String(template.highWarning) };
  }
  if (hasNumericValue(template.lowWarning)) {
    return { templateId, operator: "lt", threshold: String(template.lowWarning) };
  }
  return { templateId, operator: "gt", threshold: "" };
};

const readingPerformanceStandardKey = (standard = {}, index = 0) =>
  [
    standard.templateId || "reading",
    standard.operator || "gt",
    String(standard.threshold ?? "value").replace(/[^a-zA-Z0-9.-]+/g, "-"),
    index,
  ].join("-");

const withReadingPerformanceStandardId = (standard, index = 0) => ({
  ...standard,
  id: standard.id || readingPerformanceStandardKey(standard, index),
});

const defaultReadingPerformanceStandardsFor = (templates = []) => {
  const template = templates.find((item) => readingTemplateKey(item));
  return template ? [withReadingPerformanceStandardId(defaultReadingHealthFilterFor(template))] : [];
};

const createDefaultForm = () => ({
  title: "",
  subtitle: "",
  reportType: "readingPerformance",
  mode: "summary",
  groupBy: "company",
  quickDateRange: "thisMonth",
  dateRange: defaultDateRange(),
  selectedCustomerTags: [],
  readingHealthFilters: {
    templateId: "",
    operator: "gt",
    threshold: "",
  },
  readingPerformanceView: "users",
  readingPerformanceStandards: [],
});

const sanitizeDateRange = (value = {}) => {
  const fallback = defaultDateRange();
  return {
    start: value.start || fallback.start,
    end: value.end || fallback.end,
  };
};

const cleanReadingPerformanceStandards = (standards = []) =>
  standards
    .map((standard, index) => withReadingPerformanceStandardId({
      templateId: String(standard.templateId || ""),
      operator: standard.operator || "gt",
      threshold: String(standard.threshold ?? "").trim(),
    }, index))
    .filter((standard) => standard.templateId && Number.isFinite(parseReadingNumber(standard.threshold)));

const withTemplateDefaults = (form, readingTemplates = []) => {
  if (!readingTemplates.length) return form;

  const templateKeys = new Set(readingTemplates.map(readingTemplateKey));
  const healthTemplateExists = templateKeys.has(String(form.readingHealthFilters?.templateId || ""));
  const nextHealthFilters = healthTemplateExists
    ? form.readingHealthFilters
    : defaultReadingHealthFilterFor(readingTemplates[0]);

  return {
    ...form,
    readingHealthFilters: nextHealthFilters,
    readingPerformanceStandards: form.readingPerformanceStandards?.length
      ? form.readingPerformanceStandards.map(withReadingPerformanceStandardId)
      : defaultReadingPerformanceStandardsFor(readingTemplates),
  };
};

const formFromCustomReport = (customReport, readingTemplates = []) => {
  const controls = customReport.controls || {};
  return withTemplateDefaults({
    ...createDefaultForm(),
    title: customReport.title || "",
    subtitle: customReport.subtitle || "",
    reportType: controls.reportType || customReport.reportType || "readingPerformance",
    mode: controls.mode || "summary",
    groupBy: controls.groupBy || "company",
    quickDateRange: controls.quickDateRange || "thisMonth",
    dateRange: sanitizeDateRange(controls.dateRange),
    selectedCustomerTags: Array.isArray(controls.selectedCustomerTags) ? controls.selectedCustomerTags : [],
    readingHealthFilters: {
      templateId: controls.readingHealthFilters?.templateId || "",
      operator: controls.readingHealthFilters?.operator || "gt",
      threshold: controls.readingHealthFilters?.threshold ?? "",
    },
    readingPerformanceView: controls.readingPerformanceView === "customers" ? "customers" : "users",
    readingPerformanceStandards: Array.isArray(controls.readingPerformanceStandards)
      ? controls.readingPerformanceStandards.map(withReadingPerformanceStandardId)
      : [],
  }, readingTemplates);
};

const customReportsRef = (companyId) => collection(db, "companies", companyId, "customReports");

const customReportDocRef = (companyId, reportId) => doc(db, "companies", companyId, "customReports", reportId);

const formatTimestamp = (value) => {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  return date ? format(date, "M/d/yyyy h:mm a") : "Not saved";
};

const CustomReports = () => {
  const { recentlySelectedCompany, user: authUser, dataBaseUser } = useContext(Context);
  const { can } = useCompanyPermissions();
  const canViewPayrollInformation = can("420");
  const permittedReportCatalog = useMemo(
    () => canViewPayrollInformation
      ? reportCatalog
      : reportCatalog.filter((report) => !payrollOnlyReportTypes.has(report.value)),
    [canViewPayrollInformation]
  );

  const [customReports, setCustomReports] = useState([]);
  const [availableReadingTemplates, setAvailableReadingTemplates] = useState([]);
  const [availableCustomerTags, setAvailableCustomerTags] = useState([]);
  const [form, setForm] = useState(createDefaultForm);
  const [editingReportId, setEditingReportId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState("");

  const selectedReport = useMemo(
    () => reportCatalog.find((report) => report.value === form.reportType) || reportCatalog[0],
    [form.reportType]
  );

  const editingReport = useMemo(
    () => customReports.find((report) => report.id === editingReportId) || null,
    [customReports, editingReportId]
  );

  const resetForm = () => {
    setEditingReportId("");
    setForm(withTemplateDefaults(createDefaultForm(), availableReadingTemplates));
  };

  const fetchCustomReports = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setCustomReports([]);
      return;
    }

    setIsLoading(true);
    try {
      const reportsSnap = await getDocs(query(customReportsRef(recentlySelectedCompany), orderBy("updatedAt", "desc")));
      setCustomReports(normalizeDocs(reportsSnap));
    } catch (error) {
      console.error("Failed to load custom reports:", error);
      toast.error(`Could not load custom reports: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    fetchCustomReports();
  }, [fetchCustomReports]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAvailableReadingTemplates([]);
      setAvailableCustomerTags([]);
      setForm(createDefaultForm());
      setEditingReportId("");
      return;
    }

    let isActive = true;

    const fetchControlOptions = async () => {
      try {
        const [readingsSnap, customersSnap] = await Promise.all([
          getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "readings", "readings")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
        ]);

        if (!isActive) return;

        const readingTemplates = sortReadingTemplates(normalizeDocs(readingsSnap));
        const customerTags = getCustomerTagOptions(normalizeDocs(customersSnap));

        setAvailableReadingTemplates(readingTemplates);
        setAvailableCustomerTags(customerTags);
        setForm((currentForm) => withTemplateDefaults(currentForm, readingTemplates));
      } catch (error) {
        console.error("Failed to load custom report control options:", error);
        toast.error(`Could not load report controls: ${error.message}`);
      }
    };

    fetchControlOptions();

    return () => {
      isActive = false;
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!canViewPayrollInformation && payrollOnlyReportTypes.has(form.reportType)) {
      setForm((currentForm) => ({ ...currentForm, reportType: "readings" }));
    }
  }, [canViewPayrollInformation, form.reportType]);

  const updateForm = (updates) => {
    setForm((currentForm) => ({
      ...currentForm,
      ...updates,
    }));
  };

  const handleReportTypeChange = (reportType) => {
    updateForm(withTemplateDefaults({ reportType }, availableReadingTemplates));
  };

  const handleQuickDateRangeChange = (value) => {
    const preset = dateRangePresets.find((item) => item.value === value);
    updateForm({
      quickDateRange: value,
      dateRange: preset?.getRange ? preset.getRange() : form.dateRange,
    });
  };

  const handleReadingTemplateChange = (templateId) => {
    const nextTemplate = availableReadingTemplates.find((template) => readingTemplateKey(template) === templateId);
    updateForm({
      readingHealthFilters: nextTemplate ? defaultReadingHealthFilterFor(nextTemplate) : { templateId, operator: "gt", threshold: "" },
    });
  };

  const updateReadingHealthFilter = (field, value) => {
    updateForm({
      readingHealthFilters: {
        ...form.readingHealthFilters,
        [field]: value,
      },
    });
  };

  const updateReadingPerformanceStandard = (standardId, field, value) => {
    updateForm({
      readingPerformanceStandards: form.readingPerformanceStandards.map((standard, index) => {
        if (standard.id !== standardId) return standard;

        if (field === "templateId") {
          const nextTemplate = availableReadingTemplates.find((template) => readingTemplateKey(template) === value);
          return withReadingPerformanceStandardId(
            nextTemplate ? defaultReadingHealthFilterFor(nextTemplate) : { templateId: value, operator: "gt", threshold: "" },
            index
          );
        }

        return {
          ...standard,
          [field]: value,
        };
      }),
    });
  };

  const addReadingPerformanceStandard = () => {
    const template = availableReadingTemplates[0] || {};
    const nextStandard = withReadingPerformanceStandardId({
      ...defaultReadingHealthFilterFor(template),
      id: `manual-${Date.now()}-${form.readingPerformanceStandards.length}`,
    });
    updateForm({
      readingPerformanceStandards: [...form.readingPerformanceStandards, nextStandard],
    });
  };

  const removeReadingPerformanceStandard = (standardId) => {
    updateForm({
      readingPerformanceStandards: form.readingPerformanceStandards.filter((standard) => standard.id !== standardId),
    });
  };

  const toggleCustomerTagFilter = (tag) => {
    updateForm({
      selectedCustomerTags: form.selectedCustomerTags.includes(tag)
        ? form.selectedCustomerTags.filter((currentTag) => currentTag !== tag)
        : [...form.selectedCustomerTags, tag],
    });
  };

  const controlsPayload = () => ({
    reportType: form.reportType,
    mode: form.mode,
    groupBy: form.groupBy,
    quickDateRange: form.quickDateRange,
    dateRange: sanitizeDateRange(form.dateRange),
    selectedCustomerTags: form.selectedCustomerTags,
    readingHealthFilters: {
      templateId: form.readingHealthFilters.templateId || "",
      operator: form.readingHealthFilters.operator || "gt",
      threshold: String(form.readingHealthFilters.threshold ?? "").trim(),
    },
    readingPerformanceView: form.readingPerformanceView === "customers" ? "customers" : "users",
    readingPerformanceStandards: cleanReadingPerformanceStandards(form.readingPerformanceStandards),
  });

  const validateForm = () => {
    if (!recentlySelectedCompany) {
      toast.error("Please select a company.");
      return false;
    }

    if (!form.title.trim()) {
      toast.error("Add a custom report title.");
      return false;
    }

    if (payrollOnlyReportTypes.has(form.reportType) && !canViewPayrollInformation) {
      toast.error("Payroll reports require payroll information permission.");
      return false;
    }

    if (form.reportType === "readingHealth") {
      if (!availableReadingTemplates.length) {
        toast.error("No reading templates found for this company.");
        return false;
      }
      if (!form.readingHealthFilters.templateId) {
        toast.error("Select a reading to check.");
        return false;
      }
      if (!Number.isFinite(parseReadingNumber(form.readingHealthFilters.threshold))) {
        toast.error("Enter a numeric reading threshold.");
        return false;
      }
    }

    if (form.reportType === "readingPerformance") {
      if (!availableReadingTemplates.length) {
        toast.error("No reading templates found for this company.");
        return false;
      }
      if (!cleanReadingPerformanceStandards(form.readingPerformanceStandards).length) {
        toast.error("Add at least one good standing standard.");
        return false;
      }
    }

    return true;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!validateForm()) return;

    setIsSaving(true);
    const toastId = toast.loading(editingReportId ? "Updating custom report..." : "Creating custom report...");

    const actorId = dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "";
    const actorName = dataBaseUser?.userName || dataBaseUser?.displayName || authUser?.displayName || authUser?.email || "";
    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim(),
      reportType: form.reportType,
      controls: controlsPayload(),
      companyId: recentlySelectedCompany,
      updatedAt: serverTimestamp(),
      updatedByUserId: actorId,
      updatedByName: actorName,
    };

    try {
      if (editingReportId) {
        await updateDoc(customReportDocRef(recentlySelectedCompany, editingReportId), payload);
        toast.success("Custom report updated.", { id: toastId });
      } else {
        const reportRef = await addDoc(customReportsRef(recentlySelectedCompany), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUserId: actorId,
          createdByName: actorName,
        });
        setEditingReportId(reportRef.id);
        toast.success("Custom report created.", { id: toastId });
      }

      await fetchCustomReports();
    } catch (error) {
      console.error("Failed to save custom report:", error);
      toast.error(`Could not save custom report: ${error.message}`, { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectReport = (customReport) => {
    setEditingReportId(customReport.id);
    setForm(formFromCustomReport(customReport, availableReadingTemplates));
  };

  const handleDeleteReport = async (customReport) => {
    if (!recentlySelectedCompany) return;
    const confirmed = window.confirm(`Delete ${customReport.title || "this custom report"}?`);
    if (!confirmed) return;

    setDeletingReportId(customReport.id);
    const toastId = toast.loading("Deleting custom report...");

    try {
      await deleteDoc(customReportDocRef(recentlySelectedCompany, customReport.id));
      if (editingReportId === customReport.id) resetForm();
      await fetchCustomReports();
      toast.success("Custom report deleted.", { id: toastId });
    } catch (error) {
      console.error("Failed to delete custom report:", error);
      toast.error(`Could not delete custom report: ${error.message}`, { id: toastId });
    } finally {
      setDeletingReportId("");
    }
  };

  const renderReadingHealthControls = () => (
    <div className="border-t border-slate-200 pt-4">
      <label className="block text-sm font-semibold text-slate-700">Reading</label>
      <select
        value={form.readingHealthFilters.templateId}
        onChange={(event) => handleReadingTemplateChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
      >
        {availableReadingTemplates.length ? (
          availableReadingTemplates.map((template) => (
            <option key={readingTemplateKey(template)} value={readingTemplateKey(template)}>
              {readingTemplateLabel(template)}
            </option>
          ))
        ) : (
          <option value="">No readings found</option>
        )}
      </select>

      <div className="mt-3 grid grid-cols-[1fr_120px] gap-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Rule</label>
          <select
            value={form.readingHealthFilters.operator}
            onChange={(event) => updateReadingHealthFilter("operator", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
          >
            {readingOperatorOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Value</label>
          <input
            type="number"
            step="any"
            value={form.readingHealthFilters.threshold}
            onChange={(event) => updateReadingHealthFilter("threshold", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
          />
        </div>
      </div>
    </div>
  );

  const renderReadingPerformanceControls = () => (
    <>
      <div className="border-t border-slate-200 pt-4">
        <label className="block text-sm font-semibold text-slate-700">Performance View</label>
        <select
          value={form.readingPerformanceView}
          onChange={(event) => updateForm({ readingPerformanceView: event.target.value })}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
        >
          {readingPerformanceViewOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between gap-3">
          <label className="block text-sm font-semibold text-slate-700">Good Standing Standards</label>
          <button
            type="button"
            onClick={addReadingPerformanceStandard}
            disabled={!availableReadingTemplates.length}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            title="Add standard"
          >
            <PlusIcon className="h-4 w-4" />
            Add
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {form.readingPerformanceStandards.length ? (
            form.readingPerformanceStandards.map((standard, index) => (
              <div key={standard.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Standard {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeReadingPerformanceStandard(standard.id)}
                    disabled={form.readingPerformanceStandards.length <= 1}
                    className="rounded-md border border-slate-200 bg-white p-1 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Remove standard"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>

                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reading</label>
                <select
                  value={standard.templateId || ""}
                  onChange={(event) => updateReadingPerformanceStandard(standard.id, "templateId", event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                >
                  {availableReadingTemplates.length ? (
                    availableReadingTemplates.map((template) => (
                      <option key={readingTemplateKey(template)} value={readingTemplateKey(template)}>
                        {readingTemplateLabel(template)}
                      </option>
                    ))
                  ) : (
                    <option value="">No readings found</option>
                  )}
                </select>

                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Rule</label>
                    <select
                      value={standard.operator || "gt"}
                      onChange={(event) => updateReadingPerformanceStandard(standard.id, "operator", event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                    >
                      {readingOperatorOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Value</label>
                    <input
                      type="number"
                      step="any"
                      value={standard.threshold ?? ""}
                      onChange={(event) => updateReadingPerformanceStandard(standard.id, "threshold", event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No reading templates found.</p>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-4 sm:px-3 lg:px-4">
      <div className="w-full">
        <header className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Custom Reports</h1>
            <p className="mt-1 text-sm text-slate-600">Saved report controls.</p>
          </div>
          <Link
            to="/company/reports"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-500 hover:text-slate-950"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            Reports
          </Link>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={handleSave} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editingReport ? "Edit Custom Report" : "New Custom Report"}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">{selectedReport.label}</p>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
              >
                <PlusIcon className="h-4 w-4" />
                New
              </button>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(event) => updateForm({ title: event.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Subtitle</label>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(event) => updateForm({ subtitle: event.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Report</label>
                <select
                  value={form.reportType}
                  onChange={(event) => handleReportTypeChange(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                >
                  {permittedReportCatalog.map((report) => (
                    <option key={report.value} value={report.value}>{report.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Output</label>
                <select
                  value={form.mode}
                  onChange={(event) => updateForm({ mode: event.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                >
                  <option value="summary">Summary</option>
                  <option value="detail">Detail</option>
                </select>
              </div>
              {!fixedGroupingReportTypes.has(form.reportType) ? (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Group By</label>
                  <select
                    value={form.groupBy}
                    onChange={(event) => updateForm({ groupBy: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  >
                    {groupOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Date Range</label>
                <select
                  value={form.quickDateRange}
                  onChange={(event) => handleQuickDateRangeChange(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                >
                  {dateRangePresets.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 self-end">
                <input
                  type="date"
                  value={form.dateRange.start}
                  onChange={(event) => updateForm({
                    quickDateRange: "custom",
                    dateRange: { ...form.dateRange, start: event.target.value },
                  })}
                  className="rounded-md border border-slate-300 p-2 text-sm"
                />
                <input
                  type="date"
                  value={form.dateRange.end}
                  onChange={(event) => updateForm({
                    quickDateRange: "custom",
                    dateRange: { ...form.dateRange, end: event.target.value },
                  })}
                  className="rounded-md border border-slate-300 p-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-semibold text-slate-700">Customer Tags</label>
                {form.selectedCustomerTags.length ? (
                  <button
                    type="button"
                    onClick={() => updateForm({ selectedCustomerTags: [] })}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {availableCustomerTags.length ? (
                  availableCustomerTags.map((tag) => {
                    const selected = form.selectedCustomerTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleCustomerTagFilter(tag)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">No customer tags found.</p>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {form.reportType === "readingHealth" ? renderReadingHealthControls() : null}
              {form.reportType === "readingPerformance" ? renderReadingPerformanceControls() : null}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              {editingReportId ? (
                <Link
                  to={`/company/reports?customReportId=${encodeURIComponent(editingReportId)}`}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  Open in Reports
                </Link>
              ) : <span />}
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <DocumentTextIcon className="h-4 w-4" />
                {isSaving ? "Saving..." : editingReportId ? "Update Custom Report" : "Create Custom Report"}
              </button>
            </div>
          </form>

          <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Custom Report Library</h2>
                <p className="mt-1 text-sm text-slate-500">{customReports.length} report(s)</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  Loading custom reports...
                </div>
              ) : customReports.length ? (
                customReports.map((customReport) => {
                  const controls = customReport.controls || {};
                  const selected = customReport.id === editingReportId;
                  const standardsCount = cleanReadingPerformanceStandards(controls.readingPerformanceStandards).length;

                  return (
                    <div
                      key={customReport.id}
                      className={`rounded-lg border p-3 shadow-sm transition ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                    >
                      <button type="button" onClick={() => handleSelectReport(customReport)} className="w-full text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-bold">{customReport.title || "Untitled Custom Report"}</p>
                            <p className={`mt-1 text-xs ${selected ? "text-slate-200" : "text-slate-500"}`}>
                              {customReport.subtitle || reportLabel(controls.reportType || customReport.reportType)}
                            </p>
                          </div>
                          <PencilSquareIcon className={`h-5 w-5 shrink-0 ${selected ? "text-slate-200" : "text-slate-400"}`} />
                        </div>
                        <div className={`mt-3 grid grid-cols-2 gap-2 text-xs ${selected ? "text-slate-200" : "text-slate-600"}`}>
                          <span>{reportLabel(controls.reportType || customReport.reportType)}</span>
                          <span>{controls.mode === "detail" ? "Detail" : "Summary"}</span>
                          <span>{datePresetLabel(controls.quickDateRange)}</span>
                          <span>{controls.selectedCustomerTags?.length ? `${controls.selectedCustomerTags.length} tag(s)` : "All tags"}</span>
                          {controls.reportType === "readingPerformance" ? <span>{standardsCount} standard(s)</span> : null}
                        </div>
                        <p className={`mt-3 text-xs ${selected ? "text-slate-300" : "text-slate-500"}`}>
                          Updated {formatTimestamp(customReport.updatedAt)}
                        </p>
                      </button>
                      <div className="mt-3 flex items-center gap-2">
                        <Link
                          to={`/company/reports?customReportId=${encodeURIComponent(customReport.id)}`}
                          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition ${selected ? "border-white/30 text-white hover:bg-white/10" : "border-blue-200 text-blue-700 hover:bg-blue-50"}`}
                        >
                          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                          Open
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDeleteReport(customReport)}
                          disabled={deletingReportId === customReport.id}
                          className={`inline-flex items-center justify-center rounded-md border p-2 transition disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-white/30 text-white hover:bg-white/10" : "border-red-200 text-red-700 hover:bg-red-50"}`}
                          title="Delete custom report"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  No custom reports yet.
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default CustomReports;
