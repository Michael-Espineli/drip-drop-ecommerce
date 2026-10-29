import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { getWorkOfferIncentiveText, getWorkOfferTargetText, hasAcceptedWorkOffer, isFinalWorkOffer, isWorkOfferRecord } from "../../../utils/workOffers";
import WorkOfferManagementDialog from "../offeredWork/WorkOfferManagementDialog";

export default function JobWorkOffers({ companyId, offers, workers, tasks, onChanged }) {
  const { can } = useCompanyPermissions();
  const { user, dataBaseUser, companyUserAccess } = useContext(Context);
  const userIds = [user?.uid, dataBaseUser?.id, companyUserAccess?.userId].filter(Boolean);
  const [selected, setSelected] = useState(null);
  useEffect(() => { setSelected(null); }, [companyId]);
  const rows = offers.filter(isWorkOfferRecord);
  const open = (offer, tab = "details") => setSelected({ offer, tab });
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-900">Job work offers</h4><Link to="/company/offered-work" className="text-sm font-semibold text-blue-700 hover:underline">Offered work management</Link></div>
    {!rows.length && <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">No work offers for this job yet. Create an offer to send planned tasks to a technician or a work board.</p>}
    {[["Active work offers", rows.filter(offer => !isFinalWorkOffer(offer))], ["Previous work offers", rows.filter(isFinalWorkOffer)]].filter(([, entries]) => entries.length).map(([label, entries]) => <section key={label} aria-label={label} className="space-y-3">
      <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">{label} · {entries.length}</h5>
      {entries.map(offer => {
        const editable = can("324") || (can("322") && userIds.includes(offer.createdByUserId));
        const accepted = hasAcceptedWorkOffer(offer);
        return <article aria-label={`Work offer: ${offer.title || "Offered Work"}`} key={offer.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><button type="button" onClick={() => open(offer)} className="text-left font-bold text-blue-700 hover:underline">{offer.title || "Offered Work"}</button><p className="mt-1 text-sm text-slate-600">{getWorkOfferTargetText(offer)} · {offer.offerType || "Direct User"}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{offer.status || "Draft"}</span></div>
          {offer.description && <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{offer.description}</p>}
          <p className="mt-2 text-xs text-slate-500">{offer.jobTaskIds?.length || offer.scopeSnapshot?.tasks?.length || 0} tasks · {offer.estimatedMinutes || 0} minutes · {getWorkOfferIncentiveText(offer)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => open(offer)}>Open offer</button>
            {editable && <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold" onClick={() => open(offer, "edit")}>Edit offer</button>}
            {can("328") && <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold" onClick={() => open(offer, "incentive")}>Incentive</button>}
            {editable && <button type="button" disabled={accepted} title={accepted ? "Accepted work and agreed pay must be preserved" : "Delete this work offer"} className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50" onClick={() => open(offer, "delete")}>Delete offer</button>}
          </div>
        </article>;
      })}
    </section>)}
    {selected && <WorkOfferManagementDialog key={`${companyId}:${selected.offer.id}:${selected.tab}`} companyId={companyId} offer={selected.offer} initialTab={selected.tab} workers={workers} tasks={tasks} onClose={() => setSelected(null)} onChanged={onChanged} />}
  </div>;
}
