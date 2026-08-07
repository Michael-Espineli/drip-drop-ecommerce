import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import toast from "react-hot-toast";
import {
  FaCheck,
  FaCheckCircle,
  FaCog,
  FaClipboardCheck,
  FaEllipsisV,
  FaFileInvoiceDollar,
  FaFilter,
  FaPlus,
  FaRegCircle,
  FaRoute,
  FaSearch,
  FaSyncAlt,
  FaUserPlus,
  FaUsers,
} from "react-icons/fa";
import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { db } from "../../../utils/config";
import CustomerPipelineSettingsPanel from "../settings/CustomerPipelineSettingsPanel";
import {
  CUSTOMER_PIPELINE_COLLECTION,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_PIPELINE_TEMPLATE_ITEMS,
  LEGACY_CUSTOMER_MIGRATION_COLLECTION,
  PIPELINE_CREATE_PERMISSION_ID,
  PIPELINE_UPDATE_PERMISSION_ID,
  customerPipelineRowRef,
  customerPipelineRowsRef,
  getCustomerContact,
  getCustomerDisplayName,
  getLeadSourceLabel,
  leadSourceId,
  normalizeLeadSourceItem,
  normalizePipelineItem,
  pipelineLeadSourcesRef,
  pipelineRowIdForCustomer,
  pipelineRowIdForLead,
  pipelineTemplateItemsRef,
} from "../../../utils/customerPipeline";
import { salesCollectionNames } from "../../../utils/models/Sales";
import { REPAIR_REQUEST_STATUS } from "../../../utils/models/RepairRequest";

const toneClasses = {
  blue: "bg-blue-600",
  emerald: "bg-emerald-600",
  amber: "bg-amber-500",
  rose: "bg-rose-600",
  violet: "bg-violet-600",
  slate: "bg-slate-900",
};

const linkTypeTone = {
  lead: "blue",
  customer: "emerald",
  initialEstimate: "amber",
  serviceAgreement: "amber",
  routing: "violet",
  equipment: "slate",
  locationPhotos: "rose",
  external: "slate",
};

const emptySignoff = {
  complete: false,
  completedAt: null,
  completedByUserId: "",
  completedByName: "",
  lastChangedAt: null,
  lastChangedByUserId: "",
  lastChangedByName: "",
  lastAction: "",
};

const endedPipelineStatuses = new Set(["complete", "lost", "fired", "oneoff", "inactive"]);
const finalJobBillingStatuses = new Set(["invoiced", "paid", "comped", "expired", "rejected"]);
const finalJobOperationStatuses = new Set(["finished", "cancelled", "canceled"]);
const finalRepairRequestStatuses = new Set(["resolved", "cancelled", "converted to job", "suggested work"]);
const finalAgreementStatuses = new Set(["canceled", "cancelled", "rejected", "expired", "superseded"]);
const finalSubscriptionStatuses = new Set(["canceled", "cancelled"]);

const pipelineStatusMeta = {
  active: {
    label: "Active",
    badgeClass: "bg-blue-50 text-blue-700",
  },
  complete: {
    label: "Complete",
    badgeClass: "bg-emerald-50 text-emerald-700",
  },
  oneOff: {
    label: "Hired for one off",
    badgeClass: "bg-violet-50 text-violet-700",
  },
  lost: {
    label: "Lead ended",
    badgeClass: "bg-rose-50 text-rose-700",
  },
  fired: {
    label: "Fired us",
    badgeClass: "bg-orange-50 text-orange-700",
  },
  inactive: {
    label: "Inactive",
    badgeClass: "bg-slate-100 text-slate-700",
  },
};

const normalizeStatusText = (value) => String(value || "").trim().toLowerCase();

const isEndedPipelineStatus = (status) => endedPipelineStatuses.has(normalizeStatusText(status));

const uniqueDocsByPath = (docs = []) => (
  Array.from(new Map(docs.map((documentSnapshot) => [documentSnapshot.ref.path, documentSnapshot])).values())
);

const commitSetOperations = async (operations = []) => {
  let batch = writeBatch(db);
  let batchCount = 0;
  let committedCount = 0;

  for (const operation of operations) {
    batch.set(operation.ref, operation.data, operation.options || { merge: true });
    batchCount += 1;

    if (batchCount === 450) {
      await batch.commit();
      committedCount += batchCount;
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    committedCount += batchCount;
  }

  return committedCount;
};

const recordLooksActive = (data = {}) => {
  const status = normalizeStatusText(data.status || data.lifecycleStatus);
  return data.active !== false &&
    data.isActive !== false &&
    !["inactive", "ended", "cancelled", "canceled"].includes(status);
};

const getCustomerUserIds = (customer = {}) => (
  [
    customer.customerUserId,
    customer.userId,
    customer.linkedCustomerUserId,
    customer.linkedHomeownerUserId,
    ...(Array.isArray(customer.linkedCustomerIds) ? customer.linkedCustomerIds : []),
  ].filter(Boolean)
);

const getString = (...values) => values.find((value) => typeof value === "string" && value.trim()) || "";

const getActorId = (dataBaseUser, authUser) => (
  dataBaseUser?.id ||
  dataBaseUser?.userId ||
  dataBaseUser?.uid ||
  authUser?.uid ||
  ""
);

const getActorName = (dataBaseUser, authUser) => (
  getString(
    dataBaseUser?.userName,
    dataBaseUser?.displayName,
    [dataBaseUser?.firstName, dataBaseUser?.lastName].filter(Boolean).join(" "),
    authUser?.displayName,
    authUser?.email
  ) || "Company user"
);

const dateFromValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = dateFromValue(value);
  if (!date) return "";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const normalizeChecklist = (checklist = {}, rowData = {}) => {
  const mergedChecklist = { ...(checklist || {}) };
  Object.entries(rowData || {}).forEach(([key, value]) => {
    if (!key.startsWith("checklist.")) return;
    const stageId = key.slice("checklist.".length);
    if (stageId && !Object.prototype.hasOwnProperty.call(mergedChecklist, stageId)) {
      mergedChecklist[stageId] = value;
    }
  });

  return Object.fromEntries(
    Object.entries(mergedChecklist).map(([key, value]) => [
      key,
      {
        complete: !!(value?.complete || value?.isComplete),
        completedAt: value?.completedAt || value?.dateCompleted || null,
        completedByUserId: value?.completedByUserId || value?.completedBy || "",
        completedByName: value?.completedByName || value?.completedByUserName || "",
        lastChangedAt: value?.lastChangedAt || value?.updatedAt || value?.completedAt || value?.dateCompleted || null,
        lastChangedByUserId: value?.lastChangedByUserId || value?.updatedByUserId || value?.completedByUserId || value?.completedBy || "",
        lastChangedByName: value?.lastChangedByName || value?.updatedByName || value?.completedByName || value?.completedByUserName || "",
        lastAction: value?.lastAction || (value?.complete || value?.isComplete ? "completed" : ""),
      },
    ])
  );
};

const normalizePipelineStatus = (row = {}) => {
  const raw = String(row.pipelineStatus || row.lifecycleStatus || row.status || "").trim().toLowerCase();
  const safeRaw = raw.replace(/[\s-]+/g, "_");
  if (["fired", "fired_us", "customer_fired", "terminated", "churned"].includes(raw) || row.firedUs === true) return "fired";
  if (["inactive", "ended_inactive", "customer_inactive"].includes(safeRaw) || row.inactiveAt) return "inactive";
  if (["lost", "cancelled", "canceled"].includes(raw) || String(row.leadStatus || "").toLowerCase() === "cancelled") return "lost";
  if (["one_off", "oneoff", "hired_one_off", "hired_for_one_off", "won_one_off"].includes(safeRaw) || row.hiredForOneOff === true) return "oneOff";
  if (["complete", "completed", "done"].includes(raw)) return "complete";
  return "active";
};

const getPipelineStatusMeta = (status) => (
  pipelineStatusMeta[status] || pipelineStatusMeta.active
);

const rowCustomerName = (data = {}) => (
  getString(data.customerName, data.homeownerName, data.name, data.contactName, "Unnamed pipeline")
);

const normalizeRow = (rowDoc, sourceCollection = CUSTOMER_PIPELINE_COLLECTION) => {
  const data = rowDoc.data() || {};
  return {
    id: rowDoc.id,
    companyId: data.companyId || "",
    sourceCollection,
    customerId: data.customerId || data.companyCustomerId || "",
    leadId: data.leadId || data.sourceHomeownerServiceRequestId || "",
    source: data.source || data.rowSource || (data.leadId ? "lead" : "customer"),
    leadSource: data.leadSource || data.marketingSource || data.sourceLabel || "",
    leadStatus: data.leadStatus || data.status || "",
    pipelineStatus: normalizePipelineStatus(data),
    lostReason: data.lostReason || data.cancelReason || data.statusChangeReason || "",
    firedReason: data.firedReason || data.customerFiredReason || "",
    firedAt: data.firedAt || data.customerFiredAt || null,
    customerName: rowCustomerName(data),
    contact: data.contact || data.customerContact || data.homeownerEmail || data.email || "",
    notes: data.notes || "",
    checklist: normalizeChecklist(data.checklist, data),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    completedAt: data.completedAt || data.dateCompleted || null,
    raw: data,
  };
};

const normalizeLeadToPipelineRow = (lead = {}) => ({
  id: pipelineRowIdForLead(lead.id),
  companyId: lead.companyId || "",
  leadId: lead.id,
  customerId: lead.customerId || lead.companyCustomerId || "",
  source: "lead",
  leadSource: getLeadSourceLabel(lead),
  leadStatus: lead.status || "Pending",
  pipelineStatus: String(lead.status || "").toLowerCase() === "cancelled" ? "lost" : "active",
  lostReason: lead.lostReason || lead.cancelReason || lead.statusChangeReason || "",
  customerName: rowCustomerName(lead),
  contact: [lead.homeownerEmail, lead.homeownerPhone].filter(Boolean).join(" | "),
  estimateId: lead.estimateId || "",
  serviceAgreementId: lead.serviceAgreementId || "",
  serviceEstimateServiceStopId: lead.serviceEstimateServiceStopId || "",
  initialEstimateServiceStopId: lead.initialEstimateServiceStopId || "",
  notes: "",
  checklist: {},
});

const sortByOrderThenTitle = (left, right) => (
  Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
  String(left.title || left.name || "").localeCompare(String(right.title || right.name || ""))
);

const rowSearchText = (row = {}) => [
  row.customerName,
  row.contact,
  row.notes,
  row.leadSource,
  row.leadStatus,
  getPipelineStatusMeta(normalizePipelineStatus(row)).label,
  row.lostReason,
  row.firedReason,
  row.customerId,
  row.leadId,
].filter(Boolean).join(" ").toLowerCase();

const getLoadedCompanyLead = (leads = [], leadId = "", companyId = "") => {
  if (!leadId || !companyId) return null;

  return leads.find((lead) => (
    String(lead.id || "") === String(leadId) &&
    String(lead.companyId || "") === String(companyId)
  )) || null;
};

const getCompanyDocsForCustomer = async (companyId, collectionName, customerId, fields = ["customerId", "companyCustomerId"]) => {
  if (!companyId || !customerId) return [];

  const collectionRef = collection(db, "companies", companyId, collectionName);
  const snapshots = await Promise.all(
    fields.map((field) => getDocs(query(collectionRef, where(field, "==", customerId))))
  );

  return uniqueDocsByPath(snapshots.flatMap((snapshot) => snapshot.docs));
};

const getTopLevelSalesDocsForCustomer = async (collectionName, companyId, customer = {}) => {
  if (!companyId || !collectionName || !customer.id) return [];

  const collectionRef = collection(db, collectionName);
  const customerIds = [...new Set([customer.id, customer.customerId, customer.companyCustomerId].filter(Boolean))];
  const customerUserIds = [...new Set(getCustomerUserIds(customer))];
  const requests = [
    ...customerIds.map((customerId) => getDocs(query(
      collectionRef,
      where("companyId", "==", companyId),
      where("customerId", "==", customerId)
    ))),
    ...customerUserIds.map((customerUserId) => getDocs(query(
      collectionRef,
      where("companyId", "==", companyId),
      where("customerUserId", "==", customerUserId)
    ))),
  ];

  const snapshots = await Promise.all(requests);
  return uniqueDocsByPath(snapshots.flatMap((snapshot) => snapshot.docs));
};

const isOpenJobDoc = (job = {}) => {
  const billingStatus = normalizeStatusText(job.billingStatus);
  const operationStatus = normalizeStatusText(job.operationStatus || job.status);
  return !finalJobBillingStatuses.has(billingStatus) && !finalJobOperationStatuses.has(operationStatus);
};

const isOpenRepairRequestDoc = (request = {}) => (
  !finalRepairRequestStatuses.has(normalizeStatusText(request.status))
);

const truncateNoteText = (value = "", maxLength = 90) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
};

const docSummaryLabel = (documentSnapshot, fallbackLabel) => {
  const data = documentSnapshot.data() || {};
  return truncateNoteText(getString(
    data.title,
    data.name,
    data.jobName,
    data.routeName,
    data.serviceStopName,
    data.bodyOfWaterName,
    data.equipmentName,
    data.description,
    data.type,
    fallbackLabel
  ));
};

const recordLinesForNote = (heading, docs = [], fallbackLabel) => {
  if (!docs.length) return [];

  const lines = [`${heading}:`];
  docs.slice(0, 25).forEach((documentSnapshot) => {
    lines.push(`- ${docSummaryLabel(documentSnapshot, fallbackLabel)} (${documentSnapshot.id})`);
  });
  if (docs.length > 25) {
    lines.push(`- ...and ${docs.length - 25} more`);
  }

  return lines;
};

const buildOffboardingNote = ({
  customerName,
  row,
  reason,
  actorName,
  counts,
  details = {},
}) => {
  const reasonText = reason || "Customer fired us";
  const detailLines = [
    ...recordLinesForNote("Service locations made inactive", details.serviceLocations, "Service location"),
    ...recordLinesForNote("Bodies of water made inactive", details.bodiesOfWater, "Body of water"),
    ...recordLinesForNote("Equipment made inactive", details.equipment, "Equipment"),
    ...recordLinesForNote("Routes ended", details.routes, "Route"),
    ...recordLinesForNote("Service agreements canceled", details.serviceAgreements, "Service agreement"),
    ...recordLinesForNote("Billing subscriptions canceled", details.billingSubscriptions, "Billing subscription"),
    ...recordLinesForNote("Billing profiles made inactive", details.billingProfiles, "Billing profile"),
    ...recordLinesForNote("Open jobs canceled", details.jobs, "Job"),
    ...recordLinesForNote("Open repair requests canceled", details.repairRequests, "Repair request"),
  ];

  return [
    "Customer offboarding from Pipeline.",
    `Customer: ${customerName || row.customerName || "Customer"}`,
    row.leadId ? `Lead row: ${row.leadId}` : "",
    row.id ? `Pipeline row: ${row.id}` : "",
    `Reason: ${reasonText}`,
    `Handled by: ${actorName || "Company user"}`,
    "",
    "Records updated:",
    `Customer marked inactive: ${counts.customer}`,
    `Service locations made inactive: ${counts.serviceLocations}`,
    `Bodies of water made inactive: ${counts.bodiesOfWater}`,
    `Equipment made inactive: ${counts.equipment}`,
    `Routes ended: ${counts.routes}`,
    `Service agreements canceled: ${counts.serviceAgreements}`,
    `Billing subscriptions canceled: ${counts.billingSubscriptions}`,
    `Billing profiles made inactive: ${counts.billingProfiles}`,
    `Open jobs canceled: ${counts.jobs}`,
    `Open repair requests canceled: ${counts.repairRequests}`,
    "",
    "Where we left off:",
    ...(detailLines.length ? detailLines : ["No active linked records were found to list."]),
    "",
    "This note was created so the company can see where the account was left off if the customer comes back.",
  ].filter(Boolean).join("\n");
};

const buildCustomerOffboardingOperations = async ({
  companyId,
  row,
  customer,
  reason,
  actorId,
  actorName,
}) => {
  const customerId = row.customerId || customer?.id || "";
  const hydratedCustomer = {
    id: customerId,
    ...(customer || {}),
  };
  const nowMillis = Date.now();
  const reasonText = reason || "Customer fired us";
  const baseEndPayload = {
    inactiveReason: reasonText,
    offboardedFromPipeline: true,
    offboardedAt: serverTimestamp(),
    offboardedByUserId: actorId,
    offboardedByName: actorName,
    updatedAt: serverTimestamp(),
    updatedAtMillis: nowMillis,
  };

  const serviceLocationDocs = await getCompanyDocsForCustomer(companyId, "serviceLocations", customerId);
  const serviceLocationIds = serviceLocationDocs.map((locationDoc) => locationDoc.id);

  const [
    bodiesByCustomerDocs,
    equipmentByCustomerDocs,
    routesDocs,
    workOrderDocs,
    internalRepairRequestDocs,
    externalRepairRequestDocs,
    agreementDocs,
    billingSubscriptionDocs,
    billingProfileDocs,
  ] = await Promise.all([
    getCompanyDocsForCustomer(companyId, "bodiesOfWater", customerId),
    getCompanyDocsForCustomer(companyId, "equipment", customerId),
    getCompanyDocsForCustomer(companyId, "recurringServiceStop", customerId),
    getCompanyDocsForCustomer(companyId, "workOrders", customerId),
    getCompanyDocsForCustomer(companyId, "repairRequests", customerId),
    (async () => {
      const customerUserIds = getCustomerUserIds(hydratedCustomer);
      const externalRequests = [
        getDocs(query(
          collection(db, "homeownerRepairRequests"),
          where("companyId", "==", companyId),
          where("customerId", "==", customerId)
        )),
        ...customerUserIds.map((userId) => getDocs(query(
          collection(db, "homeownerRepairRequests"),
          where("companyId", "==", companyId),
          where("userId", "==", userId)
        ))),
        ...customerUserIds.map((userId) => getDocs(query(
          collection(db, "homeownerRepairRequests"),
          where("companyId", "==", companyId),
          where("requesterId", "==", userId)
        ))),
      ];
      const snapshots = await Promise.all(externalRequests);
      return uniqueDocsByPath(snapshots.flatMap((snapshot) => snapshot.docs));
    })(),
    getTopLevelSalesDocsForCustomer(salesCollectionNames.agreements, companyId, hydratedCustomer),
    getTopLevelSalesDocsForCustomer(salesCollectionNames.billingSubscriptions, companyId, hydratedCustomer),
    getTopLevelSalesDocsForCustomer(salesCollectionNames.billingProfiles, companyId, hydratedCustomer),
  ]);

  const [bodiesByLocationSnapshots, equipmentByLocationSnapshots] = await Promise.all([
    Promise.all(serviceLocationIds.map((serviceLocationId) => getDocs(query(
      collection(db, "companies", companyId, "bodiesOfWater"),
      where("serviceLocationId", "==", serviceLocationId)
    )))),
    Promise.all(serviceLocationIds.map((serviceLocationId) => getDocs(query(
      collection(db, "companies", companyId, "equipment"),
      where("serviceLocationId", "==", serviceLocationId)
    )))),
  ]);

  const bodyDocs = uniqueDocsByPath([
    ...bodiesByCustomerDocs,
    ...bodiesByLocationSnapshots.flatMap((snapshot) => snapshot.docs),
  ]).filter((bodyDoc) => recordLooksActive(bodyDoc.data()));
  const equipmentDocs = uniqueDocsByPath([
    ...equipmentByCustomerDocs,
    ...equipmentByLocationSnapshots.flatMap((snapshot) => snapshot.docs),
  ]).filter((equipmentDoc) => recordLooksActive(equipmentDoc.data()));
  const activeServiceLocationDocs = serviceLocationDocs.filter((locationDoc) => recordLooksActive(locationDoc.data()));
  const activeRouteDocs = routesDocs.filter((routeDoc) => recordLooksActive(routeDoc.data()));
  const openWorkOrderDocs = workOrderDocs.filter((workOrderDoc) => isOpenJobDoc(workOrderDoc.data()));
  const openRepairRequestDocs = uniqueDocsByPath([
    ...internalRepairRequestDocs,
    ...externalRepairRequestDocs,
  ]).filter((repairRequestDoc) => isOpenRepairRequestDoc(repairRequestDoc.data()));
  const activeAgreementDocs = agreementDocs.filter((agreementDoc) => !finalAgreementStatuses.has(normalizeStatusText(agreementDoc.data().status)));
  const activeBillingSubscriptionDocs = billingSubscriptionDocs.filter((subscriptionDoc) => !finalSubscriptionStatuses.has(normalizeStatusText(subscriptionDoc.data().status)));
  const activeBillingProfileDocs = billingProfileDocs.filter((profileDoc) => recordLooksActive(profileDoc.data()));

  const operations = [];
  const customerRef = doc(db, "companies", companyId, "customers", customerId);
  operations.push({
    ref: customerRef,
    data: {
      active: false,
      isActive: false,
      status: "inactive",
      firedUs: true,
      firedReason: reasonText,
      ...baseEndPayload,
    },
    options: { merge: true },
  });

  activeServiceLocationDocs.forEach((locationDoc) => {
    operations.push({
      ref: locationDoc.ref,
      data: { active: false, isActive: false, status: "inactive", ...baseEndPayload },
      options: { merge: true },
    });
  });

  bodyDocs.forEach((bodyDoc) => {
    operations.push({
      ref: bodyDoc.ref,
      data: { active: false, isActive: false, ...baseEndPayload },
      options: { merge: true },
    });
  });

  equipmentDocs.forEach((equipmentDoc) => {
    operations.push({
      ref: equipmentDoc.ref,
      data: { active: false, isActive: false, status: "inactive", ...baseEndPayload },
      options: { merge: true },
    });
  });

  activeRouteDocs.forEach((routeDoc) => {
    operations.push({
      ref: routeDoc.ref,
      data: {
        active: false,
        isActive: false,
        status: "ended",
        endedAt: serverTimestamp(),
        endedReason: reasonText,
        endedByUserId: actorId,
        endedByName: actorName,
        ...baseEndPayload,
      },
      options: { merge: true },
    });
  });

  activeAgreementDocs.forEach((agreementDoc) => {
    operations.push({
      ref: agreementDoc.ref,
      data: {
        status: "canceled",
        canceledAt: serverTimestamp(),
        cancelReason: reasonText,
        canceledByUserId: actorId,
        canceledByName: actorName,
        ...baseEndPayload,
      },
      options: { merge: true },
    });
  });

  activeBillingSubscriptionDocs.forEach((subscriptionDoc) => {
    operations.push({
      ref: subscriptionDoc.ref,
      data: {
        status: "canceled",
        autopayStatus: "canceled",
        canceledAt: serverTimestamp(),
        cancelReason: reasonText,
        canceledByUserId: actorId,
        canceledByName: actorName,
        ...baseEndPayload,
      },
      options: { merge: true },
    });
  });

  activeBillingProfileDocs.forEach((profileDoc) => {
    operations.push({
      ref: profileDoc.ref,
      data: { active: false, isActive: false, status: "inactive", ...baseEndPayload },
      options: { merge: true },
    });
  });

  openWorkOrderDocs.forEach((workOrderDoc) => {
    operations.push({
      ref: workOrderDoc.ref,
      data: {
        billingStatus: "Expired",
        operationStatus: "Cancelled",
        status: "Expired",
        canceledAt: serverTimestamp(),
        cancelReason: reasonText,
        cancellationReason: reasonText,
        canceledByUserId: actorId,
        canceledByName: actorName,
        ...baseEndPayload,
      },
      options: { merge: true },
    });
  });

  openRepairRequestDocs.forEach((repairRequestDoc) => {
    operations.push({
      ref: repairRequestDoc.ref,
      data: {
        status: REPAIR_REQUEST_STATUS.CANCELLED,
        cancelledAt: serverTimestamp(),
        canceledAt: serverTimestamp(),
        cancelReason: reasonText,
        cancellationReason: reasonText,
        canceledByUserId: actorId,
        canceledByName: actorName,
        ...baseEndPayload,
      },
      options: { merge: true },
    });
  });

  const counts = {
    customer: 1,
    serviceLocations: activeServiceLocationDocs.length,
    bodiesOfWater: bodyDocs.length,
    equipment: equipmentDocs.length,
    routes: activeRouteDocs.length,
    serviceAgreements: activeAgreementDocs.length,
    billingSubscriptions: activeBillingSubscriptionDocs.length,
    billingProfiles: activeBillingProfileDocs.length,
    jobs: openWorkOrderDocs.length,
    repairRequests: openRepairRequestDocs.length,
  };
  const details = {
    serviceLocations: activeServiceLocationDocs,
    bodiesOfWater: bodyDocs,
    equipment: equipmentDocs,
    routes: activeRouteDocs,
    serviceAgreements: activeAgreementDocs,
    billingSubscriptions: activeBillingSubscriptionDocs,
    billingProfiles: activeBillingProfileDocs,
    jobs: openWorkOrderDocs,
    repairRequests: openRepairRequestDocs,
  };
  const noteId = `pipeline_offboarding_${nowMillis}`;
  const noteText = buildOffboardingNote({
    customerName: getCustomerDisplayName(hydratedCustomer),
    row,
    reason: reasonText,
    actorName,
    counts,
    details,
  });

  operations.push({
    ref: doc(db, "companies", companyId, "customers", customerId, "notes", noteId),
    data: {
      id: noteId,
      companyId,
      customerId,
      customerName: getCustomerDisplayName(hydratedCustomer),
      userId: actorId,
      userName: actorName,
      authorId: actorId,
      authorName: actorName,
      note: noteText,
      comment: noteText,
      audience: "internal",
      visibility: "internal",
      resolved: false,
      source: "customerPipeline",
      sourcePipelineRowId: row.id || "",
      date: serverTimestamp(),
      dateMillis: nowMillis,
      createdAt: serverTimestamp(),
      createdAtMillis: nowMillis,
      updatedAt: serverTimestamp(),
      updatedAtMillis: nowMillis,
    },
    options: { merge: true },
  });

  return { operations, counts };
};

const makeRelatedIndexes = ({
  serviceAgreements = [],
  recurringServiceStops = [],
  equipment = [],
  serviceLocations = [],
} = {}) => {
  const byCustomer = (items) => {
    const map = new Map();
    items.forEach((item) => {
      const customerId = item.customerId || item.companyCustomerId || "";
      if (!customerId) return;
      map.set(customerId, [...(map.get(customerId) || []), item]);
    });
    return map;
  };
  const agreementsByLeadId = new Map();
  serviceAgreements.forEach((agreement) => {
    const leadId = agreement.leadId || agreement.sourceLeadId || agreement.homeownerServiceRequestId || "";
    if (!leadId) return;
    agreementsByLeadId.set(leadId, [...(agreementsByLeadId.get(leadId) || []), agreement]);
  });

  return {
    agreementsByCustomerId: byCustomer(serviceAgreements),
    agreementsByLeadId,
    recurringByCustomerId: byCustomer(recurringServiceStops),
    equipmentByCustomerId: byCustomer(equipment),
    photosByCustomerId: serviceLocations.reduce((map, location) => {
      const customerId = location.customerId || location.companyCustomerId || "";
      if (!customerId) return map;
      const photoCount = [
        ...(Array.isArray(location.photoUrls) ? location.photoUrls : []),
        ...(Array.isArray(location.photos) ? location.photos : []),
        location.photoUrl,
        location.imageUrl,
      ].filter(Boolean).length;
      map.set(customerId, (map.get(customerId) || 0) + photoCount);
      return map;
    }, new Map()),
  };
};

const stageAppliesToRow = (row, stage) => {
  if (stage.linkType === "lead" && row.customerId && !row.leadId) return false;
  return true;
};

const linkComplete = (row, stage, relatedIndexes) => {
  const customerId = row.customerId;
  const leadId = row.leadId;

  switch (stage.linkType) {
    case "lead":
      return Boolean(leadId);
    case "customer":
      return Boolean(customerId);
    case "initialEstimate":
      return Boolean(
        row.raw?.estimateId ||
        row.raw?.serviceEstimateServiceStopId ||
        row.raw?.initialEstimateServiceStopId
      );
    case "serviceAgreement":
      return Boolean(
        (customerId && relatedIndexes.agreementsByCustomerId.get(customerId)?.length) ||
        (leadId && relatedIndexes.agreementsByLeadId.get(leadId)?.length) ||
        row.raw?.agreementId ||
        row.raw?.serviceAgreementId
      );
    case "routing":
      return Boolean(
        (customerId && relatedIndexes.recurringByCustomerId.get(customerId)?.length) ||
        row.raw?.recurringServiceStopId ||
        row.raw?.routeId
      );
    case "equipment":
      return Boolean(
        (customerId && relatedIndexes.equipmentByCustomerId.get(customerId)?.length) ||
        (Array.isArray(row.raw?.equipmentIds) && row.raw.equipmentIds.length)
      );
    case "locationPhotos":
      return Boolean(
        (customerId && relatedIndexes.photosByCustomerId.get(customerId) > 0) ||
        Number(row.raw?.locationPhotoCount || 0) > 0
      );
    default:
      return false;
  }
};

const stageCompletion = (row, stage, relatedIndexes) => {
  const applies = stageAppliesToRow(row, stage);
  if (!applies) {
    return {
      applies: false,
      skipped: true,
      signoff: emptySignoff,
      connected: false,
      complete: false,
    };
  }

  const signoff = row.checklist?.[stage.id] || emptySignoff;
  const connected = stage.itemType === "internal" && linkComplete(row, stage, relatedIndexes);
  return {
    applies: true,
    skipped: false,
    signoff,
    connected,
    complete: Boolean(signoff.complete || connected),
  };
};

const rowCompletion = (row, stages, relatedIndexes) => {
  const applicableStages = stages.filter((stage) => stageAppliesToRow(row, stage));
  const status = normalizePipelineStatus(row);
  const ended = isEndedPipelineStatus(status);
  const completed = ended
    ? applicableStages.length
    : applicableStages.filter((stage) => stageCompletion(row, stage, relatedIndexes).complete).length;
  const total = applicableStages.length;

  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : ended ? 100 : 0,
    isComplete: ended || (total > 0 && completed === total),
    isEnded: ended,
    isLost: status === "lost",
    isFired: status === "fired",
    isInactive: status === "inactive",
    isOneOff: status === "oneOff",
    status,
  };
};

const ProgressCard = ({ stage, percent, complete, total }) => {
  const tone = stage.tone || linkTypeTone[stage.linkType] || "slate";
  const Icon = stage.icon || FaClipboardCheck;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-md text-white ${toneClasses[tone] || toneClasses.slate}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-2xl font-bold text-slate-950">{percent}%</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-950">{stage.title}</p>
      <p className="mt-1 text-xs text-slate-500">{complete}/{total} complete</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${toneClasses[tone] || toneClasses.slate}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

const SignoffButton = ({ row, stage, relatedIndexes, onToggle, saving, canUpdate }) => {
  const completion = stageCompletion(row, stage, relatedIndexes);

  if (!completion.applies) {
    return (
      <div className="min-h-[82px] w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <FaRegCircle className="h-4 w-4 text-slate-300" />
          Optional
        </span>
        <span className="mt-2 block text-xs leading-5 text-slate-400">Customer was created without a lead</span>
      </div>
    );
  }

  const complete = completion.complete;
  const signoff = completion.signoff;
  const completedDate = formatDate(signoff.completedAt || signoff.lastChangedAt);
  const completedByName = signoff.completedByName || signoff.lastChangedByName || "Company user";
  const clearedDate = formatDate(signoff.lastChangedAt);
  const clearedByName = signoff.lastChangedByName || "Company user";
  const wasCleared = signoff.lastAction === "cleared" && clearedDate;

  return (
    <button
      type="button"
      onClick={() => onToggle(row, stage)}
      disabled={saving || !canUpdate}
      className={`min-h-[82px] w-full rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        complete
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center gap-2 text-xs font-semibold">
        {complete ? <FaCheckCircle className="h-4 w-4 text-emerald-600" /> : <FaRegCircle className="h-4 w-4 text-slate-300" />}
        {completion.connected ? "Connected" : complete ? "Signed off" : "Needs follow-up"}
      </span>
      {completion.connected ? (
        <span className="mt-2 block text-xs leading-5 text-emerald-800">Found in Drip Drop</span>
      ) : complete ? (
        <span className="mt-2 block text-xs leading-5 text-emerald-800">
          Marked {completedDate || "today"}
          <br />
          by {completedByName}
        </span>
      ) : wasCleared ? (
        <span className="mt-2 block text-xs leading-5 text-slate-400">
          Cleared {clearedDate}
          <br />
          by {clearedByName}
        </span>
      ) : (
        <span className="mt-2 block text-xs leading-5 text-slate-400">
          {!canUpdate ? "View only" : stage.itemType === "internal" ? "Waiting for linked record" : "Click to sign off"}
        </span>
      )}
    </button>
  );
};

function CustomerMigrationTracker() {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    user: authUser,
    dataBaseUser,
  } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const [customers, setCustomers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [rows, setRows] = useState([]);
  const [pipelineItems, setPipelineItems] = useState([]);
  const [leadSources, setLeadSources] = useState([]);
  const [relatedIndexes, setRelatedIndexes] = useState(makeRelatedIndexes());
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("unfinished");
  const [manualName, setManualName] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [showManualRowModal, setShowManualRowModal] = useState(false);
  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [openActionRowId, setOpenActionRowId] = useState("");
  const [statusModal, setStatusModal] = useState(null);
  const [sourceModal, setSourceModal] = useState(null);

  const allStages = useMemo(() => (
    pipelineItems
      .filter((item) => item.active !== false)
      .sort(sortByOrderThenTitle)
      .map((item) => ({
        ...item,
        shortTitle: item.title,
        icon: item.linkType === "routing"
          ? FaRoute
          : item.linkType === "serviceAgreement" || item.linkType === "initialEstimate"
            ? FaFileInvoiceDollar
            : item.linkType === "customer"
              ? FaUsers
              : FaClipboardCheck,
        tone: linkTypeTone[item.linkType] || "slate",
      }))
  ), [pipelineItems]);

  const rowsByCustomerId = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (row.customerId) map.set(row.customerId, row);
    });
    return map;
  }, [rows]);

  const rowsByLeadId = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (row.leadId) map.set(row.leadId, row);
    });
    return map;
  }, [rows]);

  const missingCustomerCount = customers.filter((customer) => !rowsByCustomerId.has(customer.id)).length;
  const missingLeadCount = leads.filter((lead) => !rowsByLeadId.has(lead.id)).length;
  const activeLeadSourceOptions = useMemo(() => (
    leadSources
      .filter((source) => source.active !== false)
      .sort(sortByOrderThenTitle)
  ), [leadSources]);
  const canCreatePipeline = can(PIPELINE_CREATE_PERMISSION_ID);
  const canUpdatePipeline = can(PIPELINE_UPDATE_PERMISSION_ID);

  const visibleRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return rows
      .filter((row) => !search || rowSearchText(row).includes(search))
      .filter((row) => {
        const completion = rowCompletion(row, allStages, relatedIndexes);
        if (statusFilter === "all") return true;
        if (statusFilter === "lost") return completion.isLost;
        if (statusFilter === "fired") return completion.isFired;
        if (statusFilter === "inactive") return completion.isInactive;
        if (statusFilter === "oneOff") return completion.isOneOff;
        if (statusFilter === "complete") return completion.status === "complete" || completion.isOneOff || (!completion.isEnded && completion.isComplete);
        if (statusFilter === "notStarted") return !completion.isEnded && completion.completed === 0;
        if (statusFilter === "inProgress") return !completion.isEnded && completion.completed > 0 && !completion.isComplete;
        return !completion.isEnded && !completion.isComplete;
      })
      .sort((left, right) => {
        const leftCompletion = rowCompletion(left, allStages, relatedIndexes);
        const rightCompletion = rowCompletion(right, allStages, relatedIndexes);
        if (leftCompletion.percent !== rightCompletion.percent) return leftCompletion.percent - rightCompletion.percent;
        return left.customerName.localeCompare(right.customerName);
      });
  }, [allStages, relatedIndexes, rows, searchTerm, statusFilter]);

  const stageStats = useMemo(() => {
    return allStages.map((stage) => {
      const applicableRows = rows.filter((row) => stageAppliesToRow(row, stage));
      const total = applicableRows.length;
      const complete = applicableRows.filter((row) => stageCompletion(row, stage, relatedIndexes).complete).length;
      return {
        ...stage,
        complete,
        total,
        percent: total ? Math.round((complete / total) * 100) : 0,
      };
    });
  }, [allStages, relatedIndexes, rows]);

  const totalStats = useMemo(() => {
    const rowStats = rows.map((row) => rowCompletion(row, allStages, relatedIndexes));
    const total = rowStats.reduce((sum, stat) => sum + stat.total, 0);
    const complete = rowStats.reduce((sum, stat) => sum + stat.completed, 0);

    return {
      title: "Total Complete",
      icon: FaCheck,
      tone: "slate",
      complete,
      total,
      percent: total ? Math.round((complete / total) * 100) : 0,
    };
  }, [allStages, relatedIndexes, rows]);

  const loadPipeline = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setCustomers([]);
      setLeads([]);
      setRows([]);
      setPipelineItems([]);
      setLeadSources([]);
      setRelatedIndexes(makeRelatedIndexes());
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [
        customerSnap,
        leadSnap,
        pipelineSnap,
        legacySnap,
        templateSnap,
        leadSourceSnap,
        agreementSnap,
        recurringSnap,
        equipmentSnap,
        serviceLocationSnap,
      ] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
        getDocs(query(collection(db, "homeownerServiceRequests"), where("companyId", "==", recentlySelectedCompany))),
        getDocs(customerPipelineRowsRef(recentlySelectedCompany)),
        getDocs(collection(db, "companies", recentlySelectedCompany, LEGACY_CUSTOMER_MIGRATION_COLLECTION)),
        getDocs(query(pipelineTemplateItemsRef(recentlySelectedCompany), orderBy("sortOrder", "asc"))),
        getDocs(query(pipelineLeadSourcesRef(recentlySelectedCompany), orderBy("sortOrder", "asc"))),
        getDocs(query(collection(db, "salesAgreements"), where("companyId", "==", recentlySelectedCompany))),
        getDocs(collection(db, "companies", recentlySelectedCompany, "recurringServiceStop")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "equipment")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "serviceLocations")),
      ]);

      const nextCustomers = customerSnap.docs
        .map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() }))
        .sort((left, right) => getCustomerDisplayName(left).localeCompare(getCustomerDisplayName(right)));
      const nextLeads = leadSnap.docs.map((leadDoc) => ({ id: leadDoc.id, ...leadDoc.data() }));
      const pipelineRows = pipelineSnap.docs.map((rowDoc) => normalizeRow(rowDoc, CUSTOMER_PIPELINE_COLLECTION));
      const legacyRows = legacySnap.docs.map((rowDoc) => normalizeRow(rowDoc, LEGACY_CUSTOMER_MIGRATION_COLLECTION));
      const rowsById = new Map();
      legacyRows.forEach((row) => rowsById.set(row.id, row));
      pipelineRows.forEach((row) => rowsById.set(row.id, row));
      const leadsById = new Map(nextLeads.map((lead) => [lead.id, lead]));
      const nextRows = [...rowsById.values()].map((row) => {
        const lead = row.leadId ? leadsById.get(row.leadId) : null;
        if (!lead) return row;

        return {
          ...row,
          raw: {
            ...row.raw,
            estimateId: row.raw?.estimateId || lead.estimateId || "",
            serviceAgreementId: row.raw?.serviceAgreementId || lead.serviceAgreementId || "",
            serviceEstimateServiceStopId: row.raw?.serviceEstimateServiceStopId || lead.serviceEstimateServiceStopId || "",
            initialEstimateServiceStopId: row.raw?.initialEstimateServiceStopId || lead.initialEstimateServiceStopId || "",
          },
        };
      });

      setCustomers(nextCustomers);
      setLeads(nextLeads);
      setRows(nextRows);
      setPipelineItems(
        templateSnap.empty
          ? DEFAULT_PIPELINE_TEMPLATE_ITEMS.map(normalizePipelineItem)
          : templateSnap.docs.map((itemDoc, index) => normalizePipelineItem({ id: itemDoc.id, ...itemDoc.data() }, index * 10))
      );
      setLeadSources(
        leadSourceSnap.empty
          ? DEFAULT_LEAD_SOURCES.map(normalizeLeadSourceItem)
          : leadSourceSnap.docs.map((sourceDoc, index) => normalizeLeadSourceItem({ id: sourceDoc.id, ...sourceDoc.data() }, index * 10))
      );
      setRelatedIndexes(makeRelatedIndexes({
        serviceAgreements: agreementSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })),
        recurringServiceStops: recurringSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })),
        equipment: equipmentSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })),
        serviceLocations: serviceLocationSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })),
      }));
    } catch (error) {
      console.error("Unable to load customer pipeline:", error);
      toast.error("Could not load the customer pipeline.");
    } finally {
      setLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  const handleSyncCustomers = async () => {
    if (!recentlySelectedCompany) return;
    if (!requirePermission(PIPELINE_CREATE_PERMISSION_ID, "create pipeline rows")) return;

    const missingCustomers = customers.filter((customer) => !rowsByCustomerId.has(customer.id));
    if (!missingCustomers.length) {
      toast.success("All current customers are already on the pipeline.");
      return;
    }

    setSavingKey("sync-customers");

    try {
      const createdRows = [];
      let batch = writeBatch(db);
      let batchCount = 0;
      let committedCount = 0;

      for (const customer of missingCustomers) {
        const rowId = pipelineRowIdForCustomer(customer);
        const row = {
          id: rowId,
          companyId: recentlySelectedCompany,
          customerId: customer.id,
          leadId: customer.sourceHomeownerServiceRequestId || customer.leadId || "",
          source: customer.source || customer.migrationSource?.provider || "customer",
          leadSource: customer.leadSource || customer.marketingSource || customer.sourceName || "",
          leadStatus: "",
          pipelineStatus: "active",
          customerName: getCustomerDisplayName(customer),
          contact: getCustomerContact(customer),
          notes: "",
          checklist: {},
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        batch.set(customerPipelineRowRef(recentlySelectedCompany, rowId), row, { merge: true });
        createdRows.push({ ...row, createdAt: new Date(), updatedAt: new Date() });
        batchCount += 1;

        if (batchCount === 450) {
          await batch.commit();
          committedCount += batchCount;
          batch = writeBatch(db);
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
        committedCount += batchCount;
      }

      setRows((currentRows) => [...currentRows, ...createdRows.map((row) => normalizeRow({ id: row.id, data: () => row }))]);
      toast.success(`Added ${committedCount} customer(s) to the pipeline.`);
    } catch (error) {
      console.error("Unable to sync pipeline customers:", error);
      toast.error("Could not sync customers to the pipeline.");
    } finally {
      setSavingKey("");
    }
  };

  const handleSyncLeads = async () => {
    if (!recentlySelectedCompany) return;
    if (!requirePermission(PIPELINE_CREATE_PERMISSION_ID, "create pipeline rows")) return;

    const missingLeads = leads.filter((lead) => !rowsByLeadId.has(lead.id));
    if (!missingLeads.length) {
      toast.success("All current leads are already on the pipeline.");
      return;
    }

    setSavingKey("sync-leads");

    try {
      const batch = writeBatch(db);
      const createdRows = missingLeads.map(normalizeLeadToPipelineRow);
      createdRows.forEach((row) => {
        batch.set(customerPipelineRowRef(recentlySelectedCompany, row.id), {
          ...row,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      setRows((currentRows) => [...currentRows, ...createdRows.map((row) => normalizeRow({ id: row.id, data: () => row }))]);
      toast.success(`Added ${createdRows.length} lead(s) to the pipeline.`);
    } catch (error) {
      console.error("Unable to sync leads to pipeline:", error);
      toast.error("Could not sync leads to the pipeline.");
    } finally {
      setSavingKey("");
    }
  };

  const handleAddManualPipeline = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;
    if (!requirePermission(PIPELINE_CREATE_PERMISSION_ID, "create pipeline rows")) return;

    const name = manualName.trim();
    if (!name) {
      toast.error("Add a customer or lead name first.");
      return;
    }

    setSavingKey("manual-pipeline");

    try {
      const rowId = `manual_${Date.now()}`;
      const row = {
        id: rowId,
        companyId: recentlySelectedCompany,
        customerId: "",
        leadId: "",
        source: "manual",
        leadSource: "Manual",
        leadStatus: "",
        pipelineStatus: "active",
        customerName: name,
        contact: "",
        notes: manualNote.trim(),
        checklist: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(customerPipelineRowRef(recentlySelectedCompany, rowId), row, { merge: true });
      setRows((currentRows) => [...currentRows, normalizeRow({ id: rowId, data: () => ({ ...row, createdAt: new Date(), updatedAt: new Date() }) })]);
      setManualName("");
      setManualNote("");
      setShowManualRowModal(false);
      toast.success("Pipeline row added.");
    } catch (error) {
      console.error("Unable to add manual pipeline row:", error);
      toast.error("Could not add this pipeline row.");
    } finally {
      setSavingKey("");
    }
  };

  const handleToggleStage = async (row, stage) => {
    if (!recentlySelectedCompany) return;
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "update pipeline signoffs")) return;

    const key = `${row.id}:${stage.id}`;
    const currentSignoff = row.checklist?.[stage.id] || emptySignoff;
    const isComplete = !!currentSignoff.complete;
    const actorId = getActorId(dataBaseUser, authUser);
    const actorName = getActorName(dataBaseUser, authUser);
    const changedAt = serverTimestamp();
    const nextSignoff = isComplete
      ? {
          ...emptySignoff,
          lastChangedAt: changedAt,
          lastChangedByUserId: actorId,
          lastChangedByName: actorName,
          lastAction: "cleared",
        }
      : {
          complete: true,
          completedAt: changedAt,
          completedByUserId: actorId,
          completedByName: actorName,
          lastChangedAt: changedAt,
          lastChangedByUserId: actorId,
          lastChangedByName: actorName,
          lastAction: "completed",
        };
    const optimisticChangedAt = new Date();
    const optimisticSignoff = isComplete
      ? {
          ...emptySignoff,
          lastChangedAt: optimisticChangedAt,
          lastChangedByUserId: actorId,
          lastChangedByName: actorName,
          lastAction: "cleared",
        }
      : {
          ...nextSignoff,
          completedAt: optimisticChangedAt,
          lastChangedAt: optimisticChangedAt,
        };

    setSavingKey(key);

    try {
      await setDoc(customerPipelineRowRef(recentlySelectedCompany, row.id), {
        id: row.id,
        companyId: recentlySelectedCompany,
        customerId: row.customerId || "",
        leadId: row.leadId || "",
        customerName: row.customerName || "",
        contact: row.contact || "",
        source: row.source || "manual",
        leadSource: row.leadSource || "",
        checklist: {
          [stage.id]: nextSignoff,
        },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setRows((currentRows) => currentRows.map((currentRow) => (
        currentRow.id === row.id
          ? {
              ...currentRow,
              sourceCollection: CUSTOMER_PIPELINE_COLLECTION,
              checklist: {
                ...currentRow.checklist,
                [stage.id]: optimisticSignoff,
              },
              updatedAt: new Date(),
            }
          : currentRow
      )));
    } catch (error) {
      console.error("Unable to update pipeline signoff:", error);
      toast.error("Could not save this signoff.");
    } finally {
      setSavingKey("");
    }
  };

  const handleSaveRowNote = async (row, notes) => {
    if (!recentlySelectedCompany || notes === row.notes) return;
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "update pipeline notes")) return;
    const actorId = getActorId(dataBaseUser, authUser);
    const actorName = getActorName(dataBaseUser, authUser);

    try {
      await setDoc(customerPipelineRowRef(recentlySelectedCompany, row.id), {
        id: row.id,
        companyId: recentlySelectedCompany,
        customerId: row.customerId || "",
        leadId: row.leadId || "",
        customerName: row.customerName || "",
        contact: row.contact || "",
        source: row.source || "manual",
        leadSource: row.leadSource || "",
        notes,
        updatedAt: serverTimestamp(),
        updatedByUserId: actorId,
        updatedByName: actorName,
      }, { merge: true });
      setRows((currentRows) => currentRows.map((currentRow) => (
        currentRow.id === row.id ? { ...currentRow, notes, sourceCollection: CUSTOMER_PIPELINE_COLLECTION } : currentRow
      )));
    } catch (error) {
      console.error("Unable to save pipeline note:", error);
      toast.error("Could not save this note.");
    }
  };

  const openStatusModal = (row, nextStatus = normalizePipelineStatus(row)) => {
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "update pipeline statuses")) return;

    setStatusModal({
      row,
      nextStatus,
      reason: nextStatus === "fired" ? (row.firedReason || "") : nextStatus === "lost" ? (row.lostReason || "") : "",
      cascade: false,
    });
    setOpenActionRowId("");
  };

  const closeStatusModal = () => setStatusModal(null);

  const openSourceModal = (row) => {
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "update pipeline sources")) return;

    setSourceModal({
      row,
      source: row.leadSource || activeLeadSourceOptions[0]?.name || "Unknown",
      customSource: "",
    });
    setOpenActionRowId("");
  };

  const closeSourceModal = () => setSourceModal(null);

  const saveRowSource = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany || !sourceModal?.row) return;
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "update pipeline sources")) return;

    const row = sourceModal.row;
    const actorId = getActorId(dataBaseUser, authUser);
    const actorName = getActorName(dataBaseUser, authUser);
    const customSource = String(sourceModal.customSource || "").trim();
    const selectedSource = String(sourceModal.source || "").trim();
    const nextSource = customSource || selectedSource;
    const linkedLead = getLoadedCompanyLead(leads, row.leadId, recentlySelectedCompany);

    if (!nextSource) {
      toast.error("Choose or add a lead source first.");
      return;
    }

    setSavingKey(`source:${row.id}`);

    try {
      const batch = writeBatch(db);
      batch.set(customerPipelineRowRef(recentlySelectedCompany, row.id), {
        id: row.id,
        companyId: recentlySelectedCompany,
        customerId: row.customerId || "",
        leadId: row.leadId || "",
        customerName: row.customerName || "",
        contact: row.contact || "",
        source: row.source || "manual",
        leadSource: nextSource,
        sourceUpdatedAt: serverTimestamp(),
        sourceUpdatedByUserId: actorId,
        sourceUpdatedByName: actorName,
        updatedAt: serverTimestamp(),
        updatedByUserId: actorId,
        updatedByName: actorName,
      }, { merge: true });

      if (linkedLead) {
        batch.set(doc(db, "homeownerServiceRequests", row.leadId), {
          companyId: recentlySelectedCompany,
          leadSource: nextSource,
          marketingSource: nextSource,
          sourceLabel: nextSource,
          updatedAt: serverTimestamp(),
          updatedByUserId: actorId,
          updatedByName: actorName,
        }, { merge: true });
      }

      const sourceExists = leadSources.some((source) => (
        normalizeStatusText(source.name) === normalizeStatusText(nextSource)
      ));
      if (!sourceExists) {
        const nextSourceId = leadSourceId(nextSource);
        batch.set(doc(pipelineLeadSourcesRef(recentlySelectedCompany), nextSourceId), {
          id: nextSourceId,
          name: nextSource,
          active: true,
          sortOrder: (leadSources.length + 1) * 10,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      await batch.commit();

      setRows((currentRows) => currentRows.map((currentRow) => (
        currentRow.id === row.id
          ? {
              ...currentRow,
              leadSource: nextSource,
              sourceCollection: CUSTOMER_PIPELINE_COLLECTION,
              raw: {
                ...currentRow.raw,
                leadSource: nextSource,
                marketingSource: nextSource,
                sourceLabel: nextSource,
              },
            }
          : currentRow
      )));
      setLeads((currentLeads) => currentLeads.map((lead) => (
        lead.id === row.leadId
          ? { ...lead, leadSource: nextSource, marketingSource: nextSource, sourceLabel: nextSource }
          : lead
      )));
      setLeadSources((currentSources) => (
        currentSources.some((source) => normalizeStatusText(source.name) === normalizeStatusText(nextSource))
          ? currentSources
          : [
              ...currentSources,
              normalizeLeadSourceItem({
                id: leadSourceId(nextSource),
                name: nextSource,
                active: true,
                sortOrder: (currentSources.length + 1) * 10,
              }),
            ]
      ));
      toast.success("Pipeline source updated.");
      closeSourceModal();
    } catch (error) {
      console.error("Unable to update pipeline source:", error);
      toast.error("Could not update this source.");
    } finally {
      setSavingKey("");
    }
  };

  const saveRowLifecycleStatus = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany || !statusModal?.row) return;
    if (!requirePermission(PIPELINE_UPDATE_PERMISSION_ID, "update pipeline statuses")) return;

    const row = statusModal.row;
    const nextStatus = statusModal.nextStatus;
    const reason = String(statusModal.reason || "").trim();
    const actorId = getActorId(dataBaseUser, authUser);
    const actorName = getActorName(dataBaseUser, authUser);
    const linkedLead = getLoadedCompanyLead(leads, row.leadId, recentlySelectedCompany);

    if (nextStatus === "fired" && !row.customerId) {
      toast.error("Link this row to a customer before marking it as fired us.");
      return;
    }

    setSavingKey(`status:${row.id}`);
    try {
      const endedPayload = {
        endedAt: serverTimestamp(),
        endedReason: reason,
        endedByUserId: actorId,
        endedByName: actorName,
      };
      const clearedEndPayload = {
        endedAt: null,
        endedReason: "",
        endedByUserId: "",
        endedByName: "",
      };
      const payloadByStatus = {
        active: {
          pipelineStatus: "active",
          lifecycleStatus: "active",
          firedUs: false,
          firedReason: "",
          firedAt: null,
          firedByUserId: "",
          firedByName: "",
          lostReason: "",
          lostAt: null,
          lostByUserId: "",
          lostByName: "",
          hiredForOneOff: false,
          hiredForOneOffAt: null,
          hiredForOneOffByUserId: "",
          hiredForOneOffByName: "",
          completedAt: null,
          completedByUserId: "",
          completedByName: "",
          ...clearedEndPayload,
        },
        complete: {
          pipelineStatus: "complete",
          lifecycleStatus: "complete",
          firedUs: false,
          firedReason: "",
          firedAt: null,
          firedByUserId: "",
          firedByName: "",
          lostReason: "",
          lostAt: null,
          lostByUserId: "",
          lostByName: "",
          hiredForOneOff: false,
          hiredForOneOffAt: null,
          hiredForOneOffByUserId: "",
          hiredForOneOffByName: "",
          completedAt: serverTimestamp(),
          completedByUserId: actorId,
          completedByName: actorName,
          ...endedPayload,
        },
        oneOff: {
          pipelineStatus: "oneOff",
          lifecycleStatus: "oneOff",
          firedUs: false,
          firedReason: "",
          firedAt: null,
          firedByUserId: "",
          firedByName: "",
          lostReason: "",
          lostAt: null,
          lostByUserId: "",
          lostByName: "",
          hiredForOneOff: true,
          hiredForOneOffAt: serverTimestamp(),
          hiredForOneOffByUserId: actorId,
          hiredForOneOffByName: actorName,
          completedAt: serverTimestamp(),
          completedByUserId: actorId,
          completedByName: actorName,
          ...endedPayload,
        },
        lost: {
          pipelineStatus: "lost",
          lifecycleStatus: "lost",
          firedUs: false,
          firedReason: "",
          firedAt: null,
          firedByUserId: "",
          firedByName: "",
          lostReason: reason,
          lostAt: serverTimestamp(),
          lostByUserId: actorId,
          lostByName: actorName,
          hiredForOneOff: false,
          hiredForOneOffAt: null,
          hiredForOneOffByUserId: "",
          hiredForOneOffByName: "",
          completedAt: null,
          completedByUserId: "",
          completedByName: "",
          ...endedPayload,
        },
        fired: {
          pipelineStatus: "fired",
          lifecycleStatus: "fired",
          firedUs: true,
          firedReason: reason,
          firedAt: serverTimestamp(),
          firedByUserId: actorId,
          firedByName: actorName,
          lostReason: "",
          lostAt: null,
          lostByUserId: "",
          lostByName: "",
          hiredForOneOff: false,
          hiredForOneOffAt: null,
          hiredForOneOffByUserId: "",
          hiredForOneOffByName: "",
          completedAt: null,
          completedByUserId: "",
          completedByName: "",
          ...endedPayload,
        },
      };
      const payload = payloadByStatus[nextStatus] || payloadByStatus.active;
      const operations = [{
        ref: customerPipelineRowRef(recentlySelectedCompany, row.id),
        data: {
          id: row.id,
          companyId: recentlySelectedCompany,
          customerId: row.customerId || "",
          leadId: row.leadId || "",
          customerName: row.customerName || "",
          contact: row.contact || "",
          source: row.source || "manual",
          leadSource: row.leadSource || "",
          ...payload,
          updatedAt: serverTimestamp(),
          updatedByUserId: actorId,
          updatedByName: actorName,
        },
        options: { merge: true },
      }];

      if (linkedLead && ["active", "complete", "oneOff", "lost"].includes(nextStatus)) {
        const leadStatusPayload = nextStatus === "lost"
          ? {
              status: "Cancelled",
              leadStatus: "Cancelled",
              cancelReason: reason,
              lostReason: reason,
              statusChangeReason: reason,
              cancelledAt: serverTimestamp(),
              dateCompleted: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }
          : ["complete", "oneOff"].includes(nextStatus)
            ? {
                status: "Completed",
                leadStatus: "Completed",
                cancelReason: "",
                lostReason: "",
                statusChangeReason: "",
                hiredForOneOff: nextStatus === "oneOff",
                hiredForOneOffAt: nextStatus === "oneOff" ? serverTimestamp() : null,
                dateCompleted: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }
            : {
                status: "In Progress",
                leadStatus: "In Progress",
                cancelReason: "",
                lostReason: "",
                statusChangeReason: "",
                hiredForOneOff: false,
                hiredForOneOffAt: null,
                updatedAt: serverTimestamp(),
              };
        operations.push({
          ref: doc(db, "homeownerServiceRequests", row.leadId),
          data: {
            companyId: recentlySelectedCompany,
            ...leadStatusPayload,
          },
          options: { merge: true },
        });
      }

      let offboardingResult = null;
      if (nextStatus === "fired" && statusModal.cascade) {
        const customer = customers.find((item) => item.id === row.customerId) || {
          id: row.customerId,
          customerName: row.customerName,
        };
        offboardingResult = await buildCustomerOffboardingOperations({
          companyId: recentlySelectedCompany,
          row,
          customer,
          reason,
          actorId,
          actorName,
        });
        operations.push(...offboardingResult.operations);
      }

      await commitSetOperations(operations);

      const now = new Date();
      const nextLeadStatus = nextStatus === "lost"
        ? "Cancelled"
        : ["complete", "oneOff"].includes(nextStatus)
          ? "Completed"
          : nextStatus === "active"
            ? "In Progress"
            : row.leadStatus;

      setRows((currentRows) => currentRows.map((currentRow) => (
        currentRow.id === row.id
          ? {
              ...currentRow,
              sourceCollection: CUSTOMER_PIPELINE_COLLECTION,
              pipelineStatus: nextStatus,
              leadStatus: nextLeadStatus,
              lostReason: nextStatus === "lost" ? reason : "",
              firedReason: nextStatus === "fired" ? reason : "",
              firedAt: nextStatus === "fired" ? now : null,
              completedAt: ["complete", "oneOff"].includes(nextStatus) ? now : null,
              raw: {
                ...currentRow.raw,
                ...payload,
                pipelineStatus: nextStatus,
                leadStatus: nextLeadStatus,
                lostReason: nextStatus === "lost" ? reason : "",
                firedReason: nextStatus === "fired" ? reason : "",
                firedAt: nextStatus === "fired" ? now : null,
                hiredForOneOff: nextStatus === "oneOff",
                hiredForOneOffAt: nextStatus === "oneOff" ? now : null,
                completedAt: ["complete", "oneOff"].includes(nextStatus) ? now : null,
              },
            }
          : currentRow
      )));
      if (nextStatus === "fired" && statusModal.cascade && row.customerId) {
        setCustomers((currentCustomers) => currentCustomers.map((customer) => (
          customer.id === row.customerId
            ? { ...customer, active: false, isActive: false, status: "inactive", firedUs: true, firedReason: reason }
            : customer
        )));
      }
      const offboardCount = offboardingResult
        ? Object.values(offboardingResult.counts).reduce((sum, count) => sum + Number(count || 0), 0)
        : 0;
      const toastMessage = nextStatus === "fired"
        ? statusModal.cascade
          ? `Customer marked fired us and ${offboardCount} linked record(s) were ended.`
          : "Customer marked as fired us."
        : nextStatus === "lost"
          ? "Pipeline row marked lost."
          : nextStatus === "complete"
            ? "Pipeline row marked complete."
            : nextStatus === "oneOff"
              ? "Pipeline row marked hired for one off."
            : "Pipeline row reactivated.";
      toast.success(toastMessage);
      closeStatusModal();
    } catch (error) {
      console.error("Unable to update pipeline status:", error);
      toast.error("Could not update this pipeline status.");
    } finally {
      setSavingKey("");
    }
  };

  if (!recentlySelectedCompany) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-5">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Select a company to view the customer pipeline.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5">
      <div className="mb-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Customer setup</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Pipeline</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              Track leads and customers through customer setup, estimates, service agreements, routing, equipment, photos, and any outside-the-app follow-up.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-400">{recentlySelectedCompanyName || "Selected company"}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/company/reports"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <FaFilter className="h-3.5 w-3.5" />
              Reports
            </Link>
            {canUpdatePipeline ? (
              <button
                type="button"
                onClick={() => setShowPipelineSettings(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FaCog className="h-3.5 w-3.5" />
                Pipeline Settings
              </button>
            ) : null}
            {canCreatePipeline ? (
              <>
                <button
                  type="button"
                  onClick={handleSyncLeads}
                  disabled={loading || savingKey === "sync-leads"}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSyncAlt className="h-3.5 w-3.5" />
                  {savingKey === "sync-leads" ? "Syncing..." : `Sync Leads${missingLeadCount ? ` (${missingLeadCount})` : ""}`}
                </button>
                <button
                  type="button"
                  onClick={handleSyncCustomers}
                  disabled={loading || savingKey === "sync-customers"}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSyncAlt className="h-3.5 w-3.5" />
                  {savingKey === "sync-customers" ? "Syncing..." : `Sync Customers${missingCustomerCount ? ` (${missingCustomerCount})` : ""}`}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stageStats.slice(0, 3).map((stage) => (
          <ProgressCard key={stage.id} stage={stage} complete={stage.complete} total={stage.total} percent={stage.percent} />
        ))}
        <ProgressCard stage={totalStats} complete={totalStats.complete} total={totalStats.total} percent={totalStats.percent} />
      </section>

      <section className="mb-5">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Pipeline List</h2>
              <p className="mt-1 text-sm text-slate-500">
                Defaults to unfinished rows. Use all statuses when reviewing won, lost, and completed history.
              </p>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-[minmax(360px,1fr)_190px_auto] xl:w-[760px] 2xl:w-[920px]">
              <label className="relative block">
                <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search pipeline"
                  className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="unfinished">Unfinished</option>
                <option value="all">All statuses</option>
                <option value="notStarted">Not started</option>
                <option value="inProgress">In progress</option>
                <option value="complete">Complete / one off</option>
                <option value="oneOff">Hired for one off</option>
                <option value="lost">Lost / cancelled</option>
                <option value="fired">Fired us</option>
                <option value="inactive">Inactive</option>
              </select>
              {canCreatePipeline ? (
                <button
                  type="button"
                  onClick={() => setShowManualRowModal(true)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <FaPlus className="h-3.5 w-3.5" />
                  Add Manual Row
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Loading customer pipeline...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <FaClipboardCheck className="mx-auto h-8 w-8 text-slate-300" />
            <h2 className="mt-3 text-base font-semibold text-slate-950">Start the pipeline</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {canCreatePipeline
                ? "Sync existing leads and customers, or add a manual row for outside-the-app follow-through."
                : "Pipeline rows will appear here after someone with create access syncs or adds them."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-10 w-[240px] min-w-[240px] max-w-[240px] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Pipeline
                  </th>
                  {allStages.map((stage) => (
                    <th key={stage.id} className="min-w-[172px] px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {stage.shortTitle}
                    </th>
                  ))}
                  <th className="min-w-[420px] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {visibleRows.map((row) => {
                  const completion = rowCompletion(row, allStages, relatedIndexes);
                  const statusMeta = getPipelineStatusMeta(completion.status);
                  const detailPath = row.leadId
                    ? `/company/leads/${row.leadId}`
                    : row.customerId
                      ? `/company/customers/details/${row.customerId}`
                      : "";

                  return (
                    <tr key={row.id} className="align-top">
                      <td className="sticky left-0 z-10 w-[240px] min-w-[240px] max-w-[240px] bg-white px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {detailPath ? (
                                  <Link to={detailPath} className="block max-w-[176px] truncate font-semibold text-slate-950 hover:text-blue-700">{row.customerName}</Link>
                                ) : (
                                  <p className="max-w-[176px] truncate font-semibold text-slate-950">{row.customerName}</p>
                                )}
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                                  {row.leadId ? "Lead" : row.customerId ? "Customer" : "Manual"}
                                </span>
                                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}>
                                  {statusMeta.label}
                                </span>
                              </div>
                            </div>
                            {canUpdatePipeline ? (
                              <div className="relative shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setOpenActionRowId((currentId) => (currentId === row.id ? "" : row.id))}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                                  aria-label={`Actions for ${row.customerName}`}
                                >
                                  <FaEllipsisV className="h-3.5 w-3.5" />
                                </button>
                                {openActionRowId === row.id ? (
                                  <div className="absolute right-0 top-9 z-30 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                                    <button
                                      type="button"
                                      onClick={() => openStatusModal(row)}
                                      className="block w-full px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                      Change status
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openSourceModal(row)}
                                      className="block w-full px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                      Change source
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          {row.contact ? <p className="mt-1 text-xs text-slate-500">{row.contact}</p> : null}
                          <div className="mt-2 flex flex-wrap gap-1 text-xs text-slate-500">
                            {row.leadSource ? <span>Source: {row.leadSource}</span> : null}
                            {row.leadStatus ? <span>Lead: {row.leadStatus}</span> : null}
                          </div>
                          {row.lostReason ? <p className="mt-2 text-xs leading-5 text-rose-700">Reason: {row.lostReason}</p> : null}
                          {row.firedReason ? <p className="mt-2 text-xs leading-5 text-orange-700">Fired reason: {row.firedReason}</p> : null}
                          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${completion.percent}%` }} />
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{completion.percent}% complete</p>
                        </div>
                      </td>
                      {allStages.map((stage) => (
                        <td key={`${row.id}-${stage.id}`} className="px-3 py-3">
                          <SignoffButton
                            row={row}
                            stage={stage}
                            relatedIndexes={relatedIndexes}
                            saving={savingKey === `${row.id}:${stage.id}`}
                            onToggle={handleToggleStage}
                            canUpdate={canUpdatePipeline}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-3 text-sm leading-6 text-slate-500">
                        <textarea
                          defaultValue={row.notes || ""}
                          onBlur={(event) => handleSaveRowNote(row, event.target.value)}
                          placeholder="Add setup notes..."
                          rows={4}
                          disabled={!canUpdatePipeline}
                          className="w-full min-w-[420px] resize-none rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visibleRows.length ? (
              <div className="border-t border-slate-200 p-5 text-sm text-slate-500">
                No pipeline rows match the current filter.
              </div>
            ) : null}
          </div>
        )}
      </section>

      {showPipelineSettings && canUpdatePipeline ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Pipeline Settings</h2>
                <p className="mt-1 text-sm text-slate-500">Edit customer onboarding pipeline items and lead sources.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPipelineSettings(false)}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="p-5">
              <CustomerPipelineSettingsPanel companyId={recentlySelectedCompany} compact onChange={loadPipeline} />
            </div>
          </div>
        </div>
      ) : null}

      {showManualRowModal && canCreatePipeline ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <form onSubmit={handleAddManualPipeline} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2">
              <FaUserPlus className="h-4 w-4 text-slate-500" />
              <h2 className="text-lg font-semibold text-slate-950">Add Manual Row</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Add outside-the-app follow-up to the pipeline without creating a lead or customer yet.
            </p>
            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Customer or lead name</span>
              <input
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                placeholder="Customer or lead name"
                className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Short note</span>
              <input
                value={manualNote}
                onChange={(event) => setManualNote(event.target.value)}
                placeholder="Short note"
                className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowManualRowModal(false)}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingKey === "manual-pipeline"}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaPlus className="h-3.5 w-3.5" />
                {savingKey === "manual-pipeline" ? "Adding..." : "Add to Pipeline"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {statusModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <form onSubmit={saveRowLifecycleStatus} className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-950">Change Pipeline Status</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Update where "{statusModal.row.customerName}" stands. Ended rows count as complete and stay out of the default unfinished view.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { value: "active", label: "Active" },
                { value: "complete", label: "Complete" },
                { value: "oneOff", label: "Hired for one off" },
                { value: "lost", label: "Lead ended" },
                { value: "fired", label: "Fired us", disabled: !statusModal.row.customerId },
              ].map((option) => {
                const selected = statusModal.nextStatus === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => setStatusModal((current) => ({
                      ...current,
                      nextStatus: option.value,
                      reason: option.value === "fired"
                        ? current.reason || current.row.firedReason || ""
                        : option.value === "lost"
                          ? current.reason || current.row.lostReason || ""
                          : "",
                      cascade: option.value === "fired" ? current.cascade : false,
                    }))}
                    className={`rounded-md border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {["lost", "fired"].includes(statusModal.nextStatus) ? (
              <label className="mt-4 block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Reason</span>
                <textarea
                  value={statusModal.reason}
                  onChange={(event) => setStatusModal((current) => ({ ...current, reason: event.target.value }))}
                  rows={4}
                  placeholder={statusModal.nextStatus === "lost" ? "Why did this lead end or not close?" : "Why did the customer stop service?"}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            ) : null}

            {statusModal.nextStatus === "fired" && statusModal.row.customerId ? (
              <label className="mt-4 flex gap-3 rounded-md border border-orange-200 bg-orange-50 p-3">
                <input
                  type="checkbox"
                  checked={statusModal.cascade}
                  onChange={(event) => setStatusModal((current) => ({ ...current, cascade: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                />
                <span>
                  <span className="block text-sm font-semibold text-orange-900">End linked customer records</span>
                  <span className="mt-1 block text-xs leading-5 text-orange-800">
                    Makes customer records inactive, ends routes and agreements, cancels open jobs and repair requests, turns off billing setup, and creates an internal customer note.
                  </span>
                </span>
              </label>
            ) : statusModal.nextStatus === "fired" ? (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Fired us can only be used after this row is linked to a customer.
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeStatusModal}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingKey === `status:${statusModal.row.id}`}
                className={`rounded-md px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  statusModal.nextStatus === "fired" ? "bg-orange-600 hover:bg-orange-700" : "bg-slate-950 hover:bg-slate-800"
                }`}
              >
                {savingKey === `status:${statusModal.row.id}`
                  ? "Saving..."
                  : statusModal.nextStatus === "fired"
                    ? "Mark Fired Us"
                  : statusModal.nextStatus === "lost"
                    ? "Mark Lead Ended"
                    : statusModal.nextStatus === "oneOff"
                      ? "Mark Hired One Off"
                      : statusModal.nextStatus === "complete"
                        ? "Mark Complete"
                        : "Reactivate"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {sourceModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <form onSubmit={saveRowSource} className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-950">Change Lead Source</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Update the source for "{sourceModal.row.customerName}". New sources are saved into Pipeline settings.
            </p>

            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Saved source</span>
              <select
                value={sourceModal.source}
                onChange={(event) => setSourceModal((current) => ({ ...current, source: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {sourceModal.row.leadSource && !activeLeadSourceOptions.some((source) => normalizeStatusText(source.name) === normalizeStatusText(sourceModal.row.leadSource)) ? (
                  <option value={sourceModal.row.leadSource}>{sourceModal.row.leadSource}</option>
                ) : null}
                {activeLeadSourceOptions.length ? (
                  activeLeadSourceOptions.map((source) => (
                    <option key={source.id || source.name} value={source.name}>{source.name}</option>
                  ))
                ) : (
                  <option value="Unknown">Unknown</option>
                )}
              </select>
            </label>

            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Add new source</span>
              <input
                value={sourceModal.customSource}
                onChange={(event) => setSourceModal((current) => ({ ...current, customSource: event.target.value }))}
                placeholder="Referral partner, mailer, trade show..."
                className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeSourceModal}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingKey === `source:${sourceModal.row.id}`}
                className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingKey === `source:${sourceModal.row.id}` ? "Saving..." : "Save Source"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default CustomerMigrationTracker;
