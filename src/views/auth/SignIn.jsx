import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import toast from 'react-hot-toast';
import { Context } from "../../context/AuthContext";

export default function SignIn() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const auth = getAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const { user } = useContext(Context);
    useEffect(() => {
        if (!user) return;
        if (user.accountType === 'Company') {
            navigate('/company/dashboard');
        } else if (user.accountType === 'Client') {
            navigate('/client/dashboard');
        }

    }, [user]);
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
            const redirectPath = queryParams.get('redirect') || '/company/dashboard'; // Default to home page

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

    return (
        <div className="bg-gray-50 min-h-screen">
            {/* Minimal Header */}
            <header className="py-6 px-4 sm:px-6 lg:px-8">
                <Link to="/" className="text-2xl font-bold text-blue-600 hover:text-blue-700">
                    Drip Drop
                </Link>
            </header>

            {/* Sign-in Card */}
            <main className="flex items-center justify-center py-12 sm:px-6 lg:px-8">
                <div className="max-w-md w-full space-y-8">
                    <div className="bg-white p-8 rounded-2xl shadow-lg">
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold text-gray-900">Company Sign In</h1>
                            <p className="mt-2 text-sm text-gray-600">
                                Access your company dashboard.
                            </p>
                        </div>

                        <form onSubmit={handleSignIn} className="space-y-6">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700 sr-only">
                                    Email address
                                </label>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="appearance-none relative block w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                    placeholder="Email address"
                                />
                            </div>

                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700 sr-only">
                                    Password
                                </label>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="appearance-none relative block w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                    placeholder="Password"
                                />
                            </div>

                            <div className="text-sm text-right">
                                <a href="#" className="font-medium text-blue-600 hover:text-blue-500">
                                    Forgot your password?
                                </a>
                            </div>

                            <div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                                >
                                    {loading ? 'Signing In...' : 'Sign In'}
                                </button>
                            </div>
                        </form>

                        <div className="mt-6 text-center text-sm text-gray-600">
                            <p>
                                Don't have a company account?{' '}
                                <Link to="/signUp" className="font-medium text-blue-600 hover:text-blue-500">
                                    Sign up
                                </Link>
                            </p>
                        </div>
                    </div>

                    <div className="text-center text-sm text-gray-600 space-y-2">
                        <p>
                            Are you a homeowner?{' '}
                            <Link to="/homeOwnerSignIn" className="font-medium text-blue-600 hover:text-blue-500">
                                Sign in here
                            </Link>
                        </p>
                        <p>
                            Have an invite code?{' '}
                            <Link to="/reedemInviteCode" className="font-medium text-blue-600 hover:text-blue-500">
                                Redeem it here
                            </Link>
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}