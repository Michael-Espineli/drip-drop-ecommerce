import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { arrayRemove, arrayUnion, collection, doc, query, where, orderBy, getDocs, startAfter, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PurchasedItem } from '../../../utils/models/PurchasedItem';
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { appAlert } from "../../../utils/appDialog";
import Select from "react-select";
import { syncLinkedShoppingPurchase } from "../../../utils/shoppingPurchaseSync";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";
import {
  ArrowsRightLeftIcon,
  ArrowsPointingInIcon,
  BriefcaseIcon,
  CheckCircleIcon,
  CircleStackIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  ShoppingCartIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";

const purchaseFilters = [
  { value: "all", label: "All" },
  { value: "billable", label: "Billable" },
  { value: "nonBillable", label: "Non Billable" },
  { value: "billableAndNotInvoiced", label: "Billable And Not Invoiced" },
  { value: "billableAndInvoiced", label: "Billable And Invoiced" },
];

const purchaseSorts = [
  { value: "purchaseDateFirst", label: "Recent" },
  { value: "purchaseDateLast", label: "Oldest" },
  { value: "priceHigh", label: "Price High" },
  { value: "priceLow", label: "Price Low" },
];

const purchaseTableColumns = [
  { key: "actions", label: "", ariaLabel: "Actions", width: 72, minWidth: 64 },
  { key: "status", label: "Status", width: 168, minWidth: 140, sortKey: "status" },
  { key: "name", label: "Name", width: 230, minWidth: 160, sortKey: "name" },
  { key: "itemId", label: "Database Item", width: 150, minWidth: 128, sortKey: "itemId" },
  { key: "category", label: "Category", width: 150, minWidth: 120, sortKey: "category" },
  { key: "invoiceNum", label: "Invoice #", width: 140, minWidth: 118, sortKey: "invoiceNum" },
  { key: "date", label: "Date", width: 118, minWidth: 100, sortKey: "date" },
  { key: "sku", label: "Sku", width: 150, minWidth: 110, sortKey: "sku" },
  { key: "price", label: "Price", width: 112, minWidth: 96, sortKey: "price" },
  { key: "quantity", label: "Quantity", width: 116, minWidth: 96, sortKey: "quantity" },
  { key: "total", label: "Total", width: 112, minWidth: 96, sortKey: "total" },
  { key: "techName", label: "Technician", width: 168, minWidth: 128, sortKey: "techName" },
  { key: "customerName", label: "Customer Name", width: 198, minWidth: 150, sortKey: "customerName" },
  { key: "jobId", label: "Job", width: 150, minWidth: 112, sortKey: "jobId" },
  { key: "notes", label: "Notes", width: 260, minWidth: 160, sortKey: "notes" },
];

const defaultPurchaseColumnWidths = purchaseTableColumns.reduce((widths, column) => {
  widths[column.key] = column.width;
  return widths;
}, {});

const purchaseColumnSettings = purchaseTableColumns.reduce((settings, column) => {
  settings[column.key] = column;
  return settings;
}, {});

const purchaseColumnWidthsStorageKey = "dripDrop.purchaseList.columnWidths";

const startOfDay = (date) => {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
};

const endOfDay = (date) => {
  const nextDate = new Date(date);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
};

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const purchaseSearchText = (item) =>
  [
    item.id,
    item.customerName,
    item.sku,
    item.name,
    item.category,
    item.subCategory,
    item.invoiceNum,
    item.techName,
    item.venderName,
    item.jobId,
    item.receiptId,
    item.notes,
    item.status,
    item.assignmentStatus,
    item.jobBillingStatus,
    item.jobInternalId,
    item.jobName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const toSortableValue = (value) => {
  if (value?.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value || "").toLowerCase();
};

const compareSortValues = (left, right) => {
  if (left === right) return 0;
  if (left === "" || left === null || left === undefined) return 1;
  if (right === "" || right === null || right === undefined) return -1;
  return left > right ? 1 : -1;
};

const loadPurchaseColumnWidths = () => {
  if (typeof window === "undefined") return defaultPurchaseColumnWidths;

  try {
    const stored = JSON.parse(window.localStorage.getItem(purchaseColumnWidthsStorageKey) || "{}");
    return purchaseTableColumns.reduce((widths, column) => {
      const storedWidth = Number(stored[column.key]);
      widths[column.key] = Number.isFinite(storedWidth)
        ? Math.max(column.minWidth, storedWidth)
        : column.width;
      return widths;
    }, {});
  } catch (error) {
    return defaultPurchaseColumnWidths;
  }
};

const purchaseIsConnectedToJob = (item = {}) =>
  Boolean(
    item.jobId ||
    item.workOrderId ||
    item.assignedJobId ||
    item.assignedToJob ||
    item.assignmentStatus === "assignedToJob"
  );

const purchaseStatusLabel = (item = {}) => {
  if (item.returned) return "Returned";
  if (purchaseIsConnectedToJob(item)) {
    return item.invoiced ? "Job invoiced" : "Connected to Job";
  }
  if (item.billable) return item.invoiced ? "Invoiced" : "Needs invoice";
  return "Non-billable";
};

const purchaseStatusClassName = (item = {}) => {
  const status = purchaseStatusLabel(item);

  switch (status) {
    case "Job invoiced":
    case "Invoiced":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "Connected to Job":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "Needs invoice":
      return "border-red-200 bg-red-50 text-red-800";
    case "Returned":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
};

const jobBillingIsInvoiced = (status = "") =>
  ["invoiced", "paid"].includes(String(status || "").trim().toLowerCase());

const invoicedPurchaseFieldsForJob = (job = {}) => {
  const invoiceId = job.salesInvoiceId || job.invoiceRef || job.invoiceId || "";

  return {
    invoiced: true,
    invoiceStatus: "Invoiced",
    jobBillingStatus: "invoiced",
    invoiceId,
    invoiceRef: invoiceId,
    invoiceType: job.invoiceType || (job.salesInvoiceId ? "salesInvoice" : "job"),
    invoicedAt: serverTimestamp(),
    jobInvoicedAt: serverTimestamp(),
    status: "Invoiced",
  };
};

const invoicedPurchaseStateForJob = (job = {}) => {
  const invoiceId = job.salesInvoiceId || job.invoiceRef || job.invoiceId || "";

  return {
    invoiced: true,
    invoiceStatus: "Invoiced",
    jobBillingStatus: "invoiced",
    invoiceId,
    invoiceRef: invoiceId,
    invoiceType: job.invoiceType || (job.salesInvoiceId ? "salesInvoice" : "job"),
    invoicedAt: new Date(),
    jobInvoicedAt: new Date(),
    status: "Invoiced",
  };
};

const dateInputValueDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return format(date, "yyyy-MM-dd");
};

const startDateFromSearchParams = (searchParams) => {
  const days = Number(searchParams.get("days"));
  const validDays = Number.isFinite(days) && days > 0 ? days : 30;
  return startOfDay(new Date(Date.now() - validDays * 24 * 60 * 60 * 1000));
};

const purchaseFilterFromSearchParams = (searchParams) => {
  const requestedFilter = searchParams.get("filter");
  return purchaseFilters.some((filter) => filter.value === requestedFilter)
    ? requestedFilter
    : "billableAndNotInvoiced";
};

const purchaseSortFromSearchParams = (searchParams) => {
  const requestedSort = searchParams.get("sort");
  if (requestedSort === "recent") return "purchaseDateFirst";
  if (requestedSort === "oldest") return "purchaseDateLast";

  return purchaseSorts.some((sort) => sort.value === requestedSort)
    ? requestedSort
    : "purchaseDateFirst";
};

const mergePurchaseUpdate = (purchase, updates) =>
  Object.assign(Object.create(Object.getPrototypeOf(purchase)), purchase, updates);

const getFirestoreDocId = (record = {}) =>
  record.firestoreId || record.docId || record.id || "";

const technicianDisplayName = (user = {}) =>
  getCompanyUserDisplayName(user, user.userId || "");

const selectStyles = {
  control: (provided) => ({
    ...provided,
    backgroundColor: "white",
    border: "1px solid #d1d5db",
    borderRadius: "0.5rem",
    minHeight: "46px",
    boxShadow: "none",
  }),
  menu: (provided) => ({
    ...provided,
    zIndex: 60,
    borderRadius: "0.75rem",
    overflow: "hidden",
  }),
};

const customerSelectStyles = {
  ...selectStyles,
  menu: (provided) => ({
    ...selectStyles.menu(provided),
    zIndex: 80,
  }),
  menuPortal: (provided) => ({
    ...provided,
    zIndex: 80,
  }),
  menuList: (provided) => ({
    ...provided,
    maxHeight: "560px",
  }),
};

const QuickActionMenuItem = ({ label, icon: Icon, tone = "black", onClick }) => {
  const toneClasses =
    tone === "green"
      ? "text-green-700 hover:bg-green-50"
      : tone === "blue"
        ? "text-blue-700 hover:bg-blue-50"
        : "text-gray-900 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition ${toneClasses}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
};

const ModalShell = ({ title, description, onClose, children, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
        <div>
          <h3 className="text-xl font-bold text-gray-800">{title}</h3>
          {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-200"
        >
          Close
        </button>
      </div>
      <div className="p-6">{children}</div>
      {footer ? <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">{footer}</div> : null}
    </div>
  </div>
);

const PurchaseListView = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [purchasedItems, setPurchasedItems] = useState([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [startViewingDate, setStartViewingDate] = useState(() => startDateFromSearchParams(searchParams));
  const [endViewingDate, setEndViewingDate] = useState(() => endOfDay(new Date()));
  const [purchaseFilterOption, setPurchaseFilterOption] = useState(() => purchaseFilterFromSearchParams(searchParams));
  const [purchaseSortOption, setPurchaseSortOption] = useState(() => purchaseSortFromSearchParams(searchParams));
  const [techIds, setTechIds] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filteredItems, setFilteredItems] = useState([]);
  const [error, setError] = useState(null);
  const [lastDocument, setLastDocument] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [tableSort, setTableSort] = useState({ key: "date", direction: "desc" });
  const [columnWidths, setColumnWidths] = useState(loadPurchaseColumnWidths);
  const resizingColumnRef = useRef(null);
  const [openActionMenuId, setOpenActionMenuId] = useState("");
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const [quickUpdatingId, setQuickUpdatingId] = useState("");
  const [customerOptions, setCustomerOptions] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSelection, setCustomerSelection] = useState(null);
  const [notesSelection, setNotesSelection] = useState(null);
  const [shoppingListItems, setShoppingListItems] = useState([]);
  const [shoppingListItemsLoading, setShoppingListItemsLoading] = useState(false);
  const [shoppingSelection, setShoppingSelection] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobSelection, setJobSelection] = useState(null);
  const { recentlySelectedCompany } = useContext(Context);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(purchaseColumnWidthsStorageKey, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    const stopResize = () => {
      resizingColumnRef.current = null;
      if (typeof document !== "undefined") {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    const resizeColumn = (event) => {
      const resizeState = resizingColumnRef.current;
      if (!resizeState) return;

      const nextWidth = Math.max(
        resizeState.minWidth,
        resizeState.startWidth + event.clientX - resizeState.startX
      );

      setColumnWidths((current) => ({
        ...current,
        [resizeState.columnKey]: Math.round(nextWidth),
      }));
    };

    window.addEventListener("pointermove", resizeColumn);
    window.addEventListener("pointerup", stopResize);

    return () => {
      window.removeEventListener("pointermove", resizeColumn);
      window.removeEventListener("pointerup", stopResize);
      stopResize();
    };
  }, []);

  // Effect to fetch company users
  useEffect(() => {
    const fetchCompanyUsers = async () => {
      if (!recentlySelectedCompany) return;
      setLoading(true);
      setError(null);
      try {
        const usersRef = collection(db, `companies/${recentlySelectedCompany}/companyUsers`);
        // Assuming you want active users based on the Swift code example
        const q = query(usersRef, where("status", "==", "Active"));
        const querySnapshot = await getDocs(q);
        const usersData = sortCompanyUsersByName(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setCompanyUsers(usersData);
        setTechIds(usersData.map(user => user.userId));
      } catch (err) {
        console.error("Error fetching company users:", err);
        setError("Failed to load company users.");
      } finally {
        setLoading(false);
      }
    };

    fetchCompanyUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany]);

  useEffect(() => {
    const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();

    if (!lowerCaseSearchTerm) {
      setFilteredItems(purchasedItems);
    } else {
      setFilteredItems(
        purchasedItems.filter((item) =>
          purchaseSearchText(item).includes(lowerCaseSearchTerm)
        )
      );
    }
  }, [purchasedItems, searchTerm]);

  const buildPurchaseQuery = (itemsRef, afterDoc = null) => {
    const constraints = [
      where("date", ">=", startOfDay(startViewingDate)),
      where("date", "<=", endOfDay(endViewingDate)),
    ];

    const eligibleTechIds = techIds.filter(Boolean).slice(0, 30);
    if (eligibleTechIds.length > 0) {
      constraints.push(where("techId", "in", eligibleTechIds));
    }

    switch (purchaseFilterOption) {
      case "billable":
        constraints.push(where("billable", "==", true));
        break;
      case "nonBillable":
        constraints.push(where("billable", "==", false));
        break;
      case "billableAndNotInvoiced":
        constraints.push(where("billable", "==", true), where("invoiced", "==", false));
        break;
      case "billableAndInvoiced":
        constraints.push(where("billable", "==", true), where("invoiced", "==", true));
        break;
      default:
        break;
    }

    if (purchaseSortOption === "purchaseDateLast") {
      constraints.push(orderBy("date", "asc"));
    } else if (purchaseSortOption === "priceHigh") {
      constraints.push(orderBy("date", "desc"), orderBy("price", "desc"));
    } else if (purchaseSortOption === "priceLow") {
      constraints.push(orderBy("date", "desc"), orderBy("price", "asc"));
    } else {
      constraints.push(orderBy("date", "desc"));
    }

    if (afterDoc) {
      constraints.push(startAfter(afterDoc));
    }

    // constraints.push(limit(100));
    return query(itemsRef, ...constraints);
  };

  // Effect to fetch purchased items based on filters, dates, and selected company/techs
  useEffect(() => {
    const fetchPurchasedItems = async () => {
      if (!recentlySelectedCompany || !startViewingDate || !endViewingDate) {
        setPurchasedItems([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const itemsRef = collection(db, `companies/${recentlySelectedCompany}/purchasedItems`);
        const querySnapshot = await getDocs(buildPurchaseQuery(itemsRef));
        const itemsData = querySnapshot.docs.map(doc => PurchasedItem.fromFirestore(doc));

        if (querySnapshot.docs.length > 0) {
          setLastDocument(querySnapshot.docs[querySnapshot.docs.length - 1]);
        } else {
          setLastDocument(null);
        }
        setHasMore(querySnapshot.docs.length === 25);
        setPurchasedItems(itemsData);
      } catch (err) {
        console.error("Error fetching purchased items:", err);
        setError("Failed to load purchased items.");
      } finally {
        setLoading(false);
      }
    };

    fetchPurchasedItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany, techIds, startViewingDate, endViewingDate, purchaseFilterOption, purchaseSortOption]);

  // Function to fetch more purchased items (pagination)
  const fetchMorePurchasedItems = async () => {
    if (!recentlySelectedCompany || !startViewingDate || !endViewingDate || !lastDocument) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const itemsRef = collection(db, `companies/${recentlySelectedCompany}/purchasedItems`);
      const querySnapshot = await getDocs(buildPurchaseQuery(itemsRef, lastDocument));
      const newItemsData = querySnapshot.docs.map(doc => PurchasedItem.fromFirestore(doc));

      setPurchasedItems(prevItems => [...prevItems, ...newItemsData]);

      setLastDocument(querySnapshot.docs.length > 0 ? querySnapshot.docs[querySnapshot.docs.length - 1] : null);
      setHasMore(querySnapshot.docs.length === 25);
    } catch (err) {
      console.error("Error fetching more purchased items:", err);
      setError("Failed to load more purchased items.");
    } finally {
      setLoading(false);
    }
  };
  // -----------------------------
  // ✅ Excel download
  // -----------------------------
  const downloadExcel = () => {
    try {
      const rows = filteredItems.map((eq) => {

        return {
          "Purchase": eq?.name || "Purchase",
          "Receipt": eq?.receiptId ? "Linked receipt" : "",
          "Invoice Number": eq?.invoiceNum || "",
          Vendor: eq?.venderName || "",
          Technician: eq?.techName || "",
          Name: eq?.name || "",
          "Database Item": eq?.itemId ? "Linked" : "",
          Category: eq?.category || "Uncategorized",
          Subcategory: eq?.subCategory || "",
          Price: eq?.price || "",
          Quantity: eq?.quantityString || "",
          "Date": eq?.date ? format(eq.date, "yyyy-MM-dd") : "",

          Status: purchaseStatusLabel(eq),
          "Billable (bool)": eq?.billable ?? "",
          "Invoiced (bool)": eq?.invoiced ?? "",
          "Returned (bool)": eq?.returned ?? "",
          Customer: eq?.customerName || "",

          Sku: eq?.sku || "",
          Notes: eq?.notes || "",
          Job: eq?.jobInternalId || eq?.jobName || (eq?.jobId ? "Linked job" : ""),
          "Billing Rate": eq?.billingRate || "",
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Purchases");

      const fileName = `purchases_export_${format(new Date(), "yyyy-MM-dd_HH-mm")}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error("Excel export failed:", e);
      appAlert("Excel export failed. Check console for details.");
    }
  };
  const shortDate = (date) => {
    if (!date) return '';
    let jsDate = date;
    if (date.toDate) {
      jsDate = date.toDate();
    }
    const month = (jsDate.getMonth() + 1).toString().padStart(2, '0');
    const day = jsDate.getDate().toString().padStart(2, '0');
    const year = jsDate.getFullYear().toString().slice(-2);
    return `${month}/${day}/${year}`;
  };

  const summary = useMemo(() => {
    const activeItems = filteredItems.filter((item) => !item.returned);
    const billableItems = activeItems.filter((item) => item.billable);
    const invoicedItems = billableItems.filter((item) => item.invoiced);
    const needsInvoiceItems = billableItems.filter((item) => !item.invoiced);
    const nonBillableItems = activeItems.filter((item) => !item.billable);
    const totalSpentCents = activeItems.reduce((total, item) => total + Number(item.totalAfterTax || 0), 0);
    const billableCostCents = billableItems.reduce((total, item) => total + Number(item.totalAfterTax || 0), 0);
    const billablePriceCents = billableItems.reduce((total, item) => {
      const billingRate = Number(item.billingRate || 0);
      return total + (billingRate > 0 ? billingRate * Number(item.quantity || 0) : Number(item.totalAfterTax || 0));
    }, 0);

    return {
      activeCount: activeItems.length,
      totalSpentCents,
      billableCount: billableItems.length,
      nonBillableCount: nonBillableItems.length,
      invoicedCount: invoicedItems.length,
      needsInvoiceCount: needsInvoiceItems.length,
      billableCostCents,
      billablePriceCents,
    };
  }, [filteredItems]);

  const sortedItems = useMemo(() => {
    const valueForKey = (item, key) => {
      switch (key) {
        case "status":
          return item.billable ? (item.invoiced ? "invoiced" : "needs invoice") : "non-billable";
        case "quantity":
          return item.quantity;
        case "total":
          return item.total;
        case "date":
          return item.date;
        default:
          return item[key];
      }
    };

    return [...filteredItems].sort((left, right) => {
      const result = compareSortValues(
        toSortableValue(valueForKey(left, tableSort.key)),
        toSortableValue(valueForKey(right, tableSort.key))
      );
      return tableSort.direction === "asc" ? result : -result;
    });
  }, [filteredItems, tableSort]);

  const setSort = (key) => {
    setTableSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const columnWidthFor = (columnKey) =>
    Number(columnWidths[columnKey] || purchaseColumnSettings[columnKey]?.width || 140);

  const tableWidth = purchaseTableColumns.reduce((total, column) => total + columnWidthFor(column.key), 0);

  const resetColumnWidths = () => setColumnWidths(defaultPurchaseColumnWidths);

  const startColumnResize = (columnKey, event) => {
    event.preventDefault();
    event.stopPropagation();

    const column = purchaseColumnSettings[columnKey];
    resizingColumnRef.current = {
      columnKey,
      startX: event.clientX,
      startWidth: columnWidthFor(columnKey),
      minWidth: column?.minWidth || 96,
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const ResizableHeader = ({ label, columnKey, sortKey = "", className = "" }) => (
    <th
      className={`relative border-b border-slate-200 px-5 py-3 pr-5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${className}`}
      style={{
        width: `${columnWidthFor(columnKey)}px`,
        minWidth: `${purchaseColumnSettings[columnKey]?.minWidth || 96}px`,
      }}
    >
      {sortKey ? (
        <button
          type="button"
          onClick={() => setSort(sortKey)}
          className="inline-flex min-w-0 max-w-full items-center gap-1 text-left uppercase tracking-wide hover:text-slate-900"
        >
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {tableSort.key === sortKey ? (tableSort.direction === "asc" ? "ASC" : "DESC") : "--"}
          </span>
        </button>
      ) : (
        <span className="block truncate">{label}</span>
      )}
      <button
        type="button"
        aria-label={`Resize ${label || purchaseColumnSettings[columnKey]?.ariaLabel || columnKey} column`}
        onPointerDown={(event) => startColumnResize(columnKey, event)}
        className="absolute inset-y-0 right-0 w-2 cursor-col-resize border-r border-transparent transition hover:border-blue-400 hover:bg-blue-100/60"
      />
    </th>
  );

  const tableCellClass = "whitespace-nowrap overflow-hidden text-ellipsis px-5 py-3 text-sm text-slate-700";

  const toggleTech = (userId) => {
    setTechIds((currentTechIds) =>
      currentTechIds.includes(userId)
        ? currentTechIds.filter((id) => id !== userId)
        : [...currentTechIds, userId]
    );
  };

  const updatePurchaseInList = (purchaseId, updates) => {
    setPurchasedItems((currentItems) =>
      currentItems.map((purchase) =>
        purchase.id === purchaseId ? mergePurchaseUpdate(purchase, updates) : purchase
      )
    );
  };

  const purchaseRef = (purchaseId) =>
    doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchaseId);

  const openActionPurchase = useMemo(
    () => sortedItems.find((purchase) => purchase.id === openActionMenuId) || null,
    [openActionMenuId, sortedItems]
  );

  const closeQuickActions = () => {
    setOpenActionMenuId("");
    setActionMenuPosition(null);
  };

  const toggleQuickActions = (purchaseId, event) => {
    event.stopPropagation();

    if (openActionMenuId === purchaseId) {
      closeQuickActions();
      return;
    }

    const buttonRect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 232;
    const left = Math.min(
      Math.max(8, buttonRect.right - menuWidth),
      window.innerWidth - menuWidth - 8
    );

    setOpenActionMenuId(purchaseId);
    setActionMenuPosition({
      top: buttonRect.bottom + 8,
      left,
    });
  };

  const setQuickUpdate = async (purchase, updateFn, failureMessage) => {
    if (!recentlySelectedCompany || !purchase?.id) return;

    try {
      setQuickUpdatingId(purchase.id);
      await updateFn();
    } catch (err) {
      console.error(err);
      appAlert(failureMessage);
    } finally {
      setQuickUpdatingId("");
    }
  };

  const markPurchaseInvoiced = async (purchase, value) => {
    closeQuickActions();
    await setQuickUpdate(
      purchase,
      async () => {
        const { purchasePayload } = await syncLinkedShoppingPurchase({
          db,
          companyId: recentlySelectedCompany,
          purchasedItemId: purchase.id,
          purchasedItemData: purchase,
          invoiced: value,
          preferPurchasedContext: true,
        });
        updatePurchaseInList(purchase.id, { invoiced: value, ...purchasePayload });
      },
      "Could not update invoice status."
    );
  };

  const openDatabaseItem = (purchase) => {
    if (!purchase?.itemId) return;

    closeQuickActions();
    navigate(`/company/items/detail/${purchase.itemId}`);
  };

  const openNotesEditor = (purchase) => {
    closeQuickActions();
    setNotesSelection({
      purchase,
      notes: purchase.notes || "",
    });
  };

  const saveNotes = async () => {
    const purchase = notesSelection?.purchase;
    if (!purchase) return;

    await setQuickUpdate(
      purchase,
      async () => {
        const notes = notesSelection.notes || "";
        await updateDoc(purchaseRef(purchase.id), { notes });
        updatePurchaseInList(purchase.id, { notes });
        setNotesSelection(null);
      },
      "Could not update the notes on this purchase."
    );
  };

  const loadCustomerOptions = async () => {
    if (customerOptions.length > 0) return customerOptions;
    if (!recentlySelectedCompany) return [];

    try {
      setCustomersLoading(true);
      const customersQuery = query(
        collection(db, "companies", recentlySelectedCompany, "customers"),
        where("active", "==", true),
        orderBy("firstName")
      );
      const querySnapshot = await getDocs(customersQuery);
      const options = querySnapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const name = data.displayAsCompany
          ? data.company || data.companyName || "Customer"
          : `${data.firstName || ""} ${data.lastName || ""}`.trim() || data.company || "Customer";

        return {
          id: data.id || docSnap.id,
          value: data.id || docSnap.id,
          name,
          label: name,
          email: data.email || "",
          phoneNumber: data.phoneNumber || "",
        };
      });

      setCustomerOptions(options);
      return options;
    } catch (err) {
      console.error(err);
      appAlert("Could not load customers.");
      return [];
    } finally {
      setCustomersLoading(false);
    }
  };

  const openCustomerSelector = async (purchase) => {
    closeQuickActions();
    setCustomerSelection({ purchase, selectedCustomer: null });
    const options = await loadCustomerOptions();
    setCustomerSelection({
      purchase,
      selectedCustomer: options.find((option) => option.id === purchase.customerId) || null,
    });
  };

  const saveCustomerSelection = async () => {
    const purchase = customerSelection?.purchase;
    const selectedCustomer = customerSelection?.selectedCustomer || null;
    if (!purchase) return;

    await setQuickUpdate(
      purchase,
      async () => {
        const updates = {
          customerId: selectedCustomer?.id || "",
          customerName: selectedCustomer?.name || "",
        };
        await updateDoc(purchaseRef(purchase.id), updates);
        if (purchase.shoppingListItemId) {
          await syncLinkedShoppingPurchase({
            db,
            companyId: recentlySelectedCompany,
            purchasedItemId: purchase.id,
            shoppingItemId: purchase.shoppingListItemId,
            purchasedItemData: { ...purchase, ...updates },
            preferPurchasedContext: true,
          });
        }
        updatePurchaseInList(purchase.id, updates);
        setCustomerSelection(null);
      },
      "Could not update the customer on this purchase."
    );
  };

  const loadShoppingListItems = async () => {
    if (shoppingListItems.length > 0) return shoppingListItems;
    if (!recentlySelectedCompany) return [];

    try {
      setShoppingListItemsLoading(true);
      const shoppingQuery = query(
        collection(db, "companies", recentlySelectedCompany, "shoppingList"),
        where("purchasedItem", "==", ""),
        orderBy("name")
      );
      const querySnapshot = await getDocs(shoppingQuery);
      const items = querySnapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const firestoreId = docSnap.id;

        return {
          ...data,
          id: firestoreId,
          name: data.name || "",
          description: data.description || "",
          category: data.category || "",
          status: data.status || "",
          purchaserName: data.purchaserName || "",
          quantity: data.quantity || "",
        };
      });

      setShoppingListItems(items);
      return items;
    } catch (err) {
      console.error(err);
      appAlert("Could not load shopping list items.");
      return [];
    } finally {
      setShoppingListItemsLoading(false);
    }
  };

  const openShoppingListSelector = async (purchase) => {
    closeQuickActions();
    setShoppingSelection({ purchase, search: "" });
    await loadShoppingListItems();
  };

  const connectShoppingListItem = async (shoppingListItem) => {
    const purchase = shoppingSelection?.purchase;
    const shoppingListItemId = getFirestoreDocId(shoppingListItem);
    if (!purchase || !shoppingListItemId) return;

    await setQuickUpdate(
      purchase,
      async () => {
        const previousShoppingListItemId = purchase.shoppingListItemId || "";

        const { purchasePayload } = await syncLinkedShoppingPurchase({
          db,
          companyId: recentlySelectedCompany,
          purchasedItemId: purchase.id,
          shoppingItemId: shoppingListItemId,
          purchasedItemData: purchase,
          shoppingItemData: shoppingListItem,
          previousShoppingItemId: previousShoppingListItemId,
          preferPurchasedContext: true,
        });

        updatePurchaseInList(purchase.id, { shoppingListItemId, ...purchasePayload });
        setShoppingListItems((currentItems) =>
          currentItems.filter((item) => getFirestoreDocId(item) !== shoppingListItemId)
        );
        setShoppingSelection(null);
      },
      "Could not connect this shopping list item."
    );
  };

  const clearShoppingListConnection = async () => {
    const purchase = shoppingSelection?.purchase;
    const shoppingListItemId = purchase?.shoppingListItemId || "";
    if (!purchase || !shoppingListItemId) return;

    await setQuickUpdate(
      purchase,
      async () => {
        await updateDoc(purchaseRef(purchase.id), { shoppingListItemId: "" });
        await updateDoc(
          doc(db, "companies", recentlySelectedCompany, "shoppingList", shoppingListItemId),
          { purchasedItem: "" }
        );
        await syncLinkedShoppingPurchase({
          db,
          companyId: recentlySelectedCompany,
          previousShoppingItemId: shoppingListItemId,
        });
        updatePurchaseInList(purchase.id, { shoppingListItemId: "" });
        setShoppingSelection(null);
      },
      "Could not clear this shopping list connection."
    );
  };

  const dateRangeBounds = (startValue, endValue) => {
    const start = new Date(`${startValue}T00:00:00`);
    const end = new Date(`${endValue}T23:59:59.999`);
    return { start, end };
  };

  const loadJobs = async (selection = jobSelection) => {
    if (!recentlySelectedCompany || !selection) return;

    try {
      setJobsLoading(true);
      const { start, end } = dateRangeBounds(selection.startDate, selection.endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        await appAlert("Select a valid job date range.");
        return;
      }

      const jobsQuery = query(
        collection(db, "companies", recentlySelectedCompany, "workOrders"),
        where("dateCreated", ">=", start),
        where("dateCreated", "<=", end),
        orderBy("dateCreated", "desc")
      );

      const querySnapshot = await getDocs(jobsQuery);
      setJobs(
        querySnapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const firestoreId = docSnap.id;

          return {
            ...data,
            id: firestoreId,
          };
        })
      );
    } catch (err) {
      console.error(err);
      appAlert("Could not load jobs for that date range.");
    } finally {
      setJobsLoading(false);
    }
  };

  const openJobSelector = async (purchase) => {
    closeQuickActions();
    const selection = {
      purchase,
      search: "",
      startDate: dateInputValueDaysAgo(30),
      endDate: format(new Date(), "yyyy-MM-dd"),
    };
    setJobSelection(selection);
    await loadJobs(selection);
  };

  const updateJobSelectionField = (field, value) => {
    setJobSelection((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const connectJob = async (job) => {
    const purchase = jobSelection?.purchase;
    const jobDocId = getFirestoreDocId(job);
    if (!purchase || !jobDocId) return;

    await setQuickUpdate(
      purchase,
      async () => {
        const previousJobId = purchase.jobId || purchase.workOrderId || purchase.assignedJobId || "";
        const jobBillable = Boolean(purchase.jobBillable ?? purchase.billable);
        const jobBillingRate = purchase.jobBillingRate || purchase.billingRate || purchase.price || 0;
        const shouldMarkInvoiced = jobBillingIsInvoiced(job.billingStatus);
        const invoiceUpdates = shouldMarkInvoiced ? invoicedPurchaseFieldsForJob(job) : {};
        const invoiceStateUpdates = shouldMarkInvoiced ? invoicedPurchaseStateForJob(job) : {};
        const updates = {
          jobId: jobDocId,
          workOrderId: jobDocId,
          assignedJobId: jobDocId,
          assignedToJob: true,
          assignmentStatus: "assignedToJob",
          billingOwner: "job",
          jobBillingStatus: shouldMarkInvoiced ? "invoiced" : "handledByJob",
          jobBillable,
          jobBillingRate,
          jobInternalId: job.internalId || "",
          jobName: job.type || job.jobName || "",
          status: shouldMarkInvoiced ? "Invoiced" : "Connected to Job",
          ...invoiceUpdates,
        };

        await updateDoc(purchaseRef(purchase.id), updates);
        await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobDocId), {
          purchasedItemsIds: arrayUnion(purchase.id),
        });

        if (previousJobId && previousJobId !== jobDocId) {
          try {
            await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", previousJobId), {
              purchasedItemsIds: arrayRemove(purchase.id),
            });
          } catch (err) {
            console.warn("Could not remove purchase from previous job link:", err);
          }
        }

        if (purchase.shoppingListItemId) {
          await syncLinkedShoppingPurchase({
            db,
            companyId: recentlySelectedCompany,
            purchasedItemId: purchase.id,
            shoppingItemId: purchase.shoppingListItemId,
            purchasedItemData: { ...purchase, ...updates },
            preferPurchasedContext: true,
          });
        }

        updatePurchaseInList(purchase.id, { ...updates, ...invoiceStateUpdates });
        setJobSelection(null);
      },
      "Could not connect this purchase to the selected job."
    );
  };

  const filteredShoppingListItems = useMemo(() => {
    const search = (shoppingSelection?.search || "").toLowerCase().trim();
    if (!search) return shoppingListItems;

    return shoppingListItems.filter((item) =>
      [
        item.name,
        item.description,
        item.category,
        item.status,
        item.purchaserName,
        item.quantity,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [shoppingListItems, shoppingSelection]);

  const filteredJobs = useMemo(() => {
    const search = (jobSelection?.search || "").toLowerCase().trim();
    if (!search) return jobs;

    return jobs.filter((job) =>
      [
        job.internalId,
        job.customerName,
        job.description,
        job.operationStatus,
        job.billingStatus,
        job.type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [jobs, jobSelection]);

  const FilterModal = () => (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/40 p-3 sm:p-4">
      <div className="mx-auto my-4 w-full max-w-6xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Filter & Sort</h3>
            <p className="text-sm text-gray-500">Match the iOS purchase filters and date controls.</p>
          </div>
          <button className="rounded-md px-3 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-100" onClick={() => setShowFilterModal(false)}>
            Close
          </button>
        </div>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-gray-700">
            Start Date
            <input
              type="date"
              value={format(startViewingDate, "yyyy-MM-dd")}
              onChange={(event) => setStartViewingDate(startOfDay(new Date(`${event.target.value}T00:00:00`)))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            End Date
            <input
              type="date"
              value={format(endViewingDate, "yyyy-MM-dd")}
              onChange={(event) => setEndViewingDate(endOfDay(new Date(`${event.target.value}T00:00:00`)))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            Filter
            <select
              value={purchaseFilterOption}
              onChange={(event) => setPurchaseFilterOption(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            >
              {purchaseFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-700">
            Sort
            <select
              value={purchaseSortOption}
              onChange={(event) => setPurchaseSortOption(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            >
              {purchaseSorts.map((sort) => (
                <option key={sort.value} value={sort.value}>{sort.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="border-t border-gray-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-gray-700">Technicians</h4>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                onClick={() => setTechIds(companyUsers.map((user) => user.userId).filter(Boolean))}
              >
                Select all
              </button>
              <button
                type="button"
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                onClick={() => setTechIds([])}
              >
                Deselect all
              </button>
            </div>
          </div>
          <div className="mt-3 grid max-h-[54vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {companyUsers.map((user) => (
              <label key={user.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={techIds.includes(user.userId)}
                  onChange={() => toggleTech(user.userId)}
                />
                <span className="truncate">{user.userName || user.name || user.email || user.userId}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company purchases</p>
              <h2 className="mt-1 text-3xl font-bold text-slate-950">Purchases</h2>
              <p className="mt-1 text-sm text-slate-500">Review purchased items, receipt links, billing status, and job connections.</p>
            </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Link to={'/company/purchased-items/createNew'}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create New Receipt
            </Link>
            <Link to={'/company/receipts'}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              View Receipts
            </Link>
            <Link
              to="/company/shopping-purchase-reconciliation"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-100"
            >
              <ArrowsRightLeftIcon className="h-4 w-4" />
              Reconcile
            </Link>
          </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 lg:grid-cols-[minmax(280px,1fr)_auto_auto] lg:items-center">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              type="text"
              placeholder="Search customer, SKU, invoice, tech, vendor, job, or receipt..."
            />
            <button onClick={() => setShowFilterModal(true)}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Filter & Sort
            </button>
            <button
              type="button"
              onClick={resetColumnWidths}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <ArrowsPointingInIcon className="h-4 w-4" />
              Reset widths
            </button>
          </div>
          <div className="grid gap-3 border-b border-slate-200 p-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Spent</p>
              <p className="mt-1 text-xl font-bold text-slate-950">{moneyFromCents(summary.totalSpentCents)}</p>
              <p className="text-sm text-slate-500">{summary.activeCount} active item(s)</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billable Cost</p>
              <p className="mt-1 text-xl font-bold text-slate-950">{moneyFromCents(summary.billableCostCents)}</p>
              <p className="text-sm text-slate-500">{summary.billableCount} billable item(s)</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billable Price</p>
              <p className="mt-1 text-xl font-bold text-slate-950">{moneyFromCents(summary.billablePriceCents)}</p>
              <p className="text-sm text-slate-500">Uses billing rate when set</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice Status</p>
              <p className="mt-1 text-xl font-bold text-slate-950">{summary.needsInvoiceCount}</p>
              <p className="text-sm text-slate-500">{summary.invoicedCount} invoiced, {summary.nonBillableCount} non-billable</p>
            </div>
          </div>
          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>Showing {sortedItems.length} of {purchasedItems.length} purchased item{purchasedItems.length === 1 ? "" : "s"}</div>
            <div>{format(startViewingDate, "MM/dd/yy")} to {format(endViewingDate, "MM/dd/yy")}</div>
          </div>
          <div className="purchase-list-section">
            {loading && <p className="px-5 py-4 text-sm text-slate-500">Loading...</p>}
            {error && <p className="text-red-500">{error}</p>}
            <div className="overflow-x-auto border-t border-slate-200">
              {!loading && !error && (
                <table className="min-w-full table-fixed bg-white" style={{ width: `${tableWidth}px` }}>
                  <colgroup>
                    {purchaseTableColumns.map((column) => (
                      <col key={column.key} style={{ width: `${columnWidthFor(column.key)}px` }} />
                    ))}
                  </colgroup>
                  <thead className="bg-slate-50">
                    <tr>
                      {purchaseTableColumns.map((column) => (
                        <ResizableHeader
                          key={column.key}
                          label={column.label}
                          columnKey={column.key}
                          sortKey={column.sortKey}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sortedItems.map(item => (
                      <tr key={item.id} className="cursor-pointer transition-colors hover:bg-slate-50"
                        onClick={() => navigate(`/company/purchased-items/detail/${item.id}`)}
                      >
                        <td className={tableCellClass} onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(event) => toggleQuickActions(item.id, event)}
                            disabled={quickUpdatingId === item.id}
                            aria-haspopup="menu"
                            aria-expanded={openActionMenuId === item.id}
                            aria-label="Open quick actions"
                            title="Open quick actions"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <EllipsisVerticalIcon className="h-5 w-5" />
                          </button>
                        </td>
                        <td className={tableCellClass}>
                          <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${purchaseStatusClassName(item)}`}>
                            <span className="truncate">{purchaseStatusLabel(item)}</span>
                          </span>
                        </td>
                        <td className={tableCellClass}>
                          {item.name}
                        </td>
                        <td className={tableCellClass} onClick={(event) => event.stopPropagation()}>
                          {item.itemId ? (
                            <Link
                              to={`/company/items/detail/${item.itemId}`}
                              className="font-semibold text-blue-600 hover:text-blue-800"
                            >
                              Open
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className={tableCellClass}>
                          {item.category || "Uncategorized"}
                        </td>
                        <td className={tableCellClass}>
                          {item.invoiceNum || 'N/A'}
                        </td>
                        <td className={tableCellClass}>
                          {shortDate(item.date)}
                        </td>
                        <td className={tableCellClass}>
                          {item.sku}
                        </td>

                        <td className={tableCellClass}>
                          {`$${(item.price / 100).toFixed(2)}`}
                        </td>
                        <td className={tableCellClass}>
                          {item.quantityString}
                        </td>
                        <td className={tableCellClass}>
                          {`$${(item.total / 100).toFixed(2)}`}
                        </td>
                        <td className={tableCellClass}>
                          {item.techName}
                        </td>
                        <td className={tableCellClass}>
                          {item.customerName}
                        </td>
                        <td className={tableCellClass}>
                          {
                            purchaseIsConnectedToJob(item) ? (
                              <span className="inline-flex max-w-full items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                                <span className="truncate">{item.jobInternalId || item.jobName || "Job"}</span>
                              </span>
                            ) : null
                          }
                        </td>
                        <td className={tableCellClass}>
                          {item.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && !error && filteredItems.length === 0 ? (
                <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No purchases match the current filters.
                </div>
              ) : null}
            </div>
          </div>
        </section>

      <div className="flex flex-wrap justify-end gap-2 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <Link to={'/company/items'}
          className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-100"
        >
          See Database
        </Link>
        <button
          type="button"
          onClick={downloadExcel}
          className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
        >
          Download Excel
        </button>
        {hasMore ? (
          <button
            type="button"
            onClick={fetchMorePurchasedItems}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Load More
          </button>
        ) : null}
      </div>
      {openActionPurchase && actionMenuPosition && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close quick actions"
            onClick={closeQuickActions}
          />
          <div
            role="menu"
            style={{
              top: actionMenuPosition.top,
              left: actionMenuPosition.left,
            }}
            className="fixed z-50 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          >
            <QuickActionMenuItem
              label={openActionPurchase.invoiced ? "Mark not invoiced" : "Mark as invoiced"}
              icon={CheckCircleIcon}
              tone="green"
              onClick={() => markPurchaseInvoiced(openActionPurchase, !openActionPurchase.invoiced)}
            />
            <QuickActionMenuItem
              label="Edit notes"
              icon={PencilSquareIcon}
              onClick={() => openNotesEditor(openActionPurchase)}
            />
            {openActionPurchase.itemId ? (
              <QuickActionMenuItem
                label="Open database item"
                icon={CircleStackIcon}
                onClick={() => openDatabaseItem(openActionPurchase)}
              />
            ) : null}
            <QuickActionMenuItem
              label="Select customer"
              icon={UserCircleIcon}
              onClick={() => openCustomerSelector(openActionPurchase)}
            />
            <QuickActionMenuItem
              label="Connect shopping item"
              icon={ShoppingCartIcon}
              tone="blue"
              onClick={() => openShoppingListSelector(openActionPurchase)}
            />
            <QuickActionMenuItem
              label="Connect job"
              icon={BriefcaseIcon}
              tone="blue"
              onClick={() => openJobSelector(openActionPurchase)}
            />
          </div>
        </>
      )}
      {notesSelection && (
        <ModalShell
          title="Edit Notes"
          description={notesSelection.purchase?.name || "Update notes for this purchased item."}
          onClose={() => setNotesSelection(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNotesSelection(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveNotes}
                disabled={quickUpdatingId === notesSelection.purchase?.id}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {quickUpdatingId === notesSelection.purchase?.id ? "Saving..." : "Save Notes"}
              </button>
            </div>
          }
        >
          <textarea
            value={notesSelection.notes}
            onChange={(event) =>
              setNotesSelection((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            rows={7}
            className="w-full rounded-lg border border-gray-300 p-3 text-sm text-gray-800 focus:border-blue-500 focus:ring-blue-500"
            placeholder="Add notes..."
          />
        </ModalShell>
      )}
      {customerSelection && (
        <ModalShell
          title="Select Customer"
          description={customerSelection.purchase?.name || "Choose who this purchase belongs to."}
          onClose={() => setCustomerSelection(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomerSelection(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCustomerSelection}
                disabled={customersLoading || quickUpdatingId === customerSelection.purchase?.id}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {quickUpdatingId === customerSelection.purchase?.id ? "Saving..." : "Save Customer"}
              </button>
            </div>
          }
        >
          <label className="block text-sm font-semibold text-gray-700">
            Customer
            <div className="mt-2">
              <Select
                value={customerSelection.selectedCustomer}
                options={customerOptions}
                isLoading={customersLoading}
                onChange={(option) =>
                  setCustomerSelection((current) => ({
                    ...current,
                    selectedCustomer: option,
                  }))
                }
                isClearable
                isSearchable
                maxMenuHeight={560}
                menuPlacement="auto"
                menuPosition="fixed"
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                placeholder="Select a customer"
                styles={customerSelectStyles}
              />
            </div>
          </label>
        </ModalShell>
      )}
      {shoppingSelection && (
        <ModalShell
          title="Connect Shopping List Item"
          description={shoppingSelection.purchase?.name || "Choose an unconnected shopping list item."}
          onClose={() => setShoppingSelection(null)}
          footer={
            shoppingSelection.purchase?.shoppingListItemId ? (
              <div className="flex justify-between gap-2">
                <p className="text-sm text-gray-500">
                  Current link: {shoppingSelection.purchase.shoppingListItemId}
                </p>
                <button
                  type="button"
                  onClick={clearShoppingListConnection}
                  disabled={quickUpdatingId === shoppingSelection.purchase?.id}
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear Connection
                </button>
              </div>
            ) : null
          }
        >
          <input
            type="text"
            value={shoppingSelection.search}
            onChange={(event) =>
              setShoppingSelection((current) => ({
                ...current,
                search: event.target.value,
              }))
            }
            placeholder="Search shopping list items..."
            className="mb-4 w-full rounded-lg border border-gray-300 p-3 focus:border-blue-500 focus:ring-blue-500"
          />

          {shoppingListItemsLoading ? (
            <div className="py-10 text-center text-gray-500">Loading shopping list items...</div>
          ) : filteredShoppingListItems.length > 0 ? (
            <div className="max-h-[420px] space-y-3 overflow-y-auto">
              {filteredShoppingListItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800">{item.name || "Unnamed Item"}</p>
                    <p className="mt-1 text-sm text-gray-500">{item.description || "No description"}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>{item.category || "Uncategorized"}</span>
                      <span>{item.status || "No status"}</span>
                      <span>{item.purchaserName || "No purchaser"}</span>
                      <span>Qty {item.quantity || "0"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => connectShoppingListItem(item)}
                    disabled={quickUpdatingId === shoppingSelection.purchase?.id}
                    className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
              No unconnected shopping list items found.
            </div>
          )}
        </ModalShell>
      )}
      {jobSelection && (
        <ModalShell
          title="Connect Job"
          description={jobSelection.purchase?.name || "Load jobs by date range, then choose one."}
          onClose={() => setJobSelection(null)}
        >
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="text-xs font-bold text-gray-600">
              Start Date
              <input
                type="date"
                value={jobSelection.startDate}
                onChange={(event) => updateJobSelectionField("startDate", event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal text-gray-800"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              End Date
              <input
                type="date"
                value={jobSelection.endDate}
                onChange={(event) => updateJobSelectionField("endDate", event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal text-gray-800"
              />
            </label>
            <label className="text-xs font-bold text-gray-600 md:col-span-2">
              Search
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={jobSelection.search}
                  onChange={(event) => updateJobSelectionField("search", event.target.value)}
                  placeholder="Search jobs..."
                  className="w-full rounded-lg border border-gray-300 p-3 font-normal text-gray-800"
                />
                <button
                  type="button"
                  onClick={() => loadJobs(jobSelection)}
                  disabled={jobsLoading}
                  className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                >
                  {jobsLoading ? "Loading" : "Load"}
                </button>
              </div>
            </label>
          </div>

          {jobsLoading ? (
            <div className="py-10 text-center text-gray-500">Loading jobs...</div>
          ) : filteredJobs.length > 0 ? (
            <div className="max-h-[460px] space-y-3 overflow-y-auto">
              {filteredJobs.map((job) => {
                const jobDate = job.dateCreated?.toDate ? job.dateCreated.toDate() : job.dateCreated;
                const dateLabel = jobDate ? format(new Date(jobDate), "MMM d, yyyy") : "No date";
                const jobDocId = getFirestoreDocId(job);
                const isSelected = (jobSelection.purchase?.jobId || jobSelection.purchase?.workOrderId) === jobDocId;

                return (
                  <div
                    key={jobDocId}
                    className={[
                      "flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:justify-between",
                      isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-gray-50",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-800">{job.internalId || job.type || "Job"}</p>
                        <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                          {job.operationStatus || "Status"}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                          {job.billingStatus || "Billing"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {job.customerName || "No customer"} - {dateLabel}
                      </p>
                      <p className="mt-2 max-w-2xl truncate text-xs text-gray-500">
                        {job.description || "No description"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => connectJob(job)}
                      disabled={isSelected || quickUpdatingId === jobSelection.purchase?.id}
                      className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSelected ? "Selected" : "Select"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
              No jobs found for this date range.
            </div>
          )}
        </ModalShell>
      )}
      {showFilterModal && <FilterModal />}
      </div>
    </div>
  );
};

export default PurchaseListView;
