import React, { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { MapPinIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { formatAddressLabel } from "../../../utils/customerLocationData";
import {
  bodyOfWaterLabelFromRecord,
  equipmentLabelFromRecord,
  getRecordBodyOfWaterIds,
  getRecordEquipmentIds,
  uniqueStringList,
} from "../../../utils/jobEquipmentScope";
import { displayEquipmentStatus } from "../../../utils/models/Equipment";

const detailPath = (kind, id) => `/company/${kind}/detail/${id}`;

const selectedItems = (job, records, kind) => {
  const isEquipment = kind === "equipment";
  const ids = isEquipment ? getRecordEquipmentIds(job) : getRecordBodyOfWaterIds(job);
  const primaryId = isEquipment ? job.equipmentId || job.companyEquipmentId : job.bodyOfWaterId;
  const primaryName = isEquipment ? job.equipmentName : job.bodyOfWaterName;
  const label = isEquipment ? equipmentLabelFromRecord : bodyOfWaterLabelFromRecord;
  const byId = new Map(records.map((record) => [record.id, record]));
  if (!ids.length) {
    const names = uniqueStringList([
      primaryName,
      ...(Array.isArray(job[`${isEquipment ? "equipment" : "bodyOfWater"}Names`])
        ? job[`${isEquipment ? "equipment" : "bodyOfWater"}Names`] : []),
    ]);
    return names.map((name) => ({ name }));
  }
  return ids.map((id) => ({
    id,
    name: byId.has(id) ? label(byId.get(id))
      : (id === primaryId && primaryName) || `Selected ${isEquipment ? "equipment" : "body of water"} (details unavailable)`,
    available: byId.has(id),
  }));
};

export function JobSelectedSiteItems({ job, bodiesOfWater, equipment }) {
  const bodies = selectedItems(job, bodiesOfWater, "bodiesOfWater");
  const pieces = selectedItems(job, equipment, "equipment");
  return <>
    {[
      { kind: "bodiesOfWater", label: bodies.length > 1 ? "Bodies of water" : "Body of water", items: bodies },
      { kind: "equipment", label: "Equipment", items: pieces },
    ].map(({ kind, label, items }) => (
      <div key={kind} className="flex items-start justify-between gap-3 py-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="min-w-0 text-right text-sm font-semibold text-slate-950">
          {items.length ? <ul className="space-y-1" aria-label={`Selected ${kind === "equipment" ? "equipment" : "bodies of water"}`}>
            {items.map((item, index) => <li key={item.id || index} className="break-words">
              {item.available
                ? <Link to={detailPath(kind, item.id)} className="text-blue-700 hover:underline">{item.name}</Link>
                : item.name}
            </li>)}
          </ul> : <span className="font-normal text-slate-500">None selected</span>}
        </dd>
      </div>
    ))}
  </>;
}

function SelectedBadge() {
  return <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">Selected for this job</span>;
}

export default function JobSiteDetails({ job, site, bodiesOfWater, equipment, loading, error, onRetry }) {
  const [open, setOpen] = useState(false);
  const bodyIds = new Set(getRecordBodyOfWaterIds(job));
  const equipmentIds = new Set(getRecordEquipmentIds(job));
  const bodyById = new Map(bodiesOfWater.map((body) => [body.id, body]));
  const address = formatAddressLabel(site);
  const siteId = job.serviceLocationId;

  return <>
    <button type="button" onClick={() => setOpen(true)} disabled={!siteId}
      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
      <MapPinIcon className="h-4 w-4" aria-hidden="true" />View site
    </button>
    <Dialog open={open} onClose={() => setOpen(false)} className="relative z-50">
      <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-5">
        <DialogPanel className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left text-slate-900 shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold">Site details</DialogTitle>
              <p className="mt-1 break-words text-sm font-semibold text-slate-800">{site.nickName || job.serviceLocationName || "Job site"}</p>
              {address && <p className="mt-1 break-words text-sm text-slate-600">{address}</p>}
              <p className="mt-2 text-xs text-slate-500">Bodies of water and equipment at this location. Job selections are marked below.</p>
            </div>
            <button type="button" aria-label="Close site details" onClick={() => setOpen(false)}
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" aria-busy={loading}>
            {loading ? <p role="status" className="text-sm text-slate-500">Loading site details...</p>
              : error ? <div role="alert" className="text-sm text-red-700">
                <p>{error}</p>
                <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-red-200 px-3 py-1.5 font-semibold hover:bg-red-50">Try again</button>
              </div> : <div className="grid gap-6 md:grid-cols-2">
                <section aria-label="Site bodies of water">
                  <h3 className="mb-3 text-sm font-bold">Bodies of water ({bodiesOfWater.length})</h3>
                  {!bodiesOfWater.length ? <p className="text-sm text-slate-500">No bodies of water at this site.</p>
                    : <ul className="space-y-3">{bodiesOfWater.map((body) => (
                      <li key={body.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <Link to={detailPath("bodiesOfWater", body.id)} className="break-words text-sm font-bold text-blue-700 hover:underline">{bodyOfWaterLabelFromRecord(body)}</Link>
                          {bodyIds.has(body.id) && <SelectedBadge />}
                        </div>
                        <p className="mt-2 text-xs text-slate-600">{[
                          body.gallons !== "" && body.gallons != null ? `${Number(body.gallons).toLocaleString()} gallons` : "",
                          body.waterType, body.material, body.shape,
                        ].filter(Boolean).join(" · ") || "No additional details"}</p>
                        {body.isActive === false && <p className="mt-1 text-xs text-slate-500">Inactive</p>}
                        {body.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{body.notes}</p>}
                      </li>
                    ))}</ul>}
                </section>
                <section aria-label="Site equipment">
                  <h3 className="mb-3 text-sm font-bold">Equipment ({equipment.length})</h3>
                  {!equipment.length ? <p className="text-sm text-slate-500">No equipment at this site.</p>
                    : <ul className="space-y-3">{equipment.map((piece) => {
                      const body = bodyById.get(piece.bodyOfWaterId);
                      const status = displayEquipmentStatus(piece.status || piece.operationStatus || piece.equipmentStatus);
                      return <li key={piece.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <Link to={detailPath("equipment", piece.id)} className="break-words text-sm font-bold text-blue-700 hover:underline">{piece.name || equipmentLabelFromRecord(piece)}</Link>
                          {equipmentIds.has(piece.id) && <SelectedBadge />}
                        </div>
                        <p className="mt-2 break-words text-xs text-slate-600">{[piece.type || piece.category, piece.make, piece.model].filter(Boolean).join(" · ") || "No additional details"}</p>
                        {body && <p className="mt-1 text-xs text-slate-600">Body of water: {bodyOfWaterLabelFromRecord(body)}</p>}
                        {status && <p className="mt-1 text-xs font-semibold text-slate-700">{status}</p>}
                        {piece.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{piece.notes}</p>}
                      </li>;
                    })}</ul>}
                </section>
              </div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 sm:px-5">
            {siteId && <Link to={detailPath("serviceLocations", siteId)} className="text-sm font-semibold text-blue-700 hover:underline">Open full site</Link>}
            <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  </>;
}
