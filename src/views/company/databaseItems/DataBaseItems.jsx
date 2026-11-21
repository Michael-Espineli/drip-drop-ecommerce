import React, { useState, useEffect, useContext, useMemo } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { getDocs } from "firebase/firestore";
import { Link, useLocation } from "react-router-dom";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { getItemPhotoUrl } from "../../../utils/itemPhotos";
import { findLinkedProductForVendorItem, getProductDisplayName, getProductSellPriceCents, isMergedCatalogRecord, productCatalogCollectionRef, vendorItemsCollectionRef } from "../../../utils/productCatalog";
import { catalogDuplicatesPath } from "../productCatalog/catalogMergeRecords";
import WorkspaceHeader from "../../../components/workspace/WorkspaceHeader";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";
import toast from "react-hot-toast";
import CreateVendorItemModal from "./CreateVendorItemModal";

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
  const location = useLocation();
  const vendorItemsBasePath = location.pathname.toLowerCase().startsWith("/company/settings")
    ? "/company/settings/vendor-items"
    : "/company/items";

  const [genericItemList, setGenericItemList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [subCategoryFilter, setSubCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [uomFilter, setUomFilter] = useState(ALL_FILTER_VALUE);
  const [billableFilter, setBillableFilter] = useState(ALL_FILTER_VALUE);
  const [sortOption, setSortOption] = useState("nameAsc");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => { setCreateOpen(false); }, [recentlySelectedCompany]);

  useEffect(() => {
    let active = true;
    setGenericItemList([]);
    setLoading(true);
    setLoadError("");
    const load = async () => {
      if (!recentlySelectedCompany) { setLoading(false); return; }
      try {
        const [vendorSnap, productSnap] = await Promise.all([
          getDocs(vendorItemsCollectionRef(db, recentlySelectedCompany)),
          getDocs(productCatalogCollectionRef(db, recentlySelectedCompany)),
        ]);
        if (!active) return;
        const products = productSnap.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
        const items = vendorSnap.docs.map((entry) => {
          const data = { ...entry.data(), id: entry.id };
          const product = findLinkedProductForVendorItem(data, products);
          const rawDate = data.dateUpdated || data.updatedAt || data.createdAt;
          const date = rawDate ? rawDate.toDate?.() || new Date(rawDate) : null;
          const millis = date?.getTime() || 0;
          const rateCents = Number(data.rate ?? data.cost ?? 0);
          const sellPriceCents = product ? getProductSellPriceCents(product) : Number(data.sellPrice ?? data.billingRate ?? 0);
          return {
            ...data, UOM: data.UOM || data.uom || "", category: data.category || "", subCategory: data.subCategory || "",
            billable: Boolean(data.billable), storeName: data.storeName || data.vendorName || "",
            dateUpdated: millis ? format(date, "MMM d, yyyy") : "--", dateUpdatedMillis: millis,
            rateCents, rate: formatCurrency(rateCents / 100), sellPriceCents, sellPrice: formatCurrency(sellPriceCents / 100),
            timesPurchased: Number(data.timesPurchased || 0), photoUrl: getItemPhotoUrl(data),
            productId: product?.id || "", productName: product ? getProductDisplayName(product) : "",
          };
        });
        setGenericItemList(items.filter(item => !isMergedCatalogRecord(item)));
      } catch (error) {
        if (active) setLoadError(userFacingErrorMessage(error, "Could not load vendor items."));
      } finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [recentlySelectedCompany, reload]);

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
        item.productName,
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

  const filterClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const linkedProductsOnPage = new Set(paginatedItems.map((item) => item.productId).filter(Boolean)).size;
  const filters = [
    { label: "Filter by category", value: categoryFilter, set: setCategoryFilter, all: "All Categories", options: categoryOptions },
    { label: "Filter by subcategory", value: subCategoryFilter, set: setSubCategoryFilter, all: "All Subcategories", options: subCategoryOptions },
    { label: "Filter by UOM", value: uomFilter, set: setUomFilter, all: "All UOM", options: uomOptions },
    { label: "Filter by billable status", value: billableFilter, set: setBillableFilter, all: "All Billing", options: [{ value: "billable", label: "Billable" }, { value: "nonBillable", label: "Not Billable" }] },
  ];
  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <WorkspaceHeader title="Vendor Items" eyebrow="Vendor Item Catalog" description="Supplier-specific purchasable items, costs, SKUs, and connected products."
          actions={<>
            {can("852") && <button type="button" disabled={!recentlySelectedCompany} onClick={() => setCreateOpen(true)} className={workspaceButtonClass({ tone: "blue" })}>Add new</button>}
            <Link to="/company/product-catalog/reconciliation" className={workspaceButtonClass({ tone: "blue" })}>Product Catalog Reconciliation</Link>
            {can("854") && <Link to={`${catalogDuplicatesPath}?kind=vendorItem`} className={workspaceButtonClass({ tone: "slate" })}>Merge Duplicates</Link>}
            {can("910") && <Link to={`${vendorItemsBasePath}/bulk-upload`} className={workspaceButtonClass({ tone: "slate" })}>Upload Vendor Items</Link>}
            <Link to="/company/product-catalog" className={workspaceButtonClass({ tone: "slate" })}>Product Catalog</Link>
          </>}
        />
        <section className="grid gap-3 md:grid-cols-3">
          {[['Vendor Items', genericItemList.length], ['Visible Results', sortedItems.length], ['Linked Products On Page', linkedProductsOnPage]].map(([label, value], index) => <div key={label} className={`rounded-lg border p-4 shadow-sm ${index === 2 ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
            <p className={`text-xs font-bold uppercase tracking-wide ${index === 2 ? "text-blue-700" : "text-slate-500"}`}>{label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
          </div>)}
        </section>
        {loadError && <div role="alert" className="rounded-lg border border-rose-200 bg-white p-4"><p>{loadError}</p><button type="button" onClick={() => setReload((value) => value + 1)} className={workspaceButtonClass({ tone: "blue" })}>Retry vendor items</button></div>}
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <input className={filterClass} aria-label="Search vendor items" placeholder="Search vendor items" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
            {filters.map((field) => <select key={field.label} aria-label={field.label} value={field.value} onChange={(event) => field.set(event.target.value)} className={filterClass}>
              <option value={ALL_FILTER_VALUE}>{field.all}</option>
              {field.options.map((option) => <option key={typeof option === 'string' ? option : option.value} value={typeof option === 'string' ? option : option.value}>{typeof option === 'string' ? option : option.label}</option>)}
            </select>)}
            <select aria-label="Sort vendor items" value={sortOption} onChange={(event) => setSortOption(event.target.value)} className={filterClass}>{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Rows per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className={filterClass}>{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}</select>
              {(searchTerm || activeFilterCount || sortOption !== "nameAsc") ? <button type="button" onClick={clearFilters} className={workspaceButtonClass({ tone: "slate" })}>Clear</button> : null}
            </div>
          </div>
          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>{resultSummaryText}</span><span>{activeFilterCount ? `${activeFilterCount} filters active` : "No field filters active"}</span></div>
          <div className="overflow-x-auto">
            <table className="min-w-[1160px] w-full">
              <thead className="bg-slate-50"><tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">{['Vendor Item', 'Category', 'Subcategory', 'UOM', 'Availability', 'Unit Cost', 'Product Sell Price', 'Product', 'Vendor', 'Actions'].map((label) => <th key={label} className="border-b border-slate-200 px-5 py-3">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {loading ? <tr><td colSpan={10} className="px-5 py-8 text-sm text-slate-500">Loading vendor items...</td></tr> : paginatedItems.length ? paginatedItems.map((item) => <tr key={item.id} className="align-top hover:bg-slate-50">
                  <td className="px-5 py-3"><Link to={`${vendorItemsBasePath}/detail/${item.id}`} className="font-semibold text-blue-700 hover:text-blue-900">{item.name || "Vendor item"}</Link><p className="mt-1 text-xs leading-5 text-slate-500">{item.description || "--"}</p>{item.sku && <p className="mt-1 text-xs text-slate-400">SKU {item.sku}</p>}</td>
                  <td className="px-5 py-3 text-sm text-slate-700">{item.category || "--"}</td>
                  <td className="px-5 py-3 text-sm text-slate-700">{item.subCategory || "--"}</td>
                  <td className="px-5 py-3 text-sm text-slate-700">{item.UOM || "--"}</td>
                  <td className="px-5 py-3 text-sm"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${item.billable ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>{item.billable ? "Billable" : "Not Billable"}</span>{item.active === false && <p className="mt-1 text-xs text-slate-500">Inactive</p>}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-slate-900">{item.rate}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-slate-900">{item.sellPrice}{!item.productId && <p className="mt-1 text-xs font-normal text-slate-500">Vendor default</p>}</td>
                  <td className="px-5 py-3 text-sm">{item.productId ? <Link to={`/company/product-catalog/${item.productId}`} className="font-semibold text-blue-700 hover:underline">{item.productName}</Link> : <span className="text-slate-500">Not connected</span>}</td>
                  <td className="px-5 py-3 text-sm text-slate-700">{item.storeName || "--"}</td>
                  <td className="px-5 py-3"><Link to={`${vendorItemsBasePath}/detail/${item.id}`} className={workspaceButtonClass({ tone: "slate", className: "text-xs" })}>View</Link></td>
                </tr>) : <tr><td colSpan={10} className="px-5 py-8 text-sm text-slate-500">{loadError ? "Vendor items could not be loaded." : "No vendor items found. Adjust your filters or add a new vendor item."}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>{resultSummaryText}</span><div className="flex items-center gap-2">
              <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} className={workspaceButtonClass({ tone: "slate" })}>Previous</button>
              <span className="px-2 font-semibold">Page {currentPage} of {pageCount}</span>
              <button type="button" disabled={currentPage === pageCount} onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} className={workspaceButtonClass({ tone: "slate" })}>Next</button>
            </div>
          </div>
        </section>
      </div>
      {createOpen && can("852") && <CreateVendorItemModal key={recentlySelectedCompany} onClose={() => setCreateOpen(false)} onCreated={() => {
        setCreateOpen(false);
        setReload((value) => value + 1);
        toast.success("Vendor item created.");
      }} />}
    </div>
  );
};
export default DatabaseItems;
