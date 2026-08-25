import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDocs, Timestamp, updateDoc } from "firebase/firestore";
import { format } from "date-fns";
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { appAlert } from "../../../utils/appDialog";
import { syncLinkedShoppingPurchase } from "../../../utils/shoppingPurchaseSync";

const rowFilters = [
  { value: "attention", label: "Needs Review" },
  { value: "all", label: "All Rows" },
  { value: "connected", label: "Connected" },
  { value: "needsSync", label: "Needs Sync" },
  { value: "suggested", label: "Suggested" },
  { value: "shoppingOnly", label: "Shopping Only" },
  { value: "purchaseOnly", label: "Purchased Only" },
  { value: "conflict", label: "Conflicts" },
];

const matchFilters = [
  { value: "all", label: "All Match Types" },
  { value: "explicit", label: "Already Linked" },
  { value: "sameRecordId", label: "Same Record" },
  { value: "sameDatabaseItem", label: "Same Database Item" },
  { value: "none", label: "No Match" },
];

const compactString = (value) => String(value || "").trim();

const lower = (value) => compactString(value).toLowerCase();

const timestampToDate = (value) => {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const formatDate = (value) => {
  const date = timestampToDate(value);
  return date ? format(date, "MM/dd/yyyy") : "";
};

const moneyFromCents = (value) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount / 100);
};

const normalizeDatabaseItemId = (data = {}) =>
  compactString(
    data.itemId ||
    data.dbItemId ||
    data.dataBaseItemId ||
    data.databaseItemId ||
    data.genericItemId ||
    data.sourceDataBaseItemId
  );

const normalizeDatabaseItemName = (data = {}) =>
  compactString(
    data.dbItemName ||
    data.dataBaseItemName ||
    data.databaseItemName ||
    data.itemName ||
    data.genericItemName ||
    data.sourceDataBaseItemName ||
    data.catalogItemName
  );

const buildSearchText = (parts) =>
  parts.filter(Boolean).join(" ").toLowerCase();

const buildDatabaseItemMap = (docs) =>
  docs.reduce((map, docSnap) => {
    const data = docSnap.data();
    const id = data.id || docSnap.id;
    if (!id) return map;

    map.set(id, {
      ...data,
      id,
      name: data.name || normalizeDatabaseItemName(data) || "Database Item",
      category: data.category || "",
      subCategory: data.subCategory || "",
      sku: data.sku || data.SKU || "",
      UOM: data.UOM || data.uom || "",
      storeName: data.storeName || "",
    });

    return map;
  }, new Map());

const databaseItemDisplayName = (item = {}) =>
  item.dataBaseItemName ||
  item.databaseItem?.name ||
  (item.dataBaseItemId ? "Database item linked" : "");

const databaseItemDetails = (item = {}) =>
  [
    item.databaseItem?.category,
    item.databaseItem?.subCategory,
    item.databaseItem?.sku ? `SKU ${item.databaseItem.sku}` : "",
    item.databaseItem?.UOM ? `UOM ${item.databaseItem.UOM}` : "",
    item.databaseItem?.storeName,
  ].filter(Boolean).join(" / ");

const enrichWithDatabaseItems = (items, databaseItemsById) =>
  items.map((item) => {
    const databaseItem = databaseItemsById.get(item.dataBaseItemId) || null;
    const dataBaseItemName =
      item.dataBaseItemName ||
      databaseItem?.name ||
      "";

    return {
      ...item,
      databaseItem,
      dataBaseItemName,
      searchText: buildSearchText([
        item.searchText,
        dataBaseItemName,
        databaseItem?.category,
        databaseItem?.subCategory,
        databaseItem?.sku,
      ]),
    };
  });

const normalizeShoppingItem = (docSnap) => {
  const data = docSnap.data();
  const id = docSnap.id;
  const dataBaseItemId = normalizeDatabaseItemId(data);
  const purchasedItemId = compactString(
    data.purchasedItem ||
    data.purchasedItemId ||
    data.sourcePurchasedItemId ||
    data.installedPurchasedItemId
  );

  const item = {
    ...data,
    id,
    type: "shopping",
    name: data.name || data.dbItemName || data.itemName || "Shopping Item",
    description: data.description || data.notes || "",
    category: data.category || "Uncategorized",
    subCategory: data.subCategory || "",
    status: data.status || "",
    quantity: data.quantity || data.quantityString || "",
    purchaserName: data.purchaserName || data.userName || "",
    customerName: data.customerName || "",
    customerId: data.customerId || data.customerID || "",
    jobId: data.jobId || data.workOrderId || "",
    jobName: data.jobName || data.jobInternalId || "",
    dataBaseItemId,
    dataBaseItemName: normalizeDatabaseItemName(data),
    purchasedItemId,
    dateLabel: formatDate(data.datePurchased || data.purchasedAt || data.updatedAt || data.createdAt),
  };

  return {
    ...item,
    searchText: buildSearchText([
      item.id,
      item.name,
      item.description,
      item.category,
      item.subCategory,
      item.status,
      item.quantity,
      item.purchaserName,
      item.customerName,
      item.customerId,
      item.jobId,
      item.jobName,
      item.dataBaseItemId,
      item.dataBaseItemName,
      item.purchasedItemId,
    ]),
  };
};

const normalizePurchasedItem = (docSnap) => {
  const data = docSnap.data();
  const id = docSnap.id;
  const dataBaseItemId = normalizeDatabaseItemId(data);
  const shoppingListItemId = compactString(
    data.shoppingListItemId ||
    data.sourceShoppingListItemId ||
    data.installedShoppingListItemId
  );
  const price = Number(data.price || 0);
  const quantity = Number.parseFloat(data.quantityString || data.quantity || "0") || 0;

  const item = {
    ...data,
    id,
    type: "purchase",
    name: data.name || data.dbItemName || data.itemName || "Purchased Item",
    description: data.description || data.notes || "",
    category: data.category || "Uncategorized",
    subCategory: data.subCategory || "",
    quantity: data.quantityString || data.quantity || "",
    techName: data.techName || data.purchaserName || data.userName || "",
    customerName: data.customerName || "",
    customerId: data.customerId || data.customerID || "",
    jobId: data.jobId || data.workOrderId || data.assignedJobId || "",
    jobName: data.jobName || data.jobInternalId || "",
    invoiceNum: data.invoiceNum || "",
    receiptId: data.receiptId || "",
    dataBaseItemId,
    dataBaseItemName: normalizeDatabaseItemName(data),
    shoppingListItemId,
    dateLabel: formatDate(data.date || data.datePurchased || data.purchasedAt || data.createdAt),
    totalLabel: moneyFromCents(data.totalAfterTax || data.total || price * quantity),
  };

  return {
    ...item,
    searchText: buildSearchText([
      item.id,
      item.name,
      item.description,
      item.category,
      item.subCategory,
      item.quantity,
      item.techName,
      item.customerName,
      item.customerId,
      item.jobId,
      item.jobName,
      item.invoiceNum,
      item.receiptId,
      item.dataBaseItemId,
      item.dataBaseItemName,
      item.shoppingListItemId,
    ]),
  };
};

const getPairKey = (shopping, purchase) =>
  `${shopping?.id || "none"}:${purchase?.id || "none"}`;

const buildReconciliationRows = (shoppingItems, purchasedItems) => {
  const purchaseById = new Map(purchasedItems.map((item) => [item.id, item]));
  const purchaseLinkedByShoppingId = new Map();
  const shoppingLinkedByPurchaseId = new Map();

  purchasedItems.forEach((purchase) => {
    if (purchase.shoppingListItemId && !purchaseLinkedByShoppingId.has(purchase.shoppingListItemId)) {
      purchaseLinkedByShoppingId.set(purchase.shoppingListItemId, purchase);
    }
  });

  shoppingItems.forEach((shopping) => {
    if (shopping.purchasedItemId && !shoppingLinkedByPurchaseId.has(shopping.purchasedItemId)) {
      shoppingLinkedByPurchaseId.set(shopping.purchasedItemId, shopping);
    }
  });

  const rows = [];
  const usedShoppingIds = new Set();
  const usedPurchaseIds = new Set();
  const pushedKeys = new Set();

  const pushRow = (row) => {
    const key = getPairKey(row.shopping, row.purchase);
    if (pushedKeys.has(key)) return;
    rows.push({ ...row, key });
    pushedKeys.add(key);
    if (row.shopping?.id) usedShoppingIds.add(row.shopping.id);
    if (row.purchase?.id) usedPurchaseIds.add(row.purchase.id);
  };

  shoppingItems.forEach((shopping) => {
    const purchaseFromShopping = shopping.purchasedItemId
      ? purchaseById.get(shopping.purchasedItemId)
      : null;
    const purchaseFromPurchase = purchaseLinkedByShoppingId.get(shopping.id) || null;
    const purchase = purchaseFromShopping || purchaseFromPurchase;

    if (!purchase) return;

    const shoppingPointsToPurchase = shopping.purchasedItemId === purchase.id;
    const purchasePointsToShopping = purchase.shoppingListItemId === shopping.id;
    const purchasePointsElsewhere = Boolean(
      purchase.shoppingListItemId &&
      purchase.shoppingListItemId !== shopping.id
    );
    const shoppingPointsElsewhere = Boolean(
      shopping.purchasedItemId &&
      shopping.purchasedItemId !== purchase.id
    );

    let status = "connected";
    let statusLabel = "Connected";
    let matchType = "explicit";

    if (purchasePointsElsewhere || shoppingPointsElsewhere) {
      status = "conflict";
      statusLabel = "Conflict";
    } else if (!shoppingPointsToPurchase || !purchasePointsToShopping) {
      status = "needsSync";
      statusLabel = "Needs Sync";
    }

    pushRow({
      shopping,
      purchase,
      status,
      statusLabel,
      matchType,
      reason: "Linked",
    });
  });

  const unpairedPurchases = () =>
    purchasedItems.filter((purchase) => !usedPurchaseIds.has(purchase.id));

  shoppingItems.forEach((shopping) => {
    if (usedShoppingIds.has(shopping.id)) return;

    const sameRecordIdPurchase = purchaseById.get(shopping.id);
    if (sameRecordIdPurchase && !usedPurchaseIds.has(sameRecordIdPurchase.id)) {
      pushRow({
        shopping,
        purchase: sameRecordIdPurchase,
        status: "suggested",
        statusLabel: "Suggested",
        matchType: "sameRecordId",
        reason: "Same Record",
      });
      return;
    }

    if (shopping.dataBaseItemId) {
      const candidates = unpairedPurchases().filter(
        (purchase) => purchase.dataBaseItemId === shopping.dataBaseItemId
      );
      if (candidates.length === 1) {
        pushRow({
          shopping,
          purchase: candidates[0],
          status: "suggested",
          statusLabel: "Suggested",
          matchType: "sameDatabaseItem",
          reason: "Same Database Item",
        });
        return;
      }
    }

    if (shopping.purchasedItemId) {
      pushRow({
        shopping,
        purchase: null,
        status: "conflict",
        statusLabel: "Conflict",
        matchType: "explicit",
        reason: "Missing Purchased Item",
      });
      return;
    }

    pushRow({
      shopping,
      purchase: null,
      status: "shoppingOnly",
      statusLabel: "Shopping Only",
      matchType: "none",
      reason: "No Match",
    });
  });

  purchasedItems.forEach((purchase) => {
    if (usedPurchaseIds.has(purchase.id)) return;

    if (purchase.shoppingListItemId) {
      pushRow({
        shopping: null,
        purchase,
        status: "conflict",
        statusLabel: "Conflict",
        matchType: "explicit",
        reason: "Missing Shopping Item",
      });
      return;
    }

    pushRow({
      shopping: null,
      purchase,
      status: "purchaseOnly",
      statusLabel: "Purchased Only",
      matchType: "none",
      reason: "No Match",
    });
  });

  const statusOrder = {
    conflict: 0,
    needsSync: 1,
    suggested: 2,
    shoppingOnly: 3,
    purchaseOnly: 4,
    connected: 5,
  };

  return rows.sort((left, right) => {
    const statusDifference = (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99);
    if (statusDifference !== 0) return statusDifference;

    const leftName = left.shopping?.name || left.purchase?.name || "";
    const rightName = right.shopping?.name || right.purchase?.name || "";
    return leftName.localeCompare(rightName);
  });
};

const statusTone = (status) => {
  switch (status) {
    case "connected":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "suggested":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "needsSync":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "conflict":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
};

const RecordMini = ({ item, type }) => {
  const isShopping = type === "shopping";
  const emptyTitle = isShopping ? "No shopping item" : "No purchased item";
  const Icon = isShopping ? ShoppingCartIcon : ShoppingBagIcon;

  if (!item) {
    return (
      <div className="flex min-h-[126px] items-center justify-center border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-400">
        {emptyTitle}
      </div>
    );
  }

  const detailPath = isShopping
    ? `/company/shopping-list/detail/${item.id}`
    : `/company/purchased-items/detail/${item.id}`;
  const personLabel = isShopping ? item.purchaserName : item.techName;
  const databaseItemPath = item.dataBaseItemId ? `/company/items/detail/${item.dataBaseItemId}` : "";
  const databaseLabel = databaseItemDisplayName(item);
  const databaseDetails = databaseItemDetails(item);
  const hasCustomer = Boolean(item.customerName || item.customerId);
  const hasJob = Boolean(item.jobName || item.jobId);

  return (
    <div className="min-h-[126px] border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <Link to={detailPath} className="line-clamp-2 font-bold text-slate-900 hover:text-blue-700">
            {item.name || (isShopping ? "Shopping Item" : "Purchased Item")}
          </Link>
          <p className="mt-1 line-clamp-2 text-sm text-slate-500">
            {item.description || item.category || "No description"}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="font-bold uppercase text-slate-400">Database Name</p>
          {databaseItemPath ? (
            <Link to={databaseItemPath} className="truncate font-bold text-blue-700 hover:text-blue-900">
              {databaseLabel}
            </Link>
          ) : (
            <p className="truncate">{databaseLabel || "Not linked"}</p>
          )}
          {databaseDetails ? <p className="mt-0.5 truncate text-[11px] text-slate-400">{databaseDetails}</p> : null}
        </div>
        <div className="min-w-0">
          <p className="font-bold uppercase text-slate-400">Customer</p>
          <p className="truncate">{hasCustomer ? item.customerName || "Customer linked" : "Not connected"}</p>
        </div>
        <div className="min-w-0">
          <p className="font-bold uppercase text-slate-400">Job</p>
          {hasJob && item.jobId ? (
            <Link to={`/company/jobs/detail/${item.jobId}`} className="truncate font-bold text-blue-700 hover:text-blue-900">
              {item.jobName || "Job linked"}
            </Link>
          ) : (
            <p className="truncate">{hasJob ? item.jobName : "Not connected"}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-bold uppercase text-slate-400">{isShopping ? "Purchaser" : "Tech"}</p>
          <p className="truncate">{personLabel || "-"}</p>
        </div>
      </div>

      {!isShopping ? (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
          <span>{item.invoiceNum ? `Invoice ${item.invoiceNum}` : "No invoice"}</span>
          <span>{item.totalLabel}</span>
          <span>{item.dateLabel || "No date"}</span>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
          <span>{item.status || "No status"}</span>
          <span>{item.quantity ? `Qty ${item.quantity}` : "No quantity"}</span>
          {item.dateLabel ? <span>{item.dateLabel}</span> : null}
        </div>
      )}
    </div>
  );
};

const EmptySideAction = ({ children, onClick, disabled, icon: Icon }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
  >
    <Icon className="h-4 w-4" />
    {children}
  </button>
);

const SelectionModal = ({
  title,
  search,
  onSearchChange,
  items,
  type,
  onSelect,
  onClose,
  isUpdating,
  anchorItem,
}) => {
  const isShoppingPicker = type === "shopping";
  const anchorItemId = anchorItem?.dataBaseItemId || "";
  const filteredItems = items
    .filter((item) => {
      if (!search) return true;
      return item.searchText.includes(search);
    })
    .sort((left, right) => {
      const leftScore =
        (anchorItemId && left.dataBaseItemId === anchorItemId ? 0 : 1) +
        (left.shoppingListItemId || left.purchasedItemId ? 1 : 0);
      const rightScore =
        (anchorItemId && right.dataBaseItemId === anchorItemId ? 0 : 1) +
        (right.shoppingListItemId || right.purchasedItemId ? 1 : 0);
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 80);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4">
      <div className="mx-auto my-8 w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-500">{anchorItem?.name || "Select a row"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-200 p-5">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => onSearchChange(lower(event.target.value))}
              placeholder={isShoppingPicker ? "Search shopping list items..." : "Search purchased items..."}
              className="w-full rounded-md border border-slate-300 py-3 pl-10 pr-3 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
          {filteredItems.length ? (
            filteredItems.map((item) => {
              const connectedId = isShoppingPicker ? item.purchasedItemId : item.shoppingListItemId;
              const hasSameItemId = anchorItemId && item.dataBaseItemId === anchorItemId;
              const databaseItemPath = item.dataBaseItemId ? `/company/items/detail/${item.dataBaseItemId}` : "";
              const databaseLabel = databaseItemDisplayName(item);
              const databaseDetails = databaseItemDetails(item);
              const jobLabel = item.jobName || (item.jobId ? "Job linked" : "");
              const customerLabel = item.customerName || (item.customerId ? "Customer linked" : "");

              return (
                <div key={item.id} className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-slate-900">{item.name}</p>
                      {hasSameItemId ? (
                        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                          Same Database Item
                        </span>
                      ) : null}
                      {connectedId ? (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                          Linked
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.description || item.category || "-"}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                      {databaseItemPath ? (
                        <Link to={databaseItemPath} className="font-bold text-blue-700 hover:text-blue-900">
                          Database: {databaseLabel}
                        </Link>
                      ) : (
                        <span>{databaseLabel || "No database item"}</span>
                      )}
                      {databaseDetails ? <span>{databaseDetails}</span> : null}
                      <span>{customerLabel || "No customer"}</span>
                      <span>{jobLabel || "No job"}</span>
                      <span>{isShoppingPicker ? item.status || "-" : item.dateLabel || "-"}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    disabled={isUpdating}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LinkIcon className="h-4 w-4" />
                    Select
                  </button>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">
              No rows match the current search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ShoppingPurchaseReconciliation = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const [shoppingItems, setShoppingItems] = useState([]);
  const [purchasedItems, setPurchasedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState("");
  const [search, setSearch] = useState("");
  const [rowFilter, setRowFilter] = useState("attention");
  const [matchFilter, setMatchFilter] = useState("all");
  const [selection, setSelection] = useState(null);

  const loadData = async () => {
    if (!recentlySelectedCompany) {
      setShoppingItems([]);
      setPurchasedItems([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [shoppingSnap, purchasedSnap, databaseSnap] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "shoppingList")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "purchasedItems")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase")),
      ]);
      const databaseItemsById = buildDatabaseItemMap(databaseSnap.docs);
      const normalizedShoppingItems = shoppingSnap.docs.map(normalizeShoppingItem);
      const normalizedPurchasedItems = purchasedSnap.docs.map(normalizePurchasedItem);

      setShoppingItems(enrichWithDatabaseItems(normalizedShoppingItems, databaseItemsById));
      setPurchasedItems(enrichWithDatabaseItems(normalizedPurchasedItems, databaseItemsById));
    } catch (error) {
      console.error(error);
      appAlert("Could not load shopping and purchased items.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany]);

  const rows = useMemo(
    () => buildReconciliationRows(shoppingItems, purchasedItems),
    [shoppingItems, purchasedItems]
  );

  const summary = useMemo(
    () => rows.reduce((result, row) => {
      result.total += 1;
      result[row.status] = (result[row.status] || 0) + 1;
      if (["conflict", "needsSync", "suggested", "shoppingOnly", "purchaseOnly"].includes(row.status)) {
        result.attention += 1;
      }
      return result;
    }, {
      total: 0,
      attention: 0,
      connected: 0,
      needsSync: 0,
      suggested: 0,
      shoppingOnly: 0,
      purchaseOnly: 0,
      conflict: 0,
    }),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const searchText = lower(search);

    return rows.filter((row) => {
      const matchesRowFilter =
        rowFilter === "all" ||
        (rowFilter === "attention"
          ? ["conflict", "needsSync", "suggested", "shoppingOnly", "purchaseOnly"].includes(row.status)
          : row.status === rowFilter);
      if (!matchesRowFilter) return false;

      const matchesMatchFilter = matchFilter === "all" || row.matchType === matchFilter;
      if (!matchesMatchFilter) return false;

      if (!searchText) return true;

      return [
        row.statusLabel,
        row.reason,
        row.shopping?.searchText,
        row.purchase?.searchText,
      ].filter(Boolean).join(" ").toLowerCase().includes(searchText);
    });
  }, [matchFilter, rowFilter, rows, search]);

  const writeOptionalUpdate = async (collectionName, itemId, updates) => {
    if (!itemId) return;

    try {
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, collectionName, itemId),
        updates
      );
    } catch (error) {
      console.warn(`Could not update ${collectionName}/${itemId}`, error);
    }
  };

  const connectPair = async (shopping, purchase) => {
    if (!recentlySelectedCompany || !shopping?.id || !purchase?.id) return;

    const rowKey = getPairKey(shopping, purchase);
    setUpdatingKey(rowKey);

    try {
      const previousPurchaseId =
        shopping.purchasedItemId ||
        purchasedItems.find((item) => item.shoppingListItemId === shopping.id)?.id ||
        "";
      const previousShoppingId =
        purchase.shoppingListItemId ||
        shoppingItems.find((item) => item.purchasedItemId === purchase.id)?.id ||
        "";

      await syncLinkedShoppingPurchase({
        db,
        companyId: recentlySelectedCompany,
        shoppingItemId: shopping.id,
        purchasedItemId: purchase.id,
        shoppingItemData: shopping,
        purchasedItemData: purchase,
        previousShoppingItemId: previousShoppingId,
        previousPurchasedItemId: previousPurchaseId,
      });

      await loadData();
      setSelection(null);
    } catch (error) {
      console.error(error);
      appAlert("Could not connect these items.");
    } finally {
      setUpdatingKey("");
    }
  };

  const clearPair = async (shopping, purchase) => {
    if (!recentlySelectedCompany || (!shopping?.id && !purchase?.id)) return;

    const rowKey = getPairKey(shopping, purchase);
    setUpdatingKey(rowKey);

    try {
      if (shopping?.id) {
        await writeOptionalUpdate("shoppingList", shopping.id, {
          purchasedItem: "",
          updatedAt: Timestamp.now(),
        });
      }

      if (purchase?.id) {
        await writeOptionalUpdate("purchasedItems", purchase.id, {
          shoppingListItemId: "",
        });
      }

      await loadData();
    } catch (error) {
      console.error(error);
      appAlert("Could not clear this connection.");
    } finally {
      setUpdatingKey("");
    }
  };

  const openPurchasePicker = (shopping) => {
    setSelection({
      type: "purchase",
      title: "Select Purchased Item",
      shopping,
      search: lower(shopping.dataBaseItemId || shopping.name),
    });
  };

  const openShoppingPicker = (purchase) => {
    setSelection({
      type: "shopping",
      title: "Select Shopping List Item",
      purchase,
      search: lower(purchase.dataBaseItemId || purchase.name),
    });
  };

  const updateSelectionSearch = (nextSearch) => {
    setSelection((current) => ({
      ...current,
      search: nextSearch,
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-3 text-sm font-bold">
              <Link to="/company/shopping-list" className="text-blue-700 hover:text-blue-900">
                Shopping List
              </Link>
              <span className="text-slate-300">/</span>
              <Link to="/company/purchased-items" className="text-blue-700 hover:text-blue-900">
                Purchased Items
              </Link>
            </div>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">Shopping / Purchases Reconciliation</h2>
            <p className="mt-1 text-sm text-slate-500">
              Match planned materials to purchased items by existing links, shared records, and shared database items.
            </p>
          </div>

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-400">Needs Review</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{summary.attention}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase text-emerald-600">Connected</p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{summary.connected}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-bold uppercase text-amber-600">Needs Sync</p>
            <p className="mt-1 text-2xl font-bold text-amber-900">{summary.needsSync}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-bold uppercase text-blue-600">Suggested</p>
            <p className="mt-1 text-2xl font-bold text-blue-900">{summary.suggested}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-400">Shopping Only</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{summary.shoppingOnly}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-400">Purchased Only</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{summary.purchaseOnly}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search names, jobs, customers, database items, invoices..."
                className="w-full rounded-md border border-slate-300 py-3 pl-10 pr-3 text-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <select
              value={rowFilter}
              onChange={(event) => setRowFilter(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-700 focus:border-blue-500 focus:ring-blue-500"
            >
              {rowFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>

            <select
              value={matchFilter}
              onChange={(event) => setMatchFilter(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-700 focus:border-blue-500 focus:ring-blue-500"
            >
              {matchFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Showing {filteredRows.length} of {rows.length} reconciliation rows.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_190px] border-b border-slate-200 bg-slate-100 px-4 py-3 text-xs font-bold uppercase text-slate-500 xl:grid">
            <span>Shopping List Item</span>
            <span>Match</span>
            <span>Purchased Item</span>
            <span>Actions</span>
          </div>

          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center text-sm font-bold text-slate-500">
              Loading reconciliation rows...
            </div>
          ) : filteredRows.length ? (
            <div className="divide-y divide-slate-100">
              {filteredRows.map((row) => {
                const isUpdating = updatingKey === row.key;
                const canConnect = row.shopping && row.purchase && row.status !== "connected";
                const hasConnectionField = Boolean(row.shopping?.purchasedItemId || row.purchase?.shoppingListItemId);
                const canClear = row.status !== "suggested" && Boolean((row.shopping && row.purchase) || hasConnectionField);

                return (
                  <div key={row.key} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_190px] xl:items-stretch">
                    <RecordMini item={row.shopping} type="shopping" />

                    <div className="flex flex-col justify-between gap-3 border border-slate-200 bg-slate-50 p-4">
                      <div>
                        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                          {row.statusLabel}
                        </span>
                        <p className="mt-2 text-sm font-bold text-slate-800">{row.reason}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.matchType === "sameDatabaseItem"
                            ? row.shopping?.dataBaseItemName || row.purchase?.dataBaseItemName || "Same database item"
                            : row.matchType === "sameRecordId"
                              ? "Same item record"
                              : row.matchType === "explicit"
                                ? "Connection fields"
                                : "Unmatched"}
                        </p>
                      </div>

                      {row.status === "conflict" ? (
                        <div className="flex items-center gap-2 text-xs font-bold text-red-700">
                          <ExclamationTriangleIcon className="h-4 w-4" />
                          Review
                        </div>
                      ) : row.status === "connected" ? (
                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                          <CheckCircleIcon className="h-4 w-4" />
                          Done
                        </div>
                      ) : null}
                    </div>

                    <RecordMini item={row.purchase} type="purchase" />

                    <div className="flex flex-col justify-center gap-2">
                      {canConnect ? (
                        <EmptySideAction
                          icon={LinkIcon}
                          onClick={() => connectPair(row.shopping, row.purchase)}
                          disabled={isUpdating}
                        >
                          {row.status === "needsSync" ? "Sync Link" : "Connect"}
                        </EmptySideAction>
                      ) : null}

                      {row.shopping && row.status !== "connected" ? (
                        <EmptySideAction
                          icon={ShoppingBagIcon}
                          onClick={() => openPurchasePicker(row.shopping)}
                          disabled={isUpdating}
                        >
                          {row.purchase ? "Change Purchase" : "Pick Purchase"}
                        </EmptySideAction>
                      ) : null}

                      {row.purchase && row.status !== "connected" ? (
                        <EmptySideAction
                          icon={ShoppingCartIcon}
                          onClick={() => openShoppingPicker(row.purchase)}
                          disabled={isUpdating}
                        >
                          {row.shopping ? "Change Shopping" : "Pick Shopping"}
                        </EmptySideAction>
                      ) : null}

                      {canClear ? (
                        <EmptySideAction
                          icon={XMarkIcon}
                          onClick={() => clearPair(row.shopping, row.purchase)}
                          disabled={isUpdating}
                        >
                          Clear
                        </EmptySideAction>
                      ) : null}

                      {row.shopping && row.purchase && row.status === "connected" ? (
                        <EmptySideAction
                          icon={ArrowsRightLeftIcon}
                          onClick={() => openPurchasePicker(row.shopping)}
                          disabled={isUpdating}
                        >
                          Change Purchase
                        </EmptySideAction>
                      ) : null}

                      {row.shopping && row.purchase && row.status === "connected" ? (
                        <EmptySideAction
                          icon={ShoppingCartIcon}
                          onClick={() => openShoppingPicker(row.purchase)}
                          disabled={isUpdating}
                        >
                          Change Shopping
                        </EmptySideAction>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">
              No reconciliation rows match the current filters.
            </div>
          )}
        </div>
      </div>

      {selection?.type === "purchase" ? (
        <SelectionModal
          title={selection.title}
          search={selection.search}
          onSearchChange={updateSelectionSearch}
          items={purchasedItems}
          type="purchase"
          anchorItem={selection.shopping}
          isUpdating={Boolean(updatingKey)}
          onClose={() => setSelection(null)}
          onSelect={(purchase) => connectPair(selection.shopping, purchase)}
        />
      ) : null}

      {selection?.type === "shopping" ? (
        <SelectionModal
          title={selection.title}
          search={selection.search}
          onSearchChange={updateSelectionSearch}
          items={shoppingItems}
          type="shopping"
          anchorItem={selection.purchase}
          isUpdating={Boolean(updatingKey)}
          onClose={() => setSelection(null)}
          onSelect={(shopping) => connectPair(shopping, selection.purchase)}
        />
      ) : null}
    </div>
  );
};

export default ShoppingPurchaseReconciliation;
