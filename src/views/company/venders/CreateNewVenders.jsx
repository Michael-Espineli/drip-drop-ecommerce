import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import toast from "react-hot-toast";
import {
    FaArrowLeft,
    FaEnvelope,
    FaMapMarkerAlt,
    FaPhone,
    FaSave,
    FaStickyNote,
    FaStore,
} from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import {
    fetchCompanyVendor,
    VENDOR_RECORDS_COLLECTION,
    VENDOR_SETTINGS_DOC,
} from "../../../utils/vendors";

const emptyForm = {
    name: "",
    email: "",
    phoneNumber: "",
    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    billingNotes: "",
};

const formatAddress = (form) => [
    form.streetAddress,
    form.city,
    form.state,
    form.zip,
].filter(Boolean).join(", ");

const fieldClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const InfoRow = ({ icon: Icon, label, value }) => (
    <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <Icon className="mt-0.5 shrink-0 text-slate-400" />
        <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 break-words font-semibold text-slate-900">{value || "Not set"}</p>
        </div>
    </div>
);

const CreateNewVendor = () => {
    const { vendorId } = useParams();
    const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
    const navigate = useNavigate();
    const isEditing = Boolean(vendorId);

    const [form, setForm] = useState(emptyForm);
    const [vendorSource, setVendorSource] = useState("canonical");
    const [loading, setLoading] = useState(isEditing);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;

        const loadVendor = async () => {
            if (!isEditing) {
                setLoading(false);
                return;
            }

            if (!recentlySelectedCompany || !vendorId) {
                setLoading(false);
                setError("Missing company or vendor id.");
                return;
            }

            try {
                setLoading(true);
                setError("");
                const vendor = await fetchCompanyVendor(db, recentlySelectedCompany, vendorId);

                if (!vendor) {
                    setError("Vendor not found.");
                    return;
                }

                if (!cancelled) {
                    setVendorSource(vendor.source || "canonical");
                    setForm({
                        name: vendor.name || "",
                        email: vendor.email || "",
                        phoneNumber: vendor.phoneNumber || "",
                        streetAddress: vendor.streetAddress || vendor.address?.streetAddress || "",
                        city: vendor.city || vendor.address?.city || "",
                        state: vendor.state || vendor.address?.state || "",
                        zip: vendor.zip || vendor.address?.zip || "",
                        billingNotes: vendor.billingNotes || "",
                    });
                }
            } catch (loadError) {
                console.error("Error loading vendor:", loadError);
                if (!cancelled) setError(loadError.message || "Unable to load vendor.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadVendor();

        return () => {
            cancelled = true;
        };
    }, [isEditing, recentlySelectedCompany, vendorId]);

    const updateField = (field, value) => {
        setForm((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const previewAddress = useMemo(() => formatAddress(form), [form]);

    async function saveVendor(event) {
        event.preventDefault();

        if (!form.name.trim()) {
            toast.error("Please enter a vendor name.");
            return;
        }

        if (!recentlySelectedCompany) {
            toast.error("No company selected.");
            return;
        }

        try {
            setSaving(true);
            const nextVendorId = vendorId || `com_ven_${uuidv4()}`;
            const vendor = {
                id: nextVendorId,
                name: form.name.trim(),
                email: form.email.trim(),
                phoneNumber: form.phoneNumber.trim(),
                address: {
                    streetAddress: form.streetAddress.trim(),
                    city: form.city.trim(),
                    state: form.state.trim(),
                    zip: form.zip.trim(),
                },
                billingNotes: form.billingNotes.trim(),
                updatedAt: serverTimestamp(),
                ...(isEditing ? {} : { dateCreated: serverTimestamp() }),
            };

            await setDoc(
                doc(db, "companies", recentlySelectedCompany, "settings", VENDOR_SETTINGS_DOC, VENDOR_RECORDS_COLLECTION, nextVendorId),
                vendor,
                { merge: true }
            );

            toast.success(isEditing ? "Vendor updated." : "Vendor created.");
            navigate(`/company/vendors/detail/${nextVendorId}`);
        } catch (saveError) {
            console.error("Error saving vendor:", saveError);
            toast.error(saveError.message || "Failed to save vendor.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                                {recentlySelectedCompanyName || "Selected company"}
                            </p>
                            <h1 className="mt-2 text-3xl font-bold text-slate-950">
                                {isEditing ? "Vendor Detail" : "New Vendor"}
                            </h1>
                            <p className="mt-2 text-sm text-slate-600">
                                Store vendor contact details, purchasing notes, billing info, and address records.
                            </p>
                        </div>
                        <Link
                            to="/company/vendors"
                            className="inline-flex w-fit items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                            <FaArrowLeft className="text-xs" />
                            Vendors
                        </Link>
                    </div>
                </section>

                {error && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                        Loading vendor...
                    </div>
                ) : (
                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                        <main className="rounded-lg border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-200 px-5 py-4">
                                <h2 className="text-lg font-bold text-slate-950">Vendor Information</h2>
                                {isEditing && vendorSource === "legacy" && (
                                    <p className="mt-1 text-sm text-amber-700">
                                        This record was loaded from the legacy vendor path. Saving writes it to the current vendor path.
                                    </p>
                                )}
                            </div>

                            <form onSubmit={saveVendor} className="space-y-6 p-5">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorName">
                                            Vendor Name
                                        </label>
                                        <input
                                            id="vendorName"
                                            value={form.name}
                                            onChange={(event) => updateField("name", event.target.value)}
                                            type="text"
                                            placeholder="Vendor name"
                                            className={`${fieldClass} mt-2`}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorEmail">
                                            Email
                                        </label>
                                        <input
                                            id="vendorEmail"
                                            value={form.email}
                                            onChange={(event) => updateField("email", event.target.value)}
                                            type="email"
                                            placeholder="vendor@email.com"
                                            className={`${fieldClass} mt-2`}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorPhone">
                                            Phone Number
                                        </label>
                                        <input
                                            id="vendorPhone"
                                            value={form.phoneNumber}
                                            onChange={(event) => updateField("phoneNumber", event.target.value)}
                                            type="text"
                                            placeholder="(555) 555-5555"
                                            className={`${fieldClass} mt-2`}
                                        />
                                    </div>
                                </div>

                                <div className="border-t border-slate-200 pt-5">
                                    <h3 className="text-base font-bold text-slate-950">Address</h3>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorStreet">
                                                Street Address
                                            </label>
                                            <input
                                                id="vendorStreet"
                                                value={form.streetAddress}
                                                onChange={(event) => updateField("streetAddress", event.target.value)}
                                                type="text"
                                                placeholder="123 Main St"
                                                className={`${fieldClass} mt-2`}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorCity">
                                                City
                                            </label>
                                            <input
                                                id="vendorCity"
                                                value={form.city}
                                                onChange={(event) => updateField("city", event.target.value)}
                                                type="text"
                                                placeholder="City"
                                                className={`${fieldClass} mt-2`}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorState">
                                                State
                                            </label>
                                            <input
                                                id="vendorState"
                                                value={form.state}
                                                onChange={(event) => updateField("state", event.target.value)}
                                                type="text"
                                                placeholder="State"
                                                className={`${fieldClass} mt-2`}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorZip">
                                                ZIP
                                            </label>
                                            <input
                                                id="vendorZip"
                                                value={form.zip}
                                                onChange={(event) => updateField("zip", event.target.value)}
                                                type="text"
                                                placeholder="ZIP Code"
                                                className={`${fieldClass} mt-2`}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="border-t border-slate-200 pt-5">
                                    <label className="block text-sm font-semibold text-slate-700" htmlFor="vendorNotes">
                                        Notes
                                    </label>
                                    <textarea
                                        id="vendorNotes"
                                        value={form.billingNotes}
                                        onChange={(event) => updateField("billingNotes", event.target.value)}
                                        placeholder="Notes, billing details, account info, preferred contact method..."
                                        rows={5}
                                        className={`${fieldClass} mt-2`}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                >
                                    <FaSave className="text-xs" />
                                    {saving ? "Saving..." : isEditing ? "Save Vendor" : "Create Vendor"}
                                </button>
                            </form>
                        </main>

                        <aside className="space-y-6">
                            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between gap-3">
                                    <h2 className="text-lg font-bold text-slate-950">Snapshot</h2>
                                    <FaStore className="text-slate-400" />
                                </div>
                                <div className="mt-4 space-y-3">
                                    <InfoRow icon={FaStore} label="Name" value={form.name} />
                                    <InfoRow icon={FaEnvelope} label="Email" value={form.email} />
                                    <InfoRow icon={FaPhone} label="Phone" value={form.phoneNumber} />
                                    <InfoRow icon={FaMapMarkerAlt} label="Address" value={previewAddress} />
                                    <InfoRow icon={FaStickyNote} label="Notes" value={form.billingNotes} />
                                </div>
                            </section>

                            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="text-lg font-bold text-slate-950">Usage</h2>
                                <p className="mt-2 text-sm text-slate-500">
                                    Vendor records are used by purchases, receipt imports, and database items. Keep contact and account notes current so purchasing workflows stay clean.
                                </p>
                            </section>
                        </aside>
                    </section>
                )}
            </div>
        </div>
    );
};

export default CreateNewVendor;
