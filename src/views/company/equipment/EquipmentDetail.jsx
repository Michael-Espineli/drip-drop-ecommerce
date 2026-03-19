import React, { useState, useEffect, useContext, useRef, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Equipment } from "../../../utils/models/Equipment";
import { MaintenanceHistory } from "../../../utils/models/MaintenanceHistory";
import { RepairHistory } from "../../../utils/models/RepairHistory";
import { EquipmentPart } from "../../../utils/models/EquipmentPart";
import {
  query,
  collection,
  getDocs,
  limit,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  where,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format, addDays, addWeeks, addMonths, addYears } from "date-fns";
import { v4 as uuidv4 } from "uuid";

import toast from "react-hot-toast";

import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css'
/**
 * ✅ IMPORTANT:
 * Keep these components OUTSIDE EquipmentDetail
 * so they do NOT remount on every keystroke (focus loss).
 */
const inputBase =
  "w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500";

const Badge = ({ tone = "gray", children }) => {
  const tones = {
    gray: "bg-gray-100 text-gray-800",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    yellow: "bg-yellow-100 text-yellow-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
};

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
    {children}
  </div>
);

const ModalShell = ({ title, children, onClose, footer }) => (
  <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
    <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">{title}</h3>
          <p className="text-sm text-gray-500 mt-1">Fill out the details below.</p>
        </div>
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-xl bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center text-gray-700"
          aria-label="Close"
          type="button"
        >
          ✕
        </button>
      </div>
      {children}
      {footer && <div className="mt-6">{footer}</div>}
    </div>
  </div>
);

/**
 * ✅ Helper: compute nextServiceDate from lastServiceDate + frequency number + unit string
 * serviceFrequency: number
 * serviceFrequencyEvery: "Day" | "Week" | "Month" | "Year"
 */
const computeNextServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
  if (!lastServiceDate) return null;

  const n = Number(serviceFrequency);
  if (!Number.isFinite(n) || n <= 0) return null;

  const base = new Date(lastServiceDate);
  if (Number.isNaN(base.getTime())) return null;

  switch (serviceFrequencyEvery) {
    case "Day":
      return addDays(base, n);
    case "Week":
      return addWeeks(base, n);
    case "Month":
      return addMonths(base, n);
    case "Year":
      return addYears(base, n);
    default:
      return null;
  }
};

const EquipmentDetail = () => {
  const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);
  const { equipmentId } = useParams();

  const [equipment, setEquipment] = useState({});
  const [edit, setEdit] = useState(false);

  // ✅ prevents re-hydration while editing
  const hasHydratedRef = useRef(false);

  // Edit Equipment States
  const [category, setCategory] = useState("");
  const [cleanFilterPressure, setCleanFilterPressure] = useState("");
  const [currentPressure, setCurrentPressure] = useState("");
  const [dateInstalled, setDateInstalled] = useState(null);

  const [lastServiceDate, setLastServiceDate] = useState(null);
  const [nextServiceDate, setNextServiceDate] = useState(null);

  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [needsService, setNeedsService] = useState(false);

  // ✅ per your spec:
  // serviceFrequency = number (e.g. 3)
  // serviceFrequencyEvery = unit string ("Day" | "Week" | "Month" | "Year")
  const [serviceFrequency, setServiceFrequency] = useState(""); // keep as string for input
  const [serviceFrequencyEvery, setServiceFrequencyEvery] = useState(""); // unit string

  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");

  const [showServiceHistoryModal, setShowServiceHistoryModal] = useState(false);
  const [showRepairHistoryModal, setShowRepairHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Company Users
  const [companyUsers, setCompanyUsers] = useState([]);

  // Maintenance modal fields
  const [maintenanceName, setMaintenanceName] = useState("");
  const [maintenanceDate, setMaintenanceDate] = useState(new Date());
  const [maintenancePerformedBy, setMaintenancePerformedBy] = useState("Company");
  const [maintenanceCompanyUserId, setMaintenanceCompanyUserId] = useState("");
  const [maintenanceCompanyUserName, setMaintenanceCompanyUserName] = useState("");
  const [maintenanceCustomerName, setMaintenanceCustomerName] = useState("");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [mostRecentMaintenance, setMostRecentMaintenance] = useState(null);

  // Repair modal fields
  const [repairName, setRepairName] = useState("");
  const [repairDate, setRepairDate] = useState(new Date());
  const [repairPerformedBy, setRepairPerformedBy] = useState("Company");
  const [repairCompanyUserId, setRepairCompanyUserId] = useState("");
  const [repairCompanyUserName, setRepairCompanyUserName] = useState("");
  const [repairCustomerName, setRepairCustomerName] = useState("");
  const [repairPartsReplaced, setRepairPartsReplaced] = useState([]);
  const [currentPart, setCurrentPart] = useState("");
  const [repairNotes, setRepairNotes] = useState("");
  const [mostRecentRepair, setMostRecentRepair] = useState(null);
  const [mostRecentRepairPartNames, setMostRecentRepairPartNames] = useState([]);

  // -----------------------------
  // Load company users list
  // -----------------------------
  useEffect(() => {
    if (!recentlySelectedCompany) return;

    (async () => {
      try {
        const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
        const snap = await getDocs(query(usersRef, orderBy("name", "asc")));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCompanyUsers(data);

        if (data.length) {
          setMaintenanceCompanyUserId((prev) => prev || data[0].id);
          setRepairCompanyUserId((prev) => prev || data[0].id);
        }
      } catch (e) {
        console.error("Error loading company users:", e);
        setCompanyUsers([]);
      }
    })();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!companyUsers.length) return;
    const u = companyUsers.find((x) => x.id === maintenanceCompanyUserId);
    setMaintenanceCompanyUserName(u?.name || u?.fullName || "");
  }, [maintenanceCompanyUserId, companyUsers]);

  useEffect(() => {
    if (!companyUsers.length) return;
    const u = companyUsers.find((x) => x.id === repairCompanyUserId);
    setRepairCompanyUserName(u?.name || u?.fullName || "");
  }, [repairCompanyUserId, companyUsers]);

  // -----------------------------
  // Load equipment + live history
  // -----------------------------
  useEffect(() => {
    if (!equipmentId || !recentlySelectedCompany) return;

    let unsubMaintenance = null;
    let unsubRepair = null;

    (async () => {
      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const snapEquipment = Equipment.fromFirestore(docSnap);
          setEquipment(snapEquipment);

          // ✅ hydrate form only if NOT editing
          if (!edit) {
            setCategory(snapEquipment.type || "");
            setCleanFilterPressure(snapEquipment.cleanFilterPressure ?? "");
            setCurrentPressure(snapEquipment.currentPressure ?? "");
            setDateInstalled(snapEquipment.dateInstalled || null);

            setLastServiceDate(snapEquipment.lastServiceDate || null);
            setNextServiceDate(snapEquipment.nextServiceDate || null);

            setMake(snapEquipment.make || "");
            setModel(snapEquipment.model || "");
            setName(snapEquipment.name || "");
            setIsActive(!!snapEquipment.isActive);
            setNeedsService(!!snapEquipment.needsService);

            // ✅ store frequency in your desired shapes
            setServiceFrequency(
              snapEquipment.serviceFrequency !== undefined && snapEquipment.serviceFrequency !== null
                ? String(snapEquipment.serviceFrequency)
                : ""
            );
            setServiceFrequencyEvery(snapEquipment.serviceFrequencyEvery || "");

            setStatus(snapEquipment.status || "");
            setNotes(snapEquipment.notes || "");
            hasHydratedRef.current = true;
          } else if (!hasHydratedRef.current) {
            // fallback hydrate once if needed
            setCategory(snapEquipment.type || "");
            setCleanFilterPressure(snapEquipment.cleanFilterPressure ?? "");
            setCurrentPressure(snapEquipment.currentPressure ?? "");
            setDateInstalled(snapEquipment.dateInstalled || null);

            setLastServiceDate(snapEquipment.lastServiceDate || null);
            setNextServiceDate(snapEquipment.nextServiceDate || null);

            setMake(snapEquipment.make || "");
            setModel(snapEquipment.model || "");
            setName(snapEquipment.name || "");
            setIsActive(!!snapEquipment.isActive);
            setNeedsService(!!snapEquipment.needsService);

            setServiceFrequency(
              snapEquipment.serviceFrequency !== undefined && snapEquipment.serviceFrequency !== null
                ? String(snapEquipment.serviceFrequency)
                : ""
            );
            setServiceFrequencyEvery(snapEquipment.serviceFrequencyEvery || "");

            setStatus(snapEquipment.status || "");
            setNotes(snapEquipment.notes || "");
            hasHydratedRef.current = true;
          }

          const serviceHistoryRef = collection(docRef, "serviceHistory");

          const maintenanceLiveQ = query(
            serviceHistoryRef,
            where("type", "==", "Maintenance"),
            orderBy("date", "desc"),
            limit(1)
          );

          const repairLiveQ = query(
            serviceHistoryRef,
            where("type", "==", "Repair"),
            orderBy("date", "desc"),
            limit(1)
          );

          unsubMaintenance = onSnapshot(maintenanceLiveQ, (snap) => {
            if (snap.empty) {
              setMostRecentMaintenance(null);
              console.log("Received No Maintance Record")
              return;
            }
            console.log("Received Maintance Record")
            setMostRecentMaintenance(MaintenanceHistory.fromFirestore(snap.docs[0]));
          });

          unsubRepair = onSnapshot(repairLiveQ, async (snap) => {
            if (snap.empty) {
              setMostRecentRepair(null);
              setMostRecentRepairPartNames([]);
              console.log("Received No Repair Record")
              return;
            }
            console.log("Received Repair Record")
            const repair = RepairHistory.fromFirestore(snap.docs[0]);
            setMostRecentRepair(repair);

            const partsRef = collection(docRef, "parts");
            const ids = Array.isArray(repair.partIds) ? repair.partIds : [];
            if (!ids.length) {
              setMostRecentRepairPartNames([]);
              return;
            }

            try {
              const nameResults = await Promise.all(
                ids.map(async (pid) => {
                  const pSnap = await getDoc(doc(partsRef, pid));
                  if (!pSnap.exists()) return null;
                  const part = EquipmentPart.fromFirestore(pSnap);
                  return part.name || null;
                })
              );
              setMostRecentRepairPartNames(nameResults.filter(Boolean));
            } catch (e) {
              console.error("Error loading part names:", e);
              setMostRecentRepairPartNames([]);
            }
          });
        } else {
          console.log("No such document!");
        }
      } catch (error) {
        console.error("Equipment Data Error!:", error);
      }
    })();

    return () => {
      if (typeof unsubMaintenance === "function") unsubMaintenance();
      if (typeof unsubRepair === "function") unsubRepair();
    };
  }, [equipmentId, recentlySelectedCompany, edit]);

  /**
   * ✅ Recalculate nextServiceDate live while editing
   */
  const computedNextServiceDate = useMemo(() => {
    return computeNextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery);
  }, [lastServiceDate, serviceFrequency, serviceFrequencyEvery]);


  useEffect(() => {
    if (!edit) return;
    setNextServiceDate(computedNextServiceDate);
  }, [edit, computedNextServiceDate]);

  const handleSave = async () => {
    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);

      const next = computeNextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery);

      await updateDoc(docRef, {
        type: category,
        cleanFilterPressure,
        currentPressure,
        dateInstalled,

        lastServiceDate,
        nextServiceDate: next,

        make,
        model,
        name,
        isActive,
        needsService,

        // ✅ save in your desired shapes:
        serviceFrequency: serviceFrequency === "" ? null : Number(serviceFrequency),
        serviceFrequencyEvery: serviceFrequencyEvery || "",

        status,
        notes,
      });

      setEquipment((prev) => ({
        ...prev,
        type: category,
        cleanFilterPressure,
        currentPressure,
        dateInstalled,

        lastServiceDate,
        nextServiceDate: next,

        make,
        model,
        name,
        isActive,
        needsService,

        serviceFrequency: serviceFrequency === "" ? null : Number(serviceFrequency),
        serviceFrequencyEvery: serviceFrequencyEvery || "",

        status,
        notes,
      }));

      setEdit(false);
    } catch (error) {
      console.error("Error updating equipment:", error);
    }
  };

  const handleDelete = async () => {
    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);
      await deleteDoc(docRef);
      navigate("/company/equipment");
    } catch (error) {
      console.error("Error deleting equipment:", error);
    }
  };

  const handleCreateMaintenance = async () => {
    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);

      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(docRef, "serviceHistory", serviceId);

      const performedBy = maintenancePerformedBy;
      const techId = performedBy === "Company" ? (maintenanceCompanyUserId || "") : "";
      const techName =
        performedBy === "Company" ? (maintenanceCompanyUserName || "") : (maintenanceCustomerName || "").trim();

      const newMaintenanceRecord = {
        id: serviceId,
        name: (maintenanceName || "").trim(),
        type: "Maintenance",
        date: maintenanceDate,
        performedBy,
        description: maintenanceNotes,
        techId,
        techName,
        jobId: "",
        partIds: [],
      };

      await setDoc(serviceHistoryDoc, newMaintenanceRecord);
  
      // ✅ compute next based on maintenance date + current schedule
      const next = computeNextServiceDate(maintenanceDate, serviceFrequency, serviceFrequencyEvery);

      await updateDoc(docRef, {
        lastServiceDate: maintenanceDate,
        nextServiceDate: next,
      });

      setEquipment((prev) => ({
        ...prev,
        lastServiceDate: maintenanceDate,
        nextServiceDate: next,
      }));

      toast.success("Maintenance Record saved");
      // keep edit-form in sync too
      setLastServiceDate(maintenanceDate);
      setNextServiceDate(next);

      setShowServiceHistoryModal(false);
      setMaintenanceName("");
      setMaintenanceDate(new Date());
      setMaintenancePerformedBy("Company");
      setMaintenanceCompanyUserId(companyUsers?.[0]?.id || "");
      setMaintenanceCustomerName("");
      setMaintenanceNotes("");
    } catch (error) {

      toast.error("Failed to create Maintenance Record");
      console.error("Error creating maintenance history:", error);
    }
  };

  const handleCreateRepair = async () => {
    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId);

      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(docRef, "serviceHistory", serviceId);

      const partsRef = collection(docRef, "parts");

      const partIds = [];
      for (const partName of repairPartsReplaced) {
        const cleanName = (partName || "").trim();
        if (!cleanName) continue;

        const partId = "com_equ_par_" + uuidv4();
        const partDoc = doc(partsRef, partId);

        await setDoc(
          partDoc,
          EquipmentPart.toFirestore(
            new EquipmentPart({
              id: partId,
              name: cleanName,
              createdAt: new Date(),
            })
          )
        );

        partIds.push(partId);
      }

      const performedBy = repairPerformedBy;
      const techId = performedBy === "Company" ? (repairCompanyUserId || "") : "";
      const techName = performedBy === "Company" ? (repairCompanyUserName || "") : (repairCustomerName || "").trim();

      const newRepairRecord = {
        id: serviceId,
        name: (repairName || "").trim(),
        type: "Repair",
        date: repairDate,
        performedBy,
        description: repairNotes,
        techId,
        techName,
        jobId: "",
        partIds,
      };

      await setDoc(serviceHistoryDoc, newRepairRecord);

      setShowRepairHistoryModal(false);
      setRepairName("");
      setRepairDate(new Date());
      setRepairPerformedBy("Company");
      setRepairCompanyUserId(companyUsers?.[0]?.id || "");
      setRepairCustomerName("");
      setRepairPartsReplaced([]);
      setCurrentPart("");
      setRepairNotes("");
    } catch (error) {
      console.error("Error creating repair history:", error);
    }
  };

  const addPart = () => {
    const value = (currentPart || "").trim();
    if (!value) return;
    setRepairPartsReplaced((prev) => [...prev, value]);
    setCurrentPart("");
  };

  const removePart = (index) => {
    setRepairPartsReplaced((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-screen-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>

          <Link 
              to="/company/equipment"
              className="text-sm font-semibold text-slate-600 hover:text-slate-900"
          >&larr; Back to Equipment</Link>
            <h2 className="text-3xl font-bold text-gray-800">Equipment</h2>
            <p className="text-gray-600 mt-1">
              <span className="font-semibold text-gray-800">{equipment?.name || "—"}</span>{" "}
              <Link
                to={`/company/customers/details/${equipment?.customerId}/locations`}
                className="hover:text-blue-800"
              >
              <span className="text-gray-400">•</span> {equipment?.customerName || "—"}
              </Link>
            </p>
          </div>

          <div className="flex items-center gap-2">

            {!edit ? (
              <button
                onClick={() => {
                  hasHydratedRef.current = true;
                  setEdit(true);
                }}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                type="button"
              >
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  type="button"
                >
                  Save
                </button>
                <button
                  onClick={() => setEdit(false)}
                  className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
                  type="button"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Detail Card */}
        <div className="bg-white shadow-lg rounded-xl p-6">
          {!edit ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={equipment?.isActive ? "green" : "gray"}>{equipment?.isActive ? "Active" : "Inactive"}</Badge>
                <Badge tone={equipment?.needsService ? "red" : "green"}>
                  {equipment?.needsService ? "Needs Service" : "No Service Needed"}
                </Badge>
                {equipment?.status ? <Badge tone="blue">{equipment.status}</Badge> : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</p>
                  <p className="mt-1 text-gray-800 font-semibold">{equipment?.type || "—"}</p>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Make</p>
                  <p className="mt-1 text-gray-800 font-semibold">{equipment?.make || "—"}</p>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Model</p>
                  <p className="mt-1 text-gray-800 font-semibold">{equipment?.model || "—"}</p>
                </div>
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Installed</p>
                      <p className="mt-1 text-gray-800 font-semibold">
                        {equipment?.dateInstalled ? format(equipment.dateInstalled, "PP") : "N/A"}
                      </p>
                    </div>
                {
                  equipment.needsService ? (<>
                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Clean Filter Pressure</p>
                      <p className="mt-1 text-gray-800 font-semibold">{equipment?.cleanFilterPressure ?? "—"}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Pressure</p>
                      <p className="mt-1 text-gray-800 font-semibold">{equipment?.currentPressure ?? "—"}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Service</p>
                      <p className="mt-1 text-gray-800 font-semibold">
                        {equipment?.lastServiceDate ? format(equipment.lastServiceDate, "PP") : "N/A"}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Next Service</p>
                      <p className="mt-1 text-gray-800 font-semibold">
                        {equipment?.nextServiceDate ? format(equipment.nextServiceDate, "PP") : "N/A"}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Service Frequency</p>
                      <p className="mt-1 text-gray-800 font-semibold">
                        {equipment?.serviceFrequency && equipment?.serviceFrequencyEvery
                          ? `${equipment.serviceFrequency} ${equipment.serviceFrequencyEvery}`
                          : "—"}
                      </p>
                    </div>
                    </>):(<></>)
                }
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</p>
                <p className="mt-2 text-gray-700 whitespace-pre-wrap">{equipment?.notes || "—"}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <h3 className="text-xl font-bold text-gray-800">Edit Equipment</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputBase} />
                </Field>

                <Field label="Category">
                  <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputBase} />
                </Field>

                <Field label="Make">
                  <input value={make} onChange={(e) => setMake(e.target.value)} className={inputBase} />
                </Field>

                <Field label="Model">
                  <input value={model} onChange={(e) => setModel(e.target.value)} className={inputBase} />
                </Field>

                <Field label="Date Installed">
                  <DatePicker 
                    showIcon
                    selected={dateInstalled ? format(dateInstalled, "yyyy-MM-dd") : ""} 
                    onChange={(e) => setDateInstalled(e)}
                    className={inputBase}
                    icon={
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="1em"
                        height="1em"
                        viewBox="0 0 48 48"
                    >
                        <mask id="ipSApplication0">
                        <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="4">
                            <path strokeLinecap="round" d="M40.04 22v20h-32V22"></path>
                            <path
                            fill="#fff"
                            d="M5.842 13.777C4.312 17.737 7.263 22 11.51 22c3.314 0 6.019-2.686 6.019-6a6 6 0 0 0 6 6h1.018a6 6 0 0 0 6-6c0 3.314 2.706 6 6.02 6c4.248 0 7.201-4.265 5.67-8.228L39.234 6H8.845l-3.003 7.777Z"
                            ></path>
                        </g>
                        </mask>
                        <path
                        fill="currentColor"
                        d="M0 0h48v48H0z"
                        mask="url(#ipSApplication0)"
                        ></path>
                    </svg>
                    }
                  />
                </Field>
                <Field label="Needs Service">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={needsService}
                      onChange={(e) => setNeedsService(e.target.checked)}
                      className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-gray-700 font-semibold">{needsService ? "Yes" : "No"}</span>
                  </div>
                </Field>
    
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputBase}>
                    <option value="Operational">Operational</option>
                    <option value="Nonoperational">Nonoperational</option>
                    <option value="Needs Repair">Needs Repair</option>
                    <option value="Needs Maintenance">Needs Maintenance</option>
                  </select>
                </Field>
                {
                  needsService ? (<>
                    <Field label="Clean Filter Pressure">
                      <input value={cleanFilterPressure} onChange={(e) => setCleanFilterPressure(e.target.value)} className={inputBase} />
                    </Field>
    
                    <Field label="Current Pressure">
                      <input value={currentPressure} onChange={(e) => setCurrentPressure(e.target.value)} className={inputBase} />
                    </Field>
    
                    {/* ✅ Date picker + drives nextServiceDate */}
                    {/* <Field label="Last Service Date">
                      <input
                        type="date"
                        value={lastServiceDate ? format(lastServiceDate, "yyyy-MM-dd") : ""}
                        onChange={(e) => setLastServiceDate(e.target.value ? new Date(e.target.value) : null)}
                        className={inputBase}
                      />
                    </Field> */}
                    <Field label="Last Service Date">
                      <DatePicker 
                        showIcon
                        selected={lastServiceDate ? format(lastServiceDate, "yyyy-MM-dd") : ""} 
                        onChange={(e) => setLastServiceDate(e)}
                        className={inputBase}
                        icon={
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="1em"
                            height="1em"
                            viewBox="0 0 48 48"
                        >
                            <mask id="ipSApplication0">
                            <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="4">
                                <path strokeLinecap="round" d="M40.04 22v20h-32V22"></path>
                                <path
                                fill="#fff"
                                d="M5.842 13.777C4.312 17.737 7.263 22 11.51 22c3.314 0 6.019-2.686 6.019-6a6 6 0 0 0 6 6h1.018a6 6 0 0 0 6-6c0 3.314 2.706 6 6.02 6c4.248 0 7.201-4.265 5.67-8.228L39.234 6H8.845l-3.003 7.777Z"
                                ></path>
                            </g>
                            </mask>
                            <path
                            fill="currentColor"
                            d="M0 0h48v48H0z"
                            mask="url(#ipSApplication0)"
                            ></path>
                        </svg>
                        }
                      />
                    </Field>
    
                    <Field label="Next Service Date (auto)">
                      <input
                        type="date"
                        value={nextServiceDate ? format(nextServiceDate, "yyyy-MM-dd") : ""}
                        readOnly
                        className={`${inputBase} bg-gray-50`}
                      />
                    </Field>
    
                    <Field label="Service Frequency (number)">
                      <input
                        type="number"
                        min="0"
                        value={serviceFrequency}
                        onChange={(e) => setServiceFrequency(e.target.value)}
                        className={inputBase}
                        placeholder="e.g. 3"
                      />
                    </Field>
    
                    <Field label="Service Frequency Every">
                      <select value={serviceFrequencyEvery} onChange={(e) => setServiceFrequencyEvery(e.target.value)} className={inputBase}>
                        <option value="">Select…</option>
                        <option value="Day">Day</option>
                        <option value="Week">Week</option>
                        <option value="Month">Month</option>
                        <option value="Year">Year</option>
                      </select>
                    </Field>
                  
                  </>):(<>
                  </>)
                }

                <Field label="Is Active">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-gray-700 font-semibold">{isActive ? "Active" : "Inactive"}</span>
                  </div>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Notes">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputBase} rows={4} />
                  </Field>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* History Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Maintenance */}
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Most Recent Maintenance</h3>
                <p className="text-sm text-gray-500 mt-1">Log service and keep the schedule up to date.</p>
              </div>
              <button
                onClick={() => setShowServiceHistoryModal(true)}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                type="button"
              >
                New
              </button>
            </div>

            <div className="mt-5">
              {mostRecentMaintenance ? (
                <div className="space-y-2 text-gray-700">
                  <p>
                    <span className="font-semibold text-gray-800">Name:</span> {mostRecentMaintenance.name || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Date:</span>{" "}
                    {mostRecentMaintenance.date ? format(mostRecentMaintenance.date, "PP") : "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Performed By:</span> {mostRecentMaintenance.performedBy || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Tech:</span> {mostRecentMaintenance.techName || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Notes:</span> {mostRecentMaintenance.description || "—"}
                  </p>

                  <Link
                    to={`/company/equipment/detail/${equipmentId}/service-history`}
                    className="inline-block mt-2 font-semibold text-blue-600 hover:text-blue-800"
                  >
                    See More →
                  </Link>
                </div>
              ) : (
                <p className="text-gray-500">No maintenance history found.</p>
              )}
            </div>
          </div>

          {/* Repair */}
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Most Recent Repair</h3>
                <p className="text-sm text-gray-500 mt-1">Track repairs and replaced parts.</p>
              </div>
              <button
                onClick={() => setShowRepairHistoryModal(true)}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                type="button"
              >
                New
              </button>
            </div>

            <div className="mt-5">
              {mostRecentRepair ? (
                <div className="space-y-2 text-gray-700">
                  <p>
                    <span className="font-semibold text-gray-800">Name:</span> {mostRecentRepair.name || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Date:</span>{" "}
                    {mostRecentRepair.date ? format(mostRecentRepair.date, "PP") : "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Performed By:</span> {mostRecentRepair.performedBy || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Tech:</span> {mostRecentRepair.techName || "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Parts:</span>{" "}
                    {mostRecentRepairPartNames.length ? mostRecentRepairPartNames.join(", ") : "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-gray-800">Notes:</span> {mostRecentRepair.description || "—"}
                  </p>

                  <Link
                    to={`/company/equipment/detail/${equipmentId}/service-history`}
                    className="inline-block mt-2 font-semibold text-blue-600 hover:text-blue-800"
                  >
                    See More →
                  </Link>
                </div>
              ) : (
                <p className="text-gray-500">No repair history found.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* -----------------------------
          Maintenance Modal
         ----------------------------- */}
      {showServiceHistoryModal && (
        <ModalShell
          title="Create Maintenance Record"
          onClose={() => setShowServiceHistoryModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowServiceHistoryModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateMaintenance}
                className="py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                type="button"
              >
                Create
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4">
            <Field label="Name">
              <input value={maintenanceName} onChange={(e) => setMaintenanceName(e.target.value)} className={inputBase} />
            </Field>

            <Field label="Date">
              <input
                type="date"
                value={format(maintenanceDate, "yyyy-MM-dd")}
                onChange={(e) => setMaintenanceDate(new Date(e.target.value))}
                className={inputBase}
              />
            </Field>

            <Field label="Performed By">
              <select value={maintenancePerformedBy} onChange={(e) => setMaintenancePerformedBy(e.target.value)} className={inputBase}>
                <option value="Company">Company</option>
                <option value="Customer">Customer</option>
              </select>
            </Field>

            {maintenancePerformedBy === "Company" ? (
              <Field label="Company User">
                <select value={maintenanceCompanyUserId} onChange={(e) => setMaintenanceCompanyUserId(e.target.value)} className={inputBase}>
                  {companyUsers.length === 0 ? (
                    <option value="">No company users found</option>
                  ) : (
                    companyUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.fullName || u.email || u.id}
                      </option>
                    ))
                  )}
                </select>
              </Field>
            ) : (
              <Field label="Customer Name">
                <input value={maintenanceCustomerName} onChange={(e) => setMaintenanceCustomerName(e.target.value)} className={inputBase} />
              </Field>
            )}

            <Field label="Notes">
              <textarea value={maintenanceNotes} onChange={(e) => setMaintenanceNotes(e.target.value)} className={inputBase} rows={4} />
            </Field>
          </div>
        </ModalShell>
      )}

      {/* -----------------------------
          Repair Modal
         ----------------------------- */}
      {showRepairHistoryModal && (
        <ModalShell
          title="Create Repair Record"
          onClose={() => setShowRepairHistoryModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRepairHistoryModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRepair}
                className="py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                type="button"
              >
                Create
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4">
            <Field label="Name">
              <input value={repairName} onChange={(e) => setRepairName(e.target.value)} className={inputBase} />
            </Field>

            <Field label="Date">
              <input
                type="date"
                value={format(repairDate, "yyyy-MM-dd")}
                onChange={(e) => setRepairDate(new Date(e.target.value))}
                className={inputBase}
              />
            </Field>

            <Field label="Performed By">
              <select value={repairPerformedBy} onChange={(e) => setRepairPerformedBy(e.target.value)} className={inputBase}>
                <option value="Company">Company</option>
                <option value="Customer">Customer</option>
              </select>
            </Field>

            {repairPerformedBy === "Company" ? (
              <Field label="Company User">
                <select value={repairCompanyUserId} onChange={(e) => setRepairCompanyUserId(e.target.value)} className={inputBase}>
                  {companyUsers.length === 0 ? (
                    <option value="">No company users found</option>
                  ) : (
                    companyUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.fullName || u.email || u.id}
                      </option>
                    ))
                  )}
                </select>
              </Field>
            ) : (
              <Field label="Customer Name">
                <input value={repairCustomerName} onChange={(e) => setRepairCustomerName(e.target.value)} className={inputBase} />
              </Field>
            )}

            <Field label="Parts Replaced">
              <div className="flex gap-2">
                <input value={currentPart} onChange={(e) => setCurrentPart(e.target.value)} className={inputBase} />
                <button
                  onClick={addPart}
                  className="shrink-0 py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                  type="button"
                >
                  Add
                </button>
              </div>

              {!!repairPartsReplaced.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {repairPartsReplaced.map((part, idx) => (
                    <span
                      key={`${part}-${idx}`}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm font-semibold"
                    >
                      {part}
                      <button
                        onClick={() => removePart(idx)}
                        className="text-gray-500 hover:text-red-600 font-bold"
                        aria-label="Remove part"
                        type="button"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Notes">
              <textarea value={repairNotes} onChange={(e) => setRepairNotes(e.target.value)} className={inputBase} rows={4} />
            </Field>
          </div>
        </ModalShell>
      )}

      {/* -----------------------------
          Delete Modal
         ----------------------------- */}
      {showDeleteModal && (
        <ModalShell
          title="Delete Equipment"
          onClose={() => setShowDeleteModal(false)}
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                type="button"
              >
                Cancel
              </button>
              <button
              
                onClick={async () => {
                  await handleDelete();
                }}
                className="py-2 px-5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition"
                type="button"
              >
                Delete
              </button>
            </div>
          }
        >
          <p className="text-gray-700">Are you sure you want to delete this equipment? This action cannot be undone.</p>
        </ModalShell>
      )}
    </div>
  );
};

export default EquipmentDetail;