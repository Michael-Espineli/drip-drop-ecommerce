import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import toast from "react-hot-toast";
import {
  ArrowLeftIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const DEFAULT_ONBOARDING_TEMPLATE_ITEMS = [
  {
    id: "default_invite_access",
    name: "Confirm company access",
    description: "Verify the user accepted the invite and can access the selected company.",
    sortOrder: 10,
  },
  {
    id: "default_profile",
    name: "Complete profile",
    description: "Confirm name, email, phone, photo, and basic profile details are filled in.",
    sortOrder: 20,
  },
  {
    id: "default_role_permissions",
    name: "Review role and permissions",
    description: "Assign the correct company role and confirm the user has the access they need.",
    sortOrder: 30,
  },
  {
    id: "default_payroll",
    name: "Review payroll setup",
    description: "Confirm worker type, rate sheet, payroll settings, and any required tax paperwork.",
    sortOrder: 40,
  },
  {
    id: "default_field_training",
    name: "Complete field orientation",
    description: "Review route workflow, service stop expectations, photos, notes, safety, and chemical handling.",
    sortOrder: 50,
  },
];

const emptyDraft = {
  id: "",
  name: "",
  description: "",
  sortOrder: "",
  active: true,
};

const templateItemsRef = (companyId) => (
  collection(db, "companies", companyId, "settings", "onboardingChecklist", "items")
);

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

const normalizeTemplateItem = (item = {}, fallbackOrder = 0) => ({
  id: item.id || "",
  name: String(item.name || "").trim(),
  description: String(item.description || "").trim(),
  sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : fallbackOrder,
  active: item.active !== false,
});

const OnboardingChecklistSettings = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { requirePermission } = useCompanyPermissions();
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name)),
    [items]
  );

  const loadItems = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const snapshot = await getDocs(query(templateItemsRef(recentlySelectedCompany), orderBy("sortOrder", "asc")));
      setItems(snapshot.docs.map((itemDoc, index) => normalizeTemplateItem({ id: itemDoc.id, ...itemDoc.data() }, index * 10)));
    } catch (error) {
      console.error("Error loading onboarding templates:", error);
      toast.error("Could not load onboarding checklist.");
    } finally {
      setIsLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const seedDefaults = async () => {
    if (!requirePermission("800", "manage company settings")) return;
    if (!recentlySelectedCompany) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      DEFAULT_ONBOARDING_TEMPLATE_ITEMS.forEach((item) => {
        batch.set(doc(templateItemsRef(recentlySelectedCompany), item.id), {
          ...item,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      toast.success("Default onboarding checklist added.");
      await loadItems();
    } catch (error) {
      console.error("Error seeding onboarding defaults:", error);
      toast.error("Could not add default checklist.");
    } finally {
      setIsSaving(false);
    }
  };

  const editItem = (item) => {
    setDraft({
      id: item.id,
      name: item.name || "",
      description: item.description || "",
      sortOrder: String(item.sortOrder ?? ""),
      active: item.active !== false,
    });
  };

  const resetDraft = () => setDraft(emptyDraft);

  const saveItem = async (event) => {
    event.preventDefault();
    if (!requirePermission("800", "manage company settings")) return;
    if (!recentlySelectedCompany) return;

    const name = draft.name.trim();
    if (!name) {
      toast.error("Add a name before saving.");
      return;
    }

    setIsSaving(true);
    try {
      const itemRef = draft.id
        ? doc(templateItemsRef(recentlySelectedCompany), draft.id)
        : doc(templateItemsRef(recentlySelectedCompany));
      const payload = {
        id: itemRef.id,
        name,
        description: draft.description.trim(),
        sortOrder: Number(draft.sortOrder || 0),
        active: draft.active !== false,
        updatedAt: serverTimestamp(),
        ...(draft.id ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(itemRef, payload, { merge: true });
      setItems((current) => {
        const next = current.filter((item) => item.id !== itemRef.id);
        return [...next, normalizeTemplateItem(payload)];
      });
      resetDraft();
      toast.success("Onboarding item saved.");
    } catch (error) {
      console.error("Error saving onboarding item:", error);
      toast.error("Could not save onboarding item.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeItem = async (item) => {
    if (!requirePermission("800", "manage company settings")) return;
    if (!recentlySelectedCompany || !item?.id) return;
    if (!window.confirm(`Delete "${item.name}" from the onboarding template?`)) return;

    setIsSaving(true);
    try {
      await deleteDoc(doc(templateItemsRef(recentlySelectedCompany), item.id));
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      toast.success("Onboarding item deleted.");
    } catch (error) {
      console.error("Error deleting onboarding item:", error);
      toast.error("Could not delete onboarding item.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="w-full space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link to="/company/settings" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeftIcon className="h-4 w-4" />
              Back to Settings
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">Onboarding Checklist</h1>
            <p className="mt-1 text-sm text-slate-500">Customize the default checklist copied onto new company users.</p>
          </div>
          <button
            type="button"
            onClick={seedDefaults}
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckIcon className="h-4 w-4" />
            Add Defaults
          </button>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <form onSubmit={saveItem} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">{draft.id ? "Edit Item" : "New Item"}</h2>
            <div className="mt-4 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Name</span>
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={inputClass} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Description</span>
                <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={5} className={`${inputClass} min-h-[130px]`} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Sort Order</span>
                <input type="number" value={draft.sortOrder} onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))} className={inputClass} />
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Active
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {draft.id && (
                <button type="button" onClick={resetDraft} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                  Cancel
                </button>
              )}
              <button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                <PlusIcon className="h-4 w-4" />
                {isSaving ? "Saving..." : "Save Item"}
              </button>
            </div>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-950">Template Items</h2>
              <p className="mt-1 text-sm text-slate-500">{sortedItems.length} item{sortedItems.length === 1 ? "" : "s"} in the company template.</p>
            </div>
            {isLoading ? (
              <p className="p-5 text-sm text-slate-500">Loading onboarding checklist...</p>
            ) : sortedItems.length === 0 ? (
              <div className="p-5">
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="text-sm font-semibold text-slate-800">No onboarding items yet</p>
                  <p className="mt-1 text-sm text-slate-500">Add defaults or create the first checklist item.</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sortedItems.map((item) => (
                  <article key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-950">{item.name}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {item.active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{item.description || "No description"}</p>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sort {item.sortOrder}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => editItem(item)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                        Edit
                      </button>
                      <button type="button" onClick={() => removeItem(item)} className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
};

export default OnboardingChecklistSettings;
