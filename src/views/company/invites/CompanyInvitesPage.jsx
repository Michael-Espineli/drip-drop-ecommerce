import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';

const CompanyInvitesPage = ({ status: initialStatus }) => {
    const { recentlySelectedCompany } = useContext(Context);
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(true);
    const location = useLocation();

    const status = location.pathname.split('/').pop();

    useEffect(() => {
        if (!recentlySelectedCompany) return;
        console.log("Recently Selected Company: ", recentlySelectedCompany)
        console.log("Status: ", status)

        const invitesRef = collection(db, 'invites');
        const statusVariants = [status, status.charAt(0).toUpperCase() + status.slice(1)];
        const q = query(invitesRef, where('companyId', '==', recentlySelectedCompany), where('status', 'in', statusVariants));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newInvites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            console.log("New Invites: ", newInvites)
            setInvites(newInvites);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching invites: ", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [recentlySelectedCompany, status]);

    const handleInviteAction = async (inviteId, newStatus) => {
        try {
            //Update or Delete 

            // await updateDoc(inviteRef, { status: newStatus });
            // if (newStatus === 'accepted') {
            //     const acceptTechInvite = httpsCallable(functions, 'acceptTechInvite');
            //     const result = await acceptTechInvite({ inviteId: inviteId, userId: user.uid });
            //     console.log("result: ", result)
            // }
        } catch (error) {
            console.error('Error updating invite status:', error);
        }
    };

    const Tab = ({ to, title, active }) => (
        <Link to={to}
            className={`px-4 py-2 text-sm font-medium rounded-xl shadow-sm transition border ${active ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}

        >
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
                    <button onClick={() => handleInviteAction(invite.id, 'update')}
                        className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                    >Update</button>
                    <button onClick={() => handleInviteAction(invite.id, 'delete')}
                        className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"

                    >Delete</button>
                </div>
            )}
        </div>
    );

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="mx-auto">
                <div>

                    <Link
                        to="/company/companyUsers"
                        className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                    >
                        &larr; Back to Company Users
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-800 mb-6">My Invitations</h1>

                    <p className="text-gray-600 mt-1">Review invitations sent to other companies</p>
                </div>

                <div className="flex space-x-2 mb-6">
                    <Tab to="/company/invites/pending" title="Pending" active={status === 'pending'} />
                    <Tab to="/company/invites/accepted" title="Accepted" active={status === 'accepted'} />
                    <Tab to="/company/invites/rejected" title="Rejected" active={status === 'rejected'} />
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

export default CompanyInvitesPage;
