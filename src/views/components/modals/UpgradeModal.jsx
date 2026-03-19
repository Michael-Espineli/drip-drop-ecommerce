 import React from 'react';
import { useNavigate } from 'react-router-dom';

const UpgradeModal = ({ isOpen, onClose, featureName }) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleUpgrade = () => {
        onClose(); // Close the modal
        navigate('/company/settings/subscriptions/picker'); // Navigate to the upgrade page
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 text-white p-8 rounded-lg shadow-2xl max-w-md w-full text-center">
                <h2 className="text-3xl font-bold text-yellow-500 mb-4">Limit Reached</h2>
                <p className="text-lg mb-6">
                    You have reached the maximum number of <span className="font-bold">{featureName}</span> allowed on your current plan.
                </p>
                <p className="text-gray-400 mb-8">
                    To add more {featureName}, please upgrade to a higher tier.
                </p>
                <div className="flex justify-center space-x-4">
                    <button 
                        onClick={onClose} 
                        className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-lg transition duration-300"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleUpgrade} 
                        className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg transition duration-300"
                    >
                        Upgrade Plan
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UpgradeModal;
