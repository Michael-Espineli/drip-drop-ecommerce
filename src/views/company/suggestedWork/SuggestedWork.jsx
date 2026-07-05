import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  DEFAULT_SUGGESTED_WORK_TIER,
  SUGGESTED_WORK_STATUS,
  SUGGESTED_WORK_STATUS_OPTIONS,
  SUGGESTED_WORK_TIER_OPTIONS,
  getSuggestedWorkTierLabel,
  getSuggestedWorkTierTone,
  isOpenSuggestedWorkStatus,
  normalizeSuggestedWorkTier,
} from "../../../utils/models/SuggestedWork";

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
  if (!millis) return "No date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(millis));
};

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(value || 0) || 0) / 100);

const centsFromDollars = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const getCustomerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany && customer.companyName) return customer.companyName;
  return (
    customer.customerName ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    customer.name ||
    "Customer"
  );
};

const tierClasses = (tier) => {
  switch (getSuggestedWorkTierTone(tier)) {
    case "red":
      return "border-red-200 bg-red-50 text-red-700";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "blue":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "emerald":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
};

const statusClasses = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "open":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "deferred":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "converted to job":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "declined":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
};

const Pill = ({ children, className = "" }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
    {children}
  </span>
);

const SuggestedWork = () => {
  const navigate = useNavigate();
  const { recentlySelectedCompany, dataBaseUser, currentUser, user } = useContext(Context);
  const { can } = useCompanyPermissions();

  const [suggestions, setSuggestions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("current");
  const [tierFilter, setTierFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [draft, setDraft] = useState({
    customerId: "",
    title: "",
    description: "",
    priorityLevel: DEFAULT_SUGGESTED_WORK_TIER,
    estimatedPrice: "",
  });

  const canManageSuggestedWork = can("24") || can("34");
  const canCreateJobs = can("22");

  const loadSuggestedWork = async () => {
    if (!recentlySelectedCompany) {
      setSuggestions([]);
      setCustomers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [suggestionsSnap, customersSnap] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "suggestedWork")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
      ]);

      setSuggestions(suggestionsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      setCustomers(
        customersSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => getCustomerDisplayName(a).localeCompare(getCustomerDisplayName(b)))
      );
    } catch (error) {
      console.error("Failed to load suggested work:", error);
      toast.error("Failed to load suggested work.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestedWork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany]);

  const summary = useMemo(() => {
    const current = suggestions.filter((item) => isOpenSuggestedWorkStatus(item.status));
    const mustFix = current.filter((item) => normalizeSuggestedWorkTier(item.priorityLevel || item.solutionTier) === 1);

    return {
      current: current.length,
      mustFix: mustFix.length,
      totalPriceCents: current.reduce((total, item) => total + Number(item.estimatedPriceCents || item.jobRateCents || 0), 0),
    };
  }, [suggestions]);

  const filteredSuggestions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return suggestions
      .filter((item) => {
        if (statusFilter === "current" && !isOpenSuggestedWorkStatus(item.status)) return false;
        if (statusFilter !== "current" && statusFilter !== "all" && item.status !== statusFilter) return false;
        if (tierFilter !== "all" && normalizeSuggestedWorkTier(item.priorityLevel || item.solutionTier) !== Number(tierFilter)) return false;
        if (customerFilter !== "all" && item.customerId !== customerFilter) return false;

        const searchable = [
          item.title,
          item.description,
          item.note,
          item.customerName,
          item.status,
          item.priorityLabel,
          getSuggestedWorkTierLabel(item.priorityLevel || item.solutionTier),
          item.jobInternalId,
          item.repairRequestId,
          item.equipmentName,
          item.bodyOfWaterName,
          item.serviceLocationName,
        ].filter(Boolean).join(" ").toLowerCase();

        return !term || searchable.includes(term);
      })
      .sort((left, right) => {
        const tierCompare =
          normalizeSuggestedWorkTier(left.priorityLevel || left.solutionTier) -
          normalizeSuggestedWorkTier(right.priorityLevel || right.solutionTier);
        if (tierCompare !== 0) return tierCompare;

        return toMillis(right.updatedAt || right.createdAt || right.statusChangedAt) -
          toMillis(left.updatedAt || left.createdAt || left.statusChangedAt);
      });
  }, [suggestions, searchTerm, statusFilter, tierFilter, customerFilter]);

  const resetDraft = () => {
    setDraft({
      customerId: customers[0]?.id || "",
      title: "",
      description: "",
      priorityLevel: DEFAULT_SUGGESTED_WORK_TIER,
      estimatedPrice: "",
    });
  };

  const openCreateModal = () => {
    resetDraft();
    setShowCreateModal(true);
  };

  const saveManualSuggestion = async (event) => {
    event.preventDefault();
    if (!canManageSuggestedWork) return toast.error("You do not have access to manage suggested work.");
    if (!recentlySelectedCompany) return;

    const customer = customers.find((item) => item.id === draft.customerId);
    if (!customer) return toast.error("Choose a customer.");
    if (!draft.title.trim() && !draft.description.trim()) return toast.error("Add a title or description.");

    try {
      setSaving(true);
      const id = `comp_suggested_work_${uuidv4()}`;
      const nowMillis = Date.now();
      const priorityLevel = normalizeSuggestedWorkTier(draft.priorityLevel);
      const priorityLabel = getSuggestedWorkTierLabel(priorityLevel);
      const actor = currentUser || user || {};
      const actorName =
        [dataBaseUser?.firstName, dataBaseUser?.lastName].filter(Boolean).join(" ") ||
        actor.displayName ||
        actor.userName ||
        "";

      await setDoc(doc(db, "companies", recentlySelectedCompany, "suggestedWork", id), {
        id,
        companyId: recentlySelectedCompany,
        customerId: customer.id,
        customerName: getCustomerDisplayName(customer),
        title: draft.title.trim() || `${priorityLabel}: Suggested work`,
        description: draft.description.trim(),
        note: draft.description.trim(),
        status: SUGGESTED_WORK_STATUS.OPEN,
        suggestionStatus: SUGGESTED_WORK_STATUS.OPEN,
        priorityLevel,
        priorityLabel,
        solutionTier: priorityLevel,
        solutionTierLabel: priorityLabel,
        estimatedPriceCents: centsFromDollars(draft.estimatedPrice),
        sourceType: "manual",
        sourceId: "",
        sourcePath: "",
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
        createdByUserId: actor.uid || actor.id || "",
        createdByUserName: actorName,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      });

      toast.success("Suggested work added.");
      setShowCreateModal(false);
      await loadSuggestedWork();
    } catch (error) {
      console.error("Failed to create suggested work:", error);
      toast.error("Failed to create suggested work.");
    } finally {
      setSaving(false);
    }
  };

  const updateSuggestion = async (suggestion, updates) => {
    if (!canManageSuggestedWork) return toast.error("You do not have access to manage suggested work.");
    if (!recentlySelectedCompany || !suggestion?.id) return;

    try {
      const nowMillis = Date.now();
      const remoteUpdates = {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      };
      const localUpdates = {
        ...updates,
        updatedAtMillis: nowMillis,
      };

      if (updates.priorityLevel !== undefined) {
        const priorityLevel = normalizeSuggestedWorkTier(updates.priorityLevel);
        const priorityLabel = getSuggestedWorkTierLabel(priorityLevel);
        remoteUpdates.priorityLevel = priorityLevel;
        remoteUpdates.priorityLabel = priorityLabel;
        remoteUpdates.solutionTier = priorityLevel;
        remoteUpdates.solutionTierLabel = priorityLabel;
        localUpdates.priorityLevel = priorityLevel;
        localUpdates.priorityLabel = priorityLabel;
        localUpdates.solutionTier = priorityLevel;
        localUpdates.solutionTierLabel = priorityLabel;
      }

      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "suggestedWork", suggestion.id),
        remoteUpdates
      );

      setSuggestions((prev) =>
        prev.map((item) =>
          item.id === suggestion.id
            ? { ...item, ...localUpdates }
            : item
        )
      );
    } catch (error) {
      console.error("Failed to update suggested work:", error);
      toast.error("Failed to update suggested work.");
    }
  };

  const openSource = (suggestion) => {
    if (suggestion.jobId || suggestion.sourceType === "job") {
      navigate(`/company/jobs/detail/${suggestion.jobId || suggestion.sourceId}`);
      return;
    }

    if (suggestion.repairRequestId || suggestion.sourceType === "repairRequest") {
      navigate(`/company/repair-requests/detail/${suggestion.repairRequestId || suggestion.sourceId}`, {
        state: {
          sourcePath: suggestion.repairRequestSourcePath || (String(suggestion.sourcePath || "").startsWith("homeowner") ? "homeowner" : "company"),
        },
      });
    }
  };

  const createJobFromSuggestion = (suggestion) => {
    navigate("/company/jobs/createNew", {
      state: {
        suggestedWork: suggestion,
      },
    });
  };

  const renderSuggestion = (suggestion) => {
    const priorityLevel = normalizeSuggestedWorkTier(suggestion.priorityLevel || suggestion.solutionTier);
    const priceCents = suggestion.estimatedPriceCents || suggestion.jobRateCents || 0;
    const sourceLabel =
      suggestion.sourceType === "job"
        ? "Job"
        : suggestion.sourceType === "repairRequest"
          ? "Repair Request"
          : "Manual";

    return (
      <tr key={suggestion.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
        <td className="px-4 py-4">
          <Pill className={tierClasses(priorityLevel)}>
            {priorityLevel} - {getSuggestedWorkTierLabel(priorityLevel)}
          </Pill>
        </td>
        <td className="px-4 py-4">
          <p className="font-semibold text-slate-950">{suggestion.title || "Suggested work"}</p>
          {suggestion.description || suggestion.note ? (
            <p className="mt-1 line-clamp-3 max-w-2xl whitespace-pre-line text-sm text-slate-600">
              {suggestion.description || suggestion.note}
            </p>
          ) : null}
          {[suggestion.bodyOfWaterName, suggestion.equipmentName, suggestion.serviceLocationName]
            .filter(Boolean).length > 0 && (
              <p className="mt-2 text-xs font-semibold text-slate-500">
                {[suggestion.bodyOfWaterName, suggestion.equipmentName, suggestion.serviceLocationName].filter(Boolean).join(" - ")}
              </p>
            )}
        </td>
        <td className="px-4 py-4 text-sm font-semibold text-slate-800">
          {suggestion.customerId ? (
            <button
              type="button"
              onClick={() => navigate(`/company/customers/details/${suggestion.customerId}`)}
              className="text-left text-blue-700 hover:underline"
            >
              {suggestion.customerName || "Customer"}
            </button>
          ) : (
            suggestion.customerName || "No customer"
          )}
        </td>
        <td className="px-4 py-4">
          <Pill className={statusClasses(suggestion.status)}>
            {suggestion.status || SUGGESTED_WORK_STATUS.OPEN}
          </Pill>
          <p className="mt-2 text-xs text-slate-500">{sourceLabel}</p>
        </td>
        <td className="px-4 py-4 text-sm font-semibold text-slate-800">
          {moneyFromCents(priceCents)}
          <p className="mt-2 text-xs font-normal text-slate-500">
            {formatDate(suggestion.updatedAt || suggestion.createdAt || suggestion.statusChangedAt || suggestion.updatedAtMillis)}
          </p>
        </td>
        <td className="px-4 py-4">
          <div className="flex min-w-[210px] flex-col gap-2">
            {canManageSuggestedWork && (
              <>
                <select
                  value={priorityLevel}
                  onChange={(event) => updateSuggestion(suggestion, { priorityLevel: event.target.value })}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  {SUGGESTED_WORK_TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value} - {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={suggestion.status || SUGGESTED_WORK_STATUS.OPEN}
                  onChange={(event) => updateSuggestion(suggestion, { status: event.target.value, suggestionStatus: event.target.value })}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  {SUGGESTED_WORK_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {(suggestion.sourceId || suggestion.jobId || suggestion.repairRequestId) && (
                <button
                  type="button"
                  onClick={() => openSource(suggestion)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Source
                </button>
              )}
              {canCreateJobs && isOpenSuggestedWorkStatus(suggestion.status) && (
                <button
                  type="button"
                  onClick={() => createJobFromSuggestion(suggestion)}
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Create Job
                </button>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">Suggested Work</h1>
            <p className="mt-1 text-sm text-slate-600">Customer recommendations ranked from urgent to best-version work.</p>
          </div>
          {canManageSuggestedWork && (
            <button
              type="button"
              onClick={openCreateModal}
              className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
            >
              Add Suggested Work
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Current</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{summary.current}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide opacity-70">Critical</p>
            <p className="mt-2 text-2xl font-bold">{summary.mustFix}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide opacity-70">Current Value</p>
            <p className="mt-2 text-2xl font-bold">{moneyFromCents(summary.totalPriceCents)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,2fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(220px,1fr)]">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Search suggestions..."
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="current">Current</option>
              <option value="all">All Statuses</option>
              {SUGGESTED_WORK_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              value={tierFilter}
              onChange={(event) => setTierFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All Priorities</option>
              {SUGGESTED_WORK_TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value} - {option.label}
                </option>
              ))}
            </select>
            <select
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All Customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {getCustomerDisplayName(customer)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">Loading suggested work...</div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-semibold text-slate-800">No suggested work found.</p>
              <p className="mt-1 text-sm text-slate-500">Change filters or add a recommendation.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Work</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Value</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSuggestions.map(renderSuggestion)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={saveManualSuggestion}
            className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Add Suggested Work</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Customer</span>
                <select
                  value={draft.customerId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, customerId: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {getCustomerDisplayName(customer)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Priority</span>
                <select
                  value={draft.priorityLevel}
                  onChange={(event) => setDraft((prev) => ({ ...prev, priorityLevel: normalizeSuggestedWorkTier(event.target.value) }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {SUGGESTED_WORK_TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value} - {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Title</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Suggested repair"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Description</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                  className="min-h-[140px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Scope, reason, and customer-facing notes..."
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Estimated Price</span>
                <input
                  value={draft.estimatedPrice}
                  onChange={(event) => setDraft((prev) => ({ ...prev, estimatedPrice: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default SuggestedWork;
