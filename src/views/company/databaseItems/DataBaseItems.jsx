import React, { useState, useEffect, useContext, useMemo } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, orderBy } from "firebase/firestore";
import { Link } from "react-router-dom";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const ALL_FILTER_VALUE = "all";

const SORT_OPTIONS = [
  { value: "nameAsc", label: "Name A-Z" },
  { value: "nameDesc", label: "Name Z-A" },
  { value: "categoryAsc", label: "Category A-Z" },
  { value: "rateHigh", label: "Cost high-low" },
  { value: "rateLow", label: "Cost low-high" },
  { value: "sellPriceHigh", label: "Sell price high-low" },
  { value: "sellPriceLow", label: "Sell price low-high" },
  { value: "updatedNewest", label: "Recently updated" },
  { value: "updatedOldest", label: "Oldest updated" },
  { value: "timesPurchasedHigh", label: "Most purchased" },
];

const normalizeFilterValue = (value) => String(value || "").trim();

const getUniqueOptions = (items, key) =>
  Array.from(new Set(items.map((item) => normalizeFilterValue(item[key])).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base" });

const compareNumber = (left, right) => (Number(left || 0) > Number(right || 0) ? 1 : Number(left || 0) < Number(right || 0) ? -1 : 0);

const DatabaseItems = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { can } = useCompanyPermissions();

  const [genericItemList, setGenericItemList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [subCategoryFilter, setSubCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [uomFilter, setUomFilter] = useState(ALL_FILTER_VALUE);
  const [billableFilter, setBillableFilter] = useState(ALL_FILTER_VALUE);
  const [sortOption, setSortOption] = useState("nameAsc");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    (async () => {
      if (!recentlySelectedCompany) {
        setGenericItemList([]);
        return;
      }

      try {
        //Get Generic Data Base Items
        let genericItemQuery = query(
          collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"),
          orderBy("name")
        );
        const genericItemQuerySnapshot = await getDocs(genericItemQuery);
        const items = genericItemQuerySnapshot.docs.map((itemDoc) => {
          const itemData = itemDoc.data();
          const dateUpdated = itemData.dateUpdated?.toDate ? itemData.dateUpdated.toDate() : new Date();
          const formattedDate1 = format(dateUpdated, "MM / d / yyyy");

          const rateCents = Number(itemData.rate || 0);
          const rateDouble = rateCents / 100;
          const formattedRateUSD = formatCurrency(rateDouble);

          const sellPriceCents = Number(itemData.sellPrice ?? itemData.billingRate ?? 0);
          const sellPriceDouble = sellPriceCents / 100;
          const formattedSellPriceUSD = formatCurrency(sellPriceDouble);

          return {
            UOM: itemData.UOM || "",
            billable: Boolean(itemData.billable),
            category: itemData.category || "",
            color: itemData.color,
            dateUpdated: formattedDate1,
            dateUpdatedMillis: dateUpdated.getTime(),
            description: itemData.description,
            id: itemData.id || itemDoc.id,
            name: itemData.name,
            rateCents,
            rate: formattedRateUSD,
            size: itemData.size,
            sku: itemData.sku,
            storeName: itemData.storeName,
            subCategory: itemData.subCategory,
            timesPurchased: Number(itemData.timesPurchased || 0),
            venderId: itemData.venderId,
            label: itemData.name + " " + itemData.rate + " " + itemData.sku,
            sellPriceCents,
            sellPrice: formattedSellPriceUSD,
            billingRate: formattedSellPriceUSD,
            tracking: itemData.tracking || "",
          };
        });

        setGenericItemList(items);
      } catch (error) {
        console.log("Error");
        console.log(error);
      }
    })();
  }, [recentlySelectedCompany]);

  const searchMatchedItems = useMemo(() => {
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

  const categoryOptions = useMemo(() => getUniqueOptions(searchMatchedItems, "category"), [searchMatchedItems]);
  const subCategoryOptions = useMemo(() => getUniqueOptions(searchMatchedItems, "subCategory"), [searchMatchedItems]);
  const uomOptions = useMemo(() => getUniqueOptions(searchMatchedItems, "UOM"), [searchMatchedItems]);

  const filteredItems = useMemo(() => {
    return searchMatchedItems.filter((item) => {
      if (categoryFilter !== ALL_FILTER_VALUE && item.category !== categoryFilter) return false;
      if (subCategoryFilter !== ALL_FILTER_VALUE && item.subCategory !== subCategoryFilter) return false;
      if (uomFilter !== ALL_FILTER_VALUE && item.UOM !== uomFilter) return false;
      if (billableFilter === "billable" && !item.billable) return false;
      if (billableFilter === "nonBillable" && item.billable) return false;
      return true;
    });
  }, [billableFilter, categoryFilter, searchMatchedItems, subCategoryFilter, uomFilter]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((left, right) => {
      switch (sortOption) {
        case "nameDesc":
          return compareText(right.name, left.name);
        case "categoryAsc":
          return compareText(left.category, right.category) || compareText(left.subCategory, right.subCategory) || compareText(left.name, right.name);
        case "rateHigh":
          return compareNumber(right.rateCents, left.rateCents) || compareText(left.name, right.name);
        case "rateLow":
          return compareNumber(left.rateCents, right.rateCents) || compareText(left.name, right.name);
        case "sellPriceHigh":
          return compareNumber(right.sellPriceCents, left.sellPriceCents) || compareText(left.name, right.name);
        case "sellPriceLow":
          return compareNumber(left.sellPriceCents, right.sellPriceCents) || compareText(left.name, right.name);
        case "updatedNewest":
          return compareNumber(right.dateUpdatedMillis, left.dateUpdatedMillis) || compareText(left.name, right.name);
        case "updatedOldest":
          return compareNumber(left.dateUpdatedMillis, right.dateUpdatedMillis) || compareText(left.name, right.name);
        case "timesPurchasedHigh":
          return compareNumber(right.timesPurchased, left.timesPurchased) || compareText(left.name, right.name);
        case "nameAsc":
        default:
          return compareText(left.name, right.name);
      }
    });
  }, [filteredItems, sortOption]);

  const activeFilterCount = [
    categoryFilter,
    subCategoryFilter,
    uomFilter,
    billableFilter,
  ].filter((value) => value !== ALL_FILTER_VALUE).length;

  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedItems = sortedItems.slice(startIndex, startIndex + pageSize);
  const displayStart = sortedItems.length === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(startIndex + pageSize, sortedItems.length);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  useEffect(() => {
    setCurrentPage(1);
  }, [billableFilter, categoryFilter, pageSize, searchTerm, sortOption, subCategoryFilter, uomFilter]);

  const clearFilters = () => {
    setSearchTerm("");
    setCategoryFilter(ALL_FILTER_VALUE);
    setSubCategoryFilter(ALL_FILTER_VALUE);
    setUomFilter(ALL_FILTER_VALUE);
    setBillableFilter(ALL_FILTER_VALUE);
    setSortOption("nameAsc");
  };

  const resultSummaryText = `Showing ${displayStart}-${displayEnd} of ${sortedItems.length}${
    sortedItems.length !== genericItemList.length ? ` filtered (${genericItemList.length} total)` : ""
  }`;

  function formatCurrency(number, locale = "en-US", currency = "USD") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
    }).format(number);
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        {/* Header */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company catalog</p>
              <h2 className="mt-1 text-3xl font-bold text-slate-950">Database Items</h2>
            <p className="text-sm text-slate-500 mt-1">Browse and manage your company catalog.</p>
          </div>
            <div className="flex flex-wrap gap-2">
            {can("852") && (
                <Link to="/company/items/bulk-upload" className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">
                Upload Bulk
            </Link>
            )}
            {can("852") && (
              <Link
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
                to={`/company/items/createNew`}
              >
                Create New
              </Link>
            )}
            </div>
          </div>
        </section>

        {/* Controls */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 xl:grid-cols-[minmax(280px,1fr)_repeat(5,minmax(150px,190px))_auto]">
            <div className="w-full">
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
                  className="w-full rounded-md border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  type="text"
                  name="search"
                  placeholder="Search items"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value={ALL_FILTER_VALUE}>All Categories</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>

            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={subCategoryFilter}
              onChange={(e) => setSubCategoryFilter(e.target.value)}
              aria-label="Filter by subcategory"
            >
              <option value={ALL_FILTER_VALUE}>All Subcategories</option>
              {subCategoryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>

            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={uomFilter}
              onChange={(e) => setUomFilter(e.target.value)}
              aria-label="Filter by UOM"
            >
              <option value={ALL_FILTER_VALUE}>All UOM</option>
              {uomOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>

            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={billableFilter}
              onChange={(e) => setBillableFilter(e.target.value)}
              aria-label="Filter by billable status"
            >
              <option value={ALL_FILTER_VALUE}>All Billing</option>
              <option value="billable">Billable</option>
              <option value="nonBillable">Not Billable</option>
            </select>

            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              aria-label="Sort database items"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <div className="flex items-center gap-2">
                <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="Rows per page"
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              {(searchTerm || activeFilterCount > 0 || sortOption !== "nameAsc") && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>{resultSummaryText}</div>
            <div>{activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active` : "No field filters active"}</div>
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
                  <th className="px-5 py-3 border-b border-slate-200">Billable</th>
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

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${item.billable ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {item.billable ? "Billable" : "Not Billable"}
                        </span>
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
                    <td colSpan={11} className="px-6 py-12 text-center">
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
              {resultSummaryText}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </button>
              <span className="px-2 font-semibold text-slate-700">
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === pageCount}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default DatabaseItems;
