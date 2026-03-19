import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { acceptInvite } from '../../utils/invites';
import { Context } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const db = getFirestore();
const auth = getAuth();

export default function RedeemInviteCode() {
    const { user } = useContext(Context);
    const navigate = useNavigate();

    const [inviteCode, setInviteCode] = useState('');
    const [invite, setInvite] = useState(null);
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleCheckInvite = async (e) => {
        e.preventDefault();
        if (!inviteCode) {
            return toast.error('Please enter an invite code.');
        }

        setLoading(true);
        try {
            const inviteRef = doc(db, "invites", inviteCode.trim());
            const inviteSnap = await getDoc(inviteRef);

            if (inviteSnap.exists() && inviteSnap.data().status === 'Pending') {
                const inviteData = { id: inviteSnap.id, ...inviteSnap.data() };
                setInvite(inviteData);
                toast.success('Invite code is valid!');

                if (inviteData.currentUser && !user) {
                    toast.error('This invite is for an existing user. Please sign in to accept.');
                    navigate('/signIn');
                }
            } else {
                toast.error('This invite is invalid or has already been accepted.');
            }
        } catch (err) {
            console.error("Error checking invite:", err);
            toast.error('Could not verify the invite code.');
        } finally {
            setLoading(false);
        }
    };

    const handleSignUpAndAccept = async (e) => {
        e.preventDefault();
        if (!password) {
            return toast.error('Please create a password.');
        }
        if(password.length < 8) {
            return toast.error("Password must be at least 8 characters long")
        }

        setLoading(true);
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, invite.email, password);
            const newUser = userCredential.user;
            const newUserName = `${invite.firstName} ${invite.lastName}`;
            
            await acceptInvite(invite, newUser.uid, invite.firstName, invite.lastName, invite.lastName);
            toast.success('Account created and invite accepted!');
            navigate('/company/dashboard');
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
            const existingUserName = user.displayName || `${invite.firstName} ${invite.lastName}`;
            await acceptInvite(invite, user.uid, invite.firstName, invite.firstName, invite.email);
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
                placeholder="Enter Invite Code"
                className="w-full px-3 py-3 border rounded-md"
            />
            <button type="submit" disabled={loading} className="w-full py-3 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium disabled:opacity-50">
                {loading ? 'Verifying...' : 'Redeem Invite'}
            </button>
        </form>
    );

    const renderAcceptForNewUser = () => (
        <form onSubmit={handleSignUpAndAccept} className="space-y-4">
            <p className="text-center text-gray-600">Welcome! You've been invited to join <strong>{invite.companyName}</strong>.</p>
            <input type="email" value={invite.email} disabled className="w-full px-3 py-3 border rounded-md bg-gray-100"/>
            <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password (min. 8 characters)"
                className="w-full px-3 py-3 border rounded-md"
            />
            <button type="submit" disabled={loading} className="w-full py-3 rounded-md text-white bg-green-600 hover:bg-green-700 font-medium disabled:opacity-50">
                {loading ? 'Creating Account...' : 'Accept & Create Account'}
            </button>
        </form>
    );

    const renderAcceptForExistingUser = () => (
        <div className="text-center space-y-4">
            <p>You have been invited to join <strong>{invite.companyName}</strong> as a <strong>{invite.roleName}</strong>.</p>
            <button onClick={handleExistingUserAccept} disabled={loading} className="w-full py-3 rounded-md text-white bg-green-600 hover:bg-green-700 font-medium disabled:opacity-50">
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
                                {invite ? `Joining ${invite.companyName}` : 'Enter your code to get started'}
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