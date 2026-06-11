import React, { useState, useEffect, useContext, useMemo } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, orderBy } from "firebase/firestore";
import { Link } from "react-router-dom";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const DatabaseItems = () => {
  const { name, recentlySelectedCompany } = useContext(Context);
  const { can } = useCompanyPermissions();

  const [genericItemList, setGenericItemList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        //Get Generic Data Base Items
        let genericItemQuery = query(
          collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"),
          orderBy("name")
        );
        const genericItemQuerySnapshot = await getDocs(genericItemQuery);
        setGenericItemList([]);
        genericItemQuerySnapshot.forEach((doc) => {
          const itemData = doc.data();
          const dateUpdated = itemData.dateUpdated?.toDate ? itemData.dateUpdated.toDate() : new Date();
          const formattedDate1 = format(dateUpdated, "MM / d / yyyy");

          let rateDouble = Number(itemData.rate || 0) / 100;
          let formattedRateUSD = formatCurrency(rateDouble);

          let sellPriceDouble = Number(itemData.sellPrice ?? itemData.billingRate ?? 0) / 100;
          let formattedSellPriceUSD = formatCurrency(sellPriceDouble);

          const genericItem = {
            UOM: itemData.UOM || "",
            billable: itemData.billable,
            category: itemData.category,
            color: itemData.color,
            dateUpdated: formattedDate1,
            description: itemData.description,
            id: itemData.id,
            name: itemData.name,
            rate: formattedRateUSD,
            size: itemData.size,
            sku: itemData.sku,
            storeName: itemData.storeName,
            subCategory: itemData.subCategory,
            timesPurchased: itemData.timesPurchased,
            venderId: itemData.venderId,
            label: itemData.name + " " + itemData.rate + " " + itemData.sku,
            sellPrice: formattedSellPriceUSD,
            billingRate: formattedSellPriceUSD,
            tracking: itemData.tracking || "",
          };
          setGenericItemList((genericItemList) => [...genericItemList, genericItem]);
        });
      } catch (error) {
        console.log("Error");
        console.log(error);
      }
    })();
  }, [recentlySelectedCompany]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return genericItemList;

    return genericItemList.filter((item) =>
      [
        item.name,
        item.description,
        item.category,
        item.subCategory,
        item.UOM,
        item.sku,
        item.storeName,
        item.tracking,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch))
    );
  }, [genericItemList, searchTerm]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedItems = filteredItems.slice(startIndex, startIndex + pageSize);
  const displayStart = filteredItems.length === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(startIndex + pageSize, filteredItems.length);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, searchTerm]);

  function formatCurrency(number, locale = "en-US", currency = "USD") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
    }).format(number);
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 sm:px-5 lg:px-8 py-8 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Database Items</h2>
            <p className="text-sm text-slate-500 mt-1">Browse and manage your company catalog.</p>
          </div>
          <div className="flex space-x-4">
            {can("852") && (
            <Link to="/company/items/bulk-upload" className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                Upload Bulk
            </Link>
            )}
            {can("852") && (
              <Link
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700"
                to={`/company/items/createNew`}
              >
                Create New
              </Link>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-xl">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
                  </svg>
                </span>

                {/* Search Bar */}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  type="text"
                  name="search"
                  placeholder="Search items"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 text-xs text-slate-500 sm:items-end">
              <label className="flex items-center gap-2">
                <span className="font-semibold text-slate-600">Rows</span>
                <select
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                Showing {displayStart}-{displayEnd} of {filteredItems.length}
                {filteredItems.length !== genericItemList.length ? ` filtered (${genericItemList.length} total)` : ""}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="min-w-[1280px] w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 border-b border-slate-200">Name</th>
                  <th className="px-5 py-3 border-b border-slate-200">Category</th>
                  <th className="px-5 py-3 border-b border-slate-200">Subcategory</th>
                  <th className="px-5 py-3 border-b border-slate-200">UOM</th>
                  <th className="px-5 py-3 border-b border-slate-200">Description</th>
                  <th className="px-5 py-3 border-b border-slate-200">Rate</th>
                  <th className="px-5 py-3 border-b border-slate-200">Sell Price</th>
                  <th className="px-5 py-3 border-b border-slate-200">SKU</th>
                  <th className="px-5 py-3 border-b border-slate-200">Vendor</th>
                  <th className="px-5 py-3 border-b border-slate-200">Tracking</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 bg-white">
                {paginatedItems?.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full hover:text-blue-700"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.name}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.category || "--"}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.subCategory || "--"}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.UOM || "--"}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-600">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.description || "--"}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.rate}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.sellPrice}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.sku}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.storeName || "--"}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.tracking || "--"}
                      </Link>
                    </td>
                  </tr>
                ))}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center">
                      <div className="mx-auto max-w-sm">
                        <div className="text-sm font-semibold text-slate-800">No database items found</div>
                        <div className="text-sm text-slate-500 mt-1">
                          {genericItemList.length === 0
                            ? "Create a new item to start building your catalog."
                            : "Adjust your search to see more catalog items."}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <div>
              Showing {displayStart}-{displayEnd} of {filteredItems.length}
              {filteredItems.length !== genericItemList.length ? ` filtered (${genericItemList.length} total)` : ""}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </button>
              <span className="px-2 font-semibold text-slate-700">
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === pageCount}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatabaseItems;
