import React, { useState, useContext, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFirestore, doc, addDoc, collection, serverTimestamp, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';

const TermsTemplateModal = ({ isOpen, onClose, onSelectTemplate }) => {
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && recentlySelectedCompany) {
            setLoading(true);
            const templatesRef = collection(db, 'companies', recentlySelectedCompany, 'settings', 'termsTemplates', 'termsTemplates');
            getDocs(templatesRef)
                .then(snapshot => {
                    const templatesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setTemplates(templatesData);
                })
                .catch(err => toast.error('Failed to load templates.'))
                .finally(() => setLoading(false));
        }
    }, [isOpen, recentlySelectedCompany, db]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-gray-600 bg-opacity-75 flex justify-center items-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                <div className="p-6">
                    <h3 className="text-xl font-bold mb-4">Select a Terms Template</h3>
                    {loading ? <ClipLoader size={35} /> : (
                        <ul className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                            {templates.map(template => (
                                <li key={template.id} onClick={() => onSelectTemplate(template)} className="p-4 hover:bg-gray-100 cursor-pointer">
                                    <p className="font-semibold">{template.name}</p>
                                    <p className="text-sm text-gray-600">{template.description}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="bg-gray-50 px-6 py-3 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Close</button>
                </div>
            </div>
        </div>
    );
};

export default function CreateEstimate() {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({
        notes: '',
        rate: '',
        lastDateToAccept: '',
        terms: [{ description: '' }]
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [companyName, setCompanyName] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const fetchLeadAndCompany = async () => {
            setLoading(true);
            try {
                const leadRef = doc(db, 'homeOwnerServiceRequests', leadId);
                const leadSnap = await getDoc(leadRef);

                if (leadSnap.exists() && leadSnap.data().companyId === recentlySelectedCompany) {
                    const leadData = leadSnap.data();
                    let ownerDetails = {};

                    if (leadData.userId) {
                        const userSnap = await getDoc(doc(db, 'users', leadData.userId));
                        if (userSnap.exists()) {
                            ownerDetails = userSnap.data();
                        }
                    } else if (leadData.customerId) {
                        const customerSnap = await getDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', leadData.customerId));
                        if (customerSnap.exists()) {
                            const customerData = customerSnap.data();
                            const displayName = customerData.displayAsCompany ? customerData.companyName : `${customerData.firstName} ${customerData.lastName}`.trim();
                            ownerDetails = {
                                displayName: displayName,
                                email: customerData.email,
                                phoneNumber: customerData.phone
                            };
                        }
                    }

                    setLead({ id: leadSnap.id, ...leadData, ownerDetails });
                    setFormData(prev => ({ ...prev, notes: leadData.serviceDescription || '' }));

                } else {
                    toast.error("Lead not found or access denied.");
                    navigate('/company/leads');
                    return;
                }

                const companyRef = doc(db, 'companies', recentlySelectedCompany);
                const companySnap = await getDoc(companyRef);
                if (companySnap.exists()) {
                    setCompanyName(companySnap.data().name);
                }
            } catch (error) {
                console.error("Error fetching initial data:", error);
                toast.error("Failed to fetch initial data.");
            } finally {
                setLoading(false);
            }
        };

        fetchLeadAndCompany();
    }, [leadId, recentlySelectedCompany, db, navigate]);

    const handleInputChange = e => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleTermChange = (index, value) => {
        const newTerms = [...formData.terms];
        newTerms[index].description = value;
        setFormData(prev => ({ ...prev, terms: newTerms }));
    };
    const addTerm = () => setFormData(prev => ({ ...prev, terms: [...prev.terms, { description: '' }] }));
    const removeTerm = index => setFormData(prev => ({ ...prev, terms: formData.terms.filter((_, i) => i !== index) }));

    const onSelectTemplate = async (template) => {
        const clausesRef = collection(db, 'companies', recentlySelectedCompany, 'settings','termsTemplates','termsTemplates', template.id, 'clauses');
        const clausesSnap = await getDocs(clausesRef);
        const clauses = clausesSnap.docs.map(doc => ({ description: doc.data().text }));
        const newTerms = [{description: template.content}, ...clauses].filter(t => t.description && t.description.trim() !== '');
        setFormData(prev => ({ ...prev, terms: newTerms.length > 0 ? newTerms : [{ description: '' }] }));
        setIsModalOpen(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || !lead) return;
        setIsSubmitting(true);
        const toastId = toast.loading('Creating estimate...');
        try {
            const estimateRef = await addDoc(collection(db, 'contracts'), {
                senderName: companyName,
                senderId: recentlySelectedCompany,
                senderAcceptance: false,
                receiverName: lead.ownerDetails.displayName,
                receiverId: lead.userId || lead.customerId,
                receiverAcceptance: false,
                dateSent: serverTimestamp(),
                lastDateToAccept: new Date(formData.lastDateToAccept),
                dateAccepted: null,
                status: 'Pending',
                terms: formData.terms.filter(t => t.description.trim() !== ''),
                notes: formData.notes,
                rate: parseFloat(formData.rate),
                leadId: lead.id
            });

            const leadRef = doc(db, 'homeOwnerServiceRequests', leadId);
            await updateDoc(leadRef, { estimateId: estimateRef.id });

            toast.success('Estimate created successfully!', { id: toastId });
            navigate(`/company/leads/${lead.id}`);
        } catch (error) {
            console.error("Error creating estimate:", error);
            toast.error('Failed to create estimate.', { id: toastId });
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
        <>
            <TermsTemplateModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSelectTemplate={onSelectTemplate} />
            <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
                <div className="max-w-6xl mx-auto">
                     <div className="mb-6">
                        <h1 className="text-3xl font-bold text-gray-900">New Estimate</h1>
                        <p className="text-gray-600 mt-1">From lead: <Link to={`/company/leads/${lead.id}`} className="text-blue-600 hover:underline">{lead?.serviceName}</Link></p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Form Column */}
                        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-lg">
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label htmlFor="rate" className="block text-sm font-medium text-gray-700">Rate ($)</label>
                                        <input type="number" name="rate" id="rate" value={formData.rate} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" required />
                                    </div>
                                    <div>
                                        <label htmlFor="lastDateToAccept" className="block text-sm font-medium text-gray-700">Last Date to Accept</label>
                                        <input type="date" name="lastDateToAccept" id="lastDateToAccept" value={formData.lastDateToAccept} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" required />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700">Estimate Notes</label>
                                    <textarea name="notes" id="notes" value={formData.notes} onChange={handleInputChange} rows="5" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"></textarea>
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-lg font-medium text-gray-900">Terms</h3>
                                        <button type="button" onClick={() => setIsModalOpen(true)} className="px-3 py-1.5 text-sm text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50">Select Template</button>
                                    </div>
                                    {formData.terms.map((term, index) => (
                                        <div key={index} className="flex items-center space-x-2 mb-2">
                                            <input type="text" value={term.description} onChange={(e) => handleTermChange(index, e.target.value)} className="flex-grow block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" placeholder={`Term ${index + 1}`} />
                                            <button type="button" onClick={() => removeTerm(index)} className="px-3 py-2 text-sm font-medium text-red-600 hover:text-red-800">Remove</button>
                                        </div>
                                    ))}
                                    <button type="button" onClick={addTerm} className="mt-2 px-3 py-1.5 text-sm text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50">+ Add Term</button>
                                </div>

                                <div className="flex justify-end pt-4">
                                    <Link to={`/company/leads/${lead.id}`} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</Link>
                                    <button type="submit" disabled={isSubmitting} className="ml-3 inline-flex justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">{isSubmitting ? 'Creating...' : 'Create Estimate'}</button>
                                </div>
                            </form>
                        </div>

                        {/* Lead Details Column */}
                        {lead && (
                            <div className="lg:col-span-1 bg-white p-8 rounded-2xl shadow-lg">
                                <h2 className="text-2xl font-bold text-gray-900 mb-6">Lead Details</h2>
                                <div className="space-y-5 text-sm">
                                    <div><h3 className="font-semibold text-base">Lead Notes</h3><p className="whitespace-pre-wrap text-gray-700">{lead.serviceDescription || 'No description provided.'}</p></div>
                                    <div>
                                        <h3 className="font-semibold text-base">Contact</h3>
                                        <p>{lead.ownerDetails?.displayName || 'N/A'}</p>
                                        <p className="text-gray-600">{lead.ownerDetails?.email || 'No email'}</p>
                                        <p className="text-gray-600">{lead.ownerDetails?.phoneNumber || 'No phone'}</p>
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-base">Service Address</h3>
                                        {lead.serviceLocationAddress ? (
                                            <address className="not-italic text-gray-700">
                                                {lead.serviceLocationAddress.streetAddress}<br />
                                                {lead.serviceLocationAddress.city}, {lead.serviceLocationAddress.state} {lead.serviceLocationAddress.zipCode}
                                            </address>
                                        ) : <p className="text-gray-500">No address provided.</p>}
                                    </div>
                                    {lead.source && <div><h3 className="font-semibold text-base">Source</h3><p className="text-gray-700">{lead.source}</p></div>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
