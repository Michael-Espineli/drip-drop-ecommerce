import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { v4 as uuidv4 } from "uuid";

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const centsFromMoney = (value) => Math.round(Number(value || 0) * 100);

const dollarsFromCents = (value) => ((Number(value || 0) / 100) || 0).toFixed(2);

const emptyTemplateForm = () => ({
  name: "",
  description: "",
  jobType: "",
  defaultRate: "0.00",
  defaultLaborCost: "0.00",
  isActive: true,
  locked: false,
});

const emptyTaskForm = () => ({
  name: "",
  type: "General",
  description: "",
  contractedRate: "0.00",
  estimatedTime: "0",
  customerApproval: false,
  sortOrder: "0",
});

const emptyStopForm = () => ({
  name: "",
  description: "",
  serviceStopTypeId: "",
  serviceStopTypeName: "",
  serviceStopTypeImage: "",
  serviceStopTypeUseCaseRawValue: "",
  estimatedMinutes: "0",
  sortOrder: "0",
  taskTemplateIds: "",
  plannedLaborCost: "0.00",
  plannedLaborNotes: "",
});

const emptyShoppingForm = () => ({
  name: "",
  subCategory: "Misc",
  description: "",
  quantity: "1",
  dbItemId: "",
  genericItemId: "",
  plannedUnitCost: "0.00",
  plannedUnitPrice: "0.00",
  billable: false,
  sortOrder: "0",
});

const sortByOrder = (items) =>
  [...items].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

const countSubcollection = async (companyId, templateId, subcollectionName) => {
  const snapshot = await getDocs(
    collection(db, "companies", companyId, "jobTemplates", templateId, subcollectionName)
  );

  return snapshot.size;
};

const JobTemplates = () => {
  const { recentlySelectedCompany, user } = useContext(Context);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [templateModal, setTemplateModal] = useState(null);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [detailTemplate, setDetailTemplate] = useState(null);
  const [detailTab, setDetailTab] = useState("tasks");
  const [detailLoading, setDetailLoading] = useState(false);
  const [details, setDetails] = useState({ tasks: [], plannedServiceStops: [], shoppingItems: [] });
  const [itemModal, setItemModal] = useState(null);
  const [itemForm, setItemForm] = useState({});
  const [savingItem, setSavingItem] = useState(false);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    const loadTemplates = async () => {
      setLoading(true);
      setError("");

      try {
        const templatesSnap = await getDocs(
          query(
            collection(db, "companies", recentlySelectedCompany, "jobTemplates"),
            orderBy("name", "asc")
          )
        );

        const templatesWithCounts = await Promise.all(
          templatesSnap.docs.map(async (docSnap) => {
            const data = docSnap.data();
            const id = data.id || docSnap.id;

            const [taskCount, plannedStopCount, shoppingItemCount] = await Promise.all([
              countSubcollection(recentlySelectedCompany, id, "tasks"),
              countSubcollection(recentlySelectedCompany, id, "plannedServiceStops"),
              countSubcollection(recentlySelectedCompany, id, "shoppingItems"),
            ]);

            return {
              ...data,
              id,
              taskCount,
              plannedStopCount,
              shoppingItemCount,
            };
          })
        );

        setTemplates(templatesWithCounts);
      } catch (err) {
        console.error("Error loading job templates:", err);
        setError("Could not load job templates.");
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
  }, [recentlySelectedCompany]);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return templates;

    return templates.filter((template) =>
      [
        template.id,
        template.name,
        template.description,
        template.jobType,
        template.templateReference,
        template.internalId,
        template.companyTemplateId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch))
    );
  }, [templates, search]);

  const openCreateModal = () => {
    setTemplateForm(emptyTemplateForm());
    setTemplateModal({ mode: "create", template: null });
    setActionError("");
    setActionMessage("");
  };

  const openEditModal = (template) => {
    setTemplateForm({
      name: template.name || "",
      description: template.description || "",
      jobType: template.jobType || template.type || "",
      defaultRate: dollarsFromCents(template.defaultRateCents || template.rate || 0),
      defaultLaborCost: dollarsFromCents(template.defaultLaborCostCents || 0),
      isActive: template.isActive !== false,
      locked: Boolean(template.locked),
    });
    setTemplateModal({ mode: "edit", template });
    setActionError("");
    setActionMessage("");
  };

  const closeTemplateModal = () => {
    if (saving) return;
    setTemplateModal(null);
    setTemplateForm(emptyTemplateForm());
  };

  const loadTemplateDetails = async (template) => {
    if (!recentlySelectedCompany || !template?.id) return;

    setDetailTemplate(template);
    setDetailTab("tasks");
    setDetailLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const [tasksSnap, stopsSnap, shoppingSnap] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, "tasks")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, "plannedServiceStops")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, "shoppingItems")),
      ]);

      setDetails({
        tasks: sortByOrder(tasksSnap.docs.map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))),
        plannedServiceStops: sortByOrder(stopsSnap.docs.map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))),
        shoppingItems: sortByOrder(shoppingSnap.docs.map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))),
      });
    } catch (err) {
      console.error("Error loading template details:", err);
      setActionError("Could not load template details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetails = () => {
    if (savingItem) return;
    setDetailTemplate(null);
    setDetails({ tasks: [], plannedServiceStops: [], shoppingItems: [] });
    setItemModal(null);
    setItemForm({});
  };

  const openItemModal = (type, item = null) => {
    if (type === "tasks") {
      setItemForm(item ? {
        name: item.name || "",
        type: item.type || "General",
        description: item.description || "",
        contractedRate: dollarsFromCents(item.contractedRate || 0),
        estimatedTime: String(item.estimatedTime || 0),
        customerApproval: Boolean(item.customerApproval),
        sortOrder: String(item.sortOrder || 0),
      } : emptyTaskForm());
    } else if (type === "plannedServiceStops") {
      setItemForm(item ? {
        name: item.name || "",
        description: item.description || "",
        serviceStopTypeId: item.serviceStopTypeId || "",
        serviceStopTypeName: item.serviceStopTypeName || "",
        serviceStopTypeImage: item.serviceStopTypeImage || "",
        serviceStopTypeUseCaseRawValue: item.serviceStopTypeUseCaseRawValue || "",
        estimatedMinutes: String(item.estimatedMinutes || 0),
        sortOrder: String(item.sortOrder || 0),
        taskTemplateIds: (item.taskTemplateIds || []).join(", "),
        plannedLaborCost: dollarsFromCents(item.plannedLaborCostCents || 0),
        plannedLaborNotes: item.plannedLaborNotes || "",
      } : emptyStopForm());
    } else {
      setItemForm(item ? {
        name: item.name || "",
        subCategory: item.subCategory || "Misc",
        description: item.description || "",
        quantity: item.quantity || "1",
        dbItemId: item.dbItemId || "",
        genericItemId: item.genericItemId || "",
        plannedUnitCost: dollarsFromCents(item.plannedUnitCostCents || 0),
        plannedUnitPrice: dollarsFromCents(item.plannedUnitPriceCents || 0),
        billable: Boolean(item.billable),
        sortOrder: String(item.sortOrder || 0),
      } : emptyShoppingForm());
    }

    setItemModal({ type, mode: item ? "edit" : "create", item });
  };

  const closeItemModal = () => {
    if (savingItem) return;
    setItemModal(null);
    setItemForm({});
  };

  const updateTemplateCount = (templateId, type, count) => {
    const countField = {
      tasks: "taskCount",
      plannedServiceStops: "plannedStopCount",
      shoppingItems: "shoppingItemCount",
    }[type];
    setTemplates((items) => items.map((item) => item.id === templateId ? { ...item, [countField]: count } : item));
  };

  const buildItemPayload = (type, id) => {
    if (type === "tasks") {
      return {
        id,
        companyId: recentlySelectedCompany,
        templateId: detailTemplate.id,
        name: itemForm.name.trim(),
        type: itemForm.type.trim() || "General",
        description: itemForm.description.trim(),
        contractedRate: centsFromMoney(itemForm.contractedRate),
        estimatedTime: Number(itemForm.estimatedTime || 0),
        customerApproval: Boolean(itemForm.customerApproval),
        sortOrder: Number(itemForm.sortOrder || 0),
      };
    }

    if (type === "plannedServiceStops") {
      return {
        id,
        companyId: recentlySelectedCompany,
        templateId: detailTemplate.id,
        name: itemForm.name.trim(),
        description: itemForm.description.trim(),
        serviceStopTypeId: itemForm.serviceStopTypeId.trim(),
        serviceStopTypeName: itemForm.serviceStopTypeName.trim(),
        serviceStopTypeImage: itemForm.serviceStopTypeImage.trim(),
        serviceStopTypeUseCaseRawValue: itemForm.serviceStopTypeUseCaseRawValue.trim(),
        estimatedMinutes: Number(itemForm.estimatedMinutes || 0),
        sortOrder: Number(itemForm.sortOrder || 0),
        taskTemplateIds: itemForm.taskTemplateIds.split(",").map((idValue) => idValue.trim()).filter(Boolean),
        plannedLaborCostCents: centsFromMoney(itemForm.plannedLaborCost),
        plannedLaborNotes: itemForm.plannedLaborNotes.trim(),
      };
    }

    const unitCostCents = centsFromMoney(itemForm.plannedUnitCost);
    const unitPriceCents = centsFromMoney(itemForm.plannedUnitPrice);
    const quantity = Number.parseFloat(itemForm.quantity) || 0;

    return {
      id,
      companyId: recentlySelectedCompany,
      templateId: detailTemplate.id,
      subCategory: itemForm.subCategory.trim() || "Misc",
      name: itemForm.name.trim(),
      description: itemForm.description.trim(),
      quantity: itemForm.quantity || "1",
      dbItemId: itemForm.dbItemId.trim() || null,
      genericItemId: itemForm.genericItemId.trim() || null,
      plannedUnitCostCents: unitCostCents,
      plannedUnitPriceCents: unitPriceCents,
      plannedTotalCostCents: unitCostCents * quantity,
      plannedTotalPriceCents: unitPriceCents * quantity,
      billable: Boolean(itemForm.billable),
      sortOrder: Number(itemForm.sortOrder || 0),
    };
  };

  const saveTemplateItem = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany || !detailTemplate || !itemModal || !itemForm.name?.trim()) return;

    setSavingItem(true);
    setActionError("");
    setActionMessage("");

    try {
      const idPrefix = {
        tasks: "comp_job_template_task_",
        plannedServiceStops: "comp_job_template_plan_stop_",
        shoppingItems: "comp_job_template_shop_item_",
      }[itemModal.type];
      const itemId = itemModal.mode === "create" ? `${idPrefix}${uuidv4()}` : itemModal.item.id;
      const payload = buildItemPayload(itemModal.type, itemId);
      const itemRef = doc(db, "companies", recentlySelectedCompany, "jobTemplates", detailTemplate.id, itemModal.type, itemId);
      await setDoc(itemRef, payload, { merge: true });

      setDetails((current) => {
        const nextList = sortByOrder([
          ...current[itemModal.type].filter((item) => item.id !== itemId),
          payload,
        ]);
        updateTemplateCount(detailTemplate.id, itemModal.type, nextList.length);
        return { ...current, [itemModal.type]: nextList };
      });
      setActionMessage("Template detail saved.");
      setItemModal(null);
      setItemForm({});
    } catch (err) {
      console.error("Error saving template detail:", err);
      setActionError("Could not save template detail.");
    } finally {
      setSavingItem(false);
    }
  };

  const deleteTemplateItem = async (type, item) => {
    if (!recentlySelectedCompany || !detailTemplate || !item?.id) return;
    if (!window.confirm(`Delete "${item.name || "template item"}"?`)) return;

    setSavingItem(true);
    setActionError("");
    setActionMessage("");

    try {
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "jobTemplates", detailTemplate.id, type, item.id));
      setDetails((current) => {
        const nextList = current[type].filter((detailItem) => detailItem.id !== item.id);
        updateTemplateCount(detailTemplate.id, type, nextList.length);
        return { ...current, [type]: nextList };
      });
      setActionMessage("Template detail deleted.");
    } catch (err) {
      console.error("Error deleting template detail:", err);
      setActionError("Could not delete template detail.");
    } finally {
      setSavingItem(false);
    }
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany || !templateForm.name.trim()) return;

    setSaving(true);
    setActionError("");
    setActionMessage("");

    try {
      const now = new Date();
      const isCreate = templateModal?.mode === "create";
      const templateId = isCreate ? `comp_job_template_${uuidv4()}` : templateModal.template.id;
      const templateRef = doc(db, "companies", recentlySelectedCompany, "jobTemplates", templateId);
      const payload = {
        id: templateId,
        companyId: recentlySelectedCompany,
        name: templateForm.name.trim(),
        description: templateForm.description.trim(),
        jobType: templateForm.jobType.trim(),
        defaultRateCents: centsFromMoney(templateForm.defaultRate),
        defaultLaborCostCents: centsFromMoney(templateForm.defaultLaborCost),
        isActive: templateForm.isActive,
        locked: templateForm.locked,
        updatedAt: now,
      };

      if (isCreate) {
        payload.createdAt = now;
        payload.createdByUserId = user?.uid || "";
        await setDoc(templateRef, payload);
        setTemplates((items) =>
          [...items, { ...payload, taskCount: 0, plannedStopCount: 0, shoppingItemCount: 0 }]
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        );
        setActionMessage("Job template created.");
      } else {
        await updateDoc(templateRef, payload);
        setTemplates((items) =>
          items.map((item) => (item.id === templateId ? { ...item, ...payload } : item))
        );
        setActionMessage("Job template updated.");
      }

      setTemplateModal(null);
      setTemplateForm(emptyTemplateForm());
    } catch (err) {
      console.error("Error saving job template:", err);
      setActionError("Could not save job template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link to="/company/settings" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
              &larr; Back to Settings
            </Link>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Job Templates</h1>
            <p className="mt-1 text-slate-600">
              Reusable job plans shared with iOS from companies/{recentlySelectedCompany || "companyId"}/jobTemplates.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              New Template
            </button>
            <Link
              to="/company/jobs"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create Job From Template
            </Link>
          </div>
        </header>

        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, job type, Firebase ID, or company template ID"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">Loading job templates...</div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>
        ) : (
          <>
            {actionMessage ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{actionMessage}</div> : null}
            {actionError ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{actionError}</div> : null}
          </>
        )}

        {!loading && !error && templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-slate-900">No job templates found.</h2>
            <p className="mt-2 text-slate-500">Templates created on iOS or web will appear here when saved to the canonical path.</p>
          </div>
        ) : null}

        {!loading && !error && templates.length > 0 && filteredTemplates.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No templates match that search.</div>
        ) : null}

        {!loading && !error && filteredTemplates.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template) => (
              <article key={template.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{template.name || "Job Template"}</h2>
                    {template.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{template.description}</p>
                    ) : null}
                  </div>
                  {template.isActive === false ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Inactive</span>
                  ) : (
                    <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">Active</span>
                  )}
                </div>
                <p className="mt-2 break-all text-xs text-slate-500">{template.templateReference || template.internalId || template.companyTemplateId || template.id}</p>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                  <Metric label="Tasks" value={template.taskCount} />
                  <Metric label="Stops" value={template.plannedStopCount} />
                  <Metric label="Items" value={template.shoppingItemCount} />
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <span>Default price</span>
                    <span className="font-semibold text-slate-900">
                      {moneyFromCents(template.defaultRateCents || template.rate || 0)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span>Default labor</span>
                    <span className="font-semibold text-slate-900">{moneyFromCents(template.defaultLaborCostCents || 0)}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span>Job type</span>
                    <span className="font-semibold text-slate-900">{template.jobType || template.type || "-"}</span>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={() => loadTemplateDetails(template)}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(template)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
      {detailTemplate ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{detailTemplate.name}</h2>
                <p className="mt-1 break-all text-sm text-slate-500">{detailTemplate.id}</p>
              </div>
              <button type="button" onClick={closeDetails} className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ["tasks", "Tasks"],
                ["plannedServiceStops", "Planned Stops"],
                ["shoppingItems", "Shopping Items"],
              ].map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${detailTab === tab ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => openItemModal(detailTab)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Add {detailTab === "plannedServiceStops" ? "Planned Stop" : detailTab === "shoppingItems" ? "Shopping Item" : "Task"}
              </button>
            </div>

            {detailLoading ? (
              <div className="mt-4 rounded-lg border border-slate-200 p-6 text-center text-slate-500">Loading details...</div>
            ) : details[detailTab].length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">No records in this section yet.</div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Details</th>
                      <th className="px-4 py-3 text-right">Order</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {details[detailTab].map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{item.name || "Untitled"}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {detailTab === "tasks" ? (
                            <span>{item.type || "Task"} · {moneyFromCents(item.contractedRate)} · {item.estimatedTime || 0} min</span>
                          ) : detailTab === "plannedServiceStops" ? (
                            <span>{item.serviceStopTypeName || "Stop"} · {item.estimatedMinutes || 0} min · {(item.taskTemplateIds || []).length} task link(s)</span>
                          ) : (
                            <span>{item.subCategory || "Item"} · Qty {item.quantity || 1} · {moneyFromCents(item.plannedTotalCostCents)}</span>
                          )}
                          {item.description ? <p className="mt-1 text-xs text-slate-500">{item.description}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">{item.sortOrder || 0}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openItemModal(detailTab, item)}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteTemplateItem(detailTab, item)}
                              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {itemModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form onSubmit={saveTemplateItem} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-900">
                {itemModal.mode === "create" ? "Add" : "Edit"} {itemModal.type === "plannedServiceStops" ? "Planned Stop" : itemModal.type === "shoppingItems" ? "Shopping Item" : "Task"}
              </h2>
              <button type="button" onClick={closeItemModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="text-sm font-semibold text-slate-700">
                Name
                <input required value={itemForm.name || ""} onChange={(event) => setItemForm((form) => ({ ...form, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>

              {itemModal.type === "tasks" ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Type
                      <input value={itemForm.type || ""} onChange={(event) => setItemForm((form) => ({ ...form, type: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Rate
                      <input type="number" min="0" step="0.01" value={itemForm.contractedRate || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, contractedRate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Minutes
                      <input type="number" min="0" value={itemForm.estimatedTime || "0"} onChange={(event) => setItemForm((form) => ({ ...form, estimatedTime: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={Boolean(itemForm.customerApproval)} onChange={(event) => setItemForm((form) => ({ ...form, customerApproval: event.target.checked }))} />
                    Customer approval required
                  </label>
                </>
              ) : itemModal.type === "plannedServiceStops" ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Stop type name
                      <input value={itemForm.serviceStopTypeName || ""} onChange={(event) => setItemForm((form) => ({ ...form, serviceStopTypeName: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Stop type ID
                      <input value={itemForm.serviceStopTypeId || ""} onChange={(event) => setItemForm((form) => ({ ...form, serviceStopTypeId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Minutes
                      <input type="number" min="0" value={itemForm.estimatedMinutes || "0"} onChange={(event) => setItemForm((form) => ({ ...form, estimatedMinutes: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Planned labor
                      <input type="number" min="0" step="0.01" value={itemForm.plannedLaborCost || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, plannedLaborCost: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  <label className="text-sm font-semibold text-slate-700">
                    Linked task template IDs
                    <input value={itemForm.taskTemplateIds || ""} onChange={(event) => setItemForm((form) => ({ ...form, taskTemplateIds: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Labor notes
                    <input value={itemForm.plannedLaborNotes || ""} onChange={(event) => setItemForm((form) => ({ ...form, plannedLaborNotes: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Subcategory
                      <input value={itemForm.subCategory || ""} onChange={(event) => setItemForm((form) => ({ ...form, subCategory: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Quantity
                      <input value={itemForm.quantity || "1"} onChange={(event) => setItemForm((form) => ({ ...form, quantity: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Unit cost
                      <input type="number" min="0" step="0.01" value={itemForm.plannedUnitCost || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, plannedUnitCost: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Unit price
                      <input type="number" min="0" step="0.01" value={itemForm.plannedUnitPrice || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, plannedUnitPrice: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      DB item ID
                      <input value={itemForm.dbItemId || ""} onChange={(event) => setItemForm((form) => ({ ...form, dbItemId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Generic item ID
                      <input value={itemForm.genericItemId || ""} onChange={(event) => setItemForm((form) => ({ ...form, genericItemId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={Boolean(itemForm.billable)} onChange={(event) => setItemForm((form) => ({ ...form, billable: event.target.checked }))} />
                    Billable
                  </label>
                </>
              )}

              <label className="text-sm font-semibold text-slate-700">
                Description
                <textarea rows={3} value={itemForm.description || ""} onChange={(event) => setItemForm((form) => ({ ...form, description: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Sort order
                <input type="number" value={itemForm.sortOrder || "0"} onChange={(event) => setItemForm((form) => ({ ...form, sortOrder: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closeItemModal} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={savingItem} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {savingItem ? "Saving" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {templateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={saveTemplate} className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{templateModal.mode === "create" ? "New Job Template" : "Edit Job Template"}</h2>
                <p className="mt-1 text-sm text-slate-500">Saved to companies/{recentlySelectedCompany}/jobTemplates.</p>
              </div>
              <button type="button" onClick={closeTemplateModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="text-sm font-semibold text-slate-700">
                Name
                <input
                  type="text"
                  required
                  value={templateForm.name}
                  onChange={(event) => setTemplateForm((form) => ({ ...form, name: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Description
                <textarea
                  rows={3}
                  value={templateForm.description}
                  onChange={(event) => setTemplateForm((form) => ({ ...form, description: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="text-sm font-semibold text-slate-700">
                  Job type
                  <input
                    type="text"
                    value={templateForm.jobType}
                    onChange={(event) => setTemplateForm((form) => ({ ...form, jobType: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Default price
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={templateForm.defaultRate}
                    onChange={(event) => setTemplateForm((form) => ({ ...form, defaultRate: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Default labor
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={templateForm.defaultLaborCost}
                    onChange={(event) => setTemplateForm((form) => ({ ...form, defaultLaborCost: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={templateForm.isActive}
                    onChange={(event) => setTemplateForm((form) => ({ ...form, isActive: event.target.checked }))}
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={templateForm.locked}
                    onChange={(event) => setTemplateForm((form) => ({ ...form, locked: event.target.checked }))}
                  />
                  Locked
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closeTemplateModal} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving" : "Save Template"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};

const Metric = ({ label, value }) => (
  <div className="rounded-lg bg-slate-50 p-3">
    <p className="text-lg font-bold text-slate-900">{value}</p>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
  </div>
);

export default JobTemplates;
