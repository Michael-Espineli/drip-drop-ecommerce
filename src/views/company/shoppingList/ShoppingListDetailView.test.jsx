import React, { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getDoc, getDocs, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { syncLinkedShoppingPurchase } from "../../../utils/shoppingPurchaseSync";
import {
    createAndSendShoppingItemInstallInvoice,
    updateLinkedPartApprovalForManualShoppingInvoice,
} from "../../../utils/sales/shoppingItemInvoiceAutomation";
import ShoppingListDetailView from "./ShoppingListDetailView";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {}, functions: {}, storage: {} }));
jest.mock("react-hot-toast", () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock("firebase/firestore", () => ({
    collection: (_, ...parts) => parts.join("/"),
    doc: (_, ...parts) => parts.join("/"),
    getDoc: jest.fn(),
    getDocs: jest.fn(),
    updateDoc: jest.fn(),
    Timestamp: { now: () => "saved-timestamp", fromDate: (date) => date },
}));
jest.mock("../../../utils/itemPhotos", () => ({ getItemPhotoUrl: () => "" }));
jest.mock("../../../utils/shoppingPurchaseSync", () => ({
    ...jest.requireActual("../../../utils/shoppingListStatus"),
    syncLinkedShoppingPurchase: jest.fn(),
}));
jest.mock("../../../utils/sales/shoppingItemInvoiceAutomation", () => ({
    createAndSendShoppingItemInstallInvoice: jest.fn(),
    updateLinkedPartApprovalForManualShoppingInvoice: jest.fn(),
}));
jest.mock("../../../utils/shoppingListDelete", () => ({
    getShoppingItemPartApprovalId: (item) => item.partApprovalRequestId || "",
    isShoppingItemFromPartApproval: () => false,
    deleteShoppingListItemWithLinks: jest.fn(),
}));
jest.mock("../../../utils/appDialog", () => ({ appConfirm: jest.fn() }));
jest.mock("../../components/share/ShareItemButton", () => () => null);

let mockItem;
let mockSourceCollection;

beforeEach(() => {
    jest.clearAllMocks();
    mockSourceCollection = "shoppingList";
    mockItem = {
        name: "Replacement pump",
        description: "Keep this description",
        category: "Customer",
        subCategory: "Custom",
        quantity: "2",
        status: "Need to Purchase",
        autoInvoiceOnInstall: false,
    };
    getDocs.mockResolvedValue({ docs: [] });
    getDoc.mockImplementation(async (path) => ({
        id: "shopping-item",
        exists: () => path === `companies/company/${mockSourceCollection}/shopping-item`,
        data: () => ({ ...mockItem }),
    }));
    updateDoc.mockImplementation(async (_, payload) => { mockItem = { ...mockItem, ...payload }; });
    syncLinkedShoppingPurchase.mockResolvedValue({ shoppingPayload: {} });
    updateLinkedPartApprovalForManualShoppingInvoice.mockResolvedValue(undefined);
    createAndSendShoppingItemInstallInvoice.mockResolvedValue({
        status: "sent",
        shoppingPayload: { status: "Invoiced", invoiced: true, invoiceStatus: "Invoiced" },
    });
});

const openDetail = async () => {
    render(
        <MemoryRouter initialEntries={["/company/shopping-list/detail/shopping-item"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Context.Provider value={{ recentlySelectedCompany: "company", user: { uid: "owner" } }}>
                <Routes>
                    <Route path="/company/shopping-list/detail/:shoppingItemId" element={<ShoppingListDetailView />} />
                </Routes>
            </Context.Provider>
        </MemoryRouter>
    );
    const panel = screen.getByRole("region", { name: "Quick Status" });
    await waitFor(() => expect(within(panel).getByLabelText("Status")).toHaveValue(mockItem.status));
    return within(panel);
};

test("updates status from the sidebar without opening the full editor or rewriting item details", async () => {
    const panel = await openDetail();
    expect(panel.getByRole("button", { name: "Update Status" })).toBeDisabled();
    expect(panel.getAllByRole("option").map((option) => option.value)).toEqual([
        "", "Need to Purchase", "Purchased", "Installed", "Invoiced",
    ]);
    fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Purchased" } });
    fireEvent.click(panel.getByRole("button", { name: "Update Status" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Status updated."));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith("companies/company/shoppingList/shopping-item", {
        status: "Purchased", invoiced: false, invoiceStatus: "", manualInvoiceNote: "",
        autoInvoiceOnInstall: false, needsAction: true, updatedAt: "saved-timestamp",
    });
    expect(screen.getByText("Keep this description")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Update Status" })).toBeDisabled();
    expect(screen.getAllByText("Purchased").length).toBeGreaterThan(1);
    expect(createAndSendShoppingItemInstallInvoice).not.toHaveBeenCalled();
});

test("blocks duplicate saves and full editing while a status update is pending", async () => {
    let completeUpdate;
    updateDoc.mockImplementation(() => new Promise((resolve) => { completeUpdate = resolve; }));
    const panel = await openDetail();
    fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Installed" } });
    fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
    expect(panel.getByLabelText("Status")).toBeDisabled();
    expect(panel.getByRole("button", { name: "Updating..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.submit(panel.getByRole("button", { name: "Updating..." }).closest("form"));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    await act(async () => { completeUpdate(); });
    expect(panel.getByLabelText("Status")).toBeEnabled();
});

test("keeps the saved status and allows retrying when the write fails", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    updateDoc.mockRejectedValueOnce(new Error("Permission denied"));
    try {
        const panel = await openDetail();
        fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Purchased" } });
        fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not update status. Please try again."));
        expect(mockItem.status).toBe("Need to Purchase");
        expect(panel.getByRole("button", { name: "Update Status" })).toBeEnabled();
        expect(toast.success).not.toHaveBeenCalled();
        fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Status updated."));
    } finally {
        log.mockRestore();
    }
});

test("updates legacy shoppingListItems records in their original collection", async () => {
    mockSourceCollection = "shoppingListItems";
    const panel = await openDetail();
    fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Purchased" } });
    fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
    await waitFor(() => expect(updateDoc).toHaveBeenCalledWith(
        "companies/company/shoppingListItems/shopping-item", expect.objectContaining({ status: "Purchased" })
    ));
});

test("synchronizes an existing purchase connection when the status changes", async () => {
    mockItem.purchasedItem = "purchase";
    const panel = await openDetail();
    fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Installed" } });
    fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
    await waitFor(() => expect(syncLinkedShoppingPurchase).toHaveBeenCalledWith(expect.objectContaining({
        companyId: "company", shoppingItemId: "shopping-item", purchasedItemId: "purchase",
        shoppingCollectionName: "shoppingList", invoiced: false,
        shoppingItemData: expect.objectContaining({ status: "Installed", needsAction: false }),
    })));
});

test("reflects an invoiced linked job without marking it manually invoiced or sending another invoice", async () => {
    Object.assign(mockItem, { purchasedItem: "purchase", autoInvoiceOnInstall: true });
    syncLinkedShoppingPurchase.mockResolvedValueOnce({
        shoppingPayload: { status: "Invoiced", invoiced: true, invoiceStatus: "Invoiced" },
    });
    const panel = await openDetail();
    fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Installed" } });
    fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
    await waitFor(() => expect(panel.getByLabelText("Status")).toHaveValue("Invoiced"));
    expect(updateLinkedPartApprovalForManualShoppingInvoice).not.toHaveBeenCalled();
    expect(createAndSendShoppingItemInstallInvoice).not.toHaveBeenCalled();
});

test.each([
    ["Installed", "Invoiced", true, false],
    ["Invoiced", "Purchased", false, true],
])("changing %s to %s keeps invoice flags and approval updates consistent", async (previousStatus, nextStatus, invoiced, needsAction) => {
    Object.assign(mockItem, { status: previousStatus, invoiced: previousStatus === "Invoiced", manualInvoiceNote: "Office invoice" });
    const panel = await openDetail();
    fireEvent.change(panel.getByLabelText("Status"), { target: { value: nextStatus } });
    fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(updateDoc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        status: nextStatus, invoiced, needsAction,
        invoiceStatus: invoiced ? "Invoiced" : "", manualInvoiceNote: invoiced ? "Office invoice" : "",
    }));
    if (invoiced) {
        expect(updateLinkedPartApprovalForManualShoppingInvoice).toHaveBeenCalledWith(expect.objectContaining({
            shoppingItem: expect.objectContaining({ status: "Invoiced" }), note: "Office invoice",
        }));
    } else {
        expect(updateLinkedPartApprovalForManualShoppingInvoice).not.toHaveBeenCalled();
    }
});

test("honors auto invoicing on installation and displays the resulting invoice status", async () => {
    Object.assign(mockItem, { autoInvoiceOnInstall: true, plannedTotalPriceCents: 15000 });
    const panel = await openDetail();
    fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Installed" } });
    expect(panel.getByText(/Marking this item installed will create and send its invoice/)).toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
    await waitFor(() => expect(panel.getByLabelText("Status")).toHaveValue("Invoiced"));
    expect(createAndSendShoppingItemInstallInvoice).toHaveBeenCalledWith(expect.objectContaining({
        companyId: "company", shoppingCollectionName: "shoppingList",
        shoppingItem: expect.objectContaining({ status: "Installed", plannedTotalPriceCents: 15000 }),
    }));
    expect(toast.success).toHaveBeenCalledWith("Status updated. Invoice created and sent.");
});

test("refreshes the saved status and reports a partial failure when a linked update fails", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    mockItem.purchasedItem = "purchase";
    syncLinkedShoppingPurchase.mockRejectedValueOnce(new Error("Connection failed"));
    try {
        const panel = await openDetail();
        fireEvent.change(panel.getByLabelText("Status"), { target: { value: "Installed" } });
        fireEvent.click(panel.getByRole("button", { name: "Update Status" }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Status saved, but a linked update could not be completed")));
        expect(panel.getByLabelText("Status")).toHaveValue("Installed");
        expect(toast.success).not.toHaveBeenCalled();
        expect(getDoc).toHaveBeenCalledTimes(2);
    } finally {
        log.mockRestore();
    }
});
