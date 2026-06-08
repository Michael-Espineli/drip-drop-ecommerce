import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";

const routeOrderValue = (item) => Number(item?.order || 0);

const reindexRouteOrder = (order = []) =>
  [...order]
    .sort((left, right) => routeOrderValue(left) - routeOrderValue(right))
    .map((item, index) => ({
      ...item,
      order: index + 1,
    }));

const buildRouteOrderItemFromRecurringServiceStop = (recurringServiceStop, orderIndex) => ({
  id: uuidv4(),
  order: orderIndex + 1,
  recurringServiceStopId: recurringServiceStop.id,
  customerId: recurringServiceStop.customerId || "",
  customerName: recurringServiceStop.customerName || "",
  locationId: recurringServiceStop.serviceLocationId || "",
  type: recurringServiceStop.type || "Recurring Service Stop",
  typeId: recurringServiceStop.typeId || "",
  typeImage: recurringServiceStop.typeImage || "",
  serviceStopTypeUseCaseRawValue: recurringServiceStop.serviceStopTypeUseCaseRawValue || "recurringRoute",
});

export const addRecurringServiceStopToPlannedRoute = async ({
  db,
  companyId,
  recurringServiceStop,
}) => {
  if (!db || !companyId || !recurringServiceStop?.id) {
    throw new Error("Missing planned route sync data.");
  }

  if (!recurringServiceStop.day || !recurringServiceStop.techId) {
    return { routeId: null, changed: false };
  }

  const routesCollection = collection(db, "companies", companyId, "recurringRoutes");
  const routesQuery = query(
    routesCollection,
    where("day", "==", recurringServiceStop.day),
    where("techId", "==", recurringServiceStop.techId)
  );
  const snapshot = await getDocs(routesQuery);
  const existingRouteDoc = snapshot.docs[0];
  const routeRef = existingRouteDoc
    ? doc(db, "companies", companyId, "recurringRoutes", existingRouteDoc.id)
    : doc(routesCollection, `com_rr_${uuidv4()}`);
  const routeData = existingRouteDoc?.data() || {};
  const currentOrder = reindexRouteOrder(Array.isArray(routeData.order) ? routeData.order : []);
  const existingOrderIndex = currentOrder.findIndex(
    (item) => item.recurringServiceStopId === recurringServiceStop.id
  );
  const order = [...currentOrder];

  if (existingOrderIndex >= 0) {
    order[existingOrderIndex] = {
      ...order[existingOrderIndex],
      ...buildRouteOrderItemFromRecurringServiceStop(recurringServiceStop, existingOrderIndex),
      id: order[existingOrderIndex].id,
    };
  } else {
    order.push(buildRouteOrderItemFromRecurringServiceStop(recurringServiceStop, order.length));
  }

  const routeId = existingRouteDoc?.id || routeRef.id;
  await setDoc(
    routeRef,
    {
      id: routeId,
      description: routeData.description || recurringServiceStop.description || "",
      day: recurringServiceStop.day,
      tech: recurringServiceStop.tech || routeData.tech || "",
      techId: recurringServiceStop.techId,
      order: reindexRouteOrder(order),
      companyId,
      updatedAt: serverTimestamp(),
      ...(existingRouteDoc ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );

  return {
    routeId,
    changed: true,
    created: !existingRouteDoc,
  };
};

export const removeRecurringServiceStopFromPlannedRoutes = async ({
  db,
  companyId,
  recurringServiceStopId,
}) => {
  if (!db || !companyId || !recurringServiceStopId) {
    throw new Error("Missing planned route removal data.");
  }

  const routesSnapshot = await getDocs(collection(db, "companies", companyId, "recurringRoutes"));
  const batch = writeBatch(db);
  let updatedRoutes = 0;

  routesSnapshot.docs.forEach((routeDoc) => {
    const routeData = routeDoc.data();
    const currentOrder = Array.isArray(routeData.order) ? routeData.order : [];
    const filteredOrder = currentOrder.filter(
      (item) => item.recurringServiceStopId !== recurringServiceStopId
    );

    if (filteredOrder.length === currentOrder.length) return;

    const updates = {
      order: reindexRouteOrder(filteredOrder),
      updatedAt: serverTimestamp(),
    };

    if (Array.isArray(routeData.rssIds)) {
      updates.rssIds = routeData.rssIds.filter((id) => id !== recurringServiceStopId);
    }

    batch.set(routeDoc.ref, updates, { merge: true });
    updatedRoutes += 1;
  });

  if (updatedRoutes > 0) {
    await batch.commit();
  }

  return { updatedRoutes };
};
