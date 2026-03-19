import React, { useState, useContext, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFirestore, doc, addDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';

export default function ScheduleEstimate() {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({
        serviceDate: '',
        startTime: '',
        estimatedDuration: '60', // Default to 60 minutes
        description: '',
        tech: '',
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [companyName, setCompanyName] = useState('');

    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const fetchLead = async () => {
            setLoading(true);
            const leadRef = doc(db, 'homeOwnerServiceRequests', leadId);
            try {
                const docSnap = await getDoc(leadRef);
                if (docSnap.exists()) {
                    const leadData = docSnap.data();
                    if (leadData.companyId !== recentlySelectedCompany) {
                        toast.error("Access denied.");
                        navigate('/company/leads');
                        return;
                    }
                    
                    const userSnap = await getDoc(doc(db, 'users', leadData.userId));
                    const enhancedLead = {
                        id: docSnap.id,
                        ...leadData,
                        ownerDetails: userSnap.exists() ? userSnap.data() : {},
                    };

                    setLead(enhancedLead);
                    setFormData(prev => ({ ...prev, description: enhancedLead.serviceDescription || '' }));
                } else {
                    toast.error("Lead not found.");
                    navigate('/company/leads');
                }
            } catch (error) {
                console.error("Error fetching lead:", error);
                toast.error("Failed to fetch lead details.");
            } finally {
                setLoading(false);
            }
        };

        const fetchCompanyName = async () => {
            try {
                const companyRef = doc(db, 'companies', recentlySelectedCompany);
                const companySnap = await getDoc(companyRef);
                if (companySnap.exists()) {
                    setCompanyName(companySnap.data().name);
                }
            } catch (error) {
                console.error("Error fetching company name:", error);
                toast.error("Could not fetch company details.");
            }
        };

        fetchLead();
        fetchCompanyName();
    }, [leadId, recentlySelectedCompany, db, navigate]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || !companyName) {
            if (!companyName) toast.error("Company details not loaded.");
            return;
        }

        setIsSubmitting(true);
        const toastId = toast.loading('Scheduling estimate...');

        const { serviceDate, startTime, estimatedDuration, description, tech } = formData;
        const [hour, minute] = startTime.split(':').map(Number);
        const serviceDateTime = new Date(serviceDate);
        serviceDateTime.setHours(hour, minute, 0, 0);

        try {
            await addDoc(collection(db, 'serviceStops'), {
                internalId: '',
                companyId: recentlySelectedCompany,
                companyName: companyName,
                customerId: lead.userId,
                customerName: lead.ownerDetails.displayName,
                address: lead.serviceLocationAddress, // Corrected from serviceLocationDetails
                dateCreated: serverTimestamp(),
                serviceDate: serviceDateTime,
                startTime: serviceDateTime,
                endTime: null,
                duration: 0,
                estimatedDuration: parseInt(estimatedDuration, 10),
                tech: tech,
                techId: '',
                recurringServiceStopId: '',
                description: description,
                serviceLocationId: lead.serviceLocationId,
                typeId: '',
                type: 'Estimate',
                typeImage: '',
                jobId: '',
                jobName: '',
                operationStatus: 'Scheduled',
                billingStatus: 'Pending',
                includeReadings: false,
                includeDosages: false,
                otherCompany: false,
                laborContractId: '',
                contractedCompanyId: '',
                photoUrls: [],
                mainCompanyId: '',
                isInvoiced: false,
                leadId: lead.id
            });

            toast.success('Estimate scheduled successfully!', { id: toastId });
            navigate(`/company/leads/${lead.id}`);

        } catch (error) {
            console.error("Error scheduling estimate:", error);
            toast.error('Failed to schedule estimate.', { id: toastId });
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;
    }

    if (!lead) {
        return (
            <div className="text-center p-12">
                <h2 className="text-xl font-semibold">Lead data could not be loaded.</h2>
                <Link to="/company/leads" className="text-blue-600 hover:underline">Return to Leads</Link>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-3xl mx-auto bg-white p-8 rounded-2xl shadow-lg">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Schedule Estimate</h1>
                    <p className="text-gray-600 mt-2">From lead: <Link to={`/company/leads/${lead.id}`} className="text-blue-600 hover:underline">{lead.serviceName}</Link></p>
                </div>

                <div className="mb-8 p-6 bg-gray-50 rounded-lg">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">Details</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-700 border-b pb-2 mb-3">Customer</h3>
                            <dl>
                                <div className="mb-2"><dt className="text-sm font-medium text-gray-500">Name</dt><dd className="text-gray-900">{lead.ownerDetails.displayName}</dd></div>
                                <div className="mb-2"><dt className="text-sm font-medium text-gray-500">Email</dt><dd className="text-gray-900 break-words">{lead.ownerDetails.email}</dd></div>
                            </dl>
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-700 border-b pb-2 mb-3">Service Location</h3>
                            <address className="not-italic text-gray-900">
                                {lead.serviceLocationAddress.streetAddress}<br />
                                {lead.serviceLocationAddress.city}, {lead.serviceLocationAddress.state} {lead.serviceLocationAddress.zipCode}
                            </address>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="serviceDate" className="block text-sm font-medium text-gray-700">Date</label>
                            <input type="date" name="serviceDate" id="serviceDate" value={formData.serviceDate} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" required />
                        </div>
                        <div>
                            <label htmlFor="startTime" className="block text-sm font-medium text-gray-700">Start Time</label>
                            <input type="time" name="startTime" id="startTime" value={formData.startTime} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" required />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div>
                            <label htmlFor="estimatedDuration" className="block text-sm font-medium text-gray-700">Estimated Duration (minutes)</label>
                            <input type="number" name="estimatedDuration" id="estimatedDuration" value={formData.estimatedDuration} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" required />
                        </div>
                        <div>
                           <label htmlFor="tech" className="block text-sm font-medium text-gray-700">Assign Technician</label>
                           <input type="text" name="tech" id="tech" value={formData.tech} onChange={handleInputChange} placeholder="Technician name" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Notes</label>
                        <textarea name="description" id="description" value={formData.description} onChange={handleInputChange} rows="4" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"></textarea>
                    </div>

                    <div className="flex justify-end pt-4">
                        <Link to={`/company/leads/${lead.id}`} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">Cancel</Link>
                        <button type="submit" disabled={isSubmitting} className="ml-3 inline-flex justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50">{isSubmitting ? 'Scheduling...' : 'Schedule Estimate'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
