import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { getDocs, setDoc, writeBatch } from "firebase/firestore";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  buildProductFromVendorItem,
  getProductDisplayName,
  getProductSellPriceCents,
  getVendorItemCostCents,
  getVendorItemDisplayName,
  isProductAvailableForPartPurchase,
  productCatalogCollectionRef,
  productCatalogDocRef,
  vendorItemDocRef,
  vendorItemsCollectionRef,
} from "../../../utils/productCatalog";

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const ALL_FILTER_VALUE = "all";

const SORT_OPTIONS = [
  { value: "nameAsc", label: "Name A-Z" },
  { value: "nameDesc", label: "Name Z-A" },
  { value: "categoryAsc", label: "Category A-Z" },
  { value: "sellPriceHigh", label: "Sell price high-low" },
  { value: "sellPriceLow", label: "Sell price low-high" },
  { value: "updatedNewest", label: "Recently updated" },
  { value: "updatedOldest", label: "Oldest updated" },
];

const PRODUCT_FORM_DEFAULTS = {
  name: "",
  specificName: "",
  description: "",
  category: "Misc",
  subCategory: "Misc",
  UOM: "Unit",
  sku: "",
  sellPrice: "",
  billable: true,
  active: true,
  availableForPartPurchase: true,
};

const money = (cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(cents || 0) / 100);

const centsFromDollarInput = (value) => {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const dollarsFromCents = (cents) => {
  const parsed = Number(cents || 0);
  return parsed ? (parsed / 100).toFixed(2) : "";
};

const cleanDollarInput = (value) => {
  const [dollars = "", cents = ""] = String(value || "")
    .replace(/[^0-9.]/g, "")
    .split(".");
  return cents ? `${dollars}.${cents.slice(0, 2)}` : dollars;
};

const normalizeFilterValue = (value) => String(value || "").trim();

const getUniqueOptions = (items, key) =>
  Array.from(new Set(items.map((item) => normalizeFilterValue(item[key])).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

const compareText = (left, right) =>
  String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base" });

const compareNumber = (left, right) => {
  const leftValue = Number(left || 0);
  const rightValue = Number(right || 0);
  return leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
};

const valueToDate = (value) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const valueToMillis = (value) => valueToDate(value)?.getTime() || 0;

const formatDateValue = (value) => {
  const date = valueToDate(value);
  if (!date) return "--";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const normalizeProduct = (productId, data = {}) => ({
  ...data,
  id: data.id || productId,
  commonName: data.commonName || data.name || "",
  name: data.name || data.commonName || "",
  specificName: data.specificName || "",
  category: data.category || "",
  subCategory: data.subCategory || "",
  UOM: data.UOM || data.uom || "",
  sku: data.sku || "",
  sellPrice: Number(data.sellPrice ?? data.billingRate ?? data.defaultSellPrice ?? 0),
  billingRate: Number(data.billingRate ?? data.sellPrice ?? data.defaultSellPrice ?? 0),
  billable: Boolean(data.billable),
  active: data.active !== false,
  availableForPartPurchase: isProductAvailableForPartPurchase(data),
  dateUpdatedMillis: valueToMillis(data.dateUpdated || data.updatedAt || data.createdAt),
});

const mapProductDoc = (productDoc) => normalizeProduct(productDoc.id, productDoc.data());

const mapVendorItemDoc = (vendorItemDoc) => {
  const data = vendorItemDoc.data();
  const costCents = getVendorItemCostCents(data);
  const sellPriceCents = Number(data.sellPrice ?? data.billingRate ?? 0);

  return {
    ...data,
    id: data.id || vendorItemDoc.id,
    name: data.name || "",
    description: data.description || "",
    category: data.category || "",
    subCategory: data.subCategory || "",
    UOM: data.UOM || data.uom || "",
    sku: data.sku || "",
    storeName: data.storeName || data.vendorName || "",
    costCents,
    sellPriceCents,
    dateUpdatedMillis: valueToMillis(data.dateUpdated || data.updatedAt || data.createdAt),
  };
};

const productSearchText = (product = {}) =>
  [
    product.id,
    product.name,
    product.commonName,
    product.specificName,
    product.description,
    product.category,
    product.subCategory,
    product.UOM,
    product.sku,
    product.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const linkedVendorItemCount = (product = {}) => {
  const linkedIds = product.vendorItemIds || product.storeItemsIds || [];
  const linkedNames = product.storeItems || [];
  return Math.max(Array.isArray(linkedIds) ? linkedIds.length : 0, Array.isArray(linkedNames) ? linkedNames.length : 0);
};

const productLinkedVendorItemIds = (product = {}) =>
  new Set(
    [
      ...(Array.isArray(product.vendorItemIds) ? product.vendorItemIds : []),
      ...(Array.isArray(product.storeItemsIds) ? product.storeItemsIds : []),
      product.preferredVendorItemId,
    ].filter(Boolean)
  );

const productLinkedVendorItemNames = (product = {}) =>
  new Set(
    (Array.isArray(product.storeItems) ? product.storeItems : [])
      .map((name) => getVendorItemDisplayName({ name }).toLowerCase())
      .filter(Boolean)
  );

const isVendorItemLinkedToProduct = (vendorItem = {}, product = {}) => {
  if (!product?.id) return false;
  const linkedIds = productLinkedVendorItemIds(product);
  if (vendorItem.productId === product.id || vendorItem.genericItemId === product.id) return true;
  if (linkedIds.has(vendorItem.id)) return true;

  const linkedNames = productLinkedVendorItemNames(product);
  return linkedNames.has(getVendorItemDisplayName(vendorItem).toLowerCase());
};

const productPatchFromForm = (form, productId, now = new Date()) => {
  const name = form.name.trim();
  const description = form.description.trim();
  const specificName = form.specificName.trim() || description || name;
  const sellPrice = centsFromDollarInput(form.sellPrice);
  const availableForPartPurchase = Boolean(form.availableForPartPurchase);

  return {
    id: productId,
    commonName: name,
    name,
    specificName,
    description,
    category: form.category.trim() || "Misc",
    subCategory: form.subCategory.trim() || "Misc",
    UOM: form.UOM.trim() || "Unit",
    uom: form.UOM.trim() || "Unit",
    sku: form.sku.trim(),
    sellPrice,
    billingRate: sellPrice,
    billable: Boolean(form.billable),
    active: Boolean(form.active),
    availableForPartPurchase,
    partPurchaseAvailable: availableForPartPurchase,
    dateUpdated: now,
    updatedAt: now,
  };
};

const DetailField = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value || "--"}</p>
  </div>
);

const ProductCatalog = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const location = useLocation();
  const { productId } = useParams();
  const settingsCatalogContext = location.pathname.toLowerCase().startsWith("/company/settings");
  const productCatalogBasePath = settingsCatalogContext ? "/company/settings/product-catalog" : "/company/product-catalog";
  const productCatalogReconciliationPath = "/company/product-catalog/reconciliation";
  const vendorItemsPath = settingsCatalogContext ? "/company/settings/vendor-items" : "/company/items";
  const detailMode = Boolean(productId);

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [subCategoryFilter, setSubCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [uomFilter, setUomFilter] = useState(ALL_FILTER_VALUE);
  const [billableFilter, setBillableFilter] = useState(ALL_FILTER_VALUE);
  const [sortOption, setSortOption] = useState("nameAsc");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(PRODUCT_FORM_DEFAULTS);
  const [vendorItems, setVendorItems] = useState([]);
  const [vendorItemsLoading, setVendorItemsLoading] = useState(false);

  const loadCatalog = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const productSnap = await getDocs(productCatalogCollectionRef(db, recentlySelectedCompany));
      setProducts(productSnap.docs.map(mapProductDoc));
    } catch (error) {
      console.error("Unable to load product catalog:", error);
      toast.error("Could not load the Product Catalog.");
    } finally {
      setLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const detailProduct = useMemo(
    () => (productId ? products.find((product) => product.id === productId) || null : null),
    [productId, products]
  );

  const loadConnectedVendorItems = useCallback(async () => {
    if (!recentlySelectedCompany || !detailProduct) {
      setVendorItems([]);
      setVendorItemsLoading(false);
      return;
    }

    setVendorItemsLoading(true);
    try {
      const vendorItemSnap = await getDocs(vendorItemsCollectionRef(db, recentlySelectedCompany));
      const connectedItems = vendorItemSnap.docs
        .map(mapVendorItemDoc)
        .filter((vendorItem) => isVendorItemLinkedToProduct(vendorItem, detailProduct))
        .sort((left, right) => compareText(getVendorItemDisplayName(left), getVendorItemDisplayName(right)));
      setVendorItems(connectedItems);
    } catch (error) {
      console.error("Unable to load connected vendor items:", error);
      toast.error("Could not load linked vendor items.");
    } finally {
      setVendorItemsLoading(false);
    }
  }, [detailProduct, recentlySelectedCompany]);

  useEffect(() => {
    loadConnectedVendorItems();
  }, [loadConnectedVendorItems]);

  const searchMatchedProducts = useMemo(() => {
    const lowerSearch = searchTerm.trim().toLowerCase();
    if (!lowerSearch) return products;

    return products.filter((product) => productSearchText(product).includes(lowerSearch));
  }, [products, searchTerm]);

  const categoryOptions = useMemo(() => getUniqueOptions(searchMatchedProducts, "category"), [searchMatchedProducts]);
  const subCategoryOptions = useMemo(() => getUniqueOptions(searchMatchedProducts, "subCategory"), [searchMatchedProducts]);
  const uomOptions = useMemo(() => getUniqueOptions(searchMatchedProducts, "UOM"), [searchMatchedProducts]);

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

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((left, right) => {
      switch (sortOption) {
        case "nameDesc":
          return compareText(getProductDisplayName(right), getProductDisplayName(left));
        case "categoryAsc":
          return (
            compareText(left.category, right.category) ||
            compareText(left.subCategory, right.subCategory) ||
            compareText(getProductDisplayName(left), getProductDisplayName(right))
          );
        case "sellPriceHigh":
          return compareNumber(getProductSellPriceCents(right), getProductSellPriceCents(left)) || compareText(getProductDisplayName(left), getProductDisplayName(right));
        case "sellPriceLow":
          return compareNumber(getProductSellPriceCents(left), getProductSellPriceCents(right)) || compareText(getProductDisplayName(left), getProductDisplayName(right));
        case "updatedNewest":
          return compareNumber(right.dateUpdatedMillis, left.dateUpdatedMillis) || compareText(getProductDisplayName(left), getProductDisplayName(right));
        case "updatedOldest":
          return compareNumber(left.dateUpdatedMillis, right.dateUpdatedMillis) || compareText(getProductDisplayName(left), getProductDisplayName(right));
        case "nameAsc":
        default:
          return compareText(getProductDisplayName(left), getProductDisplayName(right));
      }
    });
  }, [filteredProducts, sortOption]);

  const activeFilterCount = [
    categoryFilter,
    subCategoryFilter,
    uomFilter,
    billableFilter,
  ].filter((value) => value !== ALL_FILTER_VALUE).length;

  const pageCount = Math.max(1, Math.ceil(sortedProducts.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedProducts = sortedProducts.slice(startIndex, startIndex + pageSize);
  const displayStart = sortedProducts.length === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(startIndex + pageSize, sortedProducts.length);
  const resultSummaryText = `Showing ${displayStart}-${displayEnd} of ${sortedProducts.length}${
    sortedProducts.length !== products.length ? ` filtered (${products.length} total)` : ""
  }`;

  const totalLinkedVendorItemsOnPage = useMemo(
    () => paginatedProducts.reduce((total, product) => total + linkedVendorItemCount(product), 0),
    [paginatedProducts]
  );

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  useEffect(() => {
    setCurrentPage(1);
  }, [billableFilter, categoryFilter, pageSize, searchTerm, sortOption, subCategoryFilter, uomFilter]);

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

  const openCreateModal = () => {
    setEditingProduct(null);
    setForm(PRODUCT_FORM_DEFAULTS);
    setIsCreateModalOpen(true);
  };

  const closeProductModal = () => {
    if (saving) return;
    setIsCreateModalOpen(false);
    setEditingProduct(null);
  };

  const openEditModal = (product) => {
    setIsCreateModalOpen(false);
    setEditingProduct(product);
    setForm({
      name: getProductDisplayName(product),
      specificName: product.specificName || "",
      description: product.description || "",
      category: product.category || "Misc",
      subCategory: product.subCategory || "Misc",
      UOM: product.UOM || "Unit",
      sku: product.sku || "",
      sellPrice: dollarsFromCents(getProductSellPriceCents(product)),
      billable: Boolean(product.billable),
      active: product.active !== false,
      availableForPartPurchase: isProductAvailableForPartPurchase(product),
    });
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
      const now = new Date();
      const productIdForCreate = "com_prod_" + uuidv4();
      const baseProduct = buildProductFromVendorItem({
        productId: productIdForCreate,
        vendorItem: {},
        overrides: {
          name: productName,
          description: form.description,
          category: form.category || "Misc",
          subCategory: form.subCategory || "Misc",
          UOM: form.UOM || "Unit",
          sku: form.sku,
          sellPrice: centsFromDollarInput(form.sellPrice),
          billable: form.billable,
          active: form.active,
          availableForPartPurchase: form.availableForPartPurchase,
          partPurchaseAvailable: form.availableForPartPurchase,
        },
        source: "manualProductCatalog",
        now,
      });
      const product = {
        ...baseProduct,
        ...productPatchFromForm(form, productIdForCreate, now),
        createdAt: now,
        source: "manualProductCatalog",
      };

      await setDoc(productCatalogDocRef(db, recentlySelectedCompany, productIdForCreate), product);
      setProducts((current) => [...current, normalizeProduct(productIdForCreate, product)]);
      setForm(PRODUCT_FORM_DEFAULTS);
      setIsCreateModalOpen(false);
      toast.success("Product created.");
    } catch (error) {
      console.error("Unable to create product:", error);
      toast.error("Could not create this product.");
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany || !editingProduct) return;

    const productName = form.name.trim();
    if (!productName) {
      toast.error("Product name is required.");
      return;
    }

    setSaving(true);
    try {
      const now = new Date();
      const productPatch = productPatchFromForm(form, editingProduct.id, now);
      const batch = writeBatch(db);
      batch.set(productCatalogDocRef(db, recentlySelectedCompany, editingProduct.id), productPatch, { merge: true });

      const linkedItemsToUpdate = vendorItems.filter((vendorItem) => isVendorItemLinkedToProduct(vendorItem, editingProduct));
      linkedItemsToUpdate.slice(0, 450).forEach((vendorItem) => {
        batch.set(
          vendorItemDocRef(db, recentlySelectedCompany, vendorItem.id),
          {
            productName,
            genericItemName: productName,
          },
          { merge: true }
        );
      });

      await batch.commit();

      const nextProduct = normalizeProduct(editingProduct.id, {
        ...editingProduct,
        ...productPatch,
      });
      setProducts((current) => current.map((product) => (product.id === editingProduct.id ? nextProduct : product)));
      setVendorItems((current) =>
        current.map((vendorItem) =>
          isVendorItemLinkedToProduct(vendorItem, editingProduct)
            ? { ...vendorItem, productName, genericItemName: productName }
            : vendorItem
        )
      );
      setEditingProduct(null);
      toast.success("Product updated.");
    } catch (error) {
      console.error("Unable to update product:", error);
      toast.error("Could not update this product.");
    } finally {
      setSaving(false);
    }
  };

  const renderProductModal = () => {
    const editing = Boolean(editingProduct);
    if (!isCreateModalOpen && !editing) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
        <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
          <form onSubmit={editing ? saveProduct : createProduct}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-950">{editing ? "Edit Product" : "Create Product"}</h2>
                <p className="mt-1 text-sm text-slate-500">Manage the database item used across jobs, purchasing, and billing.</p>
              </div>
              <button
                type="button"
                onClick={closeProductModal}
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
                Specific Name
                <input
                  value={form.specificName}
                  onChange={(event) => updateForm({ specificName: event.target.value })}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Internal or detailed name"
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
                  Subcategory
                  <input
                    value={form.subCategory}
                    onChange={(event) => updateForm({ subCategory: event.target.value })}
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

                <label className="block text-sm font-semibold text-slate-700">
                  SKU
                  <input
                    value={form.sku}
                    onChange={(event) => updateForm({ sku: event.target.value })}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="block text-sm font-semibold text-slate-700">
                  Sell Price
                  <input
                    value={form.sellPrice}
                    onChange={(event) => updateForm({ sellPrice: cleanDollarInput(event.target.value) })}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="0.00"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.billable}
                    onChange={(event) => updateForm({ billable: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block font-bold text-slate-900">Billable</span>
                    <span className="mt-1 block text-xs text-slate-500">Available for invoice pricing.</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => updateForm({ active: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block font-bold text-slate-900">Active</span>
                    <span className="mt-1 block text-xs text-slate-500">Shown in catalog pickers.</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.availableForPartPurchase}
                    onChange={(event) => updateForm({ availableForPartPurchase: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block font-bold text-slate-900">Part Purchase</span>
                    <span className="mt-1 block text-xs text-slate-500">Selectable for purchasing.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeProductModal}
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
                {saving ? "Saving..." : editing ? "Save Product" : "Create Product"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
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

  if (detailMode) {
    const linkedCount = vendorItemsLoading ? linkedVendorItemCount(detailProduct || {}) : vendorItems.length;

    return (
      <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
        <div className="w-full space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <Link to={productCatalogBasePath} className="text-sm font-bold text-blue-700 hover:text-blue-900">
                  &larr; Back to Products
                </Link>
                <p className="mt-4 text-xs font-bold uppercase tracking-wide text-blue-700">Product Catalog</p>
                <h1 className="mt-1 break-words text-3xl font-bold text-slate-950">
                  {loading ? "Loading product..." : detailProduct ? getProductDisplayName(detailProduct) : "Product not found"}
                </h1>
                {detailProduct ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700">
                      Updated {formatDateValue(detailProduct.dateUpdated || detailProduct.updatedAt || detailProduct.createdAt)}
                    </span>
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${detailProduct.billable ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
                      {detailProduct.billable ? "Billable" : "Not Billable"}
                    </span>
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${detailProduct.active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
                      {detailProduct.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                ) : null}
              </div>

              {detailProduct ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(detailProduct)}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
                  >
                    Edit
                  </button>
                  <Link
                    to={vendorItemsPath}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    Vendor Items
                  </Link>
                </div>
              ) : null}
            </div>
          </section>

          {loading ? (
            <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              Loading product details...
            </section>
          ) : detailProduct ? (
            <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,360px)]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                  <h2 className="text-lg font-bold text-slate-950">Product Details</h2>
                  <p className="mt-1 text-sm text-slate-500">Pricing, classification, and catalog identifiers.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
                  <DetailField label="Name" value={getProductDisplayName(detailProduct)} />
                  <DetailField label="Specific Name" value={detailProduct.specificName} />
                  <DetailField label="Product ID" value={detailProduct.id} />
                  <DetailField label="SKU" value={detailProduct.sku} />
                  <DetailField label="Category" value={detailProduct.category} />
                  <DetailField label="Subcategory" value={detailProduct.subCategory} />
                  <DetailField label="UOM" value={detailProduct.UOM} />
                  <DetailField label="Sell Price" value={money(getProductSellPriceCents(detailProduct))} />
                  <DetailField label="Billing" value={detailProduct.billable ? "Billable" : "Not Billable"} />
                  <DetailField label="Status" value={detailProduct.active ? "Active" : "Inactive"} />
                  <DetailField label="Part Purchase" value={isProductAvailableForPartPurchase(detailProduct) ? "Available" : "Unavailable"} />
                  <DetailField label="Source" value={detailProduct.source} />
                </div>

                <div className="border-t border-slate-200 p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Description</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{detailProduct.description || "--"}</p>
                </div>

                <div className="border-t border-slate-200">
                  <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-950">Connected Vendor Items</h2>
                      <p className="mt-1 text-sm text-slate-500">Supplier-specific items linked to this database product.</p>
                    </div>
                    <span className="rounded-md bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      {linkedCount} linked
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[880px] w-full">
                      <thead className="bg-white">
                        <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                          <th className="border-b border-slate-200 px-5 py-3">Vendor Item</th>
                          <th className="border-b border-slate-200 px-5 py-3">Vendor</th>
                          <th className="border-b border-slate-200 px-5 py-3">Category</th>
                          <th className="border-b border-slate-200 px-5 py-3">Cost</th>
                          <th className="border-b border-slate-200 px-5 py-3">Sell Price</th>
                          <th className="border-b border-slate-200 px-5 py-3">SKU</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {vendorItemsLoading ? (
                          <tr>
                            <td colSpan={6} className="px-5 py-8 text-sm text-slate-500">Loading linked vendor items...</td>
                          </tr>
                        ) : vendorItems.length ? (
                          vendorItems.map((vendorItem) => (
                            <tr key={vendorItem.id} className="align-top hover:bg-slate-50">
                              <td className="px-5 py-3">
                                <Link
                                  to={`${vendorItemsPath}/detail/${vendorItem.id}`}
                                  className="font-semibold text-blue-700 hover:text-blue-900"
                                >
                                  {getVendorItemDisplayName(vendorItem)}
                                </Link>
                                <p className="mt-1 text-xs leading-5 text-slate-500">{vendorItem.description || "--"}</p>
                              </td>
                              <td className="px-5 py-3 text-sm text-slate-700">{vendorItem.storeName || "--"}</td>
                              <td className="px-5 py-3 text-sm text-slate-700">
                                {vendorItem.category || "--"}
                                {vendorItem.subCategory ? <span className="block text-xs text-slate-500">{vendorItem.subCategory}</span> : null}
                              </td>
                              <td className="px-5 py-3 text-sm font-semibold text-slate-900">{money(vendorItem.costCents)}</td>
                              <td className="px-5 py-3 text-sm font-semibold text-slate-900">{money(vendorItem.sellPriceCents)}</td>
                              <td className="px-5 py-3 text-sm text-slate-700">{vendorItem.sku || "--"}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                              No vendor items are connected to this product yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Catalog Summary</h2>
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="font-semibold text-slate-500">Linked Vendor Items</span>
                    <span className="text-right font-semibold text-slate-900">{linkedCount}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="font-semibold text-slate-500">Preferred Vendor Item</span>
                    <span className="max-w-[180px] break-words text-right font-semibold text-slate-900">{detailProduct.preferredVendorItemId || "--"}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="font-semibold text-slate-500">Updated</span>
                    <span className="text-right font-semibold text-slate-900">{formatDateValue(detailProduct.dateUpdated || detailProduct.updatedAt || detailProduct.createdAt)}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="font-semibold text-slate-500">Created</span>
                    <span className="text-right font-semibold text-slate-900">{formatDateValue(detailProduct.createdAt)}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Vendor Item IDs</p>
                    {productLinkedVendorItemIds(detailProduct).size ? (
                      <div className="mt-2 space-y-1">
                        {Array.from(productLinkedVendorItemIds(detailProduct)).map((linkedId) => (
                          <p key={linkedId} className="break-words text-xs font-semibold text-slate-900">{linkedId}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-semibold text-slate-900">--</p>
                    )}
                  </div>
                </div>
              </aside>
            </section>
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              This product could not be found in the Product Catalog.
            </section>
          )}
        </div>
        {renderProductModal()}
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
                Products are the generic database items used for jobs and invoices. Vendor Items stay connected underneath for costs, receipts, and audit history.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openCreateModal}
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
            <p className="mt-2 text-2xl font-bold text-slate-950">{products.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Visible Results</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{sortedProducts.length}</p>
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
            <table className="min-w-[1160px] w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 px-5 py-3">Product</th>
                  <th className="border-b border-slate-200 px-5 py-3">Category</th>
                  <th className="border-b border-slate-200 px-5 py-3">Subcategory</th>
                  <th className="border-b border-slate-200 px-5 py-3">UOM</th>
                  <th className="border-b border-slate-200 px-5 py-3">Billable</th>
                  <th className="border-b border-slate-200 px-5 py-3">Sell Price</th>
                  <th className="border-b border-slate-200 px-5 py-3">Vendor Items</th>
                  <th className="border-b border-slate-200 px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-sm text-slate-500">Loading products...</td>
                  </tr>
                ) : paginatedProducts.length ? (
                  paginatedProducts.map((product) => (
                    <tr key={product.id} className="align-top hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link to={`${productCatalogBasePath}/${product.id}`} className="font-semibold text-blue-700 hover:text-blue-900">
                          {getProductDisplayName(product)}
                        </Link>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{product.description || product.specificName || "--"}</p>
                        {product.sku ? <p className="mt-1 text-xs text-slate-400">SKU {product.sku}</p> : null}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">{product.category || "--"}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">{product.subCategory || "--"}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">{product.UOM || "--"}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        <div className="flex flex-wrap gap-1">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${product.billable ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                            {product.billable ? "Billable" : "Not Billable"}
                          </span>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${product.availableForPartPurchase ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                            {product.availableForPartPurchase ? "Part Purchase" : "Unavailable"}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-slate-900">{money(getProductSellPriceCents(product))}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                          {linkedVendorItemCount(product)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to={`${productCatalogBasePath}/${product.id}`}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEditModal(product)}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-500">
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
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </button>
              <span className="px-2 font-semibold text-slate-700">
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || currentPage === pageCount}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>

      {renderProductModal()}
    </div>
  );
};

export default ProductCatalog;
