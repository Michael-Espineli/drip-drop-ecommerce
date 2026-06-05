import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";

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

const buildServiceStopEvent = (stop) => ({
  id: `service-stop-${stop.id}`,
  type: "serviceStop",
  label: "Service Stop",
  title: stop.type || stop.jobName || "Service stop",
  subtitle: compact([stop.tech, stop.operationStatus, stop.billingStatus]).join(" • "),
  detail: stop.description || "",
  date: validDate(stop.serviceDate),
  target: `/company/serviceStops/details/${stop.id}`,
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
    target: stopData.serviceStopId ? `/company/serviceStops/details/${stopData.serviceStopId}` : "",
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

export const loadCustomerTimeline = async ({ db, companyId, customerId }) => {
  if (!db || !companyId || !customerId) return [];

  const [serviceStopsSnap, stopDataSnap, equipmentSnap, bodiesOfWaterSnap, workOrdersSnap, toDosSnap] = await Promise.all([
    getDocs(query(collection(db, "companies", companyId, "serviceStops"), where("customerId", "==", customerId))),
    getDocs(query(collection(db, "companies", companyId, "stopData"), where("customerId", "==", customerId))),
    getDocs(query(collection(db, "companies", companyId, "equipment"), where("customerId", "==", customerId))),
    getDocs(query(collection(db, "companies", companyId, "bodiesOfWater"), where("customerId", "==", customerId))),
    getDocs(query(collection(db, "companies", companyId, "workOrders"), where("customerId", "==", customerId))),
    getDocs(query(collection(db, "companies", companyId, "toDos"), where("linkedCustomerId", "==", customerId))),
  ]);

  const serviceStops = serviceStopsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const stopData = stopDataSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const equipment = equipmentSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const bodiesOfWater = bodiesOfWaterSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const workOrders = workOrdersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const toDos = toDosSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

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
    ...commentEvents,
    ...stopData
      .filter((item) => (item.readings?.length || item.dosages?.length || item.observation?.length))
      .map(buildStopDataEvent),
    ...equipmentEvents,
    ...waterEvents,
    ...toDos.map(buildToDoEvent),
  ].sort((a, b) => b.date - a.date);
};
