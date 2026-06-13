import React, { useState, useEffect, useContext } from 'react';
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';
import { getAuth, sendEmailVerification } from "firebase/auth";
import { query, collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { BuildingOffice2Icon, ArrowRightIcon, ArrowLeftOnRectangleIcon, PlusIcon } from '@heroicons/react/24/outline';
import { isCompanyAccessInactive } from '../../../utils/invites';
import { CONFIRM_USER_EMAIL_ON_INVITE_FEATURE_FLAG_ID } from '../../../utils/models/FeatureFlag';
import toast from 'react-hot-toast';

export default function CompanySelection() {
    const navigate = useNavigate();
    const {
        user,
        setRecentlySelectedCompany,
        setRecentlySelectedCompanyName,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const [companyList, setCompanyList] = useState([]);
    const [emailVerified, setEmailVerified] = useState(Boolean(user?.emailVerified));
    const [verificationLoading, setVerificationLoading] = useState(false);
    const [blockedCompany, setBlockedCompany] = useState(null);

    const confirmEmailOnInviteEnabled = featureFlagsLoaded && isFeatureEnabled(CONFIRM_USER_EMAIL_ON_INVITE_FEATURE_FLAG_ID);

    useEffect(() => {
        if (!user) return;
        setEmailVerified(Boolean(user.emailVerified));

        const fetchCompanies = async () => {
            try {
                const q = query(collection(db, 'users', user.uid, "userAccess"));
                const querySnapshot = await getDocs(q);
                const companies = querySnapshot.docs
                    .map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }))
                    .filter((companyAccess) => !isCompanyAccessInactive(companyAccess));
                setCompanyList(companies);
            } catch (error) {
                console.error("Error fetching companies: ", error);
            }
        };

        fetchCompanies();
    }, [user]);

    const reloadCurrentUser = async () => {
        const authUser = getAuth().currentUser || user;
        if (!authUser) return null;

        await authUser.reload();
        const refreshedUser = getAuth().currentUser || authUser;
        setEmailVerified(Boolean(refreshedUser.emailVerified));
        return refreshedUser;
    };

    const sendVerificationEmail = async () => {
        const authUser = getAuth().currentUser || user;

        if (!authUser) {
            toast.error("Please sign in again to verify your email.");
            return;
        }

        setVerificationLoading(true);
        try {
            await sendEmailVerification(authUser);
            toast.success("Verification email sent. Check your inbox.");
        } catch (error) {
            console.error("Error sending verification email:", error);
            toast.error("Could not send verification email.");
        } finally {
            setVerificationLoading(false);
        }
    };

    const checkEmailVerification = async () => {
        setVerificationLoading(true);
        try {
            const refreshedUser = await reloadCurrentUser();

            if (refreshedUser?.emailVerified) {
                toast.success("Email verified.");
                if (blockedCompany) {
                    const nextCompany = blockedCompany;
                    setBlockedCompany(null);
                    await selectCompany(nextCompany);
                }
            } else {
                toast.error("Email is not verified yet.");
            }
        } catch (error) {
            console.error("Error checking email verification:", error);
            toast.error("Could not check email verification.");
        } finally {
            setVerificationLoading(false);
        }
    };

    const requireVerifiedEmail = async (company) => {
        if (!featureFlagsLoaded) {
            toast.error("Access settings are still loading. Try again in a moment.");
            return true;
        }

        if (!confirmEmailOnInviteEnabled) return false;

        const refreshedUser = await reloadCurrentUser();
        if (refreshedUser?.emailVerified) return false;

        setBlockedCompany(company);
        toast.error("Verify your email before accessing this company.");
        return true;
    };

    const selectCompany = async (company) => {
        try {
            if (await requireVerifiedEmail(company)) return;

            setRecentlySelectedCompanyName(company.companyName);
            setRecentlySelectedCompany(company.companyId);

            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, {
                recentlySelectedCompany: company.companyId,
            });

            navigate('/company/dashboard');
        } catch (error) {
            console.error('Error selecting company: ', error);
        }
    };

    const unselectCompany = async () => {
        try {
            setRecentlySelectedCompanyName('');
            setRecentlySelectedCompany('');

            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, {
                recentlySelectedCompany: '',
            });

            navigate('/company/dashboard');
        } catch (error) {
            console.error('Error unselecting company: ', error);
        }
    };

    return (
        <div className='w-full min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8'>
            <div className="w-full max-w-2xl">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-800 mb-2">Select a Company</h1>
                    <p className="text-lg text-gray-600">Choose which company dashboard you want to access or create a new one.</p>
                </div>

                <div className="bg-white shadow-lg rounded-lg p-8">
                    {confirmEmailOnInviteEnabled && !emailVerified ? (
                        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
                            <p className="font-semibold">Verify your email to access a company</p>
                            <p className="mt-1 text-sm">
                                We need to confirm {user?.email || "your signup email"} before opening a company dashboard.
                            </p>
                            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                <button
                                    type="button"
                                    onClick={sendVerificationEmail}
                                    disabled={verificationLoading}
                                    className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                                >
                                    Send Verification Email
                                </button>
                                <button
                                    type="button"
                                    onClick={checkEmailVerification}
                                    disabled={verificationLoading}
                                    className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
                                >
                                    I Verified, Check Again
                                </button>
                            </div>
                        </div>
                    ) : null}

                    <div className="space-y-4">
                        {companyList.length > 0 ? (
                            companyList.map(company => (
                                <button
                                    key={company.id}
                                    onClick={() => selectCompany(company)}
                                    className='w-full text-left p-4 bg-gray-100 rounded-lg hover:bg-blue-100 transition-colors duration-300 flex items-center justify-between'
                                >
                                    <div className='flex items-center'>
                                        <BuildingOffice2Icon className="w-8 h-8 text-gray-500 mr-4" />
                                        <div>
                                            <p className="text-lg font-bold text-gray-800">{company.companyName}</p>
                                            <p className="text-sm text-gray-600">Role: {company.roleName}</p>
                                        </div>
                                    </div>
                                    <ArrowRightIcon className="w-6 h-6 text-gray-500" />
                                </button>
                            ))
                        ) : (
                            <p className="text-center text-gray-500">You are not yet a member of any company.</p>
                        )}
                    </div>

                    <div className="mt-6 pt-6 border-t border-gray-200">
                        <button
                            onClick={() => navigate('/company/create-info')}
                            className='w-full text-left p-4 bg-green-100 rounded-lg hover:bg-green-200 transition-colors duration-300 flex items-center'
                        >
                            <PlusIcon className="w-8 h-8 text-green-700 mr-4" />
                            <div>
                                <p className="text-lg font-bold text-green-800">Create a New Company</p>
                                <p className="text-sm text-green-700">Start a new business profile on Drip Drop.</p>
                            </div>
                        </button>
                    </div>
                </div>
                <div className="mt-8 text-center">
                    <button 
                        onClick={unselectCompany}
                        className="bg-white text-red-500 font-bold py-3 px-8 rounded-lg border-2 border-red-300 hover:bg-red-50 hover:border-red-500 transition-colors duration-300 flex items-center justify-center gap-2 mx-auto"
                    >
                        <ArrowLeftOnRectangleIcon className="w-5 h-5" />
                        <span>Return to Tech Hub</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
