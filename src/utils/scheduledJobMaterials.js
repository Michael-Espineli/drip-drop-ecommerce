import { arrayUnion, collection, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";

const compactString = (value) => String(value || "").trim();

const idValue = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    if (typeof value === "object") {
        return compactString(value.id || value.value || value.docId || "");
    }

    return compactString(value);
};

const shoppingItemTaskIds = (item = {}) => {
    const taskIds = [
        item.linkedTaskId,
        item.linkedJobTaskId,
        item.jobTaskId,
        item.sourceTaskId,
        item.taskId,
        ...(Array.isArray(item.linkedTaskIds) ? item.linkedTaskIds : []),
    ].map(idValue).filter(Boolean);

    (Array.isArray(item.prepKeys) ? item.prepKeys : []).forEach((key) => {
        const rawKey = compactString(key);
        if (rawKey.startsWith("jobTask:")) {
            taskIds.push(rawKey.replace("jobTask:", ""));
        }
    });

    return Array.from(new Set(taskIds));
};

const shoppingItemPlanIds = (item = {}) => (
    [
        item.planId,
        item.sourcePlanId,
        item.solutionId,
        item.sourceSolutionId,
    ].map(idValue).filter(Boolean)
);

const buildScheduledShoppingPrepKeys = ({
    userId = "",
    jobId = "",
    customerId = "",
    serviceLocationId = "",
    serviceStopId = "",
    taskIds = [],
} = {}) => Array.from(
    new Set(
        [
            userId ? `user:${userId}` : "",
            jobId ? `job:${jobId}` : "",
            customerId ? `customer:${customerId}` : "",
            serviceLocationId ? `serviceLocation:${serviceLocationId}` : "",
            serviceStopId ? `serviceStop:${serviceStopId}` : "",
            ...(taskIds || []).map((taskId) => idValue(taskId)).filter(Boolean).map((taskId) => `jobTask:${taskId}`),
        ].filter(Boolean)
    )
);

const itemNeedsShoppingAction = (item = {}) =>
    !compactString(item.status).toLowerCase().includes("installed");

const shoppingItemMatchesScheduledTasks = ({
    item = {},
    selectedTaskIds,
    linkedShoppingItemIds,
    selectedPlannedStopId = "",
    selectedPlanId = "",
} = {}) => {
    const itemId = idValue(item.id || item.docId);
    if (itemId && linkedShoppingItemIds.has(itemId)) return true;

    const taskIds = shoppingItemTaskIds(item);
    if (taskIds.some((taskId) => selectedTaskIds.has(taskId))) return true;

    const itemPlannedStopId = idValue(item.plannedServiceStopId || item.plannedStopId || item.sourcePlannedStopId);
    if (selectedPlannedStopId && itemPlannedStopId === selectedPlannedStopId) return true;

    const hasAnyTaskContext = taskIds.length > 0;
    const planIds = shoppingItemPlanIds(item);
    if (selectedPlanId && !hasAnyTaskContext && planIds.includes(selectedPlanId)) return true;

    return false;
};

export const syncShoppingItemsForScheduledJobTasks = async ({
    db,
    companyId,
    jobId,
    selectedUser,
    selectedTasks,
    selectedPlannedStop,
    serviceDate,
    serviceStopId,
    internalId,
    customerId,
    serviceLocationId,
}) => {
    if (!companyId || !jobId || !selectedUser?.userId || !selectedTasks.length) return;

    const selectedTaskIds = new Set(selectedTasks.map((task) => idValue(task.id)).filter(Boolean));
    const linkedShoppingItemIds = new Set(
        selectedTasks.flatMap((task) => [
            idValue(task.shoppingListItemId),
            ...(Array.isArray(task.shoppingListItemIds) ? task.shoppingListItemIds.map(idValue) : []),
        ]).filter(Boolean)
    );

    if (!selectedTaskIds.size && !linkedShoppingItemIds.size) return;

    const selectedPlannedStopId = idValue(selectedPlannedStop?.id);
    const selectedPlanId = idValue(
        selectedPlannedStop?.planId ||
        selectedPlannedStop?.sourcePlanId ||
        selectedPlannedStop?.solutionId ||
        selectedPlannedStop?.sourceSolutionId
    );
    const shoppingSnap = await getDocs(query(
        collection(db, "companies", companyId, "shoppingList"),
        where("jobId", "==", jobId)
    ));
    const scheduledDate = Timestamp.fromDate(serviceDate);
    const basePrepKeys = buildScheduledShoppingPrepKeys({
        userId: selectedUser.userId,
        jobId,
        customerId: customerId || "",
        serviceLocationId: serviceLocationId || "",
        serviceStopId,
        taskIds: Array.from(selectedTaskIds),
    });
    const matchedDocs = shoppingSnap.docs.filter((docSnap) => {
        const item = { id: docSnap.id, ...(docSnap.data() || {}) };
        return shoppingItemMatchesScheduledTasks({
            item,
            selectedTaskIds,
            linkedShoppingItemIds,
            selectedPlannedStopId,
            selectedPlanId,
        });
    });

    if (!matchedDocs.length) return;

    await Promise.all(
        matchedDocs.map((docSnap) => {
            const item = { id: docSnap.id, ...(docSnap.data() || {}) };
            const itemTaskIds = shoppingItemTaskIds(item).filter((taskId) => selectedTaskIds.has(taskId));
            const itemPrepKeys = buildScheduledShoppingPrepKeys({
                userId: selectedUser.userId,
                jobId,
                customerId: customerId || item.customerId || "",
                serviceLocationId: serviceLocationId || item.serviceLocationId || "",
                serviceStopId,
                taskIds: itemTaskIds.length ? itemTaskIds : Array.from(selectedTaskIds),
            });
            const prepKeys = itemPrepKeys.length ? itemPrepKeys : basePrepKeys;
            const updates = {
                serviceStopId,
                serviceStopInternalId: internalId,
                scheduledServiceStopId: serviceStopId,
                scheduledServiceStopInternalId: internalId,
                scheduledDate,
                actionDate: scheduledDate,
                needsAction: itemNeedsShoppingAction(item),
                updatedAt: Timestamp.now(),
            };

            if (prepKeys.length) {
                updates.prepKeys = arrayUnion(...prepKeys);
            }

            if (selectedUser.userId) {
                updates.assignedTechIds = arrayUnion(selectedUser.userId);
                updates.assignedTechId = selectedUser.userId;
                updates.assignedToUserId = selectedUser.userId;
            }

            if (selectedUser.userName) {
                updates.assignedTechNames = arrayUnion(selectedUser.userName);
                updates.assignedTechName = selectedUser.userName;
                updates.assignedToUserName = selectedUser.userName;
            }

            return updateDoc(docSnap.ref, updates);
        })
    );
};
