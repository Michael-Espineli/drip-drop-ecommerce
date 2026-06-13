import React, { useMemo, useState, useEffect, useContext, useCallback } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { acceptInvite, extractCompanyInviteId } from '../../utils/invites';
import { Context } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { normalizeEmail } from '../../utils/email';
import { CONFIRM_USER_EMAIL_ON_INVITE_FEATURE_FLAG_ID } from '../../utils/models/FeatureFlag';

const db = getFirestore();
const auth = getAuth();

const getCompanyDisplayName = (company = {}) => (
    String(company.name || company.companyName || company.displayName || company.businessName || "").trim()
);

const hydrateInviteCompanyName = async (inviteData) => {
    const companyId = String(inviteData?.companyId || inviteData?.linkedCompanyId || '').trim();
    if (!companyId) return inviteData;

    try {
        const companySnap = await getDoc(doc(db, "companies", companyId));
        if (!companySnap.exists()) return inviteData;

        const companyName = getCompanyDisplayName(companySnap.data());
        if (!companyName) return inviteData;

        return {
            ...inviteData,
            companyName,
        };
    } catch (error) {
        console.error("Error loading invite company:", error);
        return inviteData;
    }
};

export default function RedeemInviteCode() {
    const { user, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
    const navigate = useNavigate();
    const location = useLocation();
    const { inviteId: routeInviteId } = useParams();

    const [inviteCode, setInviteCode] = useState('');
    const [invite, setInvite] = useState(null);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const queryInviteId = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return extractCompanyInviteId(params.get('inviteId') || params.get('id') || '');
    }, [location.search]);
    const linkedInviteId = useMemo(
        () => extractCompanyInviteId(routeInviteId || queryInviteId || ''),
        [queryInviteId, routeInviteId]
    );
    const userEmailMatchesInvite = !invite?.email || !user?.email || normalizeEmail(user.email) === normalizeEmail(invite.email);
    const inviteCompanyName = invite?.companyName || 'this company';

    const loadInviteById = useCallback(async (rawInviteId, { showSuccessToast = false } = {}) => {
        const nextInviteId = extractCompanyInviteId(rawInviteId);
        if (!nextInviteId) {
            toast.error('Please enter a valid invite code or invite link.');
            return null;
        }

        setLoading(true);
        try {
            const inviteRef = doc(db, "invites", nextInviteId);
            const inviteSnap = await getDoc(inviteRef);

            if (!inviteSnap.exists()) {
                throw new Error('This invite is invalid or could not be found.');
            }

            const inviteData = { id: inviteSnap.id, ...inviteSnap.data() };
            const inviteStatus = String(inviteData.status || '').toLowerCase();

            if (inviteStatus !== 'pending') {
                throw new Error('This invite is no longer pending.');
            }

            const hydratedInvite = await hydrateInviteCompanyName(inviteData);

            setInviteCode(nextInviteId);
            setInvite(hydratedInvite);

            if (showSuccessToast) {
                toast.success('Invite code is valid.');
            }

            if (hydratedInvite.currentUser && !user) {
                const redirectPath = linkedInviteId ? `${location.pathname}${location.search}` : `/company/invite/${nextInviteId}`;
                toast.error('This invite is for an existing user. Please sign in to accept it.');
                navigate(`/signIn?redirect=${encodeURIComponent(redirectPath)}`);
            }

            return hydratedInvite;
        } catch (err) {
            console.error("Error checking invite:", err);
            setInvite(null);
            toast.error(err.message || 'Could not verify the invite code.');
            return null;
        } finally {
            setLoading(false);
        }
    }, [linkedInviteId, location.pathname, location.search, navigate, user]);

    useEffect(() => {
        if (!linkedInviteId) return;
        loadInviteById(linkedInviteId);
    }, [linkedInviteId, loadInviteById]);

    const handleCheckInvite = async (e) => {
        e.preventDefault();
        await loadInviteById(inviteCode, { showSuccessToast: true });
    };

    const readConfirmEmailOnInviteEnabled = useCallback(async () => {
        if (featureFlagsLoaded) {
            return isFeatureEnabled(CONFIRM_USER_EMAIL_ON_INVITE_FEATURE_FLAG_ID);
        }

        try {
            const flagSnap = await getDoc(doc(db, "featureFlags", CONFIRM_USER_EMAIL_ON_INVITE_FEATURE_FLAG_ID));
            return Boolean(flagSnap.exists() && flagSnap.data()?.enabled);
        } catch (error) {
            console.error("Error loading confirm-email feature flag:", error);
            return false;
        }
    }, [featureFlagsLoaded, isFeatureEnabled]);

    const handleSignUpAndAccept = async (e) => {
        e.preventDefault();
        if (!password) {
            return toast.error('Please create a password.');
        }
        if(password.length < 8) {
            return toast.error("Password must be at least 8 characters long")
        }
        if (!confirmPassword) {
            return toast.error('Please confirm your password.');
        }
        if (password !== confirmPassword) {
            return toast.error('Passwords do not match.');
        }

        setLoading(true);
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, invite.email, password);
            const newUser = userCredential.user;
            const confirmEmailOnInviteEnabled = await readConfirmEmailOnInviteEnabled();

            if (confirmEmailOnInviteEnabled && !newUser.emailVerified) {
                try {
                    await sendEmailVerification(newUser);
                } catch (verificationError) {
                    console.error("Error sending verification email:", verificationError);
                    toast.error("Account created, but the verification email could not be sent. You can resend it from company selection.");
                }
            }

            await acceptInvite(invite, newUser.uid, invite.firstName, invite.lastName, invite.email);
            toast.success(confirmEmailOnInviteEnabled
                ? 'Account created. Verify your email to access the company.'
                : 'Account created and invite accepted!'
            );
            navigate(confirmEmailOnInviteEnabled && !newUser.emailVerified ? '/company/selector?verifyEmail=1' : '/company/dashboard');
        } catch (err) {
            console.error("Sign up error:", err);
            toast.error(err.code === 'auth/email-already-in-use' 
                ? 'This email is already in use. Please sign in to accept the invite.' 
                : 'Failed to create account.');
        } finally {
            setLoading(false);
        }
    };

    const handleExistingUserAccept = async (e) => {
        e.preventDefault();
        if (!user || !invite) return;

        setLoading(true);
        try {
            await acceptInvite(invite, user.uid, invite.firstName, invite.lastName, invite.email);
            toast.success('Invite accepted successfully!');
            navigate('/company/dashboard');
        } catch (err) {
            console.error("Error accepting invite:", err);
            toast.error('There was an error accepting the invite.');
        } finally {
            setLoading(false);
        }
    };

    const renderInitial = () => (
        <form onSubmit={handleCheckInvite} className="space-y-4">
            <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter invite code or invite link"
                className="w-full px-3 py-3 border rounded-md"
            />
            <button type="submit" disabled={loading} className="w-full py-3 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium disabled:opacity-50">
                {loading ? 'Verifying...' : 'Redeem Invite'}
            </button>
        </form>
    );

    const renderAcceptForNewUser = () => (
        <form onSubmit={handleSignUpAndAccept} className="space-y-4">
            <p className="text-center text-gray-600">Welcome! You've been invited to join <strong>{inviteCompanyName}</strong>.</p>
            {invite.roleName ? (
                <p className="text-center text-sm text-gray-500">Role: <strong>{invite.roleName}</strong></p>
            ) : null}
            <input type="email" value={invite.email} disabled className="w-full px-3 py-3 border rounded-md bg-gray-100"/>
            <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password (min. 8 characters)"
                className="w-full px-3 py-3 border rounded-md"
            />
            <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full px-3 py-3 border rounded-md"
            />
            <button type="submit" disabled={loading} className="w-full py-3 rounded-md text-white bg-green-600 hover:bg-green-700 font-medium disabled:opacity-50">
                {loading ? 'Creating Account...' : 'Accept & Create Account'}
            </button>
        </form>
    );

    const renderAcceptForExistingUser = () => (
        <div className="text-center space-y-4">
            <p>You have been invited to join <strong>{inviteCompanyName}</strong> as a <strong>{invite.roleName}</strong>.</p>
            <p className="text-sm text-gray-500">Signed in as <strong>{user?.email || 'Unknown user'}</strong>.</p>
            {!userEmailMatchesInvite ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    This invite is assigned to <strong>{invite.email}</strong>. Sign in with that email to accept it.
                </div>
            ) : null}
            <button onClick={handleExistingUserAccept} disabled={loading || !userEmailMatchesInvite} className="w-full py-3 rounded-md text-white bg-green-600 hover:bg-green-700 font-medium disabled:opacity-50">
                {loading ? 'Accepting...' : 'Accept Invitation'}
            </button>
        </div>
    );

    const renderContent = () => {
        if (!invite) return renderInitial();
        if (invite.currentUser && user) return renderAcceptForExistingUser();
        if (!invite.currentUser) return renderAcceptForNewUser();
        return null;
    };

    return (
        <div className="bg-gray-50 min-h-screen">
            <header className="py-6 px-4 sm:px-6 lg:px-8">
                <Link to="/" className="text-2xl font-bold text-blue-600 hover:text-blue-700">Drip Drop</Link>
            </header>
            <main className="flex items-center justify-center py-12 sm:px-6 lg:px-8">
                <div className="max-w-md w-full">
                    <div className="bg-white p-8 rounded-2xl shadow-lg">
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold text-gray-900">Redeem Your Invite</h1>
                            <p className="mt-2 text-sm text-gray-600">
                                {invite ? `Joining ${inviteCompanyName}` : (loading && linkedInviteId ? 'Loading your invite' : 'Enter your code to get started')}
                            </p>
                        </div>
                        {renderContent()}
                        <p className="text-center text-sm pt-4">
                            <Link to="/signIn" className="font-medium text-blue-600">Back to Sign In</Link>
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
