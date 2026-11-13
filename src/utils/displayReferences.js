const isReadableRecordNumber = (value) => /^#?(?:\d+(?:[-/.]\d+)*|(?:job|j|inv|invoice|rec|receipt|ss|rss|rr|po|wo|cus|c)\d+|(?:job|j|inv|invoice|rec|receipt|ss|rss|rr|po|wo|cus|c)[-_#]\d+(?:[-/.][A-Z0-9]+)*)$/i.test(String(value || '').trim());

export const isOpaqueId = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/\s/.test(text)) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) return true;
  if (/^(?:comp_|auto_|link_|acct_|cs_|sub_|cus_|price_|prod_|pi_|ch_|po_|txn_|seti_)/.test(text)) return true;
  // Keep human-assigned business numbers, including year/sequence formats.
  if (/^#?\d+(?:[-/.]\d+)*$/.test(text)) return false;
  if (/^#?[A-Z]{1,12}[-_#]?\d+(?:[-/.]\d+)*$/i.test(text)) return false;
  if (/^#?(?:job|j|inv|invoice|rec|receipt|ss|rss|rr|po|wo)[-_#]\d+(?:[-/.][A-Z0-9]+)*$/i.test(text)) return false;
  return text.length >= 16 && /^[A-Za-z0-9_-]+$/.test(text);
};

export const displayReferenceValue = (value, fallbackLabel = "Record") => {
  const text = String(value || "").trim();
  if (!text) return "—";
  return isOpaqueId(text) ? fallbackLabel : text;
};

export const displayRecordReference = (record = {}, fallbackLabel = "Record") => {
  const safeRecord = record || {};
  const candidates = [
    safeRecord.internalId,
    safeRecord.invoiceNumber,
    safeRecord.invoiceNum,
    safeRecord.referenceNumber,
    safeRecord.batchReference,
    safeRecord.title,
    safeRecord.name,
    safeRecord.displayName,
    safeRecord.customerName,
    safeRecord.serviceLocationName,
    safeRecord.description,
    isReadableRecordNumber(safeRecord.id) ? safeRecord.id : '',
  ];

  const value = candidates.find((candidate) => String(candidate || "").trim() && !isOpaqueId(candidate));
  return value ? String(value).trim() : fallbackLabel;
};

export const linkedReferenceText = (entityLabel, value, displayValue = "") => {
  const readable = String(displayValue || "").trim();
  if (readable && readable !== "—") return displayReferenceValue(readable, entityLabel);
  if (!String(value || '').trim()) return '—';
  return isReadableRecordNumber(value) && !isOpaqueId(value) ? String(value).trim() : `Open ${entityLabel}`;
};
