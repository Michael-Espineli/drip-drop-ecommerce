import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { getFunctions, httpsCallable } from "firebase/functions";
const functions = getFunctions();

const InvitesPage = ({ status: initialStatus }) => {
    const { user } = useContext(Context);
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(true);
    const location = useLocation();

    const status = location.pathname.split('/').pop();

    useEffect(() => {
        if (!user?.email) return;
        console.log("User Email: ",user.email)
        console.log("Status: ",status)
        
        const invitesRef = collection(db, 'invites');
        const q = query(invitesRef, where('email', '==', user.email), where('status', '==', status));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newInvites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            console.log("New Invites: ",newInvites)
            setInvites(newInvites);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching invites: ", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, status]);

    const handleInviteAction = async (inviteId, newStatus) => {
        const inviteRef = doc(db, 'invites', inviteId);
        try {
            await updateDoc(inviteRef, { status: newStatus });
            if (newStatus === 'accepted') {
                const acceptTechInvite = httpsCallable(functions, 'acceptTechInvite');
                const result = await acceptTechInvite({ inviteId: inviteId, userId: user.uid });
                console.log("result: ",result)
            }
        } catch (error) {
            console.error('Error updating invite status:', error);
        }
    };

    const Tab = ({ to, title, active }) => (
        <Link to={to} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>
            {title}
        </Link>
    );

    const renderSkeleton = () => (
        <div className="space-y-4 animate-pulse">
            {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white p-4 rounded-lg shadow flex justify-between items-center">
                    <div className="flex flex-col gap-2">
                        <div className="h-5 w-40 bg-gray-200 rounded"></div>
                        <div className="h-4 w-60 bg-gray-200 rounded"></div>
                    </div>
                    <div className="h-8 w-20 bg-gray-200 rounded"></div>
                </div>
            ))}
        </div>
    );

    const InviteCard = ({ invite }) => (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
                <h3 className="font-bold text-lg text-gray-800">{invite.companyName}</h3>
                <p className="text-sm text-gray-500">Sent by: {invite.sentBy}</p>
            </div>
            {status === 'pending' && (
                <div className="flex gap-2 mt-2 sm:mt-0">
                    <button onClick={() => handleInviteAction(invite.id, 'accepted')} className="bg-green-500 text-white px-3 py-1 rounded-md text-sm font-semibold hover:bg-green-600 transition-colors">Accept</button>
                    <button onClick={() => handleInviteAction(invite.id, 'rejected')} className="bg-red-500 text-white px-3 py-1 rounded-md text-sm font-semibold hover:bg-red-600 transition-colors">Reject</button>
                </div>
            )}
        </div>
    );

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">My Invitations</h1>
                
                <div className="flex space-x-2 border-b mb-6">
                    <Tab to="/invites/pending" title="Pending" active={status === 'pending'} />
                    <Tab to="/invites/accepted" title="Accepted" active={status === 'accepted'} />
                    <Tab to="/invites/rejected" title="Rejected" active={status === 'rejected'} />
                </div>

                {loading ? renderSkeleton() : (
                    <div className="space-y-4">
                        {invites.length > 0 ? (
                            invites.map(invite => <InviteCard key={invite.id} invite={invite} />)
                        ) : (
                            <div className="text-center py-12">
                                <p className="text-gray-500">No {status} invitations found.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default InvitesPage;
