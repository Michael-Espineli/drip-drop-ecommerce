import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';
import { format } from 'date-fns';

const EstimateSnapshot = ({ estimate }) => {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Estimate Details</h3>
            <dl className="space-y-2">
                <div>
                    <dt className="text-sm font-medium text-gray-500">Rate</dt>
                    <dd className="text-lg font-semibold text-gray-900">${estimate.rate.toFixed(2)}</dd>
                </div>
                <div>
                    <dt className="text-sm font-medium text-gray-500">Status</dt>
                    <dd><span className={`px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800`}>{estimate.status}</span></dd>
                </div>
                <div>
                    <dt className="text-sm font-medium text-gray-500">Last Date to Accept</dt>
                    <dd className="text-sm text-gray-600">{estimate.lastDateToAccept ? format(estimate.lastDateToAccept.toDate(), 'PPP') : 'N/A'}</dd>
                </div>
            </dl>
            <Link to={`/company/contract/detail/${estimate.id}`} className="block w-full text-center mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">View Estimate</Link>
        </div>
    );
};

export default function LeadDetail() {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [estimate, setEstimate] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const fetchLeadDetails = async () => {
            setLoading(true);
            try {
                const leadRef = doc(db, 'homeOwnerServiceRequests', leadId);
                const docSnap = await getDoc(leadRef);

                if (docSnap.exists() && docSnap.data().companyId === recentlySelectedCompany) {
                    const leadData = docSnap.data();
                    let ownerDetails = {};
                    if (leadData.userId) {
                        const userSnap = await getDoc(doc(db, 'users', leadData.userId));
                        ownerDetails = userSnap.exists() ? userSnap.data() : {};
                    }
                    const enhancedLead = { id: docSnap.id, ...leadData, ownerDetails };
                    setLead(enhancedLead);

                    if (leadData.estimateId) {
                        const estimateRef = doc(db, 'contracts', leadData.estimateId);
                        const estimateSnap = await getDoc(estimateRef);
                        if (estimateSnap.exists()) {
                            setEstimate({ id: estimateSnap.id, ...estimateSnap.data() });
                        }
                    }
                } else {
                    toast.error("Lead not found or access denied.");
                    navigate('/company/leads');
                }
            } catch (error) {
                console.error("Error fetching lead details:", error);
                toast.error("Failed to fetch lead details.");
            } finally {
                setLoading(false);
            }
        };

        fetchLeadDetails();
    }, [leadId, recentlySelectedCompany, db, navigate]);

    const handleStatusChange = async (newStatus) => {
        const leadRef = doc(db, 'homeOwnerServiceRequests', leadId);
        const originalStatus = lead.status;
        setLead(prev => ({ ...prev, status: newStatus }));
        try {
            await updateDoc(leadRef, { status: newStatus });
            toast.success(`Status updated to ${newStatus}`);
        } catch (error) {
            setLead(prev => ({ ...prev, status: originalStatus }));
            toast.error("Failed to update status.");
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;
    }

    if (!lead) {
        return (
            <div className="text-center p-12">
                <h2 className="text-xl font-semibold">Lead not found</h2>
                <Link to="/company/leads" className="text-blue-600 hover:underline">Return to Leads</Link>
            </div>
        );
    }

    const { serviceName, serviceDescription, createdAt, status, ownerDetails, serviceLocationAddress, source, customerId, customerName, creatorName, homeownerName } = lead;

    const renderActions = () => {
        // This function is only called when an estimate does NOT exist.
        if (source === 'Manual' && !customerId) {
            return <button onClick={() => navigate(`/company/customers/create-from-lead/${lead.id}`)} className="w-full py-2.5 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium">Create Customer</button>;
        }

        if (customerId || source !== 'Manual') {
            return <button onClick={() => navigate(`/company/estimates/create/${lead.id}`)} className="w-full py-2.5 px-4 rounded-md text-white bg-green-600 hover:bg-green-700 font-medium">Send Estimate</button>;
        }

        return null;
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to="/company/leads" className="text-sm font-medium text-gray-600 hover:text-gray-900">&larr; Back to Leads</Link>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white p-8 rounded-2xl shadow-lg">
                            <div className="flex items-center justify-between mb-6">
                                <h1 className="text-3xl font-bold text-gray-900">{serviceName}</h1>
                                <span className={`px-3 py-1 text-sm font-semibold rounded-full bg-blue-100 text-blue-800`}>{status}</span>
                            </div>
                            <p className="text-gray-600 mb-6">{serviceDescription}</p>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-4">
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Submitted On</dt>
                                    <dd className="mt-1 text-lg text-gray-900">{createdAt ? format(createdAt.toDate(), 'PPP') : 'N/A'}</dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Lead Source</dt>
                                    <dd className="mt-1 text-lg text-gray-900">{source || 'N/A'}</dd>
                                </div>
                                {creatorName && (
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500">Created By</dt>
                                        <dd className="mt-1 text-lg text-gray-900">{creatorName}</dd>
                                    </div>
                                )}
                            </dl>
                        </div>

                        <div className="bg-white p-8 rounded-2xl shadow-lg">
                            <h3 className="text-xl font-bold text-gray-900 mb-6">Homeowner & Location</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <h4 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Contact Info</h4>
                                    <dl>
                                        <div className="mb-4"><dt className="text-sm font-medium text-gray-500">Name</dt><dd className="text-lg text-gray-900">{customerName || ownerDetails.displayName || homeownerName}</dd></div>
                                        <div className="mb-4"><dt className="text-sm font-medium text-gray-500">Email</dt><dd className="text-lg text-gray-900 break-words">{ownerDetails.email}</dd></div>
                                        {ownerDetails.phoneNumber && (<div><dt className="text-sm font-medium text-gray-500">Phone</dt><dd className="text-lg text-gray-900">{ownerDetails.phoneNumber}</dd></div>)}
                                    </dl>
                                </div>
                                {
                                    serviceLocationAddress && (
                                        <div>
                                            <h4 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Service Address</h4>
                                            <address className="not-italic text-lg text-gray-900">
                                                {serviceLocationAddress.streetAddress}<br />
                                                {serviceLocationAddress.city}, {serviceLocationAddress.state} {serviceLocationAddress.zipCode}
                                            </address>
                                        </div>
                                    )
                                }
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-2xl shadow-lg">
                            <h3 className="text-lg font-semibold text-gray-800 mb-4">Manage Status</h3>
                            <select value={status} onChange={(e) => handleStatusChange(e.target.value)} className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500">
                                <option value="Pending">Pending</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Completed">Completed</option>
                                <option value="Cancelled">Cancelled</option>
                            </select>
                        </div>
                        
                        {estimate ? <EstimateSnapshot estimate={estimate} /> : (
                            <> 
                                {customerId && (
                                    <div className="bg-white p-6 rounded-2xl shadow-lg">
                                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Associated Customer</h3>
                                        <p className="text-gray-800 mb-3">{customerName}</p>
                                        <Link to={`/company/customers/details/${customerId}`} className="block w-full text-center py-2.5 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium">View Customer Profile</Link>
                                    </div>
                                )}
                                <div className="bg-white p-6 rounded-2xl shadow-lg">
                                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Actions</h3>
                                    <div className="space-y-3">
                                        {renderActions()}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
