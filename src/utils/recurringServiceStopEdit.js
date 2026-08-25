import {
  SERVICE_STOP_TYPE_USE_CASES,
  resolveServiceStopTypeFields,
  serviceStopTypeMatchesUseCase,
} from "./serviceStopTypes/serviceStopTypeResolver";
import { getCompanyUserDisplayName } from "./companyUsers";

export const RSS_DAY_OPTIONS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
].map((day) => ({ value: day, label: day }));

export const RSS_FREQUENCY_OPTIONS = [
  "Daily",
  "Weekly",
  "Twice Weekly",
  "Three Times Weekly",
  "Bi-Weekly",
  "Monthly",
].map((frequency) => ({ value: frequency, label: frequency }));

export const toDateValue = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateInputValue = (value) => {
  const date = toDateValue(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const dateFromDateInput = (value) => {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const firstRecurringDayValue = (value) => {
  if (Array.isArray(value)) return value.find(Boolean) || "";
  return value || "";
};

export const optionForValue = (options = [], value, fallbackLabel = "") => {
  const cleanValue = String(firstRecurringDayValue(value) || "").trim();
  if (!cleanValue) return null;

  return options.find((option) => option.value === cleanValue || option.id === cleanValue) || {
    value: cleanValue,
    id: cleanValue,
    label: fallbackLabel || cleanValue,
  };
};

export const optionsWithCurrentValue = (options = [], value, fallbackLabel = "") => {
  const option = optionForValue(options, value, fallbackLabel);
  if (!option) return options;

  return options.some((candidate) => candidate.value === option.value)
    ? options
    : [option, ...options];
};

export const companyUserOptionFromDoc = (docSnap) => {
  const data = docSnap.data() || {};
  const id = data.userId || data.id || data.uid || docSnap.id;
  const label = getCompanyUserDisplayName(data, "Technician");

  return {
    ...data,
    id,
    userId: id,
    value: id,
    label,
  };
};

export const payTypeOptionFromDoc = (docSnap) => {
  const data = { id: docSnap.id, ...docSnap.data() };
  return {
    ...data,
    imageName: data.imageName || data.iconName || "",
    iconName: data.iconName || data.imageName || "",
    stopPayBucketId: data.stopPayBucketId || data.bucketId || "",
    stopPayBucketLabel: data.stopPayBucketLabel || data.bucketLabel || "",
    defaultWorkTypeIds: Array.isArray(data.defaultWorkTypeIds) && data.defaultWorkTypeIds.length
      ? data.defaultWorkTypeIds
      : [docSnap.id],
  };
};

export const recurringRoutePayTypeOptions = (companyServiceStopTypes = []) =>
  companyServiceStopTypes
    .filter((type) => type.isActive !== false && type.active !== false && type.status !== "Inactive")
    .filter((type) => serviceStopTypeMatchesUseCase(type, SERVICE_STOP_TYPE_USE_CASES.recurringRoute))
    .map((type) => ({
      ...type,
      value: type.id,
      label: type.name || "Unnamed Pay Type",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

export const selectedPayTypeOptionForStop = (stop = {}, options = []) => {
  const selectedId = stop.payTypeId || stop.typeId || "";
  const selectedOption = options.find((option) => (
    option.id === selectedId || option.value === selectedId
  ));

  if (selectedOption) return selectedOption;
  if (!selectedId && !stop.payTypeName && !stop.type) return null;

  const label = stop.payTypeName || stop.type || "Selected Pay Type";
  return {
    id: selectedId,
    value: selectedId,
    label,
    name: label,
  };
};

export const selectedTechOptionForStop = (stop = {}, options = []) => {
  const selectedId = stop.techId || "";
  const selectedOption = options.find((option) => (
    option.id === selectedId || option.value === selectedId || option.userId === selectedId
  ));

  if (selectedOption) return selectedOption;
  if (!selectedId && !stop.tech) return null;

  return {
    id: selectedId,
    value: selectedId,
    userId: selectedId,
    label: stop.tech || "Selected Technician",
  };
};

export const buildRecurringServiceStopEditForm = ({
  stop = {},
  payTypeOptions = [],
  technicianOptions = [],
} = {}) => ({
  payType: selectedPayTypeOptionForStop(stop, payTypeOptions),
  frequency: optionForValue(RSS_FREQUENCY_OPTIONS, stop.frequency, stop.frequency),
  technician: selectedTechOptionForStop(stop, technicianOptions),
  day: optionForValue(RSS_DAY_OPTIONS, stop.day || firstRecurringDayValue(stop.daysOfWeek), stop.day || firstRecurringDayValue(stop.daysOfWeek)),
  startDate: formatDateInputValue(stop.startDate),
  noEndDate: stop.noEndDate !== false,
  endDate: formatDateInputValue(stop.endDate),
});

export const buildRecurringServiceStopUpdatePayload = ({
  stop = {},
  form = {},
  companyServiceStopTypes = [],
} = {}) => {
  const frequency = form.frequency?.value || stop.frequency || "";
  const day = form.day?.value || firstRecurringDayValue(stop.day || stop.daysOfWeek);
  const startDate = dateFromDateInput(form.startDate) || toDateValue(stop.startDate) || new Date();
  const noEndDate = Boolean(form.noEndDate);
  const endDate = noEndDate ? null : dateFromDateInput(form.endDate);

  if (!frequency) throw new Error("Select a frequency.");
  if (!day) throw new Error("Select a day.");
  if (!startDate) throw new Error("Select a start date.");
  if (!form.technician?.value && !stop.techId) throw new Error("Select a technician.");
  if (!noEndDate && !endDate) throw new Error("Select an end date or turn on No End Date.");
  if (!noEndDate && endDate < startDate) throw new Error("End date must be after the start date.");

  const resolvedTypeFields = resolveServiceStopTypeFields({
    companyServiceStopTypes,
    selectedType: form.payType,
    selectedTypeId: form.payType?.value || stop.payTypeId || stop.typeId || "",
    fallbackName: stop.payTypeName || stop.type || "Recurring Service Stop",
    fallbackImage: stop.typeImage || "",
    useCase: SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
    context: "buildRecurringServiceStopUpdatePayload",
  });
  const payTypeId = form.payType?.id || form.payType?.value || resolvedTypeFields.payTypeId || resolvedTypeFields.typeId || "";
  const payTypeName = form.payType?.name || form.payType?.label || resolvedTypeFields.payTypeName || resolvedTypeFields.type || "";
  const technician = form.technician || {};
  const address = stop.address || {
    streetAddress: stop.streetAddress || "",
    city: stop.city || "",
    state: stop.state || "",
    zip: stop.zip || "",
    latitude: stop.latitude || "",
    longitude: stop.longitude || "",
  };

  return {
    id: stop.id,
    internalId: stop.internalId || "",
    type: resolvedTypeFields.type,
    typeId: resolvedTypeFields.typeId,
    typeImage: resolvedTypeFields.typeImage,
    payTypeId,
    payTypeName,
    defaultWorkTypeIds: resolvedTypeFields.defaultWorkTypeIds || [],
    category: resolvedTypeFields.category,
    serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
    customerName: stop.customerName || "",
    customerId: stop.customerId || "",
    address,
    tech: technician.label || technician.userName || stop.tech || "",
    techId: technician.value || technician.userId || technician.id || stop.techId || "",
    dateCreated: stop.dateCreated || new Date(),
    startDate: startDate.getTime(),
    endDate: endDate ? endDate.getTime() : null,
    noEndDate,
    frequency,
    day,
    daysOfWeek: day,
    description: stop.description || "",
    lastCreated: stop.lastCreated || stop.startDate || new Date(),
    serviceLocationId: stop.serviceLocationId || "",
    estimatedTime: stop.estimatedTime ?? stop.estimatedDuration ?? null,
    otherCompany: stop.otherCompany ?? false,
    laborContractId: stop.laborContractId ?? null,
    contractedCompanyId: stop.contractedCompanyId ?? null,
    mainCompanyId: stop.mainCompanyId ?? null,
    salesAgreementId: stop.salesAgreementId || "",
    salesBillingSubscriptionId: stop.salesBillingSubscriptionId || "",
  };
};
