import React, { useState, useEffect, useContext } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import { db } from "../../../utils/config";
import { collection, getDocs, query, where, orderBy, setDoc, doc, getDoc } from "firebase/firestore";
import { RepairRequest } from "../../../utils/models/RepairRequest";
import { Context } from "../../../context/AuthContext";
import Select from "react-select";
import { v4 as uuidv4 } from "uuid";

const CreateNewRepairRequest = () => {
  const { recentlySelectedCompany, user } = useContext(Context);
  const navigate = useNavigate();

  const { customerId: customerIdParam, locationId: locationIdParam } = useParams();

  const [customers, setCustomers] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [bodiesOfWater, setBodiesOfWater] = useState([]);
  const [equipmentOptions, setEquipmentOptions] = useState([]);

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedBodyOfWater, setSelectedBodyOfWater] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(null);

  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState([]);

  // -----------------------------
  // Load customers if no param
  // -----------------------------
  useEffect(() => {
    const fetchCustomers = async () => {
      if (!recentlySelectedCompany || customerIdParam) return;

      try {
        const q = query(
          collection(db, "companies", recentlySelectedCompany, "customers"),
          orderBy("firstName")
        );
        const snapshot = await getDocs(q);

        const customerList = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            value: doc.id,
            label:
              data.displayAsCompany && data.companyName
                ? data.companyName
                : `${data.firstName || ""} ${data.lastName || ""}`.trim(),
            ...data,
          };
        });

        setCustomers(customerList);
      } catch (error) {
        console.error("Error fetching customers:", error);
      }
    };

    fetchCustomers();
  }, [recentlySelectedCompany, customerIdParam]);

  // -----------------------------
  // Load param-based customer/location
  // -----------------------------
  useEffect(() => {
    const loadParamData = async () => {
      if (!recentlySelectedCompany) return;

      try {
        if (customerIdParam) {
          const custRef = doc(db, "companies", recentlySelectedCompany, "customers", customerIdParam);
          const custSnap = await getDoc(custRef);

          if (custSnap.exists()) {
            const data = custSnap.data();
            setSelectedCustomer({
              value: custSnap.id,
              label:
                data.displayAsCompany && data.companyName
                  ? data.companyName
                  : `${data.firstName || ""} ${data.lastName || ""}`.trim(),
              ...data,
            });
          }
        }

        if (locationIdParam) {
          const locRef = doc(db, "companies", recentlySelectedCompany, "serviceLocations", locationIdParam);
          const locSnap = await getDoc(locRef);

          if (locSnap.exists()) {
            const data = locSnap.data();
            setSelectedLocation({
              value: locSnap.id,
              label: data.address?.streetAddress || "Service Location",
              ...data,
            });
          }
        }
      } catch (error) {
        console.error("Error loading param data:", error);
      }
    };

    loadParamData();
  }, [customerIdParam, locationIdParam, recentlySelectedCompany]);

  // -----------------------------
  // Load service locations from selected customer
  // -----------------------------
  useEffect(() => {
    const fetchLocations = async () => {
      if (!recentlySelectedCompany || !selectedCustomer || locationIdParam) return;

      try {
        const q = query(
          collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
          where("customerId", "==", selectedCustomer.value)
        );

        const snapshot = await getDocs(q);

        const locationList = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            value: doc.id,
            label: data.nickName || data.address?.streetAddress || "Service Location",
            ...data,
          };
        });

        setServiceLocations(locationList);

        if (locationList.length > 0) {
          setSelectedLocation(locationList[0]);
        } else {
          setSelectedLocation(null);
        }
      } catch (error) {
        console.error("Error fetching service locations:", error);
      }
    };

    fetchLocations();
  }, [selectedCustomer, recentlySelectedCompany, locationIdParam]);

  // -----------------------------
  // If location is locked by param, still load list for display consistency
  // -----------------------------
  useEffect(() => {
    const fetchLocationsForCustomer = async () => {
      if (!recentlySelectedCompany || !selectedCustomer || !locationIdParam) return;

      try {
        const q = query(
          collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
          where("customerId", "==", selectedCustomer.value)
        );

        const snapshot = await getDocs(q);

        const locationList = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            value: doc.id,
            label: data.nickName || data.address?.streetAddress || "Service Location",
            ...data,
          };
        });

        setServiceLocations(locationList);
      } catch (error) {
        console.error("Error fetching service locations:", error);
      }
    };

    fetchLocationsForCustomer();
  }, [selectedCustomer, recentlySelectedCompany, locationIdParam]);

  // -----------------------------
  // Load bodies of water + equipment from selected location
  // -----------------------------
  useEffect(() => {
    const fetchLocationRelatedOptions = async () => {
      if (!recentlySelectedCompany || !selectedLocation) {
        setBodiesOfWater([]);
        setEquipmentOptions([]);
        setSelectedBodyOfWater(null);
        setSelectedEquipment(null);
        return;
      }

      try {
        const bowQuery = query(
          collection(db, "companies", recentlySelectedCompany, "bodiesOfWater"),
          where("serviceLocationId", "==", selectedLocation.value)
        );

        const equipmentQuery = query(
          collection(db, "companies", recentlySelectedCompany, "equipment"),
          where("serviceLocationId", "==", selectedLocation.value)
        );

        const [bowSnapshot, equipmentSnapshot] = await Promise.all([
          getDocs(bowQuery),
          getDocs(equipmentQuery),
        ]);

        const bowList = bowSnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            value: doc.id,
            label: data.name || data.nickName || `Body Of Water ${doc.id}`,
            ...data,
          };
        });

        const equipmentList = equipmentSnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            value: doc.id,
            label: data.name
              ? `${data.name}${data.model ? ` - ${data.model}` : ""}`
              : data.model || `Equipment ${doc.id}`,
            ...data,
          };
        });

        setBodiesOfWater(bowList);
        setEquipmentOptions(equipmentList);
        setSelectedBodyOfWater(null);
        setSelectedEquipment(null);
      } catch (error) {
        console.error("Error fetching bodies of water / equipment:", error);
      }
    };

    fetchLocationRelatedOptions();
  }, [selectedLocation, recentlySelectedCompany]);

  const handlePhotoChange = (e) => {
    if (e.target.files) {
      setPhotos([...e.target.files]);
    }
  };

  const handleCustomerChange = (customer) => {
    setSelectedCustomer(customer);
    setSelectedLocation(null);
    setBodiesOfWater([]);
    setEquipmentOptions([]);
    setSelectedBodyOfWater(null);
    setSelectedEquipment(null);
  };

  const handleLocationChange = (location) => {
    setSelectedLocation(location);
    setSelectedBodyOfWater(null);
    setSelectedEquipment(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedCustomer || !description.trim()) {
      alert("Please select a customer and provide a description.");
      return;
    }

    try {
      const repairRequestId = "com_rep_req_" + uuidv4();

      // Placeholder until photo upload is implemented
      const photoUrls = [];

      const newRepairRequest = new RepairRequest({
        id: repairRequestId,
        customerId: selectedCustomer.value,
        customerName: selectedCustomer.label,
        requesterId: user?.uid || "",
        requesterName: user?.userName || user?.email || "",
        description: description.trim(),
        locationId: selectedLocation ? selectedLocation.value : "",
        locationName: selectedLocation ? selectedLocation.label : "",
        bodyOfWaterId: selectedBodyOfWater ? selectedBodyOfWater.value : "",
        bodyOfWaterName: selectedBodyOfWater ? selectedBodyOfWater.label : "",
        equipmentId: selectedEquipment ? selectedEquipment.value : "",
        equipmentName: selectedEquipment ? selectedEquipment.label : "",
        photoUrls,
        status: "Pending",
        userId: "",
      });

      await setDoc(
        doc(db, "companies", recentlySelectedCompany, "repairRequests", repairRequestId),
        newRepairRequest.toFirestore()
      );

      navigate("/company/repair-requests");
    } catch (error) {
      console.error("Error creating repair request: ", error);
      alert("Failed to create repair request.");
    }
  };

  const selectStyles = {
    control: (provided) => ({
      ...provided,
      backgroundColor: "white",
      border: "1px solid #d1d5db",
      borderRadius: "0.75rem",
      minHeight: "44px",
      padding: "0.15rem",
      boxShadow: "none",
    }),
    menu: (provided) => ({
      ...provided,
      zIndex: 20,
      borderRadius: "0.75rem",
      overflow: "hidden",
    }),
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-screen-md mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold text-gray-800">Create Internal Repair Request</h2>
          <Link
            to={"/company/repair-requests"}
            className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
          >
            Cancel
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="bg-white shadow-lg rounded-xl p-8 space-y-6">
          {/* Section 1: Customer + Location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-b pb-6">
            <h3 className="text-lg font-semibold text-gray-700 md:col-span-2">Owner Details</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <Select
                options={customers}
                value={selectedCustomer}
                onChange={handleCustomerChange}
                placeholder="Select a customer..."
                isClearable={!customerIdParam}
                isDisabled={!!customerIdParam}
                styles={selectStyles}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Service Location (Optional)
              </label>
              <Select
                options={serviceLocations}
                value={selectedLocation}
                onChange={handleLocationChange}
                placeholder="Select a location..."
                isClearable={!locationIdParam}
                isDisabled={!selectedCustomer || !!locationIdParam}
                styles={selectStyles}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Body Of Water (Optional)
              </label>
              <Select
                options={bodiesOfWater}
                value={selectedBodyOfWater}
                onChange={setSelectedBodyOfWater}
                placeholder="Select a body of water..."
                isClearable
                isDisabled={!selectedLocation}
                styles={selectStyles}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Equipment (Optional)
              </label>
              <Select
                options={equipmentOptions}
                value={selectedEquipment}
                onChange={setSelectedEquipment}
                placeholder="Select equipment..."
                isClearable
                isDisabled={!selectedLocation}
                styles={selectStyles}
              />
            </div>
          </div>

          {/* Section 2: Request Details */}
          <div className="grid grid-cols-1 gap-6 border-b pb-6">
            <h3 className="text-lg font-semibold text-gray-700">Request Details</h3>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                rows="5"
                placeholder="Describe the issue in detail..."
              />
            </div>
          </div>

          {/* Section 3: Photos */}
          <div className="grid grid-cols-1 gap-6">
            <h3 className="text-lg font-semibold text-gray-700">Attachments</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Attach Photos</label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-xl bg-gray-50">
                <div className="space-y-1 text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>

                  <div className="flex text-sm text-gray-600 justify-center">
                    <label
                      htmlFor="file-upload"
                      className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none"
                    >
                      <span>Upload files</span>
                      <input
                        id="file-upload"
                        name="file-upload"
                        type="file"
                        className="sr-only"
                        onChange={handlePhotoChange}
                        multiple
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>

                  <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>

                  {photos.length > 0 && (
                    <p className="text-xs text-gray-600 pt-2">
                      {photos.length} file{photos.length > 1 ? "s" : ""} selected
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              className="py-2 px-6 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition"
            >
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateNewRepairRequest;