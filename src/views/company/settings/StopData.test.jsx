import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import StopData from "./StopData";

jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...segments) => ({ path: segments.join("/") }),
  getDocs: jest.fn(),
}));
jest.mock("react-hot-toast", () => ({ error: jest.fn() }));

const snapshot = (records = []) => ({
  docs: records.map((record) => ({ id: record.id, data: () => record })),
});
const stops = (count) => Array.from({ length: count }, (_, index) => ({ id: `stop-${index}` }));
const storeRecord = (id, extra = {}) => ({
  id,
  customerName: id,
  date: new Date("2026-10-26T12:00:00Z"),
  readings: [{ id: "ph", name: "pH", amount: "7.4" }],
  ...extra,
});
const view = (company = "company") => (
  <Context.Provider value={{ recentlySelectedCompany: company }}>
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <StopData />
    </MemoryRouter>
  </Context.Provider>
);
const storeCalls = (company = "company") => getDocs.mock.calls.filter(([ref]) => (
  ref.path.startsWith(`companies/${company}/`) && ref.path.endsWith("/stores")
));

let warn;

beforeEach(() => {
  jest.clearAllMocks();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

test("a large history loads every stop with at most six store requests in flight", async () => {
  const pending = [];
  let active = 0;
  let peak = 0;
  getDocs.mockImplementation((ref) => {
    if (ref.path === "companies/company/serviceStops") return Promise.resolve(snapshot(stops(40)));
    if (!ref.path.endsWith("/stores")) return Promise.resolve(snapshot());
    active += 1;
    peak = Math.max(peak, active);
    return new Promise((resolve) => pending.push(() => {
      active -= 1;
      resolve(snapshot([storeRecord(ref.path.split("/")[3])]));
    }));
  });

  render(view());
  await waitFor(() => expect(pending).toHaveLength(6));
  while (pending.length) {
    await act(async () => pending.splice(0).forEach((resolve) => resolve()));
  }

  expect(peak).toBe(6);
  expect(storeCalls()).toHaveLength(40);
  expect(screen.getByText("40 visible from 40 records across 40 service stops.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("leaving the screen stops queued store reads", async () => {
  const pending = [];
  getDocs.mockImplementation((ref) => {
    if (ref.path === "companies/company/serviceStops") return Promise.resolve(snapshot(stops(40)));
    if (!ref.path.endsWith("/stores")) return Promise.resolve(snapshot());
    return new Promise((resolve) => pending.push(resolve));
  });

  const { unmount } = render(view());
  await waitFor(() => expect(pending).toHaveLength(6));
  unmount();
  await act(async () => pending.forEach((resolve) => resolve(snapshot())));

  expect(storeCalls()).toHaveLength(6);
  expect(toast.error).not.toHaveBeenCalled();
});

test("leaving before the initial collections resolve never starts store reads", async () => {
  let resolveCompanyRecords;
  getDocs.mockImplementation((ref) => {
    if (ref.path.endsWith("/stopData")) {
      return new Promise((resolve) => { resolveCompanyRecords = resolve; });
    }
    return Promise.resolve(snapshot(ref.path.endsWith("/serviceStops") ? stops(40) : []));
  });

  const { unmount } = render(view());
  unmount();
  await act(async () => resolveCompanyRecords(snapshot()));

  expect(storeCalls()).toHaveLength(0);
});

test("switching companies discards stale results and stops the old company's queue", async () => {
  const pending = [];
  getDocs.mockImplementation((ref) => {
    const company = ref.path.split("/")[1];
    if (ref.path.endsWith("/serviceStops")) return Promise.resolve(snapshot(stops(company === "old" ? 40 : 2)));
    if (!ref.path.endsWith("/stores")) return Promise.resolve(snapshot());
    return new Promise((resolve) => pending.push({
      company,
      resolve: () => resolve(snapshot([storeRecord(`${company}-${ref.path.split("/")[3]}`)])),
    }));
  });

  const { rerender } = render(view("old"));
  await waitFor(() => expect(storeCalls("old")).toHaveLength(6));
  rerender(view("new"));
  await waitFor(() => expect(storeCalls("new")).toHaveLength(2));
  await act(async () => pending.filter((item) => item.company === "new").forEach((item) => item.resolve()));
  expect(screen.getByText("2 visible from 2 records across 2 service stops.")).toBeInTheDocument();

  await act(async () => pending.filter((item) => item.company === "old").forEach((item) => item.resolve()));
  expect(storeCalls("old")).toHaveLength(6);
  expect(screen.getByText("new-stop-0")).toBeInTheDocument();
  expect(screen.queryByText("old-stop-0")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("a failed store shows a warning, preserves available records, and can be refreshed", async () => {
  let failStore = true;
  const error = { code: "resource-exhausted", message: "Too many outstanding requests." };
  getDocs.mockImplementation((ref) => {
    if (ref.path.endsWith("/serviceStops")) return Promise.resolve(snapshot(stops(2)));
    if (ref.path.endsWith("/stopData")) return Promise.resolve(snapshot([storeRecord("company-record")]));
    if (ref.path.endsWith("/stores")) {
      const id = ref.path.split("/")[3];
      if (id === "stop-0" && failStore) return Promise.reject(error);
      return Promise.resolve(snapshot([storeRecord(id)]));
    }
    return Promise.resolve(snapshot());
  });

  render(view());
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load history for 1 service stop.");
  expect(screen.getByText("2 visible from 2 records across 2 service stops.")).toBeInTheDocument();
  expect(screen.getByText("company-record")).toBeInTheDocument();
  expect(warn).toHaveBeenCalledWith(
    "Failed to load 1 stop data store collection(s).",
    [{ serviceStopId: "stop-0", error }]
  );

  failStore = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("3 visible from 3 records across 2 service stops.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("missing service stop history is visibly reported while company data remains available", async () => {
  getDocs.mockImplementation((ref) => {
    if (ref.path.endsWith("/serviceStops")) return Promise.reject(new Error("Read failed"));
    return Promise.resolve(snapshot(ref.path.endsWith("/stopData") ? [storeRecord("company-record")] : []));
  });

  render(view());
  expect(await screen.findByRole("alert")).toHaveTextContent("Service stop history could not be loaded.");
  expect(screen.getByText("company-record")).toBeInTheDocument();
  expect(storeCalls()).toHaveLength(0);
});

test("company records and matching compatibility copies still display only once", async () => {
  const record = storeRecord("shared", { serviceStopId: "stop-0" });
  getDocs.mockImplementation((ref) => {
    if (ref.path.endsWith("/serviceStops")) return Promise.resolve(snapshot(stops(1)));
    if (ref.path.endsWith("/stopData")) return Promise.resolve(snapshot([record]));
    if (ref.path.endsWith("/stores")) return Promise.resolve(snapshot([record, { ...record, id: "legacy-copy" }]));
    return Promise.resolve(snapshot());
  });

  render(view());
  await screen.findByText("1 visible from 1 records across 1 service stops.");
  expect(screen.getAllByText("shared")).toHaveLength(1);
});
