import { plannedVisitSchedule } from "./plannedVisitSchedule";

const schedule = (visit, stops, tasks = []) => plannedVisitSchedule([{ id: "planned", ...visit }], stops, tasks).get("planned");

test("legacy reverse links resolve to the saved appointment", () => {
  const appointment = { id: "visit", operationStatus: "Finished" };
  expect(schedule({ convertedServiceStopId: "visit" }, [appointment])).toEqual({
    stops: [appointment], fullyScheduled: true,
  });
});

test("cancelled or missing appointments leave the plan unscheduled", () => {
  const visit = { scheduledServiceStopId: "missing", serviceStopId: "skipped" };
  expect(schedule(visit, [{ id: "skipped", operationStatus: "Skipped" }])).toEqual({
    stops: [], fullyScheduled: false,
  });
});

test("a work offer can schedule some or all of a planned visit's tasks", () => {
  const offerStop = { id: "offer", operationStatus: "Not Finished" };
  const plan = { taskIds: ["first", "second"] };
  const first = { id: "first", serviceStopId: { id: "offer" } };
  const second = { id: "second", serviceStopId: { id: "" }, serviceStopIdString: "offer" };
  expect(schedule(plan, [offerStop], [first])).toEqual({
    stops: [offerStop], fullyScheduled: false,
  });
  expect(schedule(plan, [offerStop], [first, second])).toEqual({
    stops: [offerStop], fullyScheduled: true,
  });
});

test("the plan retains both the offered visit and the later visit for remaining tasks", () => {
  const offerStop = { id: "offered", operationStatus: "Not Finished" };
  const remainingStop = { id: "direct", operationStatus: "Not Finished", plannedServiceStopId: "planned" };
  const otherStop = { id: "other", operationStatus: "Not Finished", plannedServiceStopId: "other-plan" };
  expect(schedule(
    { taskIds: ["first", "second", "third"] },
    [offerStop, remainingStop, otherStop],
    [{ id: "first", serviceStopId: "offered" }, { id: "second", serviceStopId: "direct" }, { id: "third", serviceStopId: "other" }]
  )).toEqual({ stops: [remainingStop, offerStop], fullyScheduled: true });
});
