import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";

const millis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : 0);
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function CatalogPurchaseHistory({ vendorItemId, mergedSourceIds }) {
  const { recentlySelectedCompany: companyId } = useContext(Context);
  const { can } = useCompanyPermissions();
  const allowed = can("100");
  const [state, setState] = useState({ loading: true, items: [], error: "" });
  useEffect(() => {
    let active = true;
    setState({ loading: true, items: [], error: "" });
    if (!allowed || !companyId || !vendorItemId) return () => { active = false; };
    const items = collection(db, "companies", companyId, "purchasedItems");
    const ids = [...new Set([vendorItemId, ...(mergedSourceIds || [])])];
    const lookups = [];
    for (let offset = 0; offset < ids.length; offset += 30) {
      const group = ids.slice(offset, offset + 30);
      lookups.push(getDocs(query(items, group.length === 1 ? where("itemId", "==", group[0]) : where("itemId", "in", group))));
    }
    Promise.all(lookups)
      .then((snapshots) => {
        if (active) setState({ loading: false, error: "", items: snapshots.flatMap(snapshot => snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }))).sort((a, b) => millis(b.date) - millis(a.date)) });
      }).catch((error) => { if (active) setState({ loading: false, items: [], error: userFacingErrorMessage(error, "Could not load purchase history.") }); });
    return () => { active = false; };
  }, [companyId, vendorItemId, mergedSourceIds, allowed]);
  if (!allowed) return null;
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold text-slate-950">Purchases and Receipts</h2>
    <p className="mt-1 text-sm text-slate-500">Showing the latest 25 purchases for this vendor item{mergedSourceIds?.length ? " and its merged duplicates" : ""}. Actual purchase costs stay with their original receipts.</p>
    {state.loading ? <p className="mt-4">Loading purchase history...</p> : state.error ? <p role="alert" className="mt-4">{state.error}</p> : !state.items.length ? <p className="mt-4 text-sm text-slate-500">No recorded purchases for this vendor item.</p> : <ul className="mt-4 divide-y divide-slate-200">{state.items.slice(0, 25).map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><Link className="font-semibold text-blue-700 hover:underline" to={`/company/purchased-items/detail/${item.id}`}>{item.name || "Purchased item"}</Link><p className="text-sm text-slate-500">Unit cost {money(Number(item.price || 0))} · Quantity {item.quantityString || "0"}{item.returned ? " · Returned" : ""}</p></div>
      {item.receiptId && <Link className="font-semibold text-blue-700 hover:underline" to={`/company/receipts/detail/${item.receiptId}`}>Receipt {item.invoiceNum || "details"}</Link>}
    </li>)}</ul>}
  </section>;
}
