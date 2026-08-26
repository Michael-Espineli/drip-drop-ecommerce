import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { endCustomerPipelineRowsForInactiveCustomer } from "../customerPipeline";
import { salesCollectionNames, SalesAgreementStatus } from "../models/Sales";

const SERVICE_ESTIMATE_USE_CASES = new Set([
  "serviceestimate",
  "serviceagreementestimate",
  "estimate",
  "initialestimate",
  "preestimate",
  "pre-estimate",
  "system_service_estimate_stop",
  "system_service_agreement_estimate_service_stop",
]);

const FINAL_AGREEMENT_STATUS_KEYS = new Set([
  "accepted",
  "canceled",
  "cancelled",
  "rejected",
  "expired",
  "superseded",
]);

export const normalizeLeadCancellationKey = (value = "") => (
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
);

export const leadCancellationCustomerId = (lead = {}) => (
  lead.companyCustomerId ||
  lead.customerId ||
  ""
);

export const leadCancellationAgreementId = (lead = {}) => (
  lead.serviceAgreementId ||
  lead.salesAgreementId ||
  lead.agreementId ||
  lead.serviceAgreement?.id ||
  ""
);

export const leadCancellationServiceStopId = (lead = {}) => (
  lead.serviceEstimateServiceStopId ||
  lead.initialEstimateServiceStopId ||
  lead.serviceAgreementEstimateServiceStopId ||
  lead.inspectionServiceStopId ||
  ""
);

export const agreementCanBeRejectedForLeadCancellation = (agreement = {}) => (
  Boolean(agreement?.id) &&
  !FINAL_AGREEMENT_STATUS_KEYS.has(normalizeLeadCancellationKey(agreement.status))
);

export const isLeadCancellationServiceEstimateStop = (stop = {}) => {
  const values = [
    stop.serviceStopTypeUseCaseRawValue,
    stop.serviceStopTypeUseCase,
    stop.serviceStopUseCaseSourceId,
    stop.typeId,
    stop.serviceStopTypeId,
    stop.type,
    stop.serviceStopType,
    stop.serviceStopTypeName,
  ].map(normalizeLeadCancellationKey);

  return values.some((value) => (
    SERVICE_ESTIMATE_USE_CASES.has(value) ||
    value.includes("serviceestimate") ||
    value.includes("serviceagreementestimate") ||
    value.includes("initialestimate") ||
    value.includes("preestimate")
  ));
};

const getExistingDocData = async (ref) => {
  const snapshot = await getDoc(ref);
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
};

const findLeadCancellationServiceStop = async ({ db, companyId, lead }) => {
  const explicitStopId = leadCancellationServiceStopId(lead);
  if (explicitStopId) {
    const stop = await getExistingDocData(doc(db, "companies", companyId, "serviceStops", explicitStopId));
    if (stop) return stop;
  }

  if (!lead?.id) return null;

  const stopSnapshot = await getDocs(query(
    collection(db, "companies", companyId, "serviceStops"),
    where("leadId", "==", lead.id)
  ));

  if (stopSnapshot.empty) return null;

  const stops = stopSnapshot.docs.map((stopDoc) => ({ id: stopDoc.id, ...stopDoc.data() }));
  return stops.find(isLeadCancellationServiceEstimateStop) || stops[0] || null;
};

const findLeadCancellationAgreement = async ({ db, companyId, lead }) => {
  const explicitAgreementId = leadCancellationAgreementId(lead);
  if (explicitAgreementId) {
    const agreement = await getExistingDocData(doc(db, salesCollectionNames.agreements, explicitAgreementId));
    if (agreement) return agreement;
  }

  if (!lead?.id) return null;

  const agreementSnapshot = await getDocs(query(
    collection(db, salesCollectionNames.agreements),
    where("companyId", "==", companyId),
    where("leadId", "==", lead.id)
  ));

  if (agreementSnapshot.empty) return null;

  const agreements = agreementSnapshot.docs
    .map((agreementDoc) => ({ id: agreementDoc.id, ...agreementDoc.data() }))
    .filter((agreement) => !companyId || !agreement.companyId || agreement.companyId === companyId);

  return agreements.find(agreementCanBeRejectedForLeadCancellation) || agreements[0] || null;
};

export const previewLeadCancellationTargets = async ({ db, companyId, lead }) => {
  if (!db || !companyId || !lead?.id) {
    return { serviceStop: null, customer: null, agreement: null };
  }

  const customerId = leadCancellationCustomerId(lead);
  const [serviceStop, customer] = await Promise.all([
    findLeadCancellationServiceStop({ db, companyId, lead }),
    customerId
      ? getExistingDocData(doc(db, "companies", companyId, "customers", customerId))
      : Promise.resolve(null),
  ]);
  const serviceStopAgreementId = serviceStop?.serviceAgreementId || serviceStop?.salesAgreementId || serviceStop?.agreementId || "";
  const agreement = await findLeadCancellationAgreement({
    db,
    companyId,
    lead: {
      ...lead,
      serviceAgreementId: leadCancellationAgreementId(lead) || serviceStopAgreementId,
    },
  });

  return { serviceStop, customer, agreement };
};

const deleteServiceStopWithRelations = async ({ db, companyId, serviceStop }) => {
  if (!db || !companyId || !serviceStop?.id) return false;

  const serviceStopId = serviceStop.id;
  const batch = writeBatch(db);
  const serviceStopRef = doc(db, "companies", companyId, "serviceStops", serviceStopId);

  const [taskSnapshot, storeSnapshot, historySnapshot, stopDataSnapshot, routesSnapshot] = await Promise.all([
    getDocs(collection(db, "companies", companyId, "serviceStops", serviceStopId, "tasks")),
    getDocs(collection(db, "companies", companyId, "serviceStops", serviceStopId, "stores")),
    getDocs(collection(db, "companies", companyId, "serviceStops", serviceStopId, "history")),
    getDocs(query(collection(db, "companies", companyId, "stopData"), where("serviceStopId", "==", serviceStopId))),
    getDocs(query(collection(db, "companies", companyId, "activeRoutes"), where("serviceStopsIds", "array-contains", serviceStopId))),
  ]);

  taskSnapshot.docs.forEach((taskDoc) => batch.delete(taskDoc.ref));
  storeSnapshot.docs.forEach((storeDoc) => batch.delete(storeDoc.ref));
  historySnapshot.docs.forEach((historyDoc) => batch.delete(historyDoc.ref));
  stopDataSnapshot.docs.forEach((stopDataDoc) => batch.delete(stopDataDoc.ref));

  routesSnapshot.docs.forEach((routeDoc) => {
    const route = routeDoc.data() || {};
    const remainingStopIds = (route.serviceStopsIds || []).filter((id) => id !== serviceStopId);
    const wasFinished = ["finished", "completed", "done", "complete"].includes(
      String(serviceStop.operationStatus || "").toLowerCase()
    );
    const finishedStops = Math.max(
      0,
      Math.min(
        remainingStopIds.length,
        Number(route.finishedStops || 0) - (wasFinished ? 1 : 0)
      )
    );

    batch.update(routeDoc.ref, {
      serviceStopsIds: remainingStopIds,
      order: Array.isArray(route.order)
        ? route.order
          .filter((item) => (item.serviceStopId || item.id) !== serviceStopId)
          .map((item, index) => ({ ...item, order: index + 1 }))
        : [],
      totalStops: remainingStopIds.length,
      finishedStops,
      status: remainingStopIds.length === 0
        ? "Did Not Start"
        : finishedStops === remainingStopIds.length
          ? "Finished"
          : finishedStops > 0
            ? "In Progress"
            : (route.status || "Did Not Start"),
    });
  });

  batch.delete(serviceStopRef);
  await batch.commit();
  return true;
};

const markCustomerInactive = async ({ db, companyId, customer, reason, actor }) => {
  if (!db || !companyId || !customer?.id) return false;

  await updateDoc(doc(db, "companies", companyId, "customers", customer.id), {
    active: false,
    isActive: false,
    inactiveAt: serverTimestamp(),
    inactiveReason: reason,
    updatedAt: serverTimestamp(),
  });

  await endCustomerPipelineRowsForInactiveCustomer({
    companyId,
    customerId: customer.id,
    reason,
    actorId: actor?.id || "",
    actorName: actor?.name || "",
  });

  return true;
};

const rejectAgreement = async ({ db, agreement, reason, actor }) => {
  if (!db || !agreementCanBeRejectedForLeadCancellation(agreement)) return false;

  await updateDoc(doc(db, salesCollectionNames.agreements, agreement.id), {
    status: SalesAgreementStatus.rejected,
    rejectedAt: serverTimestamp(),
    rejectedByUserId: actor?.id || "",
    rejectedByUserName: actor?.name || "",
    rejectedByEmail: actor?.email || "",
    statusChangedAt: serverTimestamp(),
    statusChangedByUserId: actor?.id || "",
    statusChangedByUserName: actor?.name || "",
    statusChangeReason: reason ? `Lead cancelled: ${reason}` : "Agreement rejected from lead cancellation.",
    updatedAt: serverTimestamp(),
  });

  return true;
};

export const cancelLeadWithOptions = async ({
  db,
  companyId,
  lead,
  reason = "",
  targets = {},
  options = {},
  actor = {},
}) => {
  if (!db || !companyId || !lead?.id) {
    throw new Error("A company and lead are required to cancel a lead.");
  }

  const cleanReason = String(reason || "").trim() || "Marked cancelled from lead cancellation.";
  const resolvedTargets = targets?.serviceStop || targets?.customer || targets?.agreement
    ? targets
    : await previewLeadCancellationTargets({ db, companyId, lead });
  const result = {
    leadCancelled: false,
    serviceStopDeleted: false,
    customerInactive: false,
    agreementRejected: false,
  };

  const leadUpdates = {
    status: "Cancelled",
    leadStatus: "Cancelled",
    lostReason: cleanReason,
    cancelReason: cleanReason,
    statusChangeReason: cleanReason,
    lostAt: serverTimestamp(),
    dateCompleted: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (options.deleteServiceStop && resolvedTargets.serviceStop?.id) {
    leadUpdates.serviceEstimateServiceStopId = "";
    leadUpdates.initialEstimateServiceStopId = "";
    leadUpdates.serviceAgreementEstimateServiceStopId = "";
    leadUpdates.inspectionServiceStopId = "";
  }

  if (
    options.rejectAgreement &&
    resolvedTargets.agreement?.id &&
    agreementCanBeRejectedForLeadCancellation(resolvedTargets.agreement)
  ) {
    leadUpdates.serviceAgreementId = resolvedTargets.agreement.id;
    leadUpdates.serviceAgreementStatus = SalesAgreementStatus.rejected;
    leadUpdates.serviceAgreementRejectedAt = serverTimestamp();
  }

  const operations = [
    updateDoc(doc(db, "homeownerServiceRequests", lead.id), leadUpdates).then(() => {
      result.leadCancelled = true;
    }),
  ];

  if (options.deleteServiceStop && resolvedTargets.serviceStop?.id) {
    operations.push(deleteServiceStopWithRelations({
      db,
      companyId,
      serviceStop: resolvedTargets.serviceStop,
    }).then((deleted) => {
      result.serviceStopDeleted = deleted;
    }));
  }

  if (options.makeCustomerInactive && resolvedTargets.customer?.id) {
    operations.push(markCustomerInactive({
      db,
      companyId,
      customer: resolvedTargets.customer,
      reason: cleanReason,
      actor,
    }).then((inactive) => {
      result.customerInactive = inactive;
    }));
  }

  if (options.rejectAgreement && resolvedTargets.agreement?.id) {
    operations.push(rejectAgreement({
      db,
      agreement: resolvedTargets.agreement,
      reason: cleanReason,
      actor,
    }).then((rejected) => {
      result.agreementRejected = rejected;
    }));
  }

  if (
    options.rejectAgreement &&
    resolvedTargets.serviceStop?.id &&
    !options.deleteServiceStop &&
    agreementCanBeRejectedForLeadCancellation(resolvedTargets.agreement)
  ) {
    operations.push(updateDoc(doc(db, "companies", companyId, "serviceStops", resolvedTargets.serviceStop.id), {
      serviceAgreementId: resolvedTargets.agreement.id,
      serviceAgreementStatus: SalesAgreementStatus.rejected,
      serviceAgreementRejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }

  await Promise.all(operations);
  return { ...result, leadUpdates, targets: resolvedTargets, reason: cleanReason };
};
