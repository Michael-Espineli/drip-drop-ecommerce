import { displayReferenceValue, isOpaqueId } from '../displayReferences';

// Keep source IDs for grouping, exports and links; omit their UI-only columns.
export const visibleReportColumns = (columns = []) => columns.filter((column) => (
  !/(?:^id$|Id$|Ids$|ID$|IDs$)/.test(column.key || '')
));

export const reportDisplayValue = (value, fallback = 'Record') => {
  if (typeof value !== 'string') return value;
  // Diagnostic sentences can contain record IDs as well as a whole-cell ID.
  const readable = value.replace(/[A-Za-z0-9_-]{16,}/g, (token) => (
    /\d/.test(token) && isOpaqueId(token) ? fallback : token
  ));
  return displayReferenceValue(readable, fallback);
};
