export function readClientDraft(key) {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || '{}');
  } catch (_) {
    return {};
  }
}
export function saveClientDraft(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_) {/* The form remains usable when storage is unavailable. */}
}
export function clearClientDraft(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch (_) {/* No persistent draft to remove. */}
}
