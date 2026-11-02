import React, { useState, useContext, useEffect, useCallback, useMemo } from "react";
import { updateProfile } from "firebase/auth";
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Link } from "react-router-dom";
import { Context } from "../../context/AuthContext";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where } from "firebase/firestore";
import { auth, db, functions, storage } from '../../utils/config';
import { FaExternalLinkAlt } from "react-icons/fa";
import { HiOutlineUserCircle, HiOutlineBuildingOffice2, HiOutlineWallet, HiOutlineClock, HiOutlineCog6Tooth, HiOutlineLink } from "react-icons/hi2";
import { profilePayoutSummary } from "../../utils/profilePayout";
import "./ProfilePage.css";
import toast from 'react-hot-toast';
import { appConfirm } from "../../utils/appDialog";
import {
    PASSWORD_RESET_RECENTLY_SENT_CODE,
    getPasswordResetRecipientEmail,
    sendAccountPasswordResetEmail,
} from "../../utils/passwordReset";

const primaryButtonClass = "profile-button profile-button-primary";
const secondaryButtonClass = "profile-button profile-button-secondary";
const subtleButtonClass = "profile-button profile-button-subtle";
const dangerButtonClass = "profile-button profile-button-danger";
const dangerSubtleButtonClass = "profile-button profile-button-danger-subtle";

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

const sectionIcons = {
    "Account Info": HiOutlineUserCircle, "Selected Company": HiOutlineBuildingOffice2,
    "Payout Snapshot": HiOutlineWallet, "My Work History": HiOutlineClock,
    "Connected Accounts": HiOutlineLink, "Settings": HiOutlineCog6Tooth,
};
const ProfileCard = ({ title, children, actions, className = "", subtitle }) => {
    const Icon = sectionIcons[title] || HiOutlineUserCircle;
    return (
        <section className={`profile-card ${className}`} aria-label={title}>
            <div className="profile-card-header">
                <div>
                    <h2 className="profile-card-title"><Icon className="profile-section-icon" aria-hidden="true" />{title}</h2>
                    {subtitle && <p className="profile-payout-subtitle">{subtitle}</p>}
                </div>
                {actions && <div className="shrink-0">{actions}</div>}
            </div>
            <div className="profile-card-body">{children}</div>
        </section>
    );
};

const InfoRow = ({ label, value }) => (
    <div className="profile-info-row"><dt>{label}</dt><dd>{value || 'Not set'}</dd></div>
);

const FormField = ({ label, name, type = 'text', value, onChange, placeholder }) => (
    <div className="profile-field">
        <label htmlFor={`profile-${name}`}>{label}</label>
        <input id={`profile-${name}`} name={name} type={type} value={value} onChange={onChange} placeholder={placeholder} />
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
    <div className="profile-metric">
        <p className="profile-metric-label">{label}</p>
        <p className="profile-metric-value">{value}</p>
        {helper ? <p className="profile-metric-helper">{helper}</p> : null}
    </div>
);

const ActionLink = ({ to, children }) => (
    <Link
        to={to}
        className={primaryButtonClass}
    >
        {children}
    </Link>
);

const DeleteModal = ({ onConfirm, onCancel }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
        <div role="dialog" aria-modal="true" aria-labelledby="delete-profile-title" className="profile-dialog p-8 rounded-2xl shadow-xl max-w-md w-full">
            <h3 id="delete-profile-title" className="text-2xl font-bold mb-4">Are you sure?</h3>
            <p className="text-theme-muted mb-8">This action is irreversible and will permanently delete your account.</p>
            <div className="flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className={secondaryButtonClass}>Cancel</button>
                <button type="button" onClick={onConfirm} className={dangerButtonClass}>Delete Account</button>
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
        setStripeConnectedAccountId,
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        companyUserAccess,
        hasCompanyPermission,
    } = useContext(Context);
    const canViewPayrollInformation = typeof hasCompanyPermission === "function"
        ? hasCompanyPermission("420")
        : false;

    const [editMode, setEditMode] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [formData, setFormData] = useState({});
    const [profileSaving, setProfileSaving] = useState(false);
    const [passwordResetLoading, setPasswordResetLoading] = useState(false);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
    const [companyProfileState, setCompanyProfile] = useState({
        company: null,
        companyUser: null,
        routes: [],
        lineItems: [],
        statements: [],
        loading: false,
        error: "",
    });
    const profileScope = `${recentlySelectedCompany || ""}:${user?.uid || ""}:${canViewPayrollInformation}`;
    const companyProfile = companyProfileState.scope === profileScope ? companyProfileState : {
        company: null, companyUser: null, routes: [], lineItems: [], statements: [],
        loading: Boolean(recentlySelectedCompany && user?.uid), error: "",
    };

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

            setCompanyProfile({ scope: profileScope, company: null, companyUser: null, routes: [], lineItems: [], statements: [], loading: true, error: "" });

            try {
                const startDate = dateDaysAgo(365);
                const endDate = endOfToday();
                const todayStart = startOfToday();

                const companyRef = doc(db, "companies", recentlySelectedCompany);
                const companyUsersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
                const activeRoutesRef = collection(db, "companies", recentlySelectedCompany, "activeRoutes");
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
                    canViewPayrollInformation
                        ? getDocs(query(
                            collection(db, "companies", recentlySelectedCompany, "technicianPayLineItems"),
                            where("technicianId", "==", user.uid),
                            where("completedDate", ">=", startDate),
                            where("completedDate", "<=", endDate)
                        ))
                        : Promise.resolve({ docs: [] }),
                    canViewPayrollInformation
                        ? getDocs(query(collection(db, "companies", recentlySelectedCompany, "technicianPayStatements"), where("technicianId", "==", user.uid)))
                        : Promise.resolve({ docs: [] }),
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
                    scope: profileScope,
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
    }, [canViewPayrollInformation, recentlySelectedCompany, user?.uid, profileScope]);

    const workSummary = useMemo(() => {
        const activeLineItems = companyProfile.lineItems.filter((item) => !item.voidedAt && dateFromValue(item.completedDate) >= dateDaysAgo(180));
        const totalMiles = companyProfile.routes.reduce((total, route) => total + Number(route.distanceMiles || route.distance || 0), 0);
        const totalStops = companyProfile.routes.reduce((total, route) => total + Number(route.finishedStops || 0), 0);
        return {
            totalMiles,
            totalStops,
            workItems: activeLineItems.length,
        };
    }, [companyProfile.lineItems, companyProfile.routes]);

    const payoutSummary = useMemo(() => profilePayoutSummary(companyProfile.lineItems, companyProfile.statements), [companyProfile.lineItems, companyProfile.statements]);

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
        if (passwordResetLoading) return;

        const email = getPasswordResetRecipientEmail(auth.currentUser?.email, user?.email, dataBaseUser?.email);
        if (!email) {
            toast.error("No email address found for this account.");
            return;
        }


        const confirmed = await appConfirm({
            title: "Send Password Reset Email?",
            message: `Send a password reset email to ${email}? The person with access to that inbox will be able to change this account's password.`,
            confirmLabel: "Send Reset Email",
        });
        if (!confirmed) return;

        setPasswordResetLoading(true);
        const toastId = toast.loading("Sending password reset email...");

        try {
            await sendAccountPasswordResetEmail(auth, email);
            toast.success(`Password reset email sent to ${email}.`, { id: toastId });
        } catch (error) {
            console.error("Error sending password reset email:", error);
            const message = error?.code === PASSWORD_RESET_RECENTLY_SENT_CODE
                ? "A password reset email was just sent. Please wait a minute before sending another one."
                : "Failed to send password reset email.";
            toast.error(message, { id: toastId });
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
        if (!recentlySelectedCompany) {
            toast.error('Select a company before managing Stripe.');
            return;
        }

        const activeUser = auth.currentUser;
        if (!activeUser) {
            toast.error('Your session expired. Sign in again before managing Stripe.');
            return;
        }

        if (user?.uid && activeUser.uid !== user.uid) {
            toast.error('Your session changed. Refresh the page before managing Stripe.');
            return;
        }

        const loadingKey = action === 'create' ? 'create' : 'link';

        setStripeLoading(prev => ({ ...prev, [loadingKey]: true }));
        const toastId = toast.loading(`Processing Stripe request...`);

        try {
            const idToken = await activeUser.getIdToken(true);
            let accountId = stripeConnectedAccountId;

            if (action === 'create') {
                const createAccount = httpsCallable(functions, 'createNewStripeAccount');
                const createResponse = await createAccount({
                    companyId: recentlySelectedCompany,
                    email: companyProfile.company?.email || dataBaseUser?.email || user?.email || '',
                    idToken,
                });

                accountId = createResponse.data?.account;
                if (accountId) {
                    setStripeConnectedAccountId(accountId);
                }
            }

            if (!accountId) {
                throw new Error('Stripe connected account was not found.');
            }

            const createAccountLink = httpsCallable(functions, 'createStripeAccountLink');
            const response = await createAccountLink({
                companyId: recentlySelectedCompany,
                accountId,
                returnUrl: window.location.href,
                refreshUrl: window.location.href,
                idToken,
            });

            const { error, accountLink, url } = response.data || {};

            if (error) throw new Error(error.message || 'An unknown error occurred');

            if (accountLink || url) {
                toast.success('Redirecting to Stripe...', { id: toastId });
                window.location.href = accountLink || url;
                return;
            }

            throw new Error('Stripe did not return an onboarding link.');
        } catch (err) {
            console.error(`Stripe ${action} error:`, err);
            const errorMessage = err.code === 'functions/unauthenticated'
                ? 'Your session expired. Sign in again before managing Stripe.'
                : err.details?.message || err.message || `Failed to ${action} Stripe account.`;
            toast.error(errorMessage, { id: toastId });
        } finally {
            setStripeLoading(prev => ({ ...prev, [loadingKey]: false }));
        }
    }, [
        companyProfile.company?.email,
        dataBaseUser?.email,
        recentlySelectedCompany,
        setStripeConnectedAccountId,
        stripeConnectedAccountId,
        user?.email,
        user?.uid,
    ]);

    const renderAccountInfo = () => {
        if (editMode) {
            return (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 sm:items-start">
                        <p className="text-sm font-semibold text-theme-muted">Profile Photo</p>
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
                                        className={`${secondaryButtonClass} cursor-pointer`}
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
                                        <p className="text-xs text-theme-subtle">{photoFile.name} will upload when you save.</p>
                                    ) : (
                                        <p className="text-xs text-theme-subtle">Select an image or paste a photo URL below.</p>
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
            <dl>
                <InfoRow label="Name" value={fullName(dataBaseUser)} />
                <InfoRow label="Email" value={dataBaseUser.email} />
                <InfoRow label="Phone" value={dataBaseUser.phoneNumber} />
                {dateFromValue(dataBaseUser.dateCreated) && <InfoRow label="Member Since" value={shortDate(dataBaseUser.dateCreated)} />}
                <InfoRow label="Bio" value={dataBaseUser.bio} />
            </dl>
        );
    };

    const renderSelectedCompanyInfo = () => {
        if (!recentlySelectedCompany) {
            return (
                <ProfileCard title="Selected Company" className="profile-company">
                    <p className="text-sm text-theme-subtle">Select a company to see your company profile, work history, and paysheet.</p>
                    <Link
                        to="/company/selection"
                        className={secondaryButtonClass}
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
                title="Selected Company" className="profile-company"
                actions={<ActionLink to="/company/selection">Change</ActionLink>}
            >
                {companyProfile.loading ? (
                    <p className="text-sm text-theme-subtle">Loading company profile...</p>
                ) : (
                    <dl>
                        <InfoRow label="Company" value={selectedCompanyName} />
                        <InfoRow label="Role" value={companyUser.roleName} />
                        <InfoRow label="Worker Type" value={companyUser.workerType} />
                        <InfoRow label="Status" value={companyUser.status} />
                        <InfoRow label="Company Email" value={company.email} />
                        <InfoRow label="Company Phone" value={company.phoneNumber} />
                    </dl>
                )}
                {companyProfile.error ? <p className="text-sm font-semibold text-red-600">{companyProfile.error}</p> : null}
            </ProfileCard>
        );
    };

    const renderPayout = () => {
        if (!recentlySelectedCompany || !canViewPayrollInformation) return null;
        return (
            <ProfileCard title="Payout Snapshot" className="profile-payout"
                subtitle={companyProfile.loading ? "Loading payout history..." : companyProfile.error ? "Payout history is unavailable." : payoutSummary.subtitle}>
                {companyProfile.error ? <p role="alert" className="profile-error">{companyProfile.error}</p> : (
                    <div className="profile-metrics" aria-busy={companyProfile.loading}>
                        <SummaryTile label="Owed" value={companyProfile.loading ? "—" : moneyFromCents(payoutSummary.owedCents)} />
                        <SummaryTile label="Work Done" value={companyProfile.loading ? "—" : payoutSummary.workDone} />
                        <SummaryTile label="Last Payout" value={companyProfile.loading ? "—" : payoutSummary.lastPayoutLabel} />
                    </div>
                )}
                <div className="profile-payout-actions">
                    <ActionLink to="/company/payroll?tab=statements">Open Paysheet</ActionLink>
                    <Link to="/company/payroll?tab=requests" className={secondaryButtonClass}>Pay Requests</Link>
                </div>
            </ProfileCard>
        );
    };

    const renderWorkHistory = () => {
        if (!recentlySelectedCompany) return null;
        return (
            <ProfileCard title="My Work History" className="profile-history" subtitle="Recent past routes · up to 25 routes">
                {companyProfile.loading ? <p className="text-theme-subtle" role="status">Loading work history...</p>
                : companyProfile.error ? <p className="profile-error" role="alert">{companyProfile.error}</p> : <>
                    <div className="profile-metrics">
                        <SummaryTile label="Miles" value={`${workSummary.totalMiles.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`} />
                        <SummaryTile label="Stops" value={workSummary.totalStops.toLocaleString()} />
                        {canViewPayrollInformation && <SummaryTile label="Work Items" value={workSummary.workItems.toLocaleString()} helper="Last 180 days" />}
                    </div>
                    {companyProfile.routes.length === 0 ? <p className="profile-empty">No past routes found. Completed route activity will appear here.</p> : (
                        <div>{companyProfile.routes.slice(0, 6).map((route) => (
                            <div key={route.id} className="profile-route">
                                <div><p className="profile-route-title">{route.name || "Route"}</p><p className="profile-caption">{shortDate(route.date)} · {route.status || "No status"}</p></div>
                                <div className="profile-route-badges">
                                    <span>{Number(route.finishedStops || 0)}/{Number(route.totalStops || 0)} stops</span>
                                    <span>{Number(route.distanceMiles || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} mi</span>
                                </div>
                            </div>
                        ))}</div>
                    )}
                </>}
            </ProfileCard>
        );
    };

    const canManageStripeAccount = Boolean(
        recentlySelectedCompany &&
        user?.uid &&
        companyProfile.company?.ownerId === user.uid
    );

    if (!dataBaseUser) {
        return (
            <div className='profile-page'>
                <div className="profile-card p-8 text-center" role="status">
                    Loading profile...
                </div>
            </div>
        );
    }

    return (
        <div className='profile-page'>
            <div className="profile-workspace">
                <header className="profile-hero">
                    <ProfileAvatar userData={dataBaseUser} className="h-20 w-20" textClassName="text-xl" />
                    <div className="profile-hero-copy">
                        <p className="profile-eyebrow">My Profile</p>
                        <h1>{fullName(dataBaseUser) || "My Profile"}</h1>
                        <p className="profile-hero-email">{dataBaseUser.email}</p>
                    </div>
                    {recentlySelectedCompany && <span className="profile-company-badge"><HiOutlineBuildingOffice2 aria-hidden="true" />{companyProfile.company?.name || recentlySelectedCompanyName || "Selected company"}</span>}
                </header>
                {renderPayout()}

                <div className="profile-grid">
                    <div className="profile-main">
                        <ProfileCard
                            title="Account Info" className="profile-account"
                            actions={
                                <div className="flex gap-2">
                                    {editMode ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={handleCancelEdit}
                                                disabled={profileSaving}
                                                className={secondaryButtonClass}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleUpdateUser}
                                                disabled={profileSaving}
                                                className={primaryButtonClass}
                                            >
                                                {profileSaving ? "Saving..." : "Save"}
                                            </button>
                                        </>
                                    ) : (
                                        <button type="button" onClick={() => setEditMode(true)} className={primaryButtonClass}>Edit Profile</button>
                                    )}
                                </div>
                            }
                        >
                            {renderAccountInfo()}
                        </ProfileCard>

                        {renderWorkHistory()}

                    </div>
                    <aside className="profile-aside">
                        {renderSelectedCompanyInfo()}
                        <ProfileCard title="Connected Accounts" className="profile-connections">
                            <div className="space-y-4">
                                <div className="profile-connection">
                                    <div>
                                        <p className="font-semibold text-theme">Stripe</p>
                                        <p className="text-sm text-theme-subtle">Connect your Stripe account to process payments.</p>
                                    </div>
                                    {!recentlySelectedCompany ? (
                                        <p className="text-sm font-semibold text-theme-muted">Select a company first.</p>
                                    ) : companyProfile.loading ? (
                                        <p className="text-sm font-semibold text-theme-muted">Loading company...</p>
                                    ) : !canManageStripeAccount ? (
                                        <p className="text-sm font-semibold text-theme-muted">Only the company owner can manage Stripe.</p>
                                    ) : !stripeConnectedAccountId ? (
                                        <button type="button" onClick={() => handleStripeAction('create')} disabled={stripeLoading.create} className={primaryButtonClass}>
                                            {stripeLoading.create ? 'Creating...' : 'Connect Stripe'}
                                            <FaExternalLinkAlt className="h-3 w-3" />
                                        </button>
                                    ) : (
                                        <button type="button" onClick={() => handleStripeAction('link')} disabled={stripeLoading.link} className={subtleButtonClass}>
                                            {stripeLoading.link ? 'Redirecting...' : 'Manage Account'}
                                            <FaExternalLinkAlt className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                                {/* Add QuickBooks connection here in the future */}
                            </div>
                        </ProfileCard>
                        <ProfileCard title="Settings" className="profile-settings">
                            <button
                                type="button"
                                onClick={handlePasswordReset}
                                disabled={passwordResetLoading}
                                className={`${subtleButtonClass} w-full justify-start`}
                            >
                                {passwordResetLoading ? "Sending reset email..." : "Send Password Reset Email"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowDeleteModal(true)}
                                className={`${dangerSubtleButtonClass} w-full justify-start`}
                            >
                                Delete My Account
                            </button>
                        </ProfileCard>
                    </aside>
                </div>
            </div>
            {showDeleteModal && <DeleteModal onConfirm={handleDeleteAccount} onCancel={() => setShowDeleteModal(false)} />}
        </div>
    );
}
