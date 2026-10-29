import { useEffect, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "../utils/config";

const empty = { companyUsers: [], payTypes: [], rates: [], settings: {}, loading: true, error: "" };

export default function useServicePayrollData(companyId, enabled = true) {
  const [state, setState] = useState({ ...empty, companyId: "" });
  useEffect(() => {
    if (!companyId || !enabled) return undefined;
    let canceled = false;
    const pending = new Set(["companyUsers", "payTypes", "rates", "settings", "companySettings"]);
    let data = { ...empty, companyId, settings: {}, companySettings: {} };
    setState(data);
    const publish = () => {
      if (canceled) return;
      const company = data.companySettings;
      setState({ ...data, settings: { ...data.settings, ...((company.payrollEnabled === false || company.companyPayrollEnabled === false || company.payrollDisabled === true) ? { payrollEnabled: false } : {}) }, loading: pending.size > 0 });
    };
    const sources = [
      ["companyUsers", collection(db, "companies", companyId, "companyUsers")],
      ["payTypes", collection(db, "companies", companyId, "companyPayTypes")],
      ["rates", collection(db, "companies", companyId, "technicianRates")],
      ["settings", doc(db, "companies", companyId, "paySettings", "main")],
      ["companySettings", doc(db, "companies", companyId, "settings", "companyWide")],
    ];
    const subscriptions = sources.map(([key, ref]) => onSnapshot(ref, (snapshot) => {
      if (canceled) return;
      data = { ...data, [key]: snapshot.docs ? snapshot.docs.map((snap) => ({ ...snap.data(), id: snap.id })) : snapshot.exists() ? snapshot.data() : {} };
      pending.delete(key);
      publish();
    }, () => {
      if (canceled) return;
      data = { ...data, error: "Technician pay setup could not be loaded. Check payroll access or try again." };
      pending.delete(key);
      publish();
    }));
    return () => { canceled = true; subscriptions.forEach((unsubscribe) => unsubscribe()); };
  }, [companyId, enabled]);
  return enabled && state.companyId === companyId ? state : { ...empty, companyId };
}
