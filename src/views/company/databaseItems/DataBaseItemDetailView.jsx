import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import Select from "react-select";
import {
  CATEGORY_OPTIONS,
  databaseItemSelectStyles,
  databaseItemSelectTheme,
  findOptionByLabel,
  SUBCATEGORY_OPTIONS,
  UOM_OPTIONS,
} from "./databaseItemOptions";

const DataBaseItemDetailView = () => {
  const { name, recentlySelectedCompany } = useContext(Context);
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

  useEffect(() => {
    (async () => {
      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const itemData = docSnap.data();
          const dateUpdated = itemData.dateUpdated?.toDate ? itemData.dateUpdated.toDate() : new Date();
          const formattedDate1 = format(dateUpdated, "MM / d / yyyy");

          let rateDouble = Number(itemData.rate || 0) / 100;
          let formattedRateUSD = formatCurrency(rateDouble);

          let sellPriceDouble = Number(itemData.sellPrice ?? itemData.billingRate ?? 0) / 100;
          let formattedSellPriceUSD = formatCurrency(sellPriceDouble);

          setPurchase((purchase) => ({
            ...purchase,
            UOM: itemData.UOM,
            billable: itemData.billable,
            category: itemData.category,
            color: itemData.color,
            dateUpdated: formattedDate1,
            description: itemData.description,
            id: itemData.id,
            name: itemData.name,
            rateFormatted: formattedRateUSD,
            rate: Number(itemData.rate || 0) / 100,
            size: itemData.size,
            sku: itemData.sku,
            storeName: itemData.storeName,
            subCategory: itemData.subCategory,
            timesPurchased: itemData.timesPurchased,
            venderId: itemData.venderId,
            label: itemData.name + " " + itemData.rate + " " + itemData.sku,
            sellPrice: formattedSellPriceUSD,
            sellPriceRaw: sellPriceDouble,
            billingRate: formattedSellPriceUSD,
            billingRateRaw: sellPriceDouble,
            tracking: itemData.tracking || "",
          }));
        } else {
          console.log("No such document!");
        }
      } catch (error) {
        console.log("Error");
      }
    })();
  }, []);

  async function editItem(e) {
    e.preventDefault();
    if (!requirePermission("854", "update database items")) return;

    try {
      setEdit(true);
      setRate(purchase.rate);
      setUom(purchase.UOM);
      setCategory(purchase.category);
      setColor(purchase.color);
      setDescription(purchase.description);
      setItemName(purchase.name);
      setSize(purchase.size);
      setSellPrice(purchase.sellPriceRaw ?? purchase.billingRateRaw ?? 0);
      setSku(purchase.sku);
      setSubcategory(purchase.subCategory);
      setTracking(purchase.tracking || "");
    } catch (error) {
      console.log(error);
    }
  }

  async function deleteItem(e) {
    e.preventDefault();
    if (!requirePermission("856", "delete database items")) return;

    try {
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id));
      navigate("/company/items");
    } catch (error) {
      console.log(error);
    }
  }

  async function cancelEdit(e) {
    e.preventDefault();
    try {
      setEdit(false);
    } catch (error) {
      console.log(error);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!requirePermission("854", "update database items")) return;

    try {
      const updatedItem = {
        UOM: uom,
        category,
        color,
        dateUpdated: new Date(),
        description,
        name: itemName,
        rate: Math.round(Number(rate || 0) * 100),
        size,
        sku,
        subCategory: subcategory,
        sellPrice: Math.round(Number(sellPrice || 0) * 100),
        billingRate: Math.round(Number(sellPrice || 0) * 100),
        tracking,
      };

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id), updatedItem);
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
    } catch (error) {
      console.log(error);
    }
  }

  function formatCurrency(number, locale = "en-US", currency = "USD") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
    }).format(number);
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

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto space-y-6">
        {/* Top Bar */}
        <div className="flex items-center justify-between">
          {!edit ? (

            <Link
              to="/company/items"
              className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              &larr; Back to Items
            </Link>
          ) : (
            can("856") && (
              <button
                onClick={(e) => {
                  deleteItem(e);
                }}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
              >
                Delete
              </button>
            )
          )}

          {edit ? (
            <button
              onClick={(e) => {
                cancelEdit(e);
              }}
              className="px-4 py-2 text-sm font-medium text-grey-700 bg-grey-50 border border-grey-200 rounded-xl shadow-sm hover:bg-grey-100 transition"
            >
              Cancel
            </button>
          ) : (
            can("854") && (
              <button
                onClick={(e) => {
                  editItem(e);
                }}
                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
              >
                Edit
              </button>
            )
          )}
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-700">Item Detail View</div>
              <div className="text-xs text-slate-500 mt-1">
                {edit ? "Edit fields and save changes." : "Review details for this catalog item."}
              </div>
            </div>

            {!edit && (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                Updated {purchase.dateUpdated || "--"}
              </span>
            )}
          </div>

          {edit ? (
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Item Name</label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  onChange={(e) => {
                    setItemName(e.target.value);
                  }}
                  type="text"
                  placeholder="Item Name"
                  value={itemName}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Rate</label>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    onChange={(e) => {
                      setRate(e.target.value);
                    }}
                    type="text"
                    placeholder="Rate"
                    value={rate}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">Sell Price</label>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    onChange={(e) => {
                      setSellPrice(e.target.value);
                    }}
                    type="text"
                    placeholder="Sell Price"
                    value={sellPrice}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">SKU</label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  onChange={(e) => {
                    setSku(e.target.value);
                  }}
                  type="text"
                  placeholder="sku"
                  value={sku}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">UOM</label>
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
                  <label className="block text-sm font-semibold text-slate-700">Category</label>
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
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Subcategory</label>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Color</label>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    onChange={(e) => {
                      setColor(e.target.value);
                    }}
                    type="text"
                    placeholder="color"
                    value={color}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">Size</label>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    onChange={(e) => {
                      setSize(e.target.value);
                    }}
                    type="text"
                    placeholder="size"
                    value={size}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Description</label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                  type="text"
                  placeholder="description"
                  value={description}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Tracking</label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  onChange={(e) => {
                    setTracking(e.target.value);
                  }}
                  type="text"
                  placeholder="tracking"
                  value={tracking}
                />
              </div>

              <button
                onClick={(e) => {
                  saveEdit(e);
                }}
                className="w-full px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.name || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">SKU</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.sku || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.rateFormatted || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sell Price</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.sellPrice || purchase.billingRate || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">UOM</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.UOM || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.category || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subcategory</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.subCategory || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Color</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.color || "--"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Size</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.size || "--"}</div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</div>
                <div className="mt-1 text-sm text-slate-700">{purchase.description || "--"}</div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Other</div>
                <div className="mt-2 text-sm text-slate-700 space-y-1">
                  <div>Store Name - {purchase.storeName || "--"}</div>
                  <div>Times Purchased - {purchase.timesPurchased ?? "--"}</div>
                  <div>Tracking - {purchase.tracking || "--"}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataBaseItemDetailView;
