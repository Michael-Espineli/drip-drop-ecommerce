import React, { useState, useEffect, useContext, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  writeBatch,
} from "firebase/firestore";
import { db, storage } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import Select from "react-select";
import toast from "react-hot-toast";
import { fetchCompanyVendors } from "../../../utils/vendors";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  CATEGORY_OPTIONS,
  databaseItemSelectStyles,
  databaseItemSelectTheme,
  DEFAULT_CATEGORY,
  DEFAULT_SUBCATEGORY,
  DEFAULT_UOM,
  isChemicalCategory,
  SUBCATEGORY_OPTIONS,
  UOM_OPTIONS,
} from "./databaseItemOptions";
import {
  dosageLabel,
  queueDatabaseItemDosageLinkUpdates,
  sortDosageTemplates,
} from "../../../utils/dosageItemLinks";
import {
  itemPhotoFieldsFromUrl,
  uploadItemPhoto,
  validateItemPhotoFile,
} from "../../../utils/itemPhotos";
import EquipmentCatalogPicker from "../../components/equipment/EquipmentCatalogPicker";
import {
  databaseEquipmentMappingPatch,
  emptyDatabaseEquipmentMapping,
  isEquipmentDatabaseCategory,
} from "../../../utils/databaseEquipmentItems";
import {
  buildProductFromVendorItem,
  buildVendorItemProductPatch,
  getProductDisplayName,
  productCatalogCollectionRef,
  productCatalogDocRef,
  productOptionSearchText,
} from "../../../utils/productCatalog";

const centsFromDollarInput = (value) => {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const CreateNewDataBaseItem = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { requirePermission } = useCompanyPermissions();

  const navigate = useNavigate();
  const location = useLocation();
  const vendorItemsBasePath = location.pathname.toLowerCase().startsWith("/company/settings")
    ? "/company/settings/vendor-items"
    : "/company/items";

  const [billable, setBillable] = useState(false);

  const [rate, setRate] = useState("0");
  const [rateUSD, setRateUSD] = useState("0");

  const [sellPrice, setSellPrice] = useState("0");
  const [sellPriceUSD, setSellPriceUSD] = useState("0");

  const [sku, setSku] = useState("");
  const [uom, setUom] = useState(DEFAULT_UOM);
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [subcategory, setSubcategory] = useState(DEFAULT_SUBCATEGORY);
  const [color, setColor] = useState("");
  const [description, setDescription] = useState("");
  const [itemName, setItemName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [size, setSize] = useState("");
  const [tracking, setTracking] = useState("");

  const [venderList, setVenderList] = useState([]);
  const [vender, setVender] = useState("");
  const [venderName, setVenderName] = useState("");
  const [venderId, setVenderId] = useState("");
  const [dosages, setDosages] = useState([]);
  const [linkedDosageIds, setLinkedDosageIds] = useState([]);
  const [dosageSearchTerm, setDosageSearchTerm] = useState("");
  const [equipmentMapping, setEquipmentMapping] = useState(() => emptyDatabaseEquipmentMapping());
  const [products, setProducts] = useState([]);
  const [productLinkMode, setProductLinkMode] = useState("create");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productName, setProductName] = useState("");
  const [productSellPrice, setProductSellPrice] = useState("0");

  const [uomList] = useState(UOM_OPTIONS);
  const [categoryList] = useState(CATEGORY_OPTIONS);
  const [subcategoryList] = useState(SUBCATEGORY_OPTIONS);

  const allowsLinkedDosages = isChemicalCategory(category);
  const allowsEquipmentMapping = isEquipmentDatabaseCategory(category?.label || category);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  const handleUOMChange = (selectedOption2) => {
    (async () => {
      setUom(selectedOption2);
    })();
  };

  const handleCategoryChange = (selectedOption2) => {
    (async () => {
      setCategory(selectedOption2);
    })();
  };

  const handleSubcategoryChange = (selectedOption2) => {
    (async () => {
      setSubcategory(selectedOption2);
    })();
  };

  const handleVenderChange = (selectedOption2) => {
    (async () => {
      setVenderName(selectedOption2?.label || selectedOption2?.name || "");
      setVenderId(selectedOption2?.id || "");
      setVender(selectedOption2);
    })();
  };

  const handlePhotoFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    const validationMessage = validateItemPhotoFile(file);

    if (validationMessage) {
      setPhotoError(validationMessage);
      setPhotoFile(null);
      setPhotoPreviewUrl("");
      return;
    }

    setPhotoError("");
    setPhotoFile(file);
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : "");
  };

  useEffect(() => {
    (async () => {
      if (!recentlySelectedCompany) {
        setVenderList([]);
        return;
      }

      try {
        const vendors = await fetchCompanyVendors(db, recentlySelectedCompany);
        setVenderList(vendors);
        if (vendors.length) {
          setVender((current) => current || vendors[0]);
          setVenderName((current) => current || vendors[0].label || vendors[0].name || "");
          setVenderId((current) => current || vendors[0].id || "");
        }
      } catch (error) {
        console.log("Error loading vendors", error);
      }
    })();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    (async () => {
      if (!recentlySelectedCompany) {
        setProducts([]);
        return;
      }

      try {
        const productSnap = await getDocs(query(productCatalogCollectionRef(db, recentlySelectedCompany), orderBy("commonName")));
        setProducts(productSnap.docs.map((productDoc) => ({ id: productDoc.id, ...productDoc.data() })));
      } catch (error) {
        console.log("Error loading products", error);
      }
    })();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    (async () => {
      if (!recentlySelectedCompany) {
        setDosages([]);
        setLinkedDosageIds([]);
        return;
      }

      try {
        const dosageSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dosages", "dosages"));
        setDosages(sortDosageTemplates(dosageSnap.docs.map((dosageDoc) => ({ id: dosageDoc.id, ...dosageDoc.data() }))));
      } catch (error) {
        console.log("Error loading dosages", error);
      }
    })();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!allowsLinkedDosages) {
      setLinkedDosageIds([]);
      setDosageSearchTerm("");
    }
  }, [allowsLinkedDosages]);

  const filteredDosages = dosages.filter((dosage) =>
    dosageLabel(dosage).toLowerCase().includes(dosageSearchTerm.trim().toLowerCase())
  );

  const selectedLinkedDosages = dosages.filter((dosage) => linkedDosageIds.includes(dosage.id));
  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        value: product.id,
        label: getProductDisplayName(product),
        product,
        searchText: productOptionSearchText(product),
      })),
    [products]
  );

  useEffect(() => {
    if (productLinkMode !== "create") return;
    setProductName((current) => current || itemName);
  }, [itemName, productLinkMode]);

  useEffect(() => {
    if (productLinkMode !== "create") return;
    setProductSellPrice(sellPriceUSD || sellPrice || "0");
  }, [productLinkMode, sellPrice, sellPriceUSD]);

  const toggleLinkedDosageId = (dosageId) => {
    setLinkedDosageIds((currentIds) =>
      currentIds.includes(dosageId)
        ? currentIds.filter((currentId) => currentId !== dosageId)
        : [...currentIds, dosageId]
    );
  };

  async function rateInput(e) {
    e.preventDefault();
    try {
      let value = e.target.value.replace(/[^\d.]/g, "");
      setRate(value);
      const parts = value.split(".");
      if (parts.length > 1) {
        parts[1] = parts[1].slice(0, 2);
        value = parts.join(".");
      }
      if (!isNaN(value)) {
        setRateUSD(value);
      } else {
        setRateUSD("0");
      }
    } catch (error) {
      console.log(error);
    }
  }

  async function sellPriceInput(e) {
    e.preventDefault();
    try {
      let value = e.target.value.replace(/[^\d.]/g, "");
      setSellPrice(value);
      const parts = value.split(".");
      if (parts.length > 1) {
        parts[1] = parts[1].slice(0, 2);
        value = parts.join(".");
      }
      if (!isNaN(value)) {
        setSellPriceUSD(value);
      } else {
        setSellPriceUSD("0");
      }
    } catch (error) {
      console.log(error);
    }
  }

  async function billableTrue(e) {
    setBillable(true);
  }

  async function billableFalse(e) {
    setBillable(false);
  }

  async function createNewItem(e) {
    e.preventDefault();
    if (!requirePermission("852", "create vendor items")) return;

    try {
      if (
        allowsEquipmentMapping &&
        (!equipmentMapping.type || !equipmentMapping.make || !equipmentMapping.model)
      ) {
        toast.error("Connect this equipment item to universal equipment or enter custom type, make, and model.");
        return;
      }

      let id = "com_sett_db_" + uuidv4();

      let rateCents = centsFromDollarInput(rateUSD || rate);
      let sellPriceCents = centsFromDollarInput(sellPriceUSD || sellPrice);
      let productSellPriceCents = centsFromDollarInput(productSellPrice || sellPriceUSD || sellPrice);
      const selectedVendorId = vender?.id || venderId || "";
      const selectedVendorName = vender?.label || vender?.name || venderName || "";
      const linkedProduct = productLinkMode === "connect" ? selectedProduct?.product || null : null;

      if (productLinkMode === "connect" && !linkedProduct) {
        toast.error("Choose an existing product or switch to creating a new product.");
        return;
      }

      let uploadedPhoto = {
        photoUrl: photoUrl.trim(),
        storagePath: "",
      };

      if (photoFile) {
        uploadedPhoto = await uploadItemPhoto({
          storage,
          companyId: recentlySelectedCompany,
          file: photoFile,
          itemType: "databaseItems",
          itemId: id,
        });
      }

      const photoFields = itemPhotoFieldsFromUrl(
        uploadedPhoto.photoUrl,
        itemName || "Vendor item photo",
        uploadedPhoto.storagePath
      );

      let item = {
        UOM: uom?.label || "Unit",
        id: id,
        billable: billable,
        category: category?.label || "Misc",
        color: color,
        dateUpdated: new Date(),
        description: description,
        name: itemName,
        rate: rateCents,
        size: size,
        sku: sku,
        storeName: selectedVendorName,
        subCategory: subcategory?.label || "Misc",
        timesPurchased: 0,
        venderId: selectedVendorId,
        vendorId: selectedVendorId,
        sellPrice: sellPriceCents,
        billingRate: sellPriceCents,
        tracking: tracking,
        ...(allowsEquipmentMapping ? databaseEquipmentMappingPatch(equipmentMapping) : {}),
        ...photoFields,
      };

      let productRecord = linkedProduct;
      const now = new Date();
      if (productLinkMode === "create") {
        const productId = "com_prod_" + uuidv4();
        productRecord = buildProductFromVendorItem({
          productId,
          vendorItem: item,
          overrides: {
            name: productName || itemName,
            sellPrice: productSellPriceCents,
          },
          source: "manualVendorItemCreate",
          now,
        });
      }

      if (productRecord) {
        item = {
          ...item,
          ...buildVendorItemProductPatch(productRecord, now),
        };
      }

      const batch = writeBatch(db);
      if (productLinkMode === "create" && productRecord) {
        batch.set(productCatalogDocRef(db, recentlySelectedCompany, productRecord.id), productRecord);
      } else if (productRecord) {
        batch.update(productCatalogDocRef(db, recentlySelectedCompany, productRecord.id), {
          storeItems: arrayUnion(item.name),
          storeItemsIds: arrayUnion(id),
          vendorItemIds: arrayUnion(id),
          dateUpdated: now,
          updatedAt: now,
        });
      }
      batch.set(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id), item);
      queueDatabaseItemDosageLinkUpdates(batch, {
        companyId: recentlySelectedCompany,
        itemId: id,
        dosages,
        selectedDosageIds: allowsLinkedDosages ? linkedDosageIds : [],
      });
      await batch.commit();
      navigate(`${vendorItemsBasePath}/detail/${id}`);
    } catch (error) {
      console.log(error);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Vendor Items</p>
              <h2 className="mt-1 text-3xl font-bold text-slate-950">Create Vendor Item</h2>
              <p className="mt-1 text-sm text-slate-500">Add a vendor-specific purchasable item and link it to the Product Catalog.</p>
            </div>

            <Link
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              to={vendorItemsBasePath}
            >
              &larr; Back to Vendor Items
            </Link>
          </div>
        </section>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
            <div className="text-sm font-semibold text-slate-700">Vendor Item Details</div>
            <div className="text-xs text-slate-500 mt-1">Fill out the supplier-specific item details and product catalog link.</div>
          </div>

          <div className="p-6 space-y-4">
            {/* Item Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700">Vendor Item Name</label>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onChange={(e) => setItemName(e.target.value)}
                type="text"
                placeholder="e.g. Chlorine Tabs"
                value={itemName}
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                  {photoPreviewUrl || photoUrl ? (
                    <img
                      src={photoPreviewUrl || photoUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-400">
                      Photo
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Vendor Item Photo</label>
                    <input
                      className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoFileChange}
                    />
                    {photoFile ? (
                    <p className="mt-1 text-xs text-slate-500">{photoFile.name} will upload when you create the product.</p>
                    ) : null}
                    {photoError ? (
                      <p className="mt-1 text-xs font-semibold text-red-600">{photoError}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Photo URL</label>
                    <input
                      className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      type="url"
                      placeholder="https://..."
                      value={photoUrl}
                      onChange={(e) => setPhotoUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Rate */}
            <div>
              <label className="block text-sm font-semibold text-slate-700">Rate</label>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                <span className="text-sm font-semibold text-slate-500">$</span>
                <input
                  className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  onChange={(e) => rateInput(e)}
                  type="text"
                  placeholder="0.00"
                  value={rate}
                />
              </div>
              <div className="text-xs text-slate-500 mt-1">Internal cost rate, stored in cents.</div>
            </div>

            {/* Billable Toggle + Billing Rate */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Billing</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Mark billable to set the customer-facing sell price.
                  </div>
                </div>

                {billable ? (
                  <button
                    onClick={(e) => billableFalse(e)}
                    className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    Billable
                  </button>
                ) : (
                  <button
                    onClick={(e) => billableTrue(e)}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Not Billable
                  </button>
                )}
              </div>

              {billable && (
                <div className="mt-4">
                  <label className="block text-sm font-semibold text-slate-700">Sell Price</label>
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                    <span className="text-sm font-semibold text-slate-500">$</span>
                    <input
                      className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                      onChange={(e) => sellPriceInput(e)}
                      type="text"
                      placeholder="0.00"
                      value={sellPrice}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-blue-950">Product Catalog Link</div>
                  <div className="mt-1 text-xs leading-5 text-blue-800">
                    Products are the generic items used on invoices and jobs. Vendor items stay supplier-specific for receipts and audit history.
                  </div>
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
                      onClick={() => setProductLinkMode(option.value)}
                      className={`rounded-md px-3 py-2 text-xs font-bold transition ${
                        productLinkMode === option.value
                          ? "bg-blue-700 text-white"
                          : "border border-blue-200 bg-white text-blue-800 hover:bg-blue-100"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {productLinkMode === "connect" ? (
                <div className="mt-4">
                  <label className="block text-sm font-semibold text-blue-950">Existing Product</label>
                  <div className="mt-2">
                    <Select
                      value={selectedProduct}
                      options={productOptions}
                      onChange={setSelectedProduct}
                      isSearchable
                      isClearable
                      placeholder="Search the Product Catalog"
                      filterOption={(option, inputValue) =>
                        option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                      }
                      styles={databaseItemSelectStyles}
                      theme={databaseItemSelectTheme}
                    />
                  </div>
                </div>
              ) : null}

              {productLinkMode === "create" ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-blue-950">Product Name</label>
                    <input
                      className="mt-2 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      onChange={(e) => setProductName(e.target.value)}
                      type="text"
                      placeholder="Generic product name"
                      value={productName}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-blue-950">Product Sell Price</label>
                    <div className="mt-2 flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                      <span className="text-sm font-semibold text-slate-500">$</span>
                      <input
                        className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                        onChange={(e) => setProductSellPrice(e.target.value.replace(/[^\d.]/g, ""))}
                        type="text"
                        placeholder="0.00"
                        value={productSellPrice}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* SKU */}
            <div>
              <label className="block text-sm font-semibold text-slate-700">SKU</label>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onChange={(e) => setSku(e.target.value)}
                type="text"
                placeholder="e.g. SKU-1234"
                value={sku}
              />
            </div>

            {/* Selects Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Vendor</label>
                <div className="mt-2">
                  <Select
                    value={vender}
                    options={venderList}
                    onChange={handleVenderChange}
                    isSearchable
                    placeholder="Select a Vendor"
                    styles={databaseItemSelectStyles}
                    theme={databaseItemSelectTheme}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">U.O.M.</label>
                <div className="mt-2">
                  <Select
                    value={uom}
                    options={uomList}
                    onChange={handleUOMChange}
                    isSearchable
                    placeholder="Select a UOM"
                    styles={databaseItemSelectStyles}
                    theme={databaseItemSelectTheme}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Category</label>
                <div className="mt-2">
                  <Select
                    value={category}
                    options={categoryList}
                    onChange={handleCategoryChange}
                    isSearchable
                    placeholder="Select a Category"
                    styles={databaseItemSelectStyles}
                    theme={databaseItemSelectTheme}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Sub-category</label>
                <div className="mt-2">
                  <Select
                    value={subcategory}
                    options={subcategoryList}
                    onChange={handleSubcategoryChange}
                    isSearchable
                    placeholder="Select a Sub-category"
                    styles={databaseItemSelectStyles}
                    theme={databaseItemSelectTheme}
                  />
                </div>
              </div>
            </div>

            {/* Color / Size / Description */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Color</label>
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  onChange={(e) => setColor(e.target.value)}
                  type="text"
                  placeholder="e.g. White"
                  value={color}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Size</label>
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  onChange={(e) => setSize(e.target.value)}
                  type="text"
                  placeholder="e.g. 25lb"
                  value={size}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700">Description</label>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onChange={(e) => setDescription(e.target.value)}
                type="text"
                placeholder="Short description"
                value={description}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700">Tracking</label>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onChange={(e) => setTracking(e.target.value)}
                type="text"
                placeholder="Optional linked tracking/template ID"
                value={tracking}
              />
            </div>

            {allowsLinkedDosages && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Linked Dosages</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Purchases of this item will count toward the selected dosage templates in the waste report.
                    </div>
                  </div>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-600">
                    {linkedDosageIds.length} selected
                  </span>
                </div>

                <input
                  className="mt-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  type="search"
                  value={dosageSearchTerm}
                  onChange={(event) => setDosageSearchTerm(event.target.value)}
                  placeholder="Search dosage name, amount, or unit"
                />

                <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto md:grid-cols-2">
                  {filteredDosages.map((dosage) => {
                    const checked = linkedDosageIds.includes(dosage.id);
                    return (
                      <label
                        key={dosage.id}
                        className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm transition ${
                          checked ? "border-blue-300 bg-white text-blue-900" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLinkedDosageId(dosage.id)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>
                          <span className="block font-semibold">{dosage.name || dosage.chemType || "Unnamed dosage"}</span>
                          <span className="block text-xs text-slate-500">{dosageLabel(dosage)}</span>
                        </span>
                      </label>
                    );
                  })}

                  {filteredDosages.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                      No dosage templates match that search.
                    </p>
                  ) : null}
                </div>

                {selectedLinkedDosages.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedLinkedDosages.map((dosage) => (
                      <span key={dosage.id} className="rounded-md bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                        {dosage.name || dosage.chemType || "Unnamed dosage"}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {allowsEquipmentMapping && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4">
                  <div className="text-sm font-semibold text-slate-800">Equipment Mapping</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Connect this product to universal equipment or enter a custom equipment type, make, and model.
                  </div>
                </div>
                <EquipmentCatalogPicker
                  value={equipmentMapping}
                  onChange={setEquipmentMapping}
                  preferCustom
                  inputClassName="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  labelClassName="block text-xs font-bold uppercase tracking-wide text-slate-600"
                  gridClassName="grid grid-cols-1 gap-3 md:grid-cols-3"
                  labels={{ type: "Equipment Type", make: "Make", model: "Model" }}
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-6 py-5 border-t border-slate-200 bg-white">
            <button
              onClick={(e) => {
                createNewItem(e);
              }}
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Vendor Item
            </button>
            <div className="text-xs text-slate-500 mt-2 text-center">
              This will add the supplier-specific item and any selected product catalog link.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateNewDataBaseItem;
