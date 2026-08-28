import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Select from "react-select";
import { arrayUnion, collection, doc, getDocs, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import * as pdfjsLib from "pdfjs-dist/webpack";
import { FaCheckCircle, FaReceipt, FaSpinner } from "react-icons/fa";
import { Context } from "../../../context/AuthContext";
import { db, storage } from "../../../utils/config";
import {
  buildProductFromVendorItem,
  buildVendorItemProductPatch,
  findSuggestedProductForVendorItem,
  getProductDisplayName,
  productCatalogCollectionRef,
  productCatalogDocRef,
  productOptionSearchText,
} from "../../../utils/productCatalog";
import { fetchCompanyVendors } from "../../../utils/vendors";

const MURDOCK_COMPANY_ID = "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e";
const DEFAULT_PURCHASE_TECH_NAME = "Michael Espineli";

const uomOptions = ["ea", "gal", "lb", "lbs", "oz", "ft", "unit", "tab", "quart"];
const categoryOptions = ["PVC", "Galvanized", "Chemicals", "Useables", "Equipment", "Parts", "Electrical", "Tools", "Misc"];
const orderTypeTokens = ["COUNTER", "WILLCALL", "DELIVERY", "SHIP", "PICKUP"];

const blankParsedReceipt = {
  invoiceNum: "",
  invoiceDate: "",
  vendorName: "Heritage Pool Supply",
  notes: "",
  subtotal: "",
  tax: "",
  total: "",
  rawText: "",
};

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));

const centsFromDollars = (value) => {
  const number = Number(String(value || "").replace(/[$,]/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};

const formatDollarsFromCents = (value) => {
  const cents = Number(value || 0);
  return cents ? (cents / 100).toFixed(2) : "";
};

const moneyFromCents = (value) => money(Number(value || 0) / 100);

const dollarsFromText = (value) => {
  const number = Number(String(value || "").replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const normalizedDatabaseUom = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const uomMap = {
    ea: "Unit",
    each: "Unit",
    unit: "Unit",
    gal: "Gallon",
    gallon: "Gallon",
    lb: "Pounds",
    lbs: "Pounds",
    pounds: "Pounds",
    oz: "Ounce",
    ounce: "Ounce",
    ft: "Feet",
    feet: "Feet",
    tab: "Tab",
    quart: "Quart",
  };

  return uomMap[normalized] || value || "Unit";
};

const heritageUomFromDatabaseUom = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const uomMap = {
    each: "ea",
    unit: "ea",
    gallon: "gal",
    pounds: "lbs",
    pound: "lb",
    ounce: "oz",
    feet: "ft",
    foot: "ft",
  };

  return uomMap[normalized] || (uomOptions.includes(normalized) ? normalized : "ea");
};

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getCompanyUserDisplayName = (user) =>
  user?.userName || user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "";

const getCompanyUserId = (user) => user?.userId || user?.id || "";

const findMatchingCompanyUser = (name, companyUsers) => {
  const nameKey = normalizeKey(name);
  if (!nameKey) return null;

  return (
    companyUsers.find((user) => normalizeKey(getCompanyUserDisplayName(user)) === nameKey) ||
    companyUsers.find((user) => normalizeKey([user.firstName, user.lastName].filter(Boolean).join(" ")) === nameKey) ||
    companyUsers.find((user) => normalizeKey(user.firstName) === nameKey || normalizeKey(user.lastName) === nameKey) ||
    null
  );
};

const appendNote = (currentNotes, note) => {
  const cleanNote = String(note || "").trim();
  const cleanCurrent = String(currentNotes || "").trim();
  if (!cleanNote) return cleanCurrent;
  if (cleanCurrent.toLowerCase().includes(cleanNote.toLowerCase())) return cleanCurrent;
  return [cleanCurrent, cleanNote].filter(Boolean).join("\n");
};

const inferCategory = (name) => {
  const text = String(name || "").toLowerCase();
  if (/(^|[^a-z])pvc([^a-z]|$)|sch\s*40|schedule\s*40/.test(text)) return "PVC";
  if (/(acid|chlor|hypochlorite|bromide|bleach|test strips|aquachek)/.test(text)) return "Chemicals";
  if (/(valve|oring|o-ring|gasket|union|fitting|basket|clamp|plug|cap|eyeball|rope)/.test(text)) return "Parts";
  if (/(wire|breaker|gfci|light|relay|intermatic|mechanism)/.test(text)) return "Electrical";
  if (/(pump|filter|heater|chlorinator|cleaner)/.test(text)) return "Equipment";
  return "Misc";
};

const databaseItemRateCents = (item) => Number(item?.rate || 0);

const billingRateFromDatabaseItem = (item) => {
  const billingRateCents = Number(item?.billingRate ?? item?.sellPrice ?? 0);
  return billingRateCents ? formatDollarsFromCents(billingRateCents) : "";
};

const calculatedLineAmount = (quantity, unitPrice) => {
  if (!String(unitPrice || "").trim()) return "";
  return (dollarsFromText(quantity) * dollarsFromText(unitPrice)).toFixed(2);
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

const findMatchingItem = (line, databaseItems) => {
  const skuKey = normalizeKey(line.sku);
  const nameKey = normalizeKey(line.name);

  return (
    databaseItems.find((item) => normalizeKey(item.sku) === skuKey && skuKey) ||
    databaseItems.find((item) => normalizeKey(item.name) === nameKey && nameKey) ||
    null
  );
};

const hydrateLineFromDatabaseItem = (line, item) => {
  if (!item) return line;

  const unitPrice = databaseItemRateCents(item) ? formatDollarsFromCents(databaseItemRateCents(item)) : line.unitPrice;

  return {
    ...line,
    matchedItemId: item.id,
    createDatabaseItem: false,
    sku: item.sku || line.sku,
    name: item.name || item.description || line.name,
    description: item.description || item.name || line.description,
    uom: heritageUomFromDatabaseUom(item.UOM || item.uom || line.uom),
    unitPrice,
    amount: calculatedLineAmount(line.quantity, unitPrice),
    category: item.category || line.category,
    billable: Boolean(item.billable),
    billingRate: billingRateFromDatabaseItem(item),
  };
};

const lineUnitPriceCents = (line) => centsFromDollars(line?.unitPrice);

const getLinePriceChange = (line, databaseItem) => {
  if (!line?.matchedItemId || !databaseItem) return null;

  const nextRateCents = lineUnitPriceCents(line);
  if (!nextRateCents) return null;

  const currentRateCents = databaseItemRateCents(databaseItem);
  if (currentRateCents === nextRateCents) return null;

  return {
    currentRateCents,
    nextRateCents,
  };
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
    minHeight: 36,
    borderColor: state.isFocused ? "#2563EB" : "#CBD5E1",
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

const parseHeritageDate = (value) => {
  const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return new Date();

  const [, month, day, yearText] = match;
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const date = new Date(year, Number(month) - 1, Number(day), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const parseHeritageMoneyAfterLabel = (text, pattern) => {
  const match = String(text || "").match(new RegExp(`${pattern}\\s+\\$?([0-9,.]+)`, "i"));
  return match ? dollarsFromText(match[1]) : 0;
};

const parseHeritageOrderNotes = (lines) => {
  const headerIndex = lines.findIndex((line) => /AGENTS\s+ORDER TYPE\s+ORDERED BY/i.test(line));
  const valueLine = headerIndex > -1 ? lines[headerIndex + 1] || "" : "";
  const tokens = valueLine.split(/\s+/).filter(Boolean);
  const orderTypeIndex = tokens.findIndex((token) => orderTypeTokens.includes(token.toUpperCase()));
  const orderedBy = orderTypeIndex > -1 ? tokens[orderTypeIndex + 1] || "" : "";
  const orderType = orderTypeIndex > -1 ? tokens[orderTypeIndex] || "" : "";

  return { orderedBy, orderType };
};

const parseHeritageLineItems = (rawText) => {
  const lines = String(rawText || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const startIndex = lines.findIndex((line) => /ORDERED\s+SHIPPED\s+QTY\s+AMOUNT/i.test(line));
  if (startIndex < 0) return [];

  const rows = [];
  let current = null;
  const rowPattern =
    /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-Z]+)\s+([A-Z0-9-]+)\s+(\d+(?:\.\d+)?)\s+\/([A-Z]+)\s+(\$?[0-9]*\.?[0-9]+)\s+\/([A-Z]+)\s+(\$?[0-9,.]+)$/i;

  const flush = () => {
    if (!current) return;

    const description = current.descriptionLines.join(" ").replace(/\s+/g, " ").trim();
    const name = current.descriptionLines[0] || current.sku || "Heritage Item";

    rows.push({
      id: `heritage_${current.rowNumber}_${uuidv4()}`,
      rowNumber: current.rowNumber,
      sku: current.sku,
      name,
      description: description || name,
      quantity: current.quantity,
      uom: current.uom.toLowerCase(),
      unitPrice: dollarsFromText(current.unitPrice).toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00"),
      amount: dollarsFromText(current.amount).toFixed(2),
      taxable: true,
      billable: false,
      billingRate: "",
      category: inferCategory(`${current.sku} ${description}`),
      matchedItemId: "",
      createDatabaseItem: true,
      matchedProductId: "",
      createProduct: true,
      productName: name,
    });
    current = null;
  };

  lines.slice(startIndex + 1).forEach((line) => {
    if (/^\*+SUB-TOTAL\*+/i.test(line) || /^Sales Tax\b/i.test(line) || /^\*+\s*TOTAL\s+\*+/i.test(line)) {
      flush();
      return;
    }

    const match = line.match(rowPattern);
    if (match) {
      flush();
      const [, orderedQty, shippedQty, uom, sku, convertedQty, convertedUom, unitPrice, priceUom, amount] = match;
      current = {
        rowNumber: rows.length + 1,
        orderedQty,
        quantity: shippedQty || convertedQty || orderedQty || "1",
        uom: uom || convertedUom || priceUom || "EA",
        sku,
        unitPrice,
        amount,
        descriptionLines: [],
      };
      return;
    }

    if (current) {
      current.descriptionLines.push(line);
    }
  });

  flush();
  return rows;
};

const parseHeritageInvoiceText = (rawText) => {
  const normalized = String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  const compact = normalized.replace(/\n+/g, " ");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const branchMatch = compact.match(/(HERITAGE POOL SUPPLY\s*-\s*.+?)\s+Branch\s*:\s*([A-Z0-9]+)/i);
  const orderInfo = parseHeritageOrderNotes(lines);

  let notes = "";
  notes = appendNote(notes, branchMatch?.[1] ? `Branch: ${branchMatch[1]}` : "");
  notes = appendNote(notes, branchMatch?.[2] ? `Branch code: ${branchMatch[2]}` : "");
  notes = appendNote(notes, orderInfo.orderType ? `Order type: ${orderInfo.orderType}` : "");
  notes = appendNote(notes, orderInfo.orderedBy ? `Ordered by: ${orderInfo.orderedBy}` : "");

  const subtotal = parseHeritageMoneyAfterLabel(compact, "\\*+SUB-TOTAL\\*+");
  const tax = parseHeritageMoneyAfterLabel(compact, "Sales Tax\\s+[0-9.]+%");
  const total = parseHeritageMoneyAfterLabel(compact, "\\*+\\s*TOTAL\\s+\\*+");

  return {
    invoiceNum: compact.match(/Invoice\s*#\s*:\s*([0-9-]+)/i)?.[1] || "",
    invoiceDate: parseHeritageDate(compact.match(/Invoice Date\s*:\s*([0-9/]+)/i)?.[1] || ""),
    vendorName: "Heritage Pool Supply",
    notes,
    subtotal: subtotal ? subtotal.toFixed(2) : "",
    tax: tax ? tax.toFixed(2) : "",
    total: total ? total.toFixed(2) : "",
    rawText: normalized,
    lines: parseHeritageLineItems(normalized),
  };
};

const extractTextFromPdfFile = async (file) => {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let lastY = null;
    const tokens = [];

    content.items.forEach((item) => {
      const y = Math.round(item.transform?.[5] || 0);
      if (lastY !== null && Math.abs(y - lastY) > 4) {
        tokens.push("\n");
      }
      tokens.push(item.str);
      lastY = y;
    });

    pageTexts.push(tokens.join(" ").replace(/[ \t]+\n/g, "\n"));
  }

  return pageTexts.join("\n\n").trim();
};

const HeritageReceiptImport = () => {
  const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [databaseItems, setDatabaseItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [selectedTechId, setSelectedTechId] = useState("");
  const [sourceFile, setSourceFile] = useState(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState("");
  const [sourceInputKey, setSourceInputKey] = useState(0);
  const [bulkQueue, setBulkQueue] = useState([]);
  const [bulkIndex, setBulkIndex] = useState(0);
  const [bulkSavedCount, setBulkSavedCount] = useState(0);
  const [bulkQueueExpanded, setBulkQueueExpanded] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(null);
  const [receipt, setReceipt] = useState(blankParsedReceipt);
  const [lines, setLines] = useState([]);
  const [updatingDatabaseItemCostIds, setUpdatingDatabaseItemCostIds] = useState({});
  const [pendingSaveOptions, setPendingSaveOptions] = useState(null);

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) || null;
  const technicianOptions = useMemo(
    () =>
      companyUsers
        .map((user) => {
          const userId = getCompanyUserId(user);
          const userName = getCompanyUserDisplayName(user) || user.email || "Technician";

          return {
            ...user,
            id: user.id || userId,
            userId,
            userName,
            value: userId,
            label: userName,
            searchText: [userName, user.email, user.phoneNumber, user.phone, userId].filter(Boolean).join(" "),
          };
        })
        .sort((firstUser, secondUser) => firstUser.label.localeCompare(secondUser.label)),
    [companyUsers]
  );
  const selectedTech =
    technicianOptions.find((user) => user.value === selectedTechId || user.userId === selectedTechId || user.id === selectedTechId) ||
    null;
  const sourceFileName = sourceFile?.name || "";
  const isBulkImport = bulkQueue.length > 1;
  const isFinalBulkReceipt = isBulkImport && bulkIndex >= bulkQueue.length - 1;
  const selectedSourceCount = isBulkImport ? bulkQueue.length : sourceFile ? 1 : 0;

  useEffect(() => {
    const loadSelectors = async () => {
      if (!recentlySelectedCompany) return;

      setLoading(true);
      try {
        const [vendorList, usersSnap, databaseSnap, productSnap] = await Promise.all([
          fetchCompanyVendors(db, recentlySelectedCompany),
          getDocs(query(collection(db, "companies", recentlySelectedCompany, "companyUsers"))),
          getDocs(query(collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"), orderBy("name"))),
          getDocs(query(productCatalogCollectionRef(db, recentlySelectedCompany), orderBy("commonName"))),
        ]);

        const users = usersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        const items = databaseSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        const productItems = productSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        const heritageVendor =
          vendorList.find((vendor) => normalizeKey(vendor.name).includes("heritagepoolsupply")) ||
          vendorList.find((vendor) => normalizeKey(vendor.name).includes("heritage")) ||
          vendorList[0] ||
          null;
        const defaultTech = findMatchingCompanyUser(DEFAULT_PURCHASE_TECH_NAME, users);

        setVendors(vendorList);
        setCompanyUsers(users);
        setDatabaseItems(items);
        setProducts(productItems);
        setSelectedVendorId(heritageVendor?.id || "");
        setSelectedTechId((currentTechId) => currentTechId || getCompanyUserId(defaultTech));
      } catch (error) {
        console.error("Error loading Heritage import selectors:", error);
        toast.error("Could not load receipt selectors");
      } finally {
        setLoading(false);
      }
    };

    loadSelectors();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!sourceFile) {
      setSourcePreviewUrl("");
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(sourceFile);
    setSourcePreviewUrl(nextPreviewUrl);

    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [sourceFile]);

  const lineTotals = useMemo(() => {
    const subtotal = lines.reduce((total, line) => total + dollarsFromText(line.amount), 0);
    const tax = dollarsFromText(receipt.tax);
    const enteredTotal = dollarsFromText(receipt.total);
    const total = subtotal && tax && (!enteredTotal || Math.abs(enteredTotal - subtotal) < 0.01)
      ? subtotal + tax
      : enteredTotal || subtotal + tax;

    return { subtotal, tax, total };
  }, [lines, receipt.tax, receipt.total]);
  const newDatabaseItemCount = useMemo(
    () => lines.filter((line) => !line.matchedItemId && line.createDatabaseItem).length,
    [lines]
  );
  const newProductCount = useMemo(
    () => lines.filter((line) => !line.matchedProductId && line.createProduct && (line.matchedItemId || line.createDatabaseItem)).length,
    [lines]
  );
  const databaseItemsById = useMemo(
    () => new Map(databaseItems.map((item) => [item.id, item])),
    [databaseItems]
  );
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );
  const databaseItemOptions = useMemo(
    () =>
      databaseItems
        .filter((item) => {
          if (!selectedVendor) return true;
          const itemVendorId = item.vendorId || item.venderId || "";
          if (itemVendorId && selectedVendor.id) return itemVendorId === selectedVendor.id;
          return normalizeKey(item.storeName) === normalizeKey(selectedVendor.name);
        })
        .map((item) => {
          const name = item.name || item.description || item.sku || "Vendor Item";
          const sku = item.sku || "";
          const category = item.category || "";
          const subCategory = item.subCategory || "";
          const uom = item.UOM || item.uom || "";
          const description = item.description || "";
          const rateCents = databaseItemRateCents(item);

          return {
            value: item.id,
            label: [name, sku].filter(Boolean).join(" - "),
            name,
            sku,
            category,
            subCategory,
            uom,
            description,
            rateCents,
            searchText: [name, sku, category, subCategory, uom, description, item.id].filter(Boolean).join(" "),
          };
        }),
    [databaseItems, selectedVendor]
  );
  const databaseItemOptionsById = useMemo(
    () => new Map(databaseItemOptions.map((option) => [option.value, option])),
    [databaseItemOptions]
  );
  const selectMenuPortalTarget = typeof document !== "undefined" ? document.body : null;

  const formatDatabaseItemOption = (option, meta) => {
    if (meta.context === "value") return option.name;

    const isSelected = meta.selectValue?.some((selected) => selected.value === option.value);

    return (
      <div>
        <p className={`font-semibold ${isSelected ? "text-white" : "text-slate-900"}`}>{option.name}</p>
        <p className={`text-xs ${isSelected ? "text-blue-100" : "text-slate-500"}`}>
          {[
            option.sku ? `SKU: ${option.sku}` : "",
            option.rateCents ? `Cost: ${moneyFromCents(option.rateCents)}` : "",
            option.category,
            option.uom ? `UOM: ${option.uom}` : "",
          ]
            .filter(Boolean)
            .join(" | ") || "No item details saved"}
        </p>
      </div>
    );
  };

  const applyParsedReceipt = (parsed, parseContext = {}) => {
    const itemsForMatching = parseContext.databaseItems || databaseItems;
    const productsForMatching = parseContext.products || products;
    const hydratedLines = (parsed.lines || []).map((line) => {
      const match = findMatchingItem(line, itemsForMatching);
      const productLink = vendorItemProductLink(match || line, productsForMatching);

      return {
        ...line,
        matchedItemId: match?.id || "",
        createDatabaseItem: !match,
        matchedProductId: productLink.productId,
        createProduct: !productLink.productId,
        productName: productLink.productName || getProductDisplayName(line),
        billable: Boolean(match?.billable),
        billingRate: match?.billingRate ? String(Number(match.billingRate) / 100) : "",
        category: match?.category || line.category,
      };
    });

    setReceipt({
      invoiceNum: parsed.invoiceNum || "",
      invoiceDate: parsed.invoiceDate ? parsed.invoiceDate.toISOString().slice(0, 10) : "",
      vendorName: parsed.vendorName || "Heritage Pool Supply",
      notes: parsed.notes || "",
      subtotal: parsed.subtotal || "",
      tax: parsed.tax || "",
      total: parsed.total || "",
      rawText: parsed.rawText || "",
    });
    setLines(hydratedLines);
  };

  const parseSourceFile = async (file, parseContext = {}) => {
    if (!file) return;

    const total = parseContext.total || 1;
    const index = parseContext.index || 0;

    setSourceFile(file);
    setReceipt(blankParsedReceipt);
    setLines([]);
    setParsing(true);
    setReceiptLoading({ fileName: file.name, index, total });

    try {
      const text = await extractTextFromPdfFile(file);
      const parsed = parseHeritageInvoiceText(text);
      applyParsedReceipt(parsed, { ...parseContext, fileName: file.name });
      if (parsed.lines?.length) {
        toast.success(`Found ${parsed.lines.length} line item${parsed.lines.length === 1 ? "" : "s"}`);
      } else {
        toast.error("No Heritage line items found");
      }
    } catch (error) {
      console.error("Error parsing Heritage upload:", error);
      toast.error("Could not parse upload");
    } finally {
      setParsing(false);
      setReceiptLoading(null);
    }
  };

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const nextQueue =
      files.length > 1
        ? files.map((file) => ({ id: `${file.name}-${file.lastModified}-${uuidv4()}`, file }))
        : [];

    setBulkQueue(nextQueue);
    setBulkIndex(0);
    setBulkSavedCount(0);
    setBulkQueueExpanded(false);
    await parseSourceFile(files[0], { index: 0, total: files.length });
  };

  const updateLine = (lineId, updates) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const nextLine = { ...line, ...updates };
        if (updates.matchedItemId !== undefined) {
          const match = databaseItemsById.get(updates.matchedItemId);
          if (match) {
            const productLink = vendorItemProductLink(match, products);
            return {
              ...hydrateLineFromDatabaseItem(nextLine, match),
              matchedProductId: productLink.productId,
              createProduct: !productLink.productId,
              productName: productLink.productName || getProductDisplayName(match),
            };
          }

          nextLine.createDatabaseItem = true;
          nextLine.billable = false;
          nextLine.billingRate = "";
          nextLine.matchedProductId = "";
          nextLine.createProduct = true;
          nextLine.productName = nextLine.name || "";
        }
        if (updates.amount === undefined && (updates.quantity !== undefined || updates.unitPrice !== undefined)) {
          nextLine.amount = calculatedLineAmount(nextLine.quantity, nextLine.unitPrice);
        }
        return nextLine;
      })
    );
  };

  const removeLine = (lineId) => {
    setLines((prev) => prev.filter((line) => line.id !== lineId));
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `manual_${uuidv4()}`,
        rowNumber: prev.length + 1,
        sku: "",
        name: "",
        description: "",
        quantity: "1",
        uom: "ea",
        unitPrice: "",
        amount: "",
        taxable: true,
        billable: false,
        billingRate: "",
        category: "Misc",
        matchedItemId: "",
        createDatabaseItem: true,
        matchedProductId: "",
        createProduct: true,
        productName: "",
      },
    ]);
  };

  const setDatabaseItemCostUpdating = (lineId, isUpdating) => {
    setUpdatingDatabaseItemCostIds((current) => ({ ...current, [lineId]: isUpdating }));
  };

  const updateDatabaseItemCostFromLine = async (line) => {
    const databaseItem = databaseItemsById.get(line.matchedItemId);
    const priceChange = getLinePriceChange(line, databaseItem);

    if (!recentlySelectedCompany || !databaseItem || !priceChange) {
      toast.error("No vendor item price update is available for this line.");
      return;
    }

    setDatabaseItemCostUpdating(line.id, true);
    try {
      const updates = { rate: priceChange.nextRateCents, dateUpdated: new Date() };
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", databaseItem.id), updates);
      setDatabaseItems((prev) => prev.map((item) => (item.id === databaseItem.id ? { ...item, ...updates } : item)));
      toast.success("Vendor item cost updated");
    } catch (error) {
      console.error("Error updating vendor item cost from Heritage import:", error);
      toast.error("Could not update vendor item cost");
    } finally {
      setDatabaseItemCostUpdating(line.id, false);
    }
  };

  const resetImportForm = ({ clearBulkQueue = true } = {}) => {
    if (clearBulkQueue) {
      setBulkQueue([]);
      setBulkIndex(0);
      setBulkSavedCount(0);
    }
    setBulkQueueExpanded(false);
    setSourceFile(null);
    setSourceInputKey((current) => current + 1);
    setReceipt(blankParsedReceipt);
    setLines([]);
  };

  const parseQueuedSourceFile = async (nextIndex, queue = bulkQueue, nextDatabaseItems = databaseItems, nextProducts = products) => {
    const nextQueueItem = queue[nextIndex];
    if (!nextQueueItem) return false;

    setBulkIndex(nextIndex);
    await parseSourceFile(nextQueueItem.file, {
      index: nextIndex,
      total: queue.length,
      databaseItems: nextDatabaseItems,
      products: nextProducts,
    });
    return true;
  };

  const requestSaveReceipt = (options = {}) => {
    if (recentlySelectedCompany !== MURDOCK_COMPANY_ID) {
      toast.error("This importer is only enabled for Murdock Pool Service.");
      return;
    }
    if (!receipt.invoiceNum.trim()) return toast.error("Invoice number is required.");
    if (!selectedVendor) return toast.error("Select a vendor before saving.");
    if (!lines.length) return toast.error("Add at least one line item.");

    setPendingSaveOptions(options);
  };

  const closeSaveConfirmation = () => {
    if (saving) return;
    setPendingSaveOptions(null);
  };

  const confirmSaveReceipt = async () => {
    const options = pendingSaveOptions || {};
    setPendingSaveOptions(null);
    await saveReceipt(options);
  };

  const saveReceipt = async ({ addAnother = false } = {}) => {
    if (recentlySelectedCompany !== MURDOCK_COMPANY_ID) {
      toast.error("This importer is only enabled for Murdock Pool Service.");
      return;
    }
    if (!receipt.invoiceNum.trim()) return toast.error("Invoice number is required.");
    if (!selectedVendor) return toast.error("Select a vendor before saving.");
    if (!lines.length) return toast.error("Add at least one line item.");

    setSaving(true);
    try {
      const receiptId = `com_rec_${uuidv4()}`;
      const receiptDate = receipt.invoiceDate ? new Date(`${receipt.invoiceDate}T12:00:00`) : new Date();
      const purchasedItemIds = [];
      const pdfUrlList = [];
      const createdDatabaseItems = [];
      const createdProducts = [];
      let databaseItemsForNextReceipt = databaseItems;
      let productsForNextReceipt = products;
      const receiptNoteParts = String(receipt.notes || "")
        .split(/\r?\n/)
        .map((note) => note.trim())
        .filter(Boolean);
      const importedSourceNote = `Imported from ${sourceFileName || receipt.invoiceNum || "Heritage import"}`;

      if (sourceFile) {
        const fileRef = ref(storage, `companies/${recentlySelectedCompany}/receipts/${receiptId}/${Date.now()}-${sourceFile.name}`);
        await uploadBytes(fileRef, sourceFile);
        pdfUrlList.push(await getDownloadURL(fileRef));
      }

      for (const line of lines) {
        let databaseItem = databaseItemsForNextReceipt.find((item) => item.id === line.matchedItemId) || null;
        let itemId = databaseItem?.id || "";
        let databaseItemWasCreated = false;
        const now = new Date();

        if (!databaseItem && line.createDatabaseItem) {
          itemId = `com_sett_db_${uuidv4()}`;
          databaseItem = {
            UOM: normalizedDatabaseUom(line.uom),
            id: itemId,
            billable: Boolean(line.billable),
            category: line.category || inferCategory(line.name),
            color: "",
            dateUpdated: now,
            description: line.description || line.name || "",
            name: line.name || line.sku || "Heritage Item",
            rate: centsFromDollars(line.unitPrice),
            size: "",
            sku: line.sku || "",
            storeName: selectedVendor.name || "",
            subCategory: "Misc",
            timesPurchased: 0,
            venderId: selectedVendor.id || "",
            vendorId: selectedVendor.id || "",
            billingRate: centsFromDollars(line.billingRate || line.unitPrice),
            sellPrice: centsFromDollars(line.billingRate || line.unitPrice),
            tracking: "",
          };
          databaseItemWasCreated = true;
        }

        const existingProductId = line.matchedProductId || databaseItem?.productId || databaseItem?.genericItemId || "";
        let linkedProduct = productsForNextReceipt.find((product) => product.id === existingProductId) || null;

        if (!linkedProduct && line.createProduct && databaseItem && itemId) {
          const productId = `com_prod_${uuidv4()}`;
          linkedProduct = buildProductFromVendorItem({
            productId,
            vendorItem: { ...databaseItem, id: itemId },
            overrides: {
              name: line.productName || databaseItem.name || line.name,
              sellPrice: centsFromDollars(line.billingRate || line.unitPrice || ""),
            },
            source: "heritageReceiptImport",
            now,
          });

          await setDoc(productCatalogDocRef(db, recentlySelectedCompany, productId), linkedProduct);
          createdProducts.push(linkedProduct);
          productsForNextReceipt = [...productsForNextReceipt, linkedProduct];
        } else if (linkedProduct && itemId) {
          await updateDoc(productCatalogDocRef(db, recentlySelectedCompany, linkedProduct.id), {
            storeItems: arrayUnion(databaseItem?.name || line.name || itemId),
            storeItemsIds: arrayUnion(itemId),
            vendorItemIds: arrayUnion(itemId),
            active: true,
            availableForPartPurchase: true,
            partPurchaseAvailable: true,
            dateUpdated: now,
            updatedAt: now,
          });
        }

        const vendorItemAlreadyLinkedToProduct =
          linkedProduct && (databaseItem?.productId === linkedProduct.id || databaseItem?.genericItemId === linkedProduct.id);

        if (linkedProduct && databaseItem) {
          databaseItem = { ...databaseItem, ...buildVendorItemProductPatch(linkedProduct, now) };
        }

        if (databaseItemWasCreated && databaseItem) {
          await setDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", itemId), databaseItem);
          createdDatabaseItems.push(databaseItem);
          databaseItemsForNextReceipt = [...databaseItemsForNextReceipt, databaseItem];
        } else if (linkedProduct && itemId && !vendorItemAlreadyLinkedToProduct) {
          await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", itemId),
            buildVendorItemProductPatch(linkedProduct, now)
          );
        }

        const purchaseId = `comp_pi_${uuidv4()}`;
        purchasedItemIds.push(purchaseId);

        await setDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchaseId), {
          id: purchaseId,
          receiptId,
          invoiceNum: receipt.invoiceNum.trim(),
          venderId: selectedVendor.id || "",
          venderName: selectedVendor.name || "",
          vendorId: selectedVendor.id || "",
          vendorName: selectedVendor.name || "",
          techId: getCompanyUserId(selectedTech),
          techName: getCompanyUserDisplayName(selectedTech),
          itemId,
          name: databaseItem?.name || line.name || line.sku || "Purchased Item",
          category: databaseItem?.category || line.category || inferCategory(`${line.sku} ${line.name}`),
          subCategory: databaseItem?.subCategory || "Misc",
          price: centsFromDollars(line.unitPrice),
          quantityString: String(line.quantity || "1"),
          date: receiptDate,
          billable: Boolean(line.billable),
          productId: linkedProduct?.id || "",
          productName: linkedProduct ? getProductDisplayName(linkedProduct) : "",
          genericItemId: linkedProduct?.id || "",
          genericItemName: linkedProduct ? getProductDisplayName(linkedProduct) : "",
          invoiced: false,
          returned: false,
          status: line.billable ? "Needs invoice" : "Non-billable",
          customerId: "",
          customerName: "",
          sku: databaseItem?.sku || line.sku || "",
          notes: [...receiptNoteParts, importedSourceNote].filter(Boolean).join(" | "),
          jobId: "",
          workOrderId: "",
          assignedJobId: "",
          assignedToJob: false,
          assignmentStatus: "unassigned",
          billingOwner: "purchasedItem",
          jobBillingStatus: "",
          jobBillable: false,
          jobBillingRate: 0,
          billingRate: centsFromDollars(line.billingRate || line.unitPrice),
          source: "heritageReceiptImport",
          taxable: Boolean(line.taxable),
        });
      }

      const saveSubtotal = dollarsFromText(receipt.subtotal) || lineTotals.subtotal;
      const saveTax = dollarsFromText(receipt.tax) || lineTotals.tax;
      const enteredTotal = dollarsFromText(receipt.total);
      const saveTotal = saveSubtotal && saveTax && (!enteredTotal || Math.abs(enteredTotal - saveSubtotal) < 0.01)
        ? saveSubtotal + saveTax
        : enteredTotal || lineTotals.total;

      await setDoc(doc(db, "companies", recentlySelectedCompany, "receipts", receiptId), {
        id: receiptId,
        invoiceNum: receipt.invoiceNum.trim(),
        date: receiptDate,
        storeId: selectedVendor.id || "",
        storeName: selectedVendor.name || "",
        tech: getCompanyUserDisplayName(selectedTech),
        techId: getCompanyUserId(selectedTech),
        techName: getCompanyUserDisplayName(selectedTech),
        purchasedItemIds,
        numberOfItems: purchasedItemIds.length,
        cost: centsFromDollars(saveSubtotal),
        costAfterTax: centsFromDollars(saveTotal),
        tax: centsFromDollars(saveTax),
        notes: receipt.notes || "",
        pdfUrlList,
        source: "heritageReceiptImport",
        rawVendorName: receipt.vendorName || "",
      });

      if (createdDatabaseItems.length) {
        setDatabaseItems((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const mergedItems = [...prev, ...createdDatabaseItems.filter((item) => !existingIds.has(item.id))];
          return mergedItems.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        });
      }

      if (createdProducts.length) {
        setProducts((prev) => {
          const existingIds = new Set(prev.map((product) => product.id));
          const mergedProducts = [...prev, ...createdProducts.filter((product) => !existingIds.has(product.id))];
          return mergedProducts.sort((a, b) => getProductDisplayName(a).localeCompare(getProductDisplayName(b)));
        });
      }

      if (isBulkImport) {
        const nextSavedCount = bulkSavedCount + 1;
        const nextIndex = bulkIndex + 1;
        setBulkSavedCount(nextSavedCount);

        if (nextIndex < bulkQueue.length) {
          toast.success(`Receipt saved. Loading ${nextIndex + 1} of ${bulkQueue.length}.`);
          await parseQueuedSourceFile(nextIndex, bulkQueue, databaseItemsForNextReceipt, productsForNextReceipt);
        } else {
          toast.success(`Bulk import complete. ${nextSavedCount} receipt${nextSavedCount === 1 ? "" : "s"} created.`);
          resetImportForm();
        }
      } else if (addAnother) {
        toast.success("Receipt created. Ready for the next one.");
        resetImportForm();
      } else {
        toast.success("Receipt created");
        navigate(`/company/receipts/detail/${receiptId}`);
      }
    } catch (error) {
      console.error("Error saving Heritage receipt:", error);
      toast.error("Failed to save receipt");
    } finally {
      setSaving(false);
    }
  };

  if (recentlySelectedCompany !== MURDOCK_COMPANY_ID) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Custom Receipt Import</h1>
          <p className="mt-2 text-gray-600">This page is not enabled for the selected company.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-none space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Heritage Receipt Import</h1>
            <p className="mt-1 text-sm text-gray-500">Upload Heritage invoice PDFs and review parsed receipt fields before saving.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/company/purchased-items/createNew")}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Back to Create Receipt
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">Receipt Fields</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-12">
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Invoice #
              <input
                value={receipt.invoiceNum}
                onChange={(event) => setReceipt((prev) => ({ ...prev, invoiceNum: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Date
              <input
                type="date"
                value={receipt.invoiceDate}
                onChange={(event) => setReceipt((prev) => ({ ...prev, invoiceDate: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-4">
              Vendor
              <select
                value={selectedVendorId}
                onChange={(event) => setSelectedVendorId(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              >
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm font-semibold text-gray-700 xl:col-span-4">
              <p>Technician</p>
              <div className="mt-1 font-normal">
                <Select
                  value={selectedTech}
                  options={technicianOptions}
                  onChange={(option) => setSelectedTechId(option ? getCompanyUserId(option) : "")}
                  isClearable
                  isSearchable
                  placeholder="Select a Tech"
                  noOptionsMessage={() => "No technicians found"}
                  filterOption={(option, inputValue) => option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())}
                  theme={selectTheme}
                  styles={selectStyles}
                />
              </div>
            </div>
            <label className="text-sm font-semibold text-gray-700 md:col-span-2 xl:col-span-6">
              Notes
              <textarea
                rows={2}
                value={receipt.notes}
                onChange={(event) => setReceipt((prev) => ({ ...prev, notes: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Subtotal
              <input
                value={receipt.subtotal}
                onChange={(event) => setReceipt((prev) => ({ ...prev, subtotal: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Tax
              <input
                value={receipt.tax}
                onChange={(event) => setReceipt((prev) => ({ ...prev, tax: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 xl:col-span-2">
              Total
              <input
                value={receipt.total}
                onChange={(event) => setReceipt((prev) => ({ ...prev, total: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">Source</h2>
              <div className="mt-4 space-y-3">
                <input
                  key={sourceInputKey}
                  type="file"
                  multiple
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  disabled={parsing || saving}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                {sourceFile ? (
                  <p className="text-sm text-gray-500">
                    {isBulkImport ? `Reviewing ${bulkIndex + 1} of ${bulkQueue.length}: ` : ""}
                    {sourceFile.name}
                  </p>
                ) : null}
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">Bulk Queue</p>
                      <p className="mt-1 text-xs font-semibold text-gray-500">
                        {bulkSavedCount} Saved / {selectedSourceCount} Selected
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBulkQueueExpanded((expanded) => !expanded)}
                      className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      {bulkQueueExpanded ? "Collapse" : "Expand"}
                    </button>
                  </div>
                  {bulkQueueExpanded ? (
                    <div className="mt-4 max-h-44 space-y-2 overflow-y-auto">
                      {isBulkImport ? (
                        bulkQueue.map((queueItem, queueIndex) => {
                          const isCurrent = queueIndex === bulkIndex;
                          const isComplete = queueIndex < bulkIndex;

                          return (
                            <div
                              key={queueItem.id}
                              className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                                isCurrent
                                  ? "border-blue-200 bg-blue-50 text-blue-900"
                                  : isComplete
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                    : "border-gray-200 bg-white text-gray-600"
                              }`}
                            >
                              <span className="min-w-0 truncate">{queueItem.file.name}</span>
                              <span className="shrink-0 text-xs font-semibold">
                                {isCurrent ? "Reviewing" : isComplete ? "Done" : "Waiting"}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-600">
                          {sourceFileName || "No receipts selected"}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900">Preview</h2>
                  <p className="mt-1 truncate text-sm text-gray-500">{sourceFileName || receipt.invoiceNum || "No source selected"}</p>
                </div>
                {sourcePreviewUrl ? (
                  <a
                    href={sourcePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                  >
                    Open
                  </a>
                ) : null}
              </div>
              <div className="mt-4 h-[460px] overflow-hidden rounded-md border border-gray-200 bg-gray-100">
                {sourcePreviewUrl ? (
                  <iframe title="Heritage PDF preview" src={sourcePreviewUrl} className="h-full w-full" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-500">Select a PDF</div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Line Items</h2>
                <p className="mt-1 text-sm text-gray-500">{lines.length} item(s) parsed</p>
              </div>
              <div className="flex flex-col gap-3 sm:items-end">
                <div className="grid grid-cols-3 gap-3 text-right text-sm">
                  <div>
                    <p className="font-semibold text-gray-500">Subtotal</p>
                    <p className="font-bold text-gray-900">{money(lineTotals.subtotal)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-500">Tax</p>
                    <p className="font-bold text-gray-900">{money(lineTotals.tax)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-500">Total</p>
                    <p className="font-bold text-gray-900">{money(lineTotals.total)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addLine}
                  className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Add Line Item
                </button>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-[1240px] w-full border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-2 py-1">SKU</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">UOM</th>
                    <th className="px-2 py-1">Unit</th>
                    <th className="px-2 py-1">Amount</th>
                    <th className="px-2 py-1">Vendor Item</th>
                    <th className="px-2 py-1">Category</th>
                    <th className="px-2 py-1">Billable</th>
                    <th className="px-2 py-1">Billing Rate</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const matchedDatabaseItem = databaseItemsById.get(line.matchedItemId) || null;
                    const linkedProductId = line.matchedProductId || matchedDatabaseItem?.productId || matchedDatabaseItem?.genericItemId || "";
                    const linkedProduct = productsById.get(linkedProductId) || null;
                    const linkedProductName = linkedProduct
                      ? getProductDisplayName(linkedProduct)
                      : line.productName || matchedDatabaseItem?.productName || matchedDatabaseItem?.genericItemName || "";
                    const priceChange = getLinePriceChange(line, matchedDatabaseItem);
                    const isUpdatingDatabaseItemCost = Boolean(updatingDatabaseItemCostIds[line.id]);

                    return (
                      <tr key={line.id} className="rounded-md bg-gray-50 text-sm">
                        <td className="px-2 py-2">
                          <input
                            value={line.sku}
                            onChange={(event) => updateLine(line.id, { sku: event.target.value })}
                            className="w-32 rounded-md border border-gray-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.name}
                            onChange={(event) => updateLine(line.id, { name: event.target.value, description: event.target.value })}
                            className="w-64 rounded-md border border-gray-300 px-2 py-1"
                          />
                          {line.description && line.description !== line.name ? (
                            <p className="mt-1 max-w-64 text-xs text-gray-500">{line.description}</p>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.quantity}
                            onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                            className="w-20 rounded-md border border-gray-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={line.uom}
                            onChange={(event) => updateLine(line.id, { uom: event.target.value })}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1"
                          >
                            {uomOptions.map((uom) => (
                              <option key={uom} value={uom}>
                                {uom}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.unitPrice}
                            onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.amount}
                            onChange={(event) => updateLine(line.id, { amount: event.target.value })}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="w-72">
                            <Select
                              value={databaseItemOptionsById.get(line.matchedItemId) || null}
                              onChange={(option) => updateLine(line.id, { matchedItemId: option?.value || "" })}
                              options={databaseItemOptions}
                              isClearable
                              isSearchable
                              placeholder="Search Heritage vendor items"
                              noOptionsMessage={() => "No vendor items found for this vendor"}
                              formatOptionLabel={formatDatabaseItemOption}
                              filterOption={(option, inputValue) => option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())}
                              theme={selectTheme}
                              styles={selectStyles}
                              menuPortalTarget={selectMenuPortalTarget || undefined}
                            />
                          </div>
                          <label className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={line.createDatabaseItem}
                              disabled={Boolean(line.matchedItemId)}
                              onChange={(event) => updateLine(line.id, { createDatabaseItem: event.target.checked })}
                            />
                            New vendor item
                          </label>
                          {linkedProductId ? (
                            <p className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                              Product link inherited{linkedProductName ? `: ${linkedProductName}` : ""}
                            </p>
                          ) : line.matchedItemId ? (
                            <label className="mt-2 flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                              <input
                                type="checkbox"
                                checked={line.createProduct}
                                onChange={(event) => updateLine(line.id, { createProduct: event.target.checked })}
                              />
                              Create product link
                            </label>
                          ) : null}
                          {priceChange ? (
                            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                              <p className="font-semibold">
                                Cost changed: {priceChange.currentRateCents ? moneyFromCents(priceChange.currentRateCents) : "No catalog cost"} - {moneyFromCents(priceChange.nextRateCents)}
                              </p>
                              <button
                                type="button"
                                onClick={() => updateDatabaseItemCostFromLine(line)}
                                disabled={isUpdatingDatabaseItemCost}
                                className="mt-2 rounded-md bg-amber-600 px-2 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                              >
                                {isUpdatingDatabaseItemCost ? "Updating..." : "Update Vendor Cost"}
                              </button>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={line.category}
                            onChange={(event) => updateLine(line.id, { category: event.target.value })}
                            className="w-32 rounded-md border border-gray-300 px-2 py-1"
                          >
                            {categoryOptions.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={line.billable}
                            onChange={(event) => updateLine(line.id, { billable: event.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.billingRate}
                            onChange={(event) => updateLine(line.id, { billingRate: event.target.value })}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!lines.length ? (
                <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-gray-500">No line items parsed yet.</div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col justify-end gap-3 sm:flex-row sm:items-center">
              {isBulkImport ? (
                <p className="text-sm font-semibold text-gray-500 sm:mr-auto">
                  Bulk receipt {bulkIndex + 1} of {bulkQueue.length}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={loading || parsing || saving || !lines.length}
                  onClick={() => requestSaveReceipt({ addAnother: true })}
                  className="rounded-md border border-green-200 bg-white px-5 py-2 text-sm font-semibold text-green-700 shadow-sm hover:bg-green-50 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save and Add Another"}
                </button>
              )}
              <button
                type="button"
                disabled={loading || parsing || saving || !lines.length}
                onClick={() => requestSaveReceipt()}
                className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : isBulkImport
                    ? isFinalBulkReceipt
                      ? "Save Final Receipt"
                      : "Save and Continue"
                    : "Save Confirmed Receipt"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {receiptLoading ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-blue-50 p-2 text-blue-700">
                <FaSpinner className="animate-spin" />
              </span>
              <div>
                <h2 className="text-xl font-bold text-slate-950">Loading Receipt</h2>
                <p className="mt-2 text-sm text-slate-600">
                  {receiptLoading.total > 1
                    ? `Reading receipt ${receiptLoading.index + 1} of ${receiptLoading.total}.`
                    : "Reading the selected receipt."}
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{receiptLoading.fileName}</p>
              <p className="mt-1">Extracting invoice text and matching Heritage line items.</p>
            </div>
          </div>
        </div>
      ) : null}

      {pendingSaveOptions ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-emerald-50 p-2 text-emerald-700">
                <FaReceipt />
              </span>
              <div>
                <h2 className="text-xl font-bold text-slate-950">Create Receipt</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Confirm the parsed Heritage receipt before creating the receipt and purchased item records.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="font-semibold text-slate-500">Invoice</p>
                <p className="mt-1 font-bold text-slate-950">{receipt.invoiceNum || "--"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-500">Vendor</p>
                <p className="mt-1 font-bold text-slate-950">{selectedVendor?.name || "Not selected"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-500">Line Items</p>
                <p className="mt-1 font-bold text-slate-950">{lines.length}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-500">Total</p>
                <p className="mt-1 font-bold text-slate-950">{money(lineTotals.total)}</p>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="flex items-start gap-2">
                <FaCheckCircle className="mt-0.5 shrink-0" />
                <p>
                  This will create {lines.length} purchased item{lines.length === 1 ? "" : "s"}
                  {newDatabaseItemCount ? `, ${newDatabaseItemCount} new vendor item${newDatabaseItemCount === 1 ? "" : "s"}` : ""}
                  {newProductCount ? `, and ${newProductCount} new product${newProductCount === 1 ? "" : "s"}` : ""}.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeSaveConfirmation}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSaveReceipt}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaCheckCircle className="text-xs" />
                {isBulkImport
                  ? isFinalBulkReceipt
                    ? "Create Final Receipt"
                    : "Create and Continue"
                  : pendingSaveOptions.addAnother
                    ? "Create and Add Another"
                    : "Create Receipt"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HeritageReceiptImport;
