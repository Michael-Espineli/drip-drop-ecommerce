const recordId = (value) => String((typeof value === "object" ? value?.id : value) || "").trim();
const statusKey = (value) => String(value || "").trim().toLowerCase();

export const isCancelledVisit = (status) => ["skipped", "cancelled", "canceled"].includes(statusKey(status));

export const scheduledVisitIds = (visit = {}) => [
  visit.scheduledServiceStopId,
  visit.serviceStopId,
  visit.convertedServiceStopId,
].map(recordId).filter(Boolean);

export const plannedVisitIdForStop = (stop = {}) => recordId(
  stop.plannedServiceStopId || stop.plannedStopId || stop.sourcePlannedStopId
);

export function plannedVisitSchedule(plannedVisits, serviceStops, tasks) {
  const activeStops = serviceStops.filter((stop) => !isCancelledVisit(stop.operationStatus || stop.status));
  const stopsById = new Map(activeStops.map((stop) => [stop.id, stop]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return new Map(plannedVisits.map((visit) => {
    const linked = [
      ...scheduledVisitIds(visit).map((id) => stopsById.get(id)).filter(Boolean),
      ...activeStops.filter((stop) => plannedVisitIdForStop(stop) === visit.id),
    ];
    // Offer visits and some older scheduled visits are linked through their job tasks.
    const taskIds = Array.isArray(visit.taskIds) && visit.taskIds.length
      ? visit.taskIds.map(recordId).filter(Boolean)
      : visit.taskAssignmentMode === "all" || visit.appliesToAllTasks ? [...tasksById.keys()] : [];
    const appointments = taskIds.map((taskId) => {
      const task = tasksById.get(taskId);
      const stop = stopsById.get(recordId(task?.serviceStopId) || recordId(task?.serviceStopIdString));
      if (!stop || (plannedVisitIdForStop(stop) && plannedVisitIdForStop(stop) !== visit.id)) return null;
      return stop;
    });
    return [visit.id, {
      stops: [...new Map([...linked, ...appointments.filter(Boolean)].map((stop) => [stop.id, stop])).values()],
      fullyScheduled: linked.length > 0 || (appointments.length > 0 && appointments.every(Boolean)),
    }];
  }));
}
