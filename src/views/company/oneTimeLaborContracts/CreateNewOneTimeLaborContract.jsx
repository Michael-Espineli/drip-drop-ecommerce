
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

const FormInput = ({ label, type = 'text', name, value, onChange, placeholder, required = true }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input 
            type={type} 
            name={name}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            required={required}
            className="w-full p-3 bg-gray-100 border-2 border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition"
        />
    </div>
);

const FormTextarea = ({ label, name, value, onChange, placeholder, rows = 4 }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <textarea
            name={name}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            rows={rows}
            className="w-full p-3 bg-gray-100 border-2 border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition"
        ></textarea>
    </div>
);

const CreateNewOneTimeLaborContract = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany, name: senderName } = useContext(Context);
    
    const [associatedBusinesses, setAssociatedBusinesses] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const [formData, setFormData] = useState({
        receiverId: '',
        receiverName: '',
        title: '',
        terms: '',
        rateOffered: '',
        lastDateToAccept: '',
        notes: ''
    });

    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchAssociatedBusinesses = async () => {
            const businessesRef = collection(db, 'companies', recentlySelectedCompany, 'associatedBusinesses');
            const querySnapshot = await getDocs(businessesRef);
            const businesses = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAssociatedBusinesses(businesses);
        };

        fetchAssociatedBusinesses();
    }, [recentlySelectedCompany]);

    const handleRecipientChange = (e) => {
        const selectedBusiness = associatedBusinesses.find(biz => biz.id === e.target.value);
        if (selectedBusiness) {
            setFormData(prev => ({ ...prev, receiverId: selectedBusiness.id, receiverName: selectedBusiness.name }));
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.receiverId) {
            toast.error("Please select a recipient company.");
            return;
        }

        setIsLoading(true);
        const toastId = toast.loading('Creating contract...');

        try {
            const contractId = uuidv4();
            const contractRef = doc(db, 'laborContracts', contractId);

            await setDoc(contractRef, {
                ...formData,
                id: contractId,
                senderId: recentlySelectedCompany,
                senderName: senderName,
                status: 'Pending',
                dateSent: new Date(),
                postingType: 'DIRECT',
                receiverAcceptance: 'Pending', 
                senderAcceptance: 'Pending'
            });

            toast.success('One-time contract created successfully!', { id: toastId });
            navigate('/company/oneTimeLaborContracts');

        } catch (error) {
            console.error("Error creating contract: ", error);
            toast.error(`Failed to create contract: ${error.message}`, { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Create One-Time Labor Contract</h1>
                        <p className="text-gray-600 mt-1">Define the terms for a single-event labor agreement.</p>
                    </div>
                    <button onClick={() => navigate('/company/oneTimeLaborContracts')} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Back</button>
                </header>

                <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200 space-y-6">
                    
                    <div className="border-b border-gray-200 pb-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4">Recipient</h2>
                         <label className="block text-sm font-medium text-gray-700 mb-1">Select an Associated Business</label>
                        <select
                            onChange={handleRecipientChange}
                            defaultValue=""
                            required
                            className="w-full p-3 bg-gray-100 border-2 border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition"
                        >
                            <option value="" disabled>Select a company...</option>
                            {associatedBusinesses.map(biz => (
                                <option key={biz.id} value={biz.id}>{biz.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="border-b border-gray-200 pb-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4">Contract Details</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                           <FormInput label="Contract Title" name="title" value={formData.title} onChange={handleChange} placeholder="e.g., Event Security Services" />
                           <FormInput label="Rate Offered ($" type="number" name="rateOffered" value={formData.rateOffered} onChange={handleChange} placeholder="e.g., 500" />
                           <FormInput label="Last Date to Accept" name="lastDateToAccept" type="date" value={formData.lastDateToAccept} onChange={handleChange} />
                        </div>
                    </div>

                    <div>
                         <h2 className="text-xl font-bold text-gray-800 mb-4">Terms & Notes</h2>
                        <div className="space-y-6">
                            <FormTextarea label="Terms & Conditions" name="terms" value={formData.terms} onChange={handleChange} placeholder="Outline the full terms of the agreement..." />
                            <FormTextarea label="Additional Notes (Optional)" name="notes" value={formData.notes} onChange={handleChange} placeholder="Add any internal notes or extra details..." />
                        </div>
                    </div>

                    <div className="flex justify-end pt-6 border-t border-gray-200">
                        <button type="submit" disabled={isLoading} className="py-3 px-8 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-blue-300 transition-all">
                            {isLoading ? 'Creating...' : 'Create Contract'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateNewOneTimeLaborContract;
