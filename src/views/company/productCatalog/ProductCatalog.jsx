import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  endAt,
  getCountFromServer,
  getDocs,
  limit as queryLimit,
  orderBy,
  query,
  setDoc,
  startAfter,
  startAt,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  buildProductFromVendorItem,
  getProductDisplayName,
  getProductSellPriceCents,
  isProductAvailableForPartPurchase,
  productCatalogCollectionRef,
  productCatalogDocRef,
} from "../../../utils/productCatalog";

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const ALL_FILTER_VALUE = "all";

const SORT_OPTIONS = [
  { value: "nameAsc", label: "Name A-Z", field: "commonName", direction: "asc" },
  { value: "nameDesc", label: "Name Z-A", field: "commonName", direction: "desc" },
  { value: "categoryAsc", label: "Category A-Z", field: "category", direction: "asc" },
  { value: "sellPriceHigh", label: "Sell price high-low", field: "sellPrice", direction: "desc" },
  { value: "sellPriceLow", label: "Sell price low-high", field: "sellPrice", direction: "asc" },
  { value: "updatedNewest", label: "Recently updated", field: "updatedAt", direction: "desc" },
  { value: "updatedOldest", label: "Oldest updated", field: "updatedAt", direction: "asc" },
];

const money = (cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(cents || 0) / 100);

const centsFromDollarInput = (value) => {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const normalizeFilterValue = (value) => String(value || "").trim();

const getUniqueOptions = (items, key) =>
  Array.from(new Set(items.map((item) => normalizeFilterValue(item[key])).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

const linkedVendorItemCount = (product = {}) => {
  const linkedIds = product.vendorItemIds || product.storeItemsIds || [];
  const linkedNames = product.storeItems || [];
  return Math.max(Array.isArray(linkedIds) ? linkedIds.length : 0, Array.isArray(linkedNames) ? linkedNames.length : 0);
};

const ProductCatalog = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const location = useLocation();
  const settingsCatalogContext = location.pathname.toLowerCase().startsWith("/company/settings");
  const productCatalogReconciliationPath = "/company/product-catalog/reconciliation";
  const vendorItemsPath = settingsCatalogContext ? "/company/settings/vendor-items" : "/company/items";
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [totalProductCount, setTotalProductCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [subCategoryFilter, setSubCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [uomFilter, setUomFilter] = useState(ALL_FILTER_VALUE);
  const [billableFilter, setBillableFilter] = useState(ALL_FILTER_VALUE);
  const [sortOption, setSortOption] = useState("nameAsc");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCursors, setPageCursors] = useState([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "Misc",
    UOM: "Unit",
    sellPrice: "",
  });

  const selectedSort = useMemo(
    () => SORT_OPTIONS.find((option) => option.value === sortOption) || SORT_OPTIONS[0],
    [sortOption]
  );

  const normalizedSearch = searchTerm.trim();
  const searchActive = normalizedSearch.length > 0;
  const activeFilterCount = [
    categoryFilter,
    subCategoryFilter,
    uomFilter,
    billableFilter,
  ].filter((value) => value !== ALL_FILTER_VALUE).length;

  const buildCatalogQuery = useCallback(
    ({ cursor = null, includePagination = true } = {}) => {
      const constraints = [];
      const sortField = searchActive ? "commonName" : selectedSort.field;
      const sortDirection = searchActive ? "asc" : selectedSort.direction;

      constraints.push(orderBy(sortField, sortDirection));

      if (searchActive && !cursor) {
        constraints.push(startAt(normalizedSearch));
      }

      if (cursor && includePagination) {
        constraints.push(startAfter(cursor));
      }

      if (searchActive) {
        constraints.push(endAt(`${normalizedSearch}\uf8ff`));
      }

      if (includePagination) {
        constraints.push(queryLimit(pageSize + 1));
      }

      return query(productCatalogCollectionRef(db, recentlySelectedCompany), ...constraints);
    },
    [normalizedSearch, pageSize, recentlySelectedCompany, searchActive, selectedSort.direction, selectedSort.field]
  );

  const mapProductDoc = (productDoc) => {
    const data = productDoc.data();
    return {
      id: productDoc.id,
      ...data,
      commonName: data.commonName || data.name || "",
      category: data.category || "",
      subCategory: data.subCategory || "",
      UOM: data.UOM || data.uom || "",
      sellPrice: Number(data.sellPrice ?? data.billingRate ?? data.defaultSellPrice ?? 0),
      billable: Boolean(data.billable),
      active: data.active !== false,
      availableForPartPurchase: isProductAvailableForPartPurchase(data),
    };
  };

  const loadCatalogPage = useCallback(
    async ({ page = 1, cursor = null } = {}) => {
      if (!recentlySelectedCompany) {
        setProducts([]);
        setTotalProductCount(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [productSnap, countSnap] = await Promise.all([
          getDocs(buildCatalogQuery({ cursor })),
          getCountFromServer(buildCatalogQuery({ includePagination: false })),
        ]);

        const docs = productSnap.docs.slice(0, pageSize);
        setProducts(docs.map(mapProductDoc));
        setHasNextPage(productSnap.docs.length > pageSize);
        setTotalProductCount(countSnap.data().count || 0);
        setCurrentPage(page);
        setPageCursors((current) => {
          const next = current.slice(0, page);
          next[page - 1] = docs[docs.length - 1] || null;
          return next;
        });
      } catch (error) {
        console.error("Unable to load product catalog:", error);
        toast.error("Could not load the Product Catalog.");
      } finally {
        setLoading(false);
      }
    },
    [buildCatalogQuery, pageSize, recentlySelectedCompany]
  );

  useEffect(() => {
    setPageCursors([]);
    loadCatalogPage({ page: 1 });
  }, [loadCatalogPage]);

  const searchMatchedProducts = useMemo(() => {
    const lowerSearch = searchTerm.trim().toLowerCase();
    if (!lowerSearch || searchActive) return products;

    return products.filter((product) =>
      [
        getProductDisplayName(product),
        product.description,
        product.specificName,
        product.category,
        product.subCategory,
        product.UOM,
        product.sku,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(lowerSearch))
    );
  }, [products, searchActive, searchTerm]);

  const categoryOptions = useMemo(() => getUniqueOptions(products, "category"), [products]);
  const subCategoryOptions = useMemo(() => getUniqueOptions(products, "subCategory"), [products]);
  const uomOptions = useMemo(() => getUniqueOptions(products, "UOM"), [products]);

  const filteredProducts = useMemo(() => {
    return searchMatchedProducts.filter((product) => {
      if (categoryFilter !== ALL_FILTER_VALUE && product.category !== categoryFilter) return false;
      if (subCategoryFilter !== ALL_FILTER_VALUE && product.subCategory !== subCategoryFilter) return false;
      if (uomFilter !== ALL_FILTER_VALUE && product.UOM !== uomFilter) return false;
      if (billableFilter === "billable" && !product.billable) return false;
      if (billableFilter === "nonBillable" && product.billable) return false;
      return true;
    });
  }, [billableFilter, categoryFilter, searchMatchedProducts, subCategoryFilter, uomFilter]);

  const pageCount = Math.max(1, Math.ceil(totalProductCount / pageSize));
  const pageStart = totalProductCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min((currentPage - 1) * pageSize + products.length, totalProductCount);
  const visibleStart = filteredProducts.length === 0 ? 0 : pageStart;
  const visibleEnd = filteredProducts.length === 0 ? 0 : pageStart + filteredProducts.length - 1;

  const resultSummaryText = searchActive
    ? `Showing ${visibleStart}-${visibleEnd} of ${totalProductCount} matching product${totalProductCount === 1 ? "" : "s"}`
    : `Showing ${pageStart}-${pageEnd} of ${totalProductCount} product${totalProductCount === 1 ? "" : "s"}`;

  const totalLinkedVendorItemsOnPage = useMemo(
    () => products.reduce((total, product) => total + linkedVendorItemCount(product), 0),
    [products]
  );

  const updateForm = (updates) => {
    setForm((current) => ({ ...current, ...updates }));
  };

  const clearFilters = () => {
    setSearchTerm("");
    setCategoryFilter(ALL_FILTER_VALUE);
    setSubCategoryFilter(ALL_FILTER_VALUE);
    setUomFilter(ALL_FILTER_VALUE);
    setBillableFilter(ALL_FILTER_VALUE);
    setSortOption("nameAsc");
  };

  const closeCreateModal = () => {
    if (saving) return;
    setIsCreateModalOpen(false);
  };

  const createProduct = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;
    const productName = form.name.trim();
    if (!productName) {
      toast.error("Product name is required.");
      return;
    }

    setSaving(true);
    try {
      const productId = "com_prod_" + uuidv4();
      const product = buildProductFromVendorItem({
        productId,
        vendorItem: {},
        overrides: {
          name: productName,
          description: form.description,
          category: form.category || "Misc",
          UOM: form.UOM || "Unit",
          sellPrice: centsFromDollarInput(form.sellPrice),
        },
        source: "manualProductCatalog",
      });

      await setDoc(productCatalogDocRef(db, recentlySelectedCompany, productId), product);
      setForm({ name: "", description: "", category: "Misc", UOM: "Unit", sellPrice: "" });
      setIsCreateModalOpen(false);
      toast.success("Product created.");
      loadCatalogPage({ page: 1 });
    } catch (error) {
      console.error("Unable to create product:", error);
      toast.error("Could not create this product.");
    } finally {
      setSaving(false);
    }
  };

  const goToPreviousPage = () => {
    if (currentPage <= 1) return;
    const previousPage = currentPage - 1;
    const previousCursor = previousPage > 1 ? pageCursors[previousPage - 2] : null;
    loadCatalogPage({ page: previousPage, cursor: previousCursor });
  };

  const goToNextPage = () => {
    if (!hasNextPage) return;
    loadCatalogPage({ page: currentPage + 1, cursor: pageCursors[currentPage - 1] });
  };

  if (!recentlySelectedCompany) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Select a company to view the Product Catalog.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Product Catalog</p>
              <h1 className="mt-1 text-3xl font-bold text-slate-950">Products</h1>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">
                Products are the generic items used for jobs and invoices. Vendor Items stay connected underneath for costs, receipts, and audit history.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
              >
                Add new
              </button>
              <Link
                to={productCatalogReconciliationPath}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
              >
                Product Catalog Reconciliation
              </Link>
              <Link
                to={vendorItemsPath}
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Vendor Items
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Products</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{totalProductCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Current Page</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{products.length}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Linked Vendor Items On Page</p>
            <p className="mt-2 text-2xl font-bold text-blue-950">{totalLinkedVendorItemsOnPage}</p>
          </div>
        </section>

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
                <input
                  className="w-full rounded-md border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  type="text"
                  name="search"
                  placeholder="Search products"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
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
              onChange={(event) => setSubCategoryFilter(event.target.value)}
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
              onChange={(event) => setUomFilter(event.target.value)}
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
              onChange={(event) => setBillableFilter(event.target.value)}
              aria-label="Filter by billable status"
            >
              <option value={ALL_FILTER_VALUE}>All Billing</option>
              <option value="billable">Billable</option>
              <option value="nonBillable">Not Billable</option>
            </select>

            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={sortOption}
              onChange={(event) => setSortOption(event.target.value)}
              aria-label="Sort products"
              disabled={searchActive}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                aria-label="Rows per page"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
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

          <div className="overflow-x-auto border-t border-slate-200">
            <table className="min-w-[1040px] w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 px-5 py-3">Product</th>
                  <th className="border-b border-slate-200 px-5 py-3">Category</th>
                  <th className="border-b border-slate-200 px-5 py-3">Subcategory</th>
                  <th className="border-b border-slate-200 px-5 py-3">UOM</th>
                  <th className="border-b border-slate-200 px-5 py-3">Billable</th>
                  <th className="border-b border-slate-200 px-5 py-3">Sell Price</th>
                  <th className="border-b border-slate-200 px-5 py-3">Vendor Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-sm text-slate-500">Loading products...</td>
                  </tr>
                ) : filteredProducts.length ? (
                  filteredProducts.map((product) => (
                    <tr key={product.id} className="align-top hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-950">{getProductDisplayName(product)}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{product.description || product.specificName || "--"}</p>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">{product.category || "--"}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">{product.subCategory || "--"}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">{product.UOM || "--"}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${product.billable ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {product.billable ? "Billable" : "Not Billable"}
                        </span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${product.availableForPartPurchase ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                          {product.availableForPartPurchase ? "Part Purchase" : "Unavailable"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-slate-900">{money(getProductSellPriceCents(product))}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                          {linkedVendorItemCount(product)}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                      No products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <div>{resultSummaryText}</div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || currentPage === 1}
                onClick={goToPreviousPage}
              >
                Previous
              </button>
              <span className="px-2 font-semibold text-slate-700">
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || !hasNextPage}
                onClick={goToNextPage}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <form onSubmit={createProduct}>
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Create Product</h2>
                  <p className="mt-1 text-sm text-slate-500">Add a generic item without choosing a vendor yet.</p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
                <label className="block text-sm font-semibold text-slate-700">
                  Product Name
                  <input
                    value={form.name}
                    onChange={(event) => updateForm({ name: event.target.value })}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Generic product name"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Description
                  <textarea
                    value={form.description}
                    onChange={(event) => updateForm({ description: event.target.value })}
                    rows={3}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Category
                    <input
                      value={form.category}
                      onChange={(event) => updateForm({ category: event.target.value })}
                      className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    UOM
                    <input
                      value={form.UOM}
                      onChange={(event) => updateForm({ UOM: event.target.value })}
                      className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                </div>
                <label className="block text-sm font-semibold text-slate-700">
                  Sell Price
                  <input
                    value={form.sellPrice}
                    onChange={(event) => updateForm({ sellPrice: event.target.value.replace(/[^0-9.]/g, "") })}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="0.00"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={saving}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? "Creating..." : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductCatalog;
