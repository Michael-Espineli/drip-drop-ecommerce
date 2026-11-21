import { httpsCallable } from "firebase/functions";
import { appPrompt } from "../appDialog";
import { functions } from "../config";

export async function recordPartOfflineBilling({ companyId, approvalId, shoppingItemId, action }) {
  const cash = action === "cashReceived";
  const title = cash ? "Cash received" : "Invoiced externally";
  const value = await appPrompt({
    title,
    message: cash ? "Enter the cash amount received in dollars." : "Enter the external invoice reference.",
    confirmLabel: "Record",
  });
  if (value === null) return null;
  const reference = String(value).trim();
  const amountCents = /^\d+(\.\d{1,2})?$/.test(reference) ? Math.round(Number(reference) * 100) : 0;
  const result = await httpsCallable(functions, "recordPartOfflineBilling")({
    companyId, ...(approvalId ? { approvalId } : { shoppingItemId }), action,
    ...(cash ? { amountCents } : { reference }),
  });
  return result.data;
}
