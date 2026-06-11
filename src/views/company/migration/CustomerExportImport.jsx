import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  CUSTOMER_EXPORT_EXPECTED_COLUMNS,
  applyImportMetadata,
  cleanString,
  compareCustomerExportRecords,
  findCustomerExportCustomerIdCollisions,
  mergeTags,
  normalizeText,
  parseCustomerExportRows,
  summarizeCustomerExportComparison,
  summarizeCustomerExportRecords,
} from "./customerExportImportUtils";

const MAX_WRITES_PER_BATCH = 450;

const createImportBatchId = () => `customer_export_${Date.now().toString(36)}`;

const commitBatch = async (batchState) => {
  if (batchState.writeCount === 0) return;
  await batchState.batch.commit();
  batchState.batch = writeBatch(db);
  batchState.writeCount = 0;
};

const deleteRefsInChunks = async (refs = [], onProgress = () => {}) => {
  let deletedCount = 0;

  for (let index = 0; index < refs.length; index += MAX_WRITES_PER_BATCH) {
    const batch = writeBatch(db);
    const chunk = refs.slice(index, index + MAX_WRITES_PER_BATCH);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deletedCount += chunk.length;
    onProgress(deletedCount, refs.length);
  }

  return deletedCount;
};

const statusToneClasses = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  blue: "bg-blue-100 text-blue-700",
  slate: "bg-slate-100 text-slate-600",
};

const importModeStatusSets = {
  missing: ["missing", "imported"],
  migrationRefresh: ["missing", "imported"],
};

const importModeLabels = {
  missing: "Missing + imported refresh",
  migrationRefresh: "Missing + prior migration refresh",
  all: "All parsed rows",
};

const likelyExistingMigrationStatuses = new Set(["imported", "matched", "review"]);

const watchedCustomerSearches = [
  { label: "Alan Silverstein", terms: ["alansilverstein"] },
  { label: "Alex Pidilla", terms: ["alexpidilla", "alexpadilla"] },
  { label: "Charlie Idler", terms: ["charlieidler", "idler"] },
  { label: "Cliff Steagall", terms: ["cliffsteagall", "cliff"] },
  { label: "Colleen Kleege", terms: ["colleenkleege", "coleenkleege"] },
  { label: "Constance Martin", terms: ["constancemartin"] },
  { label: "Eric Oftinoski", terms: ["ericoftinoski", "ericotfinoski"] },
  { label: "Eric Rodriguez", terms: ["ericrodriguez"] },
  { label: "Erinn McCormick", terms: ["erinnmccormick", "erinmccormick"] },
  { label: "Greg Welker", terms: ["gregwelker"] },
  { label: "Herb Barrack", terms: ["herbbarrack"] },
  { label: "Laurie Boggers", terms: ["laurieboggers"] },
  { label: "Lydia Gutierrez", terms: ["lydiagutierrez"] },
  { label: "Manny", terms: ["manny"] },
  { label: "Mavis Nees", terms: ["mavisnees"] },
  { label: "Pat Senas", terms: ["patsenas"] },
  { label: "Patti and Lyle Lee", terms: ["pattiandlylelee", "pattilylelee"] },
  { label: "Ruth French", terms: ["ruthfrench"] },
  { label: "Steve McClure", terms: ["stevemcclure"] },
  { label: "Tina Bernal", terms: ["tinabernal", "tinebernal"] },
];

const recordIsSelectedForImportMode = (record, importMode) => {
  if (importMode === "all") return true;
  const statuses = importModeStatusSets[importMode] || importModeStatusSets.migrationRefresh;
  return statuses.includes(record.migrationCheck?.status || "missing");
};

const compactDiagnosticDoc = (docData = {}) => ({
  id: docData.id || "",
  firstName: docData.firstName || "",
  lastName: docData.lastName || "",
  company: docData.company || "",
  customerName: docData.customerName || "",
  email: docData.email || "",
  phoneNumber: docData.phoneNumber || "",
  type: docData.type || "",
  name: docData.name || "",
  bodyOfWaterId: docData.bodyOfWaterId || "",
  serviceLocationId: docData.serviceLocationId || "",
  customerId: docData.customerId || "",
  migrationSource: docData.migrationSource || null,
});

const sourceTextForRecord = (record) =>
  normalizeText([
    record.customerName,
    record.customer.firstName,
    record.customer.lastName,
    record.customer.email,
    record.customer.phoneNumber,
    record.serviceLocationLabel,
    record.customer.company,
    record.customer.migrationSource?.sourceCustomerKey,
    record.customer.migrationSource?.sourceLocationKey,
  ].join(" "));

const uniqueCleanStrings = (values = []) => {
  const seen = new Set();

  return values
    .flat()
    .map(cleanString)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const getRecordImportDecision = (record, importMode, manualSkippedRecordIdSet) => {
  const selectedByMode = recordIsSelectedForImportMode(record, importMode);
  const manuallySkipped = manualSkippedRecordIdSet.has(record.id);

  if (selectedByMode && !manuallySkipped) return "willImport";
  if (manuallySkipped) return "skipped";
  return "notSelected";
};

const buildPreviewCustomerGroups = (records = [], importMode, manualSkippedRecordIdSet) => {
  const groupsByCustomerId = new Map();

  records.forEach((record) => {
    const customerId = record.customer?.id || record.id;
    if (!groupsByCustomerId.has(customerId)) {
      groupsByCustomerId.set(customerId, {
        customerId,
        customerName: record.customerName || "Unnamed customer",
        records: [],
      });
    }

    groupsByCustomerId.get(customerId).records.push(record);
  });

  return Array.from(groupsByCustomerId.values()).map((group) => {
    const decisionCounts = { willImport: 0, skipped: 0, notSelected: 0 };
    const statusCounts = { missing: 0, review: 0, matched: 0, imported: 0 };

    group.records.forEach((record) => {
      const decision = getRecordImportDecision(record, importMode, manualSkippedRecordIdSet);
      const status = record.migrationCheck?.status || "missing";

      decisionCounts[decision] = (decisionCounts[decision] || 0) + 1;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    return {
      ...group,
      rowNumbers: group.records.map((record) => record.rowNumber).filter(Boolean),
      locationLabels: uniqueCleanStrings(group.records.map((record) => record.serviceLocationLabel)),
      sourcePhones: uniqueCleanStrings(group.records.map((record) => record.sourcePhones || [])),
      sourceEmails: uniqueCleanStrings(group.records.map((record) => record.sourceEmails || [])),
      rowCount: group.records.length,
      locationCount: group.records.length,
      equipmentCount: group.records.reduce((count, record) => count + (record.equipment?.length || 0), 0),
      equipmentPartsCount: group.records.reduce((count, record) => count + (record.equipmentParts?.length || 0), 0),
      activeLocationCount: group.records.filter((record) => record.active).length,
      inactiveLocationCount: group.records.filter((record) => !record.active).length,
      decisionCounts,
      statusCounts,
    };
  });
};

const buildDiagnosticRecord = ({
  record,
  importMode,
  customerById,
  serviceLocationById,
  bodyOfWaterById,
  equipmentById,
  existingCustomers,
}) => {
  const expectedCustomer = customerById.get(record.customer.id) || null;
  const expectedServiceLocation = serviceLocationById.get(record.serviceLocation.id) || null;
  const expectedBodyOfWater = bodyOfWaterById.get(record.bodyOfWater.id) || null;
  const expectedEquipment = (record.equipment || []).map((equipment) => equipmentById.get(equipment.id) || null);
  const recordNameKey = normalizeText(record.customerName);
  const possibleCustomerMatches = existingCustomers
    .filter((customer) => {
      const customerNameKey = normalizeText([customer.firstName, customer.lastName, customer.company, customer.customerName].filter(Boolean).join(" "));
      const emailMatch = record.sourceEmails.some((email) => normalizeText(email) && normalizeText(email) === normalizeText(customer.email));
      const phoneMatch = record.sourcePhones.some((phone) => normalizeText(phone) && normalizeText(phone) === normalizeText(customer.phoneNumber));
      return (
        customerNameKey === recordNameKey ||
        customer.id === record.customer.id ||
        customer.migrationSource?.sourceCustomerKey === record.customer.migrationSource?.sourceCustomerKey ||
        emailMatch ||
        phoneMatch
      );
    })
    .slice(0, 5)
    .map(compactDiagnosticDoc);

  return {
    rowNumber: record.rowNumber,
    customerName: record.customerName,
    serviceLocationLabel: record.serviceLocationLabel,
    expectedIds: {
      customerId: record.customer.id,
      serviceLocationId: record.serviceLocation.id,
      bodyOfWaterId: record.bodyOfWater.id,
    },
    existsByExpectedId: {
      customer: Boolean(expectedCustomer),
      serviceLocation: Boolean(expectedServiceLocation),
      bodyOfWater: Boolean(expectedBodyOfWater),
      equipment: expectedEquipment.filter(Boolean).length,
    },
    importModeSelected: recordIsSelectedForImportMode(record, importMode),
    migrationCheck: record.migrationCheck || null,
    expectedDocs: {
      customer: expectedCustomer ? compactDiagnosticDoc(expectedCustomer) : null,
      serviceLocation: expectedServiceLocation ? compactDiagnosticDoc(expectedServiceLocation) : null,
      bodyOfWater: expectedBodyOfWater ? compactDiagnosticDoc(expectedBodyOfWater) : null,
      equipment: expectedEquipment.map((equipment) => equipment ? compactDiagnosticDoc(equipment) : null),
    },
    possibleCustomerMatches,
    source: {
      firstName: record.customer.firstName,
      lastName: record.customer.lastName,
      email: record.customer.email,
      phoneNumber: record.customer.phoneNumber,
      sourceEmails: record.sourceEmails,
      sourcePhones: record.sourcePhones,
      active: record.active,
      migrationSource: record.customer.migrationSource,
    },
  };
};

function CustomerExportImport() {
  const { recentlySelectedCompany } = useContext(Context);
  const [records, setRecords] = useState([]);
  const [parseIssues, setParseIssues] = useState([]);
  const [skippedRows, setSkippedRows] = useState([]);
  const [manualSkippedRecordIds, setManualSkippedRecordIds] = useState([]);
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [importTags, setImportTags] = useState(["Imported Customer Export"]);
  const [importMode, setImportMode] = useState("migrationRefresh");
  const [previewSearch, setPreviewSearch] = useState("");
  const [expandedPreviewCustomerIds, setExpandedPreviewCustomerIds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [deletingMigration, setDeletingMigration] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const [diagnosticText, setDiagnosticText] = useState("");
  const [existingData, setExistingData] = useState({
    loading: false,
    customers: [],
    serviceLocations: [],
    bodiesOfWater: [],
    equipment: [],
    error: "",
  });

  const loadExistingCompanyData = useCallback(async () => {
    if (!recentlySelectedCompany) {
      const emptyData = { loading: false, customers: [], serviceLocations: [], bodiesOfWater: [], equipment: [], error: "" };
      setExistingData(emptyData);
      return emptyData;
    }

    setExistingData((current) => ({ ...current, loading: true, error: "" }));

    try {
      const [customerSnapshot, serviceLocationSnapshot, bodyOfWaterSnapshot, equipmentSnapshot] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "serviceLocations")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "bodiesOfWater")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "equipment")),
      ]);

      const nextData = {
        loading: false,
        customers: customerSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        serviceLocations: serviceLocationSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        bodiesOfWater: bodyOfWaterSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        equipment: equipmentSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        error: "",
      };

      setExistingData(nextData);
      return nextData;
    } catch (error) {
      console.error("Failed to load existing migration comparison data:", error);
      const errorData = {
        loading: false,
        customers: [],
        serviceLocations: [],
        bodiesOfWater: [],
        equipment: [],
        error: "Could not load existing customers, service locations, pools, and equipment for comparison.",
      };

      setExistingData(errorData);
      return errorData;
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadExistingCompanyData();
  }, [loadExistingCompanyData]);

  const summary = useMemo(() => summarizeCustomerExportRecords(records), [records]);
  const customerIdCollisions = useMemo(() => findCustomerExportCustomerIdCollisions(records), [records]);
  const comparedRecords = useMemo(
    () => compareCustomerExportRecords(records, existingData.customers, existingData.serviceLocations),
    [existingData.customers, existingData.serviceLocations, records]
  );
  const comparisonSummary = useMemo(() => summarizeCustomerExportComparison(comparedRecords), [comparedRecords]);
  const manualSkippedRecordIdSet = useMemo(() => new Set(manualSkippedRecordIds), [manualSkippedRecordIds]);
  const modeSelectedRecords = useMemo(
    () => comparedRecords.filter((record) => recordIsSelectedForImportMode(record, importMode)),
    [comparedRecords, importMode]
  );
  const importableRecords = useMemo(
    () => modeSelectedRecords.filter((record) => !manualSkippedRecordIdSet.has(record.id)),
    [manualSkippedRecordIdSet, modeSelectedRecords]
  );
  const manuallySkippedRecords = useMemo(
    () => comparedRecords.filter((record) => manualSkippedRecordIdSet.has(record.id)),
    [comparedRecords, manualSkippedRecordIdSet]
  );
  const manuallySkippedSelectedRecords = useMemo(
    () => modeSelectedRecords.filter((record) => manualSkippedRecordIdSet.has(record.id)),
    [manualSkippedRecordIdSet, modeSelectedRecords]
  );
  const manuallySkippedCustomerCount = useMemo(
    () => new Set(manuallySkippedRecords.map((record) => record.customer.id)).size,
    [manuallySkippedRecords]
  );
  const excludedImportRecords = useMemo(
    () => comparedRecords.filter((record) => !recordIsSelectedForImportMode(record, importMode)),
    [comparedRecords, importMode]
  );
  const importableSummary = useMemo(() => summarizeCustomerExportRecords(importableRecords), [importableRecords]);
  const importCustomerIdCollisions = useMemo(
    () => findCustomerExportCustomerIdCollisions(importableRecords),
    [importableRecords]
  );
  const filteredPreviewRecords = useMemo(() => {
    const searchKey = normalizeText(previewSearch);
    if (!searchKey) return comparedRecords;

    return comparedRecords.filter((record) =>
      [
        record.customerName,
        record.customer.firstName,
        record.customer.lastName,
        record.customer.email,
        record.customer.phoneNumber,
        record.serviceLocationLabel,
        record.migrationCheck?.label,
        record.migrationCheck?.reason,
      ]
        .map(normalizeText)
        .some((value) => value.includes(searchKey))
    );
  }, [comparedRecords, previewSearch]);
  const previewCustomerGroups = useMemo(
    () => buildPreviewCustomerGroups(filteredPreviewRecords, importMode, manualSkippedRecordIdSet),
    [filteredPreviewRecords, importMode, manualSkippedRecordIdSet]
  );
  const displayedPreviewCustomerGroups = useMemo(
    () => previewCustomerGroups.slice(0, 60),
    [previewCustomerGroups]
  );
  const expandedPreviewCustomerIdSet = useMemo(
    () => new Set(expandedPreviewCustomerIds),
    [expandedPreviewCustomerIds]
  );
  const excludedPreviewRecords = useMemo(() => excludedImportRecords.slice(0, 80), [excludedImportRecords]);
  const expectedColumns = CUSTOMER_EXPORT_EXPECTED_COLUMNS.join(", ");

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0];
    setLastImportSummary(null);

    if (!selectedFile) {
      setRecords([]);
      setParseIssues([]);
      setSkippedRows([]);
      setManualSkippedRecordIds([]);
      setExpandedPreviewCustomerIds([]);
      setDiagnosticText("");
      setFileName("");
      setSheetName("");
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target.result, { type: "binary" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        const parsed = parseCustomerExportRows(rows);

        setFileName(selectedFile.name);
        setSheetName(firstSheetName);
        setRecords(parsed.records);
        setParseIssues(parsed.issues);
        setSkippedRows(parsed.skippedRows || []);
        setManualSkippedRecordIds([]);
        setExpandedPreviewCustomerIds([]);
        setDiagnosticText("");

        if (parsed.records.length > 0) {
          toast.success(`Parsed ${parsed.records.length} customer location rows.`);
        } else {
          toast.error("No importable customer rows were found.");
        }
      } catch (error) {
        console.error("Failed to parse customer export workbook:", error);
        setRecords([]);
        setParseIssues(["The selected file could not be parsed as a customer export workbook."]);
        setSkippedRows([]);
        setManualSkippedRecordIds([]);
        setExpandedPreviewCustomerIds([]);
        setDiagnosticText("");
        toast.error("Could not parse this workbook.");
      }
    };

    reader.readAsBinaryString(selectedFile);
  };

  const addTag = () => {
    const nextTag = cleanString(tagInput);
    if (!nextTag) return;

    setImportTags((currentTags) => mergeTags(currentTags, [nextTag]));
    setTagInput("");
  };

  const removeTag = (tagToRemove) => {
    setImportTags((currentTags) => currentTags.filter((tag) => tag !== tagToRemove));
  };

  const setRecordManualSkip = useCallback((recordId, shouldSkip = true) => {
    if (!recordId) return;

    setManualSkippedRecordIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (shouldSkip) {
        nextIds.add(recordId);
      } else {
        nextIds.delete(recordId);
      }
      return Array.from(nextIds);
    });
  }, []);

  const setCustomerManualSkip = useCallback((customerId, shouldSkip = true) => {
    if (!customerId) return;

    const customerRecordIds = comparedRecords
      .filter((record) => record.customer.id === customerId)
      .map((record) => record.id);

    setManualSkippedRecordIds((currentIds) => {
      const nextIds = new Set(currentIds);
      customerRecordIds.forEach((recordId) => {
        if (shouldSkip) {
          nextIds.add(recordId);
        } else {
          nextIds.delete(recordId);
        }
      });
      return Array.from(nextIds);
    });
  }, [comparedRecords]);

  const skipLikelyExistingRecords = useCallback(() => {
    const likelyExistingRecordIds = comparedRecords
      .filter((record) => likelyExistingMigrationStatuses.has(record.migrationCheck?.status || "missing"))
      .map((record) => record.id);

    if (likelyExistingRecordIds.length === 0) {
      toast.success("No likely existing customer rows were found in this workbook.");
      return;
    }

    setManualSkippedRecordIds((currentIds) =>
      Array.from(new Set([...currentIds, ...likelyExistingRecordIds]))
    );
    toast.success(`Skipped ${likelyExistingRecordIds.length} likely existing row(s).`);
  }, [comparedRecords]);

  const clearManualSkips = useCallback(() => {
    setManualSkippedRecordIds([]);
  }, []);

  const togglePreviewCustomer = useCallback((customerId) => {
    setExpandedPreviewCustomerIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(customerId)) {
        nextIds.delete(customerId);
      } else {
        nextIds.add(customerId);
      }
      return Array.from(nextIds);
    });
  }, []);

  const expandDisplayedPreviewCustomers = useCallback(() => {
    setExpandedPreviewCustomerIds(displayedPreviewCustomerGroups.map((group) => group.customerId));
  }, [displayedPreviewCustomerGroups]);

  const collapsePreviewCustomers = useCallback(() => {
    setExpandedPreviewCustomerIds([]);
  }, []);

  const handleUpload = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before importing.");
      return;
    }

    if (records.length === 0) {
      toast.error("Upload a customer export workbook first.");
      return;
    }

    if (importableRecords.length === 0) {
      toast.error("No customer export rows are selected after import mode and manual skips.");
      return;
    }

    if (importCustomerIdCollisions.length > 0) {
      toast.error("Resolve or skip customer ID collisions in the selected import rows first.");
      return;
    }

    const confirmed = window.confirm(
      `Import ${importableRecords.length} export rows for ${importableSummary.customers} customers, ${importableSummary.serviceLocations} service locations, ${importableSummary.bodiesOfWater} pools, and ${importableSummary.equipment} default equipment records into this company?\n\n${manuallySkippedSelectedRecords.length} selected row(s) will be skipped manually.`
    );
    if (!confirmed) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: importableRecords.length });

    const importBatchId = createImportBatchId();
    const importedAt = new Date();
    const customerIdsWritten = new Set();
    const batchState = {
      batch: writeBatch(db),
      writeCount: 0,
    };

    let processedLocations = 0;
    let writtenCustomers = 0;
    let writtenEquipment = 0;
    let writtenEquipmentParts = 0;

    try {
      for (const record of importableRecords) {
        const docs = applyImportMetadata(record, {
          fileName,
          importBatchId,
          importedAt,
          tags: importTags,
        });
        const writesNeeded =
          (customerIdsWritten.has(docs.customer.id) ? 0 : 1) +
          2 +
          docs.equipment.length +
          docs.equipmentParts.length;

        if (batchState.writeCount + writesNeeded > MAX_WRITES_PER_BATCH) {
          await commitBatch(batchState);
        }

        if (!customerIdsWritten.has(docs.customer.id)) {
          batchState.batch.set(
            doc(db, "companies", recentlySelectedCompany, "customers", docs.customer.id),
            docs.customer,
            { merge: true }
          );
          batchState.writeCount += 1;
          customerIdsWritten.add(docs.customer.id);
          writtenCustomers += 1;
        }

        batchState.batch.set(
          doc(db, "companies", recentlySelectedCompany, "serviceLocations", docs.serviceLocation.id),
          docs.serviceLocation,
          { merge: true }
        );
        batchState.batch.set(
          doc(db, "companies", recentlySelectedCompany, "bodiesOfWater", docs.bodyOfWater.id),
          docs.bodyOfWater,
          { merge: true }
        );

        docs.equipment.forEach((equipment) => {
          batchState.batch.set(
            doc(db, "companies", recentlySelectedCompany, "equipment", equipment.id),
            equipment,
            { merge: true }
          );
          writtenEquipment += 1;
        });

        docs.equipmentParts.forEach((part) => {
          batchState.batch.set(
            doc(db, "companies", recentlySelectedCompany, "equipment", part.equipmentId, "parts", part.id),
            part,
            { merge: true }
          );
          writtenEquipmentParts += 1;
        });

        batchState.writeCount += 2 + docs.equipment.length + docs.equipmentParts.length;
        processedLocations += 1;

        if (processedLocations % 50 === 0) {
          setUploadProgress({ current: processedLocations, total: importableRecords.length });
        }
      }

      await commitBatch(batchState);
      setUploadProgress({ current: importableRecords.length, total: importableRecords.length });
      setLastImportSummary({
        importBatchId,
        importMode: importModeLabels[importMode],
        rows: importableRecords.length,
        excludedRows: excludedImportRecords.length,
        manualSkippedRows: manuallySkippedSelectedRecords.length,
        customers: writtenCustomers,
        serviceLocations: importableRecords.length,
        bodiesOfWater: importableRecords.length,
        equipment: writtenEquipment,
        equipmentParts: writtenEquipmentParts,
      });
      await loadExistingCompanyData();
      toast.success(
        `Imported ${writtenCustomers} customers, ${importableRecords.length} service locations, and ${writtenEquipment} equipment records.`
      );
    } catch (error) {
      console.error("Failed to import customer export:", error);
      toast.error("Import failed before all records were saved.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteParsedMigrationRecords = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before deleting migration records.");
      return;
    }

    const confirmation = window.prompt(
      "Delete all customer, service location, pool, equipment, and equipment part records marked as Customer Export migration data for this company?\n\nType DELETE CUSTOMER EXPORT to confirm."
    );

    if (confirmation !== "DELETE CUSTOMER EXPORT") return;

    setDeletingMigration(true);
    setDeleteProgress({ current: 0, total: 0 });

    try {
      const refsByPath = new Map();
      const addRef = (ref) => refsByPath.set(ref.path, ref);

      const equipmentSnapshot = await getDocs(
        query(
          collection(db, "companies", recentlySelectedCompany, "equipment"),
          where("migrationSource.provider", "==", "Customer Export")
        )
      );
      const equipmentPartsSnapshots = await Promise.all(
        equipmentSnapshot.docs.map((equipmentDocument) => getDocs(collection(equipmentDocument.ref, "parts")))
      );

      equipmentPartsSnapshots.forEach((snapshot) => {
        snapshot.docs.forEach((documentSnapshot) => addRef(documentSnapshot.ref));
      });
      equipmentSnapshot.docs.forEach((documentSnapshot) => addRef(documentSnapshot.ref));

      const migrationCollections = ["bodiesOfWater", "serviceLocations", "customers"];
      const snapshots = await Promise.all(
        migrationCollections.map((collectionName) =>
          getDocs(
            query(
              collection(db, "companies", recentlySelectedCompany, collectionName),
              where("migrationSource.provider", "==", "Customer Export")
            )
          )
        )
      );

      snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((documentSnapshot) => addRef(documentSnapshot.ref));
      });

      const refs = Array.from(refsByPath.values());

      if (refs.length === 0) {
        toast.success("No customer export migration records were found.");
        return;
      }

      setDeleteProgress({ current: 0, total: refs.length });
      const deletedCount = await deleteRefsInChunks(refs, (current, total) => {
        setDeleteProgress({ current, total });
      });

      setLastImportSummary(null);
      await loadExistingCompanyData();
      setDiagnosticText("");
      toast.success(`Deleted ${deletedCount} customer export migration records.`);
    } catch (error) {
      console.error("Failed to delete customer export migration records:", error);
      toast.error("Could not delete the customer export migration records.");
    } finally {
      setDeletingMigration(false);
    }
  };

  const handleCopyDiagnosticReport = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before generating diagnostics.");
      return;
    }

    if (records.length === 0 && skippedRows.length === 0) {
      toast.error("Upload a customer export workbook first.");
      return;
    }

    const diagnosticExistingData = await loadExistingCompanyData();

    const customerById = new Map(diagnosticExistingData.customers.map((customer) => [customer.id, customer]));
    const serviceLocationById = new Map(diagnosticExistingData.serviceLocations.map((serviceLocation) => [serviceLocation.id, serviceLocation]));
    const bodyOfWaterById = new Map(diagnosticExistingData.bodiesOfWater.map((bodyOfWater) => [bodyOfWater.id, bodyOfWater]));
    const equipmentById = new Map(diagnosticExistingData.equipment.map((equipment) => [equipment.id, equipment]));
    const diagnosticComparedRecords = compareCustomerExportRecords(
      records,
      diagnosticExistingData.customers,
      diagnosticExistingData.serviceLocations
    );
    const diagnosticModeSelectedRecords = diagnosticComparedRecords.filter((record) =>
      recordIsSelectedForImportMode(record, importMode)
    );
    const diagnosticImportableRecords = diagnosticModeSelectedRecords.filter((record) =>
      !manualSkippedRecordIdSet.has(record.id)
    );
    const diagnosticManualSkippedRecords = diagnosticModeSelectedRecords.filter((record) =>
      manualSkippedRecordIdSet.has(record.id)
    );
    const diagnosticExcludedRecords = diagnosticComparedRecords.filter((record) =>
      !recordIsSelectedForImportMode(record, importMode)
    );
    const diagnosticComparisonSummary = summarizeCustomerExportComparison(diagnosticComparedRecords);
    const diagnosticCustomerIdCollisions = findCustomerExportCustomerIdCollisions(diagnosticComparedRecords);

    const watchedMatches = watchedCustomerSearches.map((watch) => {
      const matchedRecords = diagnosticComparedRecords.filter((record) =>
        watch.terms.some((term) => sourceTextForRecord(record).includes(normalizeText(term)))
      );

      return {
        label: watch.label,
        foundParsedRows: matchedRecords.length,
        parsedRows: matchedRecords.map((record) =>
          buildDiagnosticRecord({
            record,
            importMode,
            customerById,
            serviceLocationById,
            bodyOfWaterById,
            equipmentById,
            existingCustomers: diagnosticExistingData.customers,
          })
        ),
      };
    });

    const problematicRecords = diagnosticComparedRecords.filter((record) => {
      const selected = recordIsSelectedForImportMode(record, importMode);
      const customerExists = customerById.has(record.customer.id);
      const locationExists = serviceLocationById.has(record.serviceLocation.id);
      const bodyExists = bodyOfWaterById.has(record.bodyOfWater.id);
      const equipmentExists = (record.equipment || []).every((equipment) => equipmentById.has(equipment.id));
      return !selected || !customerExists || !locationExists || !bodyExists || !equipmentExists || record.migrationCheck?.status === "review";
    });

    const report = {
      reportType: "CUSTOMER_EXPORT_IMPORT_DIAGNOSTIC_V1",
      generatedAt: new Date().toISOString(),
      companyId: recentlySelectedCompany,
      workbook: {
        fileName,
        sheetName,
        expectedColumns,
      },
      importMode: {
        value: importMode,
        label: importModeLabels[importMode],
        selectedRowCount: diagnosticImportableRecords.length,
        manualSkippedSelectedRowCount: diagnosticManualSkippedRecords.length,
        excludedRowCount: diagnosticExcludedRecords.length,
      },
      summary: {
        parsedRows: records.length,
        parsedCustomers: summary.customers,
        parsedEquipment: summary.equipment,
        parsedEquipmentParts: summary.equipmentParts,
        skippedRows: skippedRows.length,
        parseIssues: parseIssues.length,
        customerIdCollisionCount: diagnosticCustomerIdCollisions.length,
        comparison: diagnosticComparisonSummary,
        existingCustomersLoaded: diagnosticExistingData.customers.length,
        existingServiceLocationsLoaded: diagnosticExistingData.serviceLocations.length,
        existingBodiesOfWaterLoaded: diagnosticExistingData.bodiesOfWater.length,
        existingEquipmentLoaded: diagnosticExistingData.equipment.length,
        lastImportSummary,
      },
      skippedRows,
      customerIdCollisions: diagnosticCustomerIdCollisions,
      watchedMatches,
      problematicRecords: problematicRecords.slice(0, 200).map((record) =>
        buildDiagnosticRecord({
          record,
          importMode,
          customerById,
          serviceLocationById,
          bodyOfWaterById,
          equipmentById,
          existingCustomers: diagnosticExistingData.customers,
        })
      ),
      omittedProblematicRecordCount: Math.max(problematicRecords.length - 200, 0),
    };

    const text = `CUSTOMER_EXPORT_IMPORT_DIAGNOSTIC_V1\n\n${JSON.stringify(report, null, 2)}`;
    setDiagnosticText(text);

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Diagnostic report copied. Paste it back into Codex.");
    } catch (error) {
      console.warn("Could not copy diagnostic report:", error);
      toast.error("Could not copy automatically. Select and copy the report below.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-0 py-4">
      <div className="w-full space-y-5">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Migration</p>
            <h1 className="text-2xl font-bold text-slate-950">Customer Export Import</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Upload the old customer export, compare it to existing Drip Drop records, and import only what still needs to move.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/company/migration"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Migration Dashboard
            </Link>
            <button
              type="button"
              onClick={handleDeleteParsedMigrationRecords}
              disabled={uploading || deletingMigration}
              className="inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
            >
              {deletingMigration
                ? `Deleting ${deleteProgress.current}/${deleteProgress.total}`
                : "Delete Customer Export Data"}
            </button>
            <button
              type="button"
              onClick={handleCopyDiagnosticReport}
              disabled={uploading || deletingMigration || existingData.loading || (records.length === 0 && skippedRows.length === 0)}
              className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
            >
              Copy Diagnostic Report
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || deletingMigration || records.length === 0 || importableRecords.length === 0}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {uploading ? `Importing ${uploadProgress.current}/${uploadProgress.total}` : "Import Selected Rows"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Customer export workbook</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
                />
              </label>

              <div>
                <span className="text-sm font-semibold text-slate-700">Import tags</span>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addTag();
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Add tag"
                  />
                  <button
                    type="button"
                    onClick={addTag}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {importTags.map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => removeTag(tag)}
                      className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customers</p>
                <p className="text-2xl font-bold text-slate-950">{summary.customers}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Locations</p>
                <p className="text-2xl font-bold text-slate-950">{summary.serviceLocations}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pools</p>
                <p className="text-2xl font-bold text-slate-950">{summary.bodiesOfWater}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Equipment</p>
                <p className="text-2xl font-bold text-slate-950">{summary.equipment}</p>
              </div>
              <div className="border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Active</p>
                <p className="text-2xl font-bold text-emerald-700">{summary.activeLocations}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inactive</p>
                <p className="text-2xl font-bold text-slate-950">{summary.inactiveLocations}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Already Added</p>
                <p className="text-2xl font-bold text-emerald-700">
                  {comparisonSummary.imported + comparisonSummary.matched}
                </p>
              </div>
              <div className="border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Review</p>
                <p className="text-2xl font-bold text-amber-700">{comparisonSummary.review}</p>
              </div>
              <div className="border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Needs Import</p>
                <p className="text-2xl font-bold text-blue-700">{comparisonSummary.missing}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Existing Drip Drop</p>
                <p className="text-2xl font-bold text-slate-950">{existingData.customers.length}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual Skips</p>
                <p className="text-2xl font-bold text-slate-950">{manuallySkippedRecords.length}</p>
              </div>
            </div>
          </section>

          <aside className="border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Workbook</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">File</dt>
                <dd className="break-words font-medium text-slate-900">{fileName || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sheet</dt>
                <dd className="font-medium text-slate-900">{sheetName || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Expected Columns</dt>
                <dd className="break-words text-slate-700">{expectedColumns}</dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="text-sm font-semibold text-slate-900">Import mode</p>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => setImportMode("migrationRefresh")}
                  className={`rounded-md border px-3 py-2 text-left text-sm font-semibold transition ${
                    importMode === "migrationRefresh"
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Missing + prior migration refresh
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Writes missing rows and refreshes rows previously created by this migration.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode("missing")}
                  className={`rounded-md border px-3 py-2 text-left text-sm font-semibold transition ${
                    importMode === "missing"
                      ? "border-slate-400 bg-slate-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Missing + imported refresh
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Imports missing rows and refreshes prior migration rows.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode("all")}
                  className={`rounded-md border px-3 py-2 text-left text-sm font-semibold transition ${
                    importMode === "all"
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  All parsed rows
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Use only when rebuilding a migration batch.
                  </span>
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Next import target: {importableRecords.length} rows, {importableSummary.customers} customers,{" "}
                {importableSummary.serviceLocations} locations, {importableSummary.equipment} equipment records.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Manual skips: {manuallySkippedRecords.length} rows across {manuallySkippedCustomerCount} customers.
                {manuallySkippedSelectedRecords.length > 0
                  ? ` ${manuallySkippedSelectedRecords.length} of those rows would otherwise import in this mode.`
                  : ""}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={skipLikelyExistingRecords}
                  disabled={records.length === 0}
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300"
                >
                  Skip likely existing rows
                  <span className="mt-1 block text-xs font-normal text-amber-700">
                    Marks review, already added, and already imported rows as manual skips.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={clearManualSkips}
                  disabled={manualSkippedRecordIds.length === 0}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  Clear manual skips
                </button>
              </div>
            </div>
          </aside>
        </div>

        {existingData.loading && (
          <div className="mx-4 border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
            Loading existing Drip Drop customers and service locations for comparison.
          </div>
        )}

        {existingData.error && (
          <div className="mx-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {existingData.error}
          </div>
        )}

        {lastImportSummary && (
          <div className="mx-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <p className="font-semibold">Last import complete</p>
            <p className="mt-1">
              Batch {lastImportSummary.importBatchId}: {lastImportSummary.rows} rows using{" "}
              {lastImportSummary.importMode}, {lastImportSummary.customers} customers,{" "}
              {lastImportSummary.serviceLocations} service locations, {lastImportSummary.bodiesOfWater} pools,{" "}
              {lastImportSummary.equipment || 0} equipment records, and {lastImportSummary.equipmentParts || 0} equipment parts.
              {lastImportSummary.excludedRows > 0 ? ` ${lastImportSummary.excludedRows} rows were not selected by this mode.` : ""}
              {lastImportSummary.manualSkippedRows > 0 ? ` ${lastImportSummary.manualSkippedRows} selected rows were manually skipped.` : ""}
            </p>
          </div>
        )}

        {customerIdCollisions.length > 0 && (
          <section className={`mx-4 border bg-white shadow-sm ${importCustomerIdCollisions.length > 0 ? "border-red-200" : "border-amber-200"}`}>
            <div className={`border-b px-4 py-3 ${importCustomerIdCollisions.length > 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <h2 className={`text-base font-semibold ${importCustomerIdCollisions.length > 0 ? "text-red-950" : "text-amber-950"}`}>
                Customer ID Collisions
              </h2>
              <p className={`mt-1 text-sm ${importCustomerIdCollisions.length > 0 ? "text-red-800" : "text-amber-800"}`}>
                {customerIdCollisions.length} generated customer IDs are shared by different customer identities.
                {importCustomerIdCollisions.length > 0
                  ? ` ${importCustomerIdCollisions.length} collision group(s) are still selected for import. Skip rows until only one identity remains for each customer ID.`
                  : " These rows are currently skipped or outside the selected import mode, so they will not block this import."}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Customer ID</th>
                    <th className="px-4 py-3">Rows</th>
                    <th className="px-4 py-3">Customers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {customerIdCollisions.slice(0, 20).map((collision) => (
                    <tr key={collision.customerId} className="align-top">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{collision.customerId}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {collision.rows.map((row) => row.rowNumber).join(", ")}
                      </td>
                      <td className="min-w-[320px] px-4 py-3 text-slate-700">
                        {collision.rows.map((row) => row.customerName || [row.firstName, row.lastName].filter(Boolean).join(" ")).join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {customerIdCollisions.length > 20 && (
              <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
                {customerIdCollisions.length - 20} more customer ID collisions not shown.
              </div>
            )}
          </section>
        )}

        {diagnosticText && (
          <section className="mx-4 border border-blue-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-blue-950">Diagnostic Report</h2>
                <p className="mt-1 text-sm text-blue-800">Paste this report back into Codex for troubleshooting.</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(diagnosticText);
                    toast.success("Diagnostic report copied.");
                  } catch (error) {
                    console.warn("Could not copy diagnostic report:", error);
                    toast.error("Select and copy the report from the box below.");
                  }
                }}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                Copy Again
              </button>
            </div>
            <textarea
              readOnly
              value={diagnosticText}
              className="h-72 w-full resize-y border-0 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 focus:outline-none"
            />
          </section>
        )}

        {skippedRows.length > 0 ? (
          <section className="mx-4 border border-amber-200 bg-white shadow-sm">
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
              <h2 className="text-base font-semibold text-amber-950">Rows Not Parsed</h2>
              <p className="mt-1 text-sm text-amber-800">{skippedRows.length} workbook rows need attention before import.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Billing Address</th>
                    <th className="px-4 py-3">Service Location</th>
                    <th className="px-4 py-3">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {skippedRows.slice(0, 100).map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.rowNumber}</td>
                      <td className="min-w-[220px] px-4 py-3 text-slate-700">{row.customerName}</td>
                      <td className="min-w-[260px] px-4 py-3 text-amber-800">{row.reason}</td>
                      <td className="min-w-[260px] px-4 py-3 text-slate-600">{row.billingAddressLabel || "-"}</td>
                      <td className="min-w-[260px] px-4 py-3 text-slate-600">{row.serviceLocationLabel || "-"}</td>
                      <td className="min-w-[220px] px-4 py-3 text-slate-600">
                        <div>{row.sourcePhone || "-"}</div>
                        <div className="text-xs text-slate-500">{row.sourceEmail || "-"}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {skippedRows.length > 100 && (
              <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
                {skippedRows.length - 100} more rows not shown.
              </div>
            )}
          </section>
        ) : parseIssues.length > 0 && (
          <div className="mx-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Rows needing attention</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {parseIssues.slice(0, 8).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
              {parseIssues.length > 8 && <li>{parseIssues.length - 8} more rows not shown.</li>}
            </ul>
          </div>
        )}

        {manuallySkippedRecords.length > 0 && (
          <section className="mx-4 border border-amber-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-amber-950">Manually Skipped Rows</h2>
                <p className="mt-1 text-sm text-amber-800">
                  {manuallySkippedRecords.length} rows across {manuallySkippedCustomerCount} customers are marked to stay out of the import.
                </p>
              </div>
              <button
                type="button"
                onClick={clearManualSkips}
                className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100"
              >
                Clear All Skips
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">Current Check</th>
                    <th className="px-4 py-3">Import Mode</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {manuallySkippedRecords.slice(0, 80).map((record) => {
                    const selectedByMode = recordIsSelectedForImportMode(record, importMode);

                    return (
                      <tr key={record.id} className="align-top">
                        <td className="min-w-[240px] px-4 py-3 font-semibold text-slate-900">{record.customerName}</td>
                        <td className="px-4 py-3 text-slate-600">{record.rowNumber}</td>
                        <td className="min-w-[180px] px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              statusToneClasses[record.migrationCheck?.tone] || statusToneClasses.slate
                            }`}
                          >
                            {record.migrationCheck?.label || "Needs import"}
                          </span>
                        </td>
                        <td className="min-w-[180px] px-4 py-3 text-slate-600">
                          {selectedByMode ? "Would import without skip" : "Already outside this mode"}
                        </td>
                        <td className="min-w-[220px] px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setRecordManualSkip(record.id, false)}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              Allow Row
                            </button>
                            <button
                              type="button"
                              onClick={() => setCustomerManualSkip(record.customer.id, false)}
                              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                              Allow Customer
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {manuallySkippedRecords.length > 80 && (
              <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
                {manuallySkippedRecords.length - 80} more skipped rows not shown.
              </div>
            )}
          </section>
        )}

        {excludedImportRecords.length > 0 && (
          <section className="mx-4 border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-950">Rows Not Selected For This Import</h2>
              <p className="mt-1 text-sm text-slate-500">
                {excludedImportRecords.length} parsed rows are outside {importModeLabels[importMode]}.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">Current Check</th>
                    <th className="px-4 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {excludedPreviewRecords.map((record) => (
                    <tr key={record.id} className="align-top">
                      <td className="min-w-[240px] px-4 py-3 font-semibold text-slate-900">{record.customerName}</td>
                      <td className="px-4 py-3 text-slate-600">{record.rowNumber}</td>
                      <td className="min-w-[180px] px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            statusToneClasses[record.migrationCheck?.tone] || statusToneClasses.slate
                          }`}
                        >
                          {record.migrationCheck?.label || "Needs import"}
                        </span>
                      </td>
                      <td className="min-w-[360px] px-4 py-3 text-slate-600">{record.migrationCheck?.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {excludedImportRecords.length > excludedPreviewRecords.length && (
              <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
                {excludedImportRecords.length - excludedPreviewRecords.length} more rows not shown.
              </div>
            )}
          </section>
        )}

        <section className="border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-1 gap-3 border-b border-slate-200 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto_300px] lg:items-center">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Import Preview</h2>
              <span className="text-sm text-slate-500">
                {records.length > 0
                  ? `${displayedPreviewCustomerGroups.length} of ${previewCustomerGroups.length} customer groups, ${filteredPreviewRecords.length} filtered rows, ${records.length} total. ${importableRecords.length} selected to import.`
                  : "No workbook parsed"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={expandDisplayedPreviewCustomers}
                disabled={displayedPreviewCustomerGroups.length === 0}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                Expand Visible
              </button>
              <button
                type="button"
                onClick={collapsePreviewCustomers}
                disabled={expandedPreviewCustomerIds.length === 0}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                Collapse All
              </button>
            </div>
            <input
              type="search"
              value={previewSearch}
              onChange={(event) => setPreviewSearch(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Search preview"
            />
          </div>

          {records.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              Upload a customer export workbook to preview the migration records.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {displayedPreviewCustomerGroups.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  No customer groups match the current search.
                </div>
              ) : displayedPreviewCustomerGroups.map((group) => {
                const expanded = expandedPreviewCustomerIdSet.has(group.customerId);
                const allSkipped = group.records.every((record) => manualSkippedRecordIdSet.has(record.id));
                const alreadyCount = (group.statusCounts.imported || 0) + (group.statusCounts.matched || 0);
                const rowNumbers = group.rowNumbers.slice(0, 6).join(", ");
                const extraRowCount = Math.max(group.rowNumbers.length - 6, 0);
                const locationPreview = group.locationLabels.slice(0, 3).join(" | ");
                const extraLocationCount = Math.max(group.locationLabels.length - 3, 0);

                return (
                  <div key={group.customerId} className="bg-white">
                    <div className="grid grid-cols-1 gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      <button
                        type="button"
                        onClick={() => togglePreviewCustomer(group.customerId)}
                        className="min-w-0 text-left"
                        aria-expanded={expanded}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-sm font-bold text-slate-700">
                            {expanded ? "-" : "+"}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-950">{group.customerName}</h3>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                {group.rowCount} row{group.rowCount === 1 ? "" : "s"}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                rows {rowNumbers}{extraRowCount > 0 ? ` +${extraRowCount}` : ""}
                              </span>
                            </div>
                            <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                              <span>{group.locationCount} location{group.locationCount === 1 ? "" : "s"}</span>
                              <span>{group.equipmentCount} equipment / {group.equipmentPartsCount} parts</span>
                              <span>{group.activeLocationCount} active / {group.inactiveLocationCount} inactive</span>
                              <span>{group.sourcePhones[0] || group.sourceEmails[0] || "No contact in export"}</span>
                            </div>
                            {locationPreview && (
                              <p className="mt-2 truncate text-xs text-slate-500">
                                {locationPreview}{extraLocationCount > 0 ? ` +${extraLocationCount} more` : ""}
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {group.decisionCounts.willImport > 0 && (
                                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                                  {group.decisionCounts.willImport} will import
                                </span>
                              )}
                              {group.decisionCounts.skipped > 0 && (
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                  {group.decisionCounts.skipped} skipped
                                </span>
                              )}
                              {group.decisionCounts.notSelected > 0 && (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                  {group.decisionCounts.notSelected} not selected
                                </span>
                              )}
                              {group.statusCounts.missing > 0 && (
                                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                                  {group.statusCounts.missing} needs import
                                </span>
                              )}
                              {group.statusCounts.review > 0 && (
                                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                  {group.statusCounts.review} review
                                </span>
                              )}
                              {alreadyCount > 0 && (
                                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                  {alreadyCount} already exists
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <button
                          type="button"
                          onClick={() => setCustomerManualSkip(group.customerId, !allSkipped)}
                          className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${
                            allSkipped
                              ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          }`}
                        >
                          {allSkipped ? "Allow Customer" : "Skip Customer"}
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t border-slate-100 bg-slate-50 px-4 pb-4 pt-3">
                        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                          <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-3 py-2">Row</th>
                                <th className="px-3 py-2">Service Location</th>
                                <th className="px-3 py-2">Check</th>
                                <th className="px-3 py-2">Decision</th>
                                <th className="px-3 py-2">Contact</th>
                                <th className="px-3 py-2">Equipment</th>
                                <th className="px-3 py-2">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                              {group.records.map((record) => {
                                const decision = getRecordImportDecision(record, importMode, manualSkippedRecordIdSet);
                                const willImport = decision === "willImport";
                                const manuallySkipped = decision === "skipped";

                                return (
                                  <tr key={record.id} className="align-top">
                                    <td className="px-3 py-3 text-slate-600">{record.rowNumber}</td>
                                    <td className="min-w-[260px] px-3 py-3 text-slate-700">{record.serviceLocationLabel}</td>
                                    <td className="min-w-[220px] px-3 py-3">
                                      <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                          statusToneClasses[record.migrationCheck?.tone] || statusToneClasses.slate
                                        }`}
                                      >
                                        {record.migrationCheck?.label || "Needs import"}
                                      </span>
                                      <div className="mt-1 text-xs leading-5 text-slate-500">
                                        {record.migrationCheck?.reason}
                                        {record.migrationCheck?.matchedCustomerName && (
                                          <div className="font-medium text-slate-700">
                                            Match: {record.migrationCheck.matchedCustomerName}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-3">
                                      <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                          willImport
                                            ? "bg-blue-100 text-blue-700"
                                            : manuallySkipped
                                              ? "bg-amber-100 text-amber-700"
                                              : "bg-slate-100 text-slate-600"
                                        }`}
                                      >
                                        {willImport ? "Will import" : manuallySkipped ? "Skipped" : "Not selected"}
                                      </span>
                                    </td>
                                    <td className="min-w-[220px] px-3 py-3 text-slate-700">
                                      <div>{record.sourcePhones[0] || "-"}</div>
                                      <div className="text-xs text-slate-500">{record.sourceEmails[0] || "-"}</div>
                                    </td>
                                    <td className="px-3 py-3 text-slate-700">
                                      {record.equipment?.length || 0} item{record.equipment?.length === 1 ? "" : "s"}
                                    </td>
                                    <td className="px-3 py-3">
                                      <button
                                        type="button"
                                        onClick={() => setRecordManualSkip(record.id, !manuallySkipped)}
                                        className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                                          manuallySkipped
                                            ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                        }`}
                                      >
                                        {manuallySkipped ? "Allow Row" : "Skip Row"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {previewCustomerGroups.length > displayedPreviewCustomerGroups.length && (
                <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
                  {previewCustomerGroups.length - displayedPreviewCustomerGroups.length} more customer groups not shown. Use search to narrow the list.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default CustomerExportImport;
