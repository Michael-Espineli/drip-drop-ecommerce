import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { collection, query, where, orderBy, getDocs, limit, startAfter } from 'firebase/firestore';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { Link, useNavigate } from 'react-router-dom';
import { PurchasedItem } from '../../../utils/models/PurchasedItem';
import { format } from "date-fns";
import * as XLSX from "xlsx";

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
  const fileInputRef = useRef(null);

  const { recentlySelectedCompany } = useContext(Context);

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

    constraints.push(limit(25));
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
          "Purchase ID": eq?.id || "",
          "Receipt ID": eq?.receiptId || "",
          "Invoice Number": eq?.invoiceNum || "",
          Vendor: eq?.venderName || "",
          "Vendor ID": eq?.venderId || "",
          Technician: eq?.techName || "",
          "Technician ID": eq?.techId || "",
          "Item ID": eq?.itemId || "",
          Name: eq?.name || "",
          Price: eq?.price || "",
          Quantity: eq?.quantityString || "",
          "Date": eq?.date ? format(eq.date, "yyyy-MM-dd") : "",

          "Billable (bool)": eq?.billable ?? "",
          "Invoiced (bool)": eq?.invoiced ?? "",
          "Returned (bool)": eq?.returned ?? "",
          Customer: eq?.customerName || "",
          "Customer ID": eq?.customerId || "",

          Sku: eq?.sku || "",
          Notes: eq?.notes || "",
          "Job Id": eq?.jobId || "",
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
    <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
      <div className="">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold text-gray-800">Purchases</h2>
          <Link to={'/company/purchased-items/createNew'}
            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
          >
            Create New Purchase
          </Link>
        </div>
        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className='flex flex-col sm:flex-row justify-between items-center mb-4 gap-4'>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-2/5 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              type="text"
              placeholder="Search customer, SKU, invoice, tech, vendor, job, or receipt..."
            />
            <button onClick={handleUploadClick}
              className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"

            >Upload Receipt</button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
              accept="application/pdf"
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
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Invoice #</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Sku</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Price</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Quantity</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Total</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Technician</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Customer Name</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Job Id</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Notes</th>
                      <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredItems.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors"
                        onClick={() => navigate(`/company/purchased-items/detail/${item.id}`)}
                      >
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.name}
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
