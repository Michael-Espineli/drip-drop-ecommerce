import React, { useState, useEffect, useContext } from "react";
import { Link } from "react-router-dom";
import {
  doc,
  setDoc,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import { useNavigate } from "react-router-dom";
import Select from "react-select";
import { fetchCompanyVendors } from "../../../utils/vendors";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const UOM_OPTIONS = [
  { id: 1, label: "Gallon" },
  { id: 2, label: "Pounds" },
  { id: 3, label: "Ounce" },
  { id: 4, label: "Feet" },
  { id: 5, label: "Square Feet" },
  { id: 6, label: "Liter" },
  { id: 7, label: "Inch" },
  { id: 8, label: "Quart" },
  { id: 9, label: "Tab" },
  { id: 10, label: "Unit" },
];

const CATEGORY_OPTIONS = [
  { id: 1, label: "PVC" },
  { id: 2, label: "Galvanized" },
  { id: 3, label: "Chemicals" },
  { id: 4, label: "Useables" },
  { id: 5, label: "Equipment" },
  { id: 6, label: "Parts" },
  { id: 7, label: "Electrical" },
  { id: 8, label: "Tools" },
  { id: 9, label: "Misc" },
];

const SUBCATEGORY_OPTIONS = [
  "Pipe",
  "Glue",
  "Primer",
  "Pipe Extender",
  "Fitting Extender",
  "Inside Coupler",
  "Sweep",
  "Street",
  "Valve",
  "Bushing",
  "Tee",
  "Elbow",
  "45",
  "Coupler",
  "Union",
  "Male Adaptor",
  "Nipple",
  "Pump",
  "Heater",
  "Filter",
  "Salt Cell",
  "Light",
  "Cleaner",
  "Control System",
  "Auto Chlorinator",
  "Wire",
  "Misc",
].map((label, index) => ({ id: index + 1, label }));

const DEFAULT_UOM = UOM_OPTIONS.find((option) => option.label === "Unit");
const DEFAULT_CATEGORY = CATEGORY_OPTIONS.find((option) => option.label === "Misc");
const DEFAULT_SUBCATEGORY = SUBCATEGORY_OPTIONS.find((option) => option.label === "Misc");

const centsFromDollarInput = (value) => {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const CreateNewDataBaseItem = () => {
  const { name, recentlySelectedCompany } = useContext(Context);
  const { requirePermission } = useCompanyPermissions();

  const navigate = useNavigate();

  const [purchase, setPurchase] = useState({});
  const [edit, setEdit] = useState(false);

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
  const [size, setSize] = useState("");
  const [tracking, setTracking] = useState("");

  const [venderList, setVenderList] = useState([]);
  const [vender, setVender] = useState("");
  const [venderName, setVenderName] = useState("");
  const [venderId, setVenderId] = useState("");

  const [uomList] = useState(UOM_OPTIONS);
  const [categoryList] = useState(CATEGORY_OPTIONS);
  const [subcategoryList] = useState(SUBCATEGORY_OPTIONS);

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

  async function editItem(e) {
    e.preventDefault();
    try {
      setEdit(true);
      setRate(purchase.rate);
      setUom(UOM_OPTIONS.find((option) => option.label === purchase.UOM) || DEFAULT_UOM);
      setCategory(CATEGORY_OPTIONS.find((option) => option.label === purchase.category) || DEFAULT_CATEGORY);
      setColor(purchase.color);
      setDescription(purchase.description);
      setItemName(purchase.name);
      setSize(purchase.size);
      setSellPrice(String((purchase.sellPrice ?? purchase.billingRate ?? 0) / 100));
      setSubcategory(SUBCATEGORY_OPTIONS.find((option) => option.label === purchase.subCategory) || DEFAULT_SUBCATEGORY);
      setTracking(purchase.tracking || "");
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
    if (!requirePermission("852", "create database items")) return;

    try {
      let id = "com_sett_db_" + uuidv4();

      let rateCents = centsFromDollarInput(rateUSD || rate);
      let sellPriceCents = centsFromDollarInput(sellPriceUSD || sellPrice);
      const selectedVendorId = vender?.id || venderId || "";
      const selectedVendorName = vender?.label || vender?.name || venderName || "";

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
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id), item);
      navigate("/company/items/detail/" + id);
    } catch (error) {
      console.log(error);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Bar */}
        <div className="flex items-center justify-between">
          <Link
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            to={`/company/items`}
          >
            ← Go Back
          </Link>

          <div className="text-right">
            <div className="text-lg font-semibold tracking-tight">Create Database Item</div>
            <div className="text-sm text-slate-500">Add an item to your company catalog.</div>
          </div>
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
            <div className="text-sm font-semibold text-slate-700">Item Details</div>
            <div className="text-xs text-slate-500 mt-1">Fill out the fields below and create the item.</div>
          </div>

          <div className="p-6 space-y-4">
            {/* Item Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700">Item Name</label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                onChange={(e) => setItemName(e.target.value)}
                type="text"
                placeholder="e.g. Chlorine Tabs"
                value={itemName}
              />
            </div>

            {/* Rate */}
            <div>
              <label className="block text-sm font-semibold text-slate-700">Rate</label>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-400">
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
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
                  >
                    Billable
                  </button>
                ) : (
                  <button
                    onClick={(e) => billableTrue(e)}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    Not Billable
                  </button>
                )}
              </div>

              {billable && (
                <div className="mt-4">
                  <label className="block text-sm font-semibold text-slate-700">Sell Price</label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-400">
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

            {/* SKU */}
            <div>
              <label className="block text-sm font-semibold text-slate-700">SKU</label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
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
                    styles={{
                      control: (base, state) => ({
                        ...base,
                        minHeight: "48px",
                        borderRadius: "12px",
                        borderColor: state.isFocused ? "#93C5FD" : "#E2E8F0",
                        boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                        "&:hover": { borderColor: "#CBD5E1" },
                      }),
                      valueContainer: (base) => ({ ...base, padding: "0 12px" }),
                      menu: (base) => ({ ...base, borderRadius: "12px", overflow: "hidden" }),
                      option: (base, state) => ({
                        ...base,
                        backgroundColor: state.isFocused ? "rgba(59,130,246,0.10)" : "white",
                        color: "#0F172A",
                      }),
                    }}
                    theme={(theme) => ({
                      ...theme,
                      borderRadius: 12,
                      colors: {
                        ...theme.colors,
                        primary25: "rgba(59,130,246,0.10)",
                        primary: "#2563EB",
                        neutral0: "#FFFFFF",
                        neutral80: "#0F172A",
                        neutral20: "#E2E8F0",
                        neutral30: "#CBD5E1",
                      },
                    })}
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
                    styles={{
                      control: (base, state) => ({
                        ...base,
                        minHeight: "48px",
                        borderRadius: "12px",
                        borderColor: state.isFocused ? "#93C5FD" : "#E2E8F0",
                        boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                        "&:hover": { borderColor: "#CBD5E1" },
                      }),
                      valueContainer: (base) => ({ ...base, padding: "0 12px" }),
                      menu: (base) => ({ ...base, borderRadius: "12px", overflow: "hidden" }),
                      option: (base, state) => ({
                        ...base,
                        backgroundColor: state.isFocused ? "rgba(59,130,246,0.10)" : "white",
                        color: "#0F172A",
                      }),
                    }}
                    theme={(theme) => ({
                      ...theme,
                      borderRadius: 12,
                      colors: {
                        ...theme.colors,
                        primary25: "rgba(59,130,246,0.10)",
                        primary: "#2563EB",
                        neutral0: "#FFFFFF",
                        neutral80: "#0F172A",
                        neutral20: "#E2E8F0",
                        neutral30: "#CBD5E1",
                      },
                    })}
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
                    styles={{
                      control: (base, state) => ({
                        ...base,
                        minHeight: "48px",
                        borderRadius: "12px",
                        borderColor: state.isFocused ? "#93C5FD" : "#E2E8F0",
                        boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                        "&:hover": { borderColor: "#CBD5E1" },
                      }),
                      valueContainer: (base) => ({ ...base, padding: "0 12px" }),
                      menu: (base) => ({ ...base, borderRadius: "12px", overflow: "hidden" }),
                      option: (base, state) => ({
                        ...base,
                        backgroundColor: state.isFocused ? "rgba(59,130,246,0.10)" : "white",
                        color: "#0F172A",
                      }),
                    }}
                    theme={(theme) => ({
                      ...theme,
                      borderRadius: 12,
                      colors: {
                        ...theme.colors,
                        primary25: "rgba(59,130,246,0.10)",
                        primary: "#2563EB",
                        neutral0: "#FFFFFF",
                        neutral80: "#0F172A",
                        neutral20: "#E2E8F0",
                        neutral30: "#CBD5E1",
                      },
                    })}
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
                    styles={{
                      control: (base, state) => ({
                        ...base,
                        minHeight: "48px",
                        borderRadius: "12px",
                        borderColor: state.isFocused ? "#93C5FD" : "#E2E8F0",
                        boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                        "&:hover": { borderColor: "#CBD5E1" },
                      }),
                      valueContainer: (base) => ({ ...base, padding: "0 12px" }),
                      menu: (base) => ({ ...base, borderRadius: "12px", overflow: "hidden" }),
                      option: (base, state) => ({
                        ...base,
                        backgroundColor: state.isFocused ? "rgba(59,130,246,0.10)" : "white",
                        color: "#0F172A",
                      }),
                    }}
                    theme={(theme) => ({
                      ...theme,
                      borderRadius: 12,
                      colors: {
                        ...theme.colors,
                        primary25: "rgba(59,130,246,0.10)",
                        primary: "#2563EB",
                        neutral0: "#FFFFFF",
                        neutral80: "#0F172A",
                        neutral20: "#E2E8F0",
                        neutral30: "#CBD5E1",
                      },
                    })}
                  />
                </div>
              </div>
            </div>

            {/* Color / Size / Description */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Color</label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  onChange={(e) => setColor(e.target.value)}
                  type="text"
                  placeholder="e.g. White"
                  value={color}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Size</label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
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
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                onChange={(e) => setDescription(e.target.value)}
                type="text"
                placeholder="Short description"
                value={description}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700">Tracking</label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                onChange={(e) => setTracking(e.target.value)}
                type="text"
                placeholder="Optional linked tracking/template ID"
                value={tracking}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 py-5 border-t border-slate-200 bg-white">
            <button
              onClick={(e) => {
                createNewItem(e);
              }}
              className="w-full inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
            >
              Create New
            </button>
            <div className="text-xs text-slate-500 mt-2 text-center">
              This will add the item to your company database.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateNewDataBaseItem;
