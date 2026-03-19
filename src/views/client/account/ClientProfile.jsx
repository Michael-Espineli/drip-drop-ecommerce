
import React, { useState, useEffect, useContext } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { UserCircleIcon, PencilIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

const ClientProfile = () => {
    const { user } = useContext(Context);
    const [isEditing, setIsEditing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    // Editable form state
    const [formState, setFormState] = useState({
        name: '',
        email: '',
        phoneNumber: ''
    });

    useEffect(() => {
        // The component is no longer loading if user data is present
        // or if the authentication check is complete and there is no user.
        console.log("user: ", user, ", loading: ", loading)
        if (user) {
            setFormState({
                name: (user.firstName + ' ' + user.lastName) || '',
                email: user.email || '',
                phoneNumber: user.phoneNumber || ''
            });
            setLoading(false);
        } else if (user === null) {
            // If auth check is done and there's no user, stop loading.
            setLoading(false);
        }
        console.log("user: ", user, ", loading: ", loading)
    }, [user]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormState(prevState => ({ ...prevState, [name]: value }));
    };

    const handleSave = async () => {
        if (!user) return;
        setIsSaving(true);
        setError(null);
        try {
            const userDocRef = doc(db, 'users', user.uid);
            await updateDoc(userDocRef, {
                name: formState.name,
                phoneNumber: formState.phoneNumber
            });
            setIsEditing(false);
        } catch (err) {
            console.error("Error updating profile:", err);
            setError("Failed to save changes. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        if (user) {
            setFormState({
                name: (user.firstName + ' ' + user.lastName) || '',
                email: user.email || '',
                phoneNumber: user.phoneNumber || ''
            });
        }
        setIsEditing(false);
    };

    if (loading) {
        return <div className="p-8 text-center">Loading profile...</div>;
    }

    // After loading, if there's no user, show a message.
    if (!user ) {
        return <div className="p-8 text-center text-gray-500">Could not load profile. Please make sure you are logged in.</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <Header isEditing={isEditing} onEdit={() => setIsEditing(true)} />
                <div className="bg-white rounded-lg shadow-md mt-8 p-6 md:p-8">
                    {isEditing ? (
                        <EditProfileView
                            formState={formState}
                            onInputChange={handleInputChange}
                            onSave={handleSave}
                            onCancel={handleCancel}
                            isSaving={isSaving}
                            error={error}
                        />
                    ) : (
                        <DisplayProfileView userData={user} />
                    )}
                </div>
            </div>
        </div>
    );
};

const Header = ({ isEditing, onEdit }) => (
    <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">My Profile</h1>
        {!isEditing && (
            <button
                onClick={onEdit}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
                <PencilIcon className="w-5 h-5" />
                Edit Profile
            </button>
        )}
    </div>
);

const DisplayProfileView = ({ userData }) => (
    <div className="space-y-6">
        <InfoRow label="Full Name" value={(userData?.firstName, " ", userData?.lastName)} />
        <InfoRow label="Email Address" value={userData?.email} />
        <InfoRow label="Phone Number" value={userData?.phoneNumber || 'Not provided'} />
    </div>
);

const EditProfileView = ({ formState, onInputChange, onSave, onCancel, isSaving, error }) => {
    const inputClass = "w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

    return (
        <div className="space-y-6">
            <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input type="text" name="name" id="name" value={formState.name} onChange={onInputChange} className={inputClass} />
            </div>
            <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input type="email" name="email" id="email" value={formState.email} className={`${inputClass} bg-gray-200 cursor-not-allowed`} disabled />
                <p className="text-xs text-gray-500 mt-1">Email address cannot be changed.</p>
            </div>
            <div>
                <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input type="tel" name="phoneNumber" id="phoneNumber" value={formState.phoneNumber} onChange={onInputChange} className={inputClass} />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end items-center gap-4 pt-4">
                <button onClick={onCancel} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg">
                    Cancel
                </button>
                <button
                    onClick={onSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 disabled:bg-gray-400"
                >
                    <CheckIcon className="w-5 h-5" />
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
};

const InfoRow = ({ label, value }) => (
    <div>
        <h3 className="text-sm font-medium text-gray-500">{label}</h3>
        <p className="mt-1 text-lg text-gray-900">{value}</p>
    </div>
);

export default ClientProfile;
