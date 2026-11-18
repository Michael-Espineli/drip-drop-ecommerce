import { equipmentMatchesRelatedFilters, equipmentRssTechnicianOptions, recurringStopMatchesTechnician } from "./equipmentListFilters";

const users = [
  { id: "alex-company", userId: "alex-auth", userName: "Alex Tech" },
  { id: "blair-company", userId: "blair-auth", userName: "Blair Tech" },
];

test("RSS filters resolve company-user and auth IDs to one technician, including legacy name-only assignments", () => {
  const stops = { filter: [
    { techId: "alex-auth", tech: "Old Alex Name" },
    { companyUserId: "alex-company", tech: "Alex Tech" },
    { tech: " alex tech " },
    { technicianId: "former-worker", tech: "Former Technician" },
  ] };
  const options = equipmentRssTechnicianOptions(stops, users);
  expect(options.map((option) => option.label)).toEqual(["Alex Tech", "Former Technician"]);
  expect(stops.filter.map((stop) => recurringStopMatchesTechnician(stop, options[0]))).toEqual([true, true, true, false]);
  expect(recurringStopMatchesTechnician({ techId: "blair-auth", tech: "Alex Tech" }, options[0])).toBe(false);
});

test("equipment matches any linked RSS for the technician, intersected with any normalized customer tag", () => {
  const recurringStopsByEquipmentId = {
    filter: [{ techId: "alex-auth", tech: "Alex Tech" }, { techId: "blair-company", tech: "Blair Tech" }],
    pump: [{ techId: "alex-auth", tech: "Alex Tech" }],
  };
  const rssTechnicianFilter = equipmentRssTechnicianOptions(recurringStopsByEquipmentId, users)[1];
  const context = { rssTechnicianFilter, customerTagFilter: ["r3", "Commercial"], recurringStopsByEquipmentId,
    customersById: { customer: { tags: " R3, VIP, r3 " }, other: { tags: ["R1"] } } };
  expect(equipmentMatchesRelatedFilters({ id: "filter", customerId: "customer" }, context)).toBe(true);
  expect(equipmentMatchesRelatedFilters({ id: "pump", customerId: "customer" }, context)).toBe(false);
  expect(equipmentMatchesRelatedFilters({ id: "filter", customerId: "other" }, context)).toBe(false);
  expect(equipmentMatchesRelatedFilters({ id: "filter", customerId: "missing" }, context)).toBe(false);
  expect(equipmentMatchesRelatedFilters({ id: "unassigned", customerId: "customer" }, context)).toBe(false);
  expect(equipmentMatchesRelatedFilters({ id: "unassigned", customerId: "missing" })).toBe(true);
});

test("different technician IDs retain separate options even when display names match", () => {
  const sameNameUsers = users.map((user) => ({ ...user, userName: "Same Name" }));
  const stops = { equipment: [{ techId: "alex-auth", tech: "Same Name" }, { techId: "blair-auth", tech: "Same Name" }] };
  const options = equipmentRssTechnicianOptions(stops, sameNameUsers);
  expect(options).toHaveLength(2);
  expect(recurringStopMatchesTechnician(stops.equipment[0], options[0])).toBe(true);
  expect(recurringStopMatchesTechnician(stops.equipment[1], options[0])).toBe(false);
});
