import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
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

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };
    const { user } = useContext(Context);
    useEffect(() => {
        if (!user) return;
        if (user.accountType === 'Company') {
            navigate('/company/dashboard');
        } else if (user.accountType === 'Client') {
            navigate('/client/dashboard');
        }

    }, [user]);
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
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCred.user;
            toast.success('Account created successfully!');

            // 2. Create homeowner document in Firestore
            const homeowner = {
                accountType: 'Client',
                dateCreated: new Date(),
                firstName,
                lastName,
                email,
                id: user.uid,
                recentlySelectedCompany: '',
                photoUrl: '',
                stripeConnectedAccountId: '',
                exp: 0,
            };
            await setDoc(doc(db, 'users', user.uid), homeowner);
            toast.success('Profile created!');

            // 3. Navigate to the dashboard
            navigate('/client/dashboard');
        } catch (error) {
            console.error("Homeowner sign-up failed:", error);
            switch (error.code) {
                case 'auth/email-already-in-use':
                    toast.error('This email is already in use.');
                    break;
                case 'auth/invalid-email':
                    toast.error('Please enter a valid email address.');
                    break;
                default:
                    toast.error('An unexpected error occurred. Please try again.');
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
                            <div className="flex gap-4">
                                <input name="firstName" type="text" value={formData.firstName} onChange={handleChange} placeholder="First Name" required className="w-full px-3 py-3 border rounded-md"/>
                                <input name="lastName" type="text" value={formData.lastName} onChange={handleChange} placeholder="Last Name" required className="w-full px-3 py-3 border rounded-md"/>
                            </div>
                            <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="Email address" required className="w-full px-3 py-3 border rounded-md"/>
                            <input name="password" type="password" value={formData.password} onChange={handleChange} placeholder="Password (8+ characters)" required className="w-full px-3 py-3 border rounded-md"/>
                            <input name="confirmPassword" type="password" value={formData.confirmPassword} onChange={handleChange} placeholder="Confirm Password" required className="w-full px-3 py-3 border rounded-md"/>

                            <button type="submit" disabled={loading} className="w-full py-3 mt-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium disabled:opacity-50">
                                {loading ? 'Creating Account...' : 'Sign Up'}
                            </button>

                            <p className="text-center text-sm pt-4">
                                Already have an account? <Link to="/homeOwnerSignIn" className="font-medium text-blue-600">Sign In</Link>
                            </p>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}