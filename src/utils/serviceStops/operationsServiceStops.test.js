import {
  serviceStopActivityLabel,
  serviceStopIsOperationsActivity,
  serviceStopIsRecurringRoute,
} from "./operationsServiceStops";

describe("operations service stop helpers", () => {
  it("excludes recurring route stops", () => {
    expect(serviceStopIsRecurringRoute({
      recurringServiceStopId: "rss-1",
      category: "Route",
      typeId: "system_recurring_service_stop",
    })).toBe(true);

    expect(serviceStopIsOperationsActivity({
      id: "route-stop",
      recurringServiceStopId: "rss-1",
      jobId: "job-1",
    })).toBe(false);
  });

  it("includes job, lead, and customer relationship stops", () => {
    expect(serviceStopIsOperationsActivity({
      id: "job-stop",
      jobId: "job-1",
      category: "Job",
    })).toBe(true);

    expect(serviceStopIsOperationsActivity({
      id: "lead-stop",
      leadId: "lead-1",
      serviceStopTypeUseCaseRawValue: "serviceAgreementEstimate",
    })).toBe(true);

    expect(serviceStopIsOperationsActivity({
      id: "customer-visit",
      serviceStopTypeUseCaseRawValue: "customerRelationship",
    })).toBe(true);
  });

  it("labels operations stops by their activity source", () => {
    expect(serviceStopActivityLabel({ jobId: "job-1" })).toBe("Job");
    expect(serviceStopActivityLabel({ leadId: "lead-1" })).toBe("Lead");
    expect(serviceStopActivityLabel({ serviceAgreementId: "agreement-1" })).toBe("Service Agreement");
    expect(serviceStopActivityLabel({ serviceStopTypeUseCaseRawValue: "customerRelationship" })).toBe("Customer Visit");
  });
});
