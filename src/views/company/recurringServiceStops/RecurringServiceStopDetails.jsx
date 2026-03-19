import React, { useState, useEffect, useContext, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  query,
  collection,
  getDocs,
  limit,
  where,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from "react-select";
import { format } from "date-fns";
import toast from "react-hot-toast";

const RecurringServiceStopDetails = () => {
    
  const { recentlySelectedCompany } = useContext(Context);
  const { recurringServiceStopId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [serviceStopList, setServiceStopList] = useState([]);
  const [pastServiceStopList, setPastServiceStopList] = useState([]);

  const [recurringServiceStop, setRecurringServiceStop] = useState({
    id: "",
    internalId: "",
    type: "",
    typeId: "",
    typeImage: "",
    customerId: "",
    customerName: "",

    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    latitude: "",
    longitude: "",

    tech: "",
    techId: "",
    dateCreated: "",
    startDate: "",
    endDate: "",
    noEndDate: "",
    frequency: "",
    daysOfWeek: "",
    lastCreated: "",

    serviceLocationId: "",
    estimatedTime: "",
    otherCompany: "",
    laborContractId: "",
    contractedCompanyId: "",
  });

  const frequencyOptions = useMemo(
    () =>
      ["Weekly", "Biweekly", "Monthly", "Every 2 Weeks", "Every 4 Weeks", "Custom"].map((v) => ({
        value: v,
        label: v,
      })),
    []
  );

  const daysOptions = useMemo(
    () =>
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => ({
        value: d,
        label: d,
      })),
    []
  );

  const [selectedFrequency, setSelectedFrequency] = useState(null);
  const [selectedDays, setSelectedDays] = useState([]);

  // Match Jobs input/select styling
  const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 12,
    colors: {
      ...theme.colors,
      primary25: "#EFF6FF", // blue-50
      primary: "#2563EB", // blue-600
      neutral0: "#FFFFFF",
      neutral20: "#D1D5DB", // gray-300
      neutral30: "#9CA3AF", // gray-400
    },
  });

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      minHeight: 44,
      borderRadius: 12,
      borderColor: state.isFocused ? "#2563EB" : "#D1D5DB",
      boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.25)" : "none",
      "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#9CA3AF" },
    }),
    menu: (base) => ({ ...base, borderRadius: 12, overflow: "hidden" }),
  };

  useEffect(() => {
    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    (async () => {
      try {
        setLoading(true);

        const docRef = doc(
          db,
          "companies",
          recentlySelectedCompany,
          "recurringServiceStop",
          recurringServiceStopId
        );
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          toast.error("Recurring service stop not found");
          setLoading(false);
          return;
        }
        const rssData = docSnap.data();
        setRecurringServiceStop((prev) => ({
          ...prev,
          id: rssData.id,
          internalId: rssData.internalId,
          type: rssData.type,
          typeId: rssData.typeId,
          typeImage: rssData.typeImage,
          customerId: rssData.customerId,
          customerName: rssData.customerName,

          streetAddress: rssData.address?.streetAddress || "",
          city: rssData.address?.city || "",
          state: rssData.address?.state || "",
          zip: rssData.address?.zip || "",
          latitude: rssData.address?.latitude || "",
          longitude: rssData.address?.longitude || "",

          tech: rssData.tech,
          techId: rssData.techId,
          dateCreated: rssData.dateCreated,
          startDate: rssData.startDate,
          endDate: rssData.endDate,
          noEndDate: rssData.noEndDate,
          frequency: rssData.frequency,
          day: rssData.day,
          lastCreated: rssData.lastCreated,

          serviceLocationId: rssData.serviceLocationId,
          estimatedTime: rssData.estimatedTime,
          otherCompany: rssData.otherCompany,
          laborContractId: rssData.laborContractId,
          contractedCompanyId: rssData.contractedCompanyId,
        }));

        const start = rssData.startDate?.toDate?.()
          ? format(rssData.startDate.toDate(), "MMMM d, yyyy")
          : "";
        const end = rssData.endDate?.toDate?.()
          ? format(rssData.endDate.toDate(), "MMMM d, yyyy")
          : "";
        setStartDate(start);
        setEndDate(end);

        const freq = rssData.frequency ? { value: rssData.frequency, label: rssData.frequency } : null;
        setSelectedFrequency(freq);

        const daysRaw = rssData.daysOfWeek;
        const daysArr = Array.isArray(daysRaw)
          ? daysRaw
          : typeof daysRaw === "string"
          ? daysRaw.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        setSelectedDays(daysArr.map((d) => ({ value: d, label: d })));

        // Upcoming
        const qUpcoming = query(
          collection(db, "companies", recentlySelectedCompany, "serviceStops"),
          where("recurringServiceStopId", "==", recurringServiceStopId),
          where("serviceDate", ">=", new Date()),
          limit(5)
        );

        const upSnap = await getDocs(qUpcoming);
        setServiceStopList(
          upSnap.docs.map((d) => {
            const data = d.data();
            const date = data.serviceDate?.toDate?.()
              ? format(data.serviceDate.toDate(), "MMMM d, yyyy")
              : "N/A";
            return {
              id: data.id,
              tech: data.tech,
              customerName: data.customerName,
              streetAddress: data.address?.streetAddress || "",
              jobId: data.jobId,
              internalId: data.internalId,
              operationStatus: data.operationStatus || "",
              date,
            };
          })
        );

        // Past
        const qPast = query(
          collection(db, "companies", recentlySelectedCompany, "serviceStops"),
          where("recurringServiceStopId", "==", recurringServiceStopId),
          where("serviceDate", "<", new Date()),
          limit(5)
        );
        const pastSnap = await getDocs(qPast);
        setPastServiceStopList(
          pastSnap.docs.map((d) => {
            const data = d.data();
            const date = data.serviceDate?.toDate?.()
              ? format(data.serviceDate.toDate(), "MMMM d, yyyy")
              : "N/A";
            return {
              id: data.id,
              tech: data.tech,
              customerName: data.customerName,
              streetAddress: data.address?.streetAddress || "",
              jobId: data.jobId,
              operationStatus: data.operationStatus || "",
              date,
            };
          })
        );
      } catch (error) {
        console.error(error);
        toast.error("Failed to load recurring service stop");
      } finally {
        setLoading(false);
      }
    })();
  }, [recentlySelectedCompany, recurringServiceStopId]);

  const deleteRSS = async (e) => {
    e.preventDefault();
    try {
      const ok = window.confirm("Delete this recurring service stop? This cannot be undone.");
      if (!ok) return;

      await deleteDoc(
        doc(db, "companies", recentlySelectedCompany, "recurringServiceStop", recurringServiceStopId)
      );
      //Delete Service Stops // Maybe delete future service stops now.
      const bowQ = query(collection(db, 'companies', recentlySelectedCompany, 'serviceStops'), where("recurringServiceStopId", "==", recurringServiceStopId));
        const bowSnap = await getDocs(bowQ);
          for (const bowDoc of bowSnap.docs) {
            await deleteDoc(bowDoc.ref);
        }
      
      toast.success("Deleted");
      navigate("/company/recurringServiceStop");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete");
    }
  };

  const editRSS = (e) => {
    e.preventDefault();
    setEdit(true);
  };

  const cancelEdit = (e) => {
    e.preventDefault();
    setEdit(false);

    setSelectedFrequency(
      recurringServiceStop.frequency ? { value: recurringServiceStop.frequency, label: recurringServiceStop.frequency } : null
    );

    const daysRaw = recurringServiceStop.daysOfWeek;
    const daysArr = Array.isArray(daysRaw)
      ? daysRaw
      : typeof daysRaw === "string"
      ? daysRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    setSelectedDays(daysArr.map((d) => ({ value: d, label: d })));
  };

  const saveEdits = async (e) => {
    e.preventDefault();
    try {
      const rssRef = doc(db, "companies", recentlySelectedCompany, "recurringServiceStop", recurringServiceStopId);

      const frequency = selectedFrequency?.value || recurringServiceStop.frequency || "";
      const daysOfWeek = (selectedDays || []).map((d) => d.value).join(",");

      await updateDoc(rssRef, { frequency, daysOfWeek });

      setRecurringServiceStop((prev) => ({
        ...prev,
        frequency,
        daysOfWeek,
      }));

      toast.success("Saved");
      setEdit(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save changes");
    }
  };

  const openInMaps = () => {
    const address = `${recurringServiceStop.streetAddress} ${recurringServiceStop.city} ${recurringServiceStop.state} ${recurringServiceStop.zip}`.trim();
    const url = `https://www.google.com/maps/place/${encodeURIComponent(address)}`;
    window.open(url, "_blank");
  };

  const Field = ({ label, value, children }) => (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-gray-600">{label}</p>
      {children ? (
        children
      ) : (
        <p className="text-gray-800">{value || "—"}</p>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-screen-xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-40 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-screen-xl mx-auto space-y-6">
        {/* Top bar (same concept as your original: title + left/right actions) */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Recurring Service Stop Detail</h1>
            <p className="text-gray-600 mt-1">
              <span className="font-semibold text-gray-800">{recurringServiceStop.internalId || "—"}</span>{" "}
              <span className="text-gray-400">•</span>{" "}
              {recurringServiceStop.customerName || "—"}
            </p>
          </div>

          {!edit ? (
            <div className="flex items-center gap-2">
              <Link
                to="/company/recurringServiceStop"
                className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
              >
                Back
              </Link>
              <button
                onClick={editRSS}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition"
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdits}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
              >
                Save
              </button>
              <button
                onClick={cancelEdit}
                className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={deleteRSS}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
                >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Details card (was your dark blue block) */}
        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800">Details</h2>
              <p className="text-sm text-gray-600">Core recurring stop information</p>
            </div>

            <button
              onClick={openInMaps}
              className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
              title="Open in Google Maps"
            >
              Open in Maps
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <Field label="Internal Id" value={recurringServiceStop.internalId} />
            <Field label="Customer" value={recurringServiceStop.customerName} />
            <Field label="Street Address" value={recurringServiceStop.streetAddress} />
            <Field label="Tech" value={recurringServiceStop.tech} />
            <Field label="Start Date" value={startDate} />
            <Field label="End Date" value={recurringServiceStop.noEndDate ? "No End Date" : endDate} />

            <Field label="Frequency">
              {!edit ? (
                <p className="text-gray-800">{recurringServiceStop.frequency || "—"}</p>
              ) : (
                <Select
                  value={selectedFrequency}
                  options={frequencyOptions}
                  onChange={setSelectedFrequency}
                  isSearchable
                  placeholder="Select frequency"
                  theme={selectTheme}
                  styles={selectStyles}
                />
              )}
            </Field>

            <Field label="Day of Week">
              {!edit ? (
                <p className="text-gray-800">{recurringServiceStop.day || "—"}</p>
              ) : (
                <Select
                  value={selectedDays}
                  options={daysOptions}
                  onChange={setSelectedDays}
                  placeholder="Select days"
                  theme={selectTheme}
                  styles={selectStyles}
                />
              )}
            </Field>

            <Field label="Estimated Time" value={recurringServiceStop.estimatedTime} />
          </div>
        </div>

        {/* Upcoming Jobs */}
        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-800">Upcoming Service</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-gray-100">
                <tr>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Internal Id</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Tech</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Customer Name</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Street Address</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {serviceStopList?.map((serviceStop) => (
                  <tr key={serviceStop.id} className="hover:bg-gray-50 transition-colors"
                  onClick={() => navigate(`/company/serviceStops/detail/${serviceStop.id}`)} >
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.internalId}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.date}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.tech}</td>
                    <td className="p-4 whitespace-nowrap text-gray-800 font-medium">{serviceStop.customerName}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.streetAddress}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.operationStatus || "—"}</td>
                  </tr>
                ))}

                {!serviceStopList?.length && (
                  <tr>
                    <td colSpan={7} className="p-6 text-gray-500">
                      No upcoming jobs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Most Recent Jobs */}
        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-800">Most Recent Service</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-gray-100">
                <tr>
                <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Internal Id</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Tech</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Customer Name</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Street Address</th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {pastServiceStopList?.map((serviceStop) => (
                  <tr key={serviceStop.id} className="hover:bg-gray-50 transition-colors"
                  onClick={() => navigate(`/company/serviceStops/detail/${serviceStop.id}`)} >
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.internalId}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.date}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.tech}</td>
                    <td className="p-4 whitespace-nowrap text-gray-800 font-medium">{serviceStop.customerName}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.streetAddress}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.operationStatus || "—"}</td>
                  </tr>
                ))}
                {!pastServiceStopList?.length && (
                  <tr>
                    <td colSpan={7} className="p-6 text-gray-500">
                      No recent jobs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

export default RecurringServiceStopDetails;
