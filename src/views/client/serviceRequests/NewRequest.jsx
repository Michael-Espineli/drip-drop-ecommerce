
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, where, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import {
    CONVERSATION_LINK_TYPES,
    getUserDisplayName,
    isChatVisibleTo,
    sendChatMessage,
} from '../../../utils/chatMessaging';
import CompanySummaryCard, { getCompanySummary } from './CompanySummaryCard';

const NewRequest = () => {
    const { companyId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user, dataBaseUser } = useContext(Context);
    const sourceChatId = searchParams.get('chatId') || '';

    const [company, setCompany] = useState(null);
    const [userLocations, setUserLocations] = useState([]);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipment, setEquipment] = useState([]);

    const [selectedLocation, setSelectedLocation] = useState('');
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState('');
    const [selectedEquipment, setSelectedEquipment] = useState('');

    const [issueDescription, setIssueDescription] = useState('Id like to inquire about weekly maintenance plans.');
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [requestType, setRequestType] = useState('service'); // 'repair' or 'service'

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
                const locationsQuery = query(collection(db, 'homeownerServiceLocations'), where('userId', '==', user.uid));
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
            if (!selectedLocation || !user?.uid) {
                setBodiesOfWater([]);
                setSelectedBodyOfWater('');
                return;
            }
            const q = query(collection(db, 'homeownerBodiesOfWater'), where('serviceLocationId', '==', selectedLocation), where('userId', '==', user.uid));
            const snap = await getDocs(q);
            const bows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBodiesOfWater(bows);
        };

        fetchBodiesOfWater();
    }, [selectedLocation, user?.uid]);

    // Effect to fetch equipment when body of water changes
    useEffect(() => {
        const fetchEquipment = async () => {
            if (!selectedBodyOfWater || !user?.uid) {
                setEquipment([]);
                setSelectedEquipment('');
                return;
            }
            const q = query(collection(db, 'homeownerEquipment'), where('bodyOfWaterId', '==', selectedBodyOfWater), where('userId', '==', user.uid));
            const snap = await getDocs(q);
            const equip = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEquipment(equip);
        };

        fetchEquipment();
    }, [selectedBodyOfWater, user?.uid]);


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
            const companySummary = getCompanySummary(company || { id: companyId });
            const requestCompanySummary = {
                ...companySummary,
                bio: companySummary.bio.slice(0, 280),
                services: companySummary.services.slice(0, 8),
            };
            let requestId = "hosr_" + uuidv4();
            await setDoc(doc(db, 'homeownerServiceRequests', requestId), {
                id: requestId,
                source: 'Customer',
                status: 'Pending', //Pending, In Progress, Completed, Cancelled
                createdAt: serverTimestamp(),
                companyId,
                companyName: companySummary.name,
                companySummary: requestCompanySummary,
                serviceDescription: issueDescription,
                serviceName: '',
                serviceLocationAddress,
                creatorId: user.uid,
                creatorName: dataBaseUser.firstName + ' ' + dataBaseUser.lastName,
                customerId: '', //comp
                customerName: '', //comp
                customerUserId: user.uid,
                homeownerName: dataBaseUser.firstName + ' ' + dataBaseUser.lastName, //shared
                homeownerEmail: dataBaseUser.email || user.email || '', //shared
                homeownerPhone: dataBaseUser.phoneNumber || dataBaseUser.phone || '', //shared
                homeownerId: user.uid, //homeowner
                homeownerServiceLocationId: selectedLocation, //homeowner
                homeownerBodyOfWaterId: selectedBodyOfWater || "", //homeowner
                homeownerEquipmentId: selectedEquipment || "", //homeowner
                relationshipId: '',
                customerCompanyRelationshipId: '',
                requestType,
            });

            if (sourceChatId) {
                try {
                    const chatSnap = await getDoc(doc(db, 'chats', sourceChatId));
                    if (chatSnap.exists()) {
                        const chatData = { id: chatSnap.id, ...chatSnap.data() };
                        const chatCompanyId = chatData.companyId || chatData.receiverCompanyId || '';
                        const chatMatchesRequest = chatCompanyId === companyId && isChatVisibleTo(chatData, user.uid);

                        if (chatMatchesRequest) {
                            await sendChatMessage({
                                db,
                                chatId: sourceChatId,
                                chat: chatData,
                                text: 'I submitted a service request.',
                                link: {
                                    type: CONVERSATION_LINK_TYPES.serviceRequest,
                                    recordId: requestId,
                                    title: requestType === 'repair' ? 'Repair / Issue Request' : 'Service Request',
                                    subtitle: issueDescription,
                                    companyId,
                                    customerUserId: user.uid,
                                    collectionPath: 'homeownerServiceRequests',
                                    clientWebPath: `/client/service-requests/${requestId}`,
                                    companyWebPath: `/company/leads/${requestId}`,
                                },
                                senderId: user.uid,
                                senderName: getUserDisplayName(dataBaseUser, user),
                            });

                            navigate(`/client/chat/details/${sourceChatId}`);
                            return;
                        }
                    }
                } catch (chatError) {
                    console.error("Error linking service request to chat: ", chatError);
                }
            }

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
            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Service Request</h1>
                </div>

                {company && (
                    <CompanySummaryCard company={company} companyId={companyId} />
                )}

                <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-gray-900">Request Details</h2>
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
                                    {loc.address.streetAddress || loc.name || "Unnamed Location"}
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
                                        {bow.name || "Unnamed Body of Water"}
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
