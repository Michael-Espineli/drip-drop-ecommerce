import React, { useState, useContext, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from "../../context/AuthContext";

const functions = getFunctions();
const db = getFirestore();
const auth = getAuth();

export default function SignUp() {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        confirmPassword: '',
        companyName: '',
        firstName: '',
        lastName: '',
        phoneNumber: '',
    });
    const [loading, setLoading] = useState(false);
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
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleNextStep = (e) => {
        e.preventDefault();
        const { email, password, confirmPassword } = formData;

        if (!email) {
            return toast.error('Please enter your email address.');
        }
        if (password.length < 8) {
            return toast.error('Password must be at least 8 characters long.');
        }
        if (password !== confirmPassword) {
            return toast.error('Passwords do not match.');
        }

        setStep(2);
    };

    const handleSignUp = async (e) => {
        e.preventDefault();
        const {firstName, lastName, phoneNumber, email, password } = formData;

        if (!firstName || !lastName || !phoneNumber) {
            return toast.error('Please fill out all fields.');
        }

        setLoading(true);

        try {
            // 1. Create Firebase Auth user
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCred.user;
            toast.success('Account created successfully!');

            // 2. Create user document in Firestore
            const newUser = {
                accountType: 'Company',
                dateCreated: new Date(),
                firstName,
                lastName,
                email,
                id: user.uid,
                recentlySelectedCompany: '',
                photoUrl: '',
                stripeConnectedAccountId: '',
                exp: 0,
                phoneNumber,
                bio: '',
            };
            await setDoc(doc(db, 'users', user.uid), newUser);
            toast.success('User profile saved!');

            // 3. Call Cloud Function to create company
            // const createCompany = httpsCallable(functions, 'createCompanyAfterSignUp');
            // await createCompany({
            //     ownerId: user.uid,
            //     ownerName: `${firstName} ${lastName}`,
            //     companyName,
            //     email,
            //     phoneNumber,
            //     zipCodes: [],
            //     services: [],
            // });
            // toast.success('Company profile created!');

            // 4. Navigate to the next page
            navigate('/company/settings');
        } catch (error) {
            console.error("Sign-up process failed:", error);
            switch (error.code) {
                case 'auth/email-already-in-use':
                    toast.error('This email address is already in use.');
                    setStep(1); 
                    break;
                case 'auth/invalid-email':
                    toast.error('The email address is not valid.');
                    setStep(1);
                    break;
                default:
                    toast.error('An unexpected error occurred. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    const renderStepOne = () => (
        <form onSubmit={handleSignUp} className="space-y-6">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-gray-900">Create Your Company Account</h1>
                <p className="mt-2 text-sm text-gray-600">Account Information</p>
            </div>
            <div className="flex gap-4">
                <input name="firstName" type="text" value={formData.firstName} onChange={handleChange} placeholder="First Name" required className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"/>
                <input name="lastName" type="text" value={formData.lastName} onChange={handleChange} placeholder="Last Name" required className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"/>
            </div>
            <input name="phoneNumber" type="tel" value={formData.phoneNumber} onChange={handleChange} placeholder="Phone Number" required className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"/>

            <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="Email address" required className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"/>
            <input name="password" type="password" value={formData.password} onChange={handleChange} placeholder="Password (8+ characters)" required className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"/>
            <input name="confirmPassword" type="password" value={formData.confirmPassword} onChange={handleChange} placeholder="Confirm Password" required className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm"/>

            <button type="submit" disabled={loading} className="w-full py-3 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium disabled:opacity-50">
                {loading ? 'Creating Account...' : 'Complete Sign Up'}
            </button>

            <p className="text-center text-sm">
                Already have an account?{' '} 
                <Link to="/signIn"  className="font-medium text-blue-600 hover:text-blue-500">
                    Sign In
                </Link>
            </p>

            <p  className="text-center text-sm">
                Have an invite code?{' '}
                <Link to="/reedemInviteCode" className="font-medium text-blue-600 hover:text-blue-500">
                    Redeem it here
                </Link>
            </p>
        </form>
    );


    return (
        <div className="bg-gray-50 min-h-screen">
            <header className="py-6 px-4 sm:px-6 lg:px-8">
                <Link to="/" className="text-2xl font-bold text-blue-600 hover:text-blue-700">Drip Drop</Link>
            </header>
            <main className="flex items-center justify-center py-12 sm:px-6 lg:px-8">
                <div className="max-w-md w-full">
                    <div className="bg-white p-8 rounded-2xl shadow-lg">
                        {renderStepOne()}
                    </div>
                </div>
            </main>
        </div>
    );
}