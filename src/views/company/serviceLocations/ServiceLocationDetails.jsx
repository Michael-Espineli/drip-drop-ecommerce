
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, storage } from '../../../utils/config';
import { arrayUnion, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import MapComponent from '../../components/MapComponent';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import {
    asStringArray,
    normalizeAddress,
    normalizeServiceLocationForFirestore,
} from '../../../utils/customerLocationData';
import {
    buildCompanyServiceLocationPhotoPath,
    getServiceLocationPhotoUrl,
    uploadServiceLocationPhoto,
    validateServiceLocationPhotoFile,
} from '../../../utils/serviceLocationPhotos';

const ServiceLocationDetails = () => {
    const { serviceLocationId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();

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
    const [savingNotes, setSavingNotes] = useState(false);
    const [photoFiles, setPhotoFiles] = useState([]);
    const [uploadingPhotos, setUploadingPhotos] = useState(false);
    const [photoError, setPhotoError] = useState('');
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
                    setZipCode(slData.address?.zip || slData.address?.zipCode || '');
                    setGateCode(slData.gateCode);
                    setDogName(asStringArray(slData.dogName).join(', '));
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

    useEffect(() => {
        setPhotoFiles([]);
    }, [serviceLocationId]);

    const handleCancel = () => {
        setEdit(false);
        if (serviceLocation) {
            setNickName(serviceLocation.nickName);
            setStreetAddress(serviceLocation.address?.streetAddress || '');
            setCity(serviceLocation.address?.city || '');
            setState(serviceLocation.address?.state || '');
            setZipCode(serviceLocation.address?.zip || serviceLocation.address?.zipCode || '');
            setGateCode(serviceLocation.gateCode);
            setDogName(asStringArray(serviceLocation.dogName).join(', '));
            setNotes(serviceLocation.notes);
            setRate(serviceLocation.rate);
            setPreText(serviceLocation.preText);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!requirePermission("44", "update service locations")) return;

        const updatedData = normalizeServiceLocationForFirestore({
            ...serviceLocation,
            nickName,
            gateCode,
            dogName: dogName.split(',').map((name) => name.trim()).filter(Boolean),
            notes,
            rate,
            preText,
            address: normalizeAddress({
                ...serviceLocation.address,
                streetAddress,
                city,
                state,
                zip: zipCode,
            }),
        });

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

    const handleSaveNotes = async () => {
        if (!requirePermission("44", "update service locations")) return;
        if (!recentlySelectedCompany || !serviceLocationId) return;

        setSavingNotes(true);
        try {
            const docRef = doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId);
            await updateDoc(docRef, {
                notes,
                updatedAt: serverTimestamp(),
            });
            setServiceLocation(prev => ({ ...prev, notes }));
        } catch (err) {
            console.error('Error updating location notes: ', err);
            setError('Failed to save location notes.');
        } finally {
            setSavingNotes(false);
        }
    };

    const handlePhotoSelection = (event) => {
        const files = Array.from(event.target.files || []);
        const validationMessage = files.map(validateServiceLocationPhotoFile).find(Boolean);

        if (validationMessage) {
            setPhotoError(validationMessage);
            setPhotoFiles([]);
        } else {
            setPhotoError('');
            setPhotoFiles(files);
        }

        event.target.value = '';
    };

    const handleUploadPhotos = async () => {
        if (!photoFiles.length || uploadingPhotos) return;
        if (!requirePermission("44", "update service locations")) return;
        if (!recentlySelectedCompany || !serviceLocationId) return;

        setUploadingPhotos(true);
        try {
            const uploadedPhotos = await Promise.all(
                photoFiles.map((file) => uploadServiceLocationPhoto({
                    storage,
                    file,
                    path: buildCompanyServiceLocationPhotoPath({
                        companyId: recentlySelectedCompany,
                        serviceLocationId,
                        file,
                    }),
                    description: file.name,
                }))
            );

            const docRef = doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId);
            await updateDoc(docRef, {
                photoUrls: arrayUnion(...uploadedPhotos),
                updatedAt: serverTimestamp(),
            });
            setServiceLocation(prev => ({
                ...prev,
                photoUrls: [
                    ...(Array.isArray(prev?.photoUrls) ? prev.photoUrls : []),
                    ...uploadedPhotos,
                ],
            }));
            setPhotoFiles([]);
            setPhotoError('');
        } catch (err) {
            console.error('Error uploading location photos: ', err);
            setPhotoError('Failed to upload location photos.');
        } finally {
            setUploadingPhotos(false);
        }
    };

    if (loading) return <div className="p-4">Loading...</div>;
    if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
    if (!serviceLocation) return <div className="p-4">No Service Location found.</div>;

    const locationPhotos = Array.isArray(serviceLocation.photoUrls) ? serviceLocation.photoUrls : [];
    
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
                        {can("44") && (
                            <button onClick={() => setEdit(true)} className='bg-blue-500 hover:bg-blue-700 cursor-pointer font-normal ml-2 rounded text-white px-4 py-1 text-base'>Edit</button>
                        )}
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
                            <div className="flex items-center gap-2"><input type="checkbox" checked={preText} onChange={e => setPreText(e.target.checked)} className="h-4 w-4" /><label>Pre-Service Text</label></div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><strong>Nickname:</strong> <p>{serviceLocation.nickName}</p></div>
                            <div><strong>Customer:</strong> <p>{serviceLocation.customerName}</p></div>
                            <div className="md:col-span-2"><strong>Address:</strong> <p>{`${serviceLocation.address?.streetAddress}, ${serviceLocation.address?.city}, ${serviceLocation.address?.state} ${serviceLocation.address?.zip || serviceLocation.address?.zipCode}`}</p></div>
                            <div><strong>Gate Code:</strong> <p>{serviceLocation.gateCode}</p></div>
                            <div><strong>Dog Name:</strong> <p>{asStringArray(serviceLocation.dogName).join(', ')}</p></div>
                            <div><strong>Rate:</strong> <p>${serviceLocation.rate}</p></div>
                            <div><strong>Pre-Service Text:</strong> <p>{serviceLocation.preText ? 'Yes' : 'No'}</p></div>
                        </div>
                    )}

                    <div className="mt-4 rounded-md bg-[#102d6e] p-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                            <strong>Location Notes</strong>
                            {can("44") && (
                                <button
                                    type="button"
                                    onClick={handleSaveNotes}
                                    disabled={savingNotes}
                                    className="rounded bg-green-500 px-4 py-1 text-sm font-normal text-white hover:bg-green-700 disabled:opacity-60"
                                >
                                    {savingNotes ? 'Saving...' : 'Save Notes'}
                                </button>
                            )}
                        </div>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            disabled={!can("44")}
                            rows="4"
                            className="w-full rounded-md bg-gray-700 p-2 text-white disabled:cursor-not-allowed disabled:opacity-70"
                            placeholder="Add service location notes..."
                        />
                    </div>

                    <div className="mt-4 rounded-md bg-[#102d6e] p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <strong>Location Photos</strong>
                            {can("44") && (
                                <div className="flex flex-wrap gap-2">
                                    <label
                                        htmlFor={`service-location-photo-upload-${serviceLocationId}`}
                                        className="cursor-pointer rounded bg-white px-4 py-1 text-sm font-normal text-[#0e245c] hover:bg-slate-100"
                                    >
                                        Select Photos
                                        <input
                                            id={`service-location-photo-upload-${serviceLocationId}`}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={handlePhotoSelection}
                                            className="sr-only"
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleUploadPhotos}
                                        disabled={!photoFiles.length || uploadingPhotos}
                                        className="rounded bg-blue-500 px-4 py-1 text-sm font-normal text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {uploadingPhotos ? 'Uploading...' : 'Upload'}
                                    </button>
                                </div>
                            )}
                        </div>
                        {photoError && (
                            <p className="mb-3 text-sm text-red-200">{photoError}</p>
                        )}
                        {photoFiles.length > 0 && (
                            <p className="mb-3 text-sm text-[#d0d2d6]">
                                {photoFiles.length} file{photoFiles.length > 1 ? 's' : ''} selected
                            </p>
                        )}
                        {locationPhotos.length > 0 ? (
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                {locationPhotos.map((photo, index) => {
                                    const photoSrc = getServiceLocationPhotoUrl(photo);
                                    const photoAlt = photo?.description || photo?.name || `Location photo ${index + 1}`;

                                    return photoSrc ? (
                                        <a
                                            key={`${photoSrc}-${index}`}
                                            href={photoSrc}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block overflow-hidden rounded-md border border-[#d0d2d6]/30 bg-[#0e245c]"
                                        >
                                            <img
                                                src={photoSrc}
                                                alt={photoAlt}
                                                className="aspect-square w-full object-cover"
                                            />
                                        </a>
                                    ) : null;
                                })}
                            </div>
                        ) : (
                            <p>No location photos uploaded.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ServiceLocationDetails;
