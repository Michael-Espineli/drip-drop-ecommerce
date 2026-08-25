import {
  canReactivateEquipmentWithCustomer,
  EQUIPMENT_STATUS,
  isFinalInactiveEquipmentStatus,
} from "./Equipment";

describe("equipment final inactive statuses", () => {
  it("treats uninstalled and legacy replaced statuses as final inactive", () => {
    expect(isFinalInactiveEquipmentStatus(EQUIPMENT_STATUS.UNINSTALLED)).toBe(true);
    expect(isFinalInactiveEquipmentStatus(EQUIPMENT_STATUS.REPLACED)).toBe(true);
    expect(isFinalInactiveEquipmentStatus(EQUIPMENT_STATUS.OPERATIONAL)).toBe(false);
  });

  it("keeps uninstalled or replaced equipment inactive during customer reactivation", () => {
    expect(canReactivateEquipmentWithCustomer({ status: EQUIPMENT_STATUS.OPERATIONAL })).toBe(true);
    expect(canReactivateEquipmentWithCustomer({ status: EQUIPMENT_STATUS.UNINSTALLED })).toBe(false);
    expect(canReactivateEquipmentWithCustomer({ status: EQUIPMENT_STATUS.REPLACED })).toBe(false);
    expect(canReactivateEquipmentWithCustomer({ dateUninstalled: new Date() })).toBe(false);
    expect(canReactivateEquipmentWithCustomer({ replacedByEquipmentId: "com_equ_replacement" })).toBe(false);
  });
});
