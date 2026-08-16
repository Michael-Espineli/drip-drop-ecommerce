import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { v4 as uuidv4 } from "uuid";
import { appConfirm } from "../../../utils/appDialog";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";

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
  technicianCanAdd: false,
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

const emptyLaborLineForm = () => ({
  name: "",
  description: "",
  quantity: "1",
  unitPrice: "0.00",
  totalPrice: "0.00",
  internalCost: "0.00",
  taskTemplateIds: "",
  plannedServiceStopTemplateIds: "",
  sortOrder: "0",
});

const sortByOrder = (items) =>
  [...items].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

const splitIdList = (value = "") => String(value || "")
  .split(",")
  .map((idValue) => idValue.trim())
  .filter(Boolean);

const normalizeIdList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((idValue) => String(idValue || "").trim())
      .filter(Boolean);
  }

  return splitIdList(value);
};

const detailTabLabel = (type) => ({
  overview: "Overview",
  tasks: "Task",
  plannedServiceStops: "Planned Stop",
  laborLineItems: "Service Line",
  shoppingItems: "Product",
}[type] || "Item");

const cents = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const quantityNumber = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 1;
};

const getLaborLineTaskIds = (line = {}) => (
  normalizeIdList(
    line.taskTemplateIds?.length
      ? line.taskTemplateIds
      : line.taskIds?.length
        ? line.taskIds
        : line.laborLineTaskIds || []
  )
);

const getLaborLinePlannedStopIds = (line = {}) => (
  normalizeIdList(
    line.plannedServiceStopTemplateIds?.length
      ? line.plannedServiceStopTemplateIds
      : line.plannedServiceStopIds?.length
        ? line.plannedServiceStopIds
        : line.laborLinePlannedServiceStopIds || []
  )
);

const laborLineTotalPriceCents = (line = {}) => {
  const quantity = quantityNumber(line.quantity || line.defaultQuantity || 1);
  const explicitTotal = line.totalPriceCents ?? line.totalAmountCents ?? line.amount ?? line.price;
  if (explicitTotal !== undefined && explicitTotal !== null && explicitTotal !== "") return cents(explicitTotal);
  return Math.round(cents(line.unitPriceCents ?? line.unitAmountCents ?? line.rateAmountCents ?? line.rate) * quantity);
};

const laborLineUnitPriceCents = (line = {}) => {
  const quantity = quantityNumber(line.quantity || line.defaultQuantity || 1);
  const explicitUnit = line.unitPriceCents ?? line.unitAmountCents ?? line.rateAmountCents;
  if (explicitUnit !== undefined && explicitUnit !== null && explicitUnit !== "") return cents(explicitUnit);
  return quantity ? Math.round(laborLineTotalPriceCents(line) / quantity) : laborLineTotalPriceCents(line);
};

const laborLineInternalCostCents = (line = {}) => cents(
  line.internalCostCents ??
  line.internalLaborCostCents ??
  line.laborCostCents ??
  line.unitCostCents ??
  line.cost
);

const plannedStopCostCents = (stop = {}) => cents(stop.plannedLaborCostCents ?? stop.cost);

const taskBillingPriceCents = (task = {}) => cents(
  task.billingLaborPriceCents ??
  task.customerLaborPriceCents ??
  task.billingLaborRateCents ??
  task.contractedRate
);

const taskInternalCostCents = (task = {}) => cents(task.contractedRate);

const productTotalCostCents = (item = {}) => {
  if (item.plannedTotalCostCents !== undefined && item.plannedTotalCostCents !== null) return cents(item.plannedTotalCostCents);
  return Math.round(cents(item.plannedUnitCostCents ?? item.cost) * quantityNumber(item.quantity));
};

const productTotalPriceCents = (item = {}) => {
  if (item.plannedTotalPriceCents !== undefined && item.plannedTotalPriceCents !== null) return cents(item.plannedTotalPriceCents);
  return Math.round(cents(item.plannedUnitPriceCents ?? item.price) * quantityNumber(item.quantity));
};

const countSubcollection = async (companyId, templateId, subcollectionName) => {
  const snapshot = await getDocs(
    collection(db, "companies", companyId, "jobTemplates", templateId, subcollectionName)
  );

  return snapshot.size;
};

const JobTemplates = () => {
  const navigate = useNavigate();
  const { recentlySelectedCompany, user } = useContext(Context);
  const { templateId: routeTemplateId } = useParams();
  const isDetailRoute = Boolean(routeTemplateId);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [templateModal, setTemplateModal] = useState(null);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [detailTemplate, setDetailTemplate] = useState(null);
  const [detailTab, setDetailTab] = useState("tasks");
  const [detailLoading, setDetailLoading] = useState(false);
  const [details, setDetails] = useState({ tasks: [], plannedServiceStops: [], laborLineItems: [], shoppingItems: [] });
  const [itemModal, setItemModal] = useState(null);
  const [itemForm, setItemForm] = useState({});
  const [savingItem, setSavingItem] = useState(false);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [defaultAdminId, setDefaultAdminId] = useState("");
  const [savingDefaultAdmin, setSavingDefaultAdmin] = useState(false);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setTemplates([]);
      setCompanyUsers([]);
      setDefaultAdminId("");
      setLoading(false);
      return;
    }

    const loadTemplates = async () => {
      setLoading(true);
      setError("");

      try {
        const [templatesSnap, companySnap, companyUsersSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "companies", recentlySelectedCompany, "jobTemplates"),
              orderBy("name", "asc")
            )
          ),
          getDoc(doc(db, "companies", recentlySelectedCompany)),
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
        ]);

        const companyData = companySnap.exists() ? companySnap.data() : {};
        setDefaultAdminId(companyData.defaultAdminId || "");
        setCompanyUsers(
          sortCompanyUsersByName(companyUsersSnap.docs
            .map((userDoc) => {
              const data = userDoc.data();
              return {
                ...data,
                id: data.id || userDoc.id,
                userId: data.userId || userDoc.id,
                userName: getCompanyUserDisplayName(data, "Unnamed User"),
                roleName: data.roleName || "",
              };
            })
            .filter((companyUser) => String(companyUser.status || "Active").toLowerCase() !== "inactive")
          )
        );

        const templatesWithCounts = await Promise.all(
          templatesSnap.docs.map(async (docSnap) => {
            const data = docSnap.data();
            const id = data.id || docSnap.id;

            const [taskCount, plannedStopCount, laborLineCount, shoppingItemCount] = await Promise.all([
              countSubcollection(recentlySelectedCompany, id, "tasks"),
              countSubcollection(recentlySelectedCompany, id, "plannedServiceStops"),
              countSubcollection(recentlySelectedCompany, id, "laborLineItems"),
              countSubcollection(recentlySelectedCompany, id, "shoppingItems"),
            ]);

            return {
              ...data,
              id,
              taskCount,
              plannedStopCount,
              laborLineCount,
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

  const selectedDefaultAdmin = useMemo(
    () => companyUsers.find((companyUser) => companyUser.userId === defaultAdminId || companyUser.id === defaultAdminId) || null,
    [companyUsers, defaultAdminId]
  );

  const taskById = useMemo(
    () => new Map(details.tasks.map((task) => [task.id, task])),
    [details.tasks]
  );

  const plannedStopById = useMemo(
    () => new Map(details.plannedServiceStops.map((stop) => [stop.id, stop])),
    [details.plannedServiceStops]
  );

  const servicePriceCents = useMemo(() => {
    if (details.laborLineItems.length) {
      return details.laborLineItems.reduce((total, line) => total + laborLineTotalPriceCents(line), 0);
    }

    return details.tasks.reduce((total, task) => total + taskBillingPriceCents(task), 0) +
      details.plannedServiceStops.reduce((total, stop) => total + plannedStopCostCents(stop), 0);
  }, [details.laborLineItems, details.plannedServiceStops, details.tasks]);

  const serviceCostCents = useMemo(() => {
    if (details.laborLineItems.length) {
      return details.laborLineItems.reduce((total, line) => total + laborLineInternalCostCents(line), 0);
    }

    return details.tasks.reduce((total, task) => total + taskInternalCostCents(task), 0) +
      details.plannedServiceStops.reduce((total, stop) => total + plannedStopCostCents(stop), 0);
  }, [details.laborLineItems, details.plannedServiceStops, details.tasks]);

  const productPriceCents = useMemo(
    () => details.shoppingItems.reduce((total, item) => total + productTotalPriceCents(item), 0),
    [details.shoppingItems]
  );

  const productCostCents = useMemo(
    () => details.shoppingItems.reduce((total, item) => total + productTotalCostCents(item), 0),
    [details.shoppingItems]
  );

  const calculatedPriceCents = servicePriceCents + productPriceCents;
  const templatePriceCents = calculatedPriceCents || cents(detailTemplate?.defaultRateCents || detailTemplate?.rate);
  const templateCostCents = serviceCostCents + productCostCents || cents(detailTemplate?.defaultLaborCostCents);
  const templateProfitCents = templatePriceCents - templateCostCents;

  const templateDetailSections = useMemo(() => ([
    { id: "overview", label: "Overview", helper: "Template summary and reusable plan", count: "Summary" },
    { id: "laborLineItems", label: "Service Lines", helper: "Billable services with linked work underneath", count: details.laborLineItems.length },
    { id: "shoppingItems", label: "Products", helper: "Products needed for purchasing and billing", count: details.shoppingItems.length },
    { id: "plannedServiceStops", label: "Planned Stops", helper: "Expected visits this template will create", count: details.plannedServiceStops.length },
    { id: "tasks", label: "Tasks", helper: "Technician work steps included in the template", count: details.tasks.length },
    { id: "actual", label: "Actual", helper: "Service stops, payroll, and purchased products live on created jobs", count: "Job only", disabled: true },
    { id: "billing", label: "Billing", helper: "Invoices, payments, and Stripe status start after job creation", count: "Job only", disabled: true },
    { id: "history", label: "History", helper: "Audit trail begins when this template becomes a job", count: "Job only", disabled: true },
  ]), [details.laborLineItems.length, details.plannedServiceStops.length, details.shoppingItems.length, details.tasks.length]);

  const saveDefaultAdmin = async () => {
    if (!recentlySelectedCompany) return;

    setSavingDefaultAdmin(true);
    setActionError("");
    setActionMessage("");

    try {
      await updateDoc(doc(db, "companies", recentlySelectedCompany), {
        defaultAdminId: selectedDefaultAdmin?.userId || "",
        defaultAdminName: selectedDefaultAdmin?.userName || "",
        updatedAt: new Date(),
      });
      setActionMessage("Default admin saved.");
    } catch (err) {
      console.error("Error saving default admin:", err);
      setActionError("Could not save default admin.");
    } finally {
      setSavingDefaultAdmin(false);
    }
  };

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
      technicianCanAdd: Boolean(template.technicianCanAdd),
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

  const loadTemplateDetails = useCallback(async (template) => {
    if (!recentlySelectedCompany || !template?.id) return;

    setDetailTemplate(template);
    setDetailTab("overview");
    setDetailLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const [tasksSnap, stopsSnap, laborLinesSnap, shoppingSnap] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, "tasks")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, "plannedServiceStops")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, "laborLineItems")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, "shoppingItems")),
      ]);

      setDetails({
        tasks: sortByOrder(tasksSnap.docs.map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))),
        plannedServiceStops: sortByOrder(stopsSnap.docs.map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))),
        laborLineItems: sortByOrder(laborLinesSnap.docs.map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))),
        shoppingItems: sortByOrder(shoppingSnap.docs.map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))),
      });
    } catch (err) {
      console.error("Error loading template details:", err);
      setActionError("Could not load template details.");
    } finally {
      setDetailLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!isDetailRoute || loading || !routeTemplateId || detailTemplate?.id === routeTemplateId) return;

    const matchedTemplate = templates.find((template) => template.id === routeTemplateId);
    if (matchedTemplate) {
      loadTemplateDetails(matchedTemplate);
    } else if (!loading && templates.length > 0) {
      setActionError("Could not find that job template.");
    }
  }, [detailTemplate?.id, isDetailRoute, loadTemplateDetails, loading, routeTemplateId, templates]);

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
    } else if (type === "laborLineItems") {
      const taskIds = item?.taskTemplateIds?.length ? item.taskTemplateIds : item?.taskIds || item?.laborLineTaskIds || [];
      const plannedStopIds = item?.plannedServiceStopTemplateIds?.length
        ? item.plannedServiceStopTemplateIds
        : item?.plannedServiceStopIds || item?.laborLinePlannedServiceStopIds || [];
      setItemForm(item ? {
        name: item.name || "",
        description: item.description || "",
        quantity: String(item.quantity || 1),
        unitPrice: dollarsFromCents(item.unitPriceCents || 0),
        totalPrice: dollarsFromCents(item.totalPriceCents || item.totalAmountCents || 0),
        internalCost: dollarsFromCents(item.internalCostCents || item.internalLaborCostCents || 0),
        taskTemplateIds: taskIds.join(", "),
        plannedServiceStopTemplateIds: plannedStopIds.join(", "),
        sortOrder: String(item.sortOrder || 0),
      } : emptyLaborLineForm());
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
      laborLineItems: "laborLineCount",
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

    if (type === "laborLineItems") {
      const quantity = Math.max(Number(itemForm.quantity || 1) || 1, 1);
      const enteredUnitPriceCents = itemForm.unitPrice !== undefined && itemForm.unitPrice !== ""
        ? centsFromMoney(itemForm.unitPrice)
        : 0;
      const enteredTotalPriceCents = centsFromMoney(itemForm.totalPrice);
      const totalPriceCents = enteredTotalPriceCents || Math.round(enteredUnitPriceCents * quantity);
      const unitPriceCents = enteredUnitPriceCents || Math.round(totalPriceCents / quantity);
      const taskTemplateIds = splitIdList(itemForm.taskTemplateIds);
      const plannedServiceStopTemplateIds = splitIdList(itemForm.plannedServiceStopTemplateIds);

      return {
        id,
        laborLineId: id,
        companyId: recentlySelectedCompany,
        templateId: detailTemplate.id,
        name: itemForm.name.trim(),
        description: itemForm.description.trim(),
        quantity,
        unitPriceCents,
        totalPriceCents,
        internalCostCents: centsFromMoney(itemForm.internalCost),
        taskTemplateIds,
        taskIds: taskTemplateIds,
        laborLineTaskIds: taskTemplateIds,
        plannedServiceStopTemplateIds,
        plannedServiceStopIds: plannedServiceStopTemplateIds,
        laborLinePlannedServiceStopIds: plannedServiceStopTemplateIds,
        salesItemType: "labor",
        billingBehavior: "oneTime",
        sourceType: "manual",
        sortOrder: Number(itemForm.sortOrder || 0),
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
        laborLineItems: "comp_job_template_labor_line_",
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
    const confirmed = await appConfirm({
      title: `Delete ${detailTabLabel(type)}`,
      message: `Delete "${item.name || detailTabLabel(type).toLowerCase()}" from this job template?`,
      confirmLabel: `Delete ${detailTabLabel(type)}`,
      variant: "danger",
    });
    if (!confirmed) return;

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

  const deleteTemplate = async (template) => {
    if (!recentlySelectedCompany || !template?.id || deletingTemplate) return;

    const confirmed = await appConfirm({
      title: "Delete Job Template",
      message: `Delete "${template.name || "this job template"}" and its tasks, planned stops, service lines, and products? Jobs already created from this template will not be deleted.`,
      confirmLabel: "Delete Template",
      variant: "danger",
    });
    if (!confirmed) return;

    setDeletingTemplate(true);
    setActionError("");
    setActionMessage("");

    try {
      const subcollectionNames = ["tasks", "plannedServiceStops", "laborLineItems", "shoppingItems"];

      for (const subcollectionName of subcollectionNames) {
        const snapshot = await getDocs(
          collection(db, "companies", recentlySelectedCompany, "jobTemplates", template.id, subcollectionName)
        );
        await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
      }

      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "jobTemplates", template.id));
      setTemplates((items) => items.filter((item) => item.id !== template.id));
      setTemplateModal(null);
      setTemplateForm(emptyTemplateForm());

      if (detailTemplate?.id === template.id) {
        setDetailTemplate(null);
        setDetails({ tasks: [], plannedServiceStops: [], laborLineItems: [], shoppingItems: [] });
        navigate("/company/settings/job-templates");
      }

      setActionMessage("Job template deleted.");
    } catch (err) {
      console.error("Error deleting job template:", err);
      setActionError("Could not delete job template.");
    } finally {
      setDeletingTemplate(false);
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
        technicianCanAdd: Boolean(templateForm.technicianCanAdd),
        updatedAt: now,
      };

      if (isCreate) {
        payload.createdAt = now;
        payload.createdByUserId = user?.uid || "";
        await setDoc(templateRef, payload);
        setTemplates((items) =>
          [...items, { ...payload, taskCount: 0, plannedStopCount: 0, laborLineCount: 0, shoppingItemCount: 0 }]
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        );
        setActionMessage("Job template created.");
      } else {
        await updateDoc(templateRef, payload);
        setTemplates((items) =>
          items.map((item) => (item.id === templateId ? { ...item, ...payload } : item))
        );
        setDetailTemplate((current) => (current?.id === templateId ? { ...current, ...payload } : current));
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

  const renderLinkedChips = (ids, itemMap, fallbackLabel) => {
    const linkedIds = normalizeIdList(ids);
    if (!linkedIds.length) return null;

    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {linkedIds.map((idValue) => {
          const linkedItem = itemMap.get(idValue);
          return (
            <span key={`${fallbackLabel}-${idValue}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {linkedItem?.name || `${fallbackLabel} ${String(idValue).slice(-6)}`}
            </span>
          );
        })}
      </div>
    );
  };

  const renderTemplateStatusPills = () => (
    <div className="mt-3 flex flex-wrap gap-2">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${detailTemplate?.isActive === false ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
        {detailTemplate?.isActive === false ? "Inactive" : "Active"}
      </span>
      {detailTemplate?.technicianCanAdd ? (
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Tech-enabled</span>
      ) : null}
      {detailTemplate?.locked ? (
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Locked</span>
      ) : null}
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
        {detailTemplate?.jobType || detailTemplate?.type || "General Job"}
      </span>
    </div>
  );

  const renderServiceInvoiceRows = () => {
    if (!details.laborLineItems.length) {
      return (
        <tr>
          <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
            <p className="font-medium text-slate-700">No service lines yet.</p>
            <p className="mt-1">
              Add a service line to price the work, then attach template tasks and planned stops underneath it.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => openItemModal("laborLineItems")}
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                Add Service Line
              </button>
              <button
                type="button"
                onClick={() => openItemModal("tasks")}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Add Task
              </button>
              <button
                type="button"
                onClick={() => openItemModal("plannedServiceStops")}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Add Planned Stop
              </button>
            </div>
          </td>
        </tr>
      );
    }

    return details.laborLineItems.map((line) => {
      const totalPriceCents = laborLineTotalPriceCents(line);
      const internalCostCents = laborLineInternalCostCents(line);
      const profitCents = totalPriceCents - internalCostCents;
      const taskIds = getLaborLineTaskIds(line);
      const plannedStopIds = getLaborLinePlannedStopIds(line);

      return (
        <tr key={line.id} className="align-top hover:bg-slate-50">
          <td className="px-4 py-3">
            <div className="font-semibold text-slate-900">{line.name || "Untitled service line"}</div>
            {line.description ? <p className="mt-1 text-xs text-slate-500">{line.description}</p> : null}
            {renderLinkedChips(taskIds, taskById, "Task")}
            {renderLinkedChips(plannedStopIds, plannedStopById, "Stop")}
          </td>
          <td className="px-4 py-3 text-right text-slate-700">{line.quantity || 1}</td>
          <td className="px-4 py-3 text-right text-slate-700">{moneyFromCents(laborLineUnitPriceCents(line))}</td>
          <td className="px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(totalPriceCents)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{moneyFromCents(internalCostCents)}</td>
          <td className={profitCents < 0 ? "px-4 py-3 text-right font-semibold text-rose-700" : "px-4 py-3 text-right font-semibold text-emerald-700"}>
            {moneyFromCents(profitCents)}
          </td>
          <td className="px-4 py-3">
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => openItemModal("laborLineItems", line)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => deleteTemplateItem("laborLineItems", line)}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      );
    });
  };

  const renderTemplateProductRows = () => {
    if (!details.shoppingItems.length) {
      return (
        <div className="rounded-md border border-dashed border-slate-300 p-4 text-center">
          <p className="text-sm font-medium text-slate-700">No planned products yet.</p>
          <p className="mt-0.5 text-xs text-slate-500">Add products to prepare purchasing and estimate customer billing.</p>
        </div>
      );
    }

    return details.shoppingItems.map((item) => {
      const totalPriceCents = productTotalPriceCents(item);
      const totalCostCents = productTotalCostCents(item);
      const profitCents = totalPriceCents - totalCostCents;

      return (
        <div key={item.id} className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-900">{item.name || "Untitled product"}</p>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {item.subCategory || "Product"}
              </span>
              {item.billable ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Billable</span>
              ) : null}
            </div>
            {item.description ? <p className="mt-1 text-xs text-slate-500">{item.description}</p> : null}
            <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
              <span>Qty {item.quantity || 1}</span>
              <span>Cost {moneyFromCents(totalCostCents)}</span>
              <span>Price {moneyFromCents(totalPriceCents)}</span>
              <span className={profitCents < 0 ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>
                Profit {moneyFromCents(profitCents)}
              </span>
            </div>
          </div>
          <div className="flex items-start justify-end gap-2">
            <button
              type="button"
              onClick={() => openItemModal("shoppingItems", item)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => deleteTemplateItem("shoppingItems", item)}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      );
    });
  };

  const renderTemplateOverview = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <TemplateStatCard
            title="Template Price"
            value={moneyFromCents(templatePriceCents)}
            subtitle={calculatedPriceCents ? "Services + products" : "Default price"}
            tone="blue"
          />
          <TemplateStatCard
            title="Services"
            value={moneyFromCents(servicePriceCents)}
            subtitle={`${details.laborLineItems.length} service line${details.laborLineItems.length === 1 ? "" : "s"}`}
          />
          <TemplateStatCard
            title="Products"
            value={moneyFromCents(productPriceCents)}
            subtitle={`${details.shoppingItems.length} product line${details.shoppingItems.length === 1 ? "" : "s"}`}
          />
          <TemplateStatCard
            title="Projected Cost"
            value={moneyFromCents(templateCostCents)}
            subtitle="Services + products"
          />
          <TemplateStatCard
            title="Projected Profit"
            value={moneyFromCents(templateProfitCents)}
            subtitle="Before real job changes"
            tone={templateProfitCents < 0 ? "rose" : "emerald"}
          />
          <TemplateStatCard
            title="Work Steps"
            value={details.tasks.length + details.plannedServiceStops.length}
            subtitle={`${details.tasks.length} tasks, ${details.plannedServiceStops.length} stops`}
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Template Brief</h3>
            <p className="mt-1 text-sm text-slate-600">
              {detailTemplate?.description || "Add a description that explains when this prebuilt job should be used."}
            </p>
          </div>
          {renderTemplateStatusPills()}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,auto)]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Template Plan Invoice</p>
            <h3 className="mt-1 text-2xl font-bold text-slate-950">{moneyFromCents(templatePriceCents)}</h3>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              {details.laborLineItems.length || details.shoppingItems.length
                ? `${details.laborLineItems.length} service line${details.laborLineItems.length === 1 ? "" : "s"} and ${details.shoppingItems.length} product line${details.shoppingItems.length === 1 ? "" : "s"}`
                : "No template invoice line items yet"}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:text-right">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Billed To</dt>
              <dd className="mt-1 flex justify-start lg:justify-end">
                <SkeletonLine width="w-28" />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Job</dt>
              <dd className="mt-1 flex justify-start lg:justify-end">
                <SkeletonLine width="w-32" />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Saved Plan</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">Template</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Profit</dt>
              <dd className={templateProfitCents < 0 ? "mt-0.5 font-bold text-rose-700" : "mt-0.5 font-bold text-emerald-700"}>
                {moneyFromCents(templateProfitCents)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4 p-4">
          <section className="overflow-hidden rounded-md border border-slate-200">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-950">Services</h4>
                <p className="mt-0.5 text-xs text-slate-500">Billable service price with tasks and planned stops underneath.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
                  Price {moneyFromCents(servicePriceCents)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
                  Cost {moneyFromCents(serviceCostCents)}
                </span>
                <button
                  type="button"
                  onClick={() => openItemModal("laborLineItems")}
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Service Line
                </button>
                <button
                  type="button"
                  onClick={() => openItemModal("tasks")}
                  className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Task
                </button>
                <button
                  type="button"
                  onClick={() => openItemModal("plannedServiceStops")}
                  className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Planned Stop
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-white">
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Item</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Unit Price</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Profit</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">{renderServiceInvoiceRows()}</tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-md border border-slate-200">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-950">Products</h4>
                <p className="mt-0.5 text-xs text-slate-500">Products needed for the job, purchase prep, and customer billing.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
                  Price {moneyFromCents(productPriceCents)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
                  Cost {moneyFromCents(productCostCents)}
                </span>
                <button
                  type="button"
                  onClick={() => openItemModal("shoppingItems")}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  Product Line
                </button>
              </div>
            </div>
            <div className="space-y-2 bg-white p-4">{renderTemplateProductRows()}</div>
          </section>
        </div>

        <div className="grid gap-3 border-t border-slate-300 bg-slate-950 px-4 py-4 text-white md:grid-cols-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Template Price</p>
            <p className="mt-1 text-xl font-bold">{moneyFromCents(templatePriceCents)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Planned Cost</p>
            <p className="mt-1 text-xl font-bold">{moneyFromCents(templateCostCents)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Projected Profit</p>
            <p className="mt-1 text-xl font-bold">{moneyFromCents(templateProfitCents)}</p>
          </div>
        </div>
      </div>

      <TemplateDisabledPanels />
    </div>
  );

  const renderTemplateChildSection = (type) => {
    const rows = details[type] || [];

    if (detailLoading) {
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
          Loading details...
        </div>
      );
    }

    if (!rows.length) {
      return (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-700">No {detailTabLabel(type).toLowerCase()} records yet.</p>
          <button
            type="button"
            onClick={() => openItemModal(type)}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Add {detailTabLabel(type)}
          </button>
        </div>
      );
    }

    return (
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[840px] w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Name</th>
                <th className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Template Details</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Billing</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Order</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((item) => {
                const taskIds = type === "plannedServiceStops" ? normalizeIdList(item.taskTemplateIds) : getLaborLineTaskIds(item);
                const stopIds = type === "laborLineItems" ? getLaborLinePlannedStopIds(item) : [];
                const billingSummary = type === "tasks"
                  ? moneyFromCents(taskBillingPriceCents(item))
                  : type === "plannedServiceStops"
                    ? moneyFromCents(plannedStopCostCents(item))
                    : type === "laborLineItems"
                      ? moneyFromCents(laborLineTotalPriceCents(item))
                      : moneyFromCents(productTotalPriceCents(item));

                return (
                  <tr key={item.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{item.name || "Untitled"}</p>
                      {item.description ? <p className="mt-1 text-xs text-slate-500">{item.description}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {type === "tasks" ? (
                        <span>{item.type || "Task"} - {item.estimatedTime || 0} min - {item.customerApproval ? "Approval required" : "No approval required"}</span>
                      ) : type === "plannedServiceStops" ? (
                        <>
                          <span>{item.serviceStopTypeName || "Stop"} - {item.estimatedMinutes || 0} min - {taskIds.length} task link(s)</span>
                          {renderLinkedChips(taskIds, taskById, "Task")}
                          {item.plannedLaborNotes ? <p className="mt-1 text-xs text-slate-500">{item.plannedLaborNotes}</p> : null}
                        </>
                      ) : type === "laborLineItems" ? (
                        <>
                          <span>{taskIds.length} task link(s) - {stopIds.length} planned stop link(s)</span>
                          {renderLinkedChips(taskIds, taskById, "Task")}
                          {renderLinkedChips(stopIds, plannedStopById, "Stop")}
                        </>
                      ) : (
                        <span>{item.subCategory || "Product"} - Qty {item.quantity || 1} - {item.billable ? "Billable" : "Internal"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{billingSummary}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{item.sortOrder || 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openItemModal(type, item)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTemplateItem(type, item)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTemplateDetailPage = () => {
    const selectedMeta = templateDetailSections.find((section) => section.id === detailTab) || templateDetailSections[0];

    if (detailLoading && !detailTemplate) {
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
          Loading job template...
        </div>
      );
    }

    return (
      <section className="grid gap-6 lg:grid-cols-[450px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
            <div className="mt-3 space-y-2">
              {templateDetailSections.map((sectionOption) => {
                const active = sectionOption.id === detailTab;
                const disabled = Boolean(sectionOption.disabled);
                return (
                  <button
                    key={sectionOption.id}
                    type="button"
                    onClick={() => {
                      if (!disabled) setDetailTab(sectionOption.id);
                    }}
                    disabled={disabled}
                    className={[
                      "w-full rounded-md border px-3 py-2 text-left transition",
                      disabled
                        ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                        : active
                        ? "border-blue-200 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{sectionOption.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${disabled ? "bg-slate-100 text-slate-400" : "bg-white text-slate-500"}`}>
                        {sectionOption.count}
                      </span>
                    </span>
                    <span className={`mt-1 block text-xs ${disabled ? "text-slate-400" : "text-slate-500"}`}>{sectionOption.helper}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Template Snapshot</h2>
            <dl className="mt-3 space-y-3">
              <SnapshotSkeletonRow label="Customer" width="w-44" />
              <SnapshotRow label="Default Admin" value={selectedDefaultAdmin?.userName || "Not set"} muted={!selectedDefaultAdmin} />
              <SnapshotSkeletonRow label="Site" width="w-52" />
              <SnapshotSkeletonRow label="Scheduled Date" width="w-32" />
              <SnapshotRow label="Job Type" value={detailTemplate?.jobType || detailTemplate?.type || "General Job"} />
              <SnapshotRow label="Template Price" value={moneyFromCents(templatePriceCents)} strong />
              <SnapshotRow
                label="Projected Profit"
                value={moneyFromCents(templateProfitCents)}
                strong
                tone={templateProfitCents < 0 ? "negative" : "positive"}
              />
            </dl>
          </div>

          <div className="pointer-events-none rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm opacity-80 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Comments</h2>
            <div className="mt-3 space-y-2">
              <SkeletonLine width="w-3/4" />
              <SkeletonLine width="w-11/12" />
              <SkeletonBlock height="h-14" />
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">{selectedMeta?.label || "Overview"}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    Template
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{selectedMeta?.helper}</p>
              </div>
              {detailTab !== "overview" ? (
                <button
                  type="button"
                  onClick={() => openItemModal(detailTab)}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Add {detailTabLabel(detailTab)}
                </button>
              ) : null}
            </div>
          </div>

          {detailTab === "overview" ? renderTemplateOverview() : renderTemplateChildSection(detailTab)}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link to={isDetailRoute ? "/company/settings/job-templates" : "/company/settings"} className="app-back-link">
                &larr; {isDetailRoute ? "Back to Job Templates" : "Back to Settings"}
              </Link>
              <p className="mt-4 text-xs font-bold uppercase tracking-wide text-blue-700">Prebuilt Jobs</p>
              <h1 className="mt-1 break-words text-3xl font-bold text-slate-950">
                {isDetailRoute ? detailTemplate?.name || "Job Template" : "Job Templates"}
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                {isDetailRoute
                  ? "Define the reusable tasks, planned stops, service lines, and products this prebuilt job should create."
                  : "Create and manage reusable prebuilt jobs for common work orders."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isDetailRoute && detailTemplate ? (
                <>
                  <button
                    type="button"
                    onClick={() => openEditModal(detailTemplate)}
                    disabled={deletingTemplate}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Edit Template
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTemplate(detailTemplate)}
                    disabled={deletingTemplate}
                    className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 shadow-sm transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingTemplate ? "Deleting..." : "Delete Template"}
                  </button>
                  <Link
                    to={`/company/jobs/basic-create?templateId=${encodeURIComponent(detailTemplate.id)}`}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Create Job
                  </Link>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
                  >
                    New Template
                  </button>
                  <Link
                    to="/company/jobs/basic-create"
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Create Job From Template
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        {!isDetailRoute && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase text-slate-500">Default Admin</h2>
              <p className="mt-1 text-sm text-slate-600">
                New iOS technician jobs will use this admin unless a manager changes it.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <select
                value={defaultAdminId}
                onChange={(event) => setDefaultAdminId(event.target.value)}
                className="min-w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">No default admin</option>
                {companyUsers.map((companyUser) => (
                  <option key={companyUser.id} value={companyUser.userId || companyUser.id}>
                    {companyUser.userName || "Unnamed User"}{companyUser.roleName ? ` (${companyUser.roleName})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveDefaultAdmin}
                disabled={savingDefaultAdmin}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingDefaultAdmin ? "Saving" : "Save Default"}
              </button>
            </div>
          </div>
        </section>
        )}

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

        {!isDetailRoute && !loading && !error && templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-slate-900">No job templates found.</h2>
            <p className="mt-2 text-slate-500">Create a prebuilt job template to speed up repeatable work.</p>
          </div>
        ) : null}

        {!isDetailRoute && !loading && !error && templates.length > 0 ? (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="space-y-4 border-b border-slate-200 p-5">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search templates by name, description, or job type"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <div className="text-sm text-slate-500">
                Showing {filteredTemplates.length} of {templates.length} job templates
              </div>
            </div>

            <div className="overflow-x-auto border-t border-slate-200">
              <table className="min-w-[1040px] w-full text-left">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Template</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Job Type</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Parts</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Default Price</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Service Cost</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredTemplates.map((template) => (
                    <tr key={template.id} className="transition hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link to={`/company/settings/job-templates/detail/${template.id}`} className="block hover:text-blue-700">
                          <span className="block text-sm font-semibold text-slate-900">{template.name || "Job Template"}</span>
                          <span className="mt-1 line-clamp-1 block text-xs text-slate-500">
                            {template.description || "Prebuilt job template"}
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">{template.jobType || template.type || "--"}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template.isActive === false ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                            {template.isActive === false ? "Inactive" : "Active"}
                          </span>
                          {template.technicianCanAdd ? (
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Tech-enabled</span>
                          ) : null}
                          {template.locked ? (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Locked</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        {template.taskCount || 0} tasks · {template.plannedStopCount || 0} stops · {template.laborLineCount || 0} services · {template.shoppingItemCount || 0} products
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-slate-900">
                        {moneyFromCents(template.defaultRateCents || template.rate || 0)}
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-slate-900">
                        {moneyFromCents(template.defaultLaborCostCents || 0)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Link
                            to={`/company/settings/job-templates/detail/${template.id}`}
                            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                          >
                            Details
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEditModal(template)}
                            disabled={deletingTemplate}
                            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTemplate(template)}
                            disabled={deletingTemplate}
                            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">
                        No templates match that search.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
      {isDetailRoute && detailTemplate ? renderTemplateDetailPage() : null}

      {itemModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form onSubmit={saveTemplateItem} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-900">
                {itemModal.mode === "create" ? "Add" : "Edit"} {detailTabLabel(itemModal.type)}
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
                      Planned service cost
                      <input type="number" min="0" step="0.01" value={itemForm.plannedLaborCost || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, plannedLaborCost: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  <label className="text-sm font-semibold text-slate-700">
                    Linked task template IDs
                    <input value={itemForm.taskTemplateIds || ""} onChange={(event) => setItemForm((form) => ({ ...form, taskTemplateIds: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Service notes
                    <input value={itemForm.plannedLaborNotes || ""} onChange={(event) => setItemForm((form) => ({ ...form, plannedLaborNotes: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                </>
              ) : itemModal.type === "laborLineItems" ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Quantity
                      <input type="number" min="1" step="1" value={itemForm.quantity || "1"} onChange={(event) => setItemForm((form) => ({ ...form, quantity: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Unit price
                      <input type="number" min="0" step="0.01" value={itemForm.unitPrice || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, unitPrice: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Total price
                      <input type="number" min="0" step="0.01" value={itemForm.totalPrice || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, totalPrice: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Internal cost
                      <input type="number" min="0" step="0.01" value={itemForm.internalCost || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, internalCost: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  <label className="text-sm font-semibold text-slate-700">
                    Linked task template IDs
                    <input value={itemForm.taskTemplateIds || ""} onChange={(event) => setItemForm((form) => ({ ...form, taskTemplateIds: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Linked planned stop template IDs
                    <input value={itemForm.plannedServiceStopTemplateIds || ""} onChange={(event) => setItemForm((form) => ({ ...form, plannedServiceStopTemplateIds: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
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
                      Database product ID
                      <input value={itemForm.dbItemId || ""} onChange={(event) => setItemForm((form) => ({ ...form, dbItemId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Generic product ID
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
                <p className="mt-1 text-sm text-slate-500">Save the reusable setup for a prebuilt job.</p>
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
                  Default service cost
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
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={templateForm.technicianCanAdd}
                    onChange={(event) => setTemplateForm((form) => ({ ...form, technicianCanAdd: event.target.checked }))}
                  />
                  Technicians Can Add
                </label>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {templateModal.mode === "edit" ? (
                  <button
                    type="button"
                    onClick={() => deleteTemplate(templateModal.template)}
                    disabled={saving || deletingTemplate}
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingTemplate ? "Deleting..." : "Delete Template"}
                  </button>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeTemplateModal} disabled={saving || deletingTemplate} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || deletingTemplate}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving" : "Save Template"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};

const statToneClasses = {
  default: "border-slate-200 bg-slate-50 text-slate-900",
  blue: "border-blue-200 bg-blue-50 text-blue-900",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  rose: "border-rose-200 bg-rose-50 text-rose-900",
};

const TemplateStatCard = ({ title, value, subtitle, tone = "default" }) => (
  <div className={`rounded-md border px-3 py-2 ${statToneClasses[tone] || statToneClasses.default}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{title}</p>
    <p className="mt-1 text-lg font-bold">{value}</p>
    {subtitle ? <p className="mt-0.5 text-xs opacity-80">{subtitle}</p> : null}
  </div>
);

const SnapshotRow = ({ label, value, muted = false, strong = false, tone = "default" }) => {
  const valueClass = [
    "mt-1",
    strong ? "text-lg font-bold" : "font-semibold",
    muted ? "text-slate-500" : "text-slate-900",
    tone === "positive" ? "text-emerald-700" : "",
    tone === "negative" ? "text-rose-700" : "",
  ].filter(Boolean).join(" ");

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  );
};

const SkeletonLine = ({ width = "w-full" }) => (
  <span className={`block h-3 rounded bg-slate-200 ${width}`} aria-hidden="true" />
);

const SkeletonBlock = ({ height = "h-20" }) => (
  <div className={`rounded-md bg-slate-200 ${height}`} aria-hidden="true" />
);

const SnapshotSkeletonRow = ({ label, width = "w-40" }) => (
  <div className="pointer-events-none">
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="mt-2">
      <SkeletonLine width={width} />
    </dd>
  </div>
);

const TemplateDisabledPanels = () => (
  <div className="grid gap-3 md:grid-cols-3">
    {[
      { title: "Actual", rows: ["w-2/3", "w-11/12", "w-1/2"] },
      { title: "Billing", rows: ["w-1/2", "w-4/5", "w-2/3"] },
      { title: "History", rows: ["w-3/4", "w-full", "w-1/2"] },
    ].map((panel) => (
      <div key={panel.title} className="pointer-events-none rounded-lg border border-slate-200 bg-slate-50 p-4 opacity-80 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">{panel.title}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-400">Job only</span>
        </div>
        <div className="mt-4 space-y-3">
          {panel.rows.map((width, index) => (
            <SkeletonLine key={`${panel.title}-${width}-${index}`} width={width} />
          ))}
          <SkeletonBlock height="h-16" />
        </div>
      </div>
    ))}
  </div>
);

export default JobTemplates;
