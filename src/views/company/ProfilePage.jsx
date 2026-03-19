import React, { useState, useContext, useEffect, useCallback } from "react";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Context } from "../../context/AuthContext";
import { doc, updateDoc } from "firebase/firestore";
import { db } from '../../utils/config';
import toast from 'react-hot-toast';

const functions = getFunctions();

// Helper Components for a cleaner structure
const ProfileCard = ({ title, children, actions }) => (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-800">{title}</h2>
            {actions && <div>{actions}</div>}
        </div>
        <div className="p-6 space-y-4">
            {children}
        </div>
    </div>
);

const InfoRow = ({ label, value }) => (
    <div className="grid grid-cols-3 gap-4 items-center">
        <p className="text-sm font-semibold text-gray-600 col-span-1">{label}</p>
        <p className="text-sm text-gray-800 col-span-2">{value || 'Not set'}</p>
    </div>
);

const FormField = ({ label, type = 'text', value, onChange, placeholder }) => (
    <div className="grid grid-cols-3 gap-4 items-center">
        <label className="text-sm font-semibold text-gray-700 col-span-1">{label}</label>
        <input 
            type={type} 
            value={value} 
            onChange={onChange} 
            placeholder={placeholder} 
            className="col-span-2 bg-gray-50 border-2 border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-full p-2.5"
        />
    </div>
);

const DeleteModal = ({ onConfirm, onCancel }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">Are you sure?</h3>
            <p className="text-gray-600 mb-8">This action is irreversible and will permanently delete your account.</p>
            <div className="flex justify-end space-x-4">
                <button onClick={onCancel} className='py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Cancel</button>
                <button onClick={onConfirm} className='py-2 px-5 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition'>Delete Account</button>
            </div>
        </div>
    </div>
);

export default function ProfilePage() {
    const { user, dataBaseUser, setDataBaseUser, stripeConnectedAccountId } = useContext(Context);
    
    const [editMode, setEditMode] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [formData, setFormData] = useState({});

    const [stripeLoading, setStripeLoading] = useState({
        create: false,
        link: false
    });

    useEffect(() => {
        if (dataBaseUser) {
            setFormData({
                firstName: dataBaseUser.firstName || '',
                lastName: dataBaseUser.lastName || '',
                email: dataBaseUser.email || '',
                phoneNumber: dataBaseUser.phoneNumber || '',
                bio: dataBaseUser.bio || ''
            });
        }
    }, [dataBaseUser]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleUpdateUser = async () => {
        const userDocRef = doc(db, 'users', user.uid);
        const toastId = toast.loading('Updating profile...');
        try {
            await updateDoc(userDocRef, formData);
            setDataBaseUser(prev => ({ ...prev, ...formData }));
            setEditMode(false);
            toast.success('Profile updated successfully!', { id: toastId });
        } catch (error) {
            console.error("Error updating user:", error);
            toast.error('Failed to update profile.', { id: toastId });
        }
    };

    const handleDeleteAccount = async () => {
        const toastId = toast.loading('Deleting account...');
        try {
            const deleteUserCallable = httpsCallable(functions, 'deleteUser');
            await deleteUserCallable({});
            toast.success('Account deleted successfully.', { id: toastId });
            // Note: User will be signed out automatically by backend functions
        } catch (error) {
            console.error("Error deleting account:", error);
            toast.error('Failed to delete account.', { id: toastId });
        }
        setShowDeleteModal(false);
    };

    const handleStripeAction = useCallback(async (action) => {
        const callableName = action === 'create' ? 'createNewStripeAccount' : 'createStripeAccountLink';
        const loadingKey = action === 'create' ? 'create' : 'link';

        setStripeLoading(prev => ({ ...prev, [loadingKey]: true }));
        const toastId = toast.loading(`Processing Stripe request...`);

        try {
            const callable = httpsCallable(functions, callableName);
            const response = await callable({ account: stripeConnectedAccountId });
            
            const { error, account, accountLink } = response.data;

            if (error) throw new Error(error.message || 'An unknown error occurred');

            if (action === 'create' && account) {
                await updateDoc(doc(db, 'users', user.uid), { stripeConnectedAccountId: account });
                toast.success('Stripe account created! Redirecting...', { id: toastId });
                // Fall through to create and redirect via account link
            }

            if (accountLink && accountLink.url) {
                window.location.href = accountLink.url;
            }

        } catch (err) {
            console.error(`Stripe ${action} error:`, err);
            toast.error(err.message || `Failed to ${action} Stripe account.`, { id: toastId });
        } finally {
            setStripeLoading(prev => ({ ...prev, [loadingKey]: false }));
        }
    }, [stripeConnectedAccountId, user.uid]);

    const renderAccountInfo = () => {
        if (editMode) {
            return (
                <div className="space-y-4">
                    <FormField label="First Name" name="firstName" value={formData.firstName} onChange={handleInputChange} />
                    <FormField label="Last Name" name="lastName" value={formData.lastName} onChange={handleInputChange} />
                    <FormField label="Email" type="email" name="email" value={formData.email} onChange={handleInputChange} />
                    <FormField label="Phone" type="tel" name="phoneNumber" value={formData.phoneNumber} onChange={handleInputChange} />
                    <FormField label="Bio" name="bio" value={formData.bio} onChange={handleInputChange} />
                </div>
            );
        }
        return (
            <div className="space-y-3">
                <InfoRow label="Name" value={`${dataBaseUser.firstName} ${dataBaseUser.lastName}`} />
                <InfoRow label="Email" value={dataBaseUser.email} />
                <InfoRow label="Phone" value={dataBaseUser.phoneNumber} />
                <InfoRow label="Bio" value={dataBaseUser.bio} />
            </div>
        );
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="flex items-center space-x-6 mb-10">
                    <img className='h-24 w-24 rounded-full object-cover border-4 border-white shadow-lg' src={dataBaseUser.photoUrl} alt="Profile" />
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">{`${dataBaseUser.firstName} ${dataBaseUser.lastName}`}</h1>
                        <p className="text-gray-600">{dataBaseUser.email}</p>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                        <ProfileCard 
                            title="Account Info"
                            actions={
                                <div className="flex space-x-2">
                                    {editMode ? (
                                        <>
                                            <button onClick={() => setEditMode(false)} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg text-sm hover:bg-gray-300 transition'>Cancel</button>
                                            <button onClick={handleUpdateUser} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-700 transition'>Save</button>
                                        </>
                                    ) : (
                                        <button onClick={() => setEditMode(true)} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-700 transition'>Edit Profile</button>
                                    )}
                                </div>
                            }
                        >
                            {renderAccountInfo()}
                        </ProfileCard>

                        <ProfileCard title="External Accounts">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-semibold text-gray-800">Stripe</p>
                                        <p className="text-sm text-gray-500">Connect your Stripe account to process payments.</p>
                                    </div>
                                    {!stripeConnectedAccountId ? (
                                        <button onClick={() => handleStripeAction('create')} disabled={stripeLoading.create} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-700 transition disabled:bg-blue-300'>
                                            {stripeLoading.create ? 'Creating...' : 'Connect Stripe'}
                                        </button>
                                    ) : (
                                        <button onClick={() => handleStripeAction('link')} disabled={stripeLoading.link} className='py-2 px-4 bg-green-600 text-white font-semibold rounded-lg text-sm hover:bg-green-700 transition disabled:bg-green-300'>
                                            {stripeLoading.link ? 'Redirecting...' : 'Manage Account'}
                                        </button>
                                    )}
                                </div>
                                {/* Add QuickBooks connection here in the future */}
                            </div>
                        </ProfileCard>
                    </div>

                    <div className="lg:col-span-1 space-y-8">
                        <ProfileCard title="Settings">
                             <button 
                                onClick={() => setShowDeleteModal(true)} 
                                className="w-full text-left py-3 px-4 bg-red-50 text-red-700 font-semibold rounded-lg hover:bg-red-100 transition"
                            >
                                Delete My Account
                            </button>
                        </ProfileCard>
                    </div>
                </div>
            </div>
            {showDeleteModal && <DeleteModal onConfirm={handleDeleteAccount} onCancel={() => setShowDeleteModal(false)} />}
        </div>
    );
}
