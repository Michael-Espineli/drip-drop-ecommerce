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

export const getPlannedRouteOrder = (routeData = {}) => {
  const order = Array.isArray(routeData.order) ? routeData.order : [];
  const legacyOrder = Array.isArray(routeData.recurringRouteOrder)
    ? routeData.recurringRouteOrder
    : [];
  return order.length ? order : legacyOrder;
};

export const reindexPlannedRouteOrder = (order = []) =>
  [...order]
    .sort((left, right) => routeOrderValue(left) - routeOrderValue(right))
    .map((item, index) => ({
      ...item,
      order: index + 1,
    }));

export const getPlannedRouteRssIds = (routeData = {}, orderOverride = null) => {
  const order = Array.isArray(orderOverride) ? orderOverride : getPlannedRouteOrder(routeData);
  const ids = [
    ...order.map((item) => item?.recurringServiceStopId),
    ...(Array.isArray(routeData.rssIds) ? routeData.rssIds : []),
  ];

  return [...new Set(ids.filter((id) => typeof id === "string" && id.trim().length > 0))];
};

export const mergePlannedRouteOrders = (destinationOrder = [], incomingOrder = []) => {
  const incomingIds = new Set(
    incomingOrder
      .map((item) => item?.recurringServiceStopId)
      .filter(Boolean)
  );
  const mergedOrder = [
    ...destinationOrder.filter((item) => !incomingIds.has(item?.recurringServiceStopId)),
    ...incomingOrder,
  ];

  return reindexPlannedRouteOrder(mergedOrder);
};

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
  const currentOrder = reindexPlannedRouteOrder(getPlannedRouteOrder(routeData));
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
  const nextOrder = reindexPlannedRouteOrder(order);
  await setDoc(
    routeRef,
    {
      id: routeId,
      description: routeData.description || recurringServiceStop.description || "",
      day: recurringServiceStop.day,
      tech: recurringServiceStop.tech || routeData.tech || "",
      techId: recurringServiceStop.techId,
      order: nextOrder,
      recurringRouteOrder: nextOrder,
      rssIds: getPlannedRouteRssIds(routeData, nextOrder),
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
  let deletedRoutes = 0;

  routesSnapshot.docs.forEach((routeDoc) => {
    const routeData = routeDoc.data();
    const currentOrder = getPlannedRouteOrder(routeData);
    const currentRssIds = getPlannedRouteRssIds(routeData, currentOrder);
    const filteredOrder = currentOrder.filter(
      (item) => item?.recurringServiceStopId !== recurringServiceStopId
    );
    const updatedOrder = reindexPlannedRouteOrder(filteredOrder);
    const updatedRssIds = currentRssIds.filter((id) => id !== recurringServiceStopId);

    if (
      filteredOrder.length === currentOrder.length &&
      updatedRssIds.length === currentRssIds.length
    ) {
      return;
    }

    if (updatedOrder.length === 0 && updatedRssIds.length === 0) {
      batch.delete(routeDoc.ref);
      deletedRoutes += 1;
      return;
    }

    const updates = {
      order: updatedOrder,
      recurringRouteOrder: updatedOrder,
      rssIds: updatedRssIds,
      updatedAt: serverTimestamp(),
    };

    batch.set(routeDoc.ref, updates, { merge: true });
    updatedRoutes += 1;
  });

  if (updatedRoutes > 0 || deletedRoutes > 0) {
    await batch.commit();
  }

  return { updatedRoutes, deletedRoutes };
};

export const removeRecurringServiceStopsFromOtherPlannedRoutes = async ({
  db,
  companyId,
  recurringServiceStopIds = [],
  destinationRouteId = "",
}) => {
  const idsToMove = new Set(recurringServiceStopIds.filter(Boolean));
  if (!db || !companyId || !idsToMove.size) return { changedRoutes: 0, deletedRoutes: 0 };

  const routesSnapshot = await getDocs(collection(db, "companies", companyId, "recurringRoutes"));
  const batch = writeBatch(db);
  let changedRoutes = 0;
  let deletedRoutes = 0;

  routesSnapshot.docs.forEach((routeDoc) => {
    if (routeDoc.id === destinationRouteId) return;

    const routeData = routeDoc.data();
    const currentOrder = getPlannedRouteOrder(routeData);
    const currentRssIds = getPlannedRouteRssIds(routeData, currentOrder);
    const nextOrder = currentOrder.filter(
      (item) => !idsToMove.has(item?.recurringServiceStopId)
    );
    const nextRssIds = currentRssIds.filter((rssId) => !idsToMove.has(rssId));

    if (nextOrder.length === currentOrder.length && nextRssIds.length === currentRssIds.length) {
      return;
    }

    const reindexedOrder = reindexPlannedRouteOrder(nextOrder);

    if (reindexedOrder.length === 0 && nextRssIds.length === 0) {
      batch.delete(routeDoc.ref);
      deletedRoutes += 1;
      return;
    }

    batch.set(
      routeDoc.ref,
      {
        order: reindexedOrder,
        recurringRouteOrder: reindexedOrder,
        rssIds: nextRssIds,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    changedRoutes += 1;
  });

  if (changedRoutes > 0 || deletedRoutes > 0) {
    await batch.commit();
  }

  return { changedRoutes, deletedRoutes };
};
