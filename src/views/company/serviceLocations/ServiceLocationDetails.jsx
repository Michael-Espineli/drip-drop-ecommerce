
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import MapComponent from '../../components/MapComponent';

const ServiceLocationDetails = () => {
    const { serviceLocationId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);

    const [serviceLocation, setServiceLocation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [edit, setEdit] = useState(false);

    // Model fields state for editing
    const [nickName, setNickName] = useState('');
    const [streetAddress, setStreetAddress] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [zipCode, setZipCode] = useState('');
    const [gateCode, setGateCode] = useState('');
    const [dogName, setDogName] = useState('');
    const [notes, setNotes] = useState('');
    const [rate, setRate] = useState(0);
    const [preText, setPreText] = useState(false);

    useEffect(() => {
        if (!recentlySelectedCompany || !serviceLocationId) return;

        const fetchServiceLocation = async () => {
            setLoading(true);
            try {
                const docRef = doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const slData = ServiceLocation.fromFirestore(docSnap);
                    setServiceLocation(slData);
                    
                    // Populate state for editing
                    setNickName(slData.nickName);
                    setStreetAddress(slData.address?.streetAddress || '');
                    setCity(slData.address?.city || '');
                    setState(slData.address?.state || '');
                    setZipCode(slData.address?.zipCode || '');
                    setGateCode(slData.gateCode);
                    setDogName(slData.dogName);
                    setNotes(slData.notes);
                    setRate(slData.rate);
                    setPreText(slData.preText);

                } else {
                    setError('Service Location not found.');
                }
            } catch (err) {
                console.error(err);
                setError('Failed to fetch service location data.');
            } finally {
                setLoading(false);
            }
        };

        fetchServiceLocation();
    }, [serviceLocationId, recentlySelectedCompany]);

    const handleCancel = () => {
        setEdit(false);
        if (serviceLocation) {
            setNickName(serviceLocation.nickName);
            setStreetAddress(serviceLocation.address?.streetAddress || '');
            setCity(serviceLocation.address?.city || '');
            setState(serviceLocation.address?.state || '');
            setZipCode(serviceLocation.address?.zipCode || '');
            setGateCode(serviceLocation.gateCode);
            setDogName(serviceLocation.dogName);
            setNotes(serviceLocation.notes);
            setRate(serviceLocation.rate);
            setPreText(serviceLocation.preText);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const updatedData = {
            nickName,
            gateCode,
            dogName,
            notes,
            rate: Number(rate),
            preText,
            address: {
                ...serviceLocation.address,
                streetAddress,
                city,
                state,
                zipCode,
            },
        };

        try {
            const docRef = doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId);
            await updateDoc(docRef, updatedData);
            setServiceLocation(prev => ({ ...prev, ...updatedData }));
            setEdit(false);
        } catch (err) {
            console.error('Error updating document: ', err);
            setError('Failed to save changes.');
        }
    };

    if (loading) return <div className="p-4">Loading...</div>;
    if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
    if (!serviceLocation) return <div className="p-4">No Service Location found.</div>;
    
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                {edit ? (
                    <div className='px-4 py-1'>
                        <div className='w-full flex justify-between py-1'>
                            <button onClick={handleSave} className='bg-green-500 hover:bg-green-700 cursor-pointer font-normal rounded text-white px-4 py-1 text-base'>Save</button>
                            <button onClick={handleCancel} className='bg-red-500 hover:bg-red-700 cursor-pointer rounded text-white px-4 py-1 text-base'>Cancel</button>
                        </div>
                    </div>
                ) : (
                    <div className='w-full flex justify-between items-center'>
                        <h1 className='font-bold text-xl'>Service Location Information</h1>
                        <button onClick={() => setEdit(true)} className='bg-blue-500 hover:bg-blue-700 cursor-pointer font-normal ml-2 rounded text-white px-4 py-1 text-base'>Edit</button>
                    </div>
                )}

                {serviceLocation.address?.latitude && serviceLocation.address?.longitude && (
                    <div className="mt-4">
                        <MapComponent latitude={serviceLocation.address.latitude} longitude={serviceLocation.address.longitude} zoom={15}/>
                    </div>
                )}
                
                <div className='w-full bg-[#1c3a8a] p-4 rounded-md mt-4'>
                    {edit ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><label>Nickname</label><input type="text" value={nickName} onChange={e => setNickName(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div><label>Street Address</label><input type="text" value={streetAddress} onChange={e => setStreetAddress(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div><label>City</label><input type="text" value={city} onChange={e => setCity(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div><label>State</label><input type="text" value={state} onChange={e => setState(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div><label>Zip Code</label><input type="text" value={zipCode} onChange={e => setZipCode(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div><label>Gate Code</label><input type="text" value={gateCode} onChange={e => setGateCode(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div><label>Dog Name</label><input type="text" value={dogName} onChange={e => setDogName(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div><label>Rate</label><input type="number" value={rate} onChange={e => setRate(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div className="md:col-span-2"><label>Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-1 bg-gray-700 rounded-md" /></div>
                            <div className="flex items-center gap-2"><input type="checkbox" checked={preText} onChange={e => setPreText(e.target.checked)} className="h-4 w-4" /><label>Pre-Service Text</label></div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><strong>Nickname:</strong> <p>{serviceLocation.nickName}</p></div>
                            <div><strong>Customer:</strong> <p>{serviceLocation.customerName}</p></div>
                            <div className="md:col-span-2"><strong>Address:</strong> <p>{`${serviceLocation.address?.streetAddress}, ${serviceLocation.address?.city}, ${serviceLocation.address?.state} ${serviceLocation.address?.zipCode}`}</p></div>
                            <div><strong>Gate Code:</strong> <p>{serviceLocation.gateCode}</p></div>
                            <div><strong>Dog Name:</strong> <p>{serviceLocation.dogName}</p></div>
                            <div><strong>Rate:</strong> <p>${serviceLocation.rate}</p></div>
                            <div className="md:col-span-2"><strong>Notes:</strong> <p>{serviceLocation.notes}</p></div>
                            <div><strong>Pre-Service Text:</strong> <p>{serviceLocation.preText ? 'Yes' : 'No'}</p></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ServiceLocationDetails;
