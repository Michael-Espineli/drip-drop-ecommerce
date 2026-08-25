import {
  buildCustomerActiveById,
  equipmentNeedsMaintenance,
  equipmentNeedsMaintenanceForActiveBoard,
  toEquipmentDateMillis,
} from "./equipmentMaintenance";
import { Equipment } from "./models/Equipment";

describe("equipment maintenance helpers", () => {
  const now = new Date("2026-08-19T12:00:00");

  it("counts maintenance statuses and due service dates", () => {
    expect(equipmentNeedsMaintenance({ status: "Needs Maintenance" }, now)).toBe(true);
    expect(equipmentNeedsMaintenance({
      status: "Operational",
      needsService: true,
      nextServiceDate: new Date("2026-08-19T08:00:00"),
    }, now)).toBe(true);
    expect(equipmentNeedsMaintenance({
      status: "Operational",
      needsService: true,
      nextServiceDate: new Date("2026-08-20T08:00:00"),
    }, now)).toBe(false);
  });

  it("parses numeric service dates consistently", () => {
    expect(toEquipmentDateMillis(1787184000)).toBe(new Date("2026-08-20T00:00:00Z").getTime());
    expect(toEquipmentDateMillis(1787184000000)).toBe(new Date("2026-08-20T00:00:00Z").getTime());
  });

  it("does not count non-operational equipment as maintenance due", () => {
    expect(equipmentNeedsMaintenance({
      status: "Non-Operational",
      needsService: true,
      nextServiceDate: new Date("2026-08-18T08:00:00"),
    }, now)).toBe(false);
  });

  it("matches the active equipment board count rules", () => {
    const customerActiveById = buildCustomerActiveById([
      { id: "active-customer", active: true },
      { id: "inactive-customer", active: false },
    ]);

    expect(equipmentNeedsMaintenanceForActiveBoard({
      id: "equipment-1",
      isActive: true,
      customerId: "active-customer",
      status: "Needs Maintenance",
    }, customerActiveById, now)).toBe(true);

    expect(equipmentNeedsMaintenanceForActiveBoard({
      id: "equipment-2",
      isActive: true,
      customerId: "inactive-customer",
      status: "Needs Maintenance",
    }, customerActiveById, now)).toBe(false);

    expect(equipmentNeedsMaintenanceForActiveBoard({
      id: "equipment-3",
      isActive: false,
      customerId: "active-customer",
      status: "Needs Maintenance",
    }, customerActiveById, now)).toBe(false);
  });

  it("keeps legacy equipment maintenance status fields visible to the list model", () => {
    const operationStatusEquipment = Equipment.fromFirestore({
      id: "operation-status-equipment",
      data: () => ({
        isActive: true,
        operationStatus: "Needs Maintenance",
      }),
    });

    const equipmentStatusEquipment = Equipment.fromFirestore({
      id: "equipment-status-equipment",
      data: () => ({
        isActive: true,
        equipmentStatus: "Needs Maintenance",
      }),
    });

    expect(equipmentNeedsMaintenanceForActiveBoard(operationStatusEquipment, {}, now)).toBe(true);
    expect(equipmentNeedsMaintenanceForActiveBoard(equipmentStatusEquipment, {}, now)).toBe(true);
  });
});
