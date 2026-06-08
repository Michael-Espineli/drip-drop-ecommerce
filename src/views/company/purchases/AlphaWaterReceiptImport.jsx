import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDocs, orderBy, query, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import * as pdfjsLib from "pdfjs-dist/webpack";
import { Context } from "../../../context/AuthContext";
import { db, storage } from "../../../utils/config";
import { fetchCompanyVendors } from "../../../utils/vendors";

const MURDOCK_COMPANY_ID = "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e";
const DEFAULT_PURCHASE_TECH_NAME = "Michael Espineli";

const uomOptions = ["ea", "gal", "lb", "lbs", "oz", "ft", "unit", "tab", "quart"];
const categoryOptions = ["PVC", "Galvanized", "Chemicals", "Useables", "Equipment", "Parts", "Electrical", "Tools", "Misc"];

const blankParsedReceipt = {
  invoiceNum: "",
  invoiceDate: "",
  vendorName: "Alpha Water Systems, Inc.",
  notes: "",
  subtotal: "",
  tax: "",
  total: "",
  rawText: "",
};

const blankDatabaseItemForm = {
  lineId: "",
  name: "",
  description: "",
  sku: "",
  uom: "ea",
  category: "Misc",
  subCategory: "Misc",
  size: "",
  color: "",
  rate: "",
  billable: false,
  billingRate: "",
};

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));

const centsFromDollars = (value) => Math.round(Number(value || 0) * 100);

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

const dollarsFromText = (value) => {
  const number = Number(String(value || "").replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const decodeQuotedPrintable = (value) =>
  String(value || "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const decodeHtmlEntities = (value) =>
  String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const htmlToText = (value) =>
  decodeHtmlEntities(
    String(value || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|tr|td|th|table|div)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const findLastIndex = (items, predicate) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
};

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getCompanyUserDisplayName = (user) =>
  user?.userName || user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "";

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

const getCompanyUserId = (user) => user?.userId || user?.id || "";

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
  if (/(acid|chlor|hypochlorite|sodium bromide|bleach|test strips|aquachek)/.test(text)) return "Chemicals";
  if (/(valve|oring|o-ring|gasket|union|fitting)/.test(text)) return "Parts";
  if (/(wire|breaker|gfci|light|relay)/.test(text)) return "Electrical";
  if (/(pump|filter|heater|chlorinator|cleaner)/.test(text)) return "Equipment";
  return "Misc";
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

const isAlphaWaterRowStart = (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;

  const tabFields = trimmed.split("\t");
  if (/^\d+$/.test(tabFields[0] || "") && tabFields[1] && !/^\$/.test(tabFields[1])) {
    return true;
  }

  return /^\d+(?:\s+|(?=[A-Z0-9]))[A-Z0-9][A-Z0-9-]*/.test(trimmed);
};

const getAlphaWaterRowStartNumber = (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const tabFields = trimmed.split("\t");
  if (/^\d+$/.test(tabFields[0] || "") && tabFields[1] && !/^\$/.test(tabFields[1])) {
    return Number(tabFields[0]);
  }

  const match = trimmed.match(/^(\d+)(?:\s+|(?=[A-Z0-9]))[A-Z0-9][A-Z0-9-]*/);
  return match ? Number(match[1]) : null;
};

const isAlphaWaterSplitRowStart = (line) => /^\d+$/.test(String(line || "").trim());

const cleanAlphaDescription = (description, sku) => {
  const skuParts = String(sku || "").split("-");
  const skuTail = skuParts.length > 1 ? skuParts.slice(1).join("-") : "";
  const skuLastPart = skuParts.length > 1 ? skuParts[skuParts.length - 1] : "";
  let clean = String(description || "")
    .replace(/\s+/g, " ")
    .trim();

  [sku, skuTail, skuLastPart].filter(Boolean).forEach((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clean = clean.replace(new RegExp(`\\s+${escaped}$`, "i"), "").trim();
  });

  return clean;
};

const buildParsedLine = ({ rowNumber, sku, description, quantity, uom, lotSerial, unitPrice, amount, taxable }) => {
  let normalizedSku = String(sku || "").trim();
  let normalizedDescription = String(description || "").trim();

  if (normalizedSku.endsWith("-")) {
    const descriptionTokens = normalizedDescription.split(/\s+/).filter(Boolean);
    if (descriptionTokens[0]) {
      normalizedSku = `${normalizedSku}${descriptionTokens[0]}`;
      normalizedDescription = descriptionTokens.slice(1).join(" ");
    }
  }

  const name = cleanAlphaDescription(normalizedDescription, normalizedSku) || normalizedSku || "Alpha Water Item";

  return {
    id: `parsed_${rowNumber || "row"}_${uuidv4()}`,
    rowNumber: rowNumber || "",
    sku: normalizedSku,
    name,
    description: name,
    quantity: String(quantity || "1").trim(),
    uom: String(uom || "ea").trim().toLowerCase() || "ea",
    lotSerial: String(lotSerial || "").trim(),
    unitPrice: dollarsFromText(unitPrice).toFixed(2),
    amount: dollarsFromText(amount).toFixed(2),
    taxable: String(taxable || "").toLowerCase().startsWith("yes"),
    billable: false,
    billingRate: "",
    category: inferCategory(`${sku} ${name}`),
    matchedItemId: "",
    createDatabaseItem: true,
  };
};

const normalizeAlphaWaterPdfRowText = (rowText) =>
  String(rowText || "")
    .replace(/\u00a0/g, " ")
    .replace(/^(\d+)(?=[A-Z0-9])/, "$1 ")
    .replace(/(\$[0-9,]+\.\d{2})(?=\$)/g, "$1 ")
    .replace(/(\$[0-9,]+\.\d{2})(?=(Yes|No)\.?$)/gi, "$1 ");

const parseAlphaWaterCompactRows = (rawText) => {
  const compact = String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  const lineSection = compact.match(/Item\s+Description\s+Quantity\s+UOM\s+Lot\/Serial\s+Unit Price\s+Amount\s+Tax\s+(.+?)\s+Subtotal/i)?.[1];
  if (!lineSection) return [];

  const rows = [];
  const rowPattern =
    /(?:^|\s)(\d+)\s+([A-Z0-9][A-Z0-9-]*)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(ea|gal|lb|lbs|oz|ft|unit|tab|quart)\s+(\$?[0-9,]+\.\d{2})\s+(\$?[0-9,]+\.\d{2})\s+(Yes|No)\.?(?=\s+\d+\s+[A-Z0-9]|\s*$)/gi;

  let match;
  while ((match = rowPattern.exec(lineSection))) {
    const [, rowNumber, sku, description, quantity, uom, unitPrice, amount, taxable] = match;
    rows.push(buildParsedLine({ rowNumber, sku, description, quantity, uom, lotSerial: "", unitPrice, amount, taxable }));
  }

  return rows;
};

const extractNetSuiteTableRows = (rawText) => {
  const decoded = decodeQuotedPrintable(rawText);
  if (!/<table[^>]+class=["']?itemtable/i.test(decoded)) return [];

  const rows = [];
  const tableMatch = decoded.match(/<table[^>]+class=["']?itemtable[\s\S]*?<\/table>/i);
  const itemTable = tableMatch?.[0] || decoded;
  const rowMatches = itemTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  Array.from(rowMatches).forEach((rowMatch) => {
    const rowHtml = rowMatch[1];
    if (/<th\b/i.test(rowHtml)) return;

    const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((cellMatch) =>
      htmlToText(cellMatch[1]).replace(/\s+/g, " ").trim()
    );

    if (cells.length < 8 || !/^\d+$/.test(cells[0] || "")) return;

    rows.push(
      buildParsedLine({
        rowNumber: cells[0],
        sku: cells[1],
        description: cells[2],
        quantity: cells[3],
        uom: cells[4] || "ea",
        lotSerial: cells[5],
        unitPrice: cells[6],
        amount: cells[7],
        taxable: cells[8],
      })
    );
  });

  return rows;
};

const parseAlphaWaterLineRow = (rowText) => {
  const rawRow = normalizeAlphaWaterPdfRowText(rowText).trim();
  if (!rawRow) return null;

  const tabFields = rawRow.split("\t").map((field) => field.trim());
  if (tabFields.length >= 6 && /^\d+$/.test(tabFields[0] || "")) {
    const taxIndex = findLastIndex(tabFields, (field) => /^(yes|no)\.?$/i.test(field));
    const amountIndex =
      taxIndex > -1 ? findLastIndex(tabFields.slice(0, taxIndex), (field) => /^\$?[0-9,]+\.\d{2}$/.test(field)) : -1;
    const unitPriceIndex =
      amountIndex > -1
        ? findLastIndex(tabFields.slice(0, amountIndex), (field) => /^\$?[0-9,]+\.\d{2}$/.test(field))
        : -1;
    const quantityIndex =
      unitPriceIndex > -1
        ? findLastIndex(tabFields.slice(2, unitPriceIndex), (field) => /^\d+(?:\.\d+)?$/.test(field))
        : -1;
    const absoluteQuantityIndex = quantityIndex > -1 ? quantityIndex + 2 : -1;

    if (taxIndex > -1 && amountIndex > -1 && unitPriceIndex > -1 && absoluteQuantityIndex > -1) {
      const uomCandidate = tabFields[absoluteQuantityIndex + 1] || "";
      const hasKnownUom = uomOptions.includes(uomCandidate.toLowerCase());
      const lotStartIndex = hasKnownUom ? absoluteQuantityIndex + 2 : absoluteQuantityIndex + 1;

      return buildParsedLine({
        rowNumber: tabFields[0],
        sku: tabFields[1],
        description: tabFields.slice(2, absoluteQuantityIndex).filter(Boolean).join(" "),
        quantity: tabFields[absoluteQuantityIndex],
        uom: hasKnownUom ? uomCandidate : "ea",
        lotSerial: tabFields.slice(lotStartIndex, unitPriceIndex).filter(Boolean).join(" "),
        unitPrice: tabFields[unitPriceIndex],
        amount: tabFields[amountIndex],
        taxable: tabFields[taxIndex],
      });
    }
  }

  const flattened = normalizeAlphaWaterPdfRowText(rawRow).replace(/\s+/g, " ").trim();
  const tailMatch = flattened.match(/^(.*?)\s+(\$?[0-9,]+\.\d{2})\s+(\$?[0-9,]+\.\d{2})\s+(Yes|No)\.?$/i);
  if (!tailMatch) return null;

  const [, beforePrices, unitPrice, amount, taxable] = tailMatch;
  const headMatch = beforePrices.match(
    /^(\d+)\s+([A-Z0-9][A-Z0-9-]*)\s+(.+)\s+(\d+(?:\.\d+)?)(?:\s+(ea|gal|lb|lbs|oz|ft|unit|tab|quart))?(?:\s+(.+))?$/i
  );

  if (!headMatch) return null;

  const [, rowNumber, sku, description, quantity, uom, lotSerial] = headMatch;
  return buildParsedLine({ rowNumber, sku, description, quantity, uom, lotSerial, unitPrice, amount, taxable });
};

const parseAlphaWaterLineRows = (rawText) => {
  const htmlRows = extractNetSuiteTableRows(rawText);
  if (htmlRows.length) return htmlRows;

  const text = String(rawText || "").replace(/\r/g, "\n");
  const rows = [];
  const flushRow = (rowText) => {
    const parsed = parseAlphaWaterLineRow(rowText);
    if (parsed) rows.push(parsed);
  };

  let inLineItems = false;
  let currentRow = "";
  let expectedRowNumber = 1;

  text.split("\n").forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) return;

    if (/Item\s+Description\s+Quantity/i.test(trimmed) || /Quantity\s*UOM\s*Lot\/Serial\s*Unit/i.test(trimmed)) {
      inLineItems = true;
      return;
    }

    if (inLineItems && /^(Subtotal|Tax Total|Total)\b/i.test(trimmed)) {
      if (currentRow) flushRow(currentRow);
      currentRow = "";
      inLineItems = false;
      return;
    }

    const rowStartNumber = getAlphaWaterRowStartNumber(trimmed);
    const isExpectedRowStart = rowStartNumber === expectedRowNumber;

    if (!inLineItems && !isExpectedRowStart) return;

    if (isExpectedRowStart && (isAlphaWaterRowStart(trimmed) || isAlphaWaterSplitRowStart(trimmed))) {
      if (currentRow) flushRow(currentRow);
      currentRow = trimmed;
      inLineItems = true;
      expectedRowNumber = rowStartNumber + 1;
      return;
    }

    if (currentRow) {
      currentRow = `${currentRow}\n${trimmed}`;
    }
  });

  if (currentRow) flushRow(currentRow);

  return rows.length ? rows : parseAlphaWaterCompactRows(text);
};

const moneyAfterLabel = (normalizedLines, compact, labelPattern) => {
  const labelRegex = new RegExp(`^${labelPattern}\\b`, "i");
  const lineIndex = findLastIndex(normalizedLines, (line) => labelRegex.test(line));
  if (lineIndex > -1) {
    const sameLineMatch = normalizedLines[lineIndex].match(/\$[0-9,]+\.\d{2}/);
    if (sameLineMatch) return dollarsFromText(sameLineMatch[0]);

    const nextLineMatch = normalizedLines[lineIndex + 1]?.match(/\$[0-9,]+\.\d{2}/);
    if (nextLineMatch) return dollarsFromText(nextLineMatch[0]);
  }

  const compactMatch = compact.match(new RegExp(`${labelPattern}\\s+\\$([0-9,.]+)`, "i"));
  return dollarsFromText(compactMatch?.[1] || "");
};

const parseAlphaWaterInvoiceText = (rawText) => {
  const decoded = decodeQuotedPrintable(rawText);
  const plainText = htmlToText(decoded);
  const searchableText = plainText || decoded;
  const normalized = String(searchableText || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  const compact = normalized.replace(/\n+/g, " ");
  const normalizedLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const invoiceNum =
    compact.match(/Invoice\s*#\s*:?\s*(INV[0-9]+)/i)?.[1] ||
    compact.match(/#(INV[0-9]+)/i)?.[1] ||
    "";
  const dateText = compact.match(/Date:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i)?.[1] || "";
  const invoiceDate = dateText ? new Date(`${dateText} 12:00:00`) : new Date();

  const lines = parseAlphaWaterLineRows(decoded);

  const subtotal = moneyAfterLabel(normalizedLines, compact, "Subtotal");
  const tax = moneyAfterLabel(normalizedLines, compact, "Tax Total");
  const parsedTotal = moneyAfterLabel(normalizedLines, compact, "Total");
  const total = subtotal && tax && (!parsedTotal || Math.abs(parsedTotal - subtotal) < 0.01)
    ? subtotal + tax
    : parsedTotal;
  const headerIndex = normalizedLines.findIndex((line) => /Customer Account #\s+Sales Rep\s+PO #\s+Terms\s+Due Date/i.test(line));
  const headerValueLine = headerIndex > -1 ? normalizedLines[headerIndex + 1] || "" : "";
  const parsedTechnicianName =
    headerValueLine.match(/^\S+\s+.+?\s+([A-Za-z][A-Za-z.'-]*)\s+(?:Due on receipt|Net\s+\d+|COD)\b/i)?.[1] || "";
  const poNumber =
    headerValueLine.match(/\s([A-Z0-9-]{3,})\s+(?:Due on receipt|Net\s+\d+|COD)\b/i)?.[1] === parsedTechnicianName
      ? ""
      : headerValueLine.match(/\s([A-Z0-9-]{3,})\s+(?:Due on receipt|Net\s+\d+|COD)\b/i)?.[1] || "";

  return {
    invoiceNum,
    invoiceDate: Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate,
    vendorName: compact.match(/Alpha Water Systems,\s*Inc\.?/i)?.[0] || "Alpha Water Systems, Inc.",
    poNumber,
    parsedTechnicianName,
    subtotal: subtotal ? subtotal.toFixed(2) : "",
    tax: tax ? tax.toFixed(2) : "",
    total: total ? total.toFixed(2) : "",
    rawText: normalized,
    lines,
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

const AlphaWaterReceiptImport = () => {
  const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [databaseItems, setDatabaseItems] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [selectedTechId, setSelectedTechId] = useState("");
  const [sourceFile, setSourceFile] = useState(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseFeedback, setParseFeedback] = useState({
    type: "idle",
    title: "Upload a PDF, email file, or paste invoice text.",
    details: [],
  });
  const [receipt, setReceipt] = useState(blankParsedReceipt);
  const [lines, setLines] = useState([]);
  const [createItemModalOpen, setCreateItemModalOpen] = useState(false);
  const [creatingDatabaseItem, setCreatingDatabaseItem] = useState(false);
  const [databaseItemForm, setDatabaseItemForm] = useState(blankDatabaseItemForm);
  const [sourceInputKey, setSourceInputKey] = useState(0);

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) || null;
  const selectedTech = companyUsers.find((user) => user.userId === selectedTechId || user.id === selectedTechId) || null;
  const sourceFileName = sourceFile?.name || "";
  const sourceFileType = sourceFile?.type || "";
  const sourceIsPdf = Boolean(sourceFile) && (sourceFileType === "application/pdf" || sourceFileName.toLowerCase().endsWith(".pdf"));
  const sourceIsImage = Boolean(sourceFile) && (sourceFileType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(sourceFileName));
  const sourceIsText = Boolean(sourceFile) && !sourceIsPdf && !sourceIsImage;
  const feedbackClass =
    parseFeedback.type === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : parseFeedback.type === "error"
        ? "border-red-200 bg-red-50 text-red-900"
        : parseFeedback.type === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-blue-200 bg-blue-50 text-blue-900";

  useEffect(() => {
    const loadSelectors = async () => {
      if (!recentlySelectedCompany) return;

      setLoading(true);
      try {
        const [vendorList, usersSnap, databaseSnap] = await Promise.all([
          fetchCompanyVendors(db, recentlySelectedCompany),
          getDocs(query(collection(db, "companies", recentlySelectedCompany, "companyUsers"))),
          getDocs(query(collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"), orderBy("name"))),
        ]);

        const users = usersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        const items = databaseSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        const alphaVendor =
          vendorList.find((vendor) => normalizeKey(vendor.name).includes("alphawatersystems")) ||
          vendorList.find((vendor) => normalizeKey(vendor.name).includes("alpha")) ||
          vendorList[0] ||
          null;
        const defaultTech = findMatchingCompanyUser(DEFAULT_PURCHASE_TECH_NAME, users);

        setVendors(vendorList);
        setCompanyUsers(users);
        setDatabaseItems(items);
        setSelectedVendorId(alphaVendor?.id || "");
        setSelectedTechId((currentTechId) => currentTechId || getCompanyUserId(defaultTech));
      } catch (error) {
        console.error("Error loading receipt import selectors:", error);
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

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
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

  const buildParseFeedback = (parsed, sourceLabel, extractedText = "") => {
    const details = [];
    const lineCount = parsed.lines?.length || 0;

    details.push(parsed.invoiceNum ? `Invoice number: ${parsed.invoiceNum}` : "Invoice number was not found.");
    details.push(parsed.invoiceDate ? `Invoice date: ${parsed.invoiceDate.toLocaleDateString()}` : "Invoice date was not found.");
    details.push(`${lineCount} line item${lineCount === 1 ? "" : "s"} found.`);
    if (parsed.subtotal || parsed.tax || parsed.total) {
      details.push(
        `Totals: subtotal ${parsed.subtotal ? money(parsed.subtotal) : "missing"}, tax ${parsed.tax ? money(parsed.tax) : "missing"
        }, total ${parsed.total ? money(parsed.total) : "missing"}`
      );
    } else {
      details.push("Subtotal, tax, and total were not found.");
    }
    if (sourceLabel === "PDF" && !String(extractedText || "").trim()) {
      details.push("The PDF did not return selectable text. It may be image-only/scanned.");
    }

    return {
      type: lineCount && parsed.invoiceNum ? "success" : lineCount ? "warning" : "error",
      title: lineCount
        ? `Parsed ${sourceLabel} invoice. Review before saving.`
        : `Could not find line items in the ${sourceLabel}.`,
      details,
    };
  };

  const applyParsedReceipt = (parsed, sourceLabel = "text", extractedText = "") => {
    const parsedTechMatch = findMatchingCompanyUser(parsed.parsedTechnicianName, companyUsers);
    const parsedTechName = String(parsed.parsedTechnicianName || "").trim();
    let parsedNotes = "";
    parsedNotes = appendNote(parsedNotes, parsed.poNumber ? `Alpha Water PO #: ${parsed.poNumber}` : "");
    parsedNotes = appendNote(
      parsedNotes,
      parsedTechName && !parsedTechMatch ? `PO#: ${parsedTechName}` : ""
    );
    const hydratedLines = (parsed.lines || []).map((line) => {
      const match = findMatchingItem(line, databaseItems);
      return {
        ...line,
        matchedItemId: match?.id || "",
        createDatabaseItem: !match,
        billable: Boolean(match?.billable),
        billingRate: match?.billingRate ? String(Number(match.billingRate) / 100) : "",
        category: match?.category || line.category,
      };
    });

    setReceipt({
      invoiceNum: parsed.invoiceNum || "",
      invoiceDate: parsed.invoiceDate ? parsed.invoiceDate.toISOString().slice(0, 10) : "",
      vendorName: parsed.vendorName || "Alpha Water Systems, Inc.",
      notes: parsedNotes,
      subtotal: parsed.subtotal || "",
      tax: parsed.tax || "",
      total: parsed.total || "",
      rawText: parsed.rawText || "",
    });
    const defaultTech = findMatchingCompanyUser(DEFAULT_PURCHASE_TECH_NAME, companyUsers);
    setSelectedTechId(getCompanyUserId(parsedTechMatch) || getCompanyUserId(defaultTech));
    setLines(hydratedLines);
    setParseFeedback(buildParseFeedback({ ...parsed, lines: hydratedLines }, sourceLabel, extractedText));
  };

  const handleRawTextChange = (value) => {
    setReceipt((prev) => ({ ...prev, rawText: value }));
  };

  const handleParse = () => {
    const parsed = parseAlphaWaterInvoiceText(receipt.rawText);
    applyParsedReceipt(parsed, "pasted text", receipt.rawText);
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSourceFile(file);
    setParsing(true);
    setParseFeedback({
      type: "info",
      title: `Reading ${file.name}...`,
      details: ["Extracting invoice text and looking for Alpha Water line items."],
    });

    try {
      let text = "";
      let sourceLabel = "file";

      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        sourceLabel = "PDF";
        text = await extractTextFromPdfFile(file);
      } else {
        sourceLabel = file.name.toLowerCase().endsWith(".eml") ? "email" : "text file";
        text = await file.text();
      }

      const parsed = parseAlphaWaterInvoiceText(text);
      applyParsedReceipt(parsed, sourceLabel, text);
      if (parsed.lines?.length) {
        toast.success(`Found ${parsed.lines.length} line item${parsed.lines.length === 1 ? "" : "s"}`);
      } else {
        toast.error("No line items found");
      }
    } catch (error) {
      console.error("Error parsing Alpha Water upload:", error);
      setParseFeedback({
        type: "error",
        title: "Could not read this upload.",
        details: [
          error?.message || "The file could not be parsed.",
          "Try the original Alpha Water email/PDF, or paste the invoice text below and parse again.",
        ],
      });
      toast.error("Could not parse upload");
    } finally {
      setParsing(false);
    }
  };

  const updateLine = (lineId, updates) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const nextLine = { ...line, ...updates };
        if (updates.matchedItemId !== undefined) {
          const match = databaseItems.find((item) => item.id === updates.matchedItemId);
          nextLine.createDatabaseItem = !match;
          nextLine.billable = Boolean(match?.billable);
          nextLine.billingRate = match?.billingRate ? String(Number(match.billingRate) / 100) : nextLine.billingRate;
          nextLine.category = match?.category || nextLine.category;
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
        lotSerial: "",
        unitPrice: "",
        amount: "",
        taxable: true,
        billable: false,
        billingRate: "",
        category: "Misc",
        matchedItemId: "",
        createDatabaseItem: true,
      },
    ]);
  };

  const openCreateItemModal = (line) => {
    setDatabaseItemForm({
      lineId: line.id,
      name: line.name || line.sku || "Alpha Water Item",
      description: line.description || line.name || "",
      sku: line.sku || "",
      uom: normalizedDatabaseUom(line.uom),
      category: line.category || inferCategory(`${line.sku} ${line.name}`),
      subCategory: "Misc",
      size: "",
      color: "",
      rate: line.unitPrice || "",
      billable: Boolean(line.billable),
      billingRate: line.billingRate || line.unitPrice || "",
    });
    setCreateItemModalOpen(true);
  };

  const closeCreateItemModal = () => {
    if (creatingDatabaseItem) return;
    setCreateItemModalOpen(false);
    setDatabaseItemForm(blankDatabaseItemForm);
  };

  const resetCreateItemModal = () => {
    setCreateItemModalOpen(false);
    setDatabaseItemForm(blankDatabaseItemForm);
  };

  const updateDatabaseItemForm = (updates) => {
    setDatabaseItemForm((prev) => ({ ...prev, ...updates }));
  };

  const createDatabaseItemFromModal = async () => {
    if (!databaseItemForm.name.trim()) {
      toast.error("Item name is required.");
      return;
    }
    if (!recentlySelectedCompany) {
      toast.error("Select a company before creating an item.");
      return;
    }

    setCreatingDatabaseItem(true);
    try {
      const itemId = "com_sett_db_" + uuidv4();
      const item = {
        UOM: normalizedDatabaseUom(databaseItemForm.uom),
        id: itemId,
        billable: Boolean(databaseItemForm.billable),
        category: databaseItemForm.category || "Misc",
        color: databaseItemForm.color || "",
        dateUpdated: new Date(),
        description: databaseItemForm.description || databaseItemForm.name,
        name: databaseItemForm.name.trim(),
        rate: centsFromDollars(databaseItemForm.rate),
        size: databaseItemForm.size || "",
        sku: databaseItemForm.sku || "",
        storeName: selectedVendor?.name || "",
        subCategory: databaseItemForm.subCategory || "Misc",
        timesPurchased: 0,
        venderId: selectedVendor?.id || "",
        vendorId: selectedVendor?.id || "",
        billingRate: centsFromDollars(databaseItemForm.billingRate || databaseItemForm.rate),
        sellPrice: centsFromDollars(databaseItemForm.billingRate || databaseItemForm.rate),
        tracking: "",
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", itemId), item);

      setDatabaseItems((prev) => [...prev, item].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))));
      updateLine(databaseItemForm.lineId, {
        matchedItemId: itemId,
        createDatabaseItem: false,
        billable: item.billable,
        billingRate: item.billingRate ? String(Number(item.billingRate) / 100) : "",
        category: item.category,
      });
      toast.success("Database item created");
      resetCreateItemModal();
    } catch (error) {
      console.error("Error creating database item from receipt import:", error);
      toast.error("Could not create database item");
    } finally {
      setCreatingDatabaseItem(false);
    }
  };

  const resetImportForm = () => {
    setSourceFile(null);
    setSourceInputKey((current) => current + 1);
    setReceipt(blankParsedReceipt);
    setLines([]);
    setParseFeedback({
      type: "idle",
      title: "Upload a PDF, email file, or paste invoice text.",
      details: [],
    });
    setCreateItemModalOpen(false);
    setDatabaseItemForm(blankDatabaseItemForm);
  };

  const saveReceipt = async ({ addAnother = false } = {}) => {
    if (recentlySelectedCompany !== MURDOCK_COMPANY_ID) {
      toast.error("This importer is only enabled for Murdock Pool Service.");
      return;
    }
    if (!receipt.invoiceNum.trim()) return toast.error("Invoice number is required.");
    if (!selectedVendor) return toast.error("Select a vendor before saving.");
    if (!lines.length) return toast.error("Add at least one line item.");

    const confirmed = window.confirm(`Create receipt ${receipt.invoiceNum} with ${lines.length} line item(s)?`);
    if (!confirmed) return;

    setSaving(true);
    try {
      const receiptId = "com_rec_" + uuidv4();
      const receiptDate = receipt.invoiceDate ? new Date(`${receipt.invoiceDate}T12:00:00`) : new Date();
      const purchasedItemIds = [];
      const pdfUrlList = [];

      if (sourceFile) {
        const fileRef = ref(
          storage,
          `companies/${recentlySelectedCompany}/receipts/${receiptId}/${Date.now()}-${sourceFile.name}`
        );
        await uploadBytes(fileRef, sourceFile);
        pdfUrlList.push(await getDownloadURL(fileRef));
      }

      for (const line of lines) {
        let databaseItem = databaseItems.find((item) => item.id === line.matchedItemId) || null;
        let itemId = databaseItem?.id || "";

        if (!databaseItem && line.createDatabaseItem) {
          itemId = "com_sett_db_" + uuidv4();
          databaseItem = {
            UOM: normalizedDatabaseUom(line.uom),
            id: itemId,
            billable: Boolean(line.billable),
            category: line.category || inferCategory(line.name),
            color: "",
            dateUpdated: new Date(),
            description: line.description || line.name || "",
            name: line.name || line.sku || "Alpha Water Item",
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

          await setDoc(
            doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", itemId),
            databaseItem
          );
        }

        const purchaseId = "comp_pi_" + uuidv4();
        purchasedItemIds.push(purchaseId);

        await setDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchaseId), {
          id: purchaseId,
          receiptId,
          invoiceNum: receipt.invoiceNum.trim(),
          venderId: selectedVendor.id || "",
          venderName: selectedVendor.name || "",
          vendorId: selectedVendor.id || "",
          vendorName: selectedVendor.name || "",
          techId: selectedTech?.userId || selectedTech?.id || "",
          techName: getCompanyUserDisplayName(selectedTech),
          itemId,
          name: databaseItem?.name || line.name || line.sku || "Purchased Item",
          category: databaseItem?.category || line.category || inferCategory(`${line.sku} ${line.name}`),
          subCategory: databaseItem?.subCategory || "Misc",
          price: centsFromDollars(line.unitPrice),
          quantityString: String(line.quantity || "1"),
          date: receiptDate,
          billable: Boolean(line.billable),
          invoiced: false,
          returned: false,
          customerId: "",
          customerName: "",
          sku: databaseItem?.sku || line.sku || "",
          lotSerial: line.lotSerial || "",
          notes: [
            `Imported from Alpha Water invoice ${receipt.invoiceNum}`,
            receipt.notes || "",
            line.lotSerial ? `Lot/Serial: ${line.lotSerial}` : "",
          ]
            .filter(Boolean)
            .join(" | "),
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
          source: "alphaWaterEmailImport",
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
        techId: selectedTech?.userId || selectedTech?.id || "",
        purchasedItemIds,
        numberOfItems: purchasedItemIds.length,
        cost: centsFromDollars(saveSubtotal),
        costAfterTax: centsFromDollars(saveTotal),
        tax: centsFromDollars(saveTax),
        notes: receipt.notes || "",
        pdfUrlList,
        source: "alphaWaterEmailImport",
        rawVendorName: receipt.vendorName || "",
      });

      if (addAnother) {
        toast.success("Receipt created. Ready for the next one.");
        resetImportForm();
      } else {
        toast.success("Receipt created");
        navigate(`/company/receipts/detail/${receiptId}`);
      }
    } catch (error) {
      console.error("Error saving Alpha Water receipt:", error);
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
            <h1 className="text-3xl font-bold text-gray-900">Alpha Water Receipt Import</h1>
            <p className="mt-1 text-sm text-gray-500">Review parsed invoice fields before creating the receipt.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/company/purchased-items")}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Back to Purchases
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)_340px] 2xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">Source</h2>
              <div className="mt-4 space-y-3">
                <input
                  key={sourceInputKey}
                  type="file"
                  accept=".txt,.eml,.pdf,.png,.jpg,.jpeg,.webp,text/plain,message/rfc822,application/pdf,image/*"
                  onChange={handleFileChange}
                  disabled={parsing}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {sourceFile ? <p className="text-sm text-gray-500">{sourceFile.name}</p> : null}
                <div className={`rounded-lg border p-3 text-sm ${feedbackClass}`}>
                  <p className="font-semibold">{parsing ? "Working..." : parseFeedback.title}</p>
                  {parseFeedback.details?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {parseFeedback.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <textarea
                  rows={14}
                  value={receipt.rawText}
                  onChange={(event) => handleRawTextChange(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 p-3 text-sm"
                  placeholder="Upload a PDF to auto-fill this, or paste Alpha Water invoice email text here"
                />
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={parsing || !receipt.rawText.trim()}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {parsing ? "Parsing..." : "Parse Invoice Text"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">Receipt Fields</h2>
              <div className="mt-4 grid gap-3">
                <label className="text-sm font-semibold text-gray-700">
                  Invoice #
                  <input
                    value={receipt.invoiceNum}
                    onChange={(event) => setReceipt((prev) => ({ ...prev, invoiceNum: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                  />
                </label>
                <label className="text-sm font-semibold text-gray-700">
                  Date
                  <input
                    type="date"
                    value={receipt.invoiceDate}
                    onChange={(event) => setReceipt((prev) => ({ ...prev, invoiceDate: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                  />
                </label>
                <label className="text-sm font-semibold text-gray-700">
                  Vendor
                  <select
                    value={selectedVendorId}
                    onChange={(event) => setSelectedVendorId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                  >
                    <option value="">Select vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-gray-700">
                  Technician
                  <select
                    value={selectedTechId}
                    onChange={(event) => setSelectedTechId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                  >
                    <option value="">No technician</option>
                    {companyUsers.map((user) => (
                      <option key={user.userId || user.id} value={user.userId || user.id}>
                        {getCompanyUserDisplayName(user) || "Technician"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-gray-700">
                  Notes
                  <textarea
                    rows={4}
                    value={receipt.notes}
                    onChange={(event) => setReceipt((prev) => ({ ...prev, notes: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                    placeholder="Receipt notes"
                  />
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <label className="text-sm font-semibold text-gray-700">
                    Subtotal
                    <input
                      value={receipt.subtotal}
                      onChange={(event) => setReceipt((prev) => ({ ...prev, subtotal: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold text-gray-700">
                    Tax
                    <input
                      value={receipt.tax}
                      onChange={(event) => setReceipt((prev) => ({ ...prev, tax: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold text-gray-700">
                    Total
                    <input
                      value={receipt.total}
                      onChange={(event) => setReceipt((prev) => ({ ...prev, total: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
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
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Add Line Item
                </button>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-[1320px] w-full border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-2 py-1">SKU</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">UOM</th>
                    <th className="px-2 py-1">Lot/Serial</th>
                    <th className="px-2 py-1">Unit</th>
                    <th className="px-2 py-1">Amount</th>
                    <th className="px-2 py-1">Tax</th>
                    <th className="px-2 py-1">Database Item</th>
                    <th className="px-2 py-1">Category</th>
                    <th className="px-2 py-1">Billable</th>
                    <th className="px-2 py-1">Billing Rate</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="rounded-lg bg-gray-50 text-sm">
                      <td className="px-2 py-2">
                        <input
                          value={line.sku}
                          onChange={(event) => updateLine(line.id, { sku: event.target.value })}
                          className="w-32 rounded-lg border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={line.name}
                          onChange={(event) => updateLine(line.id, { name: event.target.value, description: event.target.value })}
                          className="w-64 rounded-lg border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={line.quantity}
                          onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                          className="w-20 rounded-lg border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={line.uom}
                          onChange={(event) => updateLine(line.id, { uom: event.target.value })}
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1"
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
                          value={line.lotSerial || ""}
                          onChange={(event) => updateLine(line.id, { lotSerial: event.target.value })}
                          className="w-28 rounded-lg border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={line.unitPrice}
                          onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={line.amount}
                          onChange={(event) => updateLine(line.id, { amount: event.target.value })}
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={Boolean(line.taxable)}
                          onChange={(event) => updateLine(line.id, { taxable: event.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={line.matchedItemId}
                          onChange={(event) => updateLine(line.id, { matchedItemId: event.target.value })}
                          className="w-56 rounded-lg border border-gray-300 px-2 py-1"
                        >
                          <option value="">Create new item</option>
                          {databaseItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} {item.sku ? `- ${item.sku}` : ""}
                            </option>
                          ))}
                        </select>
                        <label className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={line.createDatabaseItem}
                            disabled={Boolean(line.matchedItemId)}
                            onChange={(event) => updateLine(line.id, { createDatabaseItem: event.target.checked })}
                          />
                          New database item
                        </label>
                        <button
                          type="button"
                          onClick={() => openCreateItemModal(line)}
                          className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          Create New Item
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={line.category}
                          onChange={(event) => updateLine(line.id, { category: event.target.value })}
                          className="w-32 rounded-lg border border-gray-300 px-2 py-1"
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
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!lines.length ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
                  No line items parsed yet.
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col justify-end gap-3 sm:flex-row">
              <button
                type="button"
                disabled={loading || saving || !lines.length}
                onClick={() => saveReceipt({ addAnother: true })}
                className="rounded-xl border border-green-200 bg-white px-5 py-2 text-sm font-semibold text-green-700 shadow-sm hover:bg-green-50 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save and Add Another"}
              </button>
              <button
                type="button"
                disabled={loading || saving || !lines.length}
                onClick={() => saveReceipt()}
                className="rounded-xl bg-green-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Confirmed Receipt"}
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm xl:sticky xl:top-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Preview</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {sourceFileName || receipt.invoiceNum || "No source selected"}
                  </p>
                </div>
                {sourcePreviewUrl ? (
                  <a
                    href={sourcePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                  >
                    Open
                  </a>
                ) : null}
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {sourcePreviewUrl && sourceIsPdf ? (
                  <iframe
                    title="Alpha Water receipt preview"
                    src={sourcePreviewUrl}
                    className="h-[720px] w-full bg-white"
                  />
                ) : null}

                {sourcePreviewUrl && sourceIsImage ? (
                  <img
                    src={sourcePreviewUrl}
                    alt="Alpha Water receipt preview"
                    className="max-h-[720px] w-full object-contain bg-white"
                  />
                ) : null}

                {sourcePreviewUrl && sourceIsText ? (
                  <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap p-4 text-xs text-gray-700">
                    {receipt.rawText || "Text source loaded. Parse the invoice to populate this preview."}
                  </pre>
                ) : null}

                {!sourcePreviewUrl && receipt.rawText.trim() ? (
                  <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap p-4 text-xs text-gray-700">
                    {receipt.rawText}
                  </pre>
                ) : null}

                {!sourcePreviewUrl && !receipt.rawText.trim() ? (
                  <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-gray-500">
                    Upload a PDF or receipt image to preview it here. Pasted invoice text will appear after parsing.
                  </div>
                ) : null}
              </div>

              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="font-semibold text-gray-500">Invoice</p>
                    <p className="mt-1 font-bold text-gray-900">{receipt.invoiceNum || "--"}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-500">Date</p>
                    <p className="mt-1 font-bold text-gray-900">{receipt.invoiceDate || "--"}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-500">Subtotal</p>
                    <p className="mt-1 font-bold text-gray-900">{money(receipt.subtotal || lineTotals.subtotal)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-500">Total</p>
                    <p className="mt-1 font-bold text-gray-900">{money(receipt.total || lineTotals.total)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {createItemModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">Create New Item</h2>
              <p className="mt-1 text-sm text-gray-500">Review the parsed line item before adding it to the database.</p>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">
                Item Name
                <input
                  value={databaseItemForm.name}
                  onChange={(event) => updateDatabaseItemForm({ name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">
                Description
                <textarea
                  rows={3}
                  value={databaseItemForm.description}
                  onChange={(event) => updateDatabaseItemForm({ description: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                SKU
                <input
                  value={databaseItemForm.sku}
                  onChange={(event) => updateDatabaseItemForm({ sku: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                UOM
                <select
                  value={databaseItemForm.uom}
                  onChange={(event) => updateDatabaseItemForm({ uom: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                >
                  {uomOptions.map((uom) => (
                    <option key={uom} value={uom}>
                      {uom}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Category
                <select
                  value={databaseItemForm.category}
                  onChange={(event) => updateDatabaseItemForm({ category: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                >
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Subcategory
                <input
                  value={databaseItemForm.subCategory}
                  onChange={(event) => updateDatabaseItemForm({ subCategory: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Cost
                <input
                  value={databaseItemForm.rate}
                  onChange={(event) => updateDatabaseItemForm({ rate: event.target.value.replace(/[^\d.]/g, "") })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Billing Rate
                <input
                  value={databaseItemForm.billingRate}
                  onChange={(event) => updateDatabaseItemForm({ billingRate: event.target.value.replace(/[^\d.]/g, "") })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Size
                <input
                  value={databaseItemForm.size}
                  onChange={(event) => updateDatabaseItemForm({ size: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                Color
                <input
                  value={databaseItemForm.color}
                  onChange={(event) => updateDatabaseItemForm({ color: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={databaseItemForm.billable}
                  onChange={(event) => updateDatabaseItemForm({ billable: event.target.checked })}
                />
                Billable
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeCreateItemModal}
                disabled={creatingDatabaseItem}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createDatabaseItemFromModal}
                disabled={creatingDatabaseItem}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {creatingDatabaseItem ? "Creating..." : "Create New Item"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AlphaWaterReceiptImport;
