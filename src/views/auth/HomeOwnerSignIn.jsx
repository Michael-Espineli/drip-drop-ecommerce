import React, { useState, useEffect, useContext } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAuth, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import toast from 'react-hot-toast';
import { Context } from "../../context/AuthContext";

export default function HomeOwnerSignIn() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [resetLoading, setResetLoading] = useState(false);
    const auth = getAuth();

    const navigate = useNavigate();
    const location = useLocation();
    const { user, accountType } = useContext(Context);

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const inviteEmail = queryParams.get('email') || '';
        if (inviteEmail) setEmail(inviteEmail);
    }, [location.search]);

    const queryParams = new URLSearchParams(location.search);
    const redirectPath = queryParams.get('redirect');
    const signUpLink = redirectPath
        ? `/homeownerSignUp?redirect=${encodeURIComponent(redirectPath)}`
        : '/homeownerSignUp';

    useEffect(() => {
        if (!user) return;
        const queryParams = new URLSearchParams(location.search);
        const redirectPath = queryParams.get('redirect');

        if (redirectPath && accountType === 'Client') {
            navigate(redirectPath);
        } else if (accountType === 'Company') {
            navigate('/company/dashboard');
        } else if (accountType === 'Client') {
            navigate('/client/dashboard');
        }

    }, [accountType, location.search, navigate, user]);

    const handleSignIn = async (e) => {
        e.preventDefault();

        if (!email || !password) {
            toast.error('Please fill out both email and password.');
            return;
        }

        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            toast.success('Signed in successfully!');
            const queryParams = new URLSearchParams(location.search);
            const redirectPath = queryParams.get('redirect') || '/client/dashboard';
            navigate(redirectPath);
        } catch (error) {
            console.error("Firebase Sign-In Error:", error);
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    toast.error('Invalid email or password.');
                    break;
                case 'auth/invalid-email':
                    toast.error('Please enter a valid email address.');
                    break;
                default:
                    toast.error('An unexpected error occurred. Please try again.');
                    break;
            }
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordReset = async () => {
        const trimmedEmail = email.trim();

        if (!trimmedEmail) {
            toast.error('Enter your email address first.');
            return;
        }

        setResetLoading(true);
        try {
            await sendPasswordResetEmail(auth, trimmedEmail);
            toast.success('Password reset email sent.');
        } catch (error) {
            console.error("Firebase Password Reset Error:", error);
            switch (error.code) {
                case 'auth/invalid-email':
                    toast.error('Please enter a valid email address.');
                    break;
                case 'auth/user-not-found':
                    toast.error('No account found for that email address.');
                    break;
                default:
                    toast.error('Unable to send reset email. Please try again.');
                    break;
            }
        } finally {
            setResetLoading(false);
        }
    };

    return (
        <div className="bg-gray-50 min-h-screen">
            <header className="py-6 px-4 sm:px-6 lg:px-8">
                <Link to="/" className="text-2xl font-bold text-blue-600 hover:text-blue-700">
                    Drip Drop
                </Link>
            </header>

            <main className="flex items-center justify-center py-12 sm:px-6 lg:px-8">
                <div className="max-w-md w-full space-y-8">
                    <div className="bg-white p-8 rounded-2xl shadow-lg">
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold text-gray-900">Homeowner Sign In</h1>
                            <p className="mt-2 text-sm text-gray-600">
                                Access your homeowner portal.
                            </p>
                        </div>

                        <form onSubmit={handleSignIn} className="space-y-6">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Email address"
                                required
                                className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"
                            />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                required
                                className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"
                            />

                            <div className="text-sm text-right">
                                <button
                                    type="button"
                                    onClick={handlePasswordReset}
                                    disabled={resetLoading}
                                    className="font-medium text-blue-600 hover:text-blue-500 disabled:opacity-50"
                                >
                                    {resetLoading ? 'Sending reset email...' : 'Forgot your password?'}
                                </button>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium disabled:opacity-50"
                            >
                                {loading ? 'Signing In...' : 'Sign In'}
                            </button>
                        </form>

                        <p className="mt-6 text-center text-sm">
                            Don't have an account? <Link to={signUpLink} className="font-medium text-blue-600">Sign up</Link>
                        </p>
                    </div>

                    <div className="text-center text-sm text-gray-600">
                        <p>
                            Are you a pool company? <Link to="/signIn" className="font-medium text-blue-600">Sign in here</Link>
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
