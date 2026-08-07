import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import toast from "react-hot-toast";
import {
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { appConfirm } from "../../../utils/appDialog";
import {
  DEFAULT_TEXT_MESSAGE_TEMPLATES,
  TEXT_MESSAGE_TEMPLATE_TOKENS,
  mergeTextMessageTemplates,
  normalizeTextMessageTemplate,
  textMessageTemplatesRef,
} from "../../../utils/textMessageTemplates";

const emptyDraft = {
  id: "",
  name: "",
  description: "",
  body: "",
  sortOrder: "",
  active: true,
};

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

const TextMessageTemplates = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { requirePermission } = useCompanyPermissions();
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadTemplates = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setTemplates([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const snapshot = await getDocs(query(textMessageTemplatesRef(db, recentlySelectedCompany), orderBy("sortOrder", "asc")));
      setTemplates(snapshot.docs.map((templateDoc, index) => normalizeTextMessageTemplate({
        id: templateDoc.id,
        ...templateDoc.data(),
      }, index)));
    } catch (error) {
      console.error("Error loading text templates:", error);
      toast.error("Could not load text templates.");
    } finally {
      setIsLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const displayTemplates = useMemo(
    () => mergeTextMessageTemplates(templates, { includeInactive: true }),
    [templates]
  );
  const activeCount = displayTemplates.filter((template) => template.active !== false).length;
  const savedCount = templates.length;

  const resetDraft = () => setDraft(emptyDraft);

  const editTemplate = (template) => {
    setDraft({
      id: template.id,
      name: template.name || "",
      description: template.description || "",
      body: template.body || "",
      sortOrder: String(template.sortOrder ?? ""),
      active: template.active !== false,
    });
  };

  const appendToken = (token) => {
    setDraft((current) => ({
      ...current,
      body: `${current.body || ""}${current.body ? " " : ""}${token}`,
    }));
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    if (!requirePermission("800", "manage text templates")) return;
    if (!recentlySelectedCompany) return;

    const name = draft.name.trim();
    const body = draft.body.trim();

    if (!name) {
      toast.error("Add a template name before saving.");
      return;
    }

    if (!body) {
      toast.error("Add message copy before saving.");
      return;
    }

    setIsSaving(true);

    try {
      const ref = draft.id
        ? doc(textMessageTemplatesRef(db, recentlySelectedCompany), draft.id)
        : doc(textMessageTemplatesRef(db, recentlySelectedCompany));
      const payload = {
        id: ref.id,
        name,
        description: draft.description.trim(),
        body,
        sortOrder: Number.isFinite(Number(draft.sortOrder)) ? Number(draft.sortOrder) : (displayTemplates.length + 1) * 10,
        active: draft.active !== false,
        updatedAt: serverTimestamp(),
        ...(draft.id ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(ref, payload, { merge: true });
      setTemplates((current) => {
        const next = current.filter((template) => template.id !== ref.id);
        return [...next, normalizeTextMessageTemplate(payload)];
      });
      resetDraft();
      toast.success("Text template saved.");
    } catch (error) {
      console.error("Error saving text template:", error);
      toast.error("Could not save text template.");
    } finally {
      setIsSaving(false);
    }
  };

  const seedDefaults = async () => {
    if (!requirePermission("800", "manage text templates")) return;
    if (!recentlySelectedCompany) return;

    setIsSaving(true);

    try {
      const batch = writeBatch(db);
      DEFAULT_TEXT_MESSAGE_TEMPLATES.forEach((template) => {
        batch.set(doc(textMessageTemplatesRef(db, recentlySelectedCompany), template.id), {
          ...template,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      toast.success("Default text templates saved.");
      await loadTemplates();
    } catch (error) {
      console.error("Error saving default text templates:", error);
      toast.error("Could not save default templates.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTemplateActive = async (template) => {
    if (!requirePermission("800", "manage text templates")) return;
    if (!recentlySelectedCompany || !template?.id) return;

    setIsSaving(true);

    try {
      const payload = {
        id: template.id,
        name: template.name || "Text Template",
        description: template.description || "",
        body: template.body || "",
        sortOrder: Number(template.sortOrder || 0),
        active: template.active === false,
        updatedAt: serverTimestamp(),
        ...(template.isSaved ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(doc(textMessageTemplatesRef(db, recentlySelectedCompany), template.id), payload, { merge: true });
      setTemplates((current) => {
        const next = current.filter((item) => item.id !== template.id);
        return [...next, normalizeTextMessageTemplate(payload)];
      });
      toast.success(payload.active ? "Template activated." : "Template deactivated.");
    } catch (error) {
      console.error("Error toggling text template:", error);
      toast.error("Could not update template.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeTemplate = async (template) => {
    if (!requirePermission("800", "manage text templates")) return;
    if (!recentlySelectedCompany || !template?.id || !template.isSaved) return;

    const confirmed = await appConfirm({
      title: template.isBuiltInDefault ? "Reset Text Template" : "Delete Text Template",
      message: template.isBuiltInDefault
        ? `Reset "${template.name}" back to the built-in default?`
        : `Delete "${template.name}" from company text templates?`,
      confirmLabel: template.isBuiltInDefault ? "Reset Template" : "Delete Template",
      variant: template.isBuiltInDefault ? "default" : "danger",
    });
    if (!confirmed) return;

    setIsSaving(true);

    try {
      await deleteDoc(doc(textMessageTemplatesRef(db, recentlySelectedCompany), template.id));
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (draft.id === template.id) resetDraft();
      toast.success(template.isBuiltInDefault ? "Template reset." : "Template deleted.");
    } catch (error) {
      console.error("Error deleting text template:", error);
      toast.error("Could not remove template.");
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
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                <ChatBubbleLeftRightIcon className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-950">Text Templates</h1>
                <p className="mt-1 text-sm text-slate-500">Reusable SMS drafts for route technicians.</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={seedDefaults}
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckIcon className="h-4 w-4" />
            Save Defaults
          </button>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{displayTemplates.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{activeCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{savedCount}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]">
          <form onSubmit={saveTemplate} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">{draft.id ? "Edit Template" : "New Template"}</h2>
            <div className="mt-4 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Name</span>
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={inputClass} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Description</span>
                <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className={inputClass} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Message</span>
                <textarea value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} rows={8} className={`${inputClass} min-h-[180px]`} />
              </label>
              <div>
                <p className="text-sm font-semibold text-slate-700">Tokens</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TEXT_MESSAGE_TEMPLATE_TOKENS.map((item) => (
                    <button
                      key={item.token}
                      type="button"
                      onClick={() => appendToken(item.token)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Sort Order</span>
                  <input type="number" value={draft.sortOrder} onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))} className={inputClass} />
                </label>
                <label className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  Active
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {draft.id && (
                <button type="button" onClick={resetDraft} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                  Cancel
                </button>
              )}
              <button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                <PlusIcon className="h-4 w-4" />
                {isSaving ? "Saving..." : "Save Template"}
              </button>
            </div>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-950">Company Templates</h2>
              <p className="mt-1 text-sm text-slate-500">{activeCount} active draft{activeCount === 1 ? "" : "s"} for technicians.</p>
            </div>
            {isLoading ? (
              <p className="p-5 text-sm text-slate-500">Loading text templates...</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {displayTemplates.map((template) => (
                  <article key={template.id} className="px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-950">{template.name}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                            {template.active ? "Active" : "Inactive"}
                          </span>
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                            {template.isSaved ? "Saved" : "Built-in"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{template.description || "No description"}</p>
                        <p className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm leading-6 text-slate-700">{template.body}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button type="button" onClick={() => editTemplate(template)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                          {template.isSaved ? "Edit" : "Customize"}
                        </button>
                        <button type="button" onClick={() => toggleTemplateActive(template)} disabled={isSaving} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60">
                          {template.active ? "Deactivate" : "Activate"}
                        </button>
                        {template.isSaved && (
                          <button type="button" onClick={() => removeTemplate(template)} disabled={isSaving} className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
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

export default TextMessageTemplates;
