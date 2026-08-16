
import React, { useState, useEffect, useContext } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import ShareItemButton from '../../components/share/ShareItemButton';
import {
    CheckCircleIcon,
    CloudArrowUpIcon,
    PencilSquareIcon,
    PhotoIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';

const inputBase =
    'w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500';

const textareaBase =
    'w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500';

const Field = ({ label, children }) => (
    <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
        {children}
    </div>
);

const InfoCard = ({ label, value, children, className = '' }) => (
    <div className={`rounded-lg border border-gray-200 bg-gray-50 p-4 ${className}`}>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
        {children || <p className="mt-1 font-semibold text-gray-800">{value}</p>}
    </div>
);

const Badge = ({ tone = 'gray', children }) => {
    const tones = {
        blue: 'bg-blue-100 text-blue-800',
        gray: 'bg-gray-100 text-gray-700',
        green: 'bg-green-100 text-green-800',
        yellow: 'bg-yellow-100 text-yellow-800',
    };

    return (
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${tones[tone] || tones.gray}`}>
            {children}
        </span>
    );
};

const displayValue = (value, fallback = 'N/A') => {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text || fallback;
};

const formatRate = (value) => {
    const text = displayValue(value, '');
    if (!text) return 'N/A';
    return text.startsWith('$') ? text : `$${text}`;
};

const serviceLocationAddress = (location = {}) => {
    const address = location.address || {};

    return [
        address.streetAddress,
        [address.city, address.state].filter(Boolean).join(', '),
        address.zip || address.zipCode,
    ].filter(Boolean).join(' ');
};

const serviceLocationContact = (location = {}) => location.mainContact || location.contact || {};

const isServiceLocationActive = (location = {}) => location.active !== false && location.isActive !== false;

const ServiceLocationDetails = () => {
    const { serviceLocationId } = useParams();
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

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
                <div className="w-full">
                    <div className="rounded-xl bg-white p-6 text-gray-600 shadow-lg">Loading...</div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
                <div className="w-full">
                    <div className="rounded-xl bg-white p-6 text-red-600 shadow-lg">Error: {error}</div>
                </div>
            </div>
        );
    }

    if (!serviceLocation) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
                <div className="w-full">
                    <div className="rounded-xl bg-white p-6 text-gray-600 shadow-lg">No Service Location found.</div>
                </div>
            </div>
        );
    }

    const locationPhotos = Array.isArray(serviceLocation.photoUrls) ? serviceLocation.photoUrls : [];
    const locationTitle = serviceLocation.nickName || serviceLocation.label || 'Service Location';
    const addressText = serviceLocationAddress(serviceLocation);
    const contact = serviceLocationContact(serviceLocation);
    const dogNames = asStringArray(serviceLocation.dogName).join(', ');
    const latitude = Number(serviceLocation.address?.latitude);
    const longitude = Number(serviceLocation.address?.longitude);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0);
    const active = isServiceLocationActive(serviceLocation);
    
    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="w-full space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <Link to="/company/serviceLocations" className="app-back-link">
                            &larr; Back to Service Locations
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">Service Location</h2>
                        <p className="mt-1 text-gray-600">
                            <span className="font-semibold text-gray-800">{locationTitle}</span>
                            {serviceLocation.customerId ? (
                                <Link
                                    to={`/company/customers/details/${serviceLocation.customerId}/locations`}
                                    className="hover:text-blue-800"
                                >
                                    <span className="text-gray-400"> - </span>
                                    {displayValue(serviceLocation.customerName)}
                                </Link>
                            ) : (
                                <>
                                    <span className="text-gray-400"> - </span>
                                    {displayValue(serviceLocation.customerName)}
                                </>
                            )}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <ShareItemButton
                            type="serviceLocation"
                            recordId={serviceLocationId}
                            title={locationTitle}
                            subtitle={[serviceLocation.customerName, serviceLocation.address?.streetAddress].filter(Boolean).join(' - ')}
                            companyId={recentlySelectedCompany}
                            customerId={serviceLocation.customerId}
                            collectionPath={`companies/${recentlySelectedCompany}/serviceLocations`}
                            webPath={`/company/serviceLocations/detail/${serviceLocationId}`}
                        />
                        {!edit ? (
                            can("44") && (
                                <button
                                    onClick={() => setEdit(true)}
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700"
                                    type="button"
                                >
                                    <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                                    Edit
                                </button>
                            )
                        ) : (
                            <>
                                <button
                                    onClick={handleSave}
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700"
                                    type="button"
                                >
                                    <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
                                    Save
                                </button>
                                <button
                                    onClick={handleCancel}
                                    className="inline-flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-300"
                                    type="button"
                                >
                                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                                    Cancel
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {hasCoordinates && (
                    <div className="overflow-hidden rounded-xl bg-white shadow-lg">
                        <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">Map</h3>
                                <p className="mt-1 text-sm text-gray-500">{addressText || 'Coordinates on file'}</p>
                            </div>
                            <Badge tone="blue">Pinned Location</Badge>
                        </div>
                        <MapComponent latitude={latitude} longitude={longitude} zoom={15} height="320px" />
                    </div>
                )}

                <div className="rounded-xl bg-white p-6 shadow-lg">
                    {!edit ? (
                        <div className="space-y-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">Location Information</h3>
                                    <p className="mt-1 text-sm text-gray-500">{addressText || 'No address on file'}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Badge tone={active ? 'green' : 'gray'}>{active ? 'Active' : 'Inactive'}</Badge>
                                    <Badge tone={serviceLocation.verified ? 'green' : 'yellow'}>
                                        {serviceLocation.verified ? 'Verified' : 'Unverified'}
                                    </Badge>
                                    <Badge tone={serviceLocation.preText ? 'blue' : 'gray'}>
                                        {serviceLocation.preText ? 'Pre-Service Text' : 'No Pre-Service Text'}
                                    </Badge>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <InfoCard label="Nickname" value={displayValue(serviceLocation.nickName)} />
                                <InfoCard label="Customer" value={displayValue(serviceLocation.customerName)} />
                                <InfoCard label="Address" value={addressText || 'N/A'} className="sm:col-span-2" />
                                <InfoCard label="Gate Code" value={displayValue(serviceLocation.gateCode)} />
                                <InfoCard label="Dog Name" value={dogNames || 'N/A'} />
                                <InfoCard label="Rate" value={formatRate(serviceLocation.rate)} />
                                <InfoCard
                                    label="Estimated Time"
                                    value={serviceLocation.estimatedTime ? `${serviceLocation.estimatedTime} min` : 'N/A'}
                                />
                                <InfoCard label="Main Contact" value={displayValue(contact.name)} />
                                <InfoCard label="Phone" value={displayValue(contact.phoneNumber)} />
                                <InfoCard label="Email" value={displayValue(contact.email)} />
                                <InfoCard label="Contact Notes" value={displayValue(contact.notes)} />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <h3 className="text-xl font-bold text-gray-800">Edit Service Location</h3>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <Field label="Nickname">
                                    <input
                                        type="text"
                                        value={nickName}
                                        onChange={e => setNickName(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="Street Address">
                                    <input
                                        type="text"
                                        value={streetAddress}
                                        onChange={e => setStreetAddress(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="City">
                                    <input
                                        type="text"
                                        value={city}
                                        onChange={e => setCity(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="State">
                                    <input
                                        type="text"
                                        value={state}
                                        onChange={e => setState(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="Zip Code">
                                    <input
                                        type="text"
                                        value={zipCode}
                                        onChange={e => setZipCode(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="Gate Code">
                                    <input
                                        type="text"
                                        value={gateCode}
                                        onChange={e => setGateCode(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="Dog Name">
                                    <input
                                        type="text"
                                        value={dogName}
                                        onChange={e => setDogName(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="Rate">
                                    <input
                                        type="number"
                                        value={rate}
                                        onChange={e => setRate(e.target.value)}
                                        className={inputBase}
                                    />
                                </Field>
                                <Field label="Pre-Service Text">
                                    <label className="flex min-h-[48px] items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                        <input
                                            type="checkbox"
                                            checked={preText}
                                            onChange={e => setPreText(e.target.checked)}
                                            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="font-semibold text-gray-700">{preText ? 'Enabled' : 'Disabled'}</span>
                                    </label>
                                </Field>
                            </div>
                        </div>
                    )}
                </div>

                <div className="rounded-xl bg-white p-6 shadow-lg">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h3 className="text-xl font-bold text-gray-800">Location Notes</h3>
                            <p className="mt-1 text-sm text-gray-500">Service instructions, access details, and technician notes.</p>
                        </div>
                        {can("44") && (
                            <button
                                type="button"
                                onClick={handleSaveNotes}
                                disabled={savingNotes}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
                                {savingNotes ? 'Saving...' : 'Save Notes'}
                            </button>
                        )}
                    </div>
                    <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        disabled={!can("44")}
                        rows="4"
                        className={textareaBase}
                        placeholder="Add service location notes..."
                    />
                </div>

                <div className="rounded-xl bg-white p-6 shadow-lg">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h3 className="text-xl font-bold text-gray-800">Location Photos</h3>
                            <p className="mt-1 text-sm text-gray-500">{locationPhotos.length} photo{locationPhotos.length === 1 ? '' : 's'} uploaded.</p>
                        </div>
                        {can("44") && (
                            <div className="flex flex-wrap gap-2">
                                <label
                                    htmlFor={`service-location-photo-upload-${serviceLocationId}`}
                                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                                >
                                    <PhotoIcon className="h-4 w-4" aria-hidden="true" />
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
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <CloudArrowUpIcon className="h-4 w-4" aria-hidden="true" />
                                    {uploadingPhotos ? 'Uploading...' : 'Upload'}
                                </button>
                            </div>
                        )}
                    </div>
                    {photoError && (
                        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{photoError}</p>
                    )}
                    {photoFiles.length > 0 && (
                        <p className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                            {photoFiles.length} file{photoFiles.length > 1 ? 's' : ''} selected
                        </p>
                    )}
                    {locationPhotos.length > 0 ? (
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                            {locationPhotos.map((photo, index) => {
                                const photoSrc = getServiceLocationPhotoUrl(photo);
                                const photoAlt = photo?.description || photo?.name || `Location photo ${index + 1}`;

                                return photoSrc ? (
                                    <a
                                        key={`${photoSrc}-${index}`}
                                        href={photoSrc}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block overflow-hidden rounded-lg border border-gray-200 bg-gray-50 transition hover:border-blue-200 hover:shadow-md"
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
                        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-gray-500">
                            No location photos uploaded.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ServiceLocationDetails;
