import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { onSnapshot } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import JobHistoryView from "./JobHistoryView";

jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("firebase/firestore", () => ({
  doc: (_, ...segments) => ({ path: segments.join("/") }),
  collection: (parent, segment) => ({ path: `${parent.path}/${segment}` }),
  onSnapshot: jest.fn(),
}));
const display = () => render(<Context.Provider value={{ recentlySelectedCompany: "company" }}><MemoryRouter initialEntries={["/company/jobs/history/job"]}><Routes><Route path="/company/jobs/history/:jobId" element={<JobHistoryView />} /></Routes></MemoryRouter></Context.Provider>);
const subscribe = (events) => onSnapshot.mockImplementation((ref, next) => {
  if (ref.path.endsWith("/history")) next({ docs: events.map((event) => ({ id: event.id, data: () => event })) });
  else next({ exists: () => true, data: () => ({ internalId: "J42" }) });
  return jest.fn();
});

afterEach(() => jest.clearAllMocks());

test("the history route shows real creation attribution and time instead of example data", () => {
  subscribe([{ id: "created", eventType: "Created", title: "Job created", actorUserName: "Alex Creator", actorUserId: "creator", createdAtMillis: Date.parse("2026-10-23T18:30:00Z") }]);
  display();
  expect(screen.getByRole("heading", { name: "Job History · J42" })).toBeInTheDocument();
  expect(screen.getByText(/Alex Creator ·/)).toHaveTextContent("2026");
  expect(screen.queryByText(/John Draney|Revert Changes/)).not.toBeInTheDocument();
  expect(onSnapshot.mock.calls[1][0].path).toBe("companies/company/workOrders/job/history");
});

test("an older job without history shows an honest empty state", () => {
  subscribe([]);
  display();
  expect(screen.getByText("No history has been recorded for this job.")).toBeInTheDocument();
  expect(screen.queryByText("Job initially created")).not.toBeInTheDocument();
});

test("history read failures show an error", () => {
  onSnapshot.mockImplementation((ref, next, error) => {
    if (ref.path.endsWith("/history")) error(new Error("Permission denied"));
    else next({ exists: () => true, data: () => ({ internalId: "J42" }) });
    return jest.fn();
  });
  display();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load job history");
});
