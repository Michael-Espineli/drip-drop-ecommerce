import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import JobNextVisitSnapshot, { getJobNextAssignment } from "./JobNextVisitSnapshot";

const visit = (id, date, extra = {}) => ({ id, serviceDate: new Date(date), operationStatus: "Not Finished", techId: "tech", tech: "Alex Rivera", type: "Job Visit", ...extra });
const renderSnapshot = props => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><JobNextVisitSnapshot jobId="job" {...props} /></MemoryRouter>);

test("selects the earliest outstanding visit rather than the latest visit or a cancelled/finished appointment", () => {
  const next = visit("next", "2030-04-12T09:00:00");
  const result = getJobNextAssignment({ serviceStops: [visit("later", "2030-05-01T09:00:00"), visit("finished", "2030-04-10T09:00:00", { operationStatus: "Finished" }), visit("skipped", "2030-04-11T09:00:00", { operationStatus: "Skipped" }), visit("cancelled", "2030-04-09T09:00:00", { operationStatus: "Cancelled" }), next] });
  expect(result.stop.id).toBe("next");
  expect(result.people.map(person => person.name)).toEqual(["Alex Rivera"]);
});

test("current work takes priority and valid Firestore dates sort before unscheduled dates", () => {
  const scheduled = visit("scheduled", "2030-04-12T09:00:00", { serviceDate: { seconds: 1902211200 } });
  expect(getJobNextAssignment({ serviceStops: [{ id: "undated", operationStatus: "Not Finished" }, scheduled] }).stop.id).toBe("scheduled");
  const current = visit("current", "2030-04-13T09:00:00", { operationStatus: "In Progress" });
  renderSnapshot({ serviceStops: [scheduled, current] });
  expect(screen.getByText("Current visit:")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View visit" })).toHaveAttribute("href", "/company/serviceStops/detail/current");
});

test("shows the assigned crew once, resolves company-user aliases, and ignores inherited or completed task workers", () => {
  const stop = visit("next", "2030-04-12T09:00:00", { techId: "company-user-1" });
  const tasks = [
    { id: "same-tech", serviceStopId: { id: "next" }, workerId: "tech", workerName: "Old name" },
    { id: "assistant", serviceStopId: { id: "next" }, workerId: "assistant", workerName: "Blair Chen", workerAssignmentMode: "task" },
    { id: "inherited", serviceStopId: "next", workerId: "old-tech", workerName: "Previous technician", workerAssignmentMode: "stop" },
    { id: "done", serviceStopId: "next", workerId: "done-tech", workerName: "Finished technician", status: "Finished" },
    { id: "other-visit", serviceStopId: "later", workerId: "other-tech", workerName: "Other technician" },
  ];
  renderSnapshot({ serviceStops: [stop], tasks, companyUsers: [{ docId: "company-user-1", userId: "tech", userName: "Alex Rivera" }] });
  expect(screen.getAllByText("Alex Rivera")).toHaveLength(1);
  expect(screen.getByText("Blair Chen")).toBeInTheDocument();
  expect(screen.queryByText("Previous technician")).not.toBeInTheDocument();
  expect(screen.queryByText("Finished technician")).not.toBeInTheDocument();
  expect(screen.queryByText("Other technician")).not.toBeInTheDocument();
});

test("shows accepted unscheduled work without treating an unaccepted or pending offer as assigned", () => {
  const offer = { status: "Accepted", claims: [{ status: "Accepted", workerId: "tech", workerName: "Alex Rivera", taskIds: ["task"], stopIds: [] }] };
  renderSnapshot({ tasks: [{ id: "task", status: "Accepted" }], offers: [offer, { status: "Acceptance Pending Approval", claims: [{ status: "Acceptance Pending Approval", workerId: "pending", workerName: "Pending technician" }] }, { status: "Sent", offeredToUserName: "Invited technician" }] });
  expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
  expect(screen.getByText("Accepted · needs scheduling")).toBeInTheDocument();
  expect(screen.queryByText("Pending technician")).not.toBeInTheDocument();
  expect(screen.queryByText("Invited technician")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View work & scheduling" })).toHaveAttribute("href", "/company/jobs/detail/job/actual");
});

test("keeps missing assignments and overdue work visible instead of guessing a technician", () => {
  renderSnapshot({ serviceStops: [visit("overdue", "2001-04-12T09:00:00", { techId: "", tech: "Not Assigned" })] });
  expect(screen.getByText("No technician assigned yet")).toBeInTheDocument();
  expect(screen.getByText("Visit technician needed")).toBeInTheDocument();
  expect(screen.getByText("Overdue")).toBeInTheDocument();
});

test("completed or cancelled work does not supply a stale unscheduled technician", () => {
  const result = getJobNextAssignment({ tasks: [{ id: "done", status: "Finished", workerId: "tech", workerName: "Alex" }], offers: [{ status: "Accepted", claims: [{ status: "Accepted", workerId: "tech", workerName: "Alex", taskIds: ["done"] }] }] });
  expect(result.people).toEqual([]);
  expect(result.state).toBe("Not scheduled");
});

test("loading does not flash an unassigned warning", () => {
  renderSnapshot({ loading: true });
  expect(screen.getByRole("status")).toHaveTextContent("Loading next assignment");
  expect(screen.queryByText("No technician assigned yet")).not.toBeInTheDocument();
});
