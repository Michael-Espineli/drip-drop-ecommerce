import { httpsCallable } from 'firebase/functions';
import { v4 as uuidv4 } from 'uuid';
import { functions } from '../config';
import { getCallableAuthPayload } from '../callableAuth';

export const manageSalesInvoice = async (payload) => {
  const result = await httpsCallable(functions, 'manageSalesInvoice')({
    ...(await getCallableAuthPayload()),
    ...payload,
  });
  return result.data;
};

export const localReceivedDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const draftKey = ({ companyId, invoiceId, userId }) => `sales-receipt:${userId}:${companyId}:${invoiceId}`;
const memoryDrafts = new Map();
const memoryActionIds = new Map();

export function newManualPaymentForm(scope, amount) {
  const key = draftKey(scope);
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved?.requestId && typeof saved.amount === 'string' && typeof saved.receivedDate === 'string') return saved;
  } catch (_) { /* A receipt can still be entered when session storage is unavailable. */ }
  if (memoryDrafts.has(key)) return memoryDrafts.get(key);
  return { requestId: uuidv4(), amount, method: 'cash', receivedDate: localReceivedDate(), referenceNumber: '', memo: '' };
}

export function persistManualPaymentDraft(scope, form) {
  memoryDrafts.set(draftKey(scope), form);
  try { sessionStorage.setItem(draftKey(scope), JSON.stringify(form)); } catch (_) { /* Keep the in-memory retry ID. */ }
}

export function clearManualPaymentDraft(scope) {
  memoryDrafts.delete(draftKey(scope));
  try { sessionStorage.removeItem(draftKey(scope)); } catch (_) { /* The completed command remains idempotent server-side. */ }
}

export const manualPaymentDateMillis = value => new Date(`${value}T12:00:00`).getTime();

export function invoiceActionRequestId(scope, action) {
  const key = `${draftKey(scope)}:${action}`;
  if (memoryActionIds.has(key)) return memoryActionIds.get(key);
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) { memoryActionIds.set(key, saved); return saved; }
    const id = uuidv4(); memoryActionIds.set(key, id); sessionStorage.setItem(key, id); return id;
  } catch (_) {
    if (!memoryActionIds.has(key)) memoryActionIds.set(key, uuidv4());
    return memoryActionIds.get(key);
  }
}

export function clearInvoiceActionRequest(scope, action) {
  memoryActionIds.delete(`${draftKey(scope)}:${action}`);
  try { sessionStorage.removeItem(`${draftKey(scope)}:${action}`); } catch (_) { /* Idempotency is also enforced by the server. */ }
}
