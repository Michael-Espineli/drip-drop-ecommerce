import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, storage } from '../../../firebase'; // Corrected import
import { collection, query, where, getDocs, setDoc, serverTimestamp, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Context } from '../../../context/AuthContext';
import { RepairRequest } from '../../../utils/models/RepairRequest';
import { ArrowUpOnSquareIcon, PhotoIcon } from '@heroicons/react/24/solid';
import {v4 as uuidv4} from 'uuid';

const NewRepairRequest = () => {
    const { user } = useContext(Context);
    const navigate = useNavigate();

    const [serviceLocations, setServiceLocations] = useState([]);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipment, setEquipment] = useState([]);

    const [selectedLocation, setSelectedLocation] = useState('');
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState('');
    const [selectedEquipment, setSelectedEquipment] = useState('');
    const [description, setDescription] = useState('');
    const [files, setFiles] = useState([]);
    const [filePreviews, setFilePreviews] = useState([]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Fetch service locations
    useEffect(() => {
        if (!user) return;
        const fetchLocations = async () => {
            const q = query(collection(db, 'homeOwnerServiceLocations'), where('userId', '==', user.uid));
            const querySnapshot = await getDocs(q);
            setServiceLocations(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        };
        fetchLocations();
    }, [user]);

    // Fetch bodies of water based on location
    useEffect(() => {
        if (!selectedLocation) {
            setBodiesOfWater([]);
            setSelectedBodyOfWater('');
            return;
        }
        const fetchBodiesOfWater = async () => {
            const q = query(collection(db, 'homeOwnerBodiesOfWater'), where('serviceLocationId', '==', selectedLocation));
            const querySnapshot = await getDocs(q);
            setBodiesOfWater(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        };
        fetchBodiesOfWater();
    }, [selectedLocation]);

    // Fetch equipment based on body of water
    useEffect(() => {
        if (!selectedBodyOfWater) {
            setEquipment([]);
            setSelectedEquipment('');
            return;
        }
        const fetchEquipment = async () => {
            const q = query(collection(db, 'homeOwnerEquipment'), where('bodyOfWaterId', '==', selectedBodyOfWater));
            const querySnapshot = await getDocs(q);
            setEquipment(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        };
        fetchEquipment();
    }, [selectedBodyOfWater]);

    const handleFileChange = (e) => {
        const selectedFiles = Array.from(e.target.files);
        setFiles(selectedFiles);

        const previews = selectedFiles.map(file => URL.createObjectURL(file));
        setFilePreviews(previews);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!description || !selectedLocation) {
            setError('Please fill out all required fields.');
            return;
        }
        setIsLoading(true);
        setError('');

        try {
            // 1. Upload photos
            const photoUrls = await Promise.all(
                files.map(async (file) => {
                    const storageRef = ref(storage, `repair-requests/${user.uid}/${Date.now()}_${file.name}`);
                    await uploadBytes(storageRef, file);
                    return getDownloadURL(storageRef);
                })
            );

            // 2. Create RepairRequest object
            const repairRequestId = "rr_" + uuidv4();
            const newRequest = new RepairRequest({
                id:repairRequestId,
                requesterId: user.uid,
                requesterName: user.displayName || 'N/A',
                date: new Date(),
                status: 'pending',
                description,
                photoUrls,
                locationId: selectedLocation,
                bodyOfWaterId: selectedBodyOfWater,
                equipmentId: selectedEquipment,
                userId:user.uid
            });
            
            // 3. Save to Firestore
            await setDoc(doc(db, 'homeOwnerRepairRequests',repairRequestId), {
                ...newRequest.toFirestore(),
                createdAt: serverTimestamp()
            });

            setIsLoading(false);
            navigate('/client/repair-requests');
        } catch (err) {
            console.error("Error submitting repair request: ", err);
            setError('Failed to submit repair request. Please try again.');
            setIsLoading(false);
        }
    };

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50">
            <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow-md">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">New Repair Request</h1>
                <form onSubmit={handleSubmit} className="space-y-6">
                    
                    <div>
                        <label htmlFor="location" className="block text-sm font-medium text-gray-700">Service Location</label>
                        <select id="location" value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md" required>
                            <option value="">Select a location</option>
                            {serviceLocations.map(loc => <option key={loc.id} value={loc.id}>{loc.nickName || loc.address.streetAddress}</option>)}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="bodyOfWater" className="block text-sm font-medium text-gray-700">Body of Water (Optional)</label>
                        <select id="bodyOfWater" value={selectedBodyOfWater} onChange={(e) => setSelectedBodyOfWater(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md" disabled={!selectedLocation}>
                            <option value="">Select a body of water</option>
                            {bodiesOfWater.map(bow => <option key={bow.id} value={bow.id}>{bow.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="equipment" className="block text-sm font-medium text-gray-700">Equipment (Optional)</label>
                        <select id="equipment" value={selectedEquipment} onChange={(e) => setSelectedEquipment(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md" disabled={!selectedBodyOfWater}>
                            <option value="">Select equipment</option>
                            {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description of Issue</label>
                        <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" required />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Upload Photos</label>
                        <div className="mt-2 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                            <div className="space-y-1 text-center">
                                <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
                                <div className="flex text-sm text-gray-600">
                                    <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
                                        <span>Upload files</span>
                                        <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} multiple />
                                    </label>
                                    <p className="pl-1">or drag and drop</p>
                                </div>
                                <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
                            </div>
                        </div>
                        {filePreviews.length > 0 && (
                            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                {filePreviews.map((preview, index) => (
                                    <img key={index} src={preview} alt="Preview" className="h-24 w-full object-cover rounded-md" />
                                ))}
                            </div>
                        )}
                    </div>

                    {error && <p className="text-sm text-red-600">{error}</p>}

                    <div className="flex justify-end">
                        <button type="button" onClick={() => navigate('/client/repair-requests')} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                            Cancel
                        </button>
                        <button type="submit" disabled={isLoading} className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50">
                            {isLoading ? 'Submitting...' : 'Submit Request'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NewRepairRequest;
