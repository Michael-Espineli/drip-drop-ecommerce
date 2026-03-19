import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import toast from 'react-hot-toast';
import { Context } from "../../context/AuthContext";

export default function HomeOwnerSignIn() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const auth = getAuth();

    const navigate = useNavigate();
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
            navigate('/client/dashboard');
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
                                <a href="#" className="font-medium text-blue-600 hover:text-blue-500">
                                    Forgot your password?
                                </a>
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
                            Don't have an account? <Link to="/homeOwnerSignUp" className="font-medium text-blue-600">Sign up</Link>
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