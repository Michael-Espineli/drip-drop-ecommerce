import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { format } from "date-fns";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const receiptFilters = [
  { value: "all", label: "All" },
  { value: "withFiles", label: "With Files" },
  { value: "missingFiles", label: "Missing Files" },
  { value: "linkedItems", label: "Linked Items" },
  { value: "noLinkedItems", label: "No Linked Items" },
];

const receiptSorts = [
  { value: "receiptDateFirst", label: "Recent" },
  { value: "receiptDateLast", label: "Oldest" },
  { value: "totalHigh", label: "Total High" },
  { value: "totalLow", label: "Total Low" },
];

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

const toDate = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shortDate = (value) => {
  const date = toDate(value);
  return date ? format(date, "MM/dd/yy") : "";
};

const toSortableValue = (value) => {
  const date = toDate(value);
  if (date) return date.getTime();
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

const receiptSearchText = (receipt) =>
  [
    receipt.id,
    receipt.invoiceNum,
    receipt.storeName,
    receipt.rawVendorName,
    receipt.techName,
    receipt.tech,
    receipt.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const normalizeReceipt = (docSnap) => {
  const data = docSnap.data();
  const cost = Number(data.cost || 0);
  const costAfterTax = Number(data.costAfterTax || 0);
  const tax = Number(data.tax ?? Math.max(costAfterTax - cost, 0));
  const pdfUrlList = Array.isArray(data.pdfUrlList) ? data.pdfUrlList : [];
  const purchasedItemIds = Array.isArray(data.purchasedItemIds) ? data.purchasedItemIds : [];

  return {
    id: data.id || docSnap.id,
    invoiceNum: data.invoiceNum || "",
    date: toDate(data.date),
    storeName: data.storeName || data.rawVendorName || "",
    techName: data.techName || data.tech || "",
    numberOfItems: Number(data.numberOfItems || purchasedItemIds.length || 0),
    cost,
    tax,
    costAfterTax,
    pdfUrlList,
    purchasedItemIds,
    notes: data.notes || "",
  };
};

const ReceiptListView = () => {
  const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);
  const [receipts, setReceipts] = useState([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [startViewingDate, setStartViewingDate] = useState(() => startOfDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [endViewingDate, setEndViewingDate] = useState(() => endOfDay(new Date()));
  const [receiptFilterOption, setReceiptFilterOption] = useState("all");
  const [receiptSortOption, setReceiptSortOption] = useState("receiptDateFirst");
  const [techIds, setTechIds] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [tableSort, setTableSort] = useState({ key: "date", direction: "desc" });

  useEffect(() => {
    const fetchCompanyUsers = async () => {
      if (!recentlySelectedCompany) {
        setCompanyUsers([]);
        setTechIds([]);
        return;
      }

      try {
        const usersRef = collection(db, `companies/${recentlySelectedCompany}/companyUsers`);
        const snapshot = await getDocs(query(usersRef, where("status", "==", "Active")));
        const users = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setCompanyUsers(users);
        setTechIds(users.map((user) => user.userId).filter(Boolean));
      } catch (err) {
        console.error("Error loading company users for receipt filters:", err);
      }
    };

    fetchCompanyUsers();
  }, [recentlySelectedCompany]);

  const buildReceiptQuery = (receiptsRef) => {
    const constraints = [
      where("date", ">=", startOfDay(startViewingDate)),
      where("date", "<=", endOfDay(endViewingDate)),
    ];

    const eligibleTechIds = techIds.filter(Boolean).slice(0, 30);
    const allCompanyTechIds = companyUsers.map((user) => user.userId).filter(Boolean);
    const isTechFiltered = allCompanyTechIds.length > 0 && eligibleTechIds.length !== allCompanyTechIds.length;
    if (isTechFiltered && eligibleTechIds.length > 0) {
      constraints.push(where("techId", "in", eligibleTechIds));
    } else if (isTechFiltered) {
      constraints.push(where("techId", "==", "__no_selected_technician__"));
    }

    constraints.push(orderBy("date", receiptSortOption === "receiptDateLast" ? "asc" : "desc"));

    return query(receiptsRef, ...constraints);
  };

  useEffect(() => {
    if (!recentlySelectedCompany || !startViewingDate || !endViewingDate) {
      setReceipts([]);
      setLoading(false);
      return;
    }

    const loadReceipts = async () => {
      setLoading(true);
      setError("");

      try {
        const receiptsRef = collection(db, "companies", recentlySelectedCompany, "receipts");
        const snapshot = await getDocs(buildReceiptQuery(receiptsRef));
        setReceipts(snapshot.docs.map(normalizeReceipt));
      } catch (err) {
        console.error("Error loading receipts:", err);
        setError("Failed to load receipts.");
      } finally {
        setLoading(false);
      }
    };

    loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany, startViewingDate, endViewingDate, receiptSortOption, techIds, companyUsers]);

  const filteredReceipts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return receipts.filter((receipt) => {
      const matchesSearch = !term || receiptSearchText(receipt).includes(term);
      if (!matchesSearch) return false;

      switch (receiptFilterOption) {
        case "withFiles":
          return receipt.pdfUrlList.length > 0;
        case "missingFiles":
          return receipt.pdfUrlList.length === 0;
        case "linkedItems":
          return receipt.purchasedItemIds.length > 0 || receipt.numberOfItems > 0;
        case "noLinkedItems":
          return receipt.purchasedItemIds.length === 0 && receipt.numberOfItems === 0;
        default:
          return true;
      }
    });
  }, [receipts, receiptFilterOption, searchTerm]);

  const sortedReceipts = useMemo(() => {
    const valueForKey = (receipt, key) => {
      if (key === "pdfUrlList") return receipt.pdfUrlList.length;
      return receipt[key];
    };

    return [...filteredReceipts].sort((left, right) => {
      const result = compareSortValues(
        toSortableValue(valueForKey(left, tableSort.key)),
        toSortableValue(valueForKey(right, tableSort.key))
      );
      return tableSort.direction === "asc" ? result : -result;
    });
  }, [filteredReceipts, tableSort]);

  const summary = useMemo(() => {
    const subtotal = filteredReceipts.reduce((total, receipt) => total + Number(receipt.cost || 0), 0);
    const tax = filteredReceipts.reduce((total, receipt) => total + Number(receipt.tax || 0), 0);
    const total = filteredReceipts.reduce((sum, receipt) => sum + Number(receipt.costAfterTax || 0), 0);
    const itemCount = filteredReceipts.reduce((sum, receipt) => sum + Number(receipt.numberOfItems || 0), 0);

    return {
      subtotal,
      tax,
      total,
      itemCount,
    };
  }, [filteredReceipts]);

  const setSort = (key) => {
    setTableSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const handleReceiptSortChange = (value) => {
    setReceiptSortOption(value);

    if (value === "receiptDateLast") {
      setTableSort({ key: "date", direction: "asc" });
    } else if (value === "totalHigh") {
      setTableSort({ key: "costAfterTax", direction: "desc" });
    } else if (value === "totalLow") {
      setTableSort({ key: "costAfterTax", direction: "asc" });
    } else {
      setTableSort({ key: "date", direction: "desc" });
    }
  };

  const toggleTech = (userId) => {
    setTechIds((currentTechIds) =>
      currentTechIds.includes(userId)
        ? currentTechIds.filter((id) => id !== userId)
        : [...currentTechIds, userId]
    );
  };

  const FilterModal = () => (
    <div className="fixed inset-0 z-50 bg-gray-900/40 p-4">
      <div className="mx-auto mt-16 max-w-2xl rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Filter & Sort</h3>
            <p className="text-sm text-gray-500">Receipts load from the selected date range.</p>
          </div>
          <button className="rounded-md px-3 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-100" onClick={() => setShowFilterModal(false)}>
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
              value={receiptFilterOption}
              onChange={(event) => setReceiptFilterOption(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            >
              {receiptFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-700">
            Sort
            <select
              value={receiptSortOption}
              onChange={(event) => handleReceiptSortChange(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            >
              {receiptSorts.map((sort) => (
                <option key={sort.value} value={sort.value}>{sort.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">Technicians</h4>
            <button
              type="button"
              className="text-sm font-semibold text-blue-700 hover:text-blue-900"
              onClick={() => setTechIds(companyUsers.map((user) => user.userId).filter(Boolean))}
            >
              Select all
            </button>
          </div>
          <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
            {companyUsers.map((user) => (
              <label key={user.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={techIds.includes(user.userId)}
                  onChange={() => toggleTech(user.userId)}
                />
                {user.userName || user.name || user.email || user.userId}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const SortHeader = ({ label, keyName }) => (
    <th className="p-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-600">
      <button
        type="button"
        onClick={() => setSort(keyName)}
        className="inline-flex items-center gap-1 text-left uppercase tracking-wider hover:text-gray-900"
      >
        {label}
        <span className="text-xs text-gray-400">
          {tableSort.key === keyName ? (tableSort.direction === "asc" ? "ASC" : "DESC") : "--"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
      <div className="w-full">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-gray-800">Receipts</h2>
            <p className="mt-1 text-sm text-gray-500">
              Receipt headers, totals, files, and linked purchased items from {format(startViewingDate, "MM/dd/yy")} to {format(endViewingDate, "MM/dd/yy")}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/company/purchased-items/createNew"
              className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 shadow-sm transition hover:bg-blue-100"
            >
              Create New Receipt
            </Link>
            <Link
              to="/company/purchased-items"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Purchased Items
            </Link>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-lg">
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-lg border border-gray-300 p-3 focus:border-blue-500 focus:ring-blue-500 sm:w-2/5"
              type="text"
              placeholder="Search invoice, vendor, technician, notes, or receipt..."
            />
            <button
              type="button"
              onClick={() => setShowFilterModal(true)}
              className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-100"
            >
              Filter & Sort
            </button>
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Receipt Total</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{moneyFromCents(summary.total)}</p>
              <p className="text-sm text-gray-500">{filteredReceipts.length} receipt(s)</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Subtotal</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{moneyFromCents(summary.subtotal)}</p>
              <p className="text-sm text-gray-500">Before tax</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tax</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{moneyFromCents(summary.tax)}</p>
              <p className="text-sm text-gray-500">Receipt tax total</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Items</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{summary.itemCount}</p>
              <p className="text-sm text-gray-500">Linked purchased items</p>
            </div>
          </div>

          {loading ? <p className="text-sm text-gray-500">Loading receipts...</p> : null}
          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

          {!loading && !error ? (
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead className="bg-gray-100">
                  <tr>
                    <SortHeader label="Invoice #" keyName="invoiceNum" />
                    <SortHeader label="Date" keyName="date" />
                    <SortHeader label="Vendor" keyName="storeName" />
                    <SortHeader label="Technician" keyName="techName" />
                    <SortHeader label="Items" keyName="numberOfItems" />
                    <SortHeader label="Subtotal" keyName="cost" />
                    <SortHeader label="Tax" keyName="tax" />
                    <SortHeader label="Total" keyName="costAfterTax" />
                    <SortHeader label="Files" keyName="pdfUrlList" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedReceipts.map((receipt) => (
                    <tr
                      key={receipt.id}
                      onClick={() => navigate(`/company/receipts/detail/${receipt.id}`)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="whitespace-nowrap p-4 text-gray-700">{receipt.invoiceNum || "N/A"}</td>
                      <td className="whitespace-nowrap p-4 text-gray-700">{shortDate(receipt.date)}</td>
                      <td className="whitespace-nowrap p-4 text-gray-700">{receipt.storeName || "N/A"}</td>
                      <td className="whitespace-nowrap p-4 text-gray-700">{receipt.techName || "N/A"}</td>
                      <td className="whitespace-nowrap p-4 text-gray-700">{receipt.numberOfItems || 0}</td>
                      <td className="whitespace-nowrap p-4 text-gray-700">{moneyFromCents(receipt.cost)}</td>
                      <td className="whitespace-nowrap p-4 text-gray-700">{moneyFromCents(receipt.tax)}</td>
                      <td className="whitespace-nowrap p-4 font-semibold text-gray-900">{moneyFromCents(receipt.costAfterTax)}</td>
                      <td className="whitespace-nowrap p-4 text-gray-700">{receipt.pdfUrlList.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {sortedReceipts.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
                  No receipts match the current filters.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {showFilterModal && <FilterModal />}
    </div>
  );
};

export default ReceiptListView;
