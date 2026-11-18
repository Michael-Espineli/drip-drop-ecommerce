import { writeBatch } from "firebase/firestore";
import { createReceiptBatch } from "./receiptBatch";
jest.mock("firebase/firestore", () => ({ writeBatch: jest.fn() }));

test("receipt and purchase writes are staged and committed together", async () => {
  const batch = { set: jest.fn(), update: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
  const receipt = createReceiptBatch({});
  receipt.set("purchase", { price: 1234, receiptId: "receipt" });
  receipt.set("receipt", { purchasedItemIds: ["purchase"] });
  expect(batch.commit).not.toHaveBeenCalled();
  await receipt.commit();
  expect(batch.commit).toHaveBeenCalledTimes(1);
});

test("an oversized import fails before committing partial catalog or receipt records", () => {
  const batch = { set: jest.fn(), commit: jest.fn() };
  writeBatch.mockReturnValue(batch);
  const receipt = createReceiptBatch({});
  for (let index = 0; index < 500; index += 1) receipt.set(`item-${index}`, {});
  expect(() => receipt.set("receipt", {})).toThrow("save limit");
  expect(batch.commit).not.toHaveBeenCalled();
});

test("a failed database commit is surfaced to the receipt screen", async () => {
  writeBatch.mockReturnValue({ set: jest.fn(), commit: jest.fn().mockRejectedValue(new Error("Offline")) });
  const receipt = createReceiptBatch({});
  receipt.set("purchase", {});
  await expect(receipt.commit()).rejects.toThrow("Offline");
});
