import React, { useState, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from "uuid";

const CreateNewVenders = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(false);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");

    const [billingAddressStreetAddress, setBillingAddressStreetAddress] = useState("");
    const [billingAddressCity, setBillingAddressCity] = useState("");
    const [billingAddressState, setBillingAddressState] = useState("");
    const [billingAddressZip, setBillingAddressZip] = useState("");

    const [billingNotes, setBillingNotes] = useState("");

    async function createNewVender(e) {
        e.preventDefault();

        if (!name.trim()) {
            alert("Please enter a vendor name.");
            return;
        }

        if (!recentlySelectedCompany) {
            alert("No company selected.");
            return;
        }

        try {
            setIsLoading(true);

            const venderId = `com_ven_${uuidv4()}`;

            const vender = {
                id: venderId,
                name: name.trim(),
                email: email.trim() || "",
                phoneNumber: phoneNumber.trim() || "",
                address: {
                    streetAddress: billingAddressStreetAddress.trim() || "",
                    city: billingAddressCity.trim() || "",
                    state: billingAddressState.trim() || "",
                    zip: billingAddressZip.trim() || "",
                },
                billingNotes: billingNotes.trim() || "",
                dateCreated: new Date(),
            };

            await setDoc(
                doc(db, "companies", recentlySelectedCompany, "settings", "vendors", "vendor", venderId),
                vender
            );

            navigate("/company/settings/vendors");
        } catch (error) {
            console.error("Error creating vender:", error);
            alert("Failed to create vendor. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-lg mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-3xl font-bold text-gray-800">Create New Vendor</h2>
                    <Link
                        to="/company/settings/venders"
                        className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                    >
                        Back
                    </Link>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Vendor Details</h3>

                            <form onSubmit={createNewVender} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Vendor Name
                                        </label>
                                        <input
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            type="text"
                                            placeholder="Vendor Name"
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Email
                                        </label>
                                        <input
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            type="email"
                                            placeholder="vendor@email.com"
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Phone Number
                                        </label>
                                        <input
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            type="text"
                                            placeholder="(555) 555-5555"
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <h4 className="text-lg font-bold text-gray-800 mb-3">Address</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                Street Address
                                            </label>
                                            <input
                                                value={billingAddressStreetAddress}
                                                onChange={(e) => setBillingAddressStreetAddress(e.target.value)}
                                                type="text"
                                                placeholder="123 Main St"
                                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                City
                                            </label>
                                            <input
                                                value={billingAddressCity}
                                                onChange={(e) => setBillingAddressCity(e.target.value)}
                                                type="text"
                                                placeholder="City"
                                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                State
                                            </label>
                                            <input
                                                value={billingAddressState}
                                                onChange={(e) => setBillingAddressState(e.target.value)}
                                                type="text"
                                                placeholder="State"
                                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                ZIP
                                            </label>
                                            <input
                                                value={billingAddressZip}
                                                onChange={(e) => setBillingAddressZip(e.target.value)}
                                                type="text"
                                                placeholder="ZIP Code"
                                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Notes
                                    </label>
                                    <textarea
                                        value={billingNotes}
                                        onChange={(e) => setBillingNotes(e.target.value)}
                                        placeholder="Notes, billing details, account info, etc."
                                        rows={4}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition disabled:opacity-50"
                                >
                                    {isLoading ? "Creating Vendor..." : "Create Vendor"}
                                </button>
                            </form>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Preview</h3>
                            <div className="space-y-3 text-gray-700">
                                <div className="flex justify-between gap-4">
                                    <span className="font-medium">Name:</span>
                                    <span className="text-right">{name || "—"}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="font-medium">Email:</span>
                                    <span className="text-right break-all">{email || "—"}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="font-medium">Phone:</span>
                                    <span className="text-right">{phoneNumber || "—"}</span>
                                </div>

                                <div className="border-t pt-3">
                                    <p className="font-medium mb-2">Address</p>
                                    <div className="text-sm text-gray-600 space-y-1">
                                        <p>{billingAddressStreetAddress || "—"}</p>
                                        <p>
                                            {[billingAddressCity, billingAddressState, billingAddressZip]
                                                .filter(Boolean)
                                                .join(", ") || "—"}
                                        </p>
                                    </div>
                                </div>

                                <div className="border-t pt-3">
                                    <p className="font-medium mb-2">Notes</p>
                                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                                        {billingNotes || "—"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {isLoading && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        Creating vendor...
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreateNewVenders;