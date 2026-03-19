import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { db } from "../../../utils/config";
import { collection, setDoc, doc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";

const DataBaseItemBulkUpload = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Dev-only test upload count
  const [isItemCount, setIsItemCount] = useState(0);

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
  };

  // Helpers
  const toBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    const s = String(v ?? "").trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1";
  };

  const toCents = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  };

  const safeStr = (v) => (v === null || v === undefined ? "" : String(v));

  const buildItemFromRow = (row) => {
    // Expected columns (recommended):
    // name, description, category, subCategory, uom, rate, billingRate, sku, size, color, billable
    const id = row.id ? safeStr(row.id) : `com_db_item_${uuidv4()}`;

    // "label-like" inputs; we store as strings (like your item object expects)
    const categoryLabel = safeStr(row.category).trim();
    const subCategoryLabel = safeStr(row.subCategory).trim();
    const uomLabel = safeStr(row.uom).trim();

    const itemName = safeStr(row.name).trim();
    const description = safeStr(row.description).trim();
    const sku = safeStr(row.sku).trim();
    const size = safeStr(row.size).trim();
    const color = safeStr(row.color).trim();

    const billable = toBool(row.billable);

    const rateCents = toCents(row.rate);
    const billingRateCents = toCents(row.billingRate);

    // Matches your provided shape
    const item = {
      UOM: uomLabel,
      id,
      billable,
      category: categoryLabel,
      color,
      dateUpdated: new Date(),
      description,
      name: itemName,
      rate: rateCents,
      size,
      sku,
      storeName: "",
      subCategory: subCategoryLabel,
      timesPurchased: 0,
      venderId: "",
      billingRate: billingRateCents,
    };

    return item;
  };

  const validateRow = (row, idx) => {
    const name = safeStr(row.name).trim();
    const category = safeStr(row.category).trim();
    const uom = safeStr(row.uom).trim();

    // Minimal validation: require name/category/uom
    if (!name) return `Row ${idx + 1}: "name" is required`;
    if (!category) return `Row ${idx + 1}: "category" is required`;
    if (!uom) return `Row ${idx + 1}: "uom" is required`;

    return null;
  };

  const handleUpload = () => {
    if (!recentlySelectedCompany) {
      setError("No company selected.");
      return;
    }
    if (!file) {
      setError("Please select a file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        setError("");
        setSuccess("");

        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (!Array.isArray(data) || data.length === 0) {
          setError("No rows found in the spreadsheet.");
          return;
        }

        // Validate upfront so we fail fast with a helpful message
        for (let i = 0; i < data.length; i++) {
          const err = validateRow(data[i], i);
          if (err) {
            setError(err);
            return;
          }
        }

        setTotal(data.length);
        setCurrent(0);
        setIsLoading(true);

        for (let i = 0; i < data.length; i++) {
          setCurrent(i + 1);

          const row = data[i];
          const item = buildItemFromRow(row);

          // Choose the collection where your "database items" should live.
          // If your app uses a different path, change it here.
          // Example: 'databaseItems' or 'items' or 'inventory'
          const itemId = item.id || `com_db_item_${uuidv4()}`;

          await setDoc(
            doc(collection(db, "companies", recentlySelectedCompany, "databaseItems"), itemId),
            item
          );
        }

        setSuccess("Database items uploaded successfully!");
        setIsLoading(false);

        setTimeout(() => {
          navigate("/company/settings"); // change to the right route for your app
        }, 1500);
      } catch (err) {
        console.error(err);
        setIsLoading(false);
        setError("Error processing file. Make sure it is a valid Excel file.");
      }
    };

    reader.readAsBinaryString(file);
  };

  // -----------------------------
  // Development-only random uploader
  // -----------------------------
  const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randomInt = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const categories = ["Chemicals", "Parts", "Labor", "Supplies"];
  const subCategories = ["General", "Premium", "Standard", "Other"];
  const uoms = ["EA", "LB", "GAL", "OZ", "HR"];
  const colors = ["", "White", "Black", "Blue", "Green", "Red", "Gray"];

  const generateRandomDBItemRow = () => {
    const name = `Item ${randomInt(1000, 9999)}`;
    const category = randomItem(categories);
    const subCategory = randomItem(subCategories);
    const uom = randomItem(uoms);

    return {
      name,
      description: `Auto-generated item ${name}`,
      category,
      subCategory,
      uom,
      sku: `SKU-${randomInt(10000, 99999)}`,
      size: `${randomInt(1, 32)}`,
      color: randomItem(colors),
      billable: "TRUE",
      rate: (randomInt(100, 5000) / 100).toFixed(2), // dollars
      billingRate: (randomInt(100, 8000) / 100).toFixed(2), // dollars
    };
  };

  const handleTestUpload = async (e) => {
    e.preventDefault();
    if (!recentlySelectedCompany) {
      setError("No company selected.");
      return;
    }
    try {
      setError("");
      setSuccess("");

      const count = Number(isItemCount);
      if (!Number.isFinite(count) || count <= 0) {
        setError("Enter a valid test upload count.");
        return;
      }

      setTotal(count);
      setCurrent(0);
      setIsLoading(true);

      for (let i = 0; i < count; i++) {
        setCurrent(i + 1);

        const row = generateRandomDBItemRow();
        const item = buildItemFromRow(row);

        const itemId = item.id || `com_db_item_${uuidv4()}`;

        await setDoc(
          doc(collection(db, "companies", recentlySelectedCompany, "databaseItems"), itemId),
          item
        );
      }

      setSuccess("Test database items uploaded successfully!");
      setIsLoading(false);
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      setError("Failed to upload test items.");
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Bulk Upload Database Items</h1>

      <div className="mb-4">
        <input
          type="file"
          accept=".xlsx, .xls"
          onChange={handleFileChange}
          className="p-2 border rounded"
        />
      </div>

      <div
        className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4"
        role="alert"
      >
        <p className="font-bold">Important Note</p>
        <p>
          This feature requires that you format your excel document in a
          specific way. Please see how it should be formatted below.
        </p>

        <div className="overflow-x-auto mt-3">
          <table className="min-w-full bg-white">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  name
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  description
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  category
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  subCategory
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  uom
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  rate
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  billingRate
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  sku
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  size
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  color
                </th>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  billable
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr className="hover:bg-gray-50 transition-colors">
                <td className="p-4 whitespace-nowrap">Muriatic Acid</td>
                <td className="p-4 whitespace-nowrap">Pool acid for pH control</td>
                <td className="p-4 whitespace-nowrap">Chemicals</td>
                <td className="p-4 whitespace-nowrap">General</td>
                <td className="p-4 whitespace-nowrap">GAL</td>
                <td className="p-4 whitespace-nowrap">9.99</td>
                <td className="p-4 whitespace-nowrap">14.99</td>
                <td className="p-4 whitespace-nowrap">SKU-12345</td>
                <td className="p-4 whitespace-nowrap">1</td>
                <td className="p-4 whitespace-nowrap">Clear</td>
                <td className="p-4 whitespace-nowrap">TRUE / FALSE</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {isLoading && (
        <p className="mb-2">
          {current}/{total}
        </p>
      )}

      {error && <p className="text-red-500 mb-2">{error}</p>}
      {success && <p className="text-green-500 mb-2">{success}</p>}

      <button
        onClick={handleUpload}
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      >
        Upload
      </button>

      <hr className="my-6" />

      {process.env.NODE_ENV === "development" && (
        <div className="p-4 my-4 bg-yellow-900 border-2 border-yellow-500 rounded-lg">
          <h3 className="text-xl font-bold text-yellow-400">
            🚧 Development Only: Random Database Item Upload 🚧
          </h3>
          <p className="text-yellow-300">
            This feature is for testing and will not be in the final product.
          </p>

          <div className="flex items-center gap-3 mt-3">
            <input
              type="number"
              value={isItemCount}
              onChange={(e) => setIsItemCount(e.target.value)}
              className="w-32 bg-gray-600 rounded-md p-2 font-semibold disabled:bg-gray-800 disabled:cursor-not-allowed text-white"
              placeholder="0"
            />
            <button
              onClick={(e) => handleTestUpload(e)}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Upload Test
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataBaseItemBulkUpload;