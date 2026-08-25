import { normalizeEquipmentStatus } from "./models/Equipment";

export const toEquipmentDateMillis = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value === "number") return value < 1000000000000 ? value * 1000 : value;

  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isNaN(millis) ? null : millis;
};

export const equipmentDateIsDueThroughToday = (value, now = new Date()) => {
  const millis = toEquipmentDateMillis(value);
  if (millis === null) return false;

  const dueThrough = new Date(now);
  dueThrough.setHours(23, 59, 59, 999);

  return millis <= dueThrough.getTime();
};

export const equipmentIsActiveRecord = (equipment = {}) => {
  const activeValue = typeof equipment.isActive === "boolean"
    ? equipment.isActive
    : equipment.active;

  return activeValue === true;
};

export const equipmentCustomerIsActive = (equipment = {}, customerActiveById = {}) => {
  if (!equipment.customerId) return true;
  return customerActiveById[equipment.customerId] !== false;
};

export const equipmentIsActiveForBoard = (equipment = {}, customerActiveById = {}) => (
  equipmentIsActiveRecord(equipment) && equipmentCustomerIsActive(equipment, customerActiveById)
);

export const equipmentMatchesActiveFilter = (
  equipment,
  activeStatusFilter = "active",
  customerActiveById = {}
) => {
  if (activeStatusFilter === "both") return true;

  const isActive = equipmentIsActiveForBoard(equipment, customerActiveById);
  if (activeStatusFilter === "inactive") return !isActive;
  return isActive;
};

export const equipmentNeedsMaintenance = (equipment = {}, now = new Date()) => {
  const status = normalizeEquipmentStatus(
    equipment.status || equipment.operationStatus || equipment.equipmentStatus
  );

  if (status === "nonoperational") return false;

  const statusSaysMaintenance =
    status === "needsmaintenance" ||
    status === "maintenance" ||
    status === "needsservice";

  return statusSaysMaintenance ||
    (equipment.needsService === true && equipmentDateIsDueThroughToday(equipment.nextServiceDate, now));
};

export const equipmentNeedsMaintenanceForActiveBoard = (
  equipment = {},
  customerActiveById = {},
  now = new Date()
) => (
  equipmentIsActiveForBoard(equipment, customerActiveById) &&
  equipmentNeedsMaintenance(equipment, now)
);

export const buildCustomerActiveById = (customers = []) => (
  customers.reduce((acc, customer = {}) => {
    const customerId = customer.id || customer.customerId;
    if (!customerId) return acc;

    acc[customerId] = (customer.active ?? customer.isActive ?? true) !== false;
    return acc;
  }, {})
);
