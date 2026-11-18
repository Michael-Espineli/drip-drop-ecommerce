import { runTransaction } from "firebase/firestore";
import { productAvailabilityPatch, updateProductAvailability, PRODUCT_BULK_EDIT_LIMIT } from "./productAvailability";

jest.mock("firebase/firestore", () => ({ runTransaction: jest.fn(), doc: (_, ...parts) => parts.join("/"), collection: jest.fn() }));
let records, writes;
beforeEach(() => {
  records = new Map([['a', { name: 'Seal', sellPrice: 4500, rate: 1750, vendorItemIds: ['vendor'], availableForJobs: true }], ['b', { name: 'Union', sellPrice: 2000, availableForJobs: true }]]);
  writes = [];
  runTransaction.mockImplementation(async (_, callback) => callback({
    get: async (path) => { if (writes.length) throw new Error('Read after write'); const id = path.split('/').pop(); return { exists: () => records.has(id), data: () => records.get(id) }; },
    update: (path, patch) => writes.push({ path, patch }),
  }));
});

test("bulk availability preserves keep-current fields, pricing and vendor references", async () => {
  const patch = await updateProductAvailability({ db: {}, companyId: 'company', productIds: ['a', 'b'], changes: { jobs: 'no', approvals: 'yes', active: 'keep' } });
  expect(patch).toEqual({ availableForJobs: false, availableForJob: false, jobProductAvailable: false, availableForPartApproval: true, partApprovalAvailable: true, availableForCustomerSale: true });
  expect(writes).toHaveLength(2);
  expect(writes.every(({ path }) => path.startsWith('companies/company/settings/genericItems/genericItems/'))).toBe(true);
  for (const { patch: saved } of writes) {
    expect(saved.sellPrice).toBeUndefined(); expect(saved.rate).toBeUndefined(); expect(saved.vendorItemIds).toBeUndefined(); expect(saved.active).toBeUndefined(); expect(saved.availableForPartPurchase).toBeUndefined();
  }
});

test.each([{ missing: true }, { mergedIntoProductId: 'other' }, { archived: true }])("a removed or retired product aborts the whole update before writing: %p", async (flags) => {
  if (flags.missing) records.delete('b'); else records.set('b', flags);
  await expect(updateProductAvailability({ db: {}, companyId: 'company', productIds: ['a', 'b'], changes: { active: 'yes' } })).rejects.toThrow('removed or consolidated');
  expect(writes).toEqual([]);
});

test("invalid fields, unchanged forms and excessive selection are rejected before any transaction", async () => {
  runTransaction.mockClear();
  expect(() => productAvailabilityPatch({ sellPrice: 'yes' })).toThrow('Unsupported');
  expect(() => productAvailabilityPatch({ jobs: 'keep' })).toThrow('at least one');
  expect(() => productAvailabilityPatch({ jobs: 'invalid' })).toThrow('availability option');
  await expect(updateProductAvailability({ db: {}, companyId: 'company', productIds: Array.from({ length: PRODUCT_BULK_EDIT_LIMIT + 1 }, (_, index) => `p${index}`), changes: { jobs: 'no' } })).rejects.toThrow('at a time');
  expect(runTransaction).not.toHaveBeenCalled();
});

test("repeated selected IDs are updated once and a failed commit is surfaced", async () => {
  await updateProductAvailability({ db: {}, companyId: 'company', productIds: ['a', 'a'], changes: { purchasing: 'no' } });
  expect(writes).toHaveLength(1);
  runTransaction.mockRejectedValueOnce(new Error('Permission denied'));
  await expect(updateProductAvailability({ db: {}, companyId: 'company', productIds: ['a'], changes: { jobs: 'no' } })).rejects.toThrow('Permission denied');
});
