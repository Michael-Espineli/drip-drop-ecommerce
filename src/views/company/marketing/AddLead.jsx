import React, { useState, useContext, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';

const initialFormData = {
    homeownerName: '',
    homeownerEmail: '',
    homeownerPhone: '',
    serviceName: '',
    serviceDescription: '',
    streetAddress: '',
    city: '',
    state: '',
    zip: '',
    latitude: null,
    longitude: null,
};

const AddLead = () => {
    const navigate = useNavigate();
    const { leadId: routeLeadId } = useParams();
    const db = getFirestore();
    const { recentlySelectedCompany, user, dataBaseUser } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    const isEditing = Boolean(routeLeadId);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loading, setLoading] = useState(isEditing);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletingLead, setDeletingLead] = useState(false);

    const [formData, setFormData] = useState(initialFormData);

    useEffect(() => {
        if (!isEditing) return;

        if (!recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const fetchLead = async () => {
            setLoading(true);
            try {
                const leadRef = doc(db, 'homeownerServiceRequests', routeLeadId);
                const leadSnap = await getDoc(leadRef);

                if (!leadSnap.exists() || leadSnap.data().companyId !== recentlySelectedCompany) {
                    toast.error('Lead not found or access denied.');
                    navigate('/company/leads');
                    return;
                }

                const lead = leadSnap.data();
                const address = lead.serviceLocationAddress || {};
                setFormData({
                    homeownerName: lead.homeownerName || lead.customerName || '',
                    homeownerEmail: lead.homeownerEmail || '',
                    homeownerPhone: lead.homeownerPhone || '',
                    serviceName: lead.serviceName || '',
                    serviceDescription: lead.serviceDescription || '',
                    streetAddress: address.streetAddress || '',
                    city: address.city || '',
                    state: address.state || '',
                    zip: address.zip || address.zipCode || '',
                    latitude: address.latitude ?? null,
                    longitude: address.longitude ?? null,
                });
            } catch (error) {
                console.error('Error loading lead:', error);
                toast.error('Failed to load lead.');
            } finally {
                setLoading(false);
            }
        };

        fetchLead();
    }, [db, isEditing, navigate, recentlySelectedCompany, routeLeadId]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleAddressSelect = (address) => {
        setFormData(prev => ({
            ...prev,
            streetAddress: address.streetAddress,
            city: address.city,
            state: address.state,
            zip: address.zipCode,
            latitude: address.latitude,
            longitude: address.longitude,
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || !user) return;
        if (!recentlySelectedCompany) {
            toast.error(`Please select a company before ${isEditing ? 'saving' : 'adding'} a lead.`);
            return;
        }
        if (isEditing && !requirePermission("614", "update leads")) {
            return;
        }
        if (!isEditing && !requirePermission("612", "respond to leads")) {
            return;
        }
        if (!formData.homeownerName || !formData.serviceDescription || !formData.serviceName) return;

        setIsSubmitting(true);
        const toastId = toast.loading(isEditing ? 'Saving lead...' : 'Adding new lead...');
        const creatorName =
            dataBaseUser?.userName ||
            dataBaseUser?.displayName ||
            dataBaseUser?.name ||
            user?.displayName ||
            user?.email ||
            "";

        try {
            const leadPayload = {
                serviceDescription: formData.serviceDescription,
                serviceName: formData.serviceName,
                serviceLocationAddress: {
                    streetAddress: formData.streetAddress || "",
                    city: formData.city || "",
                    state: formData.state || "",
                    zip: formData.zip || "",
                    latitude: formData.latitude ?? null,
                    longitude: formData.longitude ?? null,
                },
                homeownerName: formData.homeownerName,
                homeownerEmail: formData.homeownerEmail || "",
                homeownerPhone: formData.homeownerPhone || "",
            };

            if (isEditing) {
                await updateDoc(doc(db, 'homeownerServiceRequests', routeLeadId), {
                    ...leadPayload,
                    updatedAt: serverTimestamp(),
                });
                toast.success('Lead updated successfully!', { id: toastId });
                navigate(`/company/leads/${routeLeadId}`);
                return;
            }

            const newLeadId = "hosr_" + uuidv4();
            await setDoc(doc(db, 'homeownerServiceRequests', newLeadId), {
                id: newLeadId,
                source: 'Manual', //Customer or Manual
                status: 'Pending',//Pending, In Progress, Completed, Cancelled
                createdAt: new Date(),
                companyId: recentlySelectedCompany,
                companyName: "",
                ...leadPayload,
                creatorId: user.uid || "",
                creatorName,
                customerId: '', //comp
                customerName: '', //comp
                serviceLocationId: '', //comp
                bodyOfWaterId: '', //comp
                equipmentIds: [], //comp
                homeownerId: '', //homeowner
                homeownerserviceLocationId: "", //homeowner
                homeownerbodyOfWaterId: "", //homeowner
                homeownerequipmentId: "", //homeowner
                dateCompleted: null
            });
            toast.success('New lead added successfully!', { id: toastId });
            navigate('/company/leads');

        } catch (error) {
            console.error(isEditing ? "Error updating lead: " : "Error adding lead: ", error);
            toast.error(isEditing ? 'Failed to update lead.' : 'Failed to add lead.', { id: toastId });
            setIsSubmitting(false);
        }
    };

    const handleDeleteLead = async () => {
        if (!isEditing || !routeLeadId) return;
        if (!requirePermission("616", "delete leads")) return;

        setDeletingLead(true);
        try {
            await deleteDoc(doc(db, 'homeownerServiceRequests', routeLeadId));
            toast.success('Lead deleted.');
            navigate('/company/leads');
        } catch (error) {
            console.error('Error deleting lead:', error);
            toast.error('Failed to delete lead.');
            setDeletingLead(false);
            setShowDeleteModal(false);
        }
    };
    const inputClasses = "w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-slate-900 placeholder-slate-500 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:text-sm";
    const textInputClasses = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:text-sm";
    const returnPath = isEditing ? `/company/leads/${routeLeadId}` : '/company/leads';

    if (loading) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen text-gray-700">
                Loading lead...
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-950">{isEditing ? 'Edit Lead' : 'Add New Lead'}</h1>
                            <p className="mt-1 text-sm text-slate-600">
                                {isEditing ? 'Update this lead before the next sales step.' : 'Add a new lead to your customer list.'}
                            </p>
                        </div>
                        <button
                            onClick={() => navigate(returnPath)}
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                        >
                            Back
                        </button>
                    </div>
                </section>
                <form onSubmit={handleSubmit} className="grid min-h-[calc(100vh-13rem)] gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.65fr)]">
                    <section className="flex min-h-[32rem] flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm xl:min-h-[calc(100vh-13rem)]">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <label htmlFor="serviceDescription" className="text-lg font-bold text-slate-950">Shared Description</label>
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                                Visible to homeowner
                            </span>
                        </div>
                        <textarea
                            name="serviceDescription"
                            id="serviceDescription"
                            value={formData.serviceDescription}
                            onChange={handleInputChange}
                            rows={24}
                            className="min-h-[28rem] flex-1 resize-none rounded-md border border-slate-300 px-4 py-3 text-base leading-7 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 xl:min-h-0"
                            placeholder="Write the customer's request here."
                            required
                            autoFocus={!isEditing}
                        ></textarea>
                    </section>

                    <div className="space-y-6">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 className="mb-4 border-b border-slate-200 pb-3 text-lg font-bold text-slate-950">Lead Info</h2>
                            <div>
                                <label htmlFor="serviceName" className="block text-sm font-medium text-slate-700">Service Name</label>
                                <input type="text" name="serviceName" id="serviceName" value={formData.serviceName} onChange={handleInputChange} className={textInputClasses} required />
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 className="mb-4 border-b border-slate-200 pb-3 text-lg font-bold text-slate-950">Homeowner</h2>
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                                <div>
                                    <label htmlFor="homeownerName" className="block text-sm font-medium text-slate-700">Name</label>
                                    <input type="text" name="homeownerName" id="homeownerName" value={formData.homeownerName} onChange={handleInputChange} className={textInputClasses} required />
                                </div>
                                <div>
                                    <label htmlFor="homeownerPhone" className="block text-sm font-medium text-slate-700">Phone</label>
                                    <input type="tel" name="homeownerPhone" id="homeownerPhone" value={formData.homeownerPhone} onChange={handleInputChange} className={textInputClasses} />
                                </div>
                                <div className="md:col-span-2 xl:col-span-1 2xl:col-span-2">
                                    <label htmlFor="homeownerEmail" className="block text-sm font-medium text-slate-700">Email</label>
                                    <input type="email" name="homeownerEmail" id="homeownerEmail" value={formData.homeownerEmail} onChange={handleInputChange} className={textInputClasses} />
                                </div>
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 className="mb-4 border-b border-slate-200 pb-3 text-lg font-bold text-slate-950">Service Location</h2>
                            <AddressAutocomplete onAddressSelect={(p) => handleAddressSelect(p, 'service')} customClasses={inputClasses} />

                            {formData.streetAddress && (
                                <div className="mt-4 rounded-md bg-slate-100 p-4 text-sm text-slate-800">
                                    <p className="font-semibold">Selected Address:</p>
                                    <p>{formData.streetAddress}, {formData.city}, {formData.state} {formData.zip}</p>
                                </div>
                            )}
                        </section>

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            {isEditing ? (
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteModal(true)}
                                    disabled={isSubmitting || deletingLead}
                                    className="inline-flex justify-center rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Delete Lead
                                </button>
                            ) : <span />}
                            <div className="flex justify-end gap-3">
                                <button type="button" onClick={() => navigate(returnPath)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">Cancel</button>
                                <button type="submit" disabled={isSubmitting || deletingLead} className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                                    {isSubmitting ? (isEditing ? 'Saving Lead...' : 'Adding Lead...') : (isEditing ? 'Save Lead' : 'Add Lead')}
                                </button>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
                        <h3 className="text-xl font-bold text-slate-950">Delete Lead</h3>
                        <p className="mt-2 text-sm text-slate-600">
                            Delete this lead permanently? Linked customers, jobs, service stops, and agreements will stay in place.
                        </p>
                        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setShowDeleteModal(false)}
                                disabled={deletingLead}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteLead}
                                disabled={deletingLead}
                                className="inline-flex justify-center rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {deletingLead ? 'Deleting...' : 'Delete Lead'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AddLead;
