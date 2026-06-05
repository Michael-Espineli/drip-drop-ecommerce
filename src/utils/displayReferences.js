export const isOpaqueId = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/\s/.test(text)) return false;
  if (/^[A-Z]{1,5}\d{1,8}$/i.test(text)) return false;
  if (/^(inv|invoice|receipt|job|ss|rss|rr|po|wo)[-_]?\d+/i.test(text)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
  return text.length >= 16 && /^[A-Za-z0-9_-]+$/.test(text);
};

export const displayReferenceValue = (value, fallbackLabel = "Record") => {
  const text = String(value || "").trim();
  if (!text) return "—";
  return isOpaqueId(text) ? fallbackLabel : text;
};

export const displayRecordReference = (record = {}, fallbackLabel = "Record") => {
  const candidates = [
    record.internalId,
    record.invoiceNumber,
    record.invoiceNum,
    record.referenceNumber,
    record.batchReference,
    record.title,
    record.name,
    record.displayName,
    record.customerName,
    record.serviceLocationName,
    record.description,
    record.id,
  ];

  const value = candidates.find((candidate) => String(candidate || "").trim());
  return displayReferenceValue(value, fallbackLabel);
};

export const linkedReferenceText = (entityLabel, value, displayValue = "") => {
  const readable = String(displayValue || "").trim();
  if (readable && readable !== "—") return displayReferenceValue(readable, entityLabel);
  return displayReferenceValue(value, `Open ${entityLabel}`);
};
