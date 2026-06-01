import React, { useEffect, useMemo, useState, useContext } from "react";
import { useParams, Link } from "react-router-dom";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

import {
  query,
  collection,
  getDocs,
  orderBy,
  doc,
  deleteDoc,
} from "firebase/firestore";
import { format } from "date-fns";

/**
 * Expected normalized shape (based on your object):
 * {
 *   id: string,
 *   name: string,
 *   type: "Repair" | string,
 *   date: Date | null,
 *   performedBy: string,
 *   description: string,
 *   techId: string,
 *   techName: string,
 *   jobId: string,
 *   partIds: string[], // may be empty for service history
 *   source: "maintenance" | "repair"
 * }
 */

function pillClass(active) {
  return [
    "px-3 py-1 rounded-full text-sm font-medium border transition",
    active
      ? "bg-slate-900 text-white border-slate-900"
      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
  ].join(" ");
}

const toDateSafe = (maybeTimestamp) => {
  if (!maybeTimestamp) return null;
  if (typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate();
  if (maybeTimestamp instanceof Date) return maybeTimestamp;
  if (typeof maybeTimestamp === "number") {
    const parsed = new Date(maybeTimestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const sourceLabel = (record) => {
  if (record.addedBy) return record.addedBy;
  if (record.sourceTaskId || record.taskId || record.serviceStopTaskId || record.jobTaskId) return "Auto";
  return "Manual";
};

const isSystemGenerated = (record) => sourceLabel(record).toLowerCase() !== "manual";

export default function EquipmentServiceHistory() {
  const { equipmentId } = useParams();
  const { recentlySelectedCompany } = useContext(Context);

  const [records, setRecords] = useState([]);
  const [filter, setFilter] = useState("all"); // all | maintenance | repair
  const [sourceFilter, setSourceFilter] = useState("all"); // all | manual | auto

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null); // { id, source }

  useEffect(() => {
    let isMounted = true;

    (async () => {
      if (!recentlySelectedCompany || !equipmentId) return;

      try {
        const serviceHistoryQ = query(
          collection(
            db,
            "companies",
            recentlySelectedCompany,
            "equipment",
            equipmentId,
            "serviceHistory"
          ),
          orderBy("date", "desc")
        );

        const serviceHistorySnap = await getDocs(serviceHistoryQ);

        const mapDoc = (d, source) => {
          const data = d.data();
          return {
            id: d.id,
            name: data?.name ?? "",
            type: data?.type ?? "Maintenance",
            date: toDateSafe(data?.date),
            performedBy: data?.performedBy ?? "",
            description: data?.description ?? data?.notes ?? "",
            techId: data?.techId ?? "",
            techName: data?.techName ?? "",
            jobId: data?.jobId ?? "",
            addedBy: data?.addedBy ?? "",
            sourceTaskId: data?.sourceTaskId ?? data?.taskId ?? data?.serviceStopTaskId ?? data?.jobTaskId ?? "",
            serviceStopId: data?.serviceStopId ?? "",
            recurringServiceStopId: data?.recurringServiceStopId ?? "",
            partIds: Array.isArray(data?.partIds) ? data.partIds : [],
            source,
          };
        };

        const merged = serviceHistorySnap.docs.map((d) => {
          const type = String(d.data()?.type ?? "").toLowerCase();
          return mapDoc(d, type === "repair" ? "repair" : "maintenance");
        }).sort((a, b) => {
          const ad = a.date ? a.date.getTime() : 0;
          const bd = b.date ? b.date.getTime() : 0;
          return bd - ad;
        });

        if (isMounted) setRecords(merged);
      } catch (error) {
        console.error("Equipment Service History Data Error:", error);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [recentlySelectedCompany, equipmentId]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const matchesType = filter === "all" || r.source === filter;
      const matchesSource = sourceFilter === "all" || (sourceFilter === "auto" ? isSystemGenerated(r) : !isSystemGenerated(r));
      return matchesType && matchesSource;
    });
  }, [records, filter, sourceFilter]);

  const stats = useMemo(() => ({
    total: records.length,
    maintenance: records.filter((r) => r.source === "maintenance").length,
    repair: records.filter((r) => r.source === "repair").length,
    auto: records.filter(isSystemGenerated).length,
  }), [records]);

  const openDeleteModal = (record) => {
    if (isSystemGenerated(record)) return;
    setItemToDelete({ id: record.id, source: record.source });
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setItemToDelete(null);
    setShowDeleteModal(false);
  };

  const handleDelete = async () => {
    if (!itemToDelete?.id || !itemToDelete?.source) return;

    try {
      await deleteDoc(
        doc(
          db,
          "companies",
          recentlySelectedCompany,
          "equipment",
          equipmentId,
          "serviceHistory",
          itemToDelete.id
        )
      );

      setRecords((prev) => prev.filter((r) => r.id !== itemToDelete.id));
      closeDeleteModal();
    } catch (error) {
      console.error("Error deleting document:", error);
    }
  };

  const deleteLabel =
    itemToDelete?.source === "repair" ? "repair record" : "maintenance record";

  return (
    <div className="px-2 md:px-7 py-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
        <div>
          <div>
            <Link to={`/company/equipment/detail/${equipmentId}`} className="text-sm font-semibold text-slate-600 hover:text-slate-900">&larr; Back to Equipment</Link>

            <h2 className="text-2xl font-semibold text-slate-900">
              Equipment Service History
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              View all maintenance and repair events for this equipment.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={pillClass(filter === "all")}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={pillClass(filter === "maintenance")}
            onClick={() => setFilter("maintenance")}
          >
            Maintenance
          </button>
          <button
            className={pillClass(filter === "repair")}
            onClick={() => setFilter("repair")}
          >
            Repair
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4 mb-5">
        <HistoryStat label="Records" value={stats.total} />
        <HistoryStat label="Maintenance" value={stats.maintenance} />
        <HistoryStat label="Repairs" value={stats.repair} />
        <HistoryStat label="Auto-Created" value={stats.auto} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-600">Source:</span>
        <button className={pillClass(sourceFilter === "all")} onClick={() => setSourceFilter("all")}>All</button>
        <button className={pillClass(sourceFilter === "manual")} onClick={() => setSourceFilter("manual")}>Manual</button>
        <button className={pillClass(sourceFilter === "auto")} onClick={() => setSourceFilter("auto")}>Auto-created</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Tech</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Parts</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredRecords?.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={9}>
                    No history found for this filter.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((item) => {
                  const systemGenerated = isSystemGenerated(item);
                  return (
                  <tr key={`${item.source}-${item.id}`} className="hover:bg-slate-50/70 align-top">
                    <td className="px-4 py-3 text-sm text-slate-800">
                      {item.date ? format(item.date, "PP") : "—"}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border",
                          item.source === "repair"
                            ? "bg-rose-50 text-rose-700 border-rose-100"
                            : "bg-emerald-50 text-emerald-700 border-emerald-100",
                        ].join(" ")}
                      >
                        {item.source === "repair" ? "Repair" : "Maintenance"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.type || "—"}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border",
                          systemGenerated
                            ? "bg-blue-50 text-blue-700 border-blue-100"
                            : "bg-slate-50 text-slate-700 border-slate-200",
                        ].join(" ")}
                      >
                        {sourceLabel(item)}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.techName || item.performedBy || "—"}
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.description || "—"}
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-600">
                      <ReferenceLine label="Task" value={item.sourceTaskId} />
                      <ReferenceLine label="Job" value={item.jobId} />
                      <ReferenceLine label="Stop" value={item.serviceStopId} />
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.partIds?.length ? item.partIds.length : "—"}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openDeleteModal(item)}
                        disabled={systemGenerated}
                        title={systemGenerated ? "Auto-created history should be changed from the source task or job." : "Delete record"}
                        className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-sm font-semibold bg-rose-600 text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                      >
                        {systemGenerated ? "Source Locked" : "Delete"}
                      </button>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200">
            <div className="p-5">
              <h3 className="text-lg font-semibold text-slate-900">
                Delete {deleteLabel}
              </h3>
              <p className="text-sm text-slate-600 mt-2">
                Are you sure you want to delete this {deleteLabel}? This action
                cannot be undone.
              </p>

              <div className="flex justify-end gap-3 mt-5">
                <button
                  onClick={closeDeleteModal}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const HistoryStat = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-bold text-slate-900">{Number(value || 0).toLocaleString()}</p>
  </div>
);

const ReferenceLine = ({ label, value }) => (
  value ? (
    <div className="mb-1">
      <span className="font-semibold">{label}:</span> <span className="font-mono">{value}</span>
    </div>
  ) : null
);
