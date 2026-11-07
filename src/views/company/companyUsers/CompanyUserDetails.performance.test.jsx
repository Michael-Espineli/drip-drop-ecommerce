import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getDoc, getDocs } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import CompanyUserDetails from "./CompanyUserDetails";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {}, functions: {}, storage: {} }));
jest.mock("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: {} }) }));
jest.mock("firebase/storage", () => ({ getDownloadURL: jest.fn(), ref: jest.fn(), uploadBytes: jest.fn() }));
jest.mock("react-hot-toast", () => ({ error: jest.fn(), success: jest.fn() }));
let mockCanView = true;
const mockCan = (id) => id === "260" && mockCanView;
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: mockCan, requirePermission: mockCan, permissionsReady: true }));
jest.mock("./PerformanceDownloadDialog", () => (props) => <div role="dialog" aria-label="Download settings">{props.companyId}/{props.companyUserId}/{props.technicianName}<button onClick={props.onClose}>Cancel Download</button></div>);
jest.mock("firebase/firestore", () => ({
    collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"),
    query: (ref) => ref, where: jest.fn(), orderBy: jest.fn(), limit: jest.fn(),
    getDocs: jest.fn(), getDoc: jest.fn(), addDoc: jest.fn(), updateDoc: jest.fn(),
    serverTimestamp: jest.fn(), Timestamp: { fromDate: (date) => date }, writeBatch: jest.fn(),
}));
const member = { id: "membership-1", data: () => ({ userId: "auth-tech-1", userName: "Taylor Technician" }), exists: () => true };
const snapshot = (docs = []) => ({ docs, empty: !docs.length, forEach: (callback) => docs.forEach(callback) });
beforeEach(() => {
    jest.clearAllMocks();
    mockCanView = true;
    getDocs.mockImplementation(async (ref) => snapshot(ref === "companies/company-1/companyUsers" ? [member] : []));
    getDoc.mockResolvedValue({ exists: () => false });
});
const open = () => render(<MemoryRouter initialEntries={["/company/companyUsers/auth-tech-1/performance"]}>
    <Context.Provider value={{ recentlySelectedCompany: "company-1", user: { uid: "manager-1" }, dataBaseUser: {}, isFeatureEnabled: () => false }}>
        <Routes><Route path="/company/companyUsers/:companyUserId/:tab" element={<CompanyUserDetails />} /></Routes>
    </Context.Provider>
</MemoryRouter>);

test("view-only managers can open download settings with the resolved membership ID", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Download", exact: true }));
    expect(screen.getByRole("dialog", { name: "Download settings" })).toHaveTextContent("company-1/membership-1/Taylor Technician");
    expect(screen.queryByRole("button", { name: "Add Performance Note" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Download" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("performance access is required to show the download action", async () => {
    mockCanView = false;
    open();
    await screen.findByRole("heading", { name: "Taylor Technician" });
    expect(screen.queryByRole("button", { name: "Download", exact: true })).not.toBeInTheDocument();
});
