import {
  isAcceptedNotScheduledJob,
  isDraftOperationJob,
  isFinishedOutstandingJob,
} from "./jobStatusFilters";

describe("jobStatusFilters", () => {
  describe("isDraftOperationJob", () => {
    it("counts jobs with draft billing status", () => {
      expect(isDraftOperationJob({
        operationStatus: "Estimate Pending",
        billingStatus: "Draft",
      })).toBe(true);
    });

    it("counts jobs with draft operation status", () => {
      expect(isDraftOperationJob({
        operationStatus: "Draft",
        billingStatus: "Estimate",
      })).toBe(true);
    });

    it("does not count non-draft jobs", () => {
      expect(isDraftOperationJob({
        operationStatus: "Scheduled",
        billingStatus: "Accepted",
      })).toBe(false);
    });

    it("does not count canceled jobs with draft billing as draft operations", () => {
      expect(isDraftOperationJob({
        operationStatus: "Canceled",
        billingStatus: "Draft",
      })).toBe(false);
    });
  });

  it("does not treat finished paid jobs as outstanding", () => {
    expect(isFinishedOutstandingJob({
      operationStatus: "Finished",
      billingStatus: "Paid",
    })).toBe(false);
  });

  it("does not treat customer-resolved jobs as outstanding", () => {
    expect(isFinishedOutstandingJob({
      operationStatus: "Finished",
      billingStatus: "Customer Resolved",
    })).toBe(false);
  });

  it("does not treat canceled jobs as outstanding", () => {
    expect(isFinishedOutstandingJob({
      operationStatus: "Finished",
      billingStatus: "Canceled",
    })).toBe(false);
  });

  describe("isAcceptedNotScheduledJob", () => {
    it("counts accepted jobs only when operation status is unscheduled", () => {
      expect(isAcceptedNotScheduledJob({
        operationStatus: "Unscheduled",
        billingStatus: "Accepted",
      })).toBe(true);
    });

    it("does not count accepted jobs already in progress", () => {
      expect(isAcceptedNotScheduledJob({
        operationStatus: "In Progress",
        billingStatus: "Accepted",
      })).toBe(false);
    });

    it("does not count accepted jobs waiting for parts", () => {
      expect(isAcceptedNotScheduledJob({
        operationStatus: "Waiting for Parts",
        billingStatus: "Accepted",
      })).toBe(false);
    });

    it("does not count canceled jobs even when billing is accepted", () => {
      expect(isAcceptedNotScheduledJob({
        operationStatus: "Canceled",
        billingStatus: "Accepted",
      })).toBe(false);
    });
  });
});
