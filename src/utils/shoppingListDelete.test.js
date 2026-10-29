import { getDoc } from "firebase/firestore";
import { deleteShoppingListItemWithLinks } from "./shoppingListDelete";

let mockWrites;
jest.mock("./shoppingPurchaseSync", () => ({ syncLinkedShoppingPurchase: jest.fn() }));
jest.mock("firebase/firestore", () => ({
  doc: (_, ...parts) => parts.join("/"), collection: jest.fn(), getDoc: jest.fn(),
  serverTimestamp: () => "now", arrayRemove: (...ids) => ({ remove: ids }),
  writeBatch: () => ({ delete: (ref) => mockWrites.push({ ref, remove: true }),
    update: (ref, data) => mockWrites.push({ ref, data }), commit: async () => {} }),
}));

test("deleting a shared product clears all task links and keeps unrelated product links", async () => {
  mockWrites = [];
  getDoc.mockImplementation(async (path) => ({ exists: () => true, data: () => path.endsWith("install")
    ? { shoppingListItemId: "pump", shoppingListItemIds: ["pump", "seal"], dataBaseItemId: "db-pump", genericItemId: "sell-pump" }
    : { shoppingListItemId: "seal", shoppingListItemIds: ["seal", "pump"], dataBaseItemId: "db-seal" } }));
  const result = await deleteShoppingListItemWithLinks({ db: {}, companyId: "company", itemId: "pump",
    item: { jobId: "job", linkedTaskId: "install", linkedTaskIds: ["install", "configure"] } });
  expect(result.linkedTaskIds).toEqual(["install", "configure"]);
  expect(mockWrites).toEqual([
    { ref: "companies/company/shoppingList/pump", remove: true },
    { ref: "companies/company/workOrders/job/tasks/install", data: { shoppingListItemId: "seal", shoppingListItemIds: { remove: ["pump"] }, dataBaseItemId: "", genericItemId: "", updatedAt: "now" } },
    { ref: "companies/company/workOrders/job/tasks/configure", data: { shoppingListItemId: "seal", shoppingListItemIds: { remove: ["pump"] }, updatedAt: "now" } },
  ]);
});
