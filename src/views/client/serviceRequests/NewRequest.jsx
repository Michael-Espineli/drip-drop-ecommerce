
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, where, addDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';

const NewRequest = () => {
    const { companyId } = useParams();
    const navigate = useNavigate();
    const { user } = useContext(Context);

    const [company, setCompany] = useState(null);
    const [userLocations, setUserLocations] = useState([]);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipment, setEquipment] = useState([]);
    
    const [selectedLocation, setSelectedLocation] = useState('');
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState('');
    const [selectedEquipment, setSelectedEquipment] = useState('');

    const [issueDescription, setIssueDescription] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [requestType, setRequestType] = useState('repair'); // 'repair' or 'service'

    useEffect(() => {
        const fetchData = async () => {
            if (!user?.uid || !companyId) return;

            try {
                // Fetch company details
                const companyDoc = await getDoc(doc(db, 'companies', companyId));
                if (companyDoc.exists()) {
                    setCompany({ id: companyDoc.id, ...companyDoc.data() });
                } else {
                    setError("Company not found.");
                }

                // Fetch user's service locations
                const locationsQuery = query(collection(db, 'homeOwnerServiceLocations'), where('userId', '==', user.uid));
                const locationsSnap = await getDocs(locationsQuery);
                const locations = locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setUserLocations(locations);

            } catch (err) {
                console.error(err);
                setError("Failed to load initial data. Please try again later.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [companyId, user]);

    // Effect to fetch bodies of water when location changes
    useEffect(() => {
        const fetchBodiesOfWater = async () => {
            if (!selectedLocation) {
                setBodiesOfWater([]);
                setSelectedBodyOfWater('');
                return;
            }
            const q = query(collection(db, 'homeOwnerBodiesOfWater'), where('serviceLocationId', '==', selectedLocation), where('userId', '==', user.uid));
            const snap = await getDocs(q);
            const bows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBodiesOfWater(bows);
        };

        fetchBodiesOfWater();
    }, [selectedLocation, user.uid]);

    // Effect to fetch equipment when body of water changes
    useEffect(() => {
        const fetchEquipment = async () => {
            if (!selectedBodyOfWater) {
                setEquipment([]);
                setSelectedEquipment('');
                return;
            }
            const q = query(collection(db, 'homeOwnerEquipment'), where('bodyOfWaterId', '==', selectedBodyOfWater), where('userId', '==', user.uid));
            const snap = await getDocs(q);
            const equip = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEquipment(equip);
        };

        fetchEquipment();
    }, [selectedBodyOfWater, user.uid]);


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedLocation || !issueDescription) {
            setError("Please fill in all required fields.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const location = userLocations.find(loc => loc.id === selectedLocation);
            const serviceLocationAddress = location ? location.address : {};
            let requestId = "hosr_" + uuidv4();
            await setDoc(doc(db, 'homeOwnerServiceRequests'), {
                id: requestId,
                source: 'Customer',
                status: 'Pending', //Pending, In Progress, Completed, Cancelled
                dateCreated: serverTimestamp(),
                companyId,
                companyName: company.name,
                serviceDescription:issueDescription,
                serviceName:'',
                serviceLocationAddress,
                creatorId: user.uid,
                creatorName: user.firstName + ' ' + user.lastName,
                customerId: '', //comp
                customerName: '', //comp
                homeOwnerName: user.firstName + ' ' + user.lastName, //shared
                homeOwnerEmail: '', //shared
                homeOwnerPhone: '', //shared
                homeOwnerId: '', //homeOwner
                homeOwnerserviceLocationId: selectedLocation, //homeOwner
                homeOwnerbodyOfWaterId: selectedBodyOfWater || "", //homeOwner
                homeOwnerequipmentId: selectedEquipment || "", //homeOwner
            });

            navigate('/client/service-requests');

        } catch (err) {
            console.error("Error creating service request: ", err);
            setError("Failed to submit request. Please try again.");
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return <div className="p-8">Loading...</div>;
    }

    if (error) {
        return <div className="p-8 text-red-500">Error: {error}</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Service Request From</h1>
                <h2 className="text-2xl font-semibold text-blue-600 mb-6">{company?.name}</h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="serviceLocation" className="block text-sm font-medium text-gray-700 mb-1">
                            Service Location
                        </label>
                        <select
                            id="serviceLocation"
                            name="serviceLocation"
                            value={selectedLocation}
                            onChange={(e) => setSelectedLocation(e.target.value)}
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                            required
                        >
                            <option value="" disabled>Select a location</option>
                            {userLocations.map(loc => (
                                <option key={loc.id} value={loc.id}>
                                    {loc.address.streetAddress || `Unnamed Location (ID: ${loc.id})`}
                                </option>
                            ))}
                        </select>
                    </div>

                    {selectedLocation && bodiesOfWater.length > 0 && (
                        <div>
                            <label htmlFor="bodyOfWater" className="block text-sm font-medium text-gray-700 mb-1">
                                Pool or Spa (Optional)
                            </label>
                            <select
                                id="bodyOfWater"
                                name="bodyOfWater"
                                value={selectedBodyOfWater}
                                onChange={(e) => setSelectedBodyOfWater(e.target.value)}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                            >
                                <option value="">Select a pool or spa</option>
                                {bodiesOfWater.map(bow => (
                                    <option key={bow.id} value={bow.id}>
                                        {bow.name || `Unnamed (ID: ${bow.id})`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {selectedBodyOfWater && equipment.length > 0 && (
                         <div>
                            <label htmlFor="equipment" className="block text-sm font-medium text-gray-700 mb-1">
                                Equipment (Optional)
                            </label>
                            <select
                                id="equipment"
                                name="equipment"
                                value={selectedEquipment}
                                onChange={(e) => setSelectedEquipment(e.target.value)}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                            >
                                <option value="">Select a piece of equipment</option>
                                {equipment.map(eq => (
                                    <option key={eq.id} value={eq.id}>
                                        {eq.name} ({eq.make} {eq.model})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Request Type
                        </label>
                        <div className="flex items-center space-x-4">
                             <label className="flex items-center">
                                <input
                                    type="radio"
                                    name="requestType"
                                    value="repair"
                                    checked={requestType === 'repair'}
                                    onChange={(e) => setRequestType(e.target.value)}
                                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                />
                                <span className="ml-2 text-sm text-gray-700">Repair / Issue</span>
                            </label>
                            <label className="flex items-center">
                                <input
                                    type="radio"
                                    name="requestType"
                                    value="service"
                                    checked={requestType === 'service'}
                                    onChange={(e) => setRequestType(e.target.value)}
                                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                />
                                <span className="ml-2 text-sm text-gray-700">General Service Inquiry</span>
                            </label>
                        </div>
                    </div>


                    <div>
                        <label htmlFor="issueDescription" className="block text-sm font-medium text-gray-700 mb-1">
                            {requestType === 'repair' ? 'Describe the issue' : 'How can we help?'}
                        </label>
                        <textarea
                            id="issueDescription"
                            name="issueDescription"
                            rows="4"
                            value={issueDescription}
                            onChange={(e) => setIssueDescription(e.target.value)}
                            className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            placeholder={requestType === 'repair' ? "e.g., The pump is making a loud grinding noise." : "e.g., I'd like to inquire about weekly maintenance plans."}
                            required
                        ></textarea>
                    </div>

                    <div className="text-right">
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400"
                        >
                            {isSubmitting ? 'Submitting...' : 'Submit Request'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NewRequest;
