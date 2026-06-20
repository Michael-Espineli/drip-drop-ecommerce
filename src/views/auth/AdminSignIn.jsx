import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import toast from 'react-hot-toast';

const ADMIN_YELLOW = '#efb12f';

export default function AdminSignIn() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const auth = getAuth();
    const navigate = useNavigate();

    const handleSignIn = async (e) => {
        e.preventDefault();

        if (!email || !password) {
            toast.error('Please fill out both email and password.');
            return;
        }

        setLoading(true);
        try {
            if (!email.endsWith('@dripdrop-poolapp.com') && !email.endsWith('@espinelicapital.com')) {
                toast.error('Access denied. This is a restricted area.');
                setLoading(false);
                return;
            }

            await signInWithEmailAndPassword(auth, email, password);
            toast.success('Admin signed in successfully!');
            navigate('/admin/dashboard');
        } catch (error) {
            console.error("Admin Sign-In Error:", error);
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    toast.error('Invalid credentials for admin access.');
                    break;
                default:
                    toast.error('An unexpected error occurred.');
                    break;
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="admin-theme bg-slate-900 text-slate-100 min-h-screen">
            <header className="py-6 px-4 sm:px-6 lg:px-8">
                <Link
                    to="/"
                    className="text-2xl font-bold transition hover:opacity-90"
                    style={{ color: ADMIN_YELLOW }}
                >
                    Drip Drop [Admin]
                </Link>
            </header>

            <main className="flex items-center justify-center py-12 sm:px-6 lg:px-8">
                <div className="max-w-md w-full space-y-8">
                    <div className="bg-slate-950 p-8 rounded-xl border border-slate-800/60 shadow-2xl">
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold" style={{ color: ADMIN_YELLOW }}>
                                Administrator Access
                            </h1>
                            <p className="mt-2 text-sm text-slate-400">
                                Please sign in to continue.
                            </p>
                        </div>

                        <form onSubmit={handleSignIn} className="space-y-6">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Email address"
                                required
                                className="w-full px-3 py-3 bg-slate-900/70 border border-slate-800/60 rounded-md shadow-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30 focus:border-[#efb12f]/50"
                            />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                required
                                className="w-full px-3 py-3 bg-slate-900/70 border border-slate-800/60 rounded-md shadow-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30 focus:border-[#efb12f]/50"
                            />

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 px-4 rounded-md bg-[#efb12f] text-slate-950 hover:bg-[#efb12f]/90 font-semibold disabled:opacity-50 transition-colors"
                            >
                                {loading ? 'Signing In...' : 'Sign In'}
                            </button>
                        </form>
                    </div>

                     <div className="text-center text-sm text-slate-500">
                        <p>
                           This page is for authorized administrators only.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
