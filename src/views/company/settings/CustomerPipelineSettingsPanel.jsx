import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  CheckIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { appConfirm } from "../../../utils/appDialog";
import {
  DEFAULT_LEAD_SOURCES,
  DEFAULT_PIPELINE_TEMPLATE_ITEMS,
  PIPELINE_ITEM_TYPES,
  PIPELINE_LINK_TYPES,
  PIPELINE_UPDATE_PERMISSION_ID,
  leadSourceId,
  normalizeLeadSourceItem,
  normalizePipelineItem,
  pipelineLeadSourcesRef,
  pipelineTemplateItemsRef,
} from "../../../utils/customerPipeline";

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";

const emptyTemplateDraft = {
  id: "",
  title: "",
  description: "",
  sortOrder: "",
  itemType: "external",
  linkType: "external",
  active: true,
  isDefault: false,
  isInternal: false,
  canDelete: true,
};

const sortByOrderThenTitle = (left, right) => (
  Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
  String(left.title || left.name || "").localeCompare(String(right.title || right.name || ""))
);

const Modal = ({ title, children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const TemplateEditor = ({
  draft,
  setDraft,
  saving,
  onSave,
  onDelete,
  onClose,
}) => {
  const lockedLink = draft.id && (draft.isDefault || draft.isInternal);

  return (
    <Modal title={draft.id ? "Edit Pipeline Item" : "New Pipeline Item"} onClose={onClose}>
      <form onSubmit={onSave} className="space-y-4 p-5">
        {draft.id ? (
          <div className="flex flex-wrap gap-2">
            {draft.isDefault ? (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Default</span>
            ) : null}
            {draft.isInternal ? (
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">Internal</span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">External</span>
            )}
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${draft.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {draft.active ? "Active" : "Off"}
            </span>
          </div>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-slate-700">Title</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-slate-700">Description</span>
          <textarea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            rows={4}
            className={`${inputClass} min-h-[110px]`}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">Sort Order</span>
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">Type</span>
            <select
              value={draft.itemType}
              disabled={lockedLink}
              onChange={(event) => setDraft((current) => ({
                ...current,
                itemType: event.target.value,
                linkType: event.target.value === "external" ? "external" : current.linkType === "external" ? "customer" : current.linkType,
              }))}
              className={inputClass}
            >
              {PIPELINE_ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">Connected Area</span>
            <select
              value={draft.linkType}
              disabled={draft.itemType === "external" || lockedLink}
              onChange={(event) => setDraft((current) => ({ ...current, linkType: event.target.value }))}
              className={inputClass}
            >
              {PIPELINE_LINK_TYPES.map((linkType) => <option key={linkType.value} value={linkType.value}>{linkType.label}</option>)}
            </select>
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Active in customer pipeline
        </label>

        {lockedLink ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
            Default and internal pipeline items are protected because they connect to records in Drip Drop. You can edit the wording, sort order, and active state, but they cannot be deleted.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          {draft.id && draft.canDelete ? (
            <button
              type="button"
              onClick={() => onDelete(draft)}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckIcon className="h-4 w-4" />
            {saving ? "Saving..." : "Save Item"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const CustomerPipelineSettingsPanel = ({ companyId, onChange, compact = false }) => {
  const { requirePermission } = useCompanyPermissions();
  const [pipelineItems, setPipelineItems] = useState([]);
  const [leadSources, setLeadSources] = useState([]);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");

  const sortedItems = useMemo(
    () => [...pipelineItems].sort(sortByOrderThenTitle),
    [pipelineItems]
  );

  const sortedSources = useMemo(
    () => [...leadSources].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name)),
    [leadSources]
  );

  const loadSettings = useCallback(async () => {
    if (!companyId) {
      setPipelineItems([]);
      setLeadSources([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [templateSnap, sourceSnap] = await Promise.all([
        getDocs(query(pipelineTemplateItemsRef(companyId), orderBy("sortOrder", "asc"))),
        getDocs(query(pipelineLeadSourcesRef(companyId), orderBy("sortOrder", "asc"))),
      ]);

      setPipelineItems(
        templateSnap.empty
          ? DEFAULT_PIPELINE_TEMPLATE_ITEMS.map(normalizePipelineItem)
          : templateSnap.docs.map((itemDoc, index) => normalizePipelineItem({ id: itemDoc.id, ...itemDoc.data() }, index * 10))
      );
      setLeadSources(
        sourceSnap.empty
          ? DEFAULT_LEAD_SOURCES.map(normalizeLeadSourceItem)
          : sourceSnap.docs.map((sourceDoc, index) => normalizeLeadSourceItem({ id: sourceDoc.id, ...sourceDoc.data() }, index * 10))
      );
    } catch (error) {
      console.error("Unable to load customer pipeline settings:", error);
      toast.error("Could not load customer pipeline settings.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const notifyChanged = async () => {
    await Promise.resolve(onChange?.());
  };

  const seedDefaults = async () => {
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "manage customer pipeline settings")) return;
    if (!companyId) return;

    setSavingKey("seed-defaults");
    try {
      const batch = writeBatch(db);
      DEFAULT_PIPELINE_TEMPLATE_ITEMS.forEach((item) => {
        const existingItem = pipelineItems.find((currentItem) => (
          currentItem.isDefault &&
          (currentItem.linkType === item.linkType || String(currentItem.title || "").toLowerCase() === item.title.toLowerCase())
        ));
        const itemId = existingItem?.id || item.id;
        batch.set(doc(pipelineTemplateItemsRef(companyId), itemId), {
          ...item,
          id: itemId,
          active: true,
          isDefault: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      DEFAULT_LEAD_SOURCES.forEach((source) => {
        const existingSource = leadSources.find((currentSource) => (
          String(currentSource.name || "").toLowerCase() === source.name.toLowerCase()
        ));
        const sourceId = existingSource?.id || source.id;
        batch.set(doc(pipelineLeadSourcesRef(companyId), sourceId), {
          ...source,
          id: sourceId,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      toast.success("Default customer pipeline settings added.");
      await loadSettings();
      await notifyChanged();
    } catch (error) {
      console.error("Unable to seed pipeline defaults:", error);
      toast.error("Could not add customer pipeline defaults.");
    } finally {
      setSavingKey("");
    }
  };

  const openTemplateEditor = (item = null) => {
    if (item) {
      setTemplateDraft({
        id: item.id,
        title: item.title || "",
        description: item.description || "",
        sortOrder: String(item.sortOrder ?? ""),
        itemType: item.itemType || "external",
        linkType: item.linkType || "external",
        active: item.active !== false,
        isDefault: item.isDefault === true,
        isInternal: item.itemType === "internal",
        canDelete: item.canDelete === true,
      });
      return;
    }

    setTemplateDraft({
      ...emptyTemplateDraft,
      sortOrder: sortedItems.length ? String(Math.max(...sortedItems.map((item) => Number(item.sortOrder || 0))) + 10) : "10",
    });
  };

  const saveTemplateItem = async (event) => {
    event.preventDefault();
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "manage customer pipeline settings")) return;
    if (!companyId || !templateDraft) return;

    const title = templateDraft.title.trim();
    if (!title) {
      toast.error("Add a title before saving.");
      return;
    }

    setSavingKey("template-item");
    try {
      const itemRef = templateDraft.id
        ? doc(pipelineTemplateItemsRef(companyId), templateDraft.id)
        : doc(pipelineTemplateItemsRef(companyId));
      const currentItem = pipelineItems.find((item) => item.id === itemRef.id);
      const lockedLink = Boolean(currentItem?.isDefault || currentItem?.itemType === "internal");
      const itemType = lockedLink ? currentItem.itemType : templateDraft.itemType;
      const linkType = itemType === "external"
        ? "external"
        : lockedLink
          ? currentItem.linkType
          : templateDraft.linkType === "external"
            ? "customer"
            : templateDraft.linkType;
      const payload = {
        id: itemRef.id,
        title,
        description: templateDraft.description.trim(),
        sortOrder: Number(templateDraft.sortOrder || 0),
        itemType,
        linkType,
        active: templateDraft.active !== false,
        isDefault: currentItem?.isDefault === true || templateDraft.isDefault === true,
        updatedAt: serverTimestamp(),
        ...(templateDraft.id ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(itemRef, payload, { merge: true });
      setPipelineItems((currentItems) => {
        const next = currentItems.filter((item) => item.id !== itemRef.id);
        return [...next, normalizePipelineItem(payload)].sort(sortByOrderThenTitle);
      });
      setTemplateDraft(null);
      toast.success("Customer pipeline item saved.");
      await notifyChanged();
    } catch (error) {
      console.error("Unable to save pipeline item:", error);
      toast.error("Could not save the customer pipeline item.");
    } finally {
      setSavingKey("");
    }
  };

  const toggleTemplateItem = async (item) => {
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "manage customer pipeline settings")) return;
    if (!companyId || !item?.id) return;

    const active = item.active === false;
    setSavingKey(`toggle-template:${item.id}`);
    try {
      await setDoc(doc(pipelineTemplateItemsRef(companyId), item.id), {
        id: item.id,
        active,
        updatedAt: serverTimestamp(),
        ...(item.isDefault ? { isDefault: true } : {}),
      }, { merge: true });
      setPipelineItems((currentItems) => currentItems.map((currentItem) => (
        currentItem.id === item.id ? { ...currentItem, active } : currentItem
      )));
      toast.success(active ? "Pipeline item turned on." : "Pipeline item turned off.");
      await notifyChanged();
    } catch (error) {
      console.error("Unable to toggle pipeline item:", error);
      toast.error("Could not update this pipeline item.");
    } finally {
      setSavingKey("");
    }
  };

  const removeTemplateItem = async (item) => {
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "manage customer pipeline settings")) return;
    if (!companyId || !item?.id) return;

    if (!item.canDelete) {
      toast.error("Default and internal pipeline items can be turned off, but not deleted.");
      return;
    }

    const confirmed = await appConfirm({
      title: "Delete Pipeline Item",
      message: `Delete "${item.title}" from the customer pipeline template? Existing row signoffs will not be deleted, but the item will no longer display.`,
      confirmLabel: "Delete Item",
      variant: "danger",
    });
    if (!confirmed) return;

    setSavingKey(`delete-template:${item.id}`);
    try {
      await deleteDoc(doc(pipelineTemplateItemsRef(companyId), item.id));
      setPipelineItems((currentItems) => currentItems.filter((currentItem) => currentItem.id !== item.id));
      setTemplateDraft(null);
      toast.success("Customer pipeline item deleted.");
      await notifyChanged();
    } catch (error) {
      console.error("Unable to delete pipeline item:", error);
      toast.error("Could not delete the customer pipeline item.");
    } finally {
      setSavingKey("");
    }
  };

  const saveLeadSource = async (event) => {
    event.preventDefault();
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "manage customer pipeline settings")) return;
    if (!companyId) return;

    const name = sourceDraft.trim();
    if (!name) return;

    setSavingKey("lead-source");
    try {
      const id = leadSourceId(name);
      const payload = {
        id,
        name,
        sortOrder: sortedSources.length ? Math.max(...sortedSources.map((source) => Number(source.sortOrder || 0))) + 10 : 10,
        active: true,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(pipelineLeadSourcesRef(companyId), id), payload, { merge: true });
      setLeadSources((currentSources) => {
        if (currentSources.some((source) => source.id === id)) return currentSources;
        return [...currentSources, normalizeLeadSourceItem(payload)].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
      });
      setSourceDraft("");
      toast.success("Lead source saved.");
      await notifyChanged();
    } catch (error) {
      console.error("Unable to save lead source:", error);
      toast.error("Could not save this lead source.");
    } finally {
      setSavingKey("");
    }
  };

  return (
    <div id="customer-pipeline" className={compact ? "space-y-4" : "space-y-6"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Customer Onboarding Pipeline</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Manage the setup stages used by the customer pipeline. Internal items connect to Drip Drop records; external items are manual checks.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={seedDefaults}
            disabled={savingKey === "seed-defaults"}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckIcon className="h-4 w-4" />
            {savingKey === "seed-defaults" ? "Adding..." : "Add Defaults"}
          </button>
          <button
            type="button"
            onClick={() => openTemplateEditor()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <PlusIcon className="h-4 w-4" />
            New Pipeline Item
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Pipeline Items</h3>
          <p className="mt-1 text-sm text-slate-500">{sortedItems.length} item{sortedItems.length === 1 ? "" : "s"} in the customer pipeline template.</p>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-slate-500">Loading customer pipeline settings...</p>
        ) : sortedItems.length === 0 ? (
          <div className="p-5">
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm font-semibold text-slate-800">No pipeline items yet</p>
              <p className="mt-1 text-sm text-slate-500">Add defaults or create the first customer setup item.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedItems.map((item) => (
              <article key={item.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
                    {item.isDefault ? (
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Default</span>
                    ) : null}
                    {item.itemType === "internal" ? (
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">Internal</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">External</span>
                    )}
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {item.active ? "Active" : "Off"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{item.description || "No description"}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Sort {item.sortOrder} / {PIPELINE_LINK_TYPES.find((linkType) => linkType.value === item.linkType)?.label || item.linkType}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleTemplateItem(item)}
                    disabled={savingKey === `toggle-template:${item.id}`}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {item.active ? "Turn Off" : "Turn On"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openTemplateEditor(item)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">Lead Sources</h3>
            <p className="mt-1 text-sm text-slate-500">Sources show on leads, pipeline rows, and pipeline reports.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sortedSources.filter((source) => source.active !== false).map((source) => (
                <span key={source.id || source.name} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{source.name}</span>
              ))}
              {!sortedSources.filter((source) => source.active !== false).length ? (
                <span className="text-sm text-slate-500">No active lead sources yet.</span>
              ) : null}
            </div>
          </div>
          <form onSubmit={saveLeadSource} className="flex w-full gap-2 lg:max-w-sm">
            <input
              value={sourceDraft}
              onChange={(event) => setSourceDraft(event.target.value)}
              placeholder="New source"
              className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={savingKey === "lead-source"}
              className="rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add
            </button>
          </form>
        </div>
      </section>

      {templateDraft ? (
        <TemplateEditor
          draft={templateDraft}
          setDraft={setTemplateDraft}
          saving={savingKey === "template-item"}
          onSave={saveTemplateItem}
          onDelete={removeTemplateItem}
          onClose={() => setTemplateDraft(null)}
        />
      ) : null}
    </div>
  );
};

export default CustomerPipelineSettingsPanel;
