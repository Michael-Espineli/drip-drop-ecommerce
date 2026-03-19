import React, { useState } from 'react';
import { acceptInvite, declineInvite } from '../../../utils/invites';

const AcceptInviteModal = ({ invite, user, onClose, onAcceptSuccess }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    const handleAccept = async () => {
        setLoading(true);
        setError('');
        try {
            const userName = user.displayName || `${invite.firstName} ${invite.lastName}`;
            await acceptInvite(invite, user.uid, userName);
            // Notify parent on success instead of navigating directly
            if (onAcceptSuccess) {
                onAcceptSuccess();
            }
        } catch (err) {
            console.error("Error accepting invite:", err);
            setError('Failed to accept invite. Please try again.');
            setLoading(false);
        }
    };

    const handleDecline = async () => {
        setLoading(true);
        setError('');
        try {
            await declineInvite(invite);
            onClose(); // Close modal on decline
        } catch (err) {
            console.error("Error declining invite:", err);
            setError('Failed to decline invite. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-xl shadow-2xl p-8 max-w-sm w-full">
                <h2 className="text-2xl font-bold text-gray-800 text-center mb-2">You're Invited!</h2>
                <p className="text-center text-gray-600 mb-6">
                    You have been invited to join <span className="font-semibold">{invite.companyName}</span>.
                </p>
                
                {error && <p className="bg-red-100 text-red-700 p-3 rounded-lg text-sm mb-4">{error}</p>}

                <div className="flex flex-col space-y-3">
                    <button 
                        onClick={handleAccept} 
                        disabled={loading}
                        className="w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-blue-300 transition"
                    >
                        {loading ? 'Accepting...' : 'Accept Invite'}
                    </button>
                    <button 
                        onClick={handleDecline} 
                        disabled={loading}
                        className="w-full py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                    >
                        Decline
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AcceptInviteModal;
