import React, { useState, useContext, useEffect, useCallback, useMemo } from "react";
import { sendPasswordResetEmail, updateProfile } from "firebase/auth";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Link } from "react-router-dom";
import { Context } from "../../context/AuthContext";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where } from "firebase/firestore";
import { auth, db, storage } from '../../utils/config';
import toast from 'react-hot-toast';

const functions = getFunctions();

const dateFromValue = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shortDate = (value) => {
    const date = dateFromValue(value);
    return date ? date.toLocaleDateString() : "-";
};

const moneyFromCents = (value) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(Number(value || 0) / 100);

const startOfToday = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};

const dateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(0, 0, 0, 0);
    return date;
};

const endOfToday = () => {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    return date;
};

const fullName = (userData = {}) => [userData.firstName, userData.lastName].filter(Boolean).join(" ");

const initialsForUser = (userData = {}) => {
    const nameParts = [userData.firstName, userData.lastName].filter(Boolean);
    if (nameParts.length > 0) {
        return nameParts.map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();
    }
    return String(userData.email || "U").charAt(0).toUpperCase();
};

const safeFileName = (fileName = "profile-photo") =>
    fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80) || "profile-photo";

// Helper Components for a cleaner structure
const ProfileCard = ({ title, children, actions }) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
            <h2 className="text-lg font-bold text-gray-800">{title}</h2>
            {actions && <div className="shrink-0">{actions}</div>}
        </div>
        <div className="p-4 space-y-4">
            {children}
        </div>
    </div>
);

const InfoRow = ({ label, value }) => (
    <div className="grid grid-cols-3 gap-4 items-center">
        <p className="text-sm font-semibold text-gray-600 col-span-1">{label}</p>
        <p className="text-sm text-gray-800 col-span-2">{value || 'Not set'}</p>
    </div>
);

const FormField = ({ label, name, type = 'text', value, onChange, placeholder }) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4 sm:items-center">
        <label className="text-sm font-semibold text-gray-700 col-span-1">{label}</label>
        <input 
            name={name}
            type={type} 
            value={value} 
            onChange={onChange} 
            placeholder={placeholder} 
            className="col-span-2 bg-gray-50 border-2 border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-full p-2.5"
        />
    </div>
);

const ProfileAvatar = ({ userData, previewUrl, className = "h-24 w-24", textClassName = "text-2xl" }) => {
    const [imageFailed, setImageFailed] = useState(false);
    const imageUrl = previewUrl || userData?.photoUrl || "";

    useEffect(() => {
        setImageFailed(false);
    }, [imageUrl]);

    return (
        <div className={`${className} shrink-0 overflow-hidden rounded-full border-4 border-white bg-blue-100 shadow-sm`}>
            {imageUrl && !imageFailed ? (
                <img
                    className="h-full w-full object-cover"
                    src={imageUrl}
                    alt="Profile"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <div className={`flex h-full w-full items-center justify-center font-bold text-blue-700 ${textClassName}`}>
                    {initialsForUser(userData)}
                </div>
            )}
        </div>
    );
};

const SummaryTile = ({ label, value, helper }) => (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
        {helper ? <p className="mt-1 text-xs text-gray-500">{helper}</p> : null}
    </div>
);

const ActionLink = ({ to, children }) => (
    <Link
        to={to}
        className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
    >
        {children}
    </Link>
);

const DeleteModal = ({ onConfirm, onCancel }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">Are you sure?</h3>
            <p className="text-gray-600 mb-8">This action is irreversible and will permanently delete your account.</p>
            <div className="flex justify-end space-x-4">
                <button onClick={onCancel} className='py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Cancel</button>
                <button onClick={onConfirm} className='py-2 px-5 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition'>Delete Account</button>
            </div>
        </div>
    </div>
);

export default function ProfilePage() {
    const {
        user,
        dataBaseUser,
        setDataBaseUser,
        stripeConnectedAccountId,
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        companyUserAccess,
        hasCompanyPermission,
    } = useContext(Context);
    
    const [editMode, setEditMode] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [formData, setFormData] = useState({});
    const [profileSaving, setProfileSaving] = useState(false);
    const [passwordResetLoading, setPasswordResetLoading] = useState(false);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
    const [companyProfile, setCompanyProfile] = useState({
        company: null,
        companyUser: null,
        routes: [],
        lineItems: [],
        statements: [],
        loading: false,
        error: "",
    });

    const [stripeLoading, setStripeLoading] = useState({
        create: false,
        link: false
    });

    useEffect(() => {
        if (dataBaseUser) {
            setFormData({
                firstName: dataBaseUser.firstName || '',
                lastName: dataBaseUser.lastName || '',
                email: dataBaseUser.email || '',
                phoneNumber: dataBaseUser.phoneNumber || '',
                bio: dataBaseUser.bio || '',
                photoUrl: dataBaseUser.photoUrl || ''
            });
        }
    }, [dataBaseUser]);

    useEffect(() => {
        return () => {
            if (photoPreviewUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(photoPreviewUrl);
            }
        };
    }, [photoPreviewUrl]);

    useEffect(() => {
        let cancelled = false;

        const resetCompanyProfile = () => {
            setCompanyProfile({
                company: null,
                companyUser: null,
                routes: [],
                lineItems: [],
                statements: [],
                loading: false,
                error: "",
            });
        };

        const loadCompanyProfile = async () => {
            if (!user?.uid || !recentlySelectedCompany) {
                resetCompanyProfile();
                return;
            }

            setCompanyProfile((current) => ({ ...current, loading: true, error: "" }));

            try {
                const startDate = dateDaysAgo(180);
                const endDate = endOfToday();
                const todayStart = startOfToday();

                const companyRef = doc(db, "companies", recentlySelectedCompany);
                const companyUsersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
                const activeRoutesRef = collection(db, "companies", recentlySelectedCompany, "activeRoutes");
                const lineItemsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayLineItems");
                const statementsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayStatements");

                const [
                    companySnap,
                    companyUserSnap,
                    routesSnap,
                    lineItemsSnap,
                    statementsSnap,
                ] = await Promise.all([
                    getDoc(companyRef),
                    getDocs(query(companyUsersRef, where("userId", "==", user.uid), limit(1))),
                    getDocs(query(
                        activeRoutesRef,
                        where("techId", "==", user.uid),
                        where("date", "<", todayStart),
                        orderBy("date", "desc"),
                        limit(25)
                    )),
                    getDocs(query(
                        lineItemsRef,
                        where("completedDate", ">=", startDate),
                        where("completedDate", "<=", endDate)
                    )),
                    getDocs(statementsRef),
                ]);

                if (cancelled) return;

                const company = companySnap.exists()
                    ? { id: companySnap.id, ...companySnap.data() }
                    : null;
                const companyUser = companyUserSnap.docs[0]
                    ? { id: companyUserSnap.docs[0].id, ...companyUserSnap.docs[0].data() }
                    : null;

                const routes = routesSnap.docs
                    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                    .filter((route) => {
                        const routeDate = dateFromValue(route.date);
                        return routeDate && routeDate < todayStart;
                    })
                    .sort((a, b) => (dateFromValue(b.date)?.getTime() || 0) - (dateFromValue(a.date)?.getTime() || 0));

                const lineItems = lineItemsSnap.docs
                    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                    .filter((item) => item.technicianId === user.uid)
                    .sort((a, b) => (dateFromValue(b.completedDate)?.getTime() || 0) - (dateFromValue(a.completedDate)?.getTime() || 0));

                const statements = statementsSnap.docs
                    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                    .filter((statement) => {
                        if (statement.technicianId !== user.uid) return false;
                        const statementStart = dateFromValue(statement.startDate);
                        const statementEnd = dateFromValue(statement.endDate);
                        if (!statementStart || !statementEnd) return true;
                        return statementStart <= endDate && statementEnd >= startDate;
                    })
                    .sort((a, b) => (dateFromValue(b.startDate)?.getTime() || 0) - (dateFromValue(a.startDate)?.getTime() || 0));

                setCompanyProfile({
                    company,
                    companyUser,
                    routes,
                    lineItems,
                    statements,
                    loading: false,
                    error: "",
                });
            } catch (error) {
                console.error("Error loading profile company work history:", error);
                if (!cancelled) {
                    setCompanyProfile((current) => ({
                        ...current,
                        loading: false,
                        error: "Could not load selected company work history.",
                    }));
                }
            }
        };

        loadCompanyProfile();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany, user?.uid]);

    const workSummary = useMemo(() => {
        const activeLineItems = companyProfile.lineItems.filter((item) => !item.voidedAt);
        const totalMiles = companyProfile.routes.reduce((total, route) => total + Number(route.distanceMiles || route.distance || 0), 0);
        const totalStops = companyProfile.routes.reduce((total, route) => total + Number(route.finishedStops || 0), 0);
        const totalPayCents = activeLineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
        const unpaidPayCents = activeLineItems
            .filter((item) => !item.payStatementId && !item.voidedAt)
            .reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);

        return {
            totalMiles,
            totalStops,
            totalPayCents,
            unpaidPayCents,
            workItems: activeLineItems.length,
        };
    }, [companyProfile.lineItems, companyProfile.routes]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handlePhotoFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            toast.error("Please select an image file.");
            return;
        }

        if (file.size > 8 * 1024 * 1024) {
            toast.error("Profile photos must be smaller than 8MB.");
            return;
        }

        setPhotoFile(file);
        setPhotoPreviewUrl(URL.createObjectURL(file));
    };

    const resetEditForm = () => {
        setFormData({
            firstName: dataBaseUser.firstName || '',
            lastName: dataBaseUser.lastName || '',
            email: dataBaseUser.email || '',
            phoneNumber: dataBaseUser.phoneNumber || '',
            bio: dataBaseUser.bio || '',
            photoUrl: dataBaseUser.photoUrl || ''
        });
        setPhotoFile(null);
        setPhotoPreviewUrl("");
    };

    const handleCancelEdit = () => {
        resetEditForm();
        setEditMode(false);
    };

    const handleUpdateUser = async () => {
        if (!user?.uid || profileSaving) return;

        const userDocRef = doc(db, 'users', user.uid);
        const toastId = toast.loading(photoFile ? 'Uploading photo...' : 'Updating profile...');
        setProfileSaving(true);

        try {
            const nextFormData = { ...formData };

            if (photoFile) {
                const photoStorageRef = ref(
                    storage,
                    `users/${user.uid}/profile/${Date.now()}-${safeFileName(photoFile.name)}`
                );
                await uploadBytes(photoStorageRef, photoFile, { contentType: photoFile.type });
                nextFormData.photoUrl = await getDownloadURL(photoStorageRef);
                toast.loading('Updating profile...', { id: toastId });
            }

            await updateDoc(userDocRef, nextFormData);

            await updateProfile(user, {
                displayName: fullName(nextFormData) || user.displayName || null,
                photoURL: nextFormData.photoUrl || null,
            }).catch((error) => {
                console.warn("Firebase auth profile update failed:", error);
            });

            setFormData(nextFormData);
            setDataBaseUser(prev => ({ ...prev, ...nextFormData }));
            setPhotoFile(null);
            setPhotoPreviewUrl("");
            setEditMode(false);
            toast.success('Profile updated successfully!', { id: toastId });
        } catch (error) {
            console.error("Error updating user:", error);
            const message = error?.code === "storage/unauthorized"
                ? "Profile photo uploads are blocked by Firebase Storage rules."
                : "Failed to update profile.";
            toast.error(message, { id: toastId });
        } finally {
            setProfileSaving(false);
        }
    };

    const handlePasswordReset = async () => {
        const email = dataBaseUser?.email || user?.email || auth.currentUser?.email;
        if (!email) {
            toast.error("No email address found for this account.");
            return;
        }

        setPasswordResetLoading(true);
        const toastId = toast.loading("Sending password reset email...");

        try {
            await sendPasswordResetEmail(auth, email);
            toast.success(`Password reset email sent to ${email}.`, { id: toastId });
        } catch (error) {
            console.error("Error sending password reset email:", error);
            toast.error("Failed to send password reset email.", { id: toastId });
        } finally {
            setPasswordResetLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        const toastId = toast.loading('Deleting account...');
        try {
            const deleteUserCallable = httpsCallable(functions, 'deleteUser');
            await deleteUserCallable({});
            toast.success('Account deleted successfully.', { id: toastId });
            // Note: User will be signed out automatically by backend functions
        } catch (error) {
            console.error("Error deleting account:", error);
            toast.error('Failed to delete account.', { id: toastId });
        }
        setShowDeleteModal(false);
    };

    const handleStripeAction = useCallback(async (action) => {
        const callableName = action === 'create' ? 'createNewStripeAccount' : 'createStripeAccountLink';
        const loadingKey = action === 'create' ? 'create' : 'link';

        setStripeLoading(prev => ({ ...prev, [loadingKey]: true }));
        const toastId = toast.loading(`Processing Stripe request...`);

        try {
            const callable = httpsCallable(functions, callableName);
            const response = await callable({ account: stripeConnectedAccountId });
            
            const { error, account, accountLink } = response.data;

            if (error) throw new Error(error.message || 'An unknown error occurred');

            if (action === 'create' && account) {
                await updateDoc(doc(db, 'users', user.uid), { stripeConnectedAccountId: account });
                toast.success('Stripe account created! Redirecting...', { id: toastId });
                // Fall through to create and redirect via account link
            }

            if (accountLink && accountLink.url) {
                window.location.href = accountLink.url;
            }

        } catch (err) {
            console.error(`Stripe ${action} error:`, err);
            toast.error(err.message || `Failed to ${action} Stripe account.`, { id: toastId });
        } finally {
            setStripeLoading(prev => ({ ...prev, [loadingKey]: false }));
        }
    }, [stripeConnectedAccountId, user.uid]);

    const renderAccountInfo = () => {
        if (editMode) {
            return (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 sm:items-start">
                        <p className="text-sm font-semibold text-gray-700">Profile Photo</p>
                        <div className="sm:col-span-2 space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <ProfileAvatar
                                    userData={{ ...dataBaseUser, ...formData }}
                                    previewUrl={photoPreviewUrl || formData.photoUrl}
                                    className="h-20 w-20"
                                    textClassName="text-xl"
                                />
                                <div className="space-y-2">
                                    <label
                                        htmlFor="profile-photo-upload"
                                        className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
                                    >
                                        Choose Photo
                                    </label>
                                    <input
                                        id="profile-photo-upload"
                                        type="file"
                                        accept="image/*"
                                        onChange={handlePhotoFileChange}
                                        className="sr-only"
                                    />
                                    {photoFile ? (
                                        <p className="text-xs text-gray-500">{photoFile.name} will upload when you save.</p>
                                    ) : (
                                        <p className="text-xs text-gray-500">Select an image or paste a photo URL below.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <FormField label="Photo URL" type="url" name="photoUrl" value={formData.photoUrl} onChange={handleInputChange} placeholder="https://..." />
                    <FormField label="First Name" name="firstName" value={formData.firstName} onChange={handleInputChange} />
                    <FormField label="Last Name" name="lastName" value={formData.lastName} onChange={handleInputChange} />
                    <FormField label="Email" type="email" name="email" value={formData.email} onChange={handleInputChange} />
                    <FormField label="Phone" type="tel" name="phoneNumber" value={formData.phoneNumber} onChange={handleInputChange} />
                    <FormField label="Bio" name="bio" value={formData.bio} onChange={handleInputChange} />
                </div>
            );
        }
        return (
            <div className="space-y-3">
                <InfoRow label="Name" value={fullName(dataBaseUser)} />
                <InfoRow label="Email" value={dataBaseUser.email} />
                <InfoRow label="Phone" value={dataBaseUser.phoneNumber} />
                <InfoRow label="Bio" value={dataBaseUser.bio} />
            </div>
        );
    };

    const renderSelectedCompanyInfo = () => {
        if (!recentlySelectedCompany) {
            return (
                <ProfileCard title="Selected Company">
                    <p className="text-sm text-gray-500">Select a company to see your company profile, work history, and paysheet.</p>
                    <Link
                        to="/company/selection"
                        className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
                    >
                        Select Company
                    </Link>
                </ProfileCard>
            );
        }

        const company = companyProfile.company || {};
        const companyUser = companyProfile.companyUser || companyUserAccess || {};
        const selectedCompanyName = company.name || recentlySelectedCompanyName || "Selected company";

        return (
            <ProfileCard
                title="Selected Company"
                actions={<ActionLink to="/company/selection">Change</ActionLink>}
            >
                {companyProfile.loading ? (
                    <p className="text-sm text-gray-500">Loading company profile...</p>
                ) : (
                    <div className="space-y-3">
                        <InfoRow label="Company" value={selectedCompanyName} />
                        <InfoRow label="Role" value={companyUser.roleName} />
                        <InfoRow label="Worker Type" value={companyUser.workerType} />
                        <InfoRow label="Status" value={companyUser.status} />
                        <InfoRow label="Company Email" value={company.email} />
                        <InfoRow label="Company Phone" value={company.phoneNumber} />
                    </div>
                )}
                {companyProfile.error ? <p className="text-sm font-semibold text-red-600">{companyProfile.error}</p> : null}
            </ProfileCard>
        );
    };

    const renderWorkHistory = () => {
        if (!recentlySelectedCompany) return null;

        const canOpenPayroll = typeof hasCompanyPermission === "function" ? hasCompanyPermission("400") : false;

        return (
            <ProfileCard
                title="My Work History"
                actions={canOpenPayroll ? <ActionLink to="/company/payroll?tab=statements">Open Paysheet</ActionLink> : null}
            >
                {companyProfile.loading ? (
                    <p className="text-sm text-gray-500">Loading work history...</p>
                ) : (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <SummaryTile
                                label="Miles"
                                value={`${workSummary.totalMiles.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`}
                            />
                            <SummaryTile label="Stops" value={workSummary.totalStops.toLocaleString()} />
                            <SummaryTile label="Work Items" value={workSummary.workItems.toLocaleString()} />
                            <SummaryTile
                                label="Unpaid"
                                value={moneyFromCents(workSummary.unpaidPayCents)}
                                helper={`${moneyFromCents(workSummary.totalPayCents)} total`}
                            />
                        </div>

                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="font-semibold text-gray-900">Paysheet</p>
                                    <p className="text-sm text-gray-600">
                                        {companyProfile.statements.length > 0
                                            ? `${companyProfile.statements.length} statement(s) in the last 180 days.`
                                            : "No recent pay statements found."}
                                    </p>
                                </div>
                                {canOpenPayroll ? (
                                    <ActionLink to="/company/payroll?tab=statements">Review</ActionLink>
                                ) : (
                                    <p className="text-sm font-semibold text-gray-600">Visible here from your profile.</p>
                                )}
                            </div>
                        </div>

                        <div>
                            <div className="mb-3 flex items-center justify-between">
                                <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Recent Past Routes</h3>
                                <span className="text-xs font-semibold text-gray-400">Past dates only</span>
                            </div>

                            {companyProfile.routes.length === 0 ? (
                                <p className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">No past routes found.</p>
                            ) : (
                                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                                    {companyProfile.routes.slice(0, 6).map((route) => (
                                        <div key={route.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                                            <div>
                                                <p className="font-semibold text-gray-900">{route.name || "Route"}</p>
                                                <p className="text-sm text-gray-500">{shortDate(route.date)} · {route.status || "No status"}</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2 text-xs font-semibold text-gray-600 sm:justify-end">
                                                <span className="rounded-full bg-gray-100 px-3 py-1">{Number(route.finishedStops || 0)}/{Number(route.totalStops || 0)} stops</span>
                                                <span className="rounded-full bg-gray-100 px-3 py-1">{Number(route.distanceMiles || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} mi</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </ProfileCard>
        );
    };

    if (!dataBaseUser) {
        return (
            <div className='min-h-screen bg-gray-50 p-8'>
                <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500 shadow-sm">
                    Loading profile...
                </div>
            </div>
        );
    }

    return (
        <div className='min-h-screen bg-gray-50 p-3 sm:p-4 lg:p-5'>
            <div className="w-full">
                <header className="mb-5 flex items-center gap-4">
                    <ProfileAvatar userData={dataBaseUser} className="h-20 w-20" textClassName="text-xl" />
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">{fullName(dataBaseUser) || "My Profile"}</h1>
                        <p className="text-gray-600">{dataBaseUser.email}</p>
                    </div>
                </header>

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
                    <div className="space-y-5">
                        <ProfileCard 
                            title="Account Info"
                            actions={
                                <div className="flex space-x-2">
                                    {editMode ? (
                                        <>
                                            <button
                                                onClick={handleCancelEdit}
                                                disabled={profileSaving}
                                                className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg text-sm hover:bg-gray-300 transition disabled:cursor-not-allowed disabled:opacity-60'
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleUpdateUser}
                                                disabled={profileSaving}
                                                className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-700 transition disabled:cursor-not-allowed disabled:bg-blue-300'
                                            >
                                                {profileSaving ? "Saving..." : "Save"}
                                            </button>
                                        </>
                                    ) : (
                                        <button onClick={() => setEditMode(true)} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-700 transition'>Edit Profile</button>
                                    )}
                                </div>
                            }
                        >
                            {renderAccountInfo()}
                        </ProfileCard>

                        {renderSelectedCompanyInfo()}
                        {renderWorkHistory()}

                        <ProfileCard title="External Accounts">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-semibold text-gray-800">Stripe</p>
                                        <p className="text-sm text-gray-500">Connect your Stripe account to process payments.</p>
                                    </div>
                                    {!stripeConnectedAccountId ? (
                                        <button onClick={() => handleStripeAction('create')} disabled={stripeLoading.create} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-700 transition disabled:bg-blue-300'>
                                            {stripeLoading.create ? 'Creating...' : 'Connect Stripe'}
                                        </button>
                                    ) : (
                                        <button onClick={() => handleStripeAction('link')} disabled={stripeLoading.link} className='py-2 px-4 bg-green-600 text-white font-semibold rounded-lg text-sm hover:bg-green-700 transition disabled:bg-green-300'>
                                            {stripeLoading.link ? 'Redirecting...' : 'Manage Account'}
                                        </button>
                                    )}
                                </div>
                                {/* Add QuickBooks connection here in the future */}
                            </div>
                        </ProfileCard>
                    </div>

                    <div className="space-y-5">
                        <ProfileCard title="Settings">
                            <button
                                type="button"
                                onClick={handlePasswordReset}
                                disabled={passwordResetLoading}
                                className="w-full text-left py-3 px-4 bg-blue-50 text-blue-700 font-semibold rounded-lg hover:bg-blue-100 transition disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {passwordResetLoading ? "Sending reset email..." : "Update Password"}
                            </button>
                             <button 
                                onClick={() => setShowDeleteModal(true)} 
                                className="w-full text-left py-3 px-4 bg-red-50 text-red-700 font-semibold rounded-lg hover:bg-red-100 transition"
                            >
                                Delete My Account
                            </button>
                        </ProfileCard>
                    </div>
                </div>
            </div>
            {showDeleteModal && <DeleteModal onConfirm={handleDeleteAccount} onCancel={() => setShowDeleteModal(false)} />}
        </div>
    );
}
