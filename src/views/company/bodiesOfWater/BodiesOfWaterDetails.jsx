import React, { useState, useEffect, useContext, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../../../utils/config";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { BodyOfWater } from "../../../utils/models/BodyOfWater";
import { WATER_HISTORY_TYPES, fetchBodyOfWaterHistory } from "../../../utils/bodyOfWaterHistory";
import { format } from "date-fns";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";

const inputBase =
  "w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-blue-500 focus:border-blue-500";

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
    {children}
  </div>
);

const InfoCard = ({ label, value }) => (
  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
    <p className="mt-1 text-gray-800 font-semibold">{value || "—"}</p>
  </div>
);

const datetimeLocalValue = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const toDisplayDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
};

const BodiesOfWaterDetails = () => {
  const { bodyOfWaterId } = useParams();
  const authContext = useContext(Context);
  const { recentlySelectedCompany } = authContext;
  const { can, requirePermission } = useCompanyPermissions();

  const [bodyOfWater, setBodyOfWater] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [waterHistory, setWaterHistory] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [manualHistory, setManualHistory] = useState({
    type: WATER_HISTORY_TYPES.FILL,
    date: datetimeLocalValue(),
    gallons: "",
    performedBy: "",
    description: "",
  });
  const [savingHistory, setSavingHistory] = useState(false);

  // Model fields state for editing
  const [name, setName] = useState("");
  const [gallons, setGallons] = useState("");
  const [material, setMaterial] = useState("");
  const [notes, setNotes] = useState("");

  const loadWaterHistory = useCallback(async () => {
    const history = await fetchBodyOfWaterHistory({
      db,
      companyId: recentlySelectedCompany,
      bodyOfWaterId,
    });
    setWaterHistory(history);
  }, [bodyOfWaterId, recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany || !bodyOfWaterId) return;

    const fetchBodyOfWater = async () => {
      setLoading(true);
      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "bodiesOfWater", bodyOfWaterId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const bowData = BodyOfWater.fromFirestore(docSnap);
          setBodyOfWater(bowData);

          await loadWaterHistory();

          const equipmentQuery = query(
            collection(db, "companies", recentlySelectedCompany, "equipment"),
            where("bodyOfWaterId", "==", bodyOfWaterId)
          );
          const equipmentSnap = await getDocs(equipmentQuery);
          setEquipment(equipmentSnap.docs.map((equipmentDoc) => ({
            id: equipmentDoc.id,
            ...equipmentDoc.data(),
          })));

          setName(bowData.name || "");
          setGallons(bowData.gallons || "");
          setMaterial(bowData.material || "");
          setNotes(bowData.notes || "");
        } else {
          setError("Body of Water not found.");
        }
      } catch (err) {
        console.error(err);
        setError("Failed to fetch body of water data.");
      } finally {
        setLoading(false);
      }
    };

    fetchBodyOfWater();
  }, [bodyOfWaterId, loadWaterHistory, recentlySelectedCompany]);

  const handleCancel = () => {
    setEdit(false);
    if (bodyOfWater) {
      setName(bodyOfWater.name || "");
      setGallons(bodyOfWater.gallons || "");
      setMaterial(bodyOfWater.material || "");
      setNotes(bodyOfWater.notes || "");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!requirePermission("54", "update bodies of water")) return;

    const updatedData = {
      name,
      gallons,
      material,
      notes,
    };

    try {
      const docRef = doc(db, "companies", recentlySelectedCompany, "bodiesOfWater", bodyOfWaterId);
      await updateDoc(docRef, updatedData);
      setBodyOfWater((prev) => ({ ...prev, ...updatedData }));
      setEdit(false);
    } catch (err) {
      console.error("Error updating document: ", err);
      setError("Failed to save changes.");
    }
  };

  const handleManualHistoryChange = (event) => {
    const { name, value } = event.target;
    setManualHistory((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddManualHistory = async (event) => {
    event.preventDefault();
    if (!requirePermission("54", "update bodies of water")) return;
    if (!recentlySelectedCompany || !bodyOfWaterId || !bodyOfWater) return;

    setSavingHistory(true);
    try {
      const historyDate = manualHistory.date ? new Date(manualHistory.date) : new Date();
      const historyId = `manual_bow_hist_${uuidv4()}`;
      const history = {
        id: historyId,
        type: manualHistory.type,
        date: historyDate,
        description: manualHistory.description,
        addedBy: "Manual",
        performedBy: manualHistory.performedBy,
        techName: authContext.name || "",
        gallons: manualHistory.gallons || bodyOfWater.gallons || "",
      };

      const bodyOfWaterRef = doc(db, "companies", recentlySelectedCompany, "bodiesOfWater", bodyOfWaterId);
      await setDoc(doc(bodyOfWaterRef, "waterHistory", historyId), history, { merge: true });

      if (manualHistory.type === WATER_HISTORY_TYPES.FILL) {
        await updateDoc(bodyOfWaterRef, { lastFilled: historyDate });
        setBodyOfWater((prev) => ({ ...prev, lastFilled: historyDate }));
      }

      setWaterHistory((prev) => [history, ...prev].sort((a, b) => (
        toDisplayDate(b.date)?.getTime() - toDisplayDate(a.date)?.getTime()
      )));
      setManualHistory({
        type: WATER_HISTORY_TYPES.FILL,
        date: datetimeLocalValue(),
        gallons: "",
        performedBy: "",
        description: "",
      });
      toast.success("Water history added.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to add water history.");
    } finally {
      setSavingHistory(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="w-full">
          <div className="bg-white shadow-lg rounded-xl p-6 text-gray-600">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="w-full">
          <div className="bg-white shadow-lg rounded-xl p-6 text-red-600">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!bodyOfWater) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="w-full">
          <div className="bg-white shadow-lg rounded-xl p-6 text-gray-600">No Body of Water found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="w-full space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>

            <Link 
            to={`/company/customers/details/${bodyOfWater.customerId}/locations`}
            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >&larr; Back to Customer View</Link>
            <h2 className="text-3xl font-bold text-gray-800">Body of Water</h2>
            <p className="text-gray-600 mt-1">
              <span className="font-semibold text-gray-800">{bodyOfWater.name || "—"}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!edit ? (
              can("54") && (
              <button
                onClick={() => setEdit(true)}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                type="button"
              >
                Edit
              </button>
              )
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
                  onClick={handleCancel}
                  className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                  type="button"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          {!edit ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoCard label="Name" value={bodyOfWater.name} />
                <InfoCard label="Gallons" value={bodyOfWater.gallons} />
                <InfoCard label="Material" value={bodyOfWater.material} />
                <InfoCard
                  label="Last Filled"
                  value={bodyOfWater.lastFilled ? format(bodyOfWater.lastFilled, "MMM d, yyyy") : "—"}
                />
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</p>
                <p className="mt-2 text-gray-700 whitespace-pre-wrap">{bodyOfWater.notes || "—"}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <h3 className="text-xl font-bold text-gray-800">Edit Body of Water</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputBase}
                  />
                </Field>

                <Field label="Gallons">
                  <input
                    type="text"
                    value={gallons}
                    onChange={(e) => setGallons(e.target.value)}
                    className={inputBase}
                  />
                </Field>

                <Field label="Material">
                  <input
                    type="text"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    className={inputBase}
                  />
                </Field>

                <div className="md:col-span-2">
                  <Field label="Notes">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className={inputBase}
                      rows={4}
                    />
                  </Field>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-800">Equipment</h3>
              <p className="text-sm text-gray-500">Equipment assigned to this body of water.</p>
            </div>

            <Link
              to={`/company/equipment/createNew/${bodyOfWater.customerId}/${bodyOfWater.serviceLocationId}/${bodyOfWater.id}`}
              className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
            >
              Add Equipment
            </Link>
          </div>

          {equipment.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-gray-500">
              No equipment assigned yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {equipment.map((item) => (
                <Link
                  key={item.id}
                  to={`/company/equipment/detail/${item.id}`}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-4 hover:border-blue-200 hover:bg-white transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{item.name || "Unnamed Equipment"}</p>
                      <p className="text-sm text-gray-500">{item.type || "Unknown Type"}</p>
                    </div>
                    <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600">
                      {item.status || "Unknown"}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <InfoCard label="Make" value={item.make || "—"} />
                    <InfoCard label="Model" value={item.model || "—"} />
                    <InfoCard label="Pressure" value={`${item.currentPressure ?? "—"} PSI`} />
                    <InfoCard label="Last Service" value={toDisplayDate(item.lastServiceDate) ? format(toDisplayDate(item.lastServiceDate), "MMM d, yyyy") : "—"} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-800">Water History</h3>
              <p className="text-sm text-gray-500">Fill and drain events from tasks or manual entries.</p>
            </div>
          </div>

          <form onSubmit={handleAddManualHistory} className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <Field label="Event">
                <select name="type" value={manualHistory.type} onChange={handleManualHistoryChange} className={inputBase}>
                  <option value={WATER_HISTORY_TYPES.FILL}>Fill</option>
                  <option value={WATER_HISTORY_TYPES.EMPTY}>Drain</option>
                </select>
              </Field>

              <Field label="Date">
                <input type="datetime-local" name="date" value={manualHistory.date} onChange={handleManualHistoryChange} className={inputBase} />
              </Field>

              <Field label="Gallons">
                <input name="gallons" value={manualHistory.gallons} onChange={handleManualHistoryChange} className={inputBase} placeholder={bodyOfWater.gallons || "Optional"} />
              </Field>

              <Field label="Performed By">
                <input name="performedBy" value={manualHistory.performedBy} onChange={handleManualHistoryChange} className={inputBase} placeholder="Company, contractor, customer" />
              </Field>

              <div className="flex items-end">
                <button disabled={savingHistory} className="w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition disabled:opacity-60" type="submit">
                  {savingHistory ? "Adding..." : "Add"}
                </button>
              </div>

              <div className="md:col-span-5">
                <Field label="Notes">
                  <textarea name="description" value={manualHistory.description} onChange={handleManualHistoryChange} className={inputBase} rows={2} />
                </Field>
              </div>
            </div>
          </form>

          {waterHistory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-gray-500">
              No fill or empty history yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {waterHistory.map((item) => (
                <div key={item.id} className="py-4 flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">{item.type}</p>
                    <p className="text-sm text-gray-500">
                      {item.date ? format(item.date, "MMM d, yyyy h:mm a") : "—"}
                    </p>
                    {item.description && (
                      <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                    )}
                  </div>

                  <div className="text-sm text-gray-500 md:text-right">
                    <p>{item.techName || "No technician recorded"}</p>
                    {item.gallons && <p>{item.gallons} gallons</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BodiesOfWaterDetails;
