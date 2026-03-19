
import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { BuildingOffice2Icon, PhoneIcon, EnvelopeIcon, GlobeAltIcon, MapPinIcon, LinkIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import Select from 'react-select';

const availableServices = [
    { value: 'pool_cleaning', label: 'Pool Cleaning' },
    { value: 'equipment_repair', label: 'Equipment Repair' },
    { value: 'chemical_balancing', label: 'Chemical Balancing' },
    { value: 'leak_detection', label: 'Leak Detection' },
    { value: 'pool_inspection', label: 'Pool Inspection' },
];

const CreateNewCompany = () => {
    const { user,setRecentlySelectedCompany, dataBaseUser } = useContext(Context);
    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        name: '',
        address: null,
        phoneNumber: '',
        email: '',
        websiteURL: '',
        yelpURL: '',
        serviceZipCodes: '',
        services: [],
    });
    
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleServicesChange = (selectedOptions) => {
        setFormData(prev => ({ ...prev, services: selectedOptions || [] }));
    };

    const handleUseUserEmail = () => {
        if (user && user.email) {
            setFormData(prev => ({ ...prev, email: user.email }));
        }
    };

    const handlePaste = async (fieldName) => {
        try {
            const text = await navigator.clipboard.readText();
            setFormData(prev => ({ ...prev, [fieldName]: text }));
        } catch (err) {
            console.error('Failed to read clipboard contents: ', err);
            setError('Could not paste from clipboard. Please check your browser permissions.')
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name || !formData.address) {
            setError('Company Name and Address are required.');
            return;
        }
        setLoading(true);
        setError('');

        try {
            const functions = getFunctions();
            const createCompany = httpsCallable(functions, 'createCompanyAfterSignUp');

            const result = await createCompany({
                ownerId: user.uid,
                ownerName: (dataBaseUser.firstName + " " + dataBaseUser.lastName) || 'N/A',
                companyName: formData.name,
                address: formData.address,
                email: formData.email,
                phoneNumber: formData.phoneNumber,
                zipCodes: formData.serviceZipCodes.split(',').map(zip => zip.trim()).filter(zip => zip),
                services: formData.services.map(s => s.value),
                websiteURL: formData.websiteURL,
                yelpURL: formData.yelpURL,
            });
            
            const companyId = result.data.companyId;

            if (companyId) {
                const userDocRef = doc(db, "users", user.uid);
                await updateDoc(userDocRef, {
                    recentlySelectedCompany: companyId,
                });
                setRecentlySelectedCompany(companyId)
                navigate('/company/dashboard');
            } else {
                throw new Error('Company ID not returned from function.');
            }
            
        } catch (err) {
            setError('Failed to create company. Please try again.');
            console.error("Function call error:", err);
        } finally {
            setLoading(false);
        }
    };
    
    const inputIconClasses = "absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400";
    const inputClasses = "w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm";
    const secondaryButtonClasses = "p-2 border border-gray-300 rounded-md text-gray-700 bg-gray-50 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500";

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl w-full space-y-8 p-10 bg-white shadow-lg rounded-xl">
                <div>
                    <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Create Your Company</h2>
                    <p className="mt-2 text-center text-sm text-gray-600">All companies start on our Free plan. Fill in the details below to get set up.</p>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && <p className="text-red-500 text-sm text-center bg-red-50 p-3 rounded-md">{error}</p>}
                    
                    <div className="relative">
                        <label htmlFor="name" className="sr-only">Company Name</label>
                        <BuildingOffice2Icon className={inputIconClasses} />
                        <input id="name" name="name" type="text" required className={inputClasses} placeholder="Company Name" value={formData.name} onChange={handleInputChange} />
                    </div>

                    <div className="relative">
                        <label htmlFor="address" className="sr-only">Company Address</label>
                         <AddressAutocomplete onAddressSelect={(address) => setFormData(prev => ({...prev, address: address}))} placeholder={"Company Address"} customClasses={inputClasses} />
                    </div>

                    <div className="relative">
                        <label htmlFor="phoneNumber" className="sr-only">Phone Number</label>
                        <PhoneIcon className={inputIconClasses} />
                        <input id="phoneNumber" name="phoneNumber" type="tel" required className={inputClasses} placeholder="Phone Number" value={formData.phoneNumber} onChange={handleInputChange} />
                    </div>

                     <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <label htmlFor="email" className="sr-only">Email Address</label>
                            <EnvelopeIcon className={inputIconClasses} />
                            <input id="email" name="email" type="email" required className={inputClasses} placeholder="Email Address" value={formData.email} onChange={handleInputChange} />
                        </div>
                        <button type="button" onClick={handleUseUserEmail} className={`${secondaryButtonClasses} text-sm`}>Use My Email</button>
                    </div>

                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <label htmlFor="websiteURL" className="sr-only">Website URL</label>
                            <GlobeAltIcon className={inputIconClasses} />
                            <input id="websiteURL" name="websiteURL" type="url" className={inputClasses} placeholder="Website URL (Optional)" value={formData.websiteURL} onChange={handleInputChange} />
                        </div>
                         <button type="button" onClick={() => handlePaste('websiteURL')} className={secondaryButtonClasses} aria-label="Paste Website URL">
                            <ClipboardDocumentIcon className="h-5 w-5" />
                        </button>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <label htmlFor="yelpURL" className="sr-only">Yelp URL</label>
                            <LinkIcon className={inputIconClasses} />
                            <input id="yelpURL" name="yelpURL" type="url" className={inputClasses} placeholder="Yelp URL (Optional)" value={formData.yelpURL} onChange={handleInputChange} />
                        </div>
                        <button type="button" onClick={() => handlePaste('yelpURL')} className={secondaryButtonClasses} aria-label="Paste Yelp URL">
                            <ClipboardDocumentIcon className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="relative">
                        <label htmlFor="serviceZipCodes" className="block text-sm font-medium text-gray-700 mb-1">Service Zip Codes (Seperate with commas)</label>
                         <MapPinIcon className={inputIconClasses} />
                        <input id="serviceZipCodes" name="serviceZipCodes" type="text" className={inputClasses} placeholder="e.g., 90210, 10001" value={formData.serviceZipCodes} onChange={handleInputChange} />
                    </div>
                    
                    <div className="relative">
                        <label htmlFor="services" className="block text-sm font-medium text-gray-700 mb-1">Services Offered</label>
                        <Select isMulti name="services" options={availableServices} className="basic-multi-select" classNamePrefix="select" value={formData.services} onChange={handleServicesChange} placeholder="Select services..." />
                    </div>

                    <div>
                        <button type="submit" disabled={loading} className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400">
                            {loading ? 'Creating Company...' : 'Create Company'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateNewCompany;
