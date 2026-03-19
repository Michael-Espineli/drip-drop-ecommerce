
import React, { useState, useEffect, useContext } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { MultiLocationMap } from '../../components/MultiLocationMap';
import toast from 'react-hot-toast';

const InfoField = ({ label, name, value, editMode, onChange, type = 'text', placeholder, infoText }) => (
    <div className="py-2">
        <label className="block text-sm font-medium text-gray-500">{label}</label>
        {editMode ? (
            <div>
                <input
                    type={type}
                    name={name}
                    value={value || ''}
                    onChange={onChange}
                    placeholder={placeholder}
                    className="mt-1 w-full p-2 bg-gray-50 border-2 border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition"
                />
                {infoText && <p className="text-xs text-gray-400 mt-1">{infoText}</p>}
            </div>
        ) : (
            <p className="mt-1 font-semibold text-gray-800 text-lg">{value || 'N/A'}</p>
        )}
    </div>
);

const CompanyInfo = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [company, setCompany] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [editMode, setEditMode] = useState(false);
    const [formData, setFormData] = useState({});
    const [zipCodeList, setZipCodeList] = useState([]);

    const getGeocode = async (address) => {
        try {
            const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=AIzaSyCeLjQNGFZ6W7pIYIXECBq7N47TBNKhivE`);
            const data = await response.json();
            if (data.status === 'OK') {
                const { lat, lng } = data.results[0].geometry.location;
                return { latitude: lat, longitude: lng };
            } else {
                console.error('Geocoding failed:', data.status);
                return null;
            }
        } catch (error) {
            console.error('Error during geocoding:', error);
            return null;
        }
    };

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setIsLoading(false);
            return;
        }

        const fetchCompany = async () => {
            setIsLoading(true);
            try {
                const docRef = doc(db, 'companies', recentlySelectedCompany);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const companyData = docSnap.data();
                    setCompany(companyData);
                    setFormData(companyData);
                    if (companyData.serviceZipCodes) {
                         const geocodedLocations = await Promise.all(
                            companyData.serviceZipCodes.map(zip => getGeocode(zip))
                        );
                        setZipCodeList(geocodedLocations.filter(Boolean));
                    }
                } else {
                    toast.error('Company not found.');
                }
            } catch (err) {
                console.error(err);
                toast.error('Failed to fetch company data.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchCompany();
    }, [recentlySelectedCompany]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        const isList = ['serviceZipCodes', 'services'].includes(name);
        const processedValue = isList ? value.split(',').map(item => item.trim()) : value;
        setFormData(prev => ({ ...prev, [name]: processedValue }));
    };

    const handleSave = async () => {
        const updatePromise = async () => {
            const docRef = doc(db, 'companies', recentlySelectedCompany);
            await updateDoc(docRef, formData);
            setCompany(formData);
            setEditMode(false);
            if(formData.serviceZipCodes) {
                 const geocodedLocations = await Promise.all(
                    formData.serviceZipCodes.map(zip => getGeocode(zip))
                );
                setZipCodeList(geocodedLocations.filter(Boolean));
            }
        };

        toast.promise(updatePromise(), {
            loading: 'Saving changes...',
            success: 'Information updated successfully!',
            error: 'Failed to save changes.',
        });
        toast('Information changes may affect verification status.', { icon: 'ℹ️' });
    };

    const handleCancel = () => {
        setFormData(company);
        setEditMode(false);
    };
    
    if (isLoading) return <div className="p-10 text-center">Loading...</div>;
    if (!company) return <div className="p-10 text-center text-gray-500">No company selected or data found.</div>;

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-5xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Company Information</h1>
                        <p className="text-gray-600 mt-1">View and manage your company profile.</p>
                    </div>
                    <div>
                    {!editMode ? (
                        <button onClick={() => setEditMode(true)} className='py-2 px-6 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700'>Edit</button>
                    ) : (
                        <div className='flex space-x-3'>
                            <button onClick={handleSave} className='py-2 px-6 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700'>Save</button>
                            <button onClick={handleCancel} className='py-2 px-6 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300'>Cancel</button>
                        </div>
                    )}
                    </div>
                </header>

                <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200 mb-8">
                    <h3 className="text-xl font-bold text-gray-800 mb-6 pb-4 border-b border-gray-200">Contact & Profile</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
                        <InfoField label="Company Name" name="name" value={formData.name} editMode={editMode} onChange={handleInputChange} />
                        <InfoField label="Contact Email" name="email" value={formData.email} editMode={editMode} onChange={handleInputChange} type="email" />
                        <InfoField label="Phone Number" name="phoneNumber" value={formData.phoneNumber} editMode={editMode} onChange={handleInputChange} type="tel" />
                        <InfoField label="Company Website" name="websiteURL" value={formData.websiteURL} editMode={editMode} onChange={handleInputChange} type="url" placeholder="https://..." />
                        <InfoField label="Yelp Profile URL" name="yelpURL" value={formData.yelpURL} editMode={editMode} onChange={handleInputChange} type="url" placeholder="https://yelp.com/biz/..." />
                        <InfoField label="Logo / Photo URL" name="photoUrl" value={formData.photoUrl} editMode={editMode} onChange={handleInputChange} type="url" placeholder="https://..." />
                    </div>
                </div>

                <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200 mb-8">
                    <h3 className="text-xl font-bold text-gray-800 mb-6 pb-4 border-b border-gray-200">Service Areas & Offerings</h3>
                    <div className='space-y-6'>
                        <InfoField 
                            label="Service Zip Codes" 
                            name="serviceZipCodes" 
                            value={formData.serviceZipCodes ? formData.serviceZipCodes.join(', ') : ''} 
                            editMode={editMode} 
                            onChange={handleInputChange} 
                            infoText="Separate multiple zip codes with a comma."
                        />
                        {zipCodeList.length > 0 && <div className='h-80 w-full rounded-lg overflow-hidden border-2 border-gray-200'><MultiLocationMap locations={zipCodeList}/></div>}
                        <InfoField 
                            label="Services Offered" 
                            name="services" 
                            value={formData.services ? formData.services.join(', ') : ''} 
                            editMode={editMode} 
                            onChange={handleInputChange} 
                            infoText="Separate multiple services with a comma."
                        />
                    </div>
                </div>
                
                 <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-200">
                    <h3 className="text-xl font-bold text-red-700 mb-2">Advanced</h3>
                    <div className="flex justify-between items-center">
                         <p className="text-gray-600">Transfer ownership of this company to another user.</p>
                         <button onClick={() => toast.error('This feature is not yet implemented.')} className='py-2 px-6 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700'>Change Owner</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CompanyInfo;
