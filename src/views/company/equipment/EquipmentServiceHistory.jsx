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
 *   source: "maintenance" | "service"
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

export default function EquipmentServiceHistory() {
  const { equipmentId } = useParams();
  const { recentlySelectedCompany } = useContext(Context);

  const [records, setRecords] = useState([]);
  const [filter, setFilter] = useState("all"); // all | service | maintenance

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null); // { id, source }

  useEffect(() => {
    let isMounted = true;

    (async () => {
      if (!recentlySelectedCompany || !equipmentId) return;

      try {
        // 1) serviceHistory
        const serviceQ = query(
          collection(
            db,
            "companies",
            recentlySelectedCompany,
            "equipment",
            equipmentId,
            "repairHistory"
          ),
          orderBy("date", "desc")
        );

        // 2) maintenanceHistory
        const maintenanceQ = query(
          collection(
            db,
            "companies",
            recentlySelectedCompany,
            "equipment",
            equipmentId,
            "maintenanceHistory"
          ),
          orderBy("date", "desc")
        );

        const [serviceSnap, maintenanceSnap] = await Promise.all([
          getDocs(serviceQ),
          getDocs(maintenanceQ),
        ]);

        const toDateSafe = (maybeTimestamp) => {
          // Firestore Timestamp has .toDate()
          if (!maybeTimestamp) return null;
          if (typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate();
          // If already a Date
          if (maybeTimestamp instanceof Date) return maybeTimestamp;
          return null;
        };

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
            partIds: Array.isArray(data?.partIds) ? data.partIds : [],
            source, // "service" | "maintenance"
          };
        };

        const serviceRecords = serviceSnap.docs.map((d) => mapDoc(d, "repair"));
        const maintenanceRecords = maintenanceSnap.docs.map((d) =>
          mapDoc(d, "maintenance")
        );

        const merged = [...serviceRecords, ...maintenanceRecords].sort((a, b) => {
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
    if (filter === "all") return records;
    return records.filter((r) => r.source === filter);
  }, [records, filter]);

  const openDeleteModal = (id, source) => {
    setItemToDelete({ id, source });
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setItemToDelete(null);
    setShowDeleteModal(false);
  };

  const handleDelete = async () => {
    if (!itemToDelete?.id || !itemToDelete?.source) return;

    try {
      const collectionName =
        itemToDelete.source === "maintenance" ? "serviceHistory" : "repairHistory";

      await deleteDoc(
        doc(
          db,
          "companies",
          recentlySelectedCompany,
          "equipment",
          equipmentId,
          collectionName,
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
    itemToDelete?.source === "service" ? "service record" : "maintenance record";

  return (
    <div className="px-2 md:px-7 py-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
        <div>
          <div>
              <Link to={`/company/equipment/${equipmentId}`} className="text-sm font-semibold text-slate-600 hover:text-slate-900">&larr; Back to Equipment</Link>
              
            <h2 className="text-2xl font-semibold text-slate-900">
              Equipment Service History
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              View all service and maintenance events for this equipment.
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

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Tech</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Parts</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredRecords?.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={7}>
                    No history found for this filter.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((item) => (
                  <tr key={`${item.source}-${item.id}`} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-sm text-slate-800">
                      {item.date ? format(item.date, "PP") : "—"}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border",
                          item.source === "service"
                            ? "bg-blue-50 text-blue-700 border-blue-100"
                            : "bg-emerald-50 text-emerald-700 border-emerald-100",
                        ].join(" ")}
                      >
                        {item.source === "service" ? "Service" : "Maintenance"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.type || "—"}
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.techName || item.performedBy || "—"}
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.description || "—"}
                    </td>

                    <td className="px-4 py-3 text-sm text-slate-700">
                      {item.partIds?.length ? item.partIds.length : "—"}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openDeleteModal(item.id, item.source)}
                        className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-sm font-semibold
                                   bg-rose-600 text-white hover:bg-rose-700 transition"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
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