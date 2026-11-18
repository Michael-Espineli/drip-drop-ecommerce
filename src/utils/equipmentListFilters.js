import { getCompanyUserDisplayName } from "./companyUsers";
import { customerHasAnyTag } from "./customerTags";

const text = (value) => typeof value === "string" ? value.trim() : "";
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
const nameKey = (value) => text(value).toLowerCase();

export const recurringStopTechnicianIds = (stop = {}) => unique([
  ...(stop.technicianIds || []),
  stop.techId, stop.technicianId, stop.workerId, stop.companyUserId,
  stop.userId, stop.assignedTechId, stop.assignedToUserId,
]);

const technicianNames = (record = {}) => unique([
  record.tech, record.techName, record.technicianName, record.workerName,
  record.assignedTechName, record.assignedToUserName, record.companyUserName,
  record.userName, record.displayName, record.name,
  [record.firstName, record.lastName].filter(Boolean).join(" "),
]).map(nameKey);

export const recurringStopMatchesTechnician = (stop, technician) => {
  if (!technician) return true;
  const ids = recurringStopTechnicianIds(stop);
  // A saved assignment takes precedence over an outdated display name.
  if (ids.length) return ids.some((id) => technician.technicianIds.includes(id));
  return technicianNames(stop).some((name) => technician.names.includes(name));
};

export const equipmentRssTechnicianOptions = (stopsByEquipmentId = {}, companyUsers = []) => {
  const users = companyUsers.map((user) => {
    const ids = unique([user.userId, user.id, user.docId, user.uid, user.companyUserId]);
    return {
      value: `user:${ids[0]}`,
      label: getCompanyUserDisplayName(user),
      technicianIds: ids,
      names: technicianNames(user),
    };
  });
  const options = new Map();
  Object.values(stopsByEquipmentId).flat().forEach((stop) => {
    const ids = recurringStopTechnicianIds(stop);
    const names = technicianNames(stop);
    if (!ids.length && !names.length) return;
    const matches = users.filter((user) => ids.length
      ? ids.some((id) => user.technicianIds.includes(id))
      : names.some((name) => user.names.includes(name)));
    const user = matches.length === 1 ? matches[0] : null;
    const value = user?.value || (ids.length ? `rss:${ids[0]}` : `name:${names[0]}`);
    const current = options.get(value);
    options.set(value, {
      value,
      label: user?.label || stop.tech || stop.techName || stop.technicianName || stop.workerName || "Unnamed RSS technician",
      technicianIds: unique([...(current?.technicianIds || []), ...(user?.technicianIds || []), ...ids]),
      names: [...new Set([...(current?.names || []), ...(user?.names || []), ...names])],
    });
  });
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
};

export const equipmentMatchesRelatedFilters = (equipment, {
  rssTechnicianFilter = null,
  customerTagFilter = [],
  customersById = {},
  recurringStopsByEquipmentId = {},
} = {}) => {
  if (rssTechnicianFilter && !(recurringStopsByEquipmentId[equipment?.id] || [])
    .some((stop) => recurringStopMatchesTechnician(stop, rssTechnicianFilter))) return false;
  return customerHasAnyTag(customersById[equipment?.customerId], customerTagFilter);
};
