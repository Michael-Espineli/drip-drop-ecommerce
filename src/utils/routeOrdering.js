const plannedRouteOrderItems = (route) => {
    if (!route) return [];

    const order = Array.isArray(route.order) ? route.order : [];
    const recurringRouteOrder = Array.isArray(route.recurringRouteOrder) ? route.recurringRouteOrder : [];
    const rssIds = Array.isArray(route.rssIds) ? route.rssIds : [];

    if (order.length || recurringRouteOrder.length) {
        return [...(order.length ? order : recurringRouteOrder)]
            .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    }

    return rssIds.map((recurringServiceStopId, index) => ({
        recurringServiceStopId,
        order: index + 1,
    }));
};

export const mergeStopsIntoRouteOrder = (route, stops, plannedRoute = null) => {
    const stopById = new Map(stops.map(stop => [stop.id, stop]));
    const stopByRecurringId = new Map(
        stops
            .filter(stop => stop.recurringServiceStopId)
            .map(stop => [stop.recurringServiceStopId, stop])
    );
    const activeRouteOrderIds = route?.order?.length
        ? [...route.order]
            .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
            .map(item => item.serviceStopId || item.id)
            .filter(Boolean)
        : (route?.serviceStopsIds || []);
    const plannedRouteOrderIds = !activeRouteOrderIds.length
        ? plannedRouteOrderItems(plannedRoute)
            .map(item => item.recurringServiceStopId || item.rssId || item.id)
            .filter(Boolean)
        : [];
    const orderedIds = plannedRouteOrderIds.length ? plannedRouteOrderIds : activeRouteOrderIds;
    const getStopForOrderedId = plannedRouteOrderIds.length
        ? (stopId) => stopByRecurringId.get(stopId) || stopById.get(stopId)
        : (stopId) => stopById.get(stopId);
    const includedStopIds = new Set();
    const orderedStops = orderedIds
        .map(getStopForOrderedId)
        .filter(Boolean)
        .filter(stop => {
            if (includedStopIds.has(stop.id)) return false;
            includedStopIds.add(stop.id);
            return true;
        });
    const remainingStops = stops.filter(stop => !includedStopIds.has(stop.id));

    return [...orderedStops, ...remainingStops];
};

