import React, { useState, useEffect, useContext, useMemo } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs } from "firebase/firestore";
import { Link,useNavigate } from "react-router-dom";
import { Equipment } from "../../../utils/models/Equipment";
import { format, isBefore, isEqual, startOfToday } from "date-fns";
import * as XLSX from "xlsx";

const TopFilterButton = ({ label, count, active, onClick }) => (
  <button
    onClick={onClick}
    type="button"
    className={[
      "flex items-center justify-between gap-3 w-full sm:w-auto",
      "px-4 py-3 rounded-2xl border text-sm font-semibold transition-all",
      active
        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
        : "bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:shadow-sm",
    ].join(" ")}
  >
    <span>{label}</span>
    <span
      className={[
        "min-w-[34px] text-center px-2 py-0.5 rounded-full text-xs font-bold",
        active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-700",
      ].join(" ")}
    >
      {count}
    </span>
  </button>
);

export default function EquipmentList() {
    const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);

  const [equipmentList, setEquipmentList] = useState([]);
  const [filteredEquipmentList, setFilteredEquipmentList] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // ✅ NEW: routine maintenance filter (needsService)
  // "" | "true" | "false"
  const [needsServiceFilter, setNeedsServiceFilter] = useState("");

  const [sortBy, setSortBy] = useState("customerName");
  const [sortOrder, setSortOrder] = useState("asc");

  const [types, setTypes] = useState([]);

  // all | maintenance | repair | nonOperational
  const [topFilter, setTopFilter] = useState("all");

  const today = startOfToday();

  useEffect(() => {
    const fetchEquipment = async () => {
      if (!recentlySelectedCompany) return;

      try {
        const q = query(collection(db, "companies", recentlySelectedCompany, "equipment"));
        const querySnapshot = await getDocs(q);
        const equipmentData = querySnapshot.docs.map((doc) => Equipment.fromFirestore(doc));

        setEquipmentList(equipmentData);

        const uniqueTypes = [...new Set(equipmentData.map((item) => item.type))].filter(Boolean);
        setTypes(uniqueTypes);
      } catch (error) {
        console.error("Equipment Data Error!:", error);
      }
    };

    fetchEquipment();
  }, [recentlySelectedCompany]);

  // -----------------------------
  // ✅ Unique customer count
  // -----------------------------
  const uniqueCustomerCount = useMemo(() => {
    const ids = new Set(
      (equipmentList || [])
        .map((e) => (e?.customerId ?? "").toString().trim())
        .filter(Boolean)
    );
    return ids.size;
  }, [equipmentList]);

  // -----------------------------
  // Helpers (status + date logic)
  // -----------------------------
  const norm = (v) => (v ?? "").toString().trim().toLowerCase();

  const dateIsDue = (d) => {
    if (!d) return false;
    return isBefore(d, today) || isEqual(d, today);
  };

  /**
   * ✅ Needs Maintenance filter rule:
   * Include an item if EITHER:
   * 1) status indicates maintenance (string match)
   * OR
   * 2) nextServiceDate is today or earlier
   */
  const isNeedsMaintenance = (eq) => {
    if (!eq) return false;
    const status = norm(eq.status);
    const statusSaysMaintenance =
      status === "needs maintenance" ||
      status === "needsmaintenance" ||
      status === "maintenance" ||
      status === "needs service" ||
      status === "needsservice";

    return statusSaysMaintenance || dateIsDue(eq.nextServiceDate);
  };

  const isNeedsRepair = (eq) => norm(eq?.status) === "needs repair";
  const isNonOperational = (eq) => norm(eq?.status) === "nonoperational";

  // Counts for top buttons
  const topCounts = useMemo(() => {
    const all = equipmentList.length;
    const maintenance = equipmentList.filter(isNeedsMaintenance).length;
    const repair = equipmentList.filter(isNeedsRepair).length;
    const nonOperational = equipmentList.filter(isNonOperational).length;
    return { all, maintenance, repair, nonOperational };
  }, [equipmentList]);

  const maintenanceDueCount = topCounts.maintenance;

  useEffect(() => {
    let filtered = [...equipmentList];

    // Top filter
    if (topFilter === "maintenance") {
      filtered = filtered.filter(isNeedsMaintenance);
    } else if (topFilter === "repair") {
      filtered = filtered.filter(isNeedsRepair);
    } else if (topFilter === "nonOperational") {
      filtered = filtered.filter(isNonOperational);
    }

    // Search
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter((item) =>
        ["customerName", "type", "make", "model", "notes", "status"].some(
          (field) => item?.[field] && item[field].toString().toLowerCase().includes(s)
        )
      );
    }

    // Type dropdown
    if (typeFilter) {
      filtered = filtered.filter((item) => item?.type === typeFilter);
    }

    // ✅ NEW: Needs Service filter
    // "" => all
    // "true" => only eq.needsService === true
    // "false" => only eq.needsService === false
    if (needsServiceFilter === "true") {
      filtered = filtered.filter((item) => item?.needsService === true);
    } else if (needsServiceFilter === "false") {
      filtered = filtered.filter((item) => item?.needsService === false);
    }

    // Sort
    filtered.sort((a, b) => {
      const fieldA = a?.[sortBy];
      const fieldB = b?.[sortBy];

      // Dates
      if (fieldA instanceof Date && fieldB instanceof Date) {
        const comparison = fieldA.getTime() - fieldB.getTime();
        return sortOrder === "desc" ? comparison * -1 : comparison;
      }

      // Strings
      if (typeof fieldA === "string" && typeof fieldB === "string") {
        const comparison = fieldA.localeCompare(fieldB);
        return sortOrder === "desc" ? comparison * -1 : comparison;
      }

      // Fallback
      let comparison = 0;
      if (fieldA > fieldB) comparison = 1;
      else if (fieldA < fieldB) comparison = -1;
      return sortOrder === "desc" ? comparison * -1 : comparison;
    });

    setFilteredEquipmentList(filtered);
  }, [equipmentList, searchTerm, typeFilter, needsServiceFilter, sortBy, sortOrder, topFilter]);

  const handleSort = (field) => {
    const order = sortBy === field && sortOrder === "asc" ? "desc" : "asc";
    setSortBy(field);
    setSortOrder(order);
  };

  const getStatusClass = (status, maintenanceFlag) => {
    if (maintenanceFlag) return "bg-red-100 text-red-800";
    const s = norm(status);
    if (s === "operational") return "bg-green-100 text-green-800";
    if (s === "needs maintenance" || s === "maintenance" || s === "needs service") return "bg-yellow-100 text-yellow-800";
    if (s === "needs repair") return "bg-orange-100 text-orange-800";
    if (s === "nonoperational") return "bg-gray-200 text-gray-800";
    return "bg-gray-100 text-gray-800";
  };

  // -----------------------------
  // ✅ Excel download
  // -----------------------------
  const downloadExcel = () => {
    try {
      const rows = filteredEquipmentList.map((eq) => {
        const maintenanceFlag = isNeedsMaintenance(eq);

        return {
          "Equipment ID": eq?.id || "",
          "Customer ID": eq?.customerId || "",
          "Customer Name": eq?.customerName || "",
          Name: eq?.name || "",
          Make: eq?.make || "",
          Model: eq?.model || "",
          Type: eq?.type || "",
          Status: maintenanceFlag ? "Needs Maintenance" : (eq?.status || ""),
          "Needs Service (bool)": eq?.needsService ?? "",
          "Last Service Date": eq?.lastServiceDate ? format(eq.lastServiceDate, "yyyy-MM-dd") : "",
          "Next Service Date": eq?.nextServiceDate ? format(eq.nextServiceDate, "yyyy-MM-dd") : "",
          "Service Frequency": eq?.serviceFrequency || "",
          "Service Frequency Every": eq?.serviceFrequencyEvery ?? "",
          "Is Active": eq?.isActive ?? "",
          Notes: eq?.notes || "",
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Equipment");

      const fileName = `equipment_export_${format(new Date(), "yyyy-MM-dd_HH-mm")}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error("Excel export failed:", e);
      alert("Excel export failed. Check console for details.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-screen-xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center mb-6">
          <div>
            <h2 className="text-3xl font-bold text-gray-800">Equipment</h2>
            <p className="text-gray-600 mt-1">Track assets, service schedules, and operational status.</p>

            <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
              <span className="px-3 py-1 rounded-full bg-white border border-gray-200 font-semibold">
                Customers: {uniqueCustomerCount}
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-gray-600">
                Equipment: <span className="font-semibold text-gray-800">{equipmentList.length}</span>
              </span>
            </div>
          </div>

          <Link
            to={"/company/equipment/createNew"}
            className="inline-flex items-center justify-center py-2.5 px-4 bg-blue-600 text-white font-semibold rounded-xl shadow-md hover:bg-blue-700 transition"
          >
            Create New
          </Link>
        </div>

        {/* TOP FILTER BUTTONS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <TopFilterButton
            label="All Equipment"
            count={topCounts.all}
            active={topFilter === "all"}
            onClick={() => setTopFilter("all")}
          />
          <TopFilterButton
            label="Needs Maintenance"
            count={topCounts.maintenance}
            active={topFilter === "maintenance"}
            onClick={() => setTopFilter("maintenance")}
          />
          <TopFilterButton
            label="Needs Repair"
            count={topCounts.repair}
            active={topFilter === "repair"}
            onClick={() => setTopFilter("repair")}
          />
          <TopFilterButton
            label="Non-Operational"
            count={topCounts.nonOperational}
            active={topFilter === "nonOperational"}
            onClick={() => setTopFilter("nonOperational")}
          />
        </div>

        {maintenanceDueCount > 0 && (
          <div className="p-4 mb-6 text-sm text-red-800 rounded-2xl bg-red-100 border border-red-200" role="alert">
            <span className="font-bold">Maintenance Alert:</span> You have {maintenanceDueCount} item(s) needing maintenance (by status or due date).
          </div>
        )}

        <div className="bg-white shadow-lg rounded-2xl border border-gray-200 overflow-hidden">
          {/* Filters */}
          <div className="p-6 border-b border-gray-100 bg-white">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                onChange={(e) => setSearchTerm(e.target.value)}
                value={searchTerm}
                className="md:col-span-1 w-full p-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500"
                type="text"
                placeholder="Search customer, make, model, type, status, notes..."
              />

              <select
                onChange={(e) => setTypeFilter(e.target.value)}
                value={typeFilter}
                className="w-full p-3 border border-gray-300 rounded-xl bg-white focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              {/* ✅ Replaces the date box */}
              <select
                onChange={(e) => setNeedsServiceFilter(e.target.value)}
                value={needsServiceFilter}
                className="w-full p-3 border border-gray-300 rounded-xl bg-white focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Routine Service (All)</option>
                <option value="true">Routine Service: Yes</option>
                <option value="false">Routine Service: No</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-gray-50">
                <tr>
                  {["customerName", "make", "model", "type", "nextServiceDate", "status"].map((field) => (
                    <th
                      key={field}
                      className="p-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none"
                      onClick={() => handleSort(field)}
                    >
                      {field.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())}
                      {sortBy === field ? (sortOrder === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                  <th className="p-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Notes</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {filteredEquipmentList.map((equipment) => {
                  const maintenanceFlag = isNeedsMaintenance(equipment);

                  return (
                    <tr key={equipment.id} className="hover:bg-gray-50 transition-colors"
                    onClick={() => navigate(`/company/equipment/detail/${equipment.id}`)} >
                      <td className="p-4 whitespace-nowrap">
                          {equipment.customerName}
                      </td>

                      <td className="p-4 whitespace-nowrap text-gray-700">
                          {equipment.make}
                      </td>

                      <td className="p-4 whitespace-nowrap text-gray-700">
                          {equipment.model}
                      </td>

                      <td className="p-4 whitespace-nowrap text-gray-700">
                          {equipment.type}
                      </td>

                      <td
                        className={`p-4 whitespace-nowrap ${
                          dateIsDue(equipment.nextServiceDate) ? "text-red-600 font-semibold" : "text-gray-700"
                        }`}
                      >
                          {equipment.nextServiceDate ? format(equipment.nextServiceDate, "PP") : "N/A"}
                      </td>

                      <td className="p-4 whitespace-nowrap">
                        <span
                          className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(
                            equipment.status,
                            maintenanceFlag
                          )}`}
                        >
                          {maintenanceFlag ? "Needs Maintenance" : equipment.status}
                        </span>
                      </td>

                      <td className="p-4 whitespace-nowrap max-w-xs truncate text-gray-700" title={equipment.notes}>
                          {equipment.notes}
                      </td>
                    </tr>
                  );
                })}

                {filteredEquipmentList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-gray-500">
                      No equipment found for the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-gray-100 bg-white text-sm text-gray-500">
            Showing <span className="font-semibold text-gray-700">{filteredEquipmentList.length}</span> of{" "}
            <span className="font-semibold text-gray-700">{equipmentList.length}</span> items
          </div>
        </div>

        {/* ✅ Download button at bottom */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={downloadExcel}
            className="inline-flex items-center justify-center py-2.5 px-4 bg-green-600 text-white font-semibold rounded-xl shadow-md hover:bg-green-700 transition"
          >
            Download Excel
          </button>
        </div>
      </div>
    </div>
  );
}
