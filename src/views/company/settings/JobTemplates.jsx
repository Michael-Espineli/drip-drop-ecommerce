import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import "./JobTemplateTheme.css";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { DocumentDuplicateIcon, EllipsisVerticalIcon, ChevronDownIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";
import { isActiveJobTemplate } from "../../../utils/jobTemplateAvailability";
import JobTemplateDialog from "./JobTemplateDialog";
import { emptyJobTemplateScope, prepareJobTemplateScope } from "../../../utils/jobTemplateDraft";
import { getJobMaterialVendorItemId, loadJobProductCatalog, buildJobProductCatalog, buildProductFromVendorItem, buildVendorItemProductPatch, productCatalogDocRef } from "../../../utils/productCatalog";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import ServicePayrollTaskEditor from "../sales/ServicePayrollTaskEditor";
import ServicePayrollCostEditor from "../sales/ServicePayrollCostEditor";
import ServicePayTypeField from "../sales/ServicePayTypeField";
import useServicePayrollData from "../../../hooks/useServicePayrollData";
import { serializeServiceTasks } from "../../../utils/payroll/servicePayrollPreview";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { v4 as uuidv4 } from "uuid";
import { appConfirm } from "../../../utils/appDialog";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";
import {
  SalesCatalogBillingBehavior,
  SalesCatalogItem,
  SalesCatalogItemType,
  SalesCatalogSourceType,
} from "../../../utils/models/Sales";
import { salesCatalogCollection, saveSalesCatalogItem } from "../../../utils/sales/salesFirestore";
import {
  CATEGORY_OPTIONS,
  DEFAULT_CATEGORY,
  DEFAULT_SUBCATEGORY,
  DEFAULT_UOM,
  SUBCATEGORY_OPTIONS,
  UOM_OPTIONS,
} from "../databaseItems/databaseItemOptions";
import { JOB_TASK_TYPE_NAMES, canonicalJobTaskType } from "../../../utils/jobTaskTypes";
import { jobPayFields } from "../../../utils/payroll/payCalculation";
import JobPayrollFields from "../jobs/JobPayrollFields";
import {
  DEFAULT_ISSUE_PRIORITY,
  getIssuePriorityLabel,
  normalizeIssuePriority,
} from "../../../utils/models/JobPlan";

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
  defaultIssuePriorityLevel: DEFAULT_ISSUE_PRIORITY,
  defaultRate: "0.00",
  defaultLaborCost: "0.00",
  isActive: true,
  locked: false,
  technicianCanAdd: false,
});

const emptyTaskForm = () => ({
  ...jobPayFields({ payrollMode: "included" }),
  name: "",
  type: "Basic",
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
  taskTemplateIds: [],
  plannedLaborCost: "0.00",
  plannedLaborNotes: "",
});

const emptyShoppingForm = () => ({
  name: "",
  subCategory: "Misc",
  description: "",
  quantity: "1",
  dbItemId: "",
  dbItemName: "",
  genericItemId: "",
  plannedUnitCost: "0.00",
  plannedUnitPrice: "0.00",
  billable: false,
  sortOrder: "0",
});

const emptyLaborLineForm = () => ({
  payTypeId: "",
  selectedSalesCatalogItemId: "",
  name: "",
  description: "",
  quantity: "1",
  unitPrice: "0.00",
  totalPrice: "0.00",
  internalCost: "0.00",
  taskTemplateIds: [],
  sortOrder: "0",
});

const emptyServiceCatalogForm = () => ({
  payTypeId: "",
  taskTemplates: [],
  name: "",
  description: "",
  type: SalesCatalogItemType.service,
  billingBehavior: SalesCatalogBillingBehavior.oneTime,
  unitAmount: "0.00",
  unitCost: "0.00",
  defaultQuantity: "1",
  taxable: false,
});

const emptyDatabaseProductForm = () => ({
  name: "",
  description: "",
  sku: "",
  category: DEFAULT_CATEGORY?.label || "Misc",
  subCategory: DEFAULT_SUBCATEGORY?.label || "Misc",
  uom: DEFAULT_UOM?.label || "Unit",
  unitCost: "0.00",
  unitPrice: "0.00",
  billable: false,
  size: "",
  tracking: "",
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

const uniqueIdList = (value) => Array.from(new Set(normalizeIdList(value)));

const optionLabel = (option) => option?.label || option?.name || option?.value || "";

const labelize = (value) => {
  if (!value) return "Unknown";
  return String(value)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const templateDefaultPriorityLevel = (template = {}) => normalizeIssuePriority(
  template.defaultIssuePriorityLevel ??
  template.issuePriorityLevel ??
  template.priorityLevel ??
  template.solutionTier ??
  DEFAULT_ISSUE_PRIORITY
);

const templateDefaultPriorityDisplay = (template = {}) => {
  const priorityLevel = templateDefaultPriorityLevel(template);
  return `${priorityLevel} - ${getIssuePriorityLabel(priorityLevel)}`;
};

const catalogTypeLabel = (value) => ({
  [SalesCatalogItemType.service]: "Service",
  [SalesCatalogItemType.recurringService]: "Recurring Service",
  [SalesCatalogItemType.labor]: "Service Labor",
  [SalesCatalogItemType.manual]: "Custom Service",
  [SalesCatalogItemType.fee]: "Fee",
  [SalesCatalogItemType.discount]: "Discount",
  [SalesCatalogItemType.tax]: "Tax",
}[value] || labelize(value));

const TEMPLATE_SERVICE_CATALOG_TYPES = new Set([
  SalesCatalogItemType.service,
  SalesCatalogItemType.recurringService,
  SalesCatalogItemType.labor,
  SalesCatalogItemType.manual,
]);

const isTemplateServiceCatalogItem = (item = {}) => (
  item.active !== false && TEMPLATE_SERVICE_CATALOG_TYPES.has(item.type || SalesCatalogItemType.service)
);

const catalogServiceTaskTemplates = (item = {}) => {
  const templates =
    item.metadata?.taskTemplates ||
    item.metadata?.tasks ||
    item.taskTemplates ||
    [];

  return Array.isArray(templates) ? templates.filter(Boolean) : [];
};

const catalogNumber = (...values) => {
  const found = values.find((value) => value !== undefined && value !== null && value !== "");
  const parsed = Number(found || 0);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
};

const catalogCents = (...values) => Math.round(catalogNumber(...values));

const catalogTaskMinutes = (template = {}) => catalogNumber(
  template.estimatedMinutes,
  template.estimatedTime,
  template.minutes,
  template.durationMinutes,
  template.duration
);

const catalogTaskType = (template = {}) => (
  canonicalJobTaskType(
    template.type ||
    template.taskType ||
    template.taskTypeName ||
    "Basic"
  )
);

// Catalog tasks are per service unit. Use the same scope for the unsaved preview and saved tasks.
const catalogTasksForLaborLine = (catalogItem, payTypeId, quantity) => (
  (catalogServiceTaskTemplates(catalogItem).length ? catalogServiceTaskTemplates(catalogItem) : [{ name: serviceCatalogItemLabel(catalogItem), type: "Basic", payrollMode: "included" }])
    .map((template, index) => {
      const pay = jobPayFields(template, { payTypeId });
      return {
        ...pay,
        id: template.id || template.templateId || `catalog-task-${index}`,
        name: String(template.name || template.title || template.description || `Task ${index + 1}`).trim(),
        type: catalogTaskType(template),
        description: template.description || "",
        contractedRate: catalogCents(template.laborCostCents, template.contractRateCents, template.contractedRateCents, template.contractedRate, template.costCents),
        billingLaborPriceCents: catalogCents(template.billingLaborPriceCents, template.unitAmountCents, template.priceCents, template.rateCents),
        estimatedTime: catalogTaskMinutes(template) * quantity,
        payQuantity: pay.payQuantity * quantity,
        manualPayOverrideCents: pay.manualPayOverrideCents === null ? null : Math.round(pay.manualPayOverrideCents * quantity),
        customerApproval: Boolean(template.customerApproval || template.customerApprovalRequired),
        genericItemId: template.genericItemId || "",
        dataBaseItemId: template.dataBaseItemId || "",
        productQuantity: Number(template.productQuantity || 1),
      };
    }).filter((task) => task.name)
);

const serviceCatalogItemLabel = (item = {}) => (
  item.name ||
  item.title ||
  item.description ||
  item.id ||
  "Service"
);

const databaseProductLabel = (item = {}) => (
  item.name ||
  item.label ||
  item.title ||
  item.sku ||
  item.id ||
  "Database product"
);

const databaseProductCostCents = (item = {}) => cents(
  item.rate ??
  item.unitCostCents ??
  item.cost ??
  item.unitCost ??
  0
);

const databaseProductPriceCents = (item = {}) => cents(
  item.sellPrice ??
  item.billingRate ??
  item.unitAmountCents ??
  item.price ??
  item.rate ??
  0
);

const searchMatches = (item = {}, term = "", fields = []) => {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return true;

  return fields
    .map((field) => item[field])
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedTerm));
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
  const [detailTab, setDetailTab] = useState("overview");
  const [detailLoading, setDetailLoading] = useState(false);
  const [details, setDetails] = useState({ tasks: [], plannedServiceStops: [], laborLineItems: [], shoppingItems: [] });
  const [itemModal, setItemModal] = useState(null);
  const [itemForm, setItemForm] = useState({});
  const servicePayrollData = useServicePayrollData(recentlySelectedCompany, itemModal?.type === "laborLineItems");
  const [savingItem, setSavingItem] = useState(false);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [defaultAdminId, setDefaultAdminId] = useState("");
  const [savingDefaultAdmin, setSavingDefaultAdmin] = useState(false);
  const [serviceCatalogItems, setServiceCatalogItems] = useState([]);
  const [payTypes, setPayTypes] = useState([]);
  const [loadingServiceCatalogItems, setLoadingServiceCatalogItems] = useState(false);
  const [serviceCatalogSearch, setServiceCatalogSearch] = useState("");
  const [serviceCatalogPickerOpen, setServiceCatalogPickerOpen] = useState(false);
  const [showServiceCatalogCreator, setShowServiceCatalogCreator] = useState(false);
  const [serviceCatalogForm, setServiceCatalogForm] = useState(emptyServiceCatalogForm);
  const [creatingServiceCatalogItem, setCreatingServiceCatalogItem] = useState(false);
  const [databaseProducts, setDatabaseProducts] = useState([]);
  const [loadingDatabaseProducts, setLoadingDatabaseProducts] = useState(false);
  const [databaseProductSearch, setDatabaseProductSearch] = useState("");
  const [databaseProductPickerOpen, setDatabaseProductPickerOpen] = useState(false);
  const [showDatabaseProductCreator, setShowDatabaseProductCreator] = useState(false);
  const [databaseProductForm, setDatabaseProductForm] = useState(emptyDatabaseProductForm);
  const [creatingDatabaseProduct, setCreatingDatabaseProduct] = useState(false);

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
        setError(userFacingErrorMessage(err, "Could not load job templates."));
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
	  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setServiceCatalogItems([]);
      setDatabaseProducts([]);
      setLoadingServiceCatalogItems(false);
      setLoadingDatabaseProducts(false);
      return;
    }

    let cancelled = false;

    const loadTemplatePickers = async () => {
      setLoadingServiceCatalogItems(true);
      setLoadingDatabaseProducts(true);

      try {
        const [catalogSnap, productsSnap, payTypesSnap] = await Promise.all([
          getDocs(salesCatalogCollection(db, recentlySelectedCompany)),
          loadJobProductCatalog(db, recentlySelectedCompany),
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyPayTypes")),
        ]);

        if (cancelled) return;
        setPayTypes(payTypesSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })));

        setServiceCatalogItems(
          catalogSnap.docs
            .map((docSnap) => ({ id: docSnap.data().id || docSnap.id, ...docSnap.data() }))
            .filter(isTemplateServiceCatalogItem)
            .sort((left, right) => serviceCatalogItemLabel(left).localeCompare(serviceCatalogItemLabel(right)))
        );
        setDatabaseProducts(
          productsSnap.products
            .filter((item) => item.active !== false && item.archived !== true)
            .sort((left, right) => databaseProductLabel(left).localeCompare(databaseProductLabel(right)))
        );
      } catch (err) {
        console.error("Error loading template picker catalogs:", err);
        if (!cancelled) setActionError(userFacingErrorMessage(err, "Could not load service and product pickers."));
      } finally {
        if (!cancelled) {
          setLoadingServiceCatalogItems(false);
          setLoadingDatabaseProducts(false);
        }
      }
    };

    loadTemplatePickers();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return templates;

    return templates.filter((template) =>
      [
        template.id,
        template.name,
        template.description,
        templateDefaultPriorityDisplay(template),
        template.defaultIssuePriorityLabel,
        template.issuePriorityLabel,
        template.priorityLabel,
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

  const serviceCatalogItemById = useMemo(
    () => new Map(serviceCatalogItems.map((item) => [item.id, item])),
    [serviceCatalogItems]
  );

  const databaseProductById = useMemo(
    () => new Map(databaseProducts.map((item) => [item.id, item])),
    [databaseProducts]
  );

  const filteredServiceCatalogItems = useMemo(
    () => serviceCatalogItems.filter((item) => searchMatches(
      item,
      serviceCatalogSearch,
      ["id", "name", "description", "type", "sourceType", "sourceId"]
    )),
    [serviceCatalogItems, serviceCatalogSearch]
  );

  const filteredDatabaseProducts = useMemo(
    () => databaseProducts.filter((item) => searchMatches(
      item,
      databaseProductSearch,
      ["id", "name", "description", "sku", "category", "subCategory", "UOM"]
    )),
    [databaseProductSearch, databaseProducts]
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
    { id: "overview", label: "Overview", helper: "Template summary and reusable plan", count: "1" },
    { id: "create-plans", label: "Create Plans", helper: "Create estimates based on services and products", count: String(details.laborLineItems.length + details.shoppingItems.length + details.plannedServiceStops.length + details.tasks.length) },
    { id: "actual", label: "Actual", helper: "Service stops, payroll, and purchased products live on created jobs", count: "Job only", disabled: true },
    { id: "billing", label: "Billing", helper: "Invoices, payments, and Stripe status start after job creation", count: "Job only", disabled: true },
    { id: "history", label: "History", helper: "Audit trail begins when this template becomes a job", count: "Job only", disabled: true },
  ]), [details.laborLineItems.length, details.plannedServiceStops.length, details.shoppingItems.length, details.tasks.length]);

  const templatePlanSections = [
    { id: "laborLineItems", label: "Service Lines", helper: "Billing services with linked template tasks", region: "Template service lines" },
    { id: "shoppingItems", label: "Products", helper: "Products needed for purchasing and billing", region: "Template products" },
    { id: "plannedServiceStops", label: "Planned Stops", helper: "Operations visits with assigned template tasks", region: "Template planned stops" },
    { id: "tasks", label: "Tasks", helper: "Technician work steps included in the template", region: "Template tasks" },
  ];

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
      setActionError(userFacingErrorMessage(err, "Could not save default admin."));
    } finally {
      setSavingDefaultAdmin(false);
    }
  };

  const openCreateModal = () => {
    setTemplateForm(emptyTemplateForm());
    setTemplateModal({ mode: "create", template: null, id: `comp_job_template_${uuidv4()}` });
    setActionError("");
    setActionMessage("");
  };

  const openEditModal = (template) => {
    setTemplateForm({
      name: template.name || "",
      description: template.description || "",
      defaultIssuePriorityLevel: templateDefaultPriorityLevel(template),
      defaultRate: dollarsFromCents(template.defaultRateCents || template.rate || 0),
      defaultLaborCost: dollarsFromCents(template.defaultLaborCostCents || 0),
      isActive: isActiveJobTemplate(template),
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
      setActionError(userFacingErrorMessage(err, "Could not load template details."));
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
        ...jobPayFields(item),
        name: item.name || "",
        type: canonicalJobTaskType(item.type || "Basic"),
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
        ...jobPayFields(item, { payTypeId: item.serviceStopTypeId }),
        billingLaborPriceCents: item.billingLaborPriceCents ?? item.plannedLaborCostCents ?? 0,
        serviceStopTypeName: item.serviceStopTypeName || "",
        serviceStopTypeImage: item.serviceStopTypeImage || "",
        serviceStopTypeUseCaseRawValue: item.serviceStopTypeUseCaseRawValue || "",
	        estimatedMinutes: String(item.estimatedMinutes || 0),
	        sortOrder: String(item.sortOrder || 0),
	        taskTemplateIds: uniqueIdList(item.taskTemplateIds || item.taskIds || []),
	        plannedLaborCost: dollarsFromCents(item.plannedLaborCostCents || 0),
	        plannedLaborNotes: item.plannedLaborNotes || "",
	      } : emptyStopForm());
	    } else if (type === "laborLineItems") {
	      const taskIds = item?.taskTemplateIds?.length ? item.taskTemplateIds : item?.taskIds || item?.laborLineTaskIds || [];
	      setItemForm(item ? {
	        selectedSalesCatalogItemId: item.catalogItemId || item.salesCatalogItemId || "",
            payTypeId: jobPayFields(item).payTypeId,
	        name: item.name || "",
	        description: item.description || "",
	        quantity: String(item.quantity || 1),
	        unitPrice: dollarsFromCents(item.unitPriceCents || 0),
	        totalPrice: dollarsFromCents(item.totalPriceCents || item.totalAmountCents || 0),
	        internalCost: dollarsFromCents(item.internalCostCents || item.internalLaborCostCents || 0),
	        taskTemplateIds: uniqueIdList(taskIds),
	        sortOrder: String(item.sortOrder || 0),
	      } : emptyLaborLineForm());
	    } else {
	      setItemForm(item ? {
	        name: item.name || "",
	        subCategory: item.subCategory || "Misc",
	        description: item.description || "",
	        quantity: item.quantity || "1",
          dbItemId: item.genericItemId || item.dbItemId || item.dataBaseItemId || item.itemId || "",
	        dbItemName: item.dbItemName || item.dataBaseItemName || "",
	        genericItemId: item.genericItemId || "",
	        plannedUnitCost: dollarsFromCents(item.plannedUnitCostCents || 0),
	        plannedUnitPrice: dollarsFromCents(item.plannedUnitPriceCents || 0),
	        billable: Boolean(item.billable),
	        sortOrder: String(item.sortOrder || 0),
	      } : emptyShoppingForm());
	    }

	    setServiceCatalogSearch("");
	    setServiceCatalogPickerOpen(false);
	    setDatabaseProductSearch("");
	    setDatabaseProductPickerOpen(false);
	    setShowServiceCatalogCreator(false);
	    setShowDatabaseProductCreator(false);
	    setServiceCatalogForm(emptyServiceCatalogForm());
	    setDatabaseProductForm(emptyDatabaseProductForm());
	    setItemModal({ type, mode: item ? "edit" : "create", item });
	  };

  const closeItemModal = () => {
    if (savingItem) return;
    setItemModal(null);
    setItemForm({});
    setServiceCatalogPickerOpen(false);
    setDatabaseProductPickerOpen(false);
    setShowServiceCatalogCreator(false);
    setShowDatabaseProductCreator(false);
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

  const toggleItemFormId = (field, id) => {
    setItemForm((form) => {
      const values = new Set(uniqueIdList(form[field]));
      if (values.has(id)) {
        values.delete(id);
      } else {
        values.add(id);
      }

      return { ...form, [field]: Array.from(values) };
    });
  };

  const updateServiceCatalogForm = (field, value) => {
    setServiceCatalogForm((form) => ({ ...form, [field]: value }));
  };

  const updateDatabaseProductForm = (field, value) => {
    setDatabaseProductForm((form) => ({ ...form, [field]: value }));
  };

  const applyServiceCatalogItemToForm = (catalogItemId, catalogItemOverride = null) => {
    const catalogItem = catalogItemOverride || serviceCatalogItemById.get(catalogItemId);

    setItemForm((form) => {
      if (!catalogItem) {
        return { ...form, selectedSalesCatalogItemId: catalogItemId };
      }

      const quantity = Math.max(Number(catalogItem.defaultQuantity || form.quantity || 1) || 1, 1);
      const unitPriceCents = cents(catalogItem.unitAmountCents);
      const totalPriceCents = Math.round(unitPriceCents * quantity);

      return {
        ...form,
        selectedSalesCatalogItemId: catalogItem.id,
        payTypeId: jobPayFields(catalogItem).payTypeId,
        name: catalogItem.name || form.name || "",
        description: catalogItem.description || form.description || "",
        quantity: String(quantity),
        unitPrice: dollarsFromCents(unitPriceCents),
        totalPrice: dollarsFromCents(totalPriceCents),
        internalCost: dollarsFromCents(Math.round(cents(catalogItem.unitCostCents) * quantity)),
      };
    });
  };

  const applyDatabaseProductToForm = (productId, productOverride = null) => {
    const product = productOverride || databaseProductById.get(productId);

    setItemForm((form) => {
      if (!product) {
        return { ...form, dbItemId: productId, genericItemId: "" };
      }

      return {
        ...form,
        dbItemId: product.id,
        dbItemName: databaseProductLabel(product),
        genericItemId: product.genericItemId || "",
        name: databaseProductLabel(product),
        subCategory: product.subCategory || product.category || form.subCategory || "Misc",
        description: product.description || form.description || "",
        plannedUnitCost: dollarsFromCents(databaseProductCostCents(product)),
        plannedUnitPrice: dollarsFromCents(databaseProductPriceCents(product)),
        billable: Boolean(product.billable || databaseProductPriceCents(product)),
      };
    });
  };

  const startServiceCatalogCreator = () => {
    setServiceCatalogForm({
      ...emptyServiceCatalogForm(),
      name: itemForm.name || "",
      description: itemForm.description || "",
      payTypeId: itemForm.payTypeId || "",
      unitAmount: itemForm.unitPrice || "0.00",
      unitCost: dollarsFromCents(centsFromMoney(itemForm.internalCost) / Math.max(Number(itemForm.quantity || 1), 1)),
      defaultQuantity: itemForm.quantity || "1",
    });
    setShowServiceCatalogCreator(true);
  };

  const startDatabaseProductCreator = () => {
    setDatabaseProductForm({
      ...emptyDatabaseProductForm(),
      name: itemForm.name || "",
      description: itemForm.description || "",
      subCategory: itemForm.subCategory || DEFAULT_SUBCATEGORY?.label || "Misc",
      unitCost: itemForm.plannedUnitCost || "0.00",
      unitPrice: itemForm.plannedUnitPrice || "0.00",
      billable: Boolean(itemForm.billable),
    });
    setShowDatabaseProductCreator(true);
  };

  const createServiceCatalogItemInline = async () => {
    if (!recentlySelectedCompany || creatingServiceCatalogItem) return;

    const name = serviceCatalogForm.name.trim();
    if (!name) {
      setActionError("Add a sales catalog item name.");
      return;
    }

    setCreatingServiceCatalogItem(true);
    setActionError("");
    setActionMessage("");

    try {
      const catalogItem = new SalesCatalogItem({
        companyId: recentlySelectedCompany,
        name,
        description: serviceCatalogForm.description.trim(),
        type: serviceCatalogForm.type || SalesCatalogItemType.service,
        billingBehavior: serviceCatalogForm.billingBehavior || SalesCatalogBillingBehavior.oneTime,
        sourceType: serviceCatalogForm.payTypeId ? SalesCatalogSourceType.serviceStopType : SalesCatalogSourceType.manual,
        sourceId: serviceCatalogForm.payTypeId || "",
        payTypeId: serviceCatalogForm.payTypeId || "",
        payTypeName: payTypes.find((type) => type.id === serviceCatalogForm.payTypeId)?.name || "",
        unitAmountCents: centsFromMoney(serviceCatalogForm.unitAmount),
        unitCostCents: centsFromMoney(serviceCatalogForm.unitCost),
        defaultQuantity: Math.max(Number(serviceCatalogForm.defaultQuantity || 1) || 1, 1),
        taxable: Boolean(serviceCatalogForm.taxable),
        active: true,
        currency: "usd",
        metadata: { taskTemplates: serializeServiceTasks(serviceCatalogForm.taskTemplates) },
      });

      await saveSalesCatalogItem(db, recentlySelectedCompany, catalogItem);
      setServiceCatalogItems((items) => (
        [...items.filter((item) => item.id !== catalogItem.id), catalogItem]
          .sort((left, right) => serviceCatalogItemLabel(left).localeCompare(serviceCatalogItemLabel(right)))
      ));
      applyServiceCatalogItemToForm(catalogItem.id, catalogItem);
      setServiceCatalogPickerOpen(false);
      setShowServiceCatalogCreator(false);
      setServiceCatalogForm(emptyServiceCatalogForm());
      setActionMessage("Sales catalog item created and selected.");
    } catch (err) {
      console.error("Error creating sales catalog item from job template:", err);
      setActionError(userFacingErrorMessage(err, "Could not create sales catalog item."));
    } finally {
      setCreatingServiceCatalogItem(false);
    }
  };

  const createDatabaseProductInline = async () => {
    if (!recentlySelectedCompany || creatingDatabaseProduct) return;

    const name = databaseProductForm.name.trim();
    if (!name) {
      setActionError("Add a product name.");
      return;
    }

    setCreatingDatabaseProduct(true);
    setActionError("");
    setActionMessage("");

    try {
      const productId = `com_sett_db_${uuidv4()}`;
      const sellPriceCents = databaseProductForm.billable
        ? centsFromMoney(databaseProductForm.unitPrice)
        : 0;
      const product = {
        id: productId,
        name,
        description: databaseProductForm.description.trim(),
        sku: databaseProductForm.sku.trim(),
        category: databaseProductForm.category || DEFAULT_CATEGORY?.label || "Misc",
        subCategory: databaseProductForm.subCategory || DEFAULT_SUBCATEGORY?.label || "Misc",
        UOM: databaseProductForm.uom || DEFAULT_UOM?.label || "Unit",
        rate: centsFromMoney(databaseProductForm.unitCost),
        sellPrice: sellPriceCents,
        billingRate: sellPriceCents,
        billable: Boolean(databaseProductForm.billable),
        size: databaseProductForm.size.trim(),
        tracking: databaseProductForm.tracking.trim(),
        color: "",
        storeName: "",
        venderId: "",
        vendorId: "",
        timesPurchased: 0,
        dateUpdated: new Date(),
      };

      const sellable = buildProductFromVendorItem({ productId: `com_generic_${uuidv4()}`, vendorItem: product });
      const batch = writeBatch(db);
      batch.set(productCatalogDocRef(db, recentlySelectedCompany, sellable.id), sellable);
      batch.set(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", productId), { ...product, ...buildVendorItemProductPatch(sellable) });
      await batch.commit();
      const option = buildJobProductCatalog([sellable], [product]).products[0];
      setDatabaseProducts((items) => (
        [...items.filter((item) => item.id !== option.id), option]
          .sort((left, right) => databaseProductLabel(left).localeCompare(databaseProductLabel(right)))
      ));
      applyDatabaseProductToForm(option.id, option);
      setDatabaseProductPickerOpen(false);
      setShowDatabaseProductCreator(false);
      setDatabaseProductForm(emptyDatabaseProductForm());
      setActionMessage("Database product created and selected.");
    } catch (err) {
      console.error("Error creating product from job template:", err);
      setActionError(userFacingErrorMessage(err, "Could not create product."));
    } finally {
      setCreatingDatabaseProduct(false);
    }
  };

	  const buildItemPayload = (type, id) => {
	    if (type === "tasks") {
	      return {
	        id,
        companyId: recentlySelectedCompany,
        templateId: detailTemplate.id,
        name: itemForm.name.trim(),
        type: canonicalJobTaskType(itemForm.type.trim() || "Basic"),
        description: itemForm.description.trim(),
        contractedRate: centsFromMoney(itemForm.contractedRate),
            ...jobPayFields(itemForm),
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
        ...jobPayFields(itemForm, { payTypeId: itemForm.serviceStopTypeId }),
        billingLaborPriceCents: itemForm.billingLaborPriceCents ?? 0,
        serviceStopTypeName: itemForm.serviceStopTypeName.trim(),
	        serviceStopTypeImage: itemForm.serviceStopTypeImage.trim(),
	        serviceStopTypeUseCaseRawValue: itemForm.serviceStopTypeUseCaseRawValue.trim(),
	        estimatedMinutes: Number(itemForm.estimatedMinutes || 0),
	        sortOrder: Number(itemForm.sortOrder || 0),
	        taskTemplateIds: uniqueIdList(itemForm.taskTemplateIds),
	        plannedLaborCostCents: centsFromMoney(itemForm.plannedLaborCost),
	        plannedLaborNotes: itemForm.plannedLaborNotes.trim(),
	      };
	    }

	    if (type === "laborLineItems") {
	      const selectedCatalogItemId = itemForm.selectedSalesCatalogItemId || "";
	      const selectedCatalogItem = selectedCatalogItemId ? serviceCatalogItemById.get(selectedCatalogItemId) : null;
	      const quantity = Math.max(Number(itemForm.quantity || 1) || 1, 1);
	      const enteredUnitPriceCents = itemForm.unitPrice !== undefined && itemForm.unitPrice !== ""
	        ? centsFromMoney(itemForm.unitPrice)
	        : 0;
	      const enteredTotalPriceCents = centsFromMoney(itemForm.totalPrice);
	      const totalPriceCents = enteredTotalPriceCents || Math.round(enteredUnitPriceCents * quantity);
	      const unitPriceCents = enteredUnitPriceCents || Math.round(totalPriceCents / quantity);
	      const taskTemplateIds = uniqueIdList(itemForm.taskTemplateIds);
          const sourceType = selectedCatalogItem?.sourceType || itemModal?.item?.sourceType || SalesCatalogSourceType.manual;
          const usesPaySource = [SalesCatalogSourceType.manual, SalesCatalogSourceType.serviceStopType, SalesCatalogSourceType.workType].includes(sourceType);

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
        internalCostMode: "fixed",
        payTypeId: itemForm.payTypeId || "",
        payTypeName: payTypes.find((type) => type.id === itemForm.payTypeId)?.name || "",
        taskTemplateIds,
        taskIds: taskTemplateIds,
        laborLineTaskIds: taskTemplateIds,
        plannedServiceStopTemplateIds: [],
	        plannedServiceStopIds: [],
	        laborLinePlannedServiceStopIds: [],
	        salesItemType: selectedCatalogItem?.type || itemModal?.item?.salesItemType || SalesCatalogItemType.labor,
	        billingBehavior: selectedCatalogItem?.billingBehavior || itemModal?.item?.billingBehavior || SalesCatalogBillingBehavior.oneTime,
	        sourceType: usesPaySource ? (itemForm.payTypeId ? SalesCatalogSourceType.serviceStopType : SalesCatalogSourceType.manual) : sourceType,
	        sourceId: usesPaySource ? itemForm.payTypeId || "" : selectedCatalogItem?.sourceId || itemModal?.item?.sourceId || "",
	        catalogItemId: selectedCatalogItemId || itemModal?.item?.catalogItemId || "",
	        salesCatalogItemId: selectedCatalogItemId || itemModal?.item?.salesCatalogItemId || "",
	        catalogItemName: selectedCatalogItem?.name || itemModal?.item?.catalogItemName || "",
          taxable: Boolean(selectedCatalogItem?.taxable ?? itemModal?.item?.taxable),
        stripeProductId: selectedCatalogItem?.stripeProductId || itemModal?.item?.stripeProductId || "",
	        stripePriceId: selectedCatalogItem?.stripePriceId || itemModal?.item?.stripePriceId || "",
	        sortOrder: Number(itemForm.sortOrder || 0),
	      };
	    }

	    const databaseProductId = String(itemForm.dbItemId || "").trim();
	    const selectedDatabaseProduct = databaseProductId ? databaseProductById.get(databaseProductId) : null;
      const vendorItemId = selectedDatabaseProduct?.dbItemId ?? (itemForm.genericItemId ? getJobMaterialVendorItemId(itemModal?.item) : databaseProductId);
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
        dbItemId: vendorItemId || null,
        dataBaseItemId: vendorItemId || null,
        itemId: vendorItemId || null,
	      dbItemName: selectedDatabaseProduct ? databaseProductLabel(selectedDatabaseProduct) : itemForm.dbItemName || "",
        genericItemId: selectedDatabaseProduct?.genericItemId || itemForm.genericItemId?.trim() || null,
      taxable: Boolean(selectedDatabaseProduct?.taxable ?? itemModal?.item?.taxable),
	      plannedUnitCostCents: unitCostCents,
	      plannedUnitPriceCents: unitPriceCents,
	      plannedTotalCostCents: unitCostCents * quantity,
	      plannedTotalPriceCents: unitPriceCents * quantity,
	      billable: Boolean(itemForm.billable),
	      sourceType: databaseProductId ? SalesCatalogSourceType.databaseItem : SalesCatalogSourceType.manual,
	      sortOrder: Number(itemForm.sortOrder || 0),
	    };
	  };

  const buildTaskPayloadsFromCatalogItem = (catalogItem, laborLineId) => (
    catalogTasksForLaborLine(catalogItem, itemForm.payTypeId || "", Math.max(Number(itemForm.quantity || 1), 1))
      .map((task, index) => ({
        ...task,
        id: `comp_job_template_task_${uuidv4()}`,
        companyId: recentlySelectedCompany,
        templateId: detailTemplate.id,
        customerApproval: Boolean(task.customerApproval || task.customerApprovalRequired),
        customerApprovalRequired: Boolean(task.customerApproval || task.customerApprovalRequired),
        sourceType: "serviceCatalog",
        sourceCatalogItemId: catalogItem.id,
        sourceCatalogItemName: serviceCatalogItemLabel(catalogItem),
        sourceCatalogTaskTemplateId: task.id,
        laborLineId,
        laborLineIds: [laborLineId],
        sortOrder: details.tasks.length + index,
      }))
  );

	  const saveTemplateItem = async (event) => {
	    event.preventDefault();
	    if (!recentlySelectedCompany || !detailTemplate || !itemModal || !itemForm.name?.trim()) return;

    if (itemModal.type === "laborLineItems" && itemModal.mode === "create" && !itemForm.selectedSalesCatalogItemId) {
      setActionError("Select or create a sales catalog item before adding a service line.");
      return;
    }

    if (itemModal.type === "shoppingItems" && itemModal.mode === "create" && !itemForm.dbItemId) {
      setActionError("Select or create a product before adding a product line.");
      return;
    }

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
	      let payload = buildItemPayload(itemModal.type, itemId);
      const selectedCatalogItem = itemModal.type === "laborLineItems" && itemModal.mode === "create"
        ? serviceCatalogItemById.get(itemForm.selectedSalesCatalogItemId)
        : null;
      const catalogTaskPayloads = selectedCatalogItem
        ? buildTaskPayloadsFromCatalogItem(selectedCatalogItem, itemId)
        : [];

      if (catalogTaskPayloads.length) {
        const taskTemplateIds = uniqueIdList([
          ...payload.taskTemplateIds,
          ...catalogTaskPayloads.map((task) => task.id),
        ]);
        payload = {
          ...payload,
          taskTemplateIds,
          taskIds: taskTemplateIds,
          laborLineTaskIds: taskTemplateIds,
        };
      }

	      const itemRef = doc(db, "companies", recentlySelectedCompany, "jobTemplates", detailTemplate.id, itemModal.type, itemId);
	      await Promise.all([
        setDoc(itemRef, payload, { merge: true }),
        ...catalogTaskPayloads.map((task) => (
          setDoc(doc(db, "companies", recentlySelectedCompany, "jobTemplates", detailTemplate.id, "tasks", task.id), task)
        )),
      ]);

	      setDetails((current) => {
        const nextTasks = catalogTaskPayloads.length
          ? sortByOrder([
            ...current.tasks,
            ...catalogTaskPayloads,
          ])
          : current.tasks;
	        const nextList = sortByOrder([
	          ...current[itemModal.type].filter((item) => item.id !== itemId),
	          payload,
	        ]);
        if (catalogTaskPayloads.length) updateTemplateCount(detailTemplate.id, "tasks", nextTasks.length);
	        updateTemplateCount(detailTemplate.id, itemModal.type, nextList.length);
	        return { ...current, tasks: nextTasks, [itemModal.type]: nextList };
	      });
	      setActionMessage("Template detail saved.");
      setItemModal(null);
      setItemForm({});
    } catch (err) {
      console.error("Error saving template detail:", err);
      setActionError(userFacingErrorMessage(err, "Could not save template detail."));
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
      setActionError(userFacingErrorMessage(err, "Could not delete template detail."));
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
      setActionError(userFacingErrorMessage(err, "Could not delete job template."));
    } finally {
      setDeletingTemplate(false);
    }
  };

  const saveTemplate = async (event, draftScope = null) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;
    if (!templateForm.name.trim()) { setActionError("Enter a name for this template."); return; }
    if ([templateForm.defaultRate, templateForm.defaultLaborCost].some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
      setActionError("Enter valid prices and costs of zero or more."); return;
    }

    setSaving(true);
    setActionError("");
    setActionMessage("");

    try {
      const now = new Date();
      const isCreate = templateModal?.mode === "create";
      const templateId = isCreate ? templateModal.id : templateModal.template.id;
      const templateRef = doc(db, "companies", recentlySelectedCompany, "jobTemplates", templateId);
      const defaultIssuePriorityLevel = normalizeIssuePriority(templateForm.defaultIssuePriorityLevel);
      const defaultIssuePriorityLabel = getIssuePriorityLabel(defaultIssuePriorityLevel);
      const payload = {
        id: templateId,
        companyId: recentlySelectedCompany,
        name: templateForm.name.trim(),
        description: templateForm.description.trim(),
        defaultIssuePriorityLevel,
        defaultIssuePriorityLabel,
        issuePriorityLevel: defaultIssuePriorityLevel,
        issuePriorityLabel: defaultIssuePriorityLabel,
        priorityLevel: defaultIssuePriorityLevel,
        priorityLabel: defaultIssuePriorityLabel,
        solutionTier: defaultIssuePriorityLevel,
        solutionTierLabel: defaultIssuePriorityLabel,
        defaultRateCents: centsFromMoney(templateForm.defaultRate),
        defaultLaborCostCents: centsFromMoney(templateForm.defaultLaborCost),
        isActive: templateForm.isActive,
        active: templateForm.isActive,
        locked: templateForm.locked,
        technicianCanAdd: Boolean(templateForm.technicianCanAdd),
        updatedAt: now,
      };

      if (isCreate) {
        payload.createdAt = now;
        payload.createdByUserId = user?.uid || "";
        const scope = prepareJobTemplateScope(draftScope || emptyJobTemplateScope(), recentlySelectedCompany, templateId);
        const rows = Object.entries(scope).flatMap(([type, items]) => items.map((item) => ({ type, item })));
        if (rows.length > 499) throw new Error("This template has too many items to save together. Remove some items and try again.");
        Object.assign(payload, { taskCount: scope.tasks.length, plannedStopCount: scope.plannedServiceStops.length,
          laborLineCount: scope.laborLineItems.length, shoppingItemCount: scope.shoppingItems.length });
        const batch = writeBatch(db);
        batch.set(templateRef, payload);
        rows.forEach(({ type, item }) => batch.set(doc(templateRef, type, item.id), item));
        await batch.commit();
        setTemplates((items) =>
          [...items, payload]
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        );
        setActionMessage("Job template and scope created.");
        navigate(`/company/settings/job-templates/detail/${templateId}`);
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
      setActionError(userFacingErrorMessage(err, err.code === "permission-denied" ? "You do not have permission to manage job templates." : err.message || "Could not save job template. Your changes are still here; try again."));
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

  const renderIdCheckboxPicker = ({ title, items, selectedIds, field, emptyLabel, metaForItem }) => {
    const selected = uniqueIdList(selectedIds);

    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">
            {selected.length}
          </span>
        </div>
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
          {!items.length ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">{emptyLabel}</p>
          ) : (
            items.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs transition",
                    checked ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleItemFormId(field, item.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-slate-900">{item.name || item.serviceStopTypeName || item.type || "Untitled"}</span>
                    {metaForItem ? <span className="mt-0.5 block text-slate-500">{metaForItem(item)}</span> : null}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderServiceCatalogCreator = () => (
    <div role="region" aria-label="Create catalog service" className="rounded-lg border border-blue-200 bg-blue-50/70 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-900">New Sales Catalog Item</p>
          <p className="mt-0.5 text-xs text-slate-600">Create it here, then use it for this service line.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowServiceCatalogCreator(false);
            setServiceCatalogForm(emptyServiceCatalogForm());
          }}
          disabled={creatingServiceCatalogItem}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600 sm:col-span-2">
          Name
          <input
            value={serviceCatalogForm.name}
            onChange={(event) => updateServiceCatalogForm("name", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
            placeholder="Filter clean"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Type
          <select
            value={serviceCatalogForm.type}
            onChange={(event) => updateServiceCatalogForm("type", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          >
            {[SalesCatalogItemType.service, SalesCatalogItemType.recurringService, SalesCatalogItemType.labor, SalesCatalogItemType.manual].map((option) => (
              <option key={option} value={option}>{catalogTypeLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Billing
          <select
            value={serviceCatalogForm.billingBehavior}
            onChange={(event) => updateServiceCatalogForm("billingBehavior", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          >
            {Object.values(SalesCatalogBillingBehavior).map((option) => (
              <option key={option} value={option}>{labelize(option)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Customer Price
          <input
            type="number"
            min="0"
            step="0.01"
            value={serviceCatalogForm.unitAmount}
            onChange={(event) => updateServiceCatalogForm("unitAmount", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Default Qty
          <input
            type="number"
            min="1"
            step="1"
            value={serviceCatalogForm.defaultQuantity}
            onChange={(event) => updateServiceCatalogForm("defaultQuantity", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="mt-5 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(serviceCatalogForm.taxable)}
            onChange={(event) => updateServiceCatalogForm("taxable", event.target.checked)}
          />
          Taxable
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600 sm:col-span-2">
          Description
          <textarea
            rows={2}
            value={serviceCatalogForm.description}
            onChange={(event) => updateServiceCatalogForm("description", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
      </div>

      <div className="mt-3"><ServicePayrollTaskEditor companyId={recentlySelectedCompany} form={serviceCatalogForm} setForm={setServiceCatalogForm} showInternalCost /></div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={createServiceCatalogItemInline}
          disabled={creatingServiceCatalogItem}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creatingServiceCatalogItem ? "Creating..." : "Create & Select"}
        </button>
      </div>
    </div>
  );

	  const renderServiceCatalogPicker = () => {
	    const selectedId = itemForm.selectedSalesCatalogItemId || "";
	    const selectedItem = selectedId ? serviceCatalogItemById.get(selectedId) : null;
	    const selectedTaskTemplates = selectedItem ? catalogServiceTaskTemplates(selectedItem) : [];

	    const renderCatalogOptions = () => (
	      <>
	        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
	          <input
	            type="search"
	            value={serviceCatalogSearch}
	            onChange={(event) => setServiceCatalogSearch(event.target.value)}
	            placeholder="Search sales catalog"
	            autoFocus
	            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:flex-1"
	          />
	          <button
	            type="button"
	            onClick={startServiceCatalogCreator}
	            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
	          >
	            New Catalog Item
	          </button>
	        </div>

	        {showServiceCatalogCreator ? <div className="mt-3">{renderServiceCatalogCreator()}</div> : null}

	        {loadingServiceCatalogItems ? (
	          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">Loading sales catalog...</div>
	        ) : !filteredServiceCatalogItems.length ? (
	          <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
	            No sales catalog services match that search.
	          </div>
	        ) : (
	          <div className="mt-3 grid gap-2">
	            {filteredServiceCatalogItems.map((item) => {
	              const selected = item.id === selectedId;
	              const taskTemplates = catalogServiceTaskTemplates(item);

	              return (
	                <button
	                  key={item.id}
	                  type="button"
	                  onClick={() => {
	                    applyServiceCatalogItemToForm(item.id);
	                    setServiceCatalogPickerOpen(false);
	                  }}
	                  className={[
	                    "w-full rounded-md border p-3 text-left transition",
	                    selected ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50 hover:bg-white",
	                  ].join(" ")}
	                >
	                  <span className="flex items-start justify-between gap-3">
	                    <span className="min-w-0">
	                      <span className="block truncate text-sm font-bold text-slate-900">{serviceCatalogItemLabel(item)}</span>
	                      <span className="mt-1 line-clamp-2 block text-xs text-slate-500">{item.description || "No description"}</span>
	                    </span>
	                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">
	                      {selected ? "Selected" : catalogTypeLabel(item.type)}
	                    </span>
	                  </span>
	                  <span className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
	                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Price {moneyFromCents(item.unitAmountCents)}</span>
	                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Cost {moneyFromCents(item.unitCostCents)}</span>
	                    <span className="rounded-full border border-blue-200 bg-white px-2 py-1 text-blue-700">
	                      {taskTemplates.length} task template{taskTemplates.length === 1 ? "" : "s"}
	                    </span>
	                  </span>
	                </button>
	              );
	            })}
	          </div>
	        )}
	      </>
	    );

	    return (
	      <>
	        <div className="rounded-lg border border-blue-200 bg-white p-3">
	          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
	            <div>
	              <p className="text-sm font-bold text-slate-900">Sales Catalog Service</p>
	              <p className="mt-0.5 text-xs text-slate-500">Choose the reusable service this template line is based on.</p>
	            </div>
	            <button
	              type="button"
	              onClick={() => setServiceCatalogPickerOpen(true)}
	              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
	            >
	              {selectedId ? "Change Service" : "Choose Service"}
	            </button>
	          </div>

	          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
	            {selectedItem ? (
	              <>
	                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
	                  <div className="min-w-0">
	                    <p className="truncate text-sm font-bold text-slate-900">{serviceCatalogItemLabel(selectedItem)}</p>
	                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{selectedItem.description || "No description"}</p>
	                  </div>
	                  <span className="shrink-0 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-bold text-blue-700">
	                    {catalogTypeLabel(selectedItem.type)}
	                  </span>
	                </div>
	                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
	                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Price {moneyFromCents(selectedItem.unitAmountCents)}</span>
	                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Cost {moneyFromCents(selectedItem.unitCostCents)}</span>
	                  <span className="rounded-full border border-blue-200 bg-white px-2 py-1 text-blue-700">
	                    {selectedTaskTemplates.length} task template{selectedTaskTemplates.length === 1 ? "" : "s"}
	                  </span>
	                </div>
	              </>
	            ) : selectedId ? (
	              <p className="text-sm text-slate-500">Selected catalog item could not be loaded from the active catalog.</p>
	            ) : (
	              <p className="text-sm text-slate-500">No sales catalog service selected.</p>
	            )}
	          </div>
	        </div>

	        {serviceCatalogPickerOpen ? (
	          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
	            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
	              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
	                <div>
	                  <h3 className="text-lg font-bold text-slate-900">Choose Sales Catalog Service</h3>
	                  <p className="mt-1 text-sm text-slate-500">Search existing catalog services or create a new one for this line.</p>
	                </div>
	                <button
	                  type="button"
	                  onClick={() => setServiceCatalogPickerOpen(false)}
	                  className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100"
	                >
	                  Close
	                </button>
	              </div>
	              <div className="min-h-0 flex-1 overflow-y-auto p-5">
	                {renderCatalogOptions()}
	              </div>
	            </div>
	          </div>
	        ) : null}
	      </>
	    );
	  };

  const renderDatabaseProductCreator = () => (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-900">New Product</p>
          <p className="mt-0.5 text-xs text-slate-600">Create it here, then use it for this product line.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowDatabaseProductCreator(false);
            setDatabaseProductForm(emptyDatabaseProductForm());
          }}
          disabled={creatingDatabaseProduct}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600 sm:col-span-2">
          Product Name
          <input
            value={databaseProductForm.name}
            onChange={(event) => updateDatabaseProductForm("name", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
            placeholder="Chlorine tabs"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          SKU
          <input
            value={databaseProductForm.sku}
            onChange={(event) => updateDatabaseProductForm("sku", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          UOM
          <select
            value={databaseProductForm.uom}
            onChange={(event) => updateDatabaseProductForm("uom", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          >
            {UOM_OPTIONS.map((option) => (
              <option key={option.id || option.label} value={optionLabel(option)}>{optionLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Category
          <select
            value={databaseProductForm.category}
            onChange={(event) => updateDatabaseProductForm("category", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.id || option.label} value={optionLabel(option)}>{optionLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Subcategory
          <select
            value={databaseProductForm.subCategory}
            onChange={(event) => updateDatabaseProductForm("subCategory", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          >
            {SUBCATEGORY_OPTIONS.map((option) => (
              <option key={option.id || option.label} value={optionLabel(option)}>{optionLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Unit Cost
          <input
            type="number"
            min="0"
            step="0.01"
            value={databaseProductForm.unitCost}
            onChange={(event) => updateDatabaseProductForm("unitCost", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="mt-5 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(databaseProductForm.billable)}
            onChange={(event) => updateDatabaseProductForm("billable", event.target.checked)}
          />
          Billable
        </label>
        {databaseProductForm.billable ? (
          <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
            Unit Price
            <input
              type="number"
              min="0"
              step="0.01"
              value={databaseProductForm.unitPrice}
              onChange={(event) => updateDatabaseProductForm("unitPrice", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
            />
          </label>
        ) : null}
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Size
          <input
            value={databaseProductForm.size}
            onChange={(event) => updateDatabaseProductForm("size", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Tracking
          <input
            value={databaseProductForm.tracking}
            onChange={(event) => updateDatabaseProductForm("tracking", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-600 sm:col-span-2">
          Description
          <textarea
            rows={2}
            value={databaseProductForm.description}
            onChange={(event) => updateDatabaseProductForm("description", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={createDatabaseProductInline}
          disabled={creatingDatabaseProduct}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creatingDatabaseProduct ? "Creating..." : "Create & Select"}
        </button>
      </div>
    </div>
  );

	  const renderDatabaseProductPicker = () => {
	    const selectedId = itemForm.dbItemId || "";
	    const selectedProduct = selectedId ? databaseProductById.get(selectedId) : null;

	    const renderProductOptions = () => (
	      <>
	        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
	          <input
	            type="search"
	            value={databaseProductSearch}
	            onChange={(event) => setDatabaseProductSearch(event.target.value)}
	            placeholder="Search products"
	            autoFocus
	            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:flex-1"
	          />
	          <button
	            type="button"
	            onClick={startDatabaseProductCreator}
	            className="template-secondary-action rounded-md px-3 py-2 text-xs font-semibold"
	          >
	            New Product
	          </button>
	        </div>

	        {showDatabaseProductCreator ? <div className="mt-3">{renderDatabaseProductCreator()}</div> : null}

	        {loadingDatabaseProducts ? (
	          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">Loading products...</div>
	        ) : !filteredDatabaseProducts.length ? (
	          <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
	            No products match that search.
	          </div>
	        ) : (
	          <div className="mt-3 grid gap-2">
	            {filteredDatabaseProducts.map((item) => {
	              const selected = item.id === selectedId;

	              return (
	                <button
	                  key={item.id}
	                  type="button"
	                  onClick={() => {
	                    applyDatabaseProductToForm(item.id);
	                    setDatabaseProductPickerOpen(false);
	                  }}
	                  className={[
	                    "w-full rounded-md border p-3 text-left transition",
	                    selected ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50 hover:bg-white",
	                  ].join(" ")}
	                >
	                  <span className="flex items-start justify-between gap-3">
	                    <span className="min-w-0">
	                      <span className="block truncate text-sm font-bold text-slate-900">{databaseProductLabel(item)}</span>
	                      <span className="mt-1 line-clamp-2 block text-xs text-slate-500">{item.description || item.sku || "No description"}</span>
	                    </span>
	                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">
	                      {selected ? "Selected" : item.subCategory || item.category || "Product"}
	                    </span>
	                  </span>
	                  <span className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
	                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Cost {moneyFromCents(databaseProductCostCents(item))}</span>
	                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Price {moneyFromCents(databaseProductPriceCents(item))}</span>
	                    <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-emerald-700">{item.UOM || "Unit"}</span>
	                  </span>
	                </button>
	              );
	            })}
	          </div>
	        )}
	      </>
	    );

	    return (
	      <>
	        <div className="rounded-lg border border-emerald-200 bg-white p-3">
	          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
	            <div>
	              <p className="text-sm font-bold text-slate-900">Product</p>
	              <p className="mt-0.5 text-xs text-slate-500">Choose the reusable product this template line should use.</p>
	            </div>
	            <button
	              type="button"
	              onClick={() => setDatabaseProductPickerOpen(true)}
	              className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
	            >
	              {selectedId ? "Change Product" : "Choose Product"}
	            </button>
	          </div>

	          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
	            {selectedProduct ? (
	              <>
	                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
	                  <div className="min-w-0">
	                    <p className="truncate text-sm font-bold text-slate-900">{databaseProductLabel(selectedProduct)}</p>
	                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{selectedProduct.description || selectedProduct.sku || "No description"}</p>
	                  </div>
	                  <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-700">
	                    {selectedProduct.subCategory || selectedProduct.category || "Product"}
	                  </span>
	                </div>
	                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
	                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Cost {moneyFromCents(databaseProductCostCents(selectedProduct))}</span>
	                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Price {moneyFromCents(databaseProductPriceCents(selectedProduct))}</span>
	                  <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-emerald-700">{selectedProduct.UOM || "Unit"}</span>
	                </div>
	              </>
	            ) : selectedId ? (
	              <p className="text-sm text-slate-500">Selected product could not be loaded from the active catalog.</p>
	            ) : (
	              <p className="text-sm text-slate-500">No product selected.</p>
	            )}
	          </div>
	        </div>

	        {databaseProductPickerOpen ? (
	          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
	            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
	              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
	                <div>
	                  <h3 className="text-lg font-bold text-slate-900">Choose Product</h3>
	                  <p className="mt-1 text-sm text-slate-500">Search existing products or create a new one for this line.</p>
	                </div>
	                <button
	                  type="button"
	                  onClick={() => setDatabaseProductPickerOpen(false)}
	                  className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100"
	                >
	                  Close
	                </button>
	              </div>
	              <div className="min-h-0 flex-1 overflow-y-auto p-5">
	                {renderProductOptions()}
	              </div>
	            </div>
	          </div>
	        ) : null}
	      </>
	    );
	  };

	  const renderTemplateStatusPills = () => (
    <div className="mt-3 flex flex-wrap gap-2">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${!isActiveJobTemplate(detailTemplate) ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
        {!isActiveJobTemplate(detailTemplate) ? "Inactive" : "Active"}
      </span>
      {detailTemplate?.technicianCanAdd ? (
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Available to Technicians</span>
      ) : null}
      {detailTemplate?.locked ? (
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Locked</span>
      ) : null}
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
        Priority {templateDefaultPriorityDisplay(detailTemplate)}
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
              Add a service line to price the work, then attach template tasks underneath it.
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

      return (
        <tr key={line.id} className="align-top hover:bg-slate-50">
          <td className="px-4 py-3">
            <div className="font-semibold text-slate-900">{line.name || "Untitled service line"}</div>
            {line.description ? <p className="mt-1 text-xs text-slate-500">{line.description}</p> : null}
            {renderLinkedChips(taskIds, taskById, "Task")}
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
      <section aria-labelledby="template-summary-title" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h2 id="template-summary-title" className="text-sm font-bold text-slate-900">Summary</h2>
            <p className="mt-0.5 text-xs text-slate-500">Reusable defaults and pricing for future jobs</p>
          </div>
          <span className="template-kind-label"><DocumentDuplicateIcon className="h-4 w-4" aria-hidden="true" />Job Template</span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <dl className="divide-y divide-slate-200 border-y border-slate-200">
              <SnapshotRow label="Customer" value="Chosen for each job" muted />
              <SnapshotRow label="Site" value="Chosen for each job" muted />
            </dl>
            <dl className="divide-y divide-slate-200 border-y border-slate-200">
              <SnapshotRow label="Default Admin" value={selectedDefaultAdmin?.userName || "Not set"} muted={!selectedDefaultAdmin} />
              <SnapshotRow label="Default Priority" value={templateDefaultPriorityDisplay(detailTemplate)} />
            </dl>
            <dl className="divide-y divide-slate-200 border-y border-slate-200">
              <SnapshotRow label="Template Price" value={moneyFromCents(templatePriceCents)} />
              <SnapshotRow label="Projected Profit" value={moneyFromCents(templateProfitCents)} tone={templateProfitCents < 0 ? "negative" : "positive"} />
            </dl>
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Job setup when used</h3>
            <p className="mt-2 text-sm font-semibold text-slate-900">Choose the customer and site, then assign a technician and schedule the first visit.</p>
            <p className="mt-1 text-xs text-slate-500">This template includes {details.laborLineItems.length} services, {details.tasks.length} tasks, {details.plannedServiceStops.length} planned visits, and {details.shoppingItems.length} products.</p>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Description</h3>
              <button type="button" onClick={() => openEditModal(detailTemplate)} className="template-secondary-action rounded-md px-2.5 py-1 text-xs font-semibold">Edit description</button>
            </div>
            <p className="mt-2 min-h-[88px] whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">{detailTemplate?.description || "Add a description of when to use this template and the work it includes."}</p>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,auto)]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Reusable Scope</p>
            <h3 className="mt-1 text-2xl font-bold text-slate-950">{moneyFromCents(templatePriceCents)}</h3>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              {details.laborLineItems.length || details.shoppingItems.length
                ? `${details.laborLineItems.length} service line${details.laborLineItems.length === 1 ? "" : "s"} and ${details.shoppingItems.length} product line${details.shoppingItems.length === 1 ? "" : "s"}`
                : "No services or products added yet"}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:text-right">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Customer</dt>
              <dd className="mt-1 flex justify-start lg:justify-end">
                <span className="text-xs text-slate-500">Chosen for each job</span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Template</dt>
              <dd className="mt-1 flex justify-start lg:justify-end">
                <span className="text-xs font-semibold text-slate-700">Reusable template</span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Applies To</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">New jobs</dd>
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
                <p className="mt-0.5 text-xs text-slate-500">Billable service price with linked template tasks underneath.</p>
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
                  className="template-secondary-action rounded-md px-3 py-2 text-xs font-semibold"
                >
                  Product Line
                </button>
              </div>
            </div>
            <div className="space-y-2 bg-white p-4">{renderTemplateProductRows()}</div>
          </section>
        </div>

        <div className="template-pricing-total grid gap-3 px-4 py-4 md:grid-cols-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Template Price</p>
            <p className="mt-1 text-xl font-bold">{moneyFromCents(templatePriceCents)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Planned Cost</p>
            <p className="mt-1 text-xl font-bold">{moneyFromCents(templateCostCents)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Projected Profit</p>
            <p className="mt-1 text-xl font-bold">{moneyFromCents(templateProfitCents)}</p>
          </div>
        </div>
      </div>

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
                          <span>{taskIds.length} task link(s)</span>
                          {renderLinkedChips(taskIds, taskById, "Task")}
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
    if (detailLoading && !detailTemplate) {
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
          Loading job template...
        </div>
      );
    }

    return (
      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <aside aria-label="Template navigation" className="space-y-4 lg:order-2">
          <nav aria-label="Template sections" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
            <div className="mt-3 space-y-2">
              {templateDetailSections.map((sectionOption) => {
                const active = sectionOption.id === detailTab;
                const disabled = Boolean(sectionOption.disabled);
                return (
                  <button key={sectionOption.id} type="button"
                    onClick={() => { if (!disabled) setDetailTab(sectionOption.id); }}
                    disabled={disabled} aria-current={active ? "page" : undefined}
                    className={`template-section-link w-full rounded-md px-3 py-2 text-left transition ${active ? "template-section-link--active" : ""}`}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{sectionOption.label}</span>
                      <span className="template-section-count rounded-full px-2 py-0.5 text-xs font-semibold">{sectionOption.count}</span>
                    </span>
                    <span className="template-section-helper mt-1 block text-xs">{sectionOption.helper}</span>
                  </button>
                );
              })}
            </div>
          </nav>
          <section aria-label="Template context" className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><DocumentDuplicateIcon className="h-5 w-5" aria-hidden="true" />Reusable template</h2>
            <p className="mt-2 text-sm text-slate-600">Edit the scope that will be copied into future jobs.</p>
            <p className="mt-2 text-xs text-slate-500">Actual work, comments, billing, and job history become available after a job is created.</p>
          </section>
        </aside>

        <div className="min-w-0 space-y-4 lg:order-1">
          {detailLoading ? <div role="status" className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading template scope…</div> : detailTab === "overview" ? renderTemplateOverview() : (
            <section aria-label="Template plan editor" className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Plan Editor</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Build the reusable services, products, visits, and tasks for future jobs.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Template</span>
                </div>
              </div>
              {templatePlanSections.map((planSection) => (
                <section key={planSection.id} aria-label={planSection.region} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{planSection.label} <span className="ml-1 text-xs font-normal text-slate-500">({details[planSection.id].length})</span></h3>
                      <p className="mt-0.5 text-xs text-slate-500">{planSection.helper}</p>
                    </div>
                    <button type="button" onClick={() => openItemModal(planSection.id)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Add {detailTabLabel(planSection.id)}</button>
                  </div>
                  {renderTemplateChildSection(planSection.id)}
                </section>
              ))}
            </section>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="job-template-theme job-template-page min-h-screen px-2 py-6 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="template-header rounded-lg border p-5 shadow-sm" aria-label={isDetailRoute ? "Editing a job template" : "Job template library"}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <Link to={isDetailRoute ? "/company/settings/job-templates" : "/company/settings"} className="template-back-link">&larr; {isDetailRoute ? "Back to Job Templates" : "Back to Settings"}</Link>
                <span className="template-kind-label"><DocumentDuplicateIcon className="h-4 w-4" aria-hidden="true" />{isDetailRoute ? "Editing a Job Template" : "Template Library"}</span>
              </div>
              <h1 className="template-header-title mt-3 break-words text-3xl font-bold">{isDetailRoute ? detailTemplate?.name || "Job Template" : "Job Templates"}</h1>
              <p className="template-header-muted mt-2 max-w-3xl text-sm">{isDetailRoute ? "Reusable services, tasks, planned visits, and products for future jobs." : "Build reusable scope for common work, then create jobs from it."}</p>
              {isDetailRoute && detailTemplate && renderTemplateStatusPills()}
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {isDetailRoute && detailTemplate ? <>
                <Menu as="div" className="relative inline-block text-left">
                  <MenuButton disabled={deletingTemplate} className="template-header-action rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"><EllipsisVerticalIcon className="h-4 w-4" aria-hidden="true" />Actions<ChevronDownIcon className="h-4 w-4" aria-hidden="true" /></MenuButton>
                  <MenuItems anchor="bottom end" className="job-template-theme template-menu z-50 mt-2 w-56 overflow-hidden rounded-md p-1 shadow-lg focus:outline-none">
                    <MenuItem><button type="button" onClick={() => openEditModal(detailTemplate)} className="template-menu-item flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold"><PencilSquareIcon className="h-4 w-4" aria-hidden="true" />Edit Template</button></MenuItem>
                    <MenuItem><button type="button" onClick={() => deleteTemplate(detailTemplate)} disabled={deletingTemplate} className="template-menu-item flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-red-700"><TrashIcon className="h-4 w-4" aria-hidden="true" />{deletingTemplate ? "Deleting…" : "Delete Template"}</button></MenuItem>
                  </MenuItems>
                </Menu>
                <Link to={`/company/jobs/basic-create?templateId=${encodeURIComponent(detailTemplate.id)}`} className="template-primary-action rounded-md px-4 py-2 text-sm font-semibold">Create and Schedule Job</Link>
              </> : <>
                <button type="button" onClick={openCreateModal} className="template-header-action rounded-md px-4 py-2 text-sm font-semibold">New Template</button>
                <Link to="/company/jobs/basic-create" className="template-primary-action rounded-md px-4 py-2 text-sm font-semibold">Create and Schedule Job</Link>
              </>}
            </div>
          </div>
        </section>
        {isDetailRoute && <div className="template-mode-notice flex items-start gap-3 rounded-lg px-4 py-3">
          <DocumentDuplicateIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div><p className="text-sm font-bold">Template editing</p><p className="mt-0.5 text-sm">Changes here apply to future jobs created from this template. Existing jobs keep their saved scope.</p></div>
        </div>}

        {!isDetailRoute && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase text-slate-500">Default Job Admin</h2>
              <p className="mt-1 text-sm text-slate-600">
                Fallback admin for jobs created through Create and Schedule Job.
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
                placeholder="Search templates by name, description, or priority"
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
                    <th className="border-b border-slate-200 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Default Priority</th>
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
                      <td className="px-5 py-3 text-sm text-slate-700">{templateDefaultPriorityDisplay(template)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${!isActiveJobTemplate(template) ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                            {!isActiveJobTemplate(template) ? "Inactive" : "Active"}
                          </span>
                          {template.technicianCanAdd ? (
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Available to Technicians</span>
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
          <form aria-label={`${itemModal.mode === "create" ? "Add" : "Edit"} Template ${detailTabLabel(itemModal.type)}`} onSubmit={saveTemplateItem} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-900">
                {itemModal.mode === "create" ? "Add" : "Edit"} Template {detailTabLabel(itemModal.type)}
              </h2>
	              <button type="button" onClick={closeItemModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
	                Close
	              </button>
	            </div>

	            {actionMessage ? (
	              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{actionMessage}</div>
	            ) : null}
	            {actionError ? (
	              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{actionError}</div>
	            ) : null}

	            <div className="mt-5 grid gap-4">
	              {itemModal.type === "laborLineItems" ? (
	                renderServiceCatalogPicker()
	              ) : itemModal.type === "shoppingItems" ? (
	                renderDatabaseProductPicker()
	              ) : (
	                <label className="text-sm font-semibold text-slate-700">
	                  Name
	                  <input required value={itemForm.name || ""} onChange={(event) => setItemForm((form) => ({ ...form, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
	                </label>
	              )}

	              {["laborLineItems", "shoppingItems"].includes(itemModal.type) ? (
	                <label className="text-sm font-semibold text-slate-700">
	                  Line name
	                  <input required value={itemForm.name || ""} onChange={(event) => setItemForm((form) => ({ ...form, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
	                </label>
	              ) : null}

	              {itemModal.type === "tasks" ? (
	                <>
                      <JobPayrollFields value={itemForm} payTypes={payTypes} onChange={(field, value) => setItemForm((form) => ({ ...form, [field]: value }))} />
	                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Type
                      <select value={itemForm.type || ""} onChange={(event) => setItemForm((form) => ({ ...form, type: canonicalJobTaskType(event.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                        {[...new Set([canonicalJobTaskType(itemForm.type || ""), ...JOB_TASK_TYPE_NAMES].filter(Boolean))].map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
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
                  <JobPayrollFields scope="stop" value={{ ...itemForm, payTypeId: itemForm.serviceStopTypeId }} payTypes={payTypes} showPayType={false} onChange={(field, value) => setItemForm((form) => ({ ...form, [field]: value }))} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Stop type name
                      <input value={itemForm.serviceStopTypeName || ""} onChange={(event) => setItemForm((form) => ({ ...form, serviceStopTypeName: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Payroll pay item
                      <select value={itemForm.serviceStopTypeId || ""} onChange={(event) => {
                        const selected = payTypes.find((type) => type.id === event.target.value);
                        setItemForm((form) => ({ ...form, serviceStopTypeId: event.target.value, payTypeId: event.target.value, serviceStopTypeName: selected?.name || "", payTypeName: selected?.name || "" }));
                      }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                        <option value="">Select a pay item</option>
                        {payTypes.filter((type) => type.isActive !== false || type.id === itemForm.serviceStopTypeId).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
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
	                  {renderIdCheckboxPicker({
	                    title: "Linked Tasks",
	                    items: details.tasks,
	                    selectedIds: itemForm.taskTemplateIds,
	                    field: "taskTemplateIds",
	                    emptyLabel: "Add template tasks first, then link them to this planned stop.",
	                    metaForItem: (task) => `${task.type || "Task"} - ${task.estimatedTime || 0} min`,
	                  })}
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
	                      <input
	                        type="number"
	                        min="1"
	                        step="1"
	                        value={itemForm.quantity || "1"}
	                        onChange={(event) => {
	                          const quantity = event.target.value;
	                          setItemForm((form) => ({
	                            ...form,
	                            quantity,
	                            totalPrice: dollarsFromCents(centsFromMoney(form.unitPrice) * Math.max(Number(quantity || 1) || 1, 1)),
	                          }));
	                        }}
	                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
	                      />
	                    </label>
	                    <label className="text-sm font-semibold text-slate-700">
	                      Unit price
	                      <input
	                        type="number"
	                        min="0"
	                        step="0.01"
	                        value={itemForm.unitPrice || "0.00"}
	                        onChange={(event) => {
	                          const unitPrice = event.target.value;
	                          setItemForm((form) => ({
	                            ...form,
	                            unitPrice,
	                            totalPrice: dollarsFromCents(centsFromMoney(unitPrice) * Math.max(Number(form.quantity || 1) || 1, 1)),
	                          }));
	                        }}
	                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
	                      />
	                    </label>
	                    <label className="text-sm font-semibold text-slate-700">
	                      Total price
                      <input type="number" min="0" step="0.01" value={itemForm.totalPrice || "0.00"} onChange={(event) => setItemForm((form) => ({ ...form, totalPrice: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>

	                  </div>
                      <ServicePayTypeField value={itemForm.payTypeId} payTypes={payTypes}
                        onChange={(payTypeId) => setItemForm((form) => ({ ...form, payTypeId }))} />
	                  <ServicePayrollCostEditor data={servicePayrollData} scopeLabel="For this service line, including linked tasks"
                        costLabel="Internal cost" onCostChange={(internalCost) => setItemForm((form) => ({ ...form, internalCost }))}
                        onUseSuggestedPrice={(cents) => setItemForm((form) => ({ ...form, totalPrice: dollarsFromCents(cents), unitPrice: dollarsFromCents(cents / Math.max(Number(form.quantity || 1), 1)) }))}
                        tasks={[
                          ...details.tasks.filter((task) => (itemForm.taskTemplateIds || []).includes(task.id)),
                          ...(itemModal.mode === "create" && serviceCatalogItemById.has(itemForm.selectedSalesCatalogItemId)
                            ? catalogTasksForLaborLine(serviceCatalogItemById.get(itemForm.selectedSalesCatalogItemId), itemForm.payTypeId || "", Math.max(Number(itemForm.quantity || 1), 1)) : []),
                        ]}
                        serviceQuantity={Math.max(Number(itemForm.quantity || 1), 1)}
                        inheritedPayTypeId={itemForm.payTypeId || ""} priceInput={itemForm.totalPrice} costInput={itemForm.internalCost}
                        onUseHighCost={(cents) => setItemForm((form) => ({ ...form, internalCost: (cents / 100).toFixed(2) }))} />
	                  <div className="grid gap-4">
	                    {renderIdCheckboxPicker({
	                      title: "Linked Tasks",
	                      items: details.tasks,
	                      selectedIds: itemForm.taskTemplateIds,
	                      field: "taskTemplateIds",
	                      emptyLabel: "Add template tasks first, or select a catalog service that seeds tasks.",
	                      metaForItem: (task) => `${task.type || "Task"} - ${task.estimatedTime || 0} min`,
	                    })}
	                  </div>
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

      {templateModal && <JobTemplateDialog key={templateModal.id || templateModal.template.id}
        mode={templateModal.mode} form={templateForm} setForm={setTemplateForm}
        services={serviceCatalogItems} products={databaseProducts} payTypes={payTypes}
        loadingCatalogs={loadingServiceCatalogItems || loadingDatabaseProducts}
        saving={saving} deleting={deletingTemplate} error={actionError}
        onSave={saveTemplate} onClose={closeTemplateModal}
        onDelete={() => deleteTemplate(templateModal.template)} />}

    </div>
  );
};

const SnapshotRow = ({ label, value, muted = false, tone = "default" }) => (
  <div className="flex items-start justify-between gap-3 py-2">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`min-w-0 text-right text-sm font-bold ${tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-rose-700" : muted ? "text-slate-500" : "text-slate-950"}`}>{value}</dd>
  </div>
);

export default JobTemplates;
