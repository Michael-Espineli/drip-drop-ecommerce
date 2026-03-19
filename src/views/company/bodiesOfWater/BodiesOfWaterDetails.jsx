import React, { useState, useEffect, useContext } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../../../utils/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { BodyOfWater } from "../../../utils/models/BodyOfWater";

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

const BodiesOfWaterDetails = () => {
  const { bodyOfWaterId } = useParams();
  const { recentlySelectedCompany } = useContext(Context);

  const [bodyOfWater, setBodyOfWater] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);

  // Model fields state for editing
  const [name, setName] = useState("");
  const [gallons, setGallons] = useState("");
  const [material, setMaterial] = useState("");
  const [notes, setNotes] = useState("");

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
  }, [bodyOfWaterId, recentlySelectedCompany]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-6 text-gray-600">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-6 text-red-600">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!bodyOfWater) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-6 text-gray-600">No Body of Water found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
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
              <button
                onClick={() => setEdit(true)}
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
      </div>
    </div>
  );
};

export default BodiesOfWaterDetails;