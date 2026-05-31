import React, { useState, useEffect, useContext, useRef } from 'react';
import { collection, query, where, orderBy, getDocs, limit, startAfter } from 'firebase/firestore';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { Link, useNavigate } from 'react-router-dom';
import { PurchasedItem } from '../../../utils/models/PurchasedItem';
import PurchasesCardView from './PurchasesCardView';
import { CompanyUser } from '../../../utils/models/CompanyUser';
import { format, isBefore, isEqual, startOfToday } from "date-fns";
import * as XLSX from "xlsx";
const PurchaseListView = () => {
  // This component is a conversion of a SwiftUI View.

  const navigate = useNavigate();

  // SwiftUI State variables will be managed using React's useState hook.
  const [showEditView, setShowEditView] = useState(false);
  const [showDetailsView, setShowDetailsView] = useState(false);
  const [selected, setSelected] = useState(null); // Equivalent to PurchasedItem.ID?
  const [purchasedItems, setPurchasedItems] = useState([]);
  // Note: sortOrder [KeyPathComparator(\PurchasedItem.invoiceNum, order: .reverse)] needs a React equivalent,
  const [selectedFilters, setSelectedFilters] = useState(['isBillable', 'isNotInvoiced']);
  const [showFilterModal, setShowFilterModal] = useState(false);
  // possibly managing the sort order logic within the component or a hook.
  const [sortOrder, setSortOrder] = useState([{ key: 'invoiceNum', order: 'desc' }]);
  const [serviceStopDetail, setServiceStopDetail] = useState(null); // Equivalent to PurchasedItem?
  // Note: workOrderTemplate:JobTemplate needs a React equivalent for JobTemplate
  const [workOrderTemplate, setWorkOrderTemplate] = useState({ id: '', name: 'sum', type: 'all' });
  // Initialize dates to the beginning and end of the current month
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const [startViewingDate, setStartViewingDate] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)); // 30 days ago
  const [endViewingDate, setEndViewingDate] = useState(new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)); // 1 day from now
  const [selection, setSelection] = useState(null); // Equivalent to PurchasedItem.ID?
  const [purchaseFilterOption, setPurchaseFilterOption] = useState('billableAndNotInvoiced'); // Placeholder enum
  const [purchaseSortOption, setPurchaseSortOption] = useState('purchaseDateFirst'); // Placeholder enum
  const [techIds, setTechIds] = useState([]);
  const [showSummary, setShowSummary] = useState(false);

  const [companyUsers, setCompanyUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filteredItems, setFilteredItems] = useState([]);
  const [error, setError] = useState(null);
  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [lastDocument, setLastDocument] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef(null);

  // Get companyId from context (assuming Context is correctly imported and provided)
  // Get companyId from context (assuming Context is correctly imported and provided)
  const { recentlySelectedCompany } = useContext(Context); // Make sure Context is imported

  // Define Data Models (JavaScript equivalents)
  // Moved to src/utils/models/CompanyUser.js

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

  // Effect to filter purchased items based on search term
  useEffect(() => {
    if (searchTerm === '') {
      setFilteredItems(purchasedItems);
    } else {
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      setFilteredItems(purchasedItems.filter(item => item.name.toLowerCase().includes(lowerCaseSearchTerm) || (item.invoiceNum && item.invoiceNum.toLowerCase().includes(lowerCaseSearchTerm))));
    }
  }, [purchasedItems, searchTerm]); // Re-filter when purchasedItems or searchTerm changes

  // Effect to fetch purchased items based on filters, dates, and selected company/techs
  useEffect(() => {
    const fetchPurchasedItems = async () => {
      if (!recentlySelectedCompany || techIds.length === 0 || !startViewingDate || !endViewingDate) {
        setPurchasedItems([]); // Clear items if dependencies are not met
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const itemsRef = collection(db, `companies/${recentlySelectedCompany}/purchasedItems`);
        // Construct query based on Swift code logic
        console.log("startViewingDate: ", startViewingDate)
        console.log("endViewingDate: ", endViewingDate)
        console.log("techIds: ", techIds)

        let q = query(
          itemsRef,
          where("date", ">=", startViewingDate), // Using Date objects directly
          // Add filters based on selectedFilters
          // ...selectedFilter
          //   switch (filter) {
          //     case 'isInvoiced':
          //       console.log("isInv oiced: ")
          //       return where("invoiced", "==", true);
          //     case 'isNotInvoiced':
          //       console.log("isNotInvoiced: ")
          //       return where("invoiced", "==", false);
          //     case 'isBillable':
          //       console.log("isBillable: ")
          //       return where("billable", "==", true);
          //     case 'isNotBillable':
          //       console.log("isNotBillable: ")
          //       return where("billable", "==", false);
          //     default:
          //       console.log("null: ")
          //       return null; // Should not happen with current options
          //   }
          // }).filter(filter => filter !== null), // Filter out any null returnss.map(filter => {

          where("date", "<=", endViewingDate), // Using Date objects directly
          where("techId", "in", techIds),
          // Ordering by price, descending (priceHigh = true) - need to manage this state
          orderBy("date", "desc"),
          // Limit to 25 items for pagination
          limit(25)
        );

        const querySnapshot = await getDocs(q);
        const itemsData = querySnapshot.docs.map(doc => PurchasedItem.fromFirestore(doc));

        // Set the last document for pagination
        if (querySnapshot.docs.length > 0) {
          setLastDocument(querySnapshot.docs[querySnapshot.docs.length - 1]);
        }
        setHasMore(querySnapshot.docs.length === 25); // Check if there might be more items
        setPurchasedItems(itemsData);
      } catch (err) {
        console.error("Error fetching purchased items:", err);
        console.error("");
        console.error("Error fetching purchased items");
        setError("Failed to load purchased items.");
      } finally {
        setLoading(false);
      }
    };

    fetchPurchasedItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany, techIds, startViewingDate, endViewingDate, selectedFilters]);

  // Function to fetch more purchased items (pagination)
  const fetchMorePurchasedItems = async () => {
    if (!recentlySelectedCompany || techIds.length === 0 || !startViewingDate || !endViewingDate || !lastDocument) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const itemsRef = collection(db, `companies/${recentlySelectedCompany}/purchased-items`);
      let q = query(
        itemsRef,
        where("date", ">=", startViewingDate),
        where("date", "<=", endViewingDate),
        where("techId", "in", techIds),
        orderBy("price", "desc"),
        limit(25)
      );

      const querySnapshot = await getDocs(q);
      const newItemsData = querySnapshot.docs.map(doc => PurchasedItem.fromFirestore(doc));

      // Append new items to the existing list
      setPurchasedItems(prevItems => [...prevItems, ...newItemsData]);

      setLastDocument(querySnapshot.docs.length > 0 ? querySnapshot.docs[querySnapshot.docs.length - 1] : null);
      setHasMore(querySnapshot.docs.length === 25); // Check if there might be more items
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
  // SwiftUI EnvironmentObjects (like navigationManager, masterDataManager, dataService)
  // will need to be handled using React Context, Redux, or prop drilling,
  // depending on your project's state management strategy.

  // SwiftUI ViewModels (purchaseVM, receiptViewModel, settingsViewModel, techVM)
  // will be integrated here, likely by calling functions that perform the data
  // operations using your JavaScript data service.

  // SwiftUI .task and .onChange modifiers will be translated into React's useEffect hook
  // to handle side effects and respond to state changes.

  // The main body of the SwiftUI view (the ZStack containing list and icons)
  // will be translated into JSX elements.

  // SwiftUI's ScrollView, ForEach, NavigationLink, and Button will be converted
  // to equivalent React elements or components.

  // Modifiers like TextFieldModifier, PlusIconModifer, etc., will be
  // implemented using CSS classes, styled components, or inline styles.

  // Placeholder functions for SwiftUI methods that cannot be directly translated

  // SwiftUI State variables for icon interactions
  const [showFilerOptions, setShowFilerOptions] = useState(false);
  const [showAddNew, setShowAddNew] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // or require custom implementation will be created here.

  // Example placeholder function:
  // const handleReload = () => { ... };

  // Function to format date as MM/DD/YY
  const shortDate = (date) => {
    if (!date) return '';
    // Check if date is a Firebase Timestamp
    let jsDate = date;
    if (date.toDate) { // Check if it's a Firestore Timestamp
      jsDate = date.toDate(); // Convert to JavaScript Date object
    }
    const month = (jsDate.getMonth() + 1).toString().padStart(2, '0');
    const day = jsDate.getDate().toString().padStart(2, '0');
    const year = jsDate.getFullYear().toString().slice(-2);
    return `${month}/${day}/${year}`;
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      console.log('Selected file:', file);
      // Here you would trigger the PDF processing logic
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleApplyFilters = (newOperationFilters, newBillingFilters) => {
    fetchMorePurchasedItems()
    setShowFilterModal(false);
  };
  const FilterModal = ({ onClose, applyFilters }) => {
    // const [tempOperationFilters, setTempOperationFilters] = useState(operationStatusFilter);
    // const [tempBillingFilters, setTempBillingFilters] = useState(billingStatusFilter);

    const handleOperationChange = (status) => {
      // setTempOperationFilters(prev =>
      //   prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
      // );
    };

    const handleBillingChange = (status) => {
      // setTempBillingFilters(prev =>
      //   prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
      // );
    };

    return (
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full" id="my-modal">
        <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div className="mt-3 text-center">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Filter Options</h3>
            <p className="text-sm text-gray-500">Select your filter preferences.</p>

            <div className="mt-2 px-7 py-3">
              {/* Date Pickers */}
              <div className="date-pickers-container flex space-x-4 mt-2"> {/* Equivalent to HStack */}

                <div className="flex flex-col">
                  <label htmlFor="startDate">Start Date:</label> {/* Equivalent to Text("Start Date:") */}
                  <input
                    type="date"
                    id="startDate"
                    value={startViewingDate.toISOString().split('T')[0]}
                    onChange={(e) => setStartViewingDate(new Date(e.target.value))}
                    className="border p-1 rounded"
                  />
                </div>

                <div className="flex flex-col"> {/* Equivalent to VStack */}
                  <label htmlFor="endDate">End Date:</label>
                  <input
                    type="date"
                    id="endDate"
                    value={endViewingDate.toISOString().split('T')[0]}
                    onChange={(e) => setEndViewingDate(new Date(e.target.value))}
                    className="border p-1 rounded"
                  />
                </div>
              </div>
              <div className="flex flex-col items-start space-y-2">
                {/* Filter options */}
                <label className="inline-flex items-center">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    value="isInvoiced"
                    checked={selectedFilters.includes('isInvoiced')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFilters([...selectedFilters, 'isInvoiced']);
                      } else {
                        setSelectedFilters(selectedFilters.filter(filter => filter !== 'isInvoiced'));
                      }
                    }}
                  />
                  <span className="ml-2 text-gray-700">Is Invoiced</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    value="isNotInvoiced"
                    checked={selectedFilters.includes('isNotInvoiced')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFilters([...selectedFilters, 'isNotInvoiced']);
                      } else {
                        setSelectedFilters(selectedFilters.filter(filter => filter !== 'isNotInvoiced'));
                      }
                    }}

                  />
                  <span className="ml-2 text-gray-700">Is Not Invoiced</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    value="isBillable"
                    checked={selectedFilters.includes('isBillable')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFilters([...selectedFilters, 'isBillable']);
                      } else {
                        setSelectedFilters(selectedFilters.filter(filter => filter !== 'isBillable'));
                      }
                    }}
                  />
                  <span className="ml-2 text-gray-700">Is Billable</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    value="isNotBillable"
                    checked={selectedFilters.includes('isNotBillable')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFilters([...selectedFilters, 'isNotBillable']);
                      } else {
                        setSelectedFilters(selectedFilters.filter(filter => filter !== 'isNotBillable'));
                      }
                    }}
                  />
                  <span className="ml-2 text-gray-700">Is Not Billable</span>
                </label>
              </div>
            </div>
            <div className="items-center px-4 py-3">
              <button id="close-modal" className="px-4 py-2 bg-gray-800 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300" onClick={() => setShowFilterModal(false)}>Close</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

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
              placeholder="Search by customer, ID, or description..."
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
                        </td>{/* Handle cases where invoiceNum might be null/undefined */}
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
                            (item.jobId != "") && <h1>Job</h1>
                          }
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {item.notes}
                        </td>
                        <td className="p-4 whitespace-nowrap text-gray-700">
                          {
                            item.billable && <>
                              {
                                item.invoiced ? <h1 className="rounded-md green-bg px-2 items-center white-fg">
                                  Invoiced
                                </h1> : <h1 className="rounded-md red-bg px-2 items-center white-fg">
                                  Needs invoice
                                </h1>
                              }
                            </>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end p-2">
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
      </div>
      {showFilterModal && <FilterModal onClose={() => setShowFilterModal(false)} applyFilters={handleApplyFilters} />}
    </div>
  );
};

export default PurchaseListView;
