import { userFacingErrorMessage } from '../../utils/permissionErrors';
import React, { useState, useEffect, useContext } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { sendClientEmailVerification } from '../../utils/accountEmails';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { safeClientReturnPath, clientVerificationPath } from "../../utils/clientNavigation";
import { Context } from "../../context/AuthContext";

const db = getFirestore();
const auth = getAuth();

export default function HomeOwnerSignUp() {
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        confirmPassword: '',
    });
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };
    const { user, accountType, dataBaseUser } = useContext(Context);

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const inviteEmail = queryParams.get('email') || '';

        if (inviteEmail) {
            setFormData((prev) => ({
                ...prev,
                email: prev.email || inviteEmail,
            }));
        }
    }, [location.search]);

    useEffect(() => {
        if (!user || loading) return;
        const queryParams = new URLSearchParams(location.search);
        const redirectPath = safeClientReturnPath(queryParams.get('redirect'));

        if (accountType === 'Company') {
            navigate('/company/dashboard');
        } else if (accountType === 'Client') {
            navigate(user.emailVerified ? safeClientReturnPath(redirectPath) : clientVerificationPath(redirectPath));
        }

    }, [accountType, location.search, navigate, user, loading]);

    const queryParams = new URLSearchParams(location.search);
    const redirectPath = safeClientReturnPath(queryParams.get('redirect'));
    const signInLink = redirectPath
        ? `/homeownerSignIn?redirect=${encodeURIComponent(redirectPath)}`
        : '/homeownerSignIn';

    const handleSignUp = async (e) => {
        e.preventDefault();
        const { firstName, lastName, email, password, confirmPassword } = formData;

        if (!firstName || !lastName || !email) {
            return toast.error('Please fill out all fields.');
        }
        if (password.length < 8) {
            return toast.error('Password must be at least 8 characters long.');
        }
        if (password !== confirmPassword) {
            return toast.error('Passwords do not match.');
        }

        setLoading(true);

        try {
            // 1. Create Firebase user
            let account = auth.currentUser;
            if (account && !dataBaseUser && account.email?.toLowerCase() === email.trim().toLowerCase()) {
                const existing = await getDoc(doc(db, 'users', account.uid));
                if (existing.exists()) throw new Error('This account already has a profile. Please sign in.');
            } else {
                account = (await createUserWithEmailAndPassword(auth, email.trim(), password)).user;
            }
            const user = account;
            toast.success('Account created successfully!');

            // 2. Create homeowner document in Firestore
            const homeowner = {
                accountType: 'Client',
                dateCreated: new Date(),
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                email: user.email,
                id: user.uid,
                recentlySelectedCompany: '',
                photoUrl: '',
                stripeId: '',
                stripeCustomerId: '',
                exp: 0,
            };
            await setDoc(doc(db, 'users', user.uid), homeowner);
            toast.success('Profile created!');

            // 3. Navigate to the invite or dashboard
            try { await sendClientEmailVerification(auth, clientVerificationPath(redirectPath)); } catch (_) { toast.error(userFacingErrorMessage(_, 'Your account was created. Use Resend on the next screen to verify your email.')); }
            navigate(user.emailVerified ? safeClientReturnPath(redirectPath) : clientVerificationPath(redirectPath));
        } catch (error) {
            console.error("Homeowner sign-up failed:", error);
            switch (error.code) {
                case 'auth/email-already-in-use':
                    toast.error(userFacingErrorMessage(error, 'This email is already in use.'));
                    break;
                case 'auth/invalid-email':
                    toast.error(userFacingErrorMessage(error, 'Please enter a valid email address.'));
                    break;
                default:
                    toast.error(userFacingErrorMessage(error, auth.currentUser ? 'Your account exists. Please retry to finish setting up your profile.' : 'An unexpected error occurred. Please try again.'));
            }
        } finally {
            setLoading(false);
        }
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
                            <h1 className="text-3xl font-bold text-gray-900">Create your Homeowner Account</h1>
                            <p className="mt-2 text-sm text-gray-600">Get started with Drip Drop today.</p>
                        </div>

                        <form onSubmit={handleSignUp} className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block text-sm font-medium">First name<input autoComplete="given-name" name="firstName" type="text" value={formData.firstName} onChange={handleChange} placeholder="First Name" required className="w-full px-3 py-3 border rounded-md" /></label>
                                <label className="block text-sm font-medium">Last name<input autoComplete="family-name" name="lastName" type="text" value={formData.lastName} onChange={handleChange} placeholder="Last Name" required className="w-full px-3 py-3 border rounded-md" /></label>
                            </div>
                            <label className="block text-sm font-medium">Email address<input autoComplete="email" name="email" type="email" value={formData.email} onChange={handleChange} placeholder="Email address" required className="w-full px-3 py-3 border rounded-md" /></label>
                            <label className="block text-sm font-medium">Password<input autoComplete="new-password" name="password" type="password" value={formData.password} onChange={handleChange} placeholder="Password (8+ characters)" required className="w-full px-3 py-3 border rounded-md" /></label>
                            <label className="block text-sm font-medium">Confirm password<input autoComplete="new-password" name="confirmPassword" type="password" value={formData.confirmPassword} onChange={handleChange} placeholder="Confirm Password" required className="w-full px-3 py-3 border rounded-md" /></label>

                            <button type="submit" disabled={loading} className="w-full py-3 mt-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium disabled:opacity-50">
                                {loading ? 'Creating Account...' : 'Sign Up'}
                            </button>

                            <p className="text-center text-sm pt-4">
                                Already have an account? <Link to={signInLink} className="font-medium text-blue-600">Sign In</Link>
                            </p>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}
