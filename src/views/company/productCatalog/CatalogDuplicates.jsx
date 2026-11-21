import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import WorkspaceHeader from "../../../components/workspace/WorkspaceHeader";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import { Context } from "../../../context/AuthContext";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";
import CatalogMergeDialog from "./CatalogMergeDialog";
import { catalogRecordMatches, catalogRecordName, duplicateGroups, loadMergeRecords } from "./catalogMergeRecords";

const secondary = workspaceButtonClass({ tone: "slate" });
const primary = workspaceButtonClass({ tone: "blue" });
const kindLabel = { product: "Products", vendorItem: "Vendor Items" };

function DuplicatesWorkspace({ companyId, kind, onKindChange }) {
  const [records, setRecords] = useState(null);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState(null);
  const [kept, setKept] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    loadMergeRecords(companyId, kind).then(rows => {
      if (current) setRecords(rows);
    }).catch(failure => {
      if (current) setError(userFacingErrorMessage(failure, "Could not load the catalog."));
    });
    return () => { current = false; };
  }, [companyId, kind, reload]);
  const groups = useMemo(() => duplicateGroups(records || [], kind), [records, kind]);
  const matches = groups.filter(group => group.members.some(record => catalogRecordMatches(kind, record, search)));
  const startMerge = (keepId = "", sourceId = "") => {
    setKept(null);
    setSelection({ keepId, sourceId });
  };
  const keptPath = kind === "product" ? "/company/product-catalog" : "/company/items/detail";

  return <>
    <WorkspaceHeader title="Merge Catalog Duplicates" description="Review suggested matches or search for two records to combine."
      actions={<>
        <Link to="/company/product-catalog/reconciliation" className={secondary}>Catalog Reconciliation</Link>
        <button type="button" onClick={() => startMerge()} className={primary}>Search and merge</button>
      </>}
    />
    {kept && <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <span>Duplicate merged into <strong>{kept.name}</strong>.</span>
      <Link className="font-semibold underline" to={`${keptPath}/${kept.id}`}>View kept record</Link>
    </div>}
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Catalog record type">
          {Object.entries(kindLabel).map(([value, label]) => <button key={value} type="button" aria-pressed={value === kind}
            className={value === kind ? primary : secondary} onClick={() => onKindChange(value)}>{label}</button>)}
        </div>
        <label className="text-sm font-semibold text-slate-700">Filter suggested matches
          <input type="search" value={search} onChange={event => setSearch(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Name, SKU, or vendor" />
        </label>
      </div>
      {error ? <div role="alert" className="space-y-2"><p>{error}</p><button type="button" className={secondary}
        onClick={() => { setError(""); setReload(value => value + 1); }}>Retry</button></div>
        : !records ? <p role="status" className="text-sm text-slate-600">Loading catalog…</p>
          : !matches.length ? <p className="text-sm text-slate-600">No suggested matches. Use Search and merge to find records manually.</p>
            : <ul className="space-y-3">{matches.map(group => <li key={group.key} className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-600">{group.reason}</p>
              <ul className="divide-y divide-slate-100">
                {group.members.map((row, index) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-semibold text-slate-950">{catalogRecordName(kind, row)}</p>
                    <p className="break-all text-sm text-slate-600">{[row.storeName || row.vendorName, row.sku, row.UOM || row.uom, row.size, row.id].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button type="button" className={secondary} onClick={() => startMerge(row.id, group.members.length === 2 ? group.members[1 - index].id : "")}>Keep and compare</button>
                </li>)}
              </ul>
            </li>)}</ul>}
    </section>
    {selection && <CatalogMergeDialog kind={kind} companyId={companyId} initialKeepId={selection.keepId} initialSourceId={selection.sourceId}
      onClose={() => setSelection(null)} onMerged={keepId => {
        const row = records?.find(record => record.id === keepId);
        setKept({ id: keepId, name: row ? catalogRecordName(kind, row) : "the kept record" });
        setSelection(null);
        setRecords(null);
        setError("");
        setReload(value => value + 1);
      }} />}
  </>;
}

export default function CatalogDuplicates() {
  const { recentlySelectedCompany: companyId } = useContext(Context);
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") === "vendorItem" ? "vendorItem" : "product";
  return <main className="min-h-screen space-y-6 bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
    {companyId ? <DuplicatesWorkspace key={`${companyId}:${kind}`} companyId={companyId} kind={kind}
      onKindChange={value => { if (value !== kind) setParams(value === "vendorItem" ? { kind: value } : {}); }} />
      : <p>Select a company to review catalog duplicates.</p>}
  </main>;
}
