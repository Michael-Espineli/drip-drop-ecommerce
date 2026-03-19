import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Link } from 'react-router-dom';
import { InboxIcon, CheckCircleIcon, XCircleIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

const InvitesWidget = () => {
    const { user } = useContext(Context);
    const [inviteCounts, setInviteCounts] = useState({ pending: 0, accepted: 0, rejected: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.email) return;

        const invitesRef = collection(db, 'invites');
        const q = query(invitesRef, where('email', '==', user.email));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const counts = { pending: 0, accepted: 0, rejected: 0 };
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.status in counts) {
                    counts[data.status]++;
                }
            });
            setInviteCounts(counts);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching invite counts: ", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const renderSkeleton = () => (
        <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="space-y-3">
                <div className="h-5 bg-gray-200 rounded w-3/4"></div>
                <div className="h-5 bg-gray-200 rounded w-3/4"></div>
                <div className="h-5 bg-gray-200 rounded w-3/4"></div>
            </div>
        </div>
    );

    const StatLink = ({ to, icon, label, count, colorClass }) => (
        <Link to={to} className="flex items-center justify-between p-3 rounded-md hover:bg-gray-100 transition-colors duration-200">
            <div className="flex items-center gap-3">
                {icon}
                <span className="font-semibold text-gray-700">{label}</span>
            </div>
            <div className={`flex items-center gap-2 ${colorClass}`}>
                <span className="font-bold">{count}</span>
                <ArrowRightIcon className="w-4 h-4" />
            </div>
        </Link>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-md h-full flex flex-col">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">My Invitations</h3>
            <div className="flex-grow">
                {loading ? renderSkeleton() : (
                    <div className="space-y-2">
                        <StatLink 
                            to="/invites/pending"
                            icon={<InboxIcon className="w-6 h-6 text-yellow-500" />}
                            label="Pending"
                            count={inviteCounts.pending}
                            colorClass="text-yellow-600"
                        />
                        <StatLink 
                            to="/invites/accepted"
                            icon={<CheckCircleIcon className="w-6 h-6 text-green-500" />}
                            label="Accepted"
                            count={inviteCounts.accepted}
                            colorClass="text-green-600"
                        />
                        <StatLink 
                            to="/invites/rejected"
                            icon={<XCircleIcon className="w-6 h-6 text-red-500" />}
                            label="Rejected"
                            count={inviteCounts.rejected}
                            colorClass="text-red-600"
                        />
                    </div>
                )}
            </div>
             <div className="mt-6 text-center">
                <Link to="/company/selection">
                    <button className="w-full bg-white text-[#0e245c] font-bold py-2 px-4 rounded-lg border-2 border-[#0e245c] hover:bg-gray-50 transition-colors duration-300">
                        Select a Company
                    </button>
                </Link>
            </div>
        </div>
    );
};

export default InvitesWidget;
