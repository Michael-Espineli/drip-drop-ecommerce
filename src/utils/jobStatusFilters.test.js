import {
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
  });

  it("does not treat finished paid jobs as outstanding", () => {
    expect(isFinishedOutstandingJob({
      operationStatus: "Finished",
      billingStatus: "Paid",
    })).toBe(false);
  });
});
