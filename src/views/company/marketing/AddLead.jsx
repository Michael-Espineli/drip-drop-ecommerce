import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import AddressAutocomplete from '../../components/AddressAutocomplete';

const AddLead = () => {
    const navigate = useNavigate();
    const db = getFirestore();
    const { recentlySelectedCompany, user, dataBaseUser } = useContext(Context);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const [formData, setFormData] = useState({
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
    });

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

        setIsSubmitting(true);
        const toastId = toast.loading('Adding new lead...');
        const leadId = "hosr_" + uuidv4();

        try {
            await setDoc(doc(db, 'homeOwnerServiceRequests', leadId), {
                id: leadId,
                source: 'Manual', //Customer or Manual
                status: 'Pending',//Pending, In Progress, Completed, Cancelled
                createdAt: new Date(),
                companyId: recentlySelectedCompany,
                companyName: "",
                serviceDescription: formData.serviceDescription,
                serviceName: formData.serviceName,
                serviceLocationAddress: {
                    streetAddress: formData.streetAddress,
                    city: formData.city,
                    state: formData.state,
                    zip: formData.zip,
                    latitude: formData.latitude,
                    longitude: formData.longitude,
                },
                creatorId: user.uid,
                creatorName: dataBaseUser.firstName + ' ' + dataBaseUser.lastName,
                customerId: '', //comp
                customerName: '', //comp
                homeownerName: formData.homeownerName,
                homeownerEmail: formData.homeownerEmail,
                homeownerPhone: formData.homeownerPhone,
                homeOwnerId: '', //homeOwner
                homeOwnerserviceLocationId: "", //homeOwner
                homeOwnerbodyOfWaterId: "", //homeOwner
                homeOwnerequipmentId: "", //homeOwner
            });
            toast.success('New lead added successfully!', { id: toastId });
            navigate('/company/leads');

        } catch (error) {
            console.error("Error adding document: ", error);
            toast.error('Failed to add lead.', { id: toastId });
            setIsSubmitting(false);
        }
    };
    const inputClasses = "w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm";

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">Add New Lead</h1>
                <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-lg space-y-6">
                    
                    <div>
                        <h2 class="text-xl font-bold text-gray-800 border-b pb-3 mb-4">Lead Info</h2>
                        <div className="grid grid-cols-1 gap-6">
                             <div>
                                <label htmlFor="serviceName" className="block text-sm font-medium text-gray-700">Service Name</label>
                                <input type="text" name="serviceName" id="serviceName" value={formData.serviceName} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" required />
                            </div>
                            <div>
                                <label htmlFor="serviceDescription" className="block text-sm font-medium text-gray-700">Service Description</label>
                                <textarea name="serviceDescription" id="serviceDescription" value={formData.serviceDescription} onChange={handleInputChange} rows={4} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"></textarea>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h2 class="text-xl font-bold text-gray-800 border-b pb-3 mb-4">Homeowner</h2>
                         <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                            <div>
                                <label htmlFor="homeownerName" className="block text-sm font-medium text-gray-700">Name</label>
                                <input type="text" name="homeownerName" id="homeownerName" value={formData.homeownerName} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" required />
                            </div>
                             <div>
                                <label htmlFor="homeownerPhone" className="block text-sm font-medium text-gray-700">Phone</label>
                                <input type="tel" name="homeownerPhone" id="homeownerPhone" value={formData.homeownerPhone} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            <div className="md:col-span-2">
                                <label htmlFor="homeownerEmail" className="block text-sm font-medium text-gray-700">Email</label>
                                <input type="email" name="homeownerEmail" id="homeownerEmail" value={formData.homeownerEmail} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                        </div>
                    </div>


                    <div>
                        <h2 class="text-xl font-bold text-gray-800 border-b pb-3 mb-4">Service Location</h2>
                        <AddressAutocomplete onAddressSelect={(p) => handleAddressSelect(p, 'service')} customClasses={inputClasses} />
                        
                        {/* <AddressAutocomplete onAddressSelect={handleAddressSelect} /> */}
                        {formData.streetAddress && (
                             <div className="mt-4 p-4 bg-gray-100 rounded-lg">
                                <p className="font-semibold">Selected Address:</p>
                                <p>{formData.streetAddress}, {formData.city}, {formData.state} {formData.zip}</p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end pt-4">
                        <button type="button" onClick={() => navigate('/company/leads')} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="ml-3 inline-flex justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">
                            {isSubmitting ? 'Adding Lead...' : 'Add Lead'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddLead;
