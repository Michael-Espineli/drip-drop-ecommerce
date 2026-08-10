import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import EquipmentCatalogPicker from "../../components/equipment/EquipmentCatalogPicker";
import { CATALOG_READY_STATUS } from "../../../utils/universalEquipmentSuggestions";

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50";
const labelClassName = "block text-xs font-semibold uppercase text-slate-500 mb-1";

const statusTone = (status) => {
  if (status === "Reconciled") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === CATALOG_READY_STATUS) return "border-purple-200 bg-purple-50 text-purple-700";
  if (status === "Reviewed") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "Dismissed") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDateTime = (value) => {
  const millis = toMillis(value);
  if (!millis) return "No date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(millis));
};

const compact = (items = []) => items.filter(Boolean).join(" ");

const catalogModelId = (equipment = {}) => equipment.universalEquipmentId || equipment.modelId || "";

const suggestionToDraft = (suggestion = {}) => ({
  type: suggestion.reconciledType || suggestion.type || "",
  category: suggestion.reconciledType || suggestion.type || "",
  typeId: suggestion.reconciledTypeId || suggestion.typeId || "",
  make: suggestion.reconciledMake || suggestion.make || "",
  makeId: suggestion.reconciledMakeId || suggestion.makeId || "",
  model: suggestion.reconciledModel || suggestion.model || "",
  modelId: suggestion.reconciledModelId || suggestion.reconciledUniversalEquipmentId || suggestion.modelId || suggestion.universalEquipmentId || "",
  universalEquipmentId: suggestion.reconciledUniversalEquipmentId || suggestion.universalEquipmentId || suggestion.modelId || "",
  manualPdfLink: suggestion.reconciledManualPdfLink || suggestion.manualPdfLink || "",
});

const searchTextFor = (suggestion = {}, equipment = {}) => (
  [
    suggestion.equipmentName,
    suggestion.equipmentId,
    suggestion.type,
    suggestion.make,
    suggestion.model,
    suggestion.customerName,
    suggestion.status,
    equipment.name,
    equipment.type,
    equipment.make,
    equipment.model,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
);

const Stat = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
  </div>
);

const UniversalEquipmentSuggestions = () => {
  const { recentlySelectedCompany, user } = useContext(Context);
  const { can, permissionsReady } = useCompanyPermissions();
  const canUpdateEquipment = permissionsReady && can("64");

  const [suggestions, setSuggestions] = useState([]);
  const [equipmentById, setEquipmentById] = useState({});
  const [matchDrafts, setMatchDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  const loadSuggestions = async () => {
    if (!recentlySelectedCompany) {
      setSuggestions([]);
      setEquipmentById({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const suggestionSnap = await getDocs(
        query(
          collection(db, "universalEquipmentSuggestions"),
          where("companyId", "==", recentlySelectedCompany)
        )
      );
      const nextSuggestions = suggestionSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const equipmentIds = [...new Set(nextSuggestions.map((item) => item.equipmentId).filter(Boolean))];

      const equipmentEntries = await Promise.all(
        equipmentIds.map(async (equipmentId) => {
          const equipmentSnap = await getDoc(doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId));
          return [
            equipmentId,
            equipmentSnap.exists() ? { id: equipmentSnap.id, ...equipmentSnap.data() } : null,
          ];
        })
      );

      setSuggestions(nextSuggestions);
      setEquipmentById(Object.fromEntries(equipmentEntries));
      setMatchDrafts((current) => {
        const nextDrafts = { ...current };
        nextSuggestions.forEach((suggestion) => {
          if (!nextDrafts[suggestion.id]) nextDrafts[suggestion.id] = suggestionToDraft(suggestion);
        });
        return nextDrafts;
      });
    } catch (error) {
      console.error("Failed to load universal equipment suggestions:", error);
      toast.error("Failed to load suggested universal equipment.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany]);

  const summary = useMemo(() => {
    const open = suggestions.filter((item) => !["Dismissed", "Reconciled"].includes(item.status)).length;
    const reconciled = suggestions.filter((item) => item.status === "Reconciled").length;
    const ready = suggestions.filter((item) => {
      const equipment = equipmentById[item.equipmentId] || {};
      return Boolean(catalogModelId(equipment) || item.reconciledUniversalEquipmentId);
    }).length;

    return { open, reconciled, ready, total: suggestions.length };
  }, [equipmentById, suggestions]);

  const filteredSuggestions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return suggestions
      .filter((suggestion) => {
        if (statusFilter === "open" && ["Dismissed", "Reconciled"].includes(suggestion.status)) return false;
        if (statusFilter !== "open" && statusFilter !== "all" && suggestion.status !== statusFilter) return false;

        const equipment = equipmentById[suggestion.equipmentId] || {};
        return !term || searchTextFor(suggestion, equipment).includes(term);
      })
      .sort((left, right) => {
        const statusRank = { [CATALOG_READY_STATUS]: 0, New: 1, Reviewed: 2, Reconciled: 3, Dismissed: 4 };
        const leftRank = statusRank[left.status] ?? 0;
        const rightRank = statusRank[right.status] ?? 0;
        if (leftRank !== rightRank) return leftRank - rightRank;

        return toMillis(right.createdAt || right.createdAtMillis) - toMillis(left.createdAt || left.createdAtMillis);
      });
  }, [equipmentById, searchTerm, statusFilter, suggestions]);

  const updateDraft = (suggestionId, nextDraft) => {
    setMatchDrafts((current) => ({
      ...current,
      [suggestionId]: nextDraft,
    }));
  };

  const copyMissingCatalogParts = async ({ equipmentId, universalEquipmentId, match }) => {
    const [universalPartsSnap, existingPartsSnap] = await Promise.all([
      getDocs(collection(db, "universal", "equipment", "equipment", universalEquipmentId, "parts")),
      getDocs(collection(db, "companies", recentlySelectedCompany, "equipment", equipmentId, "parts")),
    ]);

    const existingKeys = new Set();
    existingPartsSnap.docs.forEach((partDoc) => {
      const part = partDoc.data() || {};
      if (part.universalPartId) existingKeys.add(`universal:${part.universalPartId}`);
      if (part.sku) existingKeys.add(`sku:${String(part.sku).trim().toLowerCase()}`);
      if (part.name) existingKeys.add(`name:${String(part.name).trim().toLowerCase()}`);
    });

    const writes = universalPartsSnap.docs
      .filter((partDoc) => {
        const part = partDoc.data() || {};
        const keys = [
          `universal:${part.id || partDoc.id}`,
          part.sku ? `sku:${String(part.sku).trim().toLowerCase()}` : "",
          part.name ? `name:${String(part.name).trim().toLowerCase()}` : "",
        ].filter(Boolean);

        return !keys.some((key) => existingKeys.has(key));
      })
      .map((partDoc) => {
        const part = partDoc.data() || {};
        const partId = `com_equ_par_${uuidv4()}`;

        return setDoc(doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId, "parts", partId), {
          id: partId,
          name: part.name || "",
          sku: part.sku || "",
          make: part.make || match.make || "",
          model: part.model || match.model || "",
          manualPdfLink: part.manualPdfLink || "",
          universalPartId: part.id || partDoc.id,
          universalEquipmentId,
          createdAt: serverTimestamp(),
        });
      });

    await Promise.all(writes);
    return writes.length;
  };

  const applyCatalogMatch = async (suggestion) => {
    if (!recentlySelectedCompany || !suggestion?.equipmentId) {
      toast.error("This suggestion is missing the original equipment record.");
      return;
    }

    const match = matchDrafts[suggestion.id] || suggestionToDraft(suggestion);
    const universalEquipmentId = catalogModelId(match);

    if (!universalEquipmentId || !match.typeId || !match.makeId) {
      toast.error("Choose a universal category, make, and model first.");
      return;
    }

    if (!canUpdateEquipment) {
      toast.error("You do not have permission to update equipment.");
      return;
    }

    try {
      setSavingId(suggestion.id);
      const equipmentRef = doc(db, "companies", recentlySelectedCompany, "equipment", suggestion.equipmentId);
      const equipmentSnap = await getDoc(equipmentRef);

      if (!equipmentSnap.exists()) {
        toast.error("The original equipment record could not be found.");
        return;
      }

      await updateDoc(equipmentRef, {
        type: match.type || match.category || "",
        category: match.type || match.category || "",
        typeId: match.typeId || "",
        make: match.make || "",
        makeId: match.makeId || "",
        model: match.model || "",
        modelId: universalEquipmentId,
        universalEquipmentId,
        manualPdfLink: match.manualPdfLink || "",
        catalogReconciledAt: serverTimestamp(),
        catalogReconciledByUserId: user?.uid || "",
        updatedAt: serverTimestamp(),
      });

      const partsCopied = await copyMissingCatalogParts({
        equipmentId: suggestion.equipmentId,
        universalEquipmentId,
        match,
      });

      await updateDoc(doc(db, "universalEquipmentSuggestions", suggestion.id), {
        status: "Reconciled",
        reconciledAt: serverTimestamp(),
        reconciledByUserId: user?.uid || "",
        reconciledByEmail: user?.email || "",
        reconciledEquipmentId: suggestion.equipmentId,
        reconciledUniversalEquipmentId: universalEquipmentId,
        reconciledType: match.type || match.category || "",
        reconciledTypeId: match.typeId || "",
        reconciledMake: match.make || "",
        reconciledMakeId: match.makeId || "",
        reconciledModel: match.model || "",
        reconciledModelId: universalEquipmentId,
        partsCopied,
        updatedAt: serverTimestamp(),
      });

      toast.success(partsCopied ? `Equipment matched. ${partsCopied} parts copied.` : "Equipment matched.");
      await loadSuggestions();
    } catch (error) {
      console.error("Failed to reconcile equipment suggestion:", error);
      toast.error("Failed to apply catalog match.");
    } finally {
      setSavingId("");
    }
  };

  const updateSuggestionStatus = async (suggestion, status) => {
    try {
      setSavingId(suggestion.id);
      await updateDoc(doc(db, "universalEquipmentSuggestions", suggestion.id), {
        status,
        updatedAt: serverTimestamp(),
        statusChangedByUserId: user?.uid || "",
      });
      toast.success(status === "Dismissed" ? "Suggestion dismissed." : "Suggestion reopened.");
      await loadSuggestions();
    } catch (error) {
      console.error("Failed to update equipment suggestion:", error);
      toast.error("Failed to update suggestion.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Equipment Catalog</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950">Suggested Universal Equipment</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/company/equipment/all-equipment"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Equipment List
            </Link>
            <button
              type="button"
              onClick={loadSuggestions}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open" value={summary.open} />
          <Stat label="Reconciled" value={summary.reconciled} />
          <Stat label="Already Matched" value={summary.ready} />
          <Stat label="Total" value={summary.total} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search equipment, customer, make, or model"
              className={inputClassName}
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={inputClassName}
            >
              <option value="open">Open</option>
              <option value="all">All statuses</option>
              <option value="New">New</option>
              <option value="Reviewed">Reviewed</option>
              <option value={CATALOG_READY_STATUS}>{CATALOG_READY_STATUS}</option>
              <option value="Reconciled">Reconciled</option>
              <option value="Dismissed">Dismissed</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading suggested universal equipment...
          </div>
        ) : filteredSuggestions.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            No suggested universal equipment found.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSuggestions.map((suggestion) => {
              const equipment = equipmentById[suggestion.equipmentId] || null;
              const draft = matchDrafts[suggestion.id] || suggestionToDraft(suggestion);
              const selectedUniversalEquipmentId = catalogModelId(draft);
              const existingUniversalEquipmentId = catalogModelId(equipment || {});
              const canApply = Boolean(selectedUniversalEquipmentId && draft.typeId && draft.makeId && suggestion.equipmentId);
              const isSaving = savingId === suggestion.id;

              return (
                <section key={suggestion.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(460px,0.9fr)]">
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-black text-slate-950">
                              {suggestion.equipmentName || equipment?.name || "Equipment"}
                            </h2>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(suggestion.status)}`}>
                              {suggestion.status || "New"}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatDateTime(suggestion.createdAt || suggestion.createdAtMillis)}
                          </p>
                        </div>

                        {suggestion.equipmentId && (
                          <Link
                            to={`/company/equipment/detail/${suggestion.equipmentId}`}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            View Equipment
                          </Link>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Suggested Values</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {compact([suggestion.type, suggestion.make, suggestion.model]) || "No values"}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">{suggestion.customerName || "No customer name"}</p>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Current Equipment</p>
                          {equipment ? (
                            <>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {compact([equipment.type, equipment.make, equipment.model]) || equipment.name || "Equipment"}
                              </p>
                              <p className="mt-2 text-xs text-slate-500">
                                {existingUniversalEquipmentId ? `Catalog ID: ${existingUniversalEquipmentId}` : "No catalog match"}
                              </p>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-rose-600">Original equipment not found.</p>
                          )}
                        </div>
                      </div>

                      {suggestion.reconciledUniversalEquipmentId && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                          Matched to {compact([suggestion.reconciledMake, suggestion.reconciledModel]) || suggestion.reconciledUniversalEquipmentId}
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <EquipmentCatalogPicker
                        value={draft}
                        onChange={(nextDraft) => updateDraft(suggestion.id, nextDraft)}
                        onModelSelected={(selectedModel) => updateDraft(suggestion.id, {
                          ...draft,
                          model: selectedModel?.model || selectedModel?.name || draft.model,
                          modelId: selectedModel?.id || draft.modelId,
                          universalEquipmentId: selectedModel?.id || draft.universalEquipmentId,
                          manualPdfLink: selectedModel?.manualPdfLink || draft.manualPdfLink,
                        })}
                        inputClassName={inputClassName}
                        labelClassName={labelClassName}
                        gridClassName="grid grid-cols-1 gap-3"
                        labels={{ type: "Universal Category", make: "Universal Make", model: "Universal Model" }}
                      />

                      <div className="flex flex-wrap justify-end gap-2">
                        {suggestion.status === "Dismissed" ? (
                          <button
                            type="button"
                            onClick={() => updateSuggestionStatus(suggestion, "New")}
                            disabled={isSaving}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            Reopen
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updateSuggestionStatus(suggestion, "Dismissed")}
                            disabled={isSaving || suggestion.status === "Reconciled"}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            Dismiss
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => applyCatalogMatch(suggestion)}
                          disabled={isSaving || !canApply || !canUpdateEquipment}
                          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {isSaving ? "Saving..." : "Apply Match"}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default UniversalEquipmentSuggestions;
