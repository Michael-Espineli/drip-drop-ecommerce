import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { collection, query, where, orderBy, getDocs, startAfter } from 'firebase/firestore';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { Link, useNavigate } from 'react-router-dom';
import { PurchasedItem } from '../../../utils/models/PurchasedItem';
import { format } from "date-fns";
import * as XLSX from "xlsx";

const MURDOCK_COMPANY_ID = "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e";

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

const PurchaseListView = () => {
  const navigate = useNavigate();

  const [purchasedItems, setPurchasedItems] = useState([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [startViewingDate, setStartViewingDate] = useState(() => startOfDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [endViewingDate, setEndViewingDate] = useState(() => endOfDay(new Date()));
  const [purchaseFilterOption, setPurchaseFilterOption] = useState('billableAndNotInvoiced');
  const [purchaseSortOption, setPurchaseSortOption] = useState('purchaseDateFirst');
  const [techIds, setTechIds] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filteredItems, setFilteredItems] = useState([]);
  const [error, setError] = useState(null);
  const [lastDocument, setLastDocument] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [tableSort, setTableSort] = useState({ key: "date", direction: "desc" });
  const fileInputRef = useRef(null);

  const { recentlySelectedCompany } = useContext(Context);
  const showAlphaWaterImport = recentlySelectedCompany === MURDOCK_COMPANY_ID;

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
        const usersData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      alert("Excel export failed. Check console for details.");
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

  const SortHeader = ({ label, keyName, className = "" }) => (
    <th className={`p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider ${className}`}>
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

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      console.log('Selected file:', file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current.click();
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
            <p className="text-sm text-gray-500">Match the iOS purchase filters and date controls.</p>
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

  return (
    <div className='min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4'>
      <div className="w-full">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold text-gray-800">Purchases</h2>
          <div className="flex flex-wrap justify-end gap-2">
            {showAlphaWaterImport ? (
              <Link
                to="/company/purchased-items/alpha-water-import"
                className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl shadow-sm hover:bg-indigo-100 transition"
              >
                Alpha Water Import
              </Link>
            ) : null}
            <Link to={'/company/purchased-items/createNew'}
              className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
            >
              Create New Receipt
            </Link>
            <Link to={'/company/receipts'}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 transition"
            >
              View Receipts
            </Link>
          </div>
        </div>
        <div className="rounded-lg bg-white p-6 shadow-lg">
          <div className='flex flex-col sm:flex-row justify-between items-center mb-4 gap-4'>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-2/5 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              type="text"
              placeholder="Search customer, SKU, invoice, tech, vendor, job, or receipt..."
            />
            <button onClick={() => setShowFilterModal(true)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:bg-gray-100 transition"
            >
              Filter & Sort
            </button>
          </div>
          <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Spent</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{moneyFromCents(summary.totalSpentCents)}</p>
              <p className="text-sm text-gray-500">{summary.activeCount} active item(s)</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Billable Cost</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{moneyFromCents(summary.billableCostCents)}</p>
              <p className="text-sm text-gray-500">{summary.billableCount} billable item(s)</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Billable Price</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{moneyFromCents(summary.billablePriceCents)}</p>
              <p className="text-sm text-gray-500">Uses billing rate when set</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Invoice Status</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{summary.needsInvoiceCount}</p>
              <p className="text-sm text-gray-500">{summary.invoicedCount} invoiced, {summary.nonBillableCount} non-billable</p>
            </div>
          </div>
          <div className="purchase-list-section mt-4">
            {loading && <p>Loading...</p>}
            {error && <p className="text-red-500">{error}</p>}
            <div className='overflow-x-auto'>
              {!loading && !error && (
                <table className="min-w-full bg-white">
                  <thead className="bg-gray-100">
                    <tr>
                      <SortHeader label="Status" keyName="status" />
                      <SortHeader label="Name" keyName="name" />
                      <SortHeader label="Database Item" keyName="itemId" />
                      <SortHeader label="Category" keyName="category" />
                      <SortHeader label="Invoice #" keyName="invoiceNum" />
                      <SortHeader label="Date" keyName="date" />
                      <SortHeader label="Sku" keyName="sku" />
                      <SortHeader label="Price" keyName="price" />
                      <SortHeader label="Quantity" keyName="quantity" />
                      <SortHeader label="Total" keyName="total" />
                      <SortHeader label="Technician" keyName="techName" />
                      <SortHeader label="Customer Name" keyName="customerName" />
                      <SortHeader label="Job" keyName="jobId" />
                      <SortHeader label="Notes" keyName="notes" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedItems.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors"
                        onClick={() => navigate(`/company/purchased-items/detail/${item.id}`)}
                      >
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {
                            item.billable && <>
                              {
                                item.invoiced ? <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                                  Invoiced
                                </span> : <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
                                  Needs invoice
                                </span>
                              }
                            </>
                          }
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.name}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700" onClick={(event) => event.stopPropagation()}>
                          {item.itemId ? (
                            <Link
                              to={`/company/items/detail/${item.itemId}`}
                              className="font-semibold text-blue-600 hover:text-blue-800"
                            >
                              Open
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.category || "Uncategorized"}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.invoiceNum || 'N/A'}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {shortDate(item.date)}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.sku}
                        </td>

                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {`$${(item.price / 100).toFixed(2)}`}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.quantityString}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {`$${(item.total / 100).toFixed(2)}`}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.techName}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.customerName}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {
                            item.jobId ? <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">Job</span> : null
                          }
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && !error && filteredItems.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
                  No purchases match the current filters.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2 p-2">
        <Link to={'/company/items'}
          className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
        >
          See Database
        </Link>
        <button
          type="button"
          onClick={downloadExcel}
          className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl shadow-sm hover:bg-green-100 transition"
        >
          Download Excel
        </button>
        {hasMore ? (
          <button
            type="button"
            onClick={fetchMorePurchasedItems}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 transition"
          >
            Load More
          </button>
        ) : null}
      </div>
      {showFilterModal && <FilterModal />}
    </div>
  );
};

export default PurchaseListView;
