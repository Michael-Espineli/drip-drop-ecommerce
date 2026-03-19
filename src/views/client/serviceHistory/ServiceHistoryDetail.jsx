
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { ArrowLeftIcon, CalendarDaysIcon, UserIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const ServiceHistoryDetail = () => {
    const { serviceStopId } = useParams();
    const { user } = useContext(Context);
    const navigate = useNavigate();

    const [serviceStop, setServiceStop] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user || !serviceStopId) {
            setLoading(false);
            return;
        }

        const fetchServiceStop = async () => {
            setLoading(true);
            try {
                const stopDocRef = doc(db, 'homeOwnerServiceStops', serviceStopId);
                const stopDocSnap = await getDoc(stopDocRef);

                if (!stopDocSnap.exists() || stopDocSnap.data().userId !== user.uid) {
                    setError('Service stop not found or you do not have permission to view it.');
                    setLoading(false);
                    return;
                }

                setServiceStop({ id: stopDocSnap.id, ...stopDocSnap.data() });

            } catch (err) {
                console.error("Error fetching service stop:", err);
                setError('Failed to load service stop details.');
            } finally {
                setLoading(false);
            }
        };

        fetchServiceStop();
    }, [serviceStopId, user]);

    if (loading) {
        return <div className="p-8 text-center">Loading details...</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">{error}</div>;
    }

    if (!serviceStop) {
        return null;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <Header 
                    companyName={serviceStop.companyName} 
                    serviceType={serviceStop.type} 
                    onBack={() => navigate(-1)} 
                />
                
                <div className="bg-white rounded-lg shadow-md mt-8">
                    <div className="p-6 space-y-6">
                        <InfoItem 
                            icon={CalendarDaysIcon} 
                            label="Service Date"
                            value={serviceStop.serviceDate ? format(serviceStop.serviceDate.toDate(), 'PPP') : 'N/A'}
                        />
                        <InfoItem 
                            icon={UserIcon} 
                            label="Technician"
                            value={serviceStop.techName || 'Not specified'}
                        />
                        <InfoItem 
                            icon={DocumentTextIcon} 
                            label="Service Notes"
                            value={serviceStop.notes || 'No notes were provided for this service.'}
                            isBlock={true}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

const Header = ({ companyName, serviceType, onBack }) => (
    <div className="flex flex-col gap-2">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 w-fit">
            <ArrowLeftIcon className="w-5 h-5" />
            Back
        </button>
        <h1 className="text-3xl font-bold text-gray-900">{companyName}</h1>
        <p className="text-lg text-gray-600">{serviceType} Details</p>
    </div>
);

const InfoItem = ({ icon: Icon, label, value, isBlock = false }) => (
    <div>
        <div className="flex items-center gap-3">
            <Icon className="w-6 h-6 text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-800">{label}</h3>
        </div>
        <div className={`mt-2 ${isBlock ? '' : 'pl-9'}`}>
            <p className="text-gray-700 whitespace-pre-wrap">{value}</p>
        </div>
    </div>
);

export default ServiceHistoryDetail;
