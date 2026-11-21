import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon, FunnelIcon, MagnifyingGlassIcon, PencilSquareIcon, ShoppingBagIcon } from "@heroicons/react/24/outline";
import { getDocs, setDoc, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";
import { db, functions } from "../../../utils/config";
import CatalogConnections from "./CatalogConnections";
import CatalogMergeDialog from "./CatalogMergeDialog";
import { catalogDuplicatesPath } from "./catalogMergeRecords";
import { DetailRow, SummaryRow } from "./CatalogDetailRows";
import WorkspaceHeader from "../../../components/workspace/WorkspaceHeader";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import ProductAvailabilityFields from "./ProductAvailabilityFields";
import ProductBulkAvailability from "./ProductBulkAvailability";
import ProductCatalogFilters, { DEFAULT_PRODUCT_SORT } from "./ProductCatalogFilters";
import ProductDeleteDialog from "./ProductDeleteDialog";
import { canBulkEditProduct, PRODUCT_BULK_EDIT_LIMIT } from "../../../utils/productAvailability";
import { deleteCatalogProduct } from "../../../utils/productVendorConnections";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  CATEGORY_OPTIONS, DEFAULT_CATEGORY, DEFAULT_SUBCATEGORY, DEFAULT_UOM, SUBCATEGORY_OPTIONS, UOM_OPTIONS,
} from "../databaseItems/databaseItemOptions";
import {
  buildProductFromVendorItem,
  getProductDisplayName,
  getProductSellPriceCents,
  buildProductCostIndex,
  getProductDefaultCostCents,
  linkedVendorItemsForProduct,
  getVendorItemCostCents,
  getVendorItemDisplayName,
  isProductAvailableForJobs,
  isProductAvailableForPartApproval,
  isProductAvailableForPartPurchase,
  isMergedCatalogRecord,
  productCatalogAvailabilityFields,
  productCatalogCollectionRef,
  productCatalogDocRef,
  vendorItemDocRef,
  vendorItemsCollectionRef,
} from "../../../utils/productCatalog";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const PRODUCT_SELECT_FIELDS = [
  { field: "category", label: "Category", options: CATEGORY_OPTIONS },
  { field: "subCategory", label: "Subcategory", options: SUBCATEGORY_OPTIONS },
  { field: "UOM", label: "UOM", options: UOM_OPTIONS },
];

const PRODUCT_FORM_DEFAULTS = {
  name: "",
  specificName: "",
  description: "",
  category: DEFAULT_CATEGORY.label,
  subCategory: DEFAULT_SUBCATEGORY.label,
  UOM: DEFAULT_UOM.label,
  sku: "",
  sellPrice: "",
  defaultCost: "",
  billable: true,
  active: true,
  availableForJobs: true,
  availableForPartApproval: true,
  availableForPartPurchase: true,
};

const money = (cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(cents || 0) / 100);

const vendorCostRange = (info) => info.minVendorCostCents === info.maxVendorCostCents
  ? money(info.minVendorCostCents)
  : `${money(info.minVendorCostCents)} – ${money(info.maxVendorCostCents)}`;

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

const getProductImageUrl = (product = {}) => {
  const directUrl =
    product.imageUrl ||
    product.imageURL ||
    product.photoUrl ||
    product.photoURL ||
    product.thumbnailUrl ||
    product.thumbnailURL ||
    product.productImageUrl ||
    product.pictureUrl ||
    product.picture;

  if (typeof directUrl === "string" && directUrl.trim()) return directUrl.trim();

  const imageCollection = product.images || product.photos || product.productImages;
  if (!Array.isArray(imageCollection)) return "";

  const firstImage = imageCollection.find(Boolean);
  if (typeof firstImage === "string") return firstImage;
  return firstImage?.url || firstImage?.downloadURL || firstImage?.src || "";
};

const positiveAvailability = (row) => {
  // Use the saved aliases for badges. The picker helpers default omitted flags to active.
  const explicit = { ...row, active: false };
  return [
    [row.active === true, "Active", "bg-slate-100 text-slate-700"],
    [isProductAvailableForJobs(explicit) === true, "Jobs", "bg-indigo-50 text-indigo-700"],
    [isProductAvailableForPartApproval(explicit) === true, "Part Approval Sales", "bg-violet-50 text-violet-700"],
    [isProductAvailableForPartPurchase(explicit) === true, "Part Purchase", "bg-blue-50 text-blue-700"],
    [row.billable === true, "Billable", "bg-emerald-50 text-emerald-700"],
  ].filter(([enabled]) => enabled);
};

const AvailabilityTags = ({ product }) => <div className="flex flex-wrap gap-1">
  {product.availabilityTags.map(([, label, tone]) => <span key={label}
    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>)}
</div>;

const normalizeProduct = (productId, data = {}) => ({
  ...data,
  id: productId,
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
  availableForJobs: isProductAvailableForJobs(data),
  availableForPartApproval: isProductAvailableForPartApproval(data),
  availableForPartPurchase: isProductAvailableForPartPurchase(data),
  availabilityTags: positiveAvailability(data),
  dateUpdatedMillis: valueToMillis(data.dateUpdated || data.updatedAt || data.createdAt),
});

const mapProductDoc = (productDoc) => normalizeProduct(productDoc.id, productDoc.data());

const mapVendorItemDoc = (vendorItemDoc) => {
  const data = vendorItemDoc.data();
  const costCents = getVendorItemCostCents(data);
  const sellPriceCents = Number(data.sellPrice ?? data.billingRate ?? 0);

  return {
    ...data,
    id: vendorItemDoc.id,
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
    product.availableForJobs ? "jobs work orders service" : "sales only",
    product.availableForPartApproval ? "part approvals customer sale direct sale" : "job only",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const productPatchFromForm = (form, productId, now = new Date()) => {
  const name = form.name.trim();
  const description = form.description.trim();
  const specificName = form.specificName.trim() || description || name;
  const sellPrice = centsFromDollarInput(form.sellPrice);

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
    defaultCostCents: centsFromDollarInput(form.defaultCost),
    rate: centsFromDollarInput(form.defaultCost),
    cost: centsFromDollarInput(form.defaultCost),
    billable: Boolean(form.billable),
    ...productCatalogAvailabilityFields(form),
    dateUpdated: now,
    updatedAt: now,
  };
};

const ProductCatalog = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const { productId } = useParams();
  const settingsCatalogContext = location.pathname.toLowerCase().startsWith("/company/settings");
  const productCatalogBasePath = settingsCatalogContext ? "/company/settings/product-catalog" : "/company/product-catalog";
  const productCatalogReconciliationPath = "/company/product-catalog/reconciliation";
  const vendorItemsPath = settingsCatalogContext ? "/company/settings/vendor-items" : "/company/items";
  const detailMode = Boolean(productId);

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOption, setSortOption] = useState(DEFAULT_PRODUCT_SORT);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState(PRODUCT_FORM_DEFAULTS);
  const [allVendorItems, setVendorItems] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [mergeCompany, setMergeCompany] = useState(null);
  const activeCompany = useRef(recentlySelectedCompany);
  activeCompany.current = recentlySelectedCompany;
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkOpen(false);
  }, [recentlySelectedCompany, searchTerm, filters]);
  useEffect(() => { setMergeCompany(null); }, [productId]);

  const loadGeneration = useRef(0);
  const loadCatalog = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!recentlySelectedCompany) {
      setProducts([]);
      setVendorItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setCatalogError("");
    setProducts([]);
    setVendorItems([]);
    try {
      const [productSnap, vendorSnap] = await Promise.all([getDocs(productCatalogCollectionRef(db, recentlySelectedCompany)), getDocs(vendorItemsCollectionRef(db, recentlySelectedCompany))]);
      if (generation !== loadGeneration.current) return;
      setProducts(productSnap.docs.map(mapProductDoc));
      setVendorItems(vendorSnap.docs.map(mapVendorItemDoc));
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setCatalogError(userFacingErrorMessage(error, "Could not load catalog costs and connections."));
      console.error("Unable to load product catalog:", error);
      toast.error(userFacingErrorMessage(error, "Could not load the Product Catalog."));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    setEditingProduct(null);
    setIsCreateModalOpen(false);
    setConfirmDelete(false);
    setMergeCompany(null);
    setFiltersOpen(false);
    loadCatalog();
    return () => { loadGeneration.current += 1; };
  }, [loadCatalog]);

  const detailProduct = useMemo(
    () => (productId ? products.find((product) => product.id === productId) || null : null),
    [productId, products]
  );
  const catalogProducts = useMemo(() => products.filter(product => !isMergedCatalogRecord(product)), [products]);

  const vendorItems = useMemo(() => detailProduct ? linkedVendorItemsForProduct(detailProduct, allVendorItems, products) : [], [detailProduct, allVendorItems, products]);
  const connectionCatalog = useMemo(() => ({ products, vendorItems: allVendorItems }), [products, allVendorItems]);
  const productCosts = useMemo(() => buildProductCostIndex(products, allVendorItems), [products, allVendorItems]);
  const costInfo = (product) => productCosts.get(product.id);
  const linkedVendorItemCount = (product) => productCosts.get(product.id)?.linkedVendorItems.length || 0;

  const searchMatchedProducts = useMemo(() => {
    const lowerSearch = searchTerm.trim().toLowerCase();
    return lowerSearch ? catalogProducts.filter(product => productSearchText(product).includes(lowerSearch)) : catalogProducts;
  }, [catalogProducts, searchTerm]);

  const catalogFilterOptions = useMemo(() => PRODUCT_SELECT_FIELDS.map(({ field, label }) => ({
    field, label, values: getUniqueOptions(searchMatchedProducts, field),
  })), [searchMatchedProducts]);

  const filteredProducts = useMemo(() => {
    const selectedFields = Object.entries(filters);
    return searchMatchedProducts.filter((product) => selectedFields.every(([field, value]) => (
      typeof value === "boolean" ? Boolean(product[field]) === value : normalizeFilterValue(product[field]) === value
    )));
  }, [filters, searchMatchedProducts]);

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
        default:
          return compareText(getProductDisplayName(left), getProductDisplayName(right));
      }
    });
  }, [filteredProducts, sortOption]);

  const activeFilterCount = Object.keys(filters).length;

  const pageCount = Math.max(1, Math.ceil(sortedProducts.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedProducts = sortedProducts.slice(startIndex, startIndex + pageSize);
  const eligiblePage = paginatedProducts.filter(canBulkEditProduct);
  const eligibleFiltered = sortedProducts.filter(canBulkEditProduct);
  const pageSelected = eligiblePage.length > 0 && eligiblePage.every((product) => selectedIds.has(product.id));
  const setSelection = (ids, add) => {
    if (add && new Set([...selectedIds, ...ids]).size > PRODUCT_BULK_EDIT_LIMIT) { toast.error(`Select up to ${PRODUCT_BULK_EDIT_LIMIT} products at a time.`); return; }
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => add ? next.add(id) : next.delete(id));
      if (next.size > PRODUCT_BULK_EDIT_LIMIT) return current;
      return next;
    });
  };
  const displayStart = sortedProducts.length === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(startIndex + pageSize, sortedProducts.length);
  const resultSummaryText = `Showing ${displayStart}-${displayEnd} of ${sortedProducts.length}${
    sortedProducts.length !== catalogProducts.length ? ` filtered (${catalogProducts.length} total)` : ""
  }`;

  const totalLinkedVendorItemsOnPage = useMemo(
    () => paginatedProducts.reduce((total, product) => total + (productCosts.get(product.id)?.linkedVendorItems.length || 0), 0),
    [paginatedProducts, productCosts]
  );

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, pageSize, searchTerm, sortOption]);

  const updateForm = (updates) => {
    setForm((current) => ({ ...current, ...updates }));
  };

  const applyFilters = (nextFilters, nextSort) => {
    setFilters((current) => {
      const entries = Object.entries(nextFilters);
      const sameFilters = entries.length === Object.keys(current).length
        && entries.every(([field, value]) => current[field] === value);
      return sameFilters ? current : nextFilters;
    });
    setSortOption(nextSort);
    setFiltersOpen(false);
  };

  const openCreateModal = () => {
    setEditingProduct(null);
    setForm(PRODUCT_FORM_DEFAULTS);
    setIsCreateModalOpen(true);
  };

  const closeProductModal = () => {
    if (saving || deleting) return;
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
      category: product.category || PRODUCT_FORM_DEFAULTS.category,
      subCategory: product.subCategory || PRODUCT_FORM_DEFAULTS.subCategory,
      UOM: product.UOM || PRODUCT_FORM_DEFAULTS.UOM,
      sku: product.sku || "",
      sellPrice: dollarsFromCents(getProductSellPriceCents(product)),
      defaultCost: dollarsFromCents(getProductDefaultCostCents(product)),
      billable: Boolean(product.billable),
      active: product.active !== false,
      availableForJobs: isProductAvailableForJobs(product),
      availableForPartApproval: isProductAvailableForPartApproval(product),
      availableForPartPurchase: isProductAvailableForPartPurchase(product),
    });
  };

  const createProduct = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany || !requirePermission("852", "create products")) return;

    const productName = form.name.trim();
    if (!productName) {
      toast.error("Product name is required.");
      return;
    }

    if (!Number.isFinite(Number(form.defaultCost || 0)) || Number(form.defaultCost || 0) < 0) {
      toast.error("Enter a valid unit cost of zero or more.");
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
      toast.error(userFacingErrorMessage(error, "Could not create this product."));
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (saving || deleting || !recentlySelectedCompany || !editingProduct || !requirePermission("854", "update products")) return;

    const productName = form.name.trim();
    if (!productName) {
      toast.error("Product name is required.");
      return;
    }

    if (!Number.isFinite(Number(form.defaultCost || 0)) || Number(form.defaultCost || 0) < 0) {
      toast.error("Enter a valid unit cost of zero or more.");
      return;
    }
    setSaving(true);
    try {
      const now = new Date();
      const productPatch = productPatchFromForm(form, editingProduct.id, now);
      const batch = writeBatch(db);
      batch.update(productCatalogDocRef(db, recentlySelectedCompany, editingProduct.id), productPatch);

      const linkedItemsToUpdate = linkedVendorItemsForProduct(editingProduct, allVendorItems, products);
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
          linkedItemsToUpdate.some((item) => item.id === vendorItem.id)
            ? { ...vendorItem, productName, genericItemName: productName }
            : vendorItem
        )
      );
      setEditingProduct(null);
      toast.success("Product updated.");
    } catch (error) {
      console.error("Unable to update product:", error);
      toast.error(userFacingErrorMessage(error, "Could not update this product."));
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (vendorItemIds) => {
    const companyId = recentlySelectedCompany;
    if (saving || deleting || !companyId || !editingProduct || !requirePermission("856", "delete products")) return;

    setDeleting(true);
    try {
      const productId = editingProduct.id;
      if (vendorItemIds.length) {
        await httpsCallable(functions, "deleteCatalogProductAndVendorItems")({ companyId, productId, vendorItemIds });
      } else {
        await deleteCatalogProduct({ db, companyId, productId });
      }
      toast.success(vendorItemIds.length ? "Product and selected vendor items deleted." : "Product deleted.");
      if (activeCompany.current !== companyId) return;

      setSelection([productId], false);
      if (detailMode) navigate(productCatalogBasePath, { replace: true });
      setConfirmDelete(false);
      setEditingProduct(null);
      await loadCatalog();
    } catch (error) {
      const detail = error.code === "functions/failed-precondition" ? error.message : "Could not delete this product.";
      toast.error(userFacingErrorMessage(error, detail));
      if (activeCompany.current === companyId) setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const renderProductModal = () => {
    const editing = Boolean(editingProduct);
    if (!isCreateModalOpen && !editing) return null;
    const busy = saving || deleting;
    const currentCost = editing ? costInfo(editingProduct) : null;

    return (
      <>
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
                disabled={busy}
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
                {PRODUCT_SELECT_FIELDS.map(({ field, label, options }) => {
                  const savedValue = editingProduct?.[field];
                  const hasLegacyValue = savedValue && !options.some((option) => option.label === savedValue);
                  return (
                    <label key={field} className="block text-sm font-semibold text-slate-700">
                      {label}
                      <select
                        value={form[field]}
                        onChange={(event) => updateForm({ [field]: event.target.value })}
                        disabled={busy}
                        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {hasLegacyValue && <option value={savedValue}>{savedValue}</option>}
                        {options.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}
                      </select>
                    </label>
                  );
                })}

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

              {currentCost?.vendorItem && <label className="block text-sm font-semibold text-slate-700">
                Current Unit Cost
                <input readOnly value={money(currentCost.costCents)} className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" />
                <span className="mt-1 block text-xs font-normal text-slate-500">From {getVendorItemDisplayName(currentCost.vendorItem)}</span>
              </label>}
              <label className="block text-sm font-semibold text-slate-700">
                Manual Unit Cost
                <input type="number" min="0" step="0.01" value={form.defaultCost} onChange={(event) => updateForm({ defaultCost: event.target.value })} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="0.00" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Used when no vendor item is connected. A connected vendor supplies the product cost; the sell price stays separate.</span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
              <ProductAvailabilityFields value={form} onChange={updateForm} disabled={busy} />
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
              {editing && can("856") && !editingProduct?.mergedSourceIds?.length && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  className={workspaceButtonClass({ tone: "rose", className: "mr-auto" })}
                >
                  Delete Product
                </button>
              )}
              <button
                type="button"
                onClick={closeProductModal}
                disabled={busy}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : editing ? "Save Product" : "Create Product"}
              </button>
            </div>
          </form>
        </div>
      </div>
      {confirmDelete && editing && <ProductDeleteDialog product={editingProduct} vendorItems={currentCost?.linkedVendorItems || []}
        busy={deleting} onClose={() => setConfirmDelete(false)} onDelete={deleteProduct} />}
      </>
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

  if (catalogError) return <div role="alert" className="m-5 rounded-lg border p-5"><p>{catalogError}</p><button type="button" onClick={loadCatalog}>Retry catalog</button></div>;

  if (detailMode) {
    const linkedCount = vendorItems.length;
    const productImageUrl = detailProduct ? getProductImageUrl(detailProduct) : "";
    const productTitle = detailProduct ? getProductDisplayName(detailProduct) : "";
    const productDescription = detailProduct?.description || detailProduct?.specificName || "";
    const categoryTrail = [detailProduct?.category, detailProduct?.subCategory].filter(Boolean).join(" / ") || "Uncategorized";
    const updatedDate = detailProduct ? formatDateValue(detailProduct.dateUpdated || detailProduct.updatedAt || detailProduct.createdAt) : "--";

    return (
      <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
        <div className="w-full space-y-6">

          {loading ? (
            <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              Loading product details...
            </section>
          ) : detailProduct ? (
            <>
              <WorkspaceHeader
                title={productTitle}
                eyebrow={detailProduct.mergedIntoProductId ? "Merged Product" : "Product Catalog Item"}
                description={productDescription || "Manage product details, availability, and vendor connections."}
                meta={<>
                  <span className="workspace-header-badge">{categoryTrail}</span>
                  <span className="workspace-header-badge">{detailProduct.UOM || "Unit"}</span>
                  <span className="workspace-header-badge">Sell Price {money(getProductSellPriceCents(detailProduct))}</span>
                  <span className="workspace-header-badge">{detailProduct.active ? "Active" : "Inactive"}</span>
                  <span className="workspace-header-badge">Updated {updatedDate}</span>
                </>}
                actions={<div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <Link to={productCatalogBasePath} className={workspaceButtonClass({ tone: "slate" })}><ArrowLeftIcon className="h-4 w-4" />Back to Products</Link>
                  <div className="flex flex-wrap gap-2">
                    {detailProduct.mergedIntoProductId
                      ? <Link to={`${productCatalogBasePath}/${detailProduct.mergedIntoProductId}`} className={workspaceButtonClass({ tone: "blue" })}>View kept product</Link>
                      : <>
                        <button type="button" disabled={!can("854")} onClick={() => openEditModal(detailProduct)} className={workspaceButtonClass({ tone: "blue" })}><PencilSquareIcon className="h-4 w-4" />Edit</button>
                        {can("854") && !detailProduct.archived && <button type="button" onClick={() => setMergeCompany(recentlySelectedCompany)} className={workspaceButtonClass({ tone: "slate" })}>Merge duplicate</button>}
                      </>}
                    <Link to={vendorItemsPath} className={workspaceButtonClass({ tone: "slate" })}><ShoppingBagIcon className="h-4 w-4" />Vendor Items</Link>
                  </div>
                </div>}
              />

              <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
                    <h2 className="text-lg font-bold text-slate-950">Product Sheet</h2>
                    <p className="mt-1 text-sm text-slate-500">Readable catalog facts for purchasing, billing, and field use.</p>
                  </div>

                  {productImageUrl && <div className="px-5 pt-5 sm:px-6"><img src={productImageUrl} alt={productTitle} className="h-40 w-full rounded-md border border-slate-200 object-contain" /></div>}
                  <dl className="px-5 sm:px-6">
                    <DetailRow label="Display Name" value={productTitle} />
                    <DetailRow label="Specific Name" value={detailProduct.specificName} />
                    <DetailRow label="Description">
                      <p className="whitespace-pre-wrap font-normal text-slate-700">{detailProduct.description || "--"}</p>
                    </DetailRow>
                    <DetailRow label="SKU" value={detailProduct.sku} />
                    <DetailRow label="Category" value={detailProduct.category} />
                    <DetailRow label="Subcategory" value={detailProduct.subCategory} />
                    <DetailRow label="Unit of Measure" value={detailProduct.UOM} />
                    <DetailRow label="Source" value={detailProduct.source} />
                  </dl>
                </article>

                <aside className="space-y-6">
                  {detailProduct.availabilityTags.length > 0 && <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-950">Availability</h2>
                    <div className="mt-3"><AvailabilityTags product={detailProduct} /></div>
                  </section>}

                  <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-950">Catalog Summary</h2>
                    <div className="mt-3">
                      <SummaryRow label="Sell Price" value={money(getProductSellPriceCents(detailProduct))} />
                      <SummaryRow label="Unit Cost" value={money(costInfo(detailProduct).costCents)} />
                      {costInfo(detailProduct).minVendorCostCents !== null && <SummaryRow label="Vendor Cost Range" value={vendorCostRange(costInfo(detailProduct))} />}
                      <SummaryRow label="Cost Source" value={costInfo(detailProduct).vendorItem ? getVendorItemDisplayName(costInfo(detailProduct).vendorItem) : "Manual cost"} />
                      <SummaryRow label="Linked Vendor Items" value={linkedCount} />
                      <SummaryRow label="Preferred Vendor Item" value={vendorItems.find((item) => item.id === detailProduct.preferredVendorItemId)?.name || "Not selected"} />
                      <SummaryRow label="Updated" value={updatedDate} />
                      <SummaryRow label="Created" value={formatDateValue(detailProduct.createdAt)} />
                    </div>


                  </section>
                </aside>
              </section>

              {!detailProduct.mergedIntoProductId && <CatalogConnections productId={detailProduct.id} catalog={connectionCatalog} onChange={loadCatalog} />}
            </>
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              <Link to={productCatalogBasePath} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">
                <ArrowLeftIcon className="h-4 w-4" />
                Back to Products
              </Link>
              <p>This product could not be found in the Product Catalog.</p>
            </section>
          )}
        </div>
        {renderProductModal()}
        {mergeCompany && mergeCompany === recentlySelectedCompany && detailProduct && <CatalogMergeDialog
          kind="product" companyId={mergeCompany} initialKeepId={detailProduct.id}
          onClose={() => setMergeCompany(null)} onMerged={keepId => {
            if (activeCompany.current !== mergeCompany) return;
            setMergeCompany(null);
            navigate(`${productCatalogBasePath}/${keepId}`, { replace: true });
            loadCatalog();
            toast.success("Product duplicate merged.");
          }} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <WorkspaceHeader title="Product Catalog" description="Products are the generic database items used for jobs and invoices. Vendor Items stay connected underneath for costs, receipts, and audit history."
          actions={<>
            <button type="button" disabled={!can("852")} onClick={openCreateModal} className={workspaceButtonClass({ tone: "blue" })}>Add new</button>
            {can("854") && <button type="button" disabled={!selectedIds.size} onClick={() => setBulkOpen(true)} className={workspaceButtonClass({ tone: "blue" })}>Bulk Edit Availability</button>}
            <Link to={productCatalogReconciliationPath} className={workspaceButtonClass({ tone: "blue" })}>Product Catalog Reconciliation</Link>
            {can("854") && <Link to={catalogDuplicatesPath} className={workspaceButtonClass({ tone: "slate" })}>Merge Duplicates</Link>}
            <Link to={vendorItemsPath} className={workspaceButtonClass({ tone: "slate" })}>Vendor Items</Link>
          </>}
        />

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Products</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{catalogProducts.length}</p>
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

        {can("854") && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <span className="font-semibold text-slate-700">{selectedIds.size} selected</span>
          <button type="button" disabled={loading || !eligiblePage.length} onClick={() => setSelection(eligiblePage.map((product) => product.id), !pageSelected)} className={workspaceButtonClass({ tone: "slate" })}>{pageSelected ? "Deselect page" : "Select page"}</button>
          <button type="button" disabled={loading || !eligibleFiltered.length || eligibleFiltered.length > PRODUCT_BULK_EDIT_LIMIT} onClick={() => setSelectedIds(new Set(eligibleFiltered.map((product) => product.id)))} className={workspaceButtonClass({ tone: "slate" })}>Select all filtered ({eligibleFiltered.length})</button>
          {selectedIds.size > 0 && <button type="button" onClick={() => setSelectedIds(new Set())} className={workspaceButtonClass({ tone: "slate" })}>Clear selection</button>}
          {eligibleFiltered.length > PRODUCT_BULK_EDIT_LIMIT && <span>Select up to {PRODUCT_BULK_EDIT_LIMIT} products per update.</span>}
        </div>}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200 p-3 sm:gap-3 sm:px-5">
            <div className="relative min-w-0 basis-full sm:flex-1">
              <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-11 w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                type="search"
                aria-label="Search products"
                placeholder="Search products"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}
              className={workspaceButtonClass({ tone: activeFilterCount ? "blue" : "slate", className: "h-11 shrink-0 whitespace-nowrap" })}
            >
              <FunnelIcon aria-hidden="true" className="h-4 w-4" />
              {activeFilterCount ? `Filters (${activeFilterCount})` : "Filters"}
            </button>
            <select
              className="h-11 shrink-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option} per page</option>)}
            </select>
          </div>

          <p className="px-5 py-3 text-xs text-slate-500">{resultSummaryText}</p>

          <div className="overflow-x-auto border-t border-slate-200">
            <table className="min-w-[1160px] w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  {can("854") && <th className="border-b border-slate-200 px-5 py-3"><input type="checkbox" aria-label="Select all products on this page" checked={pageSelected} disabled={!eligiblePage.length} ref={(node) => { if (node) node.indeterminate = !pageSelected && eligiblePage.some((product) => selectedIds.has(product.id)); }} onChange={(event) => setSelection(eligiblePage.map((product) => product.id), event.target.checked)} /></th>}
                  <th className="border-b border-slate-200 px-5 py-3">Product</th>
                  <th className="border-b border-slate-200 px-5 py-3">Category</th>
                  <th className="border-b border-slate-200 px-5 py-3">Subcategory</th>
                  <th className="border-b border-slate-200 px-5 py-3">UOM</th>
                  <th className="border-b border-slate-200 px-5 py-3">Availability</th>
                  <th className="border-b border-slate-200 px-5 py-3">Unit Cost</th>
                  <th className="border-b border-slate-200 px-5 py-3">Sell Price</th>
                  <th className="border-b border-slate-200 px-5 py-3">Vendor Items</th>
                  <th className="border-b border-slate-200 px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={can("854") ? 10 : 9} className="px-5 py-8 text-sm text-slate-500">Loading products...</td>
                  </tr>
                ) : paginatedProducts.length ? (
                  paginatedProducts.map((product) => (
                    <tr key={product.id} className="align-top hover:bg-slate-50">
                      {can("854") && <td className="px-5 py-3"><input type="checkbox" aria-label={`Select ${getProductDisplayName(product)}`} disabled={!canBulkEditProduct(product)} checked={selectedIds.has(product.id)} onChange={(event) => setSelection([product.id], event.target.checked)} /></td>}
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
                        <AvailabilityTags product={product} />
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                        {money(costInfo(product).costCents)}
                        <p className="mt-1 text-xs font-normal text-slate-500">{costInfo(product).vendorItem ? getVendorItemDisplayName(costInfo(product).vendorItem) : "Manual cost"}</p>
                        {costInfo(product).linkedVendorItems.length > 1 && <p className="mt-1 text-xs font-normal text-slate-500">Range: {vendorCostRange(costInfo(product))}</p>}
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-slate-900">{money(getProductSellPriceCents(product))}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                          {linkedVendorItemCount(product)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        <button
                          type="button"
                          disabled={!can("854")}
                          onClick={() => openEditModal(product)}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={can("854") ? 10 : 9} className="px-5 py-10 text-center text-sm text-slate-500">
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

      {filtersOpen && (
        <ProductCatalogFilters
          filters={filters}
          sortOption={sortOption}
          catalogOptions={catalogFilterOptions}
          onApply={applyFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {bulkOpen && <ProductBulkAvailability productIds={[...selectedIds]} onClose={() => setBulkOpen(false)} onSaved={() => {
        if (activeCompany.current !== recentlySelectedCompany) return;
        setBulkOpen(false);
        setSelectedIds(new Set());
        toast.success(`Updated availability for ${selectedIds.size} products.`);
        loadCatalog();
      }} />}
      {renderProductModal()}
    </div>
  );
};

export default ProductCatalog;
