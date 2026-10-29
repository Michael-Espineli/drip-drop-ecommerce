import React, { Suspense } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useRoutes } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import publicRoutes from "../../routes/routes/publicRoutes";

jest.mock("../../utils/config", () => ({ functions: {} }));
jest.mock("firebase/functions", () => ({ httpsCallable: jest.fn() }));
const mockGetCompany = jest.fn();
const mockGetOptions = jest.fn();
const mockSubmit = jest.fn();
const PublicRoutes = () => useRoutes(publicRoutes);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCompany.mockResolvedValue({ data: {
    company: { id: "test-company", name: "Sample Pool Company" },
    users: [{ id: "tech-alex", label: "Alex Technician" }],
    customers: [{ id: "customer-taylor", label: "Taylor Homeowner" }, { id: "customer-acme", label: "Acme Pools" }],
  } });
  mockGetOptions.mockImplementation(({ customerId, locationId }) => Promise.resolve({ data: locationId
    ? { bodiesOfWater: [{ id: "pool-main", label: "Main pool" }], equipment: [{ id: "pump-main", label: "Main pump - Model A" }] }
    : { serviceLocations: [{ id: customerId === "customer-acme" ? "location-acme" : "location-main", label: customerId === "customer-acme" ? "Acme location" : "Backyard" }] },
  }));
  mockSubmit.mockResolvedValue({ data: { requestId: "public_rr_test" } });
  httpsCallable.mockImplementation((_, name) => ({ getPublicRepairRequestCompany: mockGetCompany, getPublicRepairRequestOptions: mockGetOptions, submitPublicRepairRequest: mockSubmit })[name]);
  URL.createObjectURL = jest.fn(() => "blob:test-photo");
  URL.revokeObjectURL = jest.fn();
});

const openForm = async (path = "/request-repair/test-company") => {
  render(<MemoryRouter initialEntries={[path]}><Suspense fallback="Loading"><PublicRoutes /></Suspense></MemoryRouter>);
  await screen.findByRole("heading", { name: "Create External Repair Request" });
};
const chooseOption = async (label, name) => {
  const input = screen.getByRole("combobox", { name: label, exact: true });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name, exact: true }));
};
const fillRequiredFields = async () => {
  await chooseOption("Technician", "Alex Technician");
  await chooseOption("Customer", "Taylor Homeowner");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Equipment (Optional)", exact: true })).toBeEnabled());
  fireEvent.change(screen.getByRole("textbox", { name: "Description", exact: true }), { target: { value: "The pump is leaking." } });
};

test('the public intake sends the selected numeric priority', async () => {
  await openForm();
  await fillRequiredFields();
  const priority = screen.getByRole('combobox', { name: 'Priority', exact: true });
  expect(priority).toHaveValue('2');
  fireEvent.change(priority, { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit repair request' }));
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ issuePriorityLevel: 1 })));
});

test.each(["/request-repair/test-company", "/public/repair-request/test-company"])("%s renders without an auth provider or sign-in", async (path) => {
  await openForm(path);
  expect(screen.getByText(/For technicians: select your name and customer/)).toBeInTheDocument();
  expect(mockGetCompany).toHaveBeenCalledWith({ companyId: "test-company" });
  expect(screen.queryByRole("button", { name: "Sign In" })).not.toBeInTheDocument();
});

test("requires technician and customer selections before calling the server", async () => {
  await openForm();
  fireEvent.change(screen.getByRole("textbox", { name: "Description", exact: true }), { target: { value: "The pump is leaking." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit repair request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("select a technician and customer");
  expect(mockSubmit).not.toHaveBeenCalled();
});

test("submits directly to the company and displays a receipt without asking for an account", async () => {
  await openForm();
  await fillRequiredFields();
  await chooseOption("Body Of Water (Optional)", "Main pool");
  await chooseOption("Equipment (Optional)", "Main pump - Model A");
  expect(screen.getByRole("combobox", { name: "Equipment Status", exact: true })).toHaveValue("Needs Repair");
  fireEvent.click(screen.getByRole("button", { name: "Submit repair request" }));
  await screen.findByRole("heading", { name: "Your repair request is in." });
  expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: "test-company", requesterCompanyUserId: "tech-alex", customerId: "customer-taylor", locationId: "location-main", bodyOfWaterId: "pool-main", equipmentId: "pump-main", equipmentStatusUpdate: "Needs Repair", description: "The pump is leaking.", photos: [] }));
  expect(screen.getByText("Reference: public_rr_test")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit repair request" })).not.toBeInTheDocument();
});

test("a failed submission preserves the form and reuses the submission id on retry", async () => {
  mockSubmit.mockRejectedValueOnce(new Error("network failure"));
  await openForm();
  await fillRequiredFields();
  fireEvent.click(screen.getByRole("button", { name: "Submit repair request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your details are still here");
  expect(screen.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("The pump is leaking.");
  const firstId = mockSubmit.mock.calls[0][0].submissionId;
  fireEvent.click(screen.getByRole("button", { name: "Submit repair request" }));
  await screen.findByRole("heading", { name: "Your repair request is in." });
  expect(mockSubmit.mock.calls[1][0].submissionId).toBe(firstId);
});

test("an edited request gets a new id after a failed submission", async () => {
  mockSubmit.mockRejectedValueOnce(new Error("network failure"));
  await openForm();
  await fillRequiredFields();
  fireEvent.click(screen.getByRole("button", { name: "Submit repair request" }));
  await screen.findByRole("alert");
  const firstId = mockSubmit.mock.calls[0][0].submissionId;
  fireEvent.change(screen.getByRole("textbox", { name: "Description", exact: true }), { target: { value: "The heater also needs repair." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit repair request" }));
  await screen.findByRole("heading", { name: "Your repair request is in." });
  expect(mockSubmit.mock.calls[1][0].submissionId).not.toBe(firstId);
});

test("rejects unsupported photos and lets the visitor remove a selected photo", async () => {
  await openForm();
  fireEvent.change(screen.getByLabelText("Attach photos"), { target: { files: [new File(["svg"], "unsafe.svg", { type: "image/svg+xml" })] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("JPG, PNG, or WebP");
  fireEvent.change(screen.getByLabelText("Attach photos"), { target: { files: [new File(["png"], "pool.png", { type: "image/png" })] } });
  expect(screen.getByRole("img", { name: "Attachment 1: pool.png" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove pool.png" }));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-photo");
});

test("a company load failure offers a retry without redirecting to sign-in", async () => {
  mockGetCompany.mockRejectedValueOnce(new Error("network failure"));
  render(<MemoryRouter initialEntries={["/request-repair/test-company"]}><Suspense fallback="Loading"><PublicRoutes /></Suspense></MemoryRouter>);
  await screen.findByRole("heading", { name: "Repair request form unavailable" });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { name: "Create External Repair Request" });
  await waitFor(() => expect(mockGetCompany).toHaveBeenCalledTimes(2));
});

test("changing customer clears the previous location, pool, equipment and equipment status", async () => {
  await openForm();
  await fillRequiredFields();
  await chooseOption("Equipment (Optional)", "Main pump - Model A");
  expect(screen.getByRole("combobox", { name: "Equipment Status", exact: true })).toBeInTheDocument();
  await chooseOption("Customer", "Acme Pools");
  await screen.findByText("Acme location");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Equipment (Optional)", exact: true })).toBeEnabled());
  expect(screen.queryByRole("combobox", { name: "Equipment Status", exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Submit repair request" }));
  await screen.findByRole("heading", { name: "Your repair request is in." });
  expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-acme", locationId: "location-acme", equipmentId: "", equipmentStatusUpdate: "" }));
});

test("selection load errors can be retried without losing the chosen technician and customer", async () => {
  mockGetOptions.mockRejectedValueOnce(new Error("network failure"));
  await openForm();
  await chooseOption("Technician", "Alex Technician");
  await chooseOption("Customer", "Taylor Homeowner");
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load this customer's locations");
  fireEvent.click(screen.getByRole("button", { name: "Retry selections" }));
  await screen.findByText("Backyard");
  expect(screen.getByText("Alex Technician")).toBeInTheDocument();
  expect(screen.getByText("Taylor Homeowner")).toBeInTheDocument();
});
