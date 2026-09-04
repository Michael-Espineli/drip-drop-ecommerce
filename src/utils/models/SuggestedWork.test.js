import {
  isCurrentSuggestedWorkRecord,
  isOpenSuggestedWorkStatus,
  isSuggestedWorkRecord,
} from "./SuggestedWork";

describe("suggested work record guards", () => {
  it("keeps legacy blank-status suggested work current when it has suggested-work identity", () => {
    expect(isOpenSuggestedWorkStatus(undefined)).toBe(true);
    expect(isSuggestedWorkRecord({ id: "comp_suggested_work_123", title: "Replace pump seal" })).toBe(true);
    expect(isCurrentSuggestedWorkRecord({ id: "comp_suggested_work_123", title: "Replace pump seal" })).toBe(true);
  });

  it("does not count standalone jobs or service stops as current suggested work", () => {
    expect(isCurrentSuggestedWorkRecord({
      id: "job_123",
      operationStatus: "Scheduled",
      billingStatus: "Accepted",
      solutionTierLabel: "Recommended",
      status: "Pending",
    })).toBe(false);

    expect(isCurrentSuggestedWorkRecord({
      id: "stop_123",
      serviceDate: new Date(),
      techId: "tech_123",
      serviceStopTypeId: "weekly_pool_service",
    })).toBe(false);
  });

  it("still counts job-derived records that were explicitly converted to suggested work", () => {
    expect(isCurrentSuggestedWorkRecord({
      id: "comp_suggested_work_job_job_123",
      sourceType: "job",
      status: "Open",
      suggestionStatus: "Open",
      jobId: "job_123",
      title: "Recommended follow-up",
    })).toBe(true);
  });

  it("excludes closed suggested work from current counts", () => {
    expect(isCurrentSuggestedWorkRecord({
      id: "comp_suggested_work_123",
      status: "Completed",
    })).toBe(false);
  });
});
