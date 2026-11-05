import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getDoc, getDocs } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import RecurringServiceStopDetails from "./RecurringServiceStopDetails";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../utils/errorReporting", () => ({ reportAppError: jest.fn() }));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../components/share/ShareItemButton", () => () => null);
jest.mock("firebase/functions", () => ({ getFunctions: () => ({}), httpsCallable: jest.fn() }));
jest.mock("firebase/firestore", () => {
  const ref = (first, ...parts) => [typeof first === "string" ? first : "", ...parts].filter(Boolean).join("/");
  return {
    doc: ref,
    collection: ref,
    query: (path, ...constraints) => ({ path, constraints }),
    where: (field, operator, value) => ({ type: "where", field, operator, value }),
    orderBy: (field, direction = "asc") => ({ type: "orderBy", field, direction }),
    limit: (count) => ({ type: "limit", count }),
    getDoc: jest.fn(), getDocs: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(), writeBatch: jest.fn(),
  };
});

const snapshot = (id, data) => ({ id, exists: () => true, data: () => data });
const stop = (id, date, recurringServiceStopId = "recurring") => snapshot(id, {
  internalId: id,
  recurringServiceStopId,
  serviceDate: { toDate: () => new Date(date) },
});

// Apply Firestore's default ascending range order as well as explicit ordering,
// so limiting before requesting descending order reproduces the reported bug.
const queryStops = (stops, constraints) => {
  let docs = [...stops];
  const comparable = (value) => value?.toDate?.() || value;
  for (const { type, field, operator, value } of constraints) {
    if (type !== "where") continue;
    docs = docs.filter((doc) => {
      const actual = comparable(doc.data()[field]);
      if (operator === "==") return actual === value;
      if (operator === "<") return actual < value;
      if (operator === ">=") return actual >= value;
      throw new Error(`Unsupported test operator: ${operator}`);
    });
  }
  const ordering = constraints.find((constraint) => constraint.type === "orderBy");
  const range = constraints.find((constraint) => constraint.type === "where" && constraint.operator !== "==");
  const field = ordering?.field || range?.field;
  if (field) {
    docs.sort((a, b) => (comparable(a.data()[field]) - comparable(b.data()[field])) * (ordering?.direction === "desc" ? -1 : 1));
  }
  const count = constraints.find((constraint) => constraint.type === "limit")?.count;
  return { docs: count === undefined ? docs : docs.slice(0, count) };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers("modern");
  jest.setSystemTime(new Date("2026-11-03T12:00:00"));
  getDoc.mockResolvedValue(snapshot("recurring", {
    internalId: "RSS-1", startDate: new Date("2026-01-01T12:00:00"), noEndDate: true,
  }));
});

afterEach(() => jest.useRealTimers());

const openDetails = async (stops) => {
  getDocs.mockImplementation(async (ref) => (
    ref.path?.endsWith("/serviceStops") ? queryStops(stops, ref.constraints) : { docs: [] }
  ));
  render(
    <MemoryRouter initialEntries={["/recurring/recurring"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Context.Provider value={{ recentlySelectedCompany: "company" }}>
        <Routes>
          <Route path="/recurring/:recurringServiceStopId" element={<RecurringServiceStopDetails />} />
        </Routes>
      </Context.Provider>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { name: "Recent Service" });
  return screen.getByRole("complementary");
};

test("Recent Service shows the newest five stops through today, newest first, scoped to this recurring stop", async () => {
  const sidebar = await openDetails([
    stop("oldest", "2026-09-01T12:00:00"),
    stop("tomorrow", "2026-11-04T00:00:00"),
    stop("oct-27", "2026-10-27T12:00:00"),
    stop("oct-13", "2026-10-13T12:00:00"),
    stop("today", "2026-11-03T23:59:59.999"),
    stop("other-recurring", "2026-11-03T23:59:59.999", "other"),
    stop("oct-20", "2026-10-20T12:00:00"),
    stop("yesterday", "2026-11-02T12:00:00"),
  ]);
  const buttons = within(sidebar).getAllByRole("button");
  const expectedOrder = ["tomorrow", "today", "yesterday", "oct-27", "oct-20", "oct-13"];
  expect(buttons).toHaveLength(expectedOrder.length);
  expectedOrder.forEach((id, index) => expect(buttons[index]).toHaveAccessibleName(new RegExp(`^${id}\\b`)));
  expect(within(sidebar).getByText("5 recent service stops")).toBeInTheDocument();
  expect(within(sidebar).getByText("1 future service stop")).toBeInTheDocument();
});

test.each(["2026-03-08", "2026-11-01"])("today's cutoff follows local midnight on the daylight-saving transition %s", async (day) => {
  jest.setSystemTime(new Date(`${day}T00:30:00`));
  const tomorrow = new Date(`${day}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sidebar = await openDetails([
    stop("today", `${day}T23:59:59.999`),
    stop("tomorrow", tomorrow),
  ]);
  const buttons = within(sidebar).getAllByRole("button");
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toHaveAccessibleName(/^tomorrow\b/);
  expect(buttons[1]).toHaveAccessibleName(/^today\b/);
  expect(within(sidebar).getByText("1 recent service stop")).toBeInTheDocument();
  expect(within(sidebar).getByText("1 future service stop")).toBeInTheDocument();
});
