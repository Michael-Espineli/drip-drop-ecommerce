import {
  isOpenWorkOffer,
  isScheduledWorkOffer,
  isWorkOfferRecord,
  workOfferMatchesStatusFilter,
} from "./workOffers";

describe("work offer record guards", () => {
  it("recognizes current work offer records", () => {
    expect(isWorkOfferRecord({ id: "comp_work_offer_123", status: "Posted" })).toBe(true);
    expect(isOpenWorkOffer({ offerType: "Internal Board", status: "Posted" })).toBe(true);
  });

  it("keeps job and service stop shaped records out of current work offers", () => {
    expect(isWorkOfferRecord({ id: "job_123", operationStatus: "Scheduled", status: "Pending" })).toBe(false);
    expect(isOpenWorkOffer({ id: "service_stop_123", serviceDate: new Date(), status: "Pending" })).toBe(false);
    expect(workOfferMatchesStatusFilter({ id: "service_stop_123", serviceDate: new Date(), status: "Pending" }, "all")).toBe(false);
  });

  it("only treats linked service stops as scheduled when the record is a work offer", () => {
    expect(isScheduledWorkOffer({ id: "service_stop_123", scheduledServiceStopId: "stop_123" })).toBe(false);
    expect(isScheduledWorkOffer({ id: "comp_work_offer_123", scheduledServiceStopId: "stop_123" })).toBe(true);
  });
});
