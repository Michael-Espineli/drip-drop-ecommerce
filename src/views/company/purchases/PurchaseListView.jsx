import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, orderBy, getDocs, limit, startAfter } from 'firebase/firestore';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { Link } from 'react-router-dom'; 
import { PurchasedItem } from '../../../utils/models/PurchasedItem';
import PurchasesCardView from './PurchasesCardView';

const PurchaseListView = () => {
 // This component is a conversion of a SwiftUI View.

  // SwiftUI State variables will be managed using React's useState hook.
  const [showEditView, setShowEditView] = useState(false);
  const [showDetailsView, setShowDetailsView] = useState(false);
  const [selected, setSelected] = useState(null); // Equivalent to PurchasedItem.ID?
  const [purchasedItems, setPurchasedItems] = useState([]);
  // Note: sortOrder [KeyPathComparator(\PurchasedItem.invoiceNum, order: .reverse)] needs a React equivalent,
  const [selectedFilters, setSelectedFilters] = useState([]);
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

  const [searchTerm, setSearchTerm] = useState('');
  const [companyUsers, setCompanyUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filteredItems, setFilteredItems] = useState([]);
 const [error, setError] = useState(null);
 // State for pagination
 const [currentPage, setCurrentPage] = useState(1);
 const [lastDocument, setLastDocument] = useState(null);
 const [hasMore, setHasMore] = useState(true);

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
 }, [recentlySelectedCompany]); // Refetch when recentlySelectedCompany changes

  // Effect to filter purchased items based on search term
  useEffect(() => {
    if (searchTerm === '') {
      setFilteredItems(purchasedItems);
    } else {
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      setFilteredItems(purchasedItems.filter(item => item.name.toLowerCase().includes(lowerCaseSearchTerm) || (item.invoiceNum && item.invoiceNum.toLowerCase().includes(lowerCaseSearchTerm))));
    }
  }, [purchasedItems, searchTerm]); // Re-filter when purchasedItems or searchTerm changes

  // Effect to fetch purchased items
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
    let q = query(
      itemsRef,
      where("date", ">=", startViewingDate), // Using Date objects directly
 // Add filters based on selectedFilters
 ...selectedFilters.map(filter => {
 switch (filter) {
 case 'isInvoiced':
 return where("invoiced", "==", true);
 case 'isNotInvoiced':
 return where("invoiced", "==", false);
 case 'isBillable':
 return where("billable", "==", true);
 case 'isNotBillable':
 return where("billable", "==", false);
 default:
 return null; // Should not happen with current options
 }
 }).filter(filter => filter !== null), // Filter out any null returns

      where("date", "<=", endViewingDate), // Using Date objects directly
      where("techId", "in", techIds),
      // Ordering by price, descending (priceHigh = true) - need to manage this state
 orderBy("price", "desc"),
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
      setError("Failed to load purchased items.");
    } finally {
      setLoading(false);
    }
  };

    fetchPurchasedItems();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [recentlySelectedCompany, techIds, startViewingDate, endViewingDate]);

  // Function to fetch more purchased items (pagination)
  const fetchMorePurchasedItems = async () => {
    if (!recentlySelectedCompany || techIds.length === 0 || !startViewingDate || !endViewingDate || !lastDocument) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const itemsRef = collection(db, `companies/${recentlySelectedCompany}/purchasedItems`);
      let q = query(
        itemsRef,
        where("date", ">=", startViewingDate),
        where("date", "<=", endViewingDate),
        where("techId", "in", techIds),
        orderBy("price", "desc"),
        startAfter(lastDocument), // Start fetching after the last document
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

  return (
    <div className="purchase-list-view-container">
      {/*
        This div represents the ZStack in SwiftUI.
        It will contain the list and icons sections.
        The background color (Color.listColor) would be applied via CSS to this container or a parent.
 */}
      <div className="purchase-header">
        {/* Placeholder for icons */}
        <div className="flex justify-between items-center px-4">
          <Link to="/company/purchasedItems/createNew" className="py-1 px-2 rounded-md bg-[#2B600F] text-[#ffffff] mt-2">Add New Purchase</Link>
        <button onClick={() => setShowFilterModal(true)} className="py-1 px-4 rounded-md bg-[#2B600F] text-[#ffffff] mt-2">Filter Options</button>
        </div>
          <div className="search-bar-container mt-2 px-4">
          <input
          type="text"
                    placeholder="Search..."
          value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="text-field w-full p-2 border rounded"
          />
        </div>
      </div>

      <div className="purchase-list-section mt-4">
        {loading && <p>Loading...</p>}
        {error && <p className="text-red-500">{error}</p>}
        <div>
          {!loading && !error && (
            <table className="min-w-full bg-white border border-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-2 border-b">Name</th>
                  <th className="px-4 py-2 border-b">Invoice #</th>
                  <th className="px-4 py-2 border-b">Date</th>
                  <th className="px-4 py-2 border-b">Sku</th>
                  <th className="px-4 py-2 border-b">Price</th>
                  <th className="px-4 py-2 border-b">Quantity</th>
                  <th className="px-4 py-2 border-b">Total</th>
                  <th className="px-4 py-2 border-b">Technician</th>
                  <th className="px-4 py-2 border-b">Customer Name</th>
                  <th className="px-4 py-2 border-b">Job ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => (
                  <tr key={item.id}>
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {item.name}
                  </Link>
                  </td>
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {item.invoiceNum || 'N/A'}
                  </Link>
                  </td> {/* Handle cases where invoiceNum might be null/undefined */}
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {shortDate(item.date)}
                  </Link>
                  </td>
                  <td className="px-4 py-2 border-b">
 <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
 {item.sku}
 </Link>
 </td>

 <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {`$${(item.price / 100).toFixed(2)}`}
                  </Link>
                  </td>
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {item.quantityString}
                  </Link>
                  </td>
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {`$${(item.total / 100).toFixed(2)}`}
                  </Link>
                  </td>
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {item.techName}
                  </Link>
                  </td>
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {item.customerName}
                  </Link>
                  </td>
                  <td className="px-4 py-2 border-b">
                  <Link to={`/company/purchasedItems/detail/${item.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                  {item.jobId}
                  </Link>
                  </td>
                </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Load More Button */}
      <div className="flex justify-center mt-4">
        <button onClick={fetchMorePurchasedItems} className="py-2 px-4 bg-[#2B600F] text-white rounded-md hover:bg-[#3a7f1a] disabled:opacity-50" disabled={loading}>
          Load More
        </button>
      </div>
      {/* Placeholder for sheets/modals that appear (like AddNewReceipt, Filter options) */}
      {/* You might use conditional rendering and separate modal components for these in React */}

      {/* Basic Filter Modal Structure */}
      {showFilterModal && (
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
      )}
    </div>
  );
};

export default PurchaseListView;
