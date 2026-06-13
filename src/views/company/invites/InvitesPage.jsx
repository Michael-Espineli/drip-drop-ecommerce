import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { httpsCallable } from "firebase/functions";
import toast from 'react-hot-toast';
import { normalizeEmail } from '../../../utils/email';
import { CheckCircleIcon, InviteDetailModal, InviteSummaryCard, XMarkIcon } from './InviteDisplay';

const statusVariantsFor = (status) => {
    const normalized = String(status || 'pending').toLowerCase();
    if (normalized === 'rejected') return ['rejected', 'Rejected', 'declined', 'Declined', 'revoked', 'Revoked'];
    return [normalized, normalized.charAt(0).toUpperCase() + normalized.slice(1)];
};

const timestampMillis = (value) => {
    if (!value) return 0;
    if (value?.toDate) return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
};

const InvitesPage = ({ status: initialStatus }) => {
    const { user } = useContext(Context);
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedInvite, setSelectedInvite] = useState(null);
    const [actionLoadingId, setActionLoadingId] = useState('');
    const location = useLocation();

    const routeStatus = location.pathname.split('/').pop();
    const status = String(routeStatus || initialStatus || 'pending').toLowerCase();

    useEffect(() => {
        const normalizedUserEmail = normalizeEmail(user?.email);
        if (!normalizedUserEmail) {
            setInvites([]);
            setLoading(false);
            return undefined;
        }

        setLoading(true);

        const invitesRef = collection(db, 'invites');
        const statusVariants = statusVariantsFor(status);
        const q = query(invitesRef, where('email', '==', normalizedUserEmail), where('status', 'in', statusVariants));

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
    }, [user, status]);

    const handleInviteAction = async (inviteId, newStatus, invite) => {
        const inviteRef = doc(db, 'invites', inviteId);
        const loadingKey = `${inviteId}:${newStatus}`;
        setActionLoadingId(loadingKey);
        const toastId = toast.loading(newStatus === 'accepted' ? 'Accepting invite...' : 'Rejecting invite...');

        try {
            if (!user?.uid) {
                throw new Error('You must be signed in to accept an invite.');
            }

            if (newStatus === 'accepted') {
                const idToken = await user.getIdToken?.(true);
                const acceptTechInvite = httpsCallable(functions, 'acceptTechInvite');
                const result = await acceptTechInvite({
                    inviteId,
                    userId: user.uid,
                    idToken,
                    profile: {
                        firstName: user.firstName || invite?.firstName || '',
                        lastName: user.lastName || invite?.lastName || '',
                        email: normalizeEmail(user.email || invite?.email),
                        accountType: 'Company',
                    },
                });
                if (result.data?.status !== 200) {
                    throw new Error(result.data?.error || 'Invite could not be accepted.');
                }
                toast.success('Invite accepted.', { id: toastId });
            } else {
                await updateDoc(inviteRef, { status: newStatus, rejectedAt: serverTimestamp() });
                toast.success('Invite rejected.', { id: toastId });
            }
            setSelectedInvite(null);
        } catch (error) {
            console.error('Error updating invite status:', error);
            toast.error(error.message || 'Invite could not be updated.', { id: toastId });
        } finally {
            setActionLoadingId('');
        }
    };

    const Tab = ({ to, title, active }) => (
        <Link to={to} className={`rounded-md border px-4 py-2 text-sm font-semibold shadow-sm transition ${active ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
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

    const InviteActions = ({ invite }) => {
        const accepting = actionLoadingId === `${invite.id}:accepted`;
        const rejecting = actionLoadingId === `${invite.id}:rejected`;
        const disabled = Boolean(actionLoadingId);

        if (status !== 'pending') return null;

        return (
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => handleInviteAction(invite.id, 'accepted', invite)}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <CheckCircleIcon className="h-4 w-4" />
                    {accepting ? 'Accepting' : 'Accept'}
                </button>
                <button
                    type="button"
                    onClick={() => handleInviteAction(invite.id, 'rejected', invite)}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <XMarkIcon className="h-4 w-4" />
                    {rejecting ? 'Rejecting' : 'Reject'}
                </button>
            </div>
        );
    };

    return (
        <div className='min-h-screen w-full bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8'>
            <div className="mx-auto space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">My Invitations</h1>
                        <p className="mt-1 text-sm text-slate-500">Review and respond to company invitations.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Tab to="/invites/pending" title="Pending" active={status === 'pending'} />
                        <Tab to="/invites/accepted" title="Accepted" active={status === 'accepted'} />
                        <Tab to="/invites/rejected" title="Rejected" active={status === 'rejected'} />
                    </div>
                </div>

                {loading ? renderSkeleton() : (
                    <div className="space-y-4">
                        {invites.length > 0 ? (
                            invites.map(invite => (
                                <InviteSummaryCard
                                    key={invite.id}
                                    invite={invite}
                                    audience="tech"
                                    status={status}
                                    onOpen={() => setSelectedInvite(invite)}
                                    actions={<InviteActions invite={invite} />}
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

            <InviteDetailModal
                invite={selectedInvite}
                onClose={() => setSelectedInvite(null)}
                actions={selectedInvite ? <InviteActions invite={selectedInvite} /> : null}
            />
        </div>
    );
};

export default InvitesPage;
