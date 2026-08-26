import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import Select from "react-select";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db, storage } from "../../../utils/config";
import { fetchCompanyVendors } from "../../../utils/vendors";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";
import {
  buildProductFromVendorItem,
  buildVendorItemProductPatch,
  findSuggestedProductForVendorItem,
  getProductDisplayName,
  getProductSellPriceCents,
  productCatalogCollectionRef,
  productCatalogDocRef,
  productOptionSearchText,
} from "../../../utils/productCatalog";

const MURDOCK_COMPANY_ID = "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e";

const uomOptions = [
  { id: "gallon", label: "Gallon" },
  { id: "pounds", label: "Pounds" },
  { id: "ounce", label: "Ounce" },
  { id: "feet", label: "Feet" },
  { id: "square-feet", label: "Square Feet" },
  { id: "liter", label: "Liter" },
  { id: "inch", label: "Inch" },
  { id: "quart", label: "Quart" },
  { id: "tab", label: "Tab" },
  { id: "unit", label: "Unit" },
];

const categoryOptions = [
  { id: "pvc", label: "PVC" },
  { id: "galvanized", label: "Galvanized" },
  { id: "chemicals", label: "Chemicals" },
  { id: "useables", label: "Useables" },
  { id: "equipment", label: "Equipment" },
  { id: "parts", label: "Parts" },
  { id: "electrical", label: "Electrical" },
  { id: "tools", label: "Tools" },
  { id: "misc", label: "Misc" },
];

const subcategoryOptions = [{ id: "misc", label: "Misc" }];

const customReceiptReaderOptions = [
  { value: "/company/purchased-items/alpha-water-import", label: "Alpha Water Import" },
  { value: "/company/purchased-items/heritage-import", label: "Heritage Import" },
];

const blankDatabaseItemForm = {
  name: "",
  description: "",
  sku: "",
  uom: uomOptions[uomOptions.length - 1],
  category: categoryOptions[categoryOptions.length - 1],
  subcategory: subcategoryOptions[0],
  size: "",
  color: "",
  cost: "",
  costUSD: "0",
  billable: false,
  sellPrice: "",
  sellPriceUSD: "0",
  vendor: null,
  productLinkMode: "create",
  selectedProduct: null,
  productName: "",
  productSellPrice: "",
  shareProductSellPrice: true,
};

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));

const moneyFromCents = (value) => money(Number(value || 0) / 100);

const centsFromDollarInput = (value) => {
  const parsed = Number(String(value || "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const dollarsFromCents = (value) => {
  const cents = Number(value || 0);
  return cents ? (cents / 100).toFixed(2) : "";
};

const cleanDecimalInput = (value) => {
  let cleanValue = String(value || "").replace(/[^\d.]/g, "");
  const parts = cleanValue.split(".");

  if (parts.length > 1) {
    cleanValue = `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
  }

  return cleanValue;
};

const numberFromInput = (value) => {
  const number = parseFloat(String(value || "").replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const normalizePurchaseCategory = (value) => String(value || "").trim() || "Uncategorized";

const normalizeTextValue = (value) => String(value || "").trim();

const selectedOptionLabel = (option) => option?.label || option?.name || "";

const selectedOptionId = (option) => option?.id || option?.value || "";

const getVendorName = (vendor) => vendor?.name || vendor?.label || "";

const getCompanyUserId = (userOption) => userOption?.userId || userOption?.id || userOption?.value || "";

const lineTotal = (line) => numberFromInput(line.rate) * numberFromInput(line.quantityString || line.quantity);

const databaseItemRateCents = (item) => Number(item?.rate || 0);

const normalizeMatchKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getVendorItemVendorId = (item = {}) => item.vendorId || item.venderId || "";

const vendorItemMatchesVendor = (item = {}, vendor = null) => {
  if (!vendor) return true;

  const selectedVendorId = selectedOptionId(vendor);
  const itemVendorId = getVendorItemVendorId(item);
  if (selectedVendorId && itemVendorId) return itemVendorId === selectedVendorId;

  const selectedVendorNameKey = normalizeMatchKey(getVendorName(vendor));
  const itemVendorNameKey = normalizeMatchKey(item.storeName || item.vendorName || item.venderName);
  return Boolean(selectedVendorNameKey && itemVendorNameKey && itemVendorNameKey === selectedVendorNameKey);
};

const vendorItemProductLink = (vendorItem, products = []) => {
  if (!vendorItem) return { productId: "", productName: "" };

  const suggestedProduct = findSuggestedProductForVendorItem(vendorItem, products);
  const productId = suggestedProduct?.id || vendorItem.productId || vendorItem.genericItemId || "";
  const productName = suggestedProduct
    ? getProductDisplayName(suggestedProduct)
    : vendorItem.productName || vendorItem.genericItemName || "";

  return { productId, productName };
};

const selectTheme = (theme) => ({
  ...theme,
  borderRadius: 6,
  colors: {
    ...theme.colors,
    primary25: "#E0F2FE",
    primary: "#1D4ED8",
    neutral20: "#CBD5E1",
    neutral30: "#94A3B8",
  },
});

const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderColor: state.isFocused ? "#2563EB" : "#CBD5E1",
    borderRadius: 8,
    boxShadow: state.isFocused ? "0 0 0 2px rgba(37, 99, 235, 0.15)" : "none",
    fontSize: "0.875rem",
    "&:hover": {
      borderColor: state.isFocused ? "#2563EB" : "#94A3B8",
    },
  }),
  menu: (base) => ({
    ...base,
    zIndex: 60,
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 60,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "#1D4ED8" : state.isFocused ? "#E0F2FE" : "#FFFFFF",
    color: state.isSelected ? "#FFFFFF" : "#0F172A",
    cursor: "pointer",
  }),
};

const CreateNewPurchase = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const [loadingSelectors, setLoadingSelectors] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingDatabaseItem, setIsCreatingDatabaseItem] = useState(false);
  const [showCreateItemModal, setShowCreateItemModal] = useState(false);

  const [reference, setReference] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date());
  const [notes, setNotes] = useState("");
  const [tax, setTax] = useState("");
  const [receiptTotal, setReceiptTotal] = useState("");

  const [companyUserList, setCompanyUserList] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [vendorList, setVendorList] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [vendorItemList, setVendorItemList] = useState([]);
  const [selectedVendorItem, setSelectedVendorItem] = useState(null);
  const [products, setProducts] = useState([]);
  const [quantity, setQuantity] = useState("");
  const [purchaseItemList, setPurchaseItemList] = useState([]);

  const [sourceQueue, setSourceQueue] = useState([]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState("");
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [savedSourceCount, setSavedSourceCount] = useState(0);

  const [databaseItemForm, setDatabaseItemForm] = useState(blankDatabaseItemForm);

  const activeSource = sourceQueue[sourceIndex] || null;
  const activeSourceFile = activeSource?.file || null;
  const sourceCount = sourceQueue.length;
  const subtotal = purchaseItemList.reduce((sum, item) => sum + lineTotal(item), 0);
  const taxAmount = numberFromInput(tax);
  const enteredTotal = numberFromInput(receiptTotal);
  const summaryTotal = receiptTotal.trim() ? enteredTotal : subtotal + taxAmount;
  const newProductWillBeCreated =
    databaseItemForm.productLinkMode !== "create" || normalizeTextValue(databaseItemForm.productName || databaseItemForm.name);
  const selectMenuPortalTarget = typeof document !== "undefined" ? document.body : null;
  const showCustomReceiptReaders = recentlySelectedCompany === MURDOCK_COMPANY_ID;

  const productOptions = useMemo(
    () =>
      products.map((product) => {
        const name = getProductDisplayName(product);
        const sellPriceCents = getProductSellPriceCents(product);

        return {
          value: product.id,
          label: name,
          name,
          product,
          category: product.category || "",
          uom: product.UOM || product.uom || "",
          sellPriceCents,
          searchText: productOptionSearchText(product),
        };
      }),
    [products]
  );

  const filteredVendorItemList = useMemo(
    () => vendorItemList.filter((item) => vendorItemMatchesVendor(item, selectedVendor)),
    [selectedVendor, vendorItemList]
  );

  useEffect(() => {
    if (!selectedVendorItem) return;
    if (vendorItemMatchesVendor(selectedVendorItem, selectedVendor)) return;
    setSelectedVendorItem(null);
  }, [selectedVendor, selectedVendorItem]);

  useEffect(() => {
    const loadSelectors = async () => {
      if (!recentlySelectedCompany) {
        setCompanyUserList([]);
        setVendorList([]);
        setVendorItemList([]);
        setProducts([]);
        setLoadingSelectors(false);
        return;
      }

      setLoadingSelectors(true);
      try {
        const [usersSnap, vendorItemSnap, productSnap, vendors] = await Promise.all([
          getDocs(query(collection(db, "companies", recentlySelectedCompany, "companyUsers"))),
          getDocs(
            query(
              collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"),
              orderBy("name")
            )
          ),
          getDocs(query(productCatalogCollectionRef(db, recentlySelectedCompany), orderBy("commonName"))),
          fetchCompanyVendors(db, recentlySelectedCompany),
        ]);

        const users = sortCompanyUsersByName(
          usersSnap.docs.map((docSnap) => {
            const data = docSnap.data();
            const id = data.id || docSnap.id;
            const userName = getCompanyUserDisplayName(data, "Unnamed User");

            return {
              ...data,
              id,
              userId: data.userId || id,
              userName,
              value: data.userId || id,
              label: userName,
              searchText: [userName, data.email, data.phoneNumber, data.phone, data.roleName].filter(Boolean).join(" "),
            };
          })
        );
        const productItems = productSnap.docs.map((productDoc) => ({ id: productDoc.id, ...productDoc.data() }));
        const vendorItems = vendorItemSnap.docs.map((docSnap) => {
          const itemData = docSnap.data();
          const item = {
            id: itemData.id || docSnap.id,
            ...itemData,
            UOM: itemData.UOM || itemData.uom || "",
            vendorId: itemData.vendorId || itemData.venderId || "",
            venderId: itemData.venderId || itemData.vendorId || "",
          };
          const productLink = vendorItemProductLink(item, productItems);
          const labelParts = [
            item.name || item.description || item.sku || "Vendor Item",
            databaseItemRateCents(item) ? moneyFromCents(databaseItemRateCents(item)) : "",
            item.sku || "",
          ].filter(Boolean);

          return {
            ...item,
            productId: productLink.productId,
            productName: productLink.productName,
            genericItemId: productLink.productId,
            genericItemName: productLink.productName,
            value: item.id,
            label: labelParts.join(" - "),
            searchText: [
              item.name,
              item.description,
              item.sku,
              item.category,
              item.subCategory,
              item.UOM,
              productLink.productName,
              item.storeName,
              item.id,
            ]
              .filter(Boolean)
              .join(" "),
          };
        });

        setCompanyUserList(users);
        setVendorItemList(vendorItems);
        setProducts(productItems);
        setVendorList(vendors);
        setSelectedVendor((current) => current || vendors[0] || null);
        setDatabaseItemForm((current) => ({
          ...current,
          vendor: current.vendor || vendors[0] || null,
        }));
      } catch (error) {
        console.error("Error loading receipt selectors:", error);
        toast.error("Could not load receipt selectors.");
      } finally {
        setLoadingSelectors(false);
      }
    };

    loadSelectors();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!activeSourceFile) {
      setSourcePreviewUrl("");
      return undefined;
    }

    const previewUrl = URL.createObjectURL(activeSourceFile);
    setSourcePreviewUrl(previewUrl);

    return () => URL.revokeObjectURL(previewUrl);
  }, [activeSourceFile]);

  useEffect(() => {
    if (databaseItemForm.productLinkMode !== "create") return;

    setDatabaseItemForm((current) => ({
      ...current,
      productName: current.productName || current.name,
      productSellPrice: current.shareProductSellPrice ? current.sellPrice || current.cost : current.productSellPrice,
    }));
  }, [
    databaseItemForm.cost,
    databaseItemForm.name,
    databaseItemForm.productLinkMode,
    databaseItemForm.sellPrice,
    databaseItemForm.shareProductSellPrice,
  ]);

  const formatVendorItemOption = (option, meta) => {
    if (meta.context === "value") return option.name || option.description || option.sku || "Vendor Item";

    const isSelected = meta.selectValue?.some((selected) => selected.value === option.value);
    const detailClass = isSelected ? "text-blue-100" : "text-slate-500";

    return (
      <div>
        <p className={`font-semibold ${isSelected ? "text-white" : "text-slate-900"}`}>
          {option.name || option.description || option.sku || "Vendor Item"}
        </p>
        <p className={`text-xs ${detailClass}`}>
          {[
            option.sku ? `SKU: ${option.sku}` : "",
            databaseItemRateCents(option) ? `Cost: ${moneyFromCents(databaseItemRateCents(option))}` : "",
            option.category,
            option.UOM ? `UOM: ${option.UOM}` : "",
            option.productName ? `Product: ${option.productName}` : "",
          ]
            .filter(Boolean)
            .join(" | ") || "No item details saved"}
        </p>
      </div>
    );
  };

  const formatProductOption = (option, meta) => {
    if (meta.context === "value") return option.name;

    const isSelected = meta.selectValue?.some((selected) => selected.value === option.value);

    return (
      <div>
        <p className={`font-semibold ${isSelected ? "text-white" : "text-slate-900"}`}>{option.name}</p>
        <p className={`text-xs ${isSelected ? "text-blue-100" : "text-slate-500"}`}>
          {[
            option.sellPriceCents ? `Sell: ${moneyFromCents(option.sellPriceCents)}` : "",
            option.category,
            option.uom ? `UOM: ${option.uom}` : "",
          ]
            .filter(Boolean)
            .join(" | ") || "No product details saved"}
        </p>
      </div>
    );
  };

  const handlePurchaseDateChange = (dateOption) => {
    setPurchaseDate(dateOption || new Date());
  };

  const handleCustomReceiptReaderChange = (option) => {
    if (!option?.value) return;
    navigate(option.value);
  };

  const handleSourceFilesChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setSourceQueue(
      files.map((file) => ({
        id: `${file.name}-${file.lastModified}-${uuidv4()}`,
        file,
      }))
    );
    setSourceIndex(0);
    setSavedSourceCount(0);
    setQueueExpanded(true);
  };

  const clearSourceQueue = () => {
    if (isSaving) return;
    setSourceQueue([]);
    setSourceIndex(0);
    setSavedSourceCount(0);
    setQueueExpanded(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetReceiptFieldsForNext = () => {
    setReference("");
    setNotes("");
    setTax("");
    setReceiptTotal("");
    setQuantity("");
    setSelectedVendorItem(null);
    setPurchaseItemList([]);
    setPurchaseDate(new Date());
  };

  const updatePurchaseItem = (itemId, updates) => {
    setPurchaseItemList((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const nextItem = { ...item, ...updates };

        return {
          ...nextItem,
          quantity: numberFromInput(nextItem.quantityString || nextItem.quantity),
          totalCost: lineTotal(nextItem).toFixed(2),
        };
      })
    );
  };

  const addVendorItemToReceipt = (event) => {
    event.preventDefault();
    toast.dismiss();

    if (!selectedVendorItem?.id) {
      toast.error("Select a vendor item before adding a line.");
      return;
    }

    if (!quantity || numberFromInput(quantity) <= 0) {
      toast.error("Enter a quantity before adding a line.");
      return;
    }

    const quantityNumber = numberFromInput(quantity);
    const unitCost = dollarsFromCents(selectedVendorItem.rate) || "0.00";
    const productLink = vendorItemProductLink(selectedVendorItem, products);
    const billingRateCents = Number(
      selectedVendorItem.billingRate ?? selectedVendorItem.sellPrice ?? selectedVendorItem.defaultSellPrice ?? 0
    );
    const id = `comp_pi_${uuidv4()}`;
    const newItem = {
      id,
      sku: selectedVendorItem.sku || "",
      itemId: selectedVendorItem.id,
      name: selectedVendorItem.name || selectedVendorItem.description || selectedVendorItem.sku || "Purchased Item",
      billable: Boolean(selectedVendorItem.billable),
      rate: unitCost,
      quantity: quantityNumber,
      quantityString: quantity,
      description: selectedVendorItem.description || selectedVendorItem.name || "",
      totalCost: (numberFromInput(unitCost) * quantityNumber).toFixed(2),
      category: normalizePurchaseCategory(selectedVendorItem.category),
      subCategory: selectedVendorItem.subCategory || "",
      billingRate: billingRateCents,
      productId: productLink.productId,
      productName: productLink.productName,
      genericItemId: productLink.productId,
      genericItemName: productLink.productName,
    };

    setPurchaseItemList((prev) => [...prev, newItem]);
    setQuantity("");
    setSelectedVendorItem(null);
  };

  const removeItem = (event, itemId) => {
    event.preventDefault();
    setPurchaseItemList((prev) => prev.filter((item) => item.id !== itemId));
  };

  const updateDatabaseItemForm = (updates) => {
    setDatabaseItemForm((current) => {
      const next = { ...current, ...updates };
      const shareProductSellPrice = updates.shareProductSellPrice ?? current.shareProductSellPrice;

      if (updates.cost !== undefined) {
        next.cost = cleanDecimalInput(updates.cost);
        next.costUSD = next.cost || "0";
      }

      if (updates.sellPrice !== undefined) {
        next.sellPrice = cleanDecimalInput(updates.sellPrice);
        next.sellPriceUSD = next.sellPrice || "0";
        if (shareProductSellPrice) {
          next.productSellPrice = next.sellPrice;
        }
      }

      if (updates.productSellPrice !== undefined) {
        next.productSellPrice = cleanDecimalInput(updates.productSellPrice);
      }

      if (updates.shareProductSellPrice === true) {
        next.productSellPrice = next.sellPrice || next.cost;
      }

      if (updates.name !== undefined && next.productLinkMode === "create" && !current.productName) {
        next.productName = updates.name;
      }

      if (updates.selectedProduct !== undefined) {
        next.productLinkMode = updates.selectedProduct ? "connect" : next.productLinkMode;
        next.productName = updates.selectedProduct?.name || next.productName;
      }

      return next;
    });
  };

  const openCreateItemModal = (event) => {
    event.preventDefault();
    setDatabaseItemForm({
      ...blankDatabaseItemForm,
      vendor: selectedVendor || vendorList[0] || null,
    });
    setShowCreateItemModal(true);
  };

  const closeCreateItemModal = (event) => {
    event.preventDefault();
    if (isCreatingDatabaseItem) return;
    setShowCreateItemModal(false);
  };

  const createNewDatabaseItem = async (event) => {
    event.preventDefault();
    if (isCreatingDatabaseItem) return;

    if (!normalizeTextValue(databaseItemForm.name)) {
      toast.error("Vendor item name is required.");
      return;
    }

    if (databaseItemForm.productLinkMode === "connect" && !databaseItemForm.selectedProduct?.product) {
      toast.error("Choose an existing product or switch to creating a new product.");
      return;
    }

    setIsCreatingDatabaseItem(true);
    try {
      const now = new Date();
      const itemId = `com_sett_db_${uuidv4()}`;
      const vendor = databaseItemForm.vendor || selectedVendor || vendorList[0] || null;
      const selectedVendorId = selectedOptionId(vendor);
      const selectedVendorName = selectedOptionLabel(vendor);
      const costCents = centsFromDollarInput(databaseItemForm.costUSD || databaseItemForm.cost);
      const sellPriceCents = centsFromDollarInput(databaseItemForm.sellPriceUSD || databaseItemForm.sellPrice);
      const productSellPriceCents = centsFromDollarInput(
        databaseItemForm.shareProductSellPrice
          ? databaseItemForm.sellPrice || databaseItemForm.cost
          : databaseItemForm.productSellPrice
      );
      let linkedProduct = databaseItemForm.productLinkMode === "connect" ? databaseItemForm.selectedProduct.product : null;
      let item = {
        UOM: databaseItemForm.uom?.label || "Unit",
        id: itemId,
        billable: Boolean(databaseItemForm.billable),
        category: databaseItemForm.category?.label || "Misc",
        color: databaseItemForm.color,
        dateUpdated: now,
        description: databaseItemForm.description,
        name: databaseItemForm.name.trim(),
        rate: costCents,
        size: databaseItemForm.size,
        sku: databaseItemForm.sku,
        storeName: selectedVendorName,
        subCategory: databaseItemForm.subcategory?.label || "Misc",
        timesPurchased: 0,
        venderId: selectedVendorId,
        vendorId: selectedVendorId,
        sellPrice: sellPriceCents,
        billingRate: sellPriceCents,
        tracking: "",
      };

      if (databaseItemForm.productLinkMode === "create") {
        const productId = `com_prod_${uuidv4()}`;
        linkedProduct = buildProductFromVendorItem({
          productId,
          vendorItem: item,
          overrides: {
            name: databaseItemForm.productName || databaseItemForm.name,
            sellPrice: productSellPriceCents || sellPriceCents,
          },
          source: "generalReceiptVendorItemCreate",
          now,
        });
        await setDoc(productCatalogDocRef(db, recentlySelectedCompany, linkedProduct.id), linkedProduct);
        setProducts((prev) =>
          [...prev, linkedProduct].sort((first, second) =>
            getProductDisplayName(first).localeCompare(getProductDisplayName(second))
          )
        );
      } else if (linkedProduct) {
        await updateDoc(productCatalogDocRef(db, recentlySelectedCompany, linkedProduct.id), {
          storeItems: arrayUnion(item.name),
          storeItemsIds: arrayUnion(itemId),
          vendorItemIds: arrayUnion(itemId),
          dateUpdated: now,
          updatedAt: now,
        });
      }

      if (linkedProduct) {
        item = {
          ...item,
          ...buildVendorItemProductPatch(linkedProduct, now),
        };
      }

      await setDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", itemId), item);

      const productLink = vendorItemProductLink(item, linkedProduct ? [...products, linkedProduct] : products);
      const nextVendorItem = {
        ...item,
        productId: productLink.productId,
        productName: productLink.productName,
        genericItemId: productLink.productId,
        genericItemName: productLink.productName,
        value: item.id,
        label: [item.name, moneyFromCents(item.rate), item.sku].filter(Boolean).join(" - "),
        searchText: [item.name, item.description, item.sku, item.category, item.subCategory, item.UOM, productLink.productName]
          .filter(Boolean)
          .join(" "),
      };

      setVendorItemList((prev) =>
        [...prev, nextVendorItem].sort((first, second) =>
          String(first.name || "").localeCompare(String(second.name || ""))
        )
      );
      if (vendor) {
        setSelectedVendor(vendor);
      }
      setSelectedVendorItem(nextVendorItem);
      setDatabaseItemForm(blankDatabaseItemForm);
      setShowCreateItemModal(false);
      toast.success("Vendor item created.");
    } catch (error) {
      console.error("Error creating vendor item from receipt:", error);
      toast.error("Failed to create vendor item.");
    } finally {
      setIsCreatingDatabaseItem(false);
    }
  };

  const uploadActiveSourceFile = async (receiptId) => {
    if (!activeSourceFile) return [];

    const fileRef = ref(
      storage,
      `companies/${recentlySelectedCompany}/receipts/${receiptId}/${Date.now()}-${activeSourceFile.name}`
    );
    await uploadBytes(fileRef, activeSourceFile);
    return [await getDownloadURL(fileRef)];
  };

  const saveReceipt = async ({ addAnother = false } = {}) => {
    if (isSaving) return;
    if (!recentlySelectedCompany) return toast.error("Select a company before saving.");
    if (!selectedVendor) return toast.error("Select a vendor before saving.");
    if (!purchaseItemList.length) return toast.error("Add at least one line item.");

    setIsSaving(true);
    try {
      const receiptId = `com_rec_${uuidv4()}`;
      const purchasedItemIds = [];
      const pdfUrlList = await uploadActiveSourceFile(receiptId);
      const receiptNotes = normalizeTextValue(notes);
      const sourceNote = activeSourceFile ? `Receipt file: ${activeSourceFile.name}` : "";
      const selectedVendorId = selectedOptionId(selectedVendor);
      const selectedVendorName = getVendorName(selectedVendor);
      const selectedTechId = getCompanyUserId(selectedUser);
      const selectedTechName = selectedUser?.userName || selectedUser?.label || "";

      for (const item of purchaseItemList) {
        const price = centsFromDollarInput(item.rate);
        const billingRate = Number(item.billingRate || 0);

        purchasedItemIds.push(item.id);
        await setDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", item.id), {
          id: item.id,
          receiptId,
          invoiceNum: reference,
          venderId: selectedVendorId,
          venderName: selectedVendorName,
          vendorId: selectedVendorId,
          vendorName: selectedVendorName,
          techId: selectedTechId,
          techName: selectedTechName,
          itemId: item.itemId,
          name: item.name,
          category: normalizePurchaseCategory(item.category),
          subCategory: item.subCategory || "",
          price,
          quantityString: item.quantityString,
          date: purchaseDate,
          billable: Boolean(item.billable),
          productId: item.productId || "",
          productName: item.productName || "",
          genericItemId: item.genericItemId || item.productId || "",
          genericItemName: item.genericItemName || item.productName || "",
          invoiced: false,
          returned: false,
          status: item.billable ? "Needs invoice" : "Non-billable",
          customerId: "",
          customerName: "",
          sku: item.sku || "",
          notes: [receiptNotes, sourceNote].filter(Boolean).join(" | "),
          jobId: "",
          workOrderId: "",
          assignedJobId: "",
          assignedToJob: false,
          assignmentStatus: "unassigned",
          billingOwner: "purchasedItem",
          jobBillingStatus: "",
          jobBillable: false,
          jobBillingRate: 0,
          billingRate,
          source: "generalReceiptCreate",
        });
      }

      await setDoc(doc(db, "companies", recentlySelectedCompany, "receipts", receiptId), {
        id: receiptId,
        invoiceNum: reference,
        date: purchaseDate,
        storeId: selectedVendorId,
        storeName: selectedVendorName,
        tech: selectedTechName,
        techId: selectedTechId,
        techName: selectedTechName,
        purchasedItemIds,
        numberOfItems: purchasedItemIds.length,
        cost: centsFromDollarInput(subtotal.toFixed(2)),
        tax: centsFromDollarInput(tax),
        costAfterTax: centsFromDollarInput(summaryTotal.toFixed(2)),
        notes,
        pdfUrlList,
        source: "generalReceiptCreate",
      });

      toast.success("Receipt created.");

      if (!addAnother) {
        navigate(`/company/receipts/detail/${receiptId}`);
        return;
      }

      setSavedSourceCount((current) => current + (activeSourceFile ? 1 : 0));
      resetReceiptFieldsForNext();

      if (sourceIndex + 1 < sourceQueue.length) {
        setSourceIndex((current) => current + 1);
      } else {
        clearSourceQueue();
      }
    } catch (error) {
      console.error("Error saving receipt:", error);
      toast.error("Failed to save receipt.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link to="/company/purchased-items" className="app-back-link">
              &larr; Back to Purchased Items
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Create New Receipt</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {showCustomReceiptReaders ? (
              <div className="min-w-[220px] text-sm font-semibold text-gray-700">
                <Select
                  value={null}
                  options={customReceiptReaderOptions}
                  onChange={handleCustomReceiptReaderChange}
                  isSearchable={false}
                  placeholder="Custom receipt readers"
                  styles={selectStyles}
                  theme={selectTheme}
                />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => saveReceipt({ addAnother: true })}
              disabled={loadingSelectors || isSaving || !purchaseItemList.length}
              className="rounded-md border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save and Add Another"}
            </button>
            <button
              type="button"
              onClick={() => saveReceipt()}
              disabled={loadingSelectors || isSaving || !purchaseItemList.length}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Receipt"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Reference
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                placeholder="Invoice or receipt #"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Purchase Date
              <DatePicker
                selected={purchaseDate}
                onChange={handlePurchaseDateChange}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
            <div className="text-sm font-semibold text-gray-700 xl:col-span-4">
              <p>Vendor</p>
              <div className="mt-1 font-normal">
                <Select
                  value={selectedVendor}
                  options={vendorList}
                  onChange={(option) => {
                    setSelectedVendor(option);
                    setDatabaseItemForm((current) => ({
                      ...current,
                      vendor: option || current.vendor,
                    }));
                  }}
                  isSearchable
                  placeholder="Select a Vendor"
                  styles={selectStyles}
                  theme={selectTheme}
                />
              </div>
            </div>
            <div className="text-sm font-semibold text-gray-700 xl:col-span-4">
              <p>Technician</p>
              <div className="mt-1 font-normal">
                <Select
                  value={selectedUser}
                  options={companyUserList}
                  onChange={setSelectedUser}
                  isClearable
                  isSearchable
                  placeholder="Select a Tech"
                  filterOption={(option, inputValue) =>
                    option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                  }
                  styles={selectStyles}
                  theme={selectTheme}
                />
              </div>
            </div>
            <label className="text-sm font-semibold text-gray-700 md:col-span-2 xl:col-span-6">
              Notes
              <textarea
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Subtotal
              <input
                value={subtotal.toFixed(2)}
                readOnly
                className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-normal text-gray-700"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Tax
              <input
                value={tax}
                onChange={(event) => setTax(cleanDecimalInput(event.target.value))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                placeholder="0.00"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Total
              <input
                value={receiptTotal}
                onChange={(event) => setReceiptTotal(cleanDecimalInput(event.target.value))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                placeholder={(subtotal + taxAmount).toFixed(2)}
              />
            </label>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Receipt PDFs</h2>
                  <p className="mt-1 text-xs font-semibold text-gray-500">
                    {savedSourceCount} Saved / {sourceCount} Selected
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSaving}
                  className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Add PDFs
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,.pdf"
                onChange={handleSourceFilesChange}
                className="hidden"
              />
              <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-gray-900">Queue</span>
                  <button
                    type="button"
                    onClick={() => setQueueExpanded((expanded) => !expanded)}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    {queueExpanded ? "Collapse" : "Expand"}
                  </button>
                </div>
                {queueExpanded ? (
                  <div className="mt-3 space-y-2">
                    {sourceQueue.length ? (
                      sourceQueue.map((queueItem, index) => {
                        const isCurrent = index === sourceIndex;
                        const isDone = index < sourceIndex || (isCurrent && savedSourceCount > index);

                        return (
                          <button
                            key={queueItem.id}
                            type="button"
                            onClick={() => setSourceIndex(index)}
                            disabled={isSaving}
                            className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs ${
                              isCurrent
                                ? "border-blue-200 bg-blue-50 text-blue-900"
                                : isDone
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                  : "border-gray-200 bg-white text-gray-600"
                            }`}
                          >
                            <span className="min-w-0 truncate font-semibold">{queueItem.file.name}</span>
                            <span className="shrink-0">{isCurrent ? "Current" : isDone ? "Saved" : "Waiting"}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-md border border-dashed border-gray-300 bg-white p-4 text-center text-xs font-semibold text-gray-500">
                        No PDFs selected.
                      </div>
                    )}
                    {sourceQueue.length ? (
                      <button
                        type="button"
                        onClick={clearSourceQueue}
                        disabled={isSaving}
                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        Clear Queue
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900">Preview</h2>
                  <p className="mt-1 truncate text-sm text-gray-500">{activeSourceFile?.name || "No PDF selected"}</p>
                </div>
                {sourcePreviewUrl ? (
                  <a
                    href={sourcePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Open
                  </a>
                ) : null}
              </div>
              <div className="mt-4 h-[520px] overflow-hidden rounded-md border border-gray-200 bg-gray-100">
                {sourcePreviewUrl ? (
                  <iframe title="Receipt PDF preview" src={sourcePreviewUrl} className="h-full w-full" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-500">
                    Select a PDF
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Line Items</h2>
                <p className="mt-1 text-sm text-gray-500">{purchaseItemList.length} item(s)</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-right text-sm">
                <div>
                  <p className="font-semibold text-gray-500">Subtotal</p>
                  <p className="font-bold text-gray-900">{money(subtotal)}</p>
                </div>
                <div>
                  <p className="font-semibold text-gray-500">Tax</p>
                  <p className="font-bold text-gray-900">{money(taxAmount)}</p>
                </div>
                <div>
                  <p className="font-semibold text-gray-500">Total</p>
                  <p className="font-bold text-gray-900">{money(summaryTotal)}</p>
                </div>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              {purchaseItemList.length ? (
                <table className="min-w-[1120px] w-full border-separate border-spacing-y-2 text-left text-sm">
                  <thead>
                    <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-1">SKU</th>
                      <th className="px-2 py-1">Vendor Item</th>
                      <th className="px-2 py-1">Product</th>
                      <th className="px-2 py-1">Category</th>
                      <th className="px-2 py-1">Cost</th>
                      <th className="px-2 py-1">Qty</th>
                      <th className="px-2 py-1">Total</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseItemList.map((item) => (
                      <tr key={item.id} className="rounded-md bg-gray-50">
                        <td className="px-2 py-2 text-gray-700">{item.sku || "--"}</td>
                        <td className="px-2 py-2">
                          <p className="font-semibold text-gray-900">{item.name}</p>
                          <p className="mt-1 text-xs text-gray-500">{item.description || item.itemId}</p>
                        </td>
                        <td className="px-2 py-2">
                          {item.productName ? (
                            <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                              {item.productName}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-700">No product link</span>
                          )}
                        </td>
                        <td className="px-2 py-2">{item.category || "Uncategorized"}</td>
                        <td className="px-2 py-2">
                          <div className="flex w-28 items-center rounded-md border border-gray-300 bg-white px-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                            <span className="text-gray-500">$</span>
                            <input
                              className="w-full px-1 py-2 outline-none"
                              value={item.rate}
                              onChange={(event) => updatePurchaseItem(item.id, { rate: cleanDecimalInput(event.target.value) })}
                              inputMode="decimal"
                              aria-label={`Cost for ${item.name}`}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="w-24 rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-blue-100"
                            value={item.quantityString}
                            onChange={(event) =>
                              updatePurchaseItem(item.id, { quantityString: cleanDecimalInput(event.target.value) })
                            }
                            inputMode="decimal"
                            aria-label={`Quantity for ${item.name}`}
                          />
                        </td>
                        <td className="px-2 py-2 font-bold text-gray-900">{money(lineTotal(item))}</td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={(event) => removeItem(event, item.id)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm font-semibold text-gray-500">
                  No line items added yet.
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 border-t border-gray-200 pt-5 md:grid-cols-12">
              <div className="md:col-span-7">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-sm font-semibold text-gray-700">Vendor Item</label>
                  <span className="text-xs font-semibold text-gray-500">
                    {filteredVendorItemList.length} for {getVendorName(selectedVendor) || "all vendors"}
                  </span>
                </div>
                <div className="mt-1">
                  <Select
                    value={selectedVendorItem}
                    options={filteredVendorItemList}
                    onChange={setSelectedVendorItem}
                    isSearchable
                    placeholder="Search vendor items"
                    formatOptionLabel={formatVendorItemOption}
                    filterOption={(option, inputValue) =>
                      option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                    }
                    noOptionsMessage={() =>
                      selectedVendor ? "No vendor items found for this vendor" : "No vendor items found"
                    }
                    styles={selectStyles}
                    theme={selectTheme}
                    menuPortalTarget={selectMenuPortalTarget || undefined}
                  />
                </div>
              </div>
              <label className="text-sm font-semibold text-gray-700 md:col-span-2">
                Quantity
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                  onChange={(event) => setQuantity(cleanDecimalInput(event.target.value))}
                  type="text"
                  placeholder="1"
                  value={quantity}
                />
              </label>
              <div className="flex items-end gap-2 md:col-span-3">
                <button
                  type="button"
                  onClick={addVendorItemToReceipt}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
                >
                  Add Item
                </button>
                <button
                  type="button"
                  onClick={openCreateItemModal}
                  className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Create Item
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isSaving ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="rounded-lg bg-white px-8 py-6 font-semibold text-gray-800 shadow-xl">Saving receipt...</div>
        </div>
      ) : null}

      {showCreateItemModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Create Vendor Item</h2>
                <p className="mt-1 text-sm text-gray-500">Connect supplier-specific purchases to the Product Catalog.</p>
              </div>
              <button
                type="button"
                onClick={closeCreateItemModal}
                disabled={isCreatingDatabaseItem}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">
                Vendor Item Name
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                  onChange={(event) => updateDatabaseItemForm({ name: event.target.value })}
                  type="text"
                  value={databaseItemForm.name}
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Cost
                <div className="mt-1 flex items-center rounded-md border border-gray-300 bg-white px-3">
                  <span className="text-gray-500">$</span>
                  <input
                    className="w-full px-2 py-2 font-normal outline-none"
                    onChange={(event) => updateDatabaseItemForm({ cost: event.target.value })}
                    type="text"
                    value={databaseItemForm.cost}
                    placeholder="0.00"
                  />
                </div>
              </label>
              <label className="text-sm font-semibold text-gray-700">
                SKU
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                  onChange={(event) => updateDatabaseItemForm({ sku: event.target.value })}
                  type="text"
                  value={databaseItemForm.sku}
                />
              </label>
              <div className="text-sm font-semibold text-gray-700">
                <p>Vendor</p>
                <div className="mt-1 font-normal">
                  <Select
                    value={databaseItemForm.vendor}
                    options={vendorList}
                    onChange={(option) => updateDatabaseItemForm({ vendor: option })}
                    isSearchable
                    placeholder="Select a Vendor"
                    styles={selectStyles}
                    theme={selectTheme}
                  />
                </div>
              </div>
              <div className="text-sm font-semibold text-gray-700">
                <p>U.O.M.</p>
                <div className="mt-1 font-normal">
                  <Select
                    value={databaseItemForm.uom}
                    options={uomOptions}
                    onChange={(option) => updateDatabaseItemForm({ uom: option })}
                    isSearchable
                    styles={selectStyles}
                    theme={selectTheme}
                  />
                </div>
              </div>
              <div className="text-sm font-semibold text-gray-700">
                <p>Category</p>
                <div className="mt-1 font-normal">
                  <Select
                    value={databaseItemForm.category}
                    options={categoryOptions}
                    onChange={(option) => updateDatabaseItemForm({ category: option })}
                    isSearchable
                    styles={selectStyles}
                    theme={selectTheme}
                  />
                </div>
              </div>
              <div className="text-sm font-semibold text-gray-700">
                <p>Subcategory</p>
                <div className="mt-1 font-normal">
                  <Select
                    value={databaseItemForm.subcategory}
                    options={subcategoryOptions}
                    onChange={(option) => updateDatabaseItemForm({ subcategory: option })}
                    isSearchable
                    styles={selectStyles}
                    theme={selectTheme}
                  />
                </div>
              </div>
              <label className="text-sm font-semibold text-gray-700">
                Size
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                  onChange={(event) => updateDatabaseItemForm({ size: event.target.value })}
                  type="text"
                  value={databaseItemForm.size}
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Color
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                  onChange={(event) => updateDatabaseItemForm({ color: event.target.value })}
                  type="text"
                  value={databaseItemForm.color}
                />
              </label>
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">
                Description
                <textarea
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
                  onChange={(event) => updateDatabaseItemForm({ description: event.target.value })}
                  value={databaseItemForm.description}
                  rows={3}
                />
              </label>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-4 sm:col-span-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Billing</p>
                    <p className="mt-1 text-xs text-gray-500">Stored on the vendor item and copied to purchases.</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <input
                      type="checkbox"
                      checked={databaseItemForm.billable}
                      onChange={(event) => updateDatabaseItemForm({ billable: event.target.checked })}
                    />
                    Billable
                  </label>
                </div>
                {databaseItemForm.billable ? (
                  <label className="mt-4 block text-sm font-semibold text-gray-700">
                    Sell Price
                    <div className="mt-1 flex items-center rounded-md border border-gray-300 bg-white px-3">
                      <span className="text-gray-500">$</span>
                      <input
                        className="w-full px-2 py-2 font-normal outline-none"
                        onChange={(event) => updateDatabaseItemForm({ sellPrice: event.target.value })}
                        type="text"
                        value={databaseItemForm.sellPrice}
                        placeholder="0.00"
                      />
                    </div>
                  </label>
                ) : null}
              </div>

              <div className="rounded-md border border-blue-100 bg-blue-50 p-4 sm:col-span-2">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-bold text-blue-950">Product Catalog Link</p>
                    <p className="mt-1 text-xs leading-5 text-blue-800">Products are shared across vendors, jobs, and invoices.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: "create", label: "Create Product" },
                      { value: "connect", label: "Connect Product" },
                      { value: "skip", label: "Skip" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateDatabaseItemForm({ productLinkMode: option.value })}
                        className={`rounded-md px-3 py-2 text-xs font-bold transition ${
                          databaseItemForm.productLinkMode === option.value
                            ? "bg-blue-700 text-white"
                            : "border border-blue-200 bg-white text-blue-800 hover:bg-blue-100"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {databaseItemForm.productLinkMode === "connect" ? (
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-blue-950">Existing Product</label>
                    <div className="mt-2">
                      <Select
                        value={databaseItemForm.selectedProduct}
                        options={productOptions}
                        onChange={(option) => updateDatabaseItemForm({ selectedProduct: option })}
                        isSearchable
                        isClearable
                        placeholder="Search the Product Catalog"
                        formatOptionLabel={formatProductOption}
                        filterOption={(option, inputValue) =>
                          option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                        }
                        styles={selectStyles}
                        theme={selectTheme}
                        menuPortalTarget={selectMenuPortalTarget || undefined}
                      />
                    </div>
                  </div>
                ) : null}

                {databaseItemForm.productLinkMode === "create" ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-blue-950">
                      Product Name
                      <input
                        value={databaseItemForm.productName}
                        onChange={(event) => updateDatabaseItemForm({ productName: event.target.value })}
                        className="mt-1 w-full rounded-md border border-blue-200 px-3 py-2 font-normal text-slate-900"
                      />
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-blue-100 bg-white px-3 py-2 text-sm font-semibold text-blue-950">
                      <input
                        type="checkbox"
                        checked={databaseItemForm.shareProductSellPrice}
                        onChange={(event) => updateDatabaseItemForm({ shareProductSellPrice: event.target.checked })}
                      />
                      Use sell price
                    </label>
                    <label className="text-sm font-semibold text-blue-950">
                      Product Sell Price
                      <input
                        value={databaseItemForm.productSellPrice}
                        onChange={(event) => updateDatabaseItemForm({ productSellPrice: event.target.value })}
                        disabled={databaseItemForm.shareProductSellPrice}
                        className="mt-1 w-full rounded-md border border-blue-200 px-3 py-2 font-normal text-slate-900 disabled:bg-blue-100"
                        placeholder="0.00"
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 sm:col-span-2">
                <button
                  type="button"
                  onClick={closeCreateItemModal}
                  disabled={isCreatingDatabaseItem}
                  className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createNewDatabaseItem}
                  disabled={isCreatingDatabaseItem || !newProductWillBeCreated}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {isCreatingDatabaseItem ? "Creating..." : "Create Vendor Item"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CreateNewPurchase;
