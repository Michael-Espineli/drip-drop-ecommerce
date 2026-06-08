import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { salesCollectionNames } from "./models/Sales";

const toDate = (value) => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
};

const validDate = (value) => {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const compact = (items) => items.filter((item) => item !== undefined && item !== null && item !== "");

const previewList = (items, formatter) => {
  const values = compact(items.map(formatter));
  if (values.length === 0) return "";
  const visible = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${visible}, +${values.length - 3} more` : visible;
};

const safeGetDocs = async (queryRef, label) => {
  try {
    return await getDocs(queryRef);
  } catch (error) {
    console.warn(`Unable to load customer timeline ${label}.`, error);
    return { docs: [] };
  }
};

const buildServiceStopEvent = (stop) => ({
  id: `service-stop-${stop.id}`,
  type: "serviceStop",
  label: "Service Stop",
  title: stop.type || stop.jobName || "Service stop",
  subtitle: compact([stop.tech, stop.operationStatus, stop.billingStatus]).join(" • "),
  detail: stop.description || "",
  date: validDate(stop.serviceDate),
  target: `/company/serviceStops/detail/${stop.id}`,
});

const buildStopDataEvent = (stopData) => {
  const readings = Array.isArray(stopData.readings) ? stopData.readings : [];
  const dosages = Array.isArray(stopData.dosages) ? stopData.dosages : [];
  const observations = Array.isArray(stopData.observation) ? stopData.observation : [];

  return {
    id: `stop-data-${stopData.id}`,
    type: "chemistry",
    label: "Readings & Dosages",
    title: "Water readings recorded",
    subtitle: `${readings.length} readings • ${dosages.length} dosages`,
    detail:
      previewList(readings, (item) => `${item.name || "Reading"} ${item.amount || ""}${item.UOM ? ` ${item.UOM}` : ""}`) ||
      previewList(dosages, (item) => `${item.name || "Dosage"} ${item.amount || ""}${item.UOM ? ` ${item.UOM}` : ""}`) ||
      observations.slice(0, 2).join(", "),
    date: validDate(stopData.date),
    readings,
    dosages,
    observations,
    bodyOfWaterId: stopData.bodyOfWaterId || "",
    serviceLocationId: stopData.serviceLocationId || "",
    serviceStopId: stopData.serviceStopId || "",
    target: stopData.serviceStopId ? `/company/serviceStops/detail/${stopData.serviceStopId}` : "",
  };
};

const buildEquipmentEvent = (equipment, history) => ({
  id: `equipment-${equipment.id}-${history.id}`,
  type: history.type === "Repair" ? "equipmentRepair" : "equipmentMaintenance",
  label: history.type || "Equipment",
  title: history.name || `${equipment.name || "Equipment"} ${history.type || "service"}`,
  subtitle: compact([equipment.name, history.techName, history.performedBy]).join(" • "),
  detail: history.description || "",
  date: validDate(history.date),
  equipmentId: equipment.id,
  equipmentName: equipment.name || "",
  equipmentType: equipment.type || "",
  bodyOfWaterId: equipment.bodyOfWaterId || "",
  serviceLocationId: equipment.serviceLocationId || "",
  historyType: history.type || "",
  target: `/company/equipment/detail/${equipment.id}`,
});

const buildWaterHistoryEvent = (bodyOfWater, history) => ({
  id: `water-${bodyOfWater.id}-${history.id}`,
  type: history.type === "Empty" ? "waterEmpty" : "waterFill",
  label: history.type === "Empty" ? "Water Empty" : "Water Fill",
  title: `${history.type || "Water"} - ${bodyOfWater.name || "Body of water"}`,
  subtitle: compact([history.techName, history.gallons ? `${history.gallons} gal` : ""]).join(" • "),
  detail: history.description || "",
  date: validDate(history.date),
  bodyOfWaterId: bodyOfWater.id,
  bodyOfWaterName: bodyOfWater.name || "",
  gallons: history.gallons || "",
  historyType: history.type || "",
  target: `/company/bodiesOfWater/detail/${bodyOfWater.id}`,
});

const buildWorkOrderEvent = (job) => ({
  id: `work-order-${job.id}`,
  type: "workOrder",
  label: "Work Order",
  title: job.type || "Work order",
  subtitle: compact([job.adminName, job.operationStatus, job.billingStatus]).join(" • "),
  detail: job.description || "",
  date: validDate(job.dateCreated),
  target: `/company/jobs/detail/${job.id}`,
});

const buildWorkOrderCommentEvent = (job, comment) => ({
  id: `work-order-comment-${job.id}-${comment.id}`,
  type: "note",
  label: comment.resolved ? "Resolved Note" : "Open Note",
  title: comment.resolved ? "Work order comment resolved" : "Work order comment",
  subtitle: compact([comment.userName || comment.authorName, job.type || "Work order"]).join(" • "),
  detail: comment.comment || "",
  date: validDate(comment.date),
  target: `/company/jobs/detail/${job.id}`,
});

const buildToDoEvent = (toDo) => ({
  id: `todo-${toDo.id}`,
  type: "toDo",
  label: toDo.status === "Finished" ? "Finished Follow-Up" : "Follow-Up",
  title: toDo.title || "Follow-up",
  subtitle: compact([toDo.assignedTechName, toDo.status]).join(" • "),
  detail: toDo.description || "",
  date: validDate(toDo.dateCreated),
  target: toDo.linkedJobId ? `/company/jobs/detail/${toDo.linkedJobId}` : "",
});

const buildRepairRequestEvent = (request) => ({
  id: `repair-request-${request.id}`,
  type: "repairRequest",
  label: "Repair Request",
  title: request.title || request.issue || request.description || "Repair request",
  subtitle: compact([request.status, request.createdByName || request.userName, request.equipmentName]).join(" • "),
  detail: request.description || request.notes || "",
  date: validDate(request.dateCreated || request.createdAt || request.updatedAt),
  target: `/company/repair-requests/detail/${request.id}`,
});

const moneyFromCents = (value) => {
  const cents = Number(value || 0);
  if (!Number.isFinite(cents) || cents <= 0) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
};

const purchaseAmount = (purchase) => {
  const price = Number(purchase.price || purchase.cost || purchase.unitCost || 0);
  const quantity = Number(purchase.quantity || purchase.quantityString || 1);
  if (!Number.isFinite(price) || price <= 0) return "";
  const amount = price > 1000 ? price : price * quantity * 100;
  return moneyFromCents(amount);
};

const buildPurchaseEvent = (purchase) => ({
  id: `purchase-${purchase.id}`,
  type: "purchase",
  label: "Purchase",
  title: purchase.name || "Purchased item",
  subtitle: compact([purchase.venderName, purchase.assignmentStatus, purchase.invoiced ? "Invoiced" : "Not invoiced"]).join(" • "),
  detail: compact([purchaseAmount(purchase), purchase.invoiceNum ? `Invoice ${purchase.invoiceNum}` : "", purchase.notes]).join(" • "),
  date: validDate(purchase.date || purchase.datePurchased || purchase.createdAt),
  target: `/company/purchasedItems/detail/${purchase.id}`,
});

const buildSalesAgreementEvent = (agreement) => ({
  id: `sales-agreement-${agreement.id}`,
  type: "salesAgreement",
  label: "Agreement",
  title: agreement.title || "Service agreement",
  subtitle: compact([agreement.status, agreement.sourceType, moneyFromCents(agreement.totalAmountCents || agreement.rateAmountCents)]).join(" • "),
  detail: agreement.description || agreement.termsTemplateName || "",
  date: validDate(agreement.acceptedAt || agreement.sentAt || agreement.updatedAt || agreement.createdAt),
  target: `/company/sales/agreements/${agreement.id}`,
});

const buildSalesSubscriptionEvent = (subscription) => ({
  id: `sales-subscription-${subscription.id}`,
  type: "salesSubscription",
  label: "Subscription",
  title: subscription.title || subscription.agreementSnapshot?.title || "Billing subscription",
  subtitle: compact([subscription.status, moneyFromCents(subscription.amountCents), subscription.interval]).join(" • "),
  detail: subscription.nextAction || subscription.operationsSetupStatus || "",
  date: validDate(subscription.currentPeriodStart || subscription.updatedAt || subscription.createdAt),
  target: `/company/sales/subscriptions/${subscription.id}`,
});

const buildSalesInvoiceEvent = (invoice) => ({
  id: `sales-invoice-${invoice.id}`,
  type: "salesInvoice",
  label: "Invoice",
  title: invoice.invoiceNumber || invoice.title || "Sales invoice",
  subtitle: compact([invoice.status, moneyFromCents(invoice.totalAmountCents || invoice.amountDueCents)]).join(" • "),
  detail: invoice.description || invoice.invoiceNotes || "",
  date: validDate(invoice.invoiceDate || invoice.dueDate || invoice.updatedAt || invoice.createdAt),
  target: `/company/sales/invoices/${invoice.id}`,
});

const buildSalesPaymentEvent = (payment) => ({
  id: `sales-payment-${payment.id}`,
  type: "salesPayment",
  label: "Payment",
  title: payment.paymentNumber || "Payment received",
  subtitle: compact([payment.status, payment.method, moneyFromCents(payment.amountCents)]).join(" • "),
  detail: payment.memo || payment.notes || "",
  date: validDate(payment.postedAt || payment.paidAt || payment.createdAt),
  target: "/company/sales/payments",
});

export const loadCustomerTimeline = async ({ db, companyId, customerId }) => {
  if (!db || !companyId || !customerId) return [];

  const [
    serviceStopsSnap,
    stopDataSnap,
    equipmentSnap,
    bodiesOfWaterSnap,
    workOrdersSnap,
    toDosSnap,
    repairRequestsSnap,
    homeownerRepairRequestsSnap,
    purchasesSnap,
    agreementsSnap,
    subscriptionsSnap,
    invoicesSnap,
    paymentsSnap,
  ] = await Promise.all([
    safeGetDocs(query(collection(db, "companies", companyId, "serviceStops"), where("customerId", "==", customerId)), "service stops"),
    safeGetDocs(query(collection(db, "companies", companyId, "stopData"), where("customerId", "==", customerId)), "stop data"),
    safeGetDocs(query(collection(db, "companies", companyId, "equipment"), where("customerId", "==", customerId)), "equipment"),
    safeGetDocs(query(collection(db, "companies", companyId, "bodiesOfWater"), where("customerId", "==", customerId)), "bodies of water"),
    safeGetDocs(query(collection(db, "companies", companyId, "workOrders"), where("customerId", "==", customerId)), "jobs"),
    safeGetDocs(query(collection(db, "companies", companyId, "toDos"), where("linkedCustomerId", "==", customerId)), "to-dos"),
    safeGetDocs(query(collection(db, "companies", companyId, "repairRequests"), where("customerId", "==", customerId)), "repair requests"),
    safeGetDocs(query(collection(db, "homeownerRepairRequests"), where("companyId", "==", companyId), where("customerId", "==", customerId)), "homeowner repair requests"),
    safeGetDocs(query(collection(db, "companies", companyId, "purchasedItems"), where("customerId", "==", customerId)), "purchases"),
    safeGetDocs(query(collection(db, salesCollectionNames.agreements), where("companyId", "==", companyId), where("customerId", "==", customerId)), "sales agreements"),
    safeGetDocs(query(collection(db, salesCollectionNames.billingSubscriptions), where("companyId", "==", companyId), where("customerId", "==", customerId)), "billing subscriptions"),
    safeGetDocs(query(collection(db, salesCollectionNames.invoices), where("companyId", "==", companyId), where("customerId", "==", customerId)), "invoices"),
    safeGetDocs(query(collection(db, salesCollectionNames.payments), where("companyId", "==", companyId), where("customerId", "==", customerId)), "payments"),
  ]);

  const serviceStops = serviceStopsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const stopData = stopDataSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const equipment = equipmentSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const bodiesOfWater = bodiesOfWaterSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const workOrders = workOrdersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const toDos = toDosSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const repairRequestsById = new Map();
  [...repairRequestsSnap.docs, ...homeownerRepairRequestsSnap.docs].forEach((item) => {
    repairRequestsById.set(item.id, { id: item.id, ...item.data() });
  });
  const repairRequests = Array.from(repairRequestsById.values());
  const purchases = purchasesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const agreements = agreementsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const subscriptions = subscriptionsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const invoices = invoicesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const payments = paymentsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

  const equipmentEvents = (
    await Promise.all(
      equipment.map(async (item) => {
        const historySnap = await getDocs(
          query(
            collection(doc(db, "companies", companyId, "equipment", item.id), "serviceHistory"),
            orderBy("date", "desc"),
            limit(10)
          )
        );
        return historySnap.docs.map((historyDoc) =>
          buildEquipmentEvent(item, { id: historyDoc.id, ...historyDoc.data() })
        );
      })
    )
  ).flat();

  const waterEvents = (
    await Promise.all(
      bodiesOfWater.map(async (item) => {
        const historySnap = await getDocs(
          query(
            collection(doc(db, "companies", companyId, "bodiesOfWater", item.id), "waterHistory"),
            orderBy("date", "desc"),
            limit(10)
          )
        );
        return historySnap.docs.map((historyDoc) =>
          buildWaterHistoryEvent(item, { id: historyDoc.id, ...historyDoc.data() })
        );
      })
    )
  ).flat();

  const commentEvents = (
    await Promise.all(
      workOrders.map(async (item) => {
        const commentsSnap = await getDocs(
          query(
            collection(doc(db, "companies", companyId, "workOrders", item.id), "comments"),
            orderBy("date", "desc"),
            limit(10)
          )
        );
        return commentsSnap.docs.map((commentDoc) =>
          buildWorkOrderCommentEvent(item, { id: commentDoc.id, ...commentDoc.data() })
        );
      })
    )
  ).flat();

  return [
    ...serviceStops.map(buildServiceStopEvent),
    ...workOrders.map(buildWorkOrderEvent),
    ...repairRequests.map(buildRepairRequestEvent),
    ...purchases.map(buildPurchaseEvent),
    ...agreements.map(buildSalesAgreementEvent),
    ...subscriptions.map(buildSalesSubscriptionEvent),
    ...invoices.map(buildSalesInvoiceEvent),
    ...payments.map(buildSalesPaymentEvent),
    ...commentEvents,
    ...stopData
      .filter((item) => (item.readings?.length || item.dosages?.length || item.observation?.length))
      .map(buildStopDataEvent),
    ...equipmentEvents,
    ...waterEvents,
    ...toDos.map(buildToDoEvent),
  ].sort((a, b) => b.date - a.date);
};
