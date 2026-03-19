import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';

const ParticipantInfoModal = ({ isOpen, onClose, participant }) => {
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setUserData(null);
            return;
        }

        if (participant?.userId) {
            const fetchUserData = async () => {
                setLoading(true);
                try {
                    const userDocRef = doc(db, 'users', participant.userId);
                    const userDocSnap = await getDoc(userDocRef);

                    if (userDocSnap.exists()) {
                        setUserData(userDocSnap.data());
                    } else {
                        console.error("User document not found, falling back to participant prop.");
                        setUserData(participant); // Fallback to the prop data
                    }
                } catch (error) {
                    console.error("Error fetching user data:", error);
                    setUserData(participant); // Fallback on error
                } finally {
                    setLoading(false);
                }
            };

            fetchUserData();
        } else {
            setUserData(participant);
        }
    }, [isOpen, participant]);

    if (!isOpen) return null;

    const animation = 'animate-fade-in-up';

    const renderContent = () => {
        if (loading || !userData) {
            return (
                <div className="flex flex-col items-center animate-pulse w-full">
                    <div className="w-28 h-28 rounded-full bg-gray-200 border-4 border-gray-100"></div>
                    <div className="mt-4 h-7 w-48 bg-gray-200 rounded"></div>
                    <div className="mt-2 h-5 w-56 bg-gray-200 rounded"></div>
                    <div className="mt-6 border-t border-gray-200 w-full pt-4">
                        <div className="h-6 w-32 bg-gray-200 rounded"></div>
                        <div className="mt-3 space-y-3">
                            <div className="h-5 w-full bg-gray-200 rounded"></div>
                            <div className="h-5 w-full bg-gray-200 rounded"></div>
                        </div>
                    </div>
                </div>
            );
        }

        // Consolidate user data from fetched data and participant prop as a fallback
        const name = userData.firstName ? `${userData.firstName} ${userData.lastName}` : userData.userName;
        const email = userData.email || userData.userEmail;
        const image = userData.photoURL || userData.userImage;
        const phone = userData.phoneNumber || 'Not provided';

        return (
            <div className="flex flex-col items-center w-full">
                {image ? (
                    <img src={image} alt={name} className="w-28 h-28 rounded-full object-cover border-4 border-gray-100" />
                ) : (
                    <div className="w-28 h-28 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-5xl border-4 border-gray-100">
                        {name?.charAt(0).toUpperCase()}
                    </div>
                )}
                <h2 className="mt-4 text-2xl font-bold text-gray-800 text-center">{name}</h2>
                <p className="mt-1 text-md text-gray-500">{email}</p>

                <div className="mt-6 border-t border-gray-200 w-full pt-4">
                    <h3 className="text-lg font-semibold text-gray-700">Contact Information</h3>
                    <div className="mt-2 text-left w-full space-y-2 text-sm">
                        <p className="flex justify-between items-center">
                            <span className="font-semibold text-gray-600">Email:</span>
                            <span className="text-gray-800 truncate">{email}</span>
                        </p>
                        <p className="flex justify-between items-center">
                            <span className="font-semibold text-gray-600">Phone:</span>
                            <span className="text-gray-800">{phone}</span>
                        </p>
                    </div>
                </div>
                {/* <div className="mt-4 border-t border-gray-200 w-full pt-4">
                    <h3 className="text-lg font-semibold text-gray-700">Other Details</h3>
                    <div className="mt-2 text-left w-full space-y-2 text-sm">
                        <p className="flex justify-between items-center">
                            <span className="font-semibold text-gray-600">User ID:</span>
                            <span className="text-xs text-gray-500 select-all">{participant.userId}</span>
                        </p>
                    </div>
                </div> */}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">
            <div className={`bg-white rounded-lg shadow-xl p-6 w-full max-w-sm relative flex flex-col items-center ${animation}`}>
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full"
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>
                
                {renderContent()}

                <button
                    onClick={onClose}
                    className="mt-6 w-full bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                    Close
                </button>
            </div>
        </div>
    );
};

export default ParticipantInfoModal;
