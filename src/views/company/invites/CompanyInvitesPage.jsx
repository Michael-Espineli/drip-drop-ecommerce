import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { InviteDetailModal, InviteSummaryCard } from './InviteDisplay';

const statusVariantsFor = (status) => {
    const normalized = String(status || 'pending').toLowerCase();
    if (normalized === 'rejected') return ['rejected', 'Rejected', 'declined', 'Declined'];
    return [normalized, normalized.charAt(0).toUpperCase() + normalized.slice(1)];
};

const timestampMillis = (value) => {
    if (!value) return 0;
    if (value?.toDate) return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
};

const CompanyInvitesPage = ({ status: initialStatus }) => {
    const { recentlySelectedCompany } = useContext(Context);
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedInvite, setSelectedInvite] = useState(null);
    const location = useLocation();

    const routeStatus = location.pathname.split('/').pop();
    const status = String(routeStatus || initialStatus || 'pending').toLowerCase();

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setInvites([]);
            setLoading(false);
            return undefined;
        }

        setLoading(true);

        const invitesRef = collection(db, 'invites');
        const statusVariants = statusVariantsFor(status);
        const q = query(invitesRef, where('companyId', '==', recentlySelectedCompany), where('status', 'in', statusVariants));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newInvites = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => timestampMillis(b.dateCreated || b.createdAt || b.acceptedAt || b.rejectedAt) - timestampMillis(a.dateCreated || a.createdAt || a.acceptedAt || a.rejectedAt));

            setInvites(newInvites);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching invites: ", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [recentlySelectedCompany, status]);

    const Tab = ({ to, title, active }) => (
        <Link to={to}
            className={`rounded-md border px-4 py-2 text-sm font-semibold shadow-sm transition ${active ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}

        >
            {title}
        </Link>
    );

    const renderSkeleton = () => (
        <div className="space-y-4 animate-pulse">
            {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3">
                        <div className="h-5 w-40 rounded bg-slate-200"></div>
                        <div className="h-4 w-60 rounded bg-slate-200"></div>
                        <div className="grid gap-3 md:grid-cols-4">
                            <div className="h-4 rounded bg-slate-100"></div>
                            <div className="h-4 rounded bg-slate-100"></div>
                            <div className="h-4 rounded bg-slate-100"></div>
                            <div className="h-4 rounded bg-slate-100"></div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    return (
        <div className='min-h-screen w-full bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8'>
            <div className="mx-auto space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <Link
                            to="/company/companyUsers"
                            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                            Back to Company Users
                        </Link>
                        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Company Invitations</h1>
                        <p className="mt-1 text-sm text-slate-500">Review user invitations for this company.</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Tab to="/company/invites/pending" title="Pending" active={status === 'pending'} />
                        <Tab to="/company/invites/accepted" title="Accepted" active={status === 'accepted'} />
                        <Tab to="/company/invites/rejected" title="Rejected" active={status === 'rejected'} />
                    </div>
                </div>

                {loading ? renderSkeleton() : (
                    <div className="space-y-4">
                        {invites.length > 0 ? (
                            invites.map(invite => (
                                <InviteSummaryCard
                                    key={invite.id}
                                    invite={invite}
                                    audience="company"
                                    status={status}
                                    onOpen={() => setSelectedInvite(invite)}
                                />
                            ))
                        ) : (
                            <div className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center">
                                <p className="text-sm font-medium text-slate-500">No {status} invitations found.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <InviteDetailModal invite={selectedInvite} onClose={() => setSelectedInvite(null)} />
        </div>
    );
};

export default CompanyInvitesPage;
