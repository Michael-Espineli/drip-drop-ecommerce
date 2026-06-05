
import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from 'react-router-dom';
import { doc, query, where, collection, getDocs, limit, updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const DetailItem = ({ label, value, children }) => (
    <div className="py-2">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {value ? <p className="font-semibold text-gray-800">{value}</p> : children}
    </div>
);

const DetailCard = ({ title, children }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4 pb-3 border-b border-gray-200">{title}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            {children}
        </div>
    </div>
);

const VEHICLE_TYPES = ["Car", "Truck", "Van"];

const emptyPersonalVehicle = {
    nickName: "",
    vehicalType: "Car",
    year: "",
    make: "",
    model: "",
    color: "",
    plate: "",
    miles: "",
};

const buildPersonalVehicleForm = (companyUser) => ({
    ...emptyPersonalVehicle,
    ...(companyUser?.personalVehicle || {}),
    miles: companyUser?.personalVehicle?.miles?.toString() || "",
});

const CompanyUserDetails = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const { companyUserId } = useParams(); // This should be the userId
    const navigate = useNavigate();

    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [allowPersonalVehicle, setAllowPersonalVehicle] = useState(false);
    const [personalVehicle, setPersonalVehicle] = useState(emptyPersonalVehicle);
    const [isSavingVehicleAccess, setIsSavingVehicleAccess] = useState(false);

    useEffect(() => {
        if (!recentlySelectedCompany || !companyUserId) return;

        const fetchUser = async () => {
            setIsLoading(true);
            try {
                // The ID from the URL is the userId, not the document ID in the companyUsers subcollection.
                // We need to query for the document where the `userId` field matches.
                const usersRef = collection(db, "companies", recentlySelectedCompany, 'companyUsers');
                const q = query(usersRef, where("userId", "==", companyUserId), limit(1));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const userDoc = querySnapshot.docs[0];
                    const fetchedUser = { id: userDoc.id, ...userDoc.data() };
                    setUser(fetchedUser);
                    setAllowPersonalVehicle(Boolean(fetchedUser.allowPersonalVehicle));
                    setPersonalVehicle(buildPersonalVehicleForm(fetchedUser));
                } else {
                    toast.error("User not found in this company.");
                    navigate('/company/companyUsers');
                }
            } catch (error) {
                console.error("Error fetching user details: ", error);
                toast.error("Failed to load user details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchUser();
    }, [recentlySelectedCompany, companyUserId, navigate]);

    const getStatusClass = (status) => {
        switch (status) {
            case 'Active': return 'bg-green-100 text-green-800';
            case 'Pending': return 'bg-yellow-100 text-yellow-800';
            case 'Inactive': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const updatePersonalVehicleField = (field, value) => {
        setPersonalVehicle((current) => ({ ...current, [field]: value }));
    };

    const handleSaveVehicleAccess = async () => {
        if (!requirePermission("264", "update company users")) return;
        if (!recentlySelectedCompany || !user?.id) return;

        setIsSavingVehicleAccess(true);
        try {
            const payload = {
                allowPersonalVehicle,
                personalVehicle: {
                    nickName: personalVehicle.nickName.trim(),
                    vehicalType: personalVehicle.vehicalType || "Car",
                    year: personalVehicle.year.trim(),
                    make: personalVehicle.make.trim(),
                    model: personalVehicle.model.trim(),
                    color: personalVehicle.color.trim(),
                    plate: personalVehicle.plate.trim().toUpperCase(),
                    miles: Number(personalVehicle.miles || 0),
                },
            };

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyUsers", user.id), payload);

            setUser((current) => ({
                ...current,
                ...payload,
            }));
            toast.success("Vehicle access updated.");
        } catch (error) {
            console.error("Error updating vehicle access:", error);
            toast.error("Failed to update vehicle access.");
        } finally {
            setIsSavingVehicleAccess(false);
        }
    };

    if (isLoading) {
        return <div className="flex justify-center items-center h-screen"><p className="text-gray-500">Loading user details...</p></div>;
    }

    if (!user) {
        return null; // Or a dedicated "Not Found" component
    }

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">{user.userName}</h1>
                        <p className="text-gray-600 mt-1">Company user profile and details.</p>
                    </div>
                    <div className="flex space-x-3 mt-4 sm:mt-0">
                        <button onClick={() => navigate('/company/companyUsers')} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Back to List</button>
                        {/* <button className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition'>Edit User</button> */}
                    </div>
                </header>

                <div className="space-y-8">
                    <DetailCard title="User Information">
                        <DetailItem label="Full Name" value={user.userName} />
                        <DetailItem label="Worker Type" value={user.workerType} />
                        <DetailItem label="Date Created">
                            <p className="font-semibold text-gray-800">
                                {user.dateCreated ? format(user.dateCreated.toDate(), 'PPP') : 'N/A'}
                            </p>
                        </DetailItem>
                    </DetailCard>

                    <DetailCard title="Role & Status">
                        <DetailItem label="Role" value={user.roleName} />
                        <DetailItem label="Status">
                            <span className={`text-sm font-bold px-3 py-1 rounded-full ${getStatusClass(user.status)}`}>
                                {user.status}
                            </span>
                        </DetailItem>
                    </DetailCard>

                    {user.workerType === 'Sub-Contractor' && (
                        <DetailCard title="Linked Company">
                            <DetailItem label="Company Name" value={user.linkedCompanyName} />
                            <DetailItem label="Company Reference" value={user.linkedCompanyName || (user.linkedCompanyId ? "Linked company" : "")} />
                        </DetailCard>
                    )}

                    <section className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
                        <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">Route Vehicle Access</h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    Permit this technician to use a personal vehicle when starting or managing active routes.
                                </p>
                            </div>
                            {can("264") && (
                            <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={allowPersonalVehicle}
                                    onChange={(event) => setAllowPersonalVehicle(event.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                Allow personal vehicle
                            </label>
                            )}
                        </div>

                        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Nickname</span>
                                <input
                                    value={personalVehicle.nickName}
                                    onChange={(event) => updatePersonalVehicleField("nickName", event.target.value)}
                                    readOnly={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    placeholder="Mike's truck"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Type</span>
                                <select
                                    value={personalVehicle.vehicalType}
                                    onChange={(event) => updatePersonalVehicleField("vehicalType", event.target.value)}
                                    disabled={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                >
                                    {VEHICLE_TYPES.map((type) => (
                                        <option key={type} value={type}>{type}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Year</span>
                                <input
                                    value={personalVehicle.year}
                                    onChange={(event) => updatePersonalVehicleField("year", event.target.value)}
                                    readOnly={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    placeholder="2021"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Make</span>
                                <input
                                    value={personalVehicle.make}
                                    onChange={(event) => updatePersonalVehicleField("make", event.target.value)}
                                    readOnly={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    placeholder="Toyota"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Model</span>
                                <input
                                    value={personalVehicle.model}
                                    onChange={(event) => updatePersonalVehicleField("model", event.target.value)}
                                    readOnly={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    placeholder="Tacoma"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Color</span>
                                <input
                                    value={personalVehicle.color}
                                    onChange={(event) => updatePersonalVehicleField("color", event.target.value)}
                                    readOnly={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    placeholder="White"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Plate</span>
                                <input
                                    value={personalVehicle.plate}
                                    onChange={(event) => updatePersonalVehicleField("plate", event.target.value)}
                                    readOnly={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase focus:border-blue-500 focus:outline-none"
                                    placeholder="ABC123"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-gray-700">Current Miles</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={personalVehicle.miles}
                                    onChange={(event) => updatePersonalVehicleField("miles", event.target.value)}
                                    readOnly={!can("264")}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    placeholder="0"
                                />
                            </label>
                        </div>

                        {can("264") && (
                        <div className="mt-5 flex justify-end">
                            <button
                                type="button"
                                onClick={handleSaveVehicleAccess}
                                disabled={isSavingVehicleAccess}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSavingVehicleAccess ? "Saving..." : "Save Vehicle Access"}
                            </button>
                        </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

export default CompanyUserDetails;
