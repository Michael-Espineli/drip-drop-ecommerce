import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import React, { useState, useEffect, useContext, useRef } from "react";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import Select from "react-select";
import { format } from "date-fns";
import { toast } from "react-hot-toast";
import { db, storage } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import CatalogConnections from "../productCatalog/CatalogConnections";
import CatalogPurchaseHistory from "../productCatalog/CatalogPurchaseHistory";
import CatalogMergeDialog from "../productCatalog/CatalogMergeDialog";
import { DetailRow, SummaryRow, AvailabilityRow } from "../productCatalog/CatalogDetailRows";
import WorkspaceHeader from "../../../components/workspace/WorkspaceHeader";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import { isProductAvailableForPartPurchase } from "../../../utils/productCatalog";
import {
  applyDatabaseItemDosageLinksLocally,
  dosageLabel,
  linkedDosageIdsForItem,
  queueDatabaseItemDosageLinkUpdates,
  sortDosageTemplates,
} from "../../../utils/dosageItemLinks";
import {
  CATEGORY_OPTIONS,
  databaseItemSelectStyles,
  databaseItemSelectTheme,
  findOptionByLabel,
  isChemicalCategory,
  SUBCATEGORY_OPTIONS,
  UOM_OPTIONS,
} from "./databaseItemOptions";
import {
  getItemPhotoUrl,
  itemPhotoFieldsFromUrl,
  uploadItemPhoto,
  validateItemPhotoFile,
} from "../../../utils/itemPhotos";
import EquipmentCatalogPicker from "../../components/equipment/EquipmentCatalogPicker";
import {
  databaseEquipmentMappingFromItem,
  databaseEquipmentMappingPatch,
  emptyDatabaseEquipmentMapping,
  isEquipmentDatabaseCategory,
} from "../../../utils/databaseEquipmentItems";

const formatCurrency = (number, locale = "en-US", currency = "USD") =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(number || 0);

const DetailField = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value || "--"}</p>
  </div>
);

const DataBaseItemDetailView = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const vendorItemsBasePath = location.pathname.toLowerCase().startsWith("/company/settings")
    ? "/company/settings/vendor-items"
    : "/company/items";
  const { id } = useParams();

  const [purchase, setPurchase] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [edit, setEdit] = useState(false);
  const [mergeCompany, setMergeCompany] = useState(null);
  const activeCompany = useRef(recentlySelectedCompany);
  activeCompany.current = recentlySelectedCompany;
  const [rate, setRate] = useState("");
  const [uom, setUom] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [color, setColor] = useState("");
  const [description, setDescription] = useState("");
  const [itemName, setItemName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [size, setSize] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sku, setSku] = useState("");
  const [tracking, setTracking] = useState("");
  const [billable, setBillable] = useState(false);
  const [dosages, setDosages] = useState([]);
  const [linkedDosageIds, setLinkedDosageIds] = useState([]);
  const [dosageSearchTerm, setDosageSearchTerm] = useState("");
  const [equipmentMapping, setEquipmentMapping] = useState(() => emptyDatabaseEquipmentMapping());

  useEffect(() => {
    let active = true;
    setPurchase({});
    setEdit(false);
    setMergeCompany(null);
    setLoading(true);
    setLoadError("");
    (async () => {
      if (!recentlySelectedCompany || !id) { setLoading(false); return; }

      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id);
        const docSnap = await getDoc(docRef);
        if (!active) return;
        if (docSnap.exists()) {
          const itemData = docSnap.data();
          const dateUpdated = itemData.dateUpdated?.toDate ? itemData.dateUpdated.toDate() : new Date();
          const formattedDate = format(dateUpdated, "MM / d / yyyy");
          const rateDollars = Number(itemData.rate ?? itemData.cost ?? 0) / 100;
          const sellPriceDollars = Number(itemData.sellPrice ?? itemData.billingRate ?? 0) / 100;

          setPurchase({
            ...itemData,
            active: itemData.active !== false,
            UOM: itemData.UOM || "",
            billable: Boolean(itemData.billable),
            category: itemData.category || "",
            color: itemData.color || "",
            dateUpdated: formattedDate,
            description: itemData.description || "",
            id: itemData.id || id,
            name: itemData.name || "",
            rateFormatted: formatCurrency(rateDollars),
            rate: rateDollars,
            size: itemData.size || "",
            sku: itemData.sku || "",
            storeName: itemData.storeName || "",
            subCategory: itemData.subCategory || "",
            timesPurchased: itemData.timesPurchased,
            venderId: itemData.venderId || "",
            label: `${itemData.name || ""} ${itemData.rate || ""} ${itemData.sku || ""}`.trim(),
            sellPrice: formatCurrency(sellPriceDollars),
            sellPriceRaw: sellPriceDollars,
            billingRate: formatCurrency(sellPriceDollars),
            billingRateRaw: sellPriceDollars,
            tracking: itemData.tracking || "",
            photoUrl: getItemPhotoUrl(itemData),
            imageUrl: itemData.imageUrl || itemData.imageURL || "",
            primaryPhotoUrl: itemData.primaryPhotoUrl || "",
            photoUrls: Array.isArray(itemData.photoUrls) ? itemData.photoUrls : [],
            ...databaseEquipmentMappingPatch(databaseEquipmentMappingFromItem(itemData)),
          });
        } else {
          setLoadError("This vendor item could not be found.");
        }
      } catch (error) {
        if (active) setLoadError(userFacingErrorMessage(error, "Could not load this vendor item."));
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [id, recentlySelectedCompany, reload]);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    (async () => {
      if (!recentlySelectedCompany) {
        setDosages([]);
        setLinkedDosageIds([]);
        return;
      }

      try {
        const dosageSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dosages", "dosages"));
        const nextDosages = sortDosageTemplates(dosageSnap.docs.map((dosageDoc) => ({ id: dosageDoc.id, ...dosageDoc.data() })));
        setDosages(nextDosages);
        setLinkedDosageIds(linkedDosageIdsForItem(nextDosages, id));
      } catch (error) {
        console.error("Error loading linked dosages:", error);
      }
    })();
  }, [id, recentlySelectedCompany]);

  const currentLinkedDosageIds = linkedDosageIdsForItem(dosages, id);
  const linkedDosages = dosages.filter((dosage) => currentLinkedDosageIds.includes(dosage.id));
  const filteredDosages = dosages.filter((dosage) =>
    dosageLabel(dosage).toLowerCase().includes(dosageSearchTerm.trim().toLowerCase())
  );
  const selectedLinkedDosages = dosages.filter((dosage) => linkedDosageIds.includes(dosage.id));
  const allowsLinkedDosages = isChemicalCategory(category);

  const toggleLinkedDosageId = (dosageId) => {
    setLinkedDosageIds((currentIds) =>
      currentIds.includes(dosageId)
        ? currentIds.filter((currentId) => currentId !== dosageId)
        : [...currentIds, dosageId]
    );
  };

  useEffect(() => {
    if (edit && !allowsLinkedDosages) {
      setLinkedDosageIds([]);
      setDosageSearchTerm("");
    }
  }, [allowsLinkedDosages, edit]);

  async function editItem(e) {
    e.preventDefault();
    if (!requirePermission("854", "update vendor items")) return;

    try {
      setRate(purchase.rate ?? "");
      setUom(purchase.UOM || "");
      setCategory(purchase.category || "");
      setColor(purchase.color || "");
      setDescription(purchase.description || "");
      setItemName(purchase.name || "");
      setPhotoUrl(purchase.photoUrl || "");
      setPhotoFile(null);
      setPhotoPreviewUrl("");
      setPhotoError("");
      setSize(purchase.size || "");
      setSellPrice(purchase.sellPriceRaw ?? purchase.billingRateRaw ?? 0);
      setSku(purchase.sku || "");
      setSubcategory(purchase.subCategory || "");
      setTracking(purchase.tracking || "");
      setBillable(Boolean(purchase.billable));
      setLinkedDosageIds(currentLinkedDosageIds);
      setEquipmentMapping(databaseEquipmentMappingFromItem(purchase));
      setEdit(true);
    } catch (error) {
      console.log(error);
    }
  }

  async function deleteItem(e) {
    e.preventDefault();
    if (!requirePermission("856", "delete vendor items")) return;
    if (purchase.mergedIntoVendorItemId || purchase.mergedSourceIds?.length) return;

    try {
      const batch = writeBatch(db);
      queueDatabaseItemDosageLinkUpdates(batch, {
        companyId: recentlySelectedCompany,
        itemId: id,
        dosages,
        selectedDosageIds: [],
      });
      batch.delete(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id));
      await batch.commit();
      navigate(vendorItemsBasePath);
    } catch (error) {
      console.log(error);
    }
  }

  async function cancelEdit(e) {
    e.preventDefault();
    setLinkedDosageIds(currentLinkedDosageIds);
    setPhotoFile(null);
    setPhotoPreviewUrl("");
    setPhotoError("");
    setEdit(false);
  }

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

  async function saveEdit(e) {
    e.preventDefault();
    if (!requirePermission("854", "update vendor items")) return;

    try {
      const rateCents = Math.round(Number(rate || 0) * 100);
      const sellPriceCents = Math.round(Number(sellPrice || 0) * 100);
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
        itemName || purchase.name || "Vendor item photo",
        uploadedPhoto.storagePath
      );
      const allowsEquipmentMapping = isEquipmentDatabaseCategory(category);
      if (
        allowsEquipmentMapping &&
        (!equipmentMapping.type || !equipmentMapping.make || !equipmentMapping.model)
      ) {
        toast.error("Connect this equipment item to universal equipment or enter custom type, make, and model.");
        return;
      }

      const equipmentFields = allowsEquipmentMapping
        ? databaseEquipmentMappingPatch(equipmentMapping)
        : {};
      const updatedItem = {
        UOM: uom,
        billable: Boolean(billable),
        category,
        color,
        dateUpdated: new Date(),
        description,
        name: itemName,
        rate: rateCents,
        size,
        sku,
        subCategory: subcategory,
        sellPrice: sellPriceCents,
        billingRate: sellPriceCents,
        tracking,
        ...equipmentFields,
        ...photoFields,
      };

      const batch = writeBatch(db);
      batch.update(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id), updatedItem);
      const nextLinkedDosageIds = allowsLinkedDosages ? linkedDosageIds : [];
      queueDatabaseItemDosageLinkUpdates(batch, {
        companyId: recentlySelectedCompany,
        itemId: id,
        dosages,
        selectedDosageIds: nextLinkedDosageIds,
      });
      await batch.commit();

      const nextDosages = applyDatabaseItemDosageLinksLocally(dosages, id, nextLinkedDosageIds);
      setDosages(nextDosages);
      setLinkedDosageIds(linkedDosageIdsForItem(nextDosages, id));
      setPurchase((current) => ({
        ...current,
        ...updatedItem,
        rate: Number(rate || 0),
        rateFormatted: formatCurrency(Number(rate || 0)),
        sellPrice: formatCurrency(Number(sellPrice || 0)),
        sellPriceRaw: Number(sellPrice || 0),
        billingRate: formatCurrency(Number(sellPrice || 0)),
        billingRateRaw: Number(sellPrice || 0),
        dateUpdated: format(updatedItem.dateUpdated, "MM / d / yyyy"),
        ...equipmentFields,
        ...photoFields,
      }));
      setPhotoFile(null);
      setPhotoPreviewUrl("");
      setPhotoUrl(photoFields.photoUrl || "");
      setEdit(false);
      toast.success("Vendor item updated.");
    } catch (error) {
      console.log(error);
      toast.error(userFacingErrorMessage(error, "Could not update vendor item."));
    }
  }

  const selectedUom = findOptionByLabel(
    UOM_OPTIONS,
    uom,
    uom ? { id: "current-uom", label: uom } : null
  );
  const selectedCategory = findOptionByLabel(
    CATEGORY_OPTIONS,
    category,
    category ? { id: "current-category", label: category } : null
  );
  const selectedSubcategory = findOptionByLabel(
    SUBCATEGORY_OPTIONS,
    subcategory,
    subcategory ? { id: "current-subcategory", label: subcategory } : null
  );

  const inputClass = "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const labelClass = "block text-sm font-semibold text-slate-700";
  const displayPhotoUrl = edit ? photoPreviewUrl || photoUrl : purchase.photoUrl;
  const currentAllowsEquipmentMapping = edit
    ? isEquipmentDatabaseCategory(category)
    : isEquipmentDatabaseCategory(purchase.category);
  const displayEquipmentMapping = databaseEquipmentMappingFromItem(edit ? equipmentMapping : purchase);
  if (!recentlySelectedCompany) return <div className="p-5">Select a company to view this vendor item.</div>;
  if (loading || loadError) return <div className="px-2 py-6 sm:px-3 lg:px-4"><div className="rounded-lg border border-slate-200 bg-white p-5" role={loadError ? "alert" : "status"}>
    <p>{loading ? "Loading vendor item..." : loadError}</p>
    {loadError && <button type="button" onClick={() => setReload((value) => value + 1)} className={workspaceButtonClass({ tone: "blue" })}>Retry vendor item</button>}
  </div></div>;

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <WorkspaceHeader
          title={edit ? `Edit ${purchase.name || "Vendor Item"}` : purchase.name || "Vendor Item"}
          eyebrow="Vendor Item"
          description={purchase.description || "Supplier-specific pricing, product connections, and purchasing history."}
          meta={<>
            <span className="workspace-header-badge">{purchase.storeName || "Vendor"}</span>
            <span className="workspace-header-badge">{[purchase.category, purchase.subCategory].filter(Boolean).join(" / ") || "Uncategorized"}</span>
            <span className="workspace-header-badge">Unit Cost {purchase.rateFormatted || formatCurrency(0)}</span>
            <span className="workspace-header-badge">{purchase.UOM || "Unit"}</span>
            <span className="workspace-header-badge">Updated {purchase.dateUpdated || "--"}</span>
          </>}
          actions={<div className="flex w-full flex-wrap items-center justify-between gap-3">
            <Link to={vendorItemsBasePath} className={workspaceButtonClass({ tone: "slate" })}>← Back to Vendor Items</Link>
            <div className="flex flex-wrap gap-2">
              <Link to="/company/product-catalog" className={workspaceButtonClass({ tone: "slate" })}>Products</Link>
              {edit ? <>
                {can("856") && !purchase.mergedSourceIds?.length && <button type="button" onClick={deleteItem} className={workspaceButtonClass({ tone: "rose" })}>Delete</button>}
                <button type="button" onClick={cancelEdit} className={workspaceButtonClass({ tone: "slate" })}>Cancel</button>
                <button type="button" onClick={saveEdit} className={workspaceButtonClass({ tone: "blue" })}>Save</button>
              </> : can("854") && !purchase.mergedIntoVendorItemId && <>
                {!purchase.archived && <button type="button" onClick={() => setMergeCompany(recentlySelectedCompany)} className={workspaceButtonClass({ tone: "slate" })}>Merge duplicate</button>}
                <button type="button" onClick={editItem} className={workspaceButtonClass({ tone: "blue" })}>Edit</button>
              </>}
            </div>
          </div>}
        />
        {purchase.mergedIntoVendorItemId && <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <p>This vendor item was archived as a duplicate.</p>
          <Link to={`${vendorItemsBasePath}/detail/${purchase.mergedIntoVendorItemId}`} className={workspaceButtonClass({ tone: "blue" })}>View kept vendor item</Link>
        </section>}
        {mergeCompany && mergeCompany === recentlySelectedCompany && <CatalogMergeDialog
          kind="vendorItem" companyId={mergeCompany} initialKeepId={id}
          onClose={() => setMergeCompany(null)} onMerged={keepId => {
            if (activeCompany.current !== mergeCompany) return;
            setMergeCompany(null);
            navigate(`${vendorItemsBasePath}/detail/${keepId}`, { replace: true });
            setReload(value => value + 1);
            toast.success("Vendor item duplicate merged.");
          }} />}

        {edit ? (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-950">Vendor Item Details</h2>
              <p className="mt-1 text-sm text-slate-500">Edit supplier-specific pricing, classification, tracking, and billing defaults.</p>
            </div>

              <div className="grid gap-4 p-5 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <label className={labelClass}>Vendor Item Name</label>
                <input className={inputClass} onChange={(e) => setItemName(e.target.value)} type="text" placeholder="Vendor Item Name" value={itemName} />
              </div>

              <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="h-28 w-28 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                    {displayPhotoUrl ? (
                      <img src={displayPhotoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-400">
                        Photo
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <label className={labelClass}>Vendor Item Photo</label>
                      <input
                        className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoFileChange}
                      />
                      {photoFile ? (
                        <p className="mt-1 text-xs text-slate-500">{photoFile.name} will upload when you save.</p>
                      ) : null}
                      {photoError ? (
                        <p className="mt-1 text-xs font-semibold text-red-600">{photoError}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className={labelClass}>Photo URL</label>
                      <input
                        className={inputClass}
                        onChange={(e) => setPhotoUrl(e.target.value)}
                        type="url"
                        placeholder="https://..."
                        value={photoUrl}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass}>Rate</label>
                <input className={inputClass} onChange={(e) => setRate(e.target.value)} type="number" step="0.01" placeholder="Rate" value={rate} />
              </div>

              <div>
                <label className={labelClass}>Sell Price</label>
                <input className={inputClass} onChange={(e) => setSellPrice(e.target.value)} type="number" step="0.01" placeholder="Sell Price" value={sellPrice} />
              </div>

              <div>
                <label className={labelClass}>SKU</label>
                <input className={inputClass} onChange={(e) => setSku(e.target.value)} type="text" placeholder="SKU" value={sku} />
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={billable}
                  onChange={(e) => setBillable(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <span className="block font-bold text-slate-900">Billable</span>
                  <span className="mt-1 block text-slate-500">Use this vendor item as billable by default when it is selected from receipts or purchasing workflows.</span>
                </span>
              </label>

              <div>
                <label className={labelClass}>UOM</label>
                <div className="mt-2">
                  <Select
                    value={selectedUom}
                    options={UOM_OPTIONS}
                    onChange={(selectedOption) => setUom(selectedOption?.label || "")}
                    isSearchable
                    placeholder="Select a UOM"
                    styles={databaseItemSelectStyles}
                    theme={databaseItemSelectTheme}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Category</label>
                <div className="mt-2">
                  <Select
                    value={selectedCategory}
                    options={CATEGORY_OPTIONS}
                    onChange={(selectedOption) => setCategory(selectedOption?.label || "")}
                    isSearchable
                    placeholder="Select a Category"
                    styles={databaseItemSelectStyles}
                    theme={databaseItemSelectTheme}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Subcategory</label>
                <div className="mt-2">
                  <Select
                    value={selectedSubcategory}
                    options={SUBCATEGORY_OPTIONS}
                    onChange={(selectedOption) => setSubcategory(selectedOption?.label || "")}
                    isSearchable
                    placeholder="Select a Subcategory"
                    styles={databaseItemSelectStyles}
                    theme={databaseItemSelectTheme}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Tracking</label>
                <input className={inputClass} onChange={(e) => setTracking(e.target.value)} type="text" placeholder="Tracking" value={tracking} />
              </div>

              <div>
                <label className={labelClass}>Color</label>
                <input className={inputClass} onChange={(e) => setColor(e.target.value)} type="text" placeholder="Color" value={color} />
              </div>

              <div>
                <label className={labelClass}>Size</label>
                <input className={inputClass} onChange={(e) => setSize(e.target.value)} type="text" placeholder="Size" value={size} />
              </div>

              <div className="lg:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea className={`${inputClass} min-h-[110px]`} onChange={(e) => setDescription(e.target.value)} placeholder="Description" value={description} />
              </div>

              {currentAllowsEquipmentMapping && (
                <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Equipment Mapping</h3>
                    <p className="mt-1 text-sm text-slate-500">Connect this product to universal equipment or custom equipment details.</p>
                  </div>
                  <EquipmentCatalogPicker
                    value={equipmentMapping}
                    onChange={setEquipmentMapping}
                    preferCustom
                    inputClassName={inputClass}
                    labelClassName="block text-xs font-bold uppercase tracking-wide text-slate-600"
                    gridClassName="grid grid-cols-1 gap-3 md:grid-cols-3"
                    labels={{ type: "Equipment Type", make: "Make", model: "Model" }}
                  />
                </div>
              )}
            </div>

            {allowsLinkedDosages && (
              <div className="border-t border-slate-200 p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Linked Dosages</h3>
                    <p className="mt-1 text-sm text-slate-500">Select which dosage templates should count purchases of this item as usable inventory.</p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                    {linkedDosageIds.length} selected
                  </span>
                </div>

                <input
                  className={`${inputClass} mt-4`}
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
                          checked ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
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
          </section>
        ) : (
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
                <h2 className="text-lg font-bold text-slate-950">Vendor Item Sheet</h2>
                <p className="mt-1 text-sm text-slate-500">Supplier-specific facts for purchasing, product matching, and field use.</p>
              </div>
              {displayPhotoUrl && <div className="px-5 pt-5 sm:px-6"><img src={displayPhotoUrl} alt={purchase.name || "Vendor item"} className="h-40 w-full rounded-md border border-slate-200 object-contain" /></div>}
              <dl className="px-5 sm:px-6">
                <DetailRow label="Display Name" value={purchase.name} />
                <DetailRow label="Description"><p className="whitespace-pre-wrap font-normal text-slate-700">{purchase.description || "--"}</p></DetailRow>
                <DetailRow label="SKU" value={purchase.sku} />
                <DetailRow label="Vendor" value={purchase.storeName} />
                <DetailRow label="Category" value={purchase.category} />
                <DetailRow label="Subcategory" value={purchase.subCategory} />
                <DetailRow label="Unit of Measure" value={purchase.UOM} />
                <DetailRow label="Size" value={purchase.size} />
                <DetailRow label="Color" value={purchase.color} />
                <DetailRow label="Tracking" value={purchase.tracking} />
              </dl>
              {currentAllowsEquipmentMapping && (
                <div className="border-t border-slate-200 p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Equipment Mapping</p>
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <DetailField label="Equipment Type" value={displayEquipmentMapping.type} />
                    <DetailField label="Make" value={displayEquipmentMapping.make} />
                    <DetailField label="Model" value={displayEquipmentMapping.model} />
                  </div>
                  {displayEquipmentMapping.manualPdfLink ? (
                    <a
                      href={displayEquipmentMapping.manualPdfLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                    >
                      View Manual
                    </a>
                  ) : null}
                </div>
              )}

              <div className="border-t border-slate-200 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Linked Dosages</p>
                {linkedDosages.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {linkedDosages.map((dosage) => (
                      <Link
                        key={dosage.id}
                        to={`/company/readingsAndDosages?tab=Dosages&template=${encodeURIComponent(dosage.id)}`}
                        className="rounded-md bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 transition hover:bg-blue-200 hover:text-blue-950"
                      >
                        {dosageLabel(dosage)}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No dosages linked yet.</p>
                )}
              </div>
            </article>
            <aside className="space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Availability</h2>
                <p className="mt-1 text-sm text-slate-500">How this vendor item can be used.</p>
                <ul className="mt-3 divide-y divide-slate-100">
                  <AvailabilityRow label="Active" description="Active supplier catalog item." available={purchase.active !== false && !purchase.archived} />
                  <AvailabilityRow label="Part Purchase" description="Available for purchasing workflows." available={purchase.active !== false && !purchase.archived && isProductAvailableForPartPurchase(purchase)} />
                  <AvailabilityRow label="Billable Default" description="Purchases default to billable." available={purchase.billable} tone="emerald" />
                </ul>
              </section>
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Catalog Summary</h2>
                <div className="mt-3">
                  <SummaryRow label="Unit Cost" value={purchase.rateFormatted || formatCurrency(0)} />
                  <SummaryRow label="Vendor Sell Price" value={purchase.sellPrice || purchase.billingRate || formatCurrency(0)} />
                  <SummaryRow label="Vendor" value={purchase.storeName} />
                  <SummaryRow label="Times Purchased" value={purchase.timesPurchased ?? 0} />
                  <SummaryRow label="Linked Dosages" value={linkedDosages.length} />
                  <SummaryRow label="Updated" value={purchase.dateUpdated} />
                </div>
              </section>
            </aside>
          </section>
        )}
        {!edit && !purchase.mergedIntoVendorItemId && <CatalogConnections vendorItemId={id} revision={`${recentlySelectedCompany}:${purchase.rate}`} />}
        {!edit && <CatalogPurchaseHistory vendorItemId={id} mergedSourceIds={purchase.mergedSourceIds} />}
      </div>
    </div>
  );
};

export default DataBaseItemDetailView;
