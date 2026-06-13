import React, { useState, useEffect, useContext } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
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
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
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
  SUBCATEGORY_OPTIONS,
  UOM_OPTIONS,
} from "./databaseItemOptions";

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
  const { id } = useParams();

  const [purchase, setPurchase] = useState({});
  const [edit, setEdit] = useState(false);
  const [rate, setRate] = useState("");
  const [uom, setUom] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [color, setColor] = useState("");
  const [description, setDescription] = useState("");
  const [itemName, setItemName] = useState("");
  const [size, setSize] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sku, setSku] = useState("");
  const [tracking, setTracking] = useState("");
  const [billable, setBillable] = useState(false);
  const [dosages, setDosages] = useState([]);
  const [linkedDosageIds, setLinkedDosageIds] = useState([]);
  const [dosageSearchTerm, setDosageSearchTerm] = useState("");

  useEffect(() => {
    (async () => {
      if (!recentlySelectedCompany || !id) return;

      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const itemData = docSnap.data();
          const dateUpdated = itemData.dateUpdated?.toDate ? itemData.dateUpdated.toDate() : new Date();
          const formattedDate = format(dateUpdated, "MM / d / yyyy");
          const rateDollars = Number(itemData.rate || 0) / 100;
          const sellPriceDollars = Number(itemData.sellPrice ?? itemData.billingRate ?? 0) / 100;

          setPurchase({
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
          });
        } else {
          console.log("No such document!");
        }
      } catch (error) {
        console.log("Error");
        console.log(error);
      }
    })();
  }, [id, recentlySelectedCompany]);

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

  const toggleLinkedDosageId = (dosageId) => {
    setLinkedDosageIds((currentIds) =>
      currentIds.includes(dosageId)
        ? currentIds.filter((currentId) => currentId !== dosageId)
        : [...currentIds, dosageId]
    );
  };

  async function editItem(e) {
    e.preventDefault();
    if (!requirePermission("854", "update database items")) return;

    try {
      setRate(purchase.rate ?? "");
      setUom(purchase.UOM || "");
      setCategory(purchase.category || "");
      setColor(purchase.color || "");
      setDescription(purchase.description || "");
      setItemName(purchase.name || "");
      setSize(purchase.size || "");
      setSellPrice(purchase.sellPriceRaw ?? purchase.billingRateRaw ?? 0);
      setSku(purchase.sku || "");
      setSubcategory(purchase.subCategory || "");
      setTracking(purchase.tracking || "");
      setBillable(Boolean(purchase.billable));
      setLinkedDosageIds(currentLinkedDosageIds);
      setEdit(true);
    } catch (error) {
      console.log(error);
    }
  }

  async function deleteItem(e) {
    e.preventDefault();
    if (!requirePermission("856", "delete database items")) return;

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
      navigate("/company/items");
    } catch (error) {
      console.log(error);
    }
  }

  async function cancelEdit(e) {
    e.preventDefault();
    setLinkedDosageIds(currentLinkedDosageIds);
    setEdit(false);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!requirePermission("854", "update database items")) return;

    try {
      const rateCents = Math.round(Number(rate || 0) * 100);
      const sellPriceCents = Math.round(Number(sellPrice || 0) * 100);
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
      };

      const batch = writeBatch(db);
      batch.update(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id), updatedItem);
      queueDatabaseItemDosageLinkUpdates(batch, {
        companyId: recentlySelectedCompany,
        itemId: id,
        dosages,
        selectedDosageIds: linkedDosageIds,
      });
      await batch.commit();

      const nextDosages = applyDatabaseItemDosageLinksLocally(dosages, id, linkedDosageIds);
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
      }));
      setEdit(false);
      toast.success("Database item updated.");
    } catch (error) {
      console.log(error);
      toast.error("Could not update database item.");
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
  const currentBillable = edit ? billable : Boolean(purchase.billable);
  const billableBadgeClass = currentBillable
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link to="/company/items" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                &larr; Back to Items
              </Link>
              <p className="mt-4 text-xs font-bold uppercase tracking-wide text-blue-700">Database Item</p>
              <h1 className="mt-1 break-words text-3xl font-bold text-slate-950">
                {edit ? "Edit Database Item" : purchase.name || "Database Item"}
              </h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700">
                  Updated {purchase.dateUpdated || "--"}
                </span>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${billableBadgeClass}`}>
                  {currentBillable ? "Billable" : "Not Billable"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {edit ? (
                <>
                  {can("856") && (
                    <button
                      onClick={(e) => deleteItem(e)}
                      className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 shadow-sm transition hover:bg-red-100"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    onClick={(e) => cancelEdit(e)}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={(e) => saveEdit(e)}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Save
                  </button>
                </>
              ) : (
                can("854") && (
                  <button
                    onClick={(e) => editItem(e)}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Edit
                  </button>
                )
              )}
            </div>
          </div>
        </section>

        {edit ? (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-950">Catalog Details</h2>
              <p className="mt-1 text-sm text-slate-500">Edit item pricing, classification, tracking, and billing defaults.</p>
            </div>

            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <label className={labelClass}>Item Name</label>
                <input className={inputClass} onChange={(e) => setItemName(e.target.value)} type="text" placeholder="Item Name" value={itemName} />
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
                  <span className="mt-1 block text-slate-500">Use this item as billable by default when it is selected for jobs, purchases, or customer-facing material.</span>
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
            </div>

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
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,360px)]">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <h2 className="text-lg font-bold text-slate-950">Catalog Details</h2>
                <p className="mt-1 text-sm text-slate-500">Pricing, classification, and item identifiers.</p>
              </div>

              <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
                <DetailField label="Name" value={purchase.name} />
                <DetailField label="SKU" value={purchase.sku} />
                <DetailField label="Billing" value={purchase.billable ? "Billable" : "Not Billable"} />
                <DetailField label="Rate" value={purchase.rateFormatted} />
                <DetailField label="Sell Price" value={purchase.sellPrice || purchase.billingRate} />
                <DetailField label="UOM" value={purchase.UOM} />
                <DetailField label="Category" value={purchase.category} />
                <DetailField label="Subcategory" value={purchase.subCategory} />
                <DetailField label="Color" value={purchase.color} />
                <DetailField label="Size" value={purchase.size} />
                <DetailField label="Tracking" value={purchase.tracking} />
                <DetailField label="Vendor" value={purchase.storeName} />
              </div>

              <div className="border-t border-slate-200 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Description</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{purchase.description || "--"}</p>
              </div>

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
            </div>

            <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Item Summary</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-500">Updated</span>
                  <span className="text-right font-semibold text-slate-900">{purchase.dateUpdated || "--"}</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-500">Times Purchased</span>
                  <span className="text-right font-semibold text-slate-900">{purchase.timesPurchased ?? "--"}</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-500">Tracking</span>
                  <span className="text-right font-semibold text-slate-900">{purchase.tracking || "--"}</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-500">Linked Dosages</span>
                  <span className="text-right font-semibold text-slate-900">{linkedDosages.length}</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-500">Vendor ID</span>
                  <span className="max-w-[180px] break-words text-right font-semibold text-slate-900">{purchase.venderId || "--"}</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Catalog Label</p>
                  <p className="mt-2 break-words font-semibold text-slate-900">{purchase.label || purchase.name || "--"}</p>
                </div>
              </div>
            </aside>
          </section>
        )}
      </div>
    </div>
  );
};

export default DataBaseItemDetailView;
