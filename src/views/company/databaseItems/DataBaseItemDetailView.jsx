import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

const DataBaseItemDetailView = () => {
  const { name, recentlySelectedCompany } = useContext(Context);

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
  const [billingRate, setBillingRate] = useState("");
  const [sku, setSku] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const itemData = docSnap.data();
          const dateUpdated = itemData.dateUpdated.toDate();
          const formattedDate1 = format(dateUpdated, "MM / d / yyyy");

          let rateDouble = itemData.rate / 100;
          let formattedRateUSD = formatCurrency(rateDouble);

          let billingRateDouble = itemData.billingRate / 100;
          let formattedBillingRateUSD = formatCurrency(billingRateDouble);

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
            rate: itemData.rate / 100,
            size: itemData.size,
            sku: itemData.sku,
            storeName: itemData.storeName,
            subCategory: itemData.subCategory,
            timesPurchased: itemData.timesPurchased,
            venderId: itemData.venderId,
            label: itemData.name + " " + itemData.rate + " " + itemData.sku,
            billingRate: formattedBillingRateUSD,
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
    try {
      setEdit(true);
      setRate(purchase.rate);
      setUom(purchase.UOM);
      setCategory(purchase.category);
      setColor(purchase.color);
      setDescription(purchase.description);
      setItemName(purchase.name);
      setSize(purchase.size);
      setBillingRate(purchase.billingRate);
    } catch (error) {
      console.log(error);
    }
  }

  async function deleteItem(e) {
    e.preventDefault();
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
    try {
      setEdit(false);
      //Update Rate
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

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Bar */}
        <div className="flex items-center justify-between">
          {!edit ? (
            <Link
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              to={`/company/items`}
            >
              ← Go Back
            </Link>
          ) : (
            <button
              onClick={(e) => {
                deleteItem(e);
              }}
              className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
            >
              Delete
            </button>
          )}

          {edit ? (
            <button
              onClick={(e) => {
                cancelEdit(e);
              }}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={(e) => {
                editItem(e);
              }}
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
            >
              Edit
            </button>
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
                  <label className="block text-sm font-semibold text-slate-700">Billing Rate</label>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    onChange={(e) => {
                      setBillingRate(e.target.value);
                    }}
                    type="text"
                    placeholder="Billing Rate"
                    value={billingRate}
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
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    onChange={(e) => {
                      setUom(e.target.value);
                    }}
                    type="text"
                    placeholder="uom"
                    value={uom}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">Category</label>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    onChange={(e) => {
                      setCategory(e.target.value);
                    }}
                    type="text"
                    placeholder="category"
                    value={category}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Subcategory</label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  onChange={(e) => {
                    setSubcategory(e.target.value);
                  }}
                  type="text"
                  placeholder="Subcategory PICKER"
                  value={subcategory}
                />
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

              <button
                onClick={(e) => {
                  saveEdit(e);
                }}
                className="w-full inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
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
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Rate</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{purchase.billingRate || "--"}</div>
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
