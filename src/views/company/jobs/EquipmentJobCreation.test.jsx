import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { getDoc, getDocs } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { createJobAtomically } from "../../../utils/createJobAtomically";
import { appAlert } from "../../../utils/appDialog";
import BasicWorkOrderCreate from "./BasicWorkOrderCreate";
import EquipmentList from "../equipment/EquipmentList";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../utils/createJobAtomically", () => ({ createJobAtomically: jest.fn() }));
jest.mock("../../../utils/appDialog", () => ({ appAlert: jest.fn() }));
jest.mock("react-hot-toast", () => ({ success: jest.fn(), error: jest.fn() }));
let mockPermissions;
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({
    can: (id) => mockPermissions.includes(id), permissionsReady: true,
}));
jest.mock("firebase/firestore", () => ({
    collection: (base, ...parts) => [typeof base === "string" ? base : "", ...parts].filter(Boolean).join("/"),
    doc: (_, ...parts) => parts.join("/"), query: (ref) => ref,
    where: jest.fn(), orderBy: jest.fn(), arrayUnion: (...items) => items,
    serverTimestamp: () => "server-time", Timestamp: { fromDate: (date) => date, now: () => new Date() },
    getDoc: jest.fn(), getDocs: jest.fn(),
}));

const snapshot = (id, data, path = "") => ({ id, ref: `${path}/${id}`, exists: () => true, data: () => data });
const template = { id: "template-1", name: "Filter service", isActive: true, defaultRateCents: 10000, defaultIssuePriorityLevel: 1 };
const equipment = {
    id: "equipment-1", name: "Filter", type: "Filter", customerId: "customer-1", customerName: "Taylor Customer",
    serviceLocationId: "location-1", bodyOfWaterId: "pool-1", needsService: true, isActive: true,
    nextServiceDate: { toDate: () => new Date(Date.now() + 86400000 * 7) },
};
let writes;
let activeJobs;
beforeEach(() => {
    jest.clearAllMocks();
    writes = new Map();
    activeJobs = [];
    mockPermissions = ["22", "23", "60", "64"];
    getDoc.mockImplementation(async (path) => snapshot(path.split("/").pop(),
        path.endsWith("/template-1") ? template : path.endsWith("/customer-1") ? { active: true }
            : path.endsWith("/location-1") ? { customerId: "customer-1", address: { streetAddress: "123 Pool Street" } } : {}));
    getDocs.mockImplementation(async (path) => ({ docs:
        path.endsWith("/companyUsers") ? [snapshot("admin-1", { userId: "office-1", userName: "Office Admin", roleName: "Admin", status: "Active" })]
            : path.endsWith("/customers") ? [snapshot("customer-1", { firstName: "Taylor", lastName: "Customer", active: true })]
                : path.endsWith("/serviceLocations") ? [snapshot("location-1", { customerId: "customer-1", address: { streetAddress: "123 Pool Street" } })]
                    : path.endsWith("/bodiesOfWater") ? [snapshot("pool-1", { name: "Pool" })]
                        : path.endsWith("/equipment") ? [snapshot("equipment-1", equipment)]
                            : path.endsWith("/jobTemplates") ? [snapshot("template-1", template)]
                                : path.endsWith("/jobTemplates/template-1/tasks") ? [snapshot("template-task", { name: "Clean filter", type: "Maintenance", requiresEquipment: true, billingLaborPriceCents: 10000 })]
                                    : path.endsWith("/jobTemplates/template-1/plannedServiceStops") ? [snapshot("template-stop", { name: "Service visit", taskIds: ["template-task"] })]
                                        : path.endsWith("/workOrders") ? activeJobs.map((job) => snapshot(job.id, job, path)) : [],
    }));
    createJobAtomically.mockImplementation(async (_, { jobId }, build) => {
        const staged = new Map();
        await build({ get: getDoc, set: (ref, data) => staged.set(ref, data), update: (ref, data) => staged.set(ref, data) });
        writes = staged;
        const savedJob = [...staged.entries()].find(([path]) => /\/workOrders\/[^/]+$/.test(path))?.[1];
        if (savedJob) activeJobs.push({ ...savedJob, id: jobId });
        return { existing: false };
    });
});

const CurrentPath = () => <p data-testid="current-path">{useLocation().pathname}</p>;
const renderFlow = (entry) => render(<MemoryRouter initialEntries={[entry]}>
    <CurrentPath />
    <Context.Provider value={{ recentlySelectedCompany: "company-1", user: { uid: "user-1", displayName: "Alex" } }}>
        <Routes>
            <Route path="/company/equipment/:tab" element={<EquipmentList />} />
            <Route path="/company/jobs/basic-create" element={<BasicWorkOrderCreate />} />
            <Route path="/company/jobs/detail/:jobId" element={<p>Saved job details</p>} />
        </Routes>
    </Context.Provider>
</MemoryRouter>);

const openUnscheduled = async (mode = "basic") => {
    renderFlow({ pathname: "/company/jobs/basic-create",
        search: `?schedule=later&customerId=customer-1&locationId=location-1&bodyOfWaterId=pool-1&equipmentId=equipment-1${mode === "template" ? "&templateId=template-1" : ""}`,
        state: { equipmentContext: { ...equipment, equipmentId: equipment.id, equipmentName: "Filter", jobIntent: "maintenance" }, jobIntent: "maintenance" },
    });
    if (mode === "basic") fireEvent.click(await screen.findByRole("button", { name: /^Basic Job/ }));
    const button = await screen.findByRole("button", { name: "Create Job" });
    await waitFor(() => expect(button).toBeEnabled());
    return button;
};
const rootJob = () => [...writes.entries()].find(([path]) => /\/workOrders\/[^/]+$/.test(path))?.[1];

const openEquipmentPopup = async () => {
    renderFlow("/company/equipment/upcoming");
    const actions = await screen.findAllByRole("button", { name: "Open quick actions" });
    fireEvent.click(actions[0]);
    const menu = screen.getByRole("menu");
    const labels = within(menu).getAllByRole("button").map((button) => button.textContent);
    expect(labels.indexOf("Create Job")).toBeLessThan(labels.indexOf("Schedule Maintenance"));
    fireEvent.click(within(menu).getByRole("button", { name: "Create Job" }));
    await screen.findByRole("dialog", { name: "Create Job" });
    expect(screen.getByTestId("current-path")).toHaveTextContent("/company/equipment/upcoming");
    expect(screen.queryByRole("link", { name: "Back to Jobs" })).not.toBeInTheDocument();
};

test.each(["basic", "template"])("equipment Create Job opens a popup, preserves equipment in %s mode, and refreshes Active Jobs without navigating", async (mode) => {
    await openEquipmentPopup();
    if (mode === "basic") fireEvent.click(await screen.findByRole("button", { name: /^Basic Job/ }));
    const button = await screen.findByRole("button", { name: "Create Job" });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => fireEvent.click(button));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("current-path")).toHaveTextContent("/company/equipment/upcoming");
    expect(rootJob()).toEqual(expect.objectContaining({ equipmentId: "equipment-1", jobIntent: "maintenance", createdFromEquipmentCard: true }));
    expect(await screen.findByRole("link", { name: rootJob().internalId || "Job" })).toHaveAttribute("href", `/company/jobs/detail/${rootJob().id}`);
});

test.each(["Cancel", "Close create job", "Escape"])("%s dismisses Create Job without a write or navigation and allows reopening", async (action) => {
    await openEquipmentPopup();
    await screen.findByRole("button", { name: /^Basic Job/ });
    if (action === "Escape") await act(async () => userEvent.keyboard("{Escape}"));
    else fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("current-path")).toHaveTextContent("/company/equipment/upcoming");
    expect(createJobAtomically).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Open quick actions" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Create Job" }));
    expect(await screen.findByRole("dialog", { name: "Create Job" })).toBeInTheDocument();
});

test("Create Job cannot be dismissed or submitted again while saving", async () => {
    await openEquipmentPopup();
    fireEvent.click(await screen.findByRole("button", { name: /^Basic Job/ }));
    const button = screen.getByRole("button", { name: "Create Job" });
    await waitFor(() => expect(button).toBeEnabled());
    const create = createJobAtomically.getMockImplementation();
    let finishSaving;
    createJobAtomically.mockImplementationOnce((...args) => new Promise((resolve) => {
        finishSaving = () => create(...args).then(resolve);
    }));
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close create job" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    await act(async () => userEvent.keyboard("{Escape}"));
    expect(screen.getByRole("dialog", { name: "Create Job" })).toBeInTheDocument();
    await act(async () => finishSaving());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(createJobAtomically).toHaveBeenCalledTimes(1);
});

test.each(["basic", "template"])("%s jobs save approved work without an assignee or appointment", async (mode) => {
    const button = await openUnscheduled(mode);
    expect(screen.queryByText("Scheduled Time")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(button));
    await screen.findByText("Saved job details");
    expect(rootJob()).toEqual(expect.objectContaining({
        operationStatus: "Unscheduled", billingStatus: "Accepted", issuePriorityLevel: 3,
        customerId: "customer-1", serviceLocationId: "location-1", bodyOfWaterId: "pool-1", equipmentId: "equipment-1",
        assignedTechId: "", assignedTechName: "", assignedCompanyUserId: "", assignedTechRegionTags: [],
        scheduledAt: null, scheduledDate: null, serviceStopIds: [], adminId: "office-1",
    }));
    expect([...writes.keys()].some((path) => /\/serviceStops\/|\/scheduledWork\//.test(path))).toBe(false);
    expect(getDoc).not.toHaveBeenCalledWith("companies/company-1/settings/recurringServiceStops");
    const tasks = [...writes.entries()].filter(([path]) => /\/tasks\/[^/]+$/.test(path)).map(([, data]) => data);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(expect.objectContaining({ status: "Draft", workerId: "", equipmentId: "equipment-1", type: "Maintenance" }));
    expect([...writes.values()].find((value) => value.eventType === "Created")).toEqual(expect.objectContaining({ title: "Job created", metadata: expect.objectContaining({ scheduledServiceStopId: "" }) }));
    if (mode === "template") {
        expect(rootJob().sourceTemplateId).toBe("template-1");
        const stop = [...writes.entries()].find(([path]) => /\/plannedServiceStops\/[^/]+$/.test(path))[1];
        expect(stop.taskIds).toEqual([tasks[0].id]);
    } else {
        expect(rootJob().sourceTemplateId).toBe("");
    }
    expect(appAlert).not.toHaveBeenCalled();
});

test.each(["Draft", "Estimate"])("approval can remain %s before the job is created", async (status) => {
    const button = await openUnscheduled();
    fireEvent.change(screen.getByRole("combobox", { name: /Billing Status/ }), { target: { value: status } });
    await act(async () => fireEvent.click(button));
    await screen.findByText("Saved job details");
    expect(rootJob()).toEqual(expect.objectContaining({ operationStatus: "Unscheduled", billingStatus: status }));
});

test("approved unscheduled work is linked from the equipment's active jobs", async () => {
    activeJobs = [{ id: "job-1", internalId: "J15", equipmentId: "equipment-1", operationStatus: "Unscheduled", billingStatus: "Accepted" }];
    renderFlow("/company/equipment/upcoming");
    expect(await screen.findByRole("link", { name: "J15" })).toHaveAttribute("href", "/company/jobs/detail/job-1");
    expect(screen.getByRole("link", { name: "J15" })).toHaveAttribute("title", expect.stringContaining("Unscheduled"));
});

test("scheduling-only permission cannot create unscheduled work through a direct URL", async () => {
    mockPermissions = ["23", "60"];
    renderFlow("/company/jobs/basic-create?schedule=later");
    await screen.findByRole("heading", { name: "Permission Required" });
    expect(screen.queryByRole("button", { name: "Create Job" })).not.toBeInTheDocument();
    expect(createJobAtomically).not.toHaveBeenCalled();
});

test("scheduling-only users retain Schedule Maintenance without the new creation action", async () => {
    mockPermissions = ["23", "60"];
    renderFlow("/company/equipment/upcoming");
    fireEvent.click((await screen.findAllByRole("button", { name: "Open quick actions" }))[0]);
    expect(screen.getByRole("button", { name: "Schedule Maintenance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Job" })).not.toBeInTheDocument();
});

test("a failed create preserves the form and reuses its job ID on retry", async () => {
    await openEquipmentPopup();
    fireEvent.click(await screen.findByRole("button", { name: /^Basic Job/ }));
    const button = screen.getByRole("button", { name: "Create Job" });
    await waitFor(() => expect(button).toBeEnabled());
    createJobAtomically.mockRejectedValueOnce(new Error("Connection interrupted"));
    await act(async () => fireEvent.click(button));
    expect(writes.size).toBe(0);
    expect(screen.getByRole("combobox", { name: /Billing Status/ })).toHaveValue("Accepted");
    await act(async () => fireEvent.click(button));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("current-path")).toHaveTextContent("/company/equipment/upcoming");
    expect(createJobAtomically.mock.calls[0][1].jobId).toBe(createJobAtomically.mock.calls[1][1].jobId);
});

test("creation waits for location equipment so a slow load cannot drop the equipment link", async () => {
    let releaseEquipment;
    const originalGetDocs = getDocs.getMockImplementation();
    getDocs.mockImplementation((path) => path.endsWith("/equipment")
        ? new Promise((resolve) => { releaseEquipment = () => resolve({ docs: [snapshot("equipment-1", equipment)] }); })
        : originalGetDocs(path));
    renderFlow({ pathname: "/company/jobs/basic-create", search: "?schedule=later&customerId=customer-1&locationId=location-1&equipmentId=equipment-1" });
    fireEvent.click(await screen.findByRole("button", { name: /^Basic Job/ }));
    await waitFor(() => expect(releaseEquipment).toBeDefined());
    const button = await screen.findByRole("button", { name: "Create Job" });
    expect(button).toBeDisabled();
    expect(createJobAtomically).not.toHaveBeenCalled();
    await act(async () => releaseEquipment());
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => fireEvent.click(button));
    await screen.findByText("Saved job details");
    expect(rootJob().equipmentId).toBe("equipment-1");
});
