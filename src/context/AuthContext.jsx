import { createContext, useState, useEffect, useCallback } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from "../utils/config";
import { getDoc, doc, getDocs, where, query, collection, onSnapshot } from "firebase/firestore";
import { roleHasCompanyPermission } from "../utils/companyPermissionAccess";
import { normalizeEmail } from "../utils/email";
import { isCompanyAccessInactive } from "../utils/invites";
import { FIREBASE_NETWORK_FALLBACK_MS, isFirebaseNetworkError } from "../utils/firebaseNetwork";
import { normalizeCustomerTag } from "../utils/customerTags";
import { normalizeAccountType } from "../utils/accountTypes";
import {
    isCustomerBillingEnabled,
    isSalesBillingAutomationEnabled,
    isShoppingItemInstallInvoiceAutomationEnabled,
} from "../utils/sales/billingSettings";
import { isPayrollEnabled } from "../utils/companyWorkSettings";

export const Context = createContext();

const getStripeCustomerId = (companyData = {}) => (
    companyData.stripeCustomerId || companyData.stripeId || null
);

const getStripeConnectedAccountId = (companyData = {}) => (
    companyData.stripeConnectedAccountId || companyData.stripeConnectAccountId || null
);

const getCompanyDisplayName = (companyData = {}) => (
    String(companyData.name || companyData.companyName || companyData.displayName || companyData.businessName || "").trim() || null
);

const FEATURE_FLAGS_CACHE_KEY = "dripdrop.featureFlags.v1";
const CUSTOMER_REGION_FILTER_PREFIX = "dripdrop.customerRegionFilter";

const readCachedFeatureFlags = () => {
    if (typeof window === "undefined") return {};

    try {
        const rawFlags = window.localStorage.getItem(FEATURE_FLAGS_CACHE_KEY);
        const parsedFlags = rawFlags ? JSON.parse(rawFlags) : {};
        return parsedFlags && typeof parsedFlags === "object" && !Array.isArray(parsedFlags)
            ? parsedFlags
            : {};
    } catch (error) {
        console.warn("Unable to read cached feature flags:", error);
        return {};
    }
};

const writeCachedFeatureFlags = (featureFlags) => {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(FEATURE_FLAGS_CACHE_KEY, JSON.stringify(featureFlags));
    } catch (error) {
        console.warn("Unable to cache feature flags:", error);
    }
};

const hasCachedFeatureFlags = (featureFlags = {}) => Object.keys(featureFlags).length > 0;

const hydrateInviteCompanyName = async (invite) => {
    const companyId = String(invite?.companyId || invite?.linkedCompanyId || "").trim();
    if (!companyId) return invite;

    try {
        const companyDoc = await getDoc(doc(db, "companies", companyId));
        if (!companyDoc.exists()) return invite;

        const companyName = getCompanyDisplayName(companyDoc.data());
        return companyName ? { ...invite, companyName } : invite;
    } catch (error) {
        console.error("Error loading invite company context:", error);
        return invite;
    }
};

export function AuthContext({ children }) {
    // User Information
    const auth = getAuth();
    const [user, setUser] = useState(null);
    const [authRevision, setAuthRevision] = useState(0);
    const [dataBaseUser, setDataBaseUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [accountType, setAccountType] = useState(null);
    const [name, setName] = useState(null);
    const [photoUrl, setPhotoUrl] = useState(null);

    // Company Information
    const [recentlySelectedCompany, setRecentlySelectedCompany] = useState(null);
    const [recentlySelectedCompanyName, setRecentlySelectedCompanyName] = useState(null);
    const [companyOwnerId, setCompanyOwnerId] = useState(null);
    const [stripeConnectedAccountId, setStripeConnectedAccountId] = useState(null);
    const [customerBillingEnabled, setCustomerBillingEnabled] = useState(false);
    const [salesBillingAutomationEnabled, setSalesBillingAutomationEnabled] = useState(false);
    const [shoppingItemInstallInvoiceAutomationEnabled, setShoppingItemInstallInvoiceAutomationEnabled] = useState(false);
    const [payrollEnabled, setPayrollEnabled] = useState(true);
    const [stripeId, setStripeId] = useState(null);

    // Role Information
    const [role, setRole] = useState(null);
    const [companyUserAccess, setCompanyUserAccess] = useState(null);
    const [companyRole, setCompanyRole] = useState(null);
    const [companyRoleLoading, setCompanyRoleLoading] = useState(false);
    const [companyRoleLoaded, setCompanyRoleLoaded] = useState(false);
    const [selectedCustomerRegionTag, setSelectedCustomerRegionTagState] = useState("");

    // Subscription Information
    const [companySubscription, setCompanySubscription] = useState(null);

    // Invite Information
    const [pendingInvite, setPendingInvite] = useState(null);

    // Feature Flags
    const [featureFlags, setFeatureFlags] = useState(() => readCachedFeatureFlags());
    const [featureFlagsLoaded, setFeatureFlagsLoaded] = useState(() => hasCachedFeatureFlags(readCachedFeatureFlags()));
    const [featureFlagsOfflineFallback, setFeatureFlagsOfflineFallback] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);

                // Check for pending invites first
                try {
                    const normalizedEmail = normalizeEmail(currentUser.email);
                    const invitesRef = collection(db, "invites");
                    const q = query(
                        invitesRef,
                        where("email", "==", normalizedEmail),
                        where("status", "in", ["pending", "Pending"])
                    );
                    const inviteSnapshot = await getDocs(q);
                    if (!inviteSnapshot.empty) {
                        const invite = { id: inviteSnapshot.docs[0].id, ...inviteSnapshot.docs[0].data() };
                        setPendingInvite(await hydrateInviteCompanyName(invite));
                    } else {
                        setPendingInvite(null);
                    }
                } catch (error) {
                    console.error("Error checking for pending invites:", error);
                }

                // Then, fetch user data
                try {
                    const docRef = doc(db, "users", currentUser.uid);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const dbUser = docSnap.data();
                        const token = await currentUser.getIdTokenResult();
                        const requestedAccountType = normalizeAccountType(dbUser.accountType);
                        const platformAdmin = token.claims.admin === true || currentUser.uid === "yRV5Ie18rrUSxT6UkWctPc99lMJ2";
                        const normalizedAccountType = requestedAccountType === "Admin" && !platformAdmin ? null : requestedAccountType;
                        const appUser = {
                            ...dbUser,
                            accountType: normalizedAccountType,
                        };
                        setDataBaseUser(appUser);
                        setAccountType(normalizedAccountType);
                        setRole(normalizedAccountType);
                        setName(`${dbUser.firstName} ${dbUser.lastName}`);
                        setPhotoUrl(dbUser.photoUrl);
                        setStripeId(getStripeCustomerId(dbUser));

                        if (normalizedAccountType === 'Company') {
                            setRecentlySelectedCompany(dbUser.recentlySelectedCompany);

                            if (dbUser.recentlySelectedCompany) {
                                const companyDocRef = doc(db, "companies", dbUser.recentlySelectedCompany);
                                const companyDoc = await getDoc(companyDocRef);
                                if (companyDoc.exists()) {
                                    const companyData = companyDoc.data();
                                    setRecentlySelectedCompanyName(getCompanyDisplayName(companyData));
                                    setStripeConnectedAccountId(getStripeConnectedAccountId(companyData));
                                    setCustomerBillingEnabled(isCustomerBillingEnabled(companyData));
                                    setSalesBillingAutomationEnabled(isSalesBillingAutomationEnabled(companyData));
                                    setShoppingItemInstallInvoiceAutomationEnabled(isShoppingItemInstallInvoiceAutomationEnabled(companyData));
                                    setPayrollEnabled(isPayrollEnabled(companyData));
                                    setStripeId(getStripeCustomerId(dbUser) || getStripeCustomerId(companyData));
                                } else {
                                    setRecentlySelectedCompanyName(null);
                                    setStripeConnectedAccountId(null);
                                    setCustomerBillingEnabled(false);
                                    setSalesBillingAutomationEnabled(false);
                                    setShoppingItemInstallInvoiceAutomationEnabled(false);
                                    setPayrollEnabled(true);
                                }
                            }
                        } else {
                            setRecentlySelectedCompany(null);
                            setPayrollEnabled(true);
                        }
                    } else {
                        console.log("No DB User Found on Auth Context");
                    }
                } catch (error) {
                    console.error('Auth Context Error:', error);
                }

            } else {
                // Clear all state on logout
                setUser(null);
                setDataBaseUser(null);
                setAccountType(null);
                setRole(null);
                setName(null);
                setPhotoUrl(null);
                setRecentlySelectedCompany(null);
                setRecentlySelectedCompanyName(null);
                setStripeConnectedAccountId(null);
                setCustomerBillingEnabled(false);
                setSalesBillingAutomationEnabled(false);
                setShoppingItemInstallInvoiceAutomationEnabled(false);
                setPayrollEnabled(true);
                setStripeId(null);
                setCompanyUserAccess(null);
                setCompanyRole(null);
                setCompanyRoleLoading(false);
                setCompanyRoleLoaded(false);
                setCompanySubscription(null);
                setPendingInvite(null);
                setFeatureFlags({});
                setFeatureFlagsLoaded(false);
                setFeatureFlagsOfflineFallback(false);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [auth]);

    const refreshAccount = useCallback(async () => {
        const currentUser = auth.currentUser;
        if (!currentUser) return false;
        await currentUser.reload();
        await currentUser.getIdToken(true);
        setAuthRevision(value => value + 1);
        return currentUser.emailVerified === true;
    }, [auth]);

    useEffect(() => {
        if (!user?.uid) return undefined;
        return onSnapshot(doc(db, 'users', user.uid), async snapshot => {
            if (!snapshot.exists()) return;
            const profile = snapshot.data();
            const requestedType = normalizeAccountType(profile.accountType);
            const token = await user.getIdTokenResult();
            if (auth.currentUser?.uid !== user.uid) return;
            const trustedAdmin = token.claims.admin === true || user.uid === "yRV5Ie18rrUSxT6UkWctPc99lMJ2";
            const type = requestedType === "Admin" && !trustedAdmin ? null : requestedType;
            setDataBaseUser({ ...profile, accountType: type });
            setAccountType(type);
            setRole(type);
            setName([profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.name || '');
            setPhotoUrl(profile.photoUrl || '');
        }, error => console.error('Unable to refresh account profile:', error));
    }, [user?.uid]);

    useEffect(() => {
        if (!user) {
            setFeatureFlags({});
            setFeatureFlagsLoaded(false);
            setFeatureFlagsOfflineFallback(false);
            return undefined;
        }

        const cachedFlags = readCachedFeatureFlags();
        let featureFlagsResolved = false;

        setFeatureFlags((currentFlags) => hasCachedFeatureFlags(cachedFlags) ? cachedFlags : currentFlags);
        setFeatureFlagsLoaded(hasCachedFeatureFlags(cachedFlags));
        setFeatureFlagsOfflineFallback(false);

        const fallbackTimer = window.setTimeout(() => {
            if (featureFlagsResolved) return;

            const latestCachedFlags = readCachedFeatureFlags();
            if (hasCachedFeatureFlags(latestCachedFlags)) {
                setFeatureFlags(latestCachedFlags);
            }

            setFeatureFlagsOfflineFallback(true);
            setFeatureFlagsLoaded(true);
        }, FIREBASE_NETWORK_FALLBACK_MS);

        const unsubscribe = onSnapshot(
            collection(db, "featureFlags"),
            (snapshot) => {
                const nextFeatureFlags = snapshot.docs.reduce((acc, flagDoc) => {
                    acc[flagDoc.id] = {
                        id: flagDoc.id,
                        ...flagDoc.data(),
                    };

                    return acc;
                }, {});
                const waitingForServerFlags = snapshot.metadata?.fromCache && !hasCachedFeatureFlags(nextFeatureFlags);

                if (!waitingForServerFlags) {
                    featureFlagsResolved = true;
                    window.clearTimeout(fallbackTimer);
                    writeCachedFeatureFlags(nextFeatureFlags);
                }

                setFeatureFlags((currentFlags) => (
                    waitingForServerFlags && hasCachedFeatureFlags(currentFlags)
                        ? currentFlags
                        : nextFeatureFlags
                ));
                setFeatureFlagsLoaded(true);
                setFeatureFlagsOfflineFallback(waitingForServerFlags);
            },
            (error) => {
                featureFlagsResolved = true;
                window.clearTimeout(fallbackTimer);

                console.error("Error loading feature flags:", error);
                const cachedFlags = readCachedFeatureFlags();
                setFeatureFlags(cachedFlags);
                setFeatureFlagsLoaded(true);
                setFeatureFlagsOfflineFallback(isFirebaseNetworkError(error));
            }
        );

        return () => {
            featureFlagsResolved = true;
            window.clearTimeout(fallbackTimer);
            unsubscribe();
        };
    }, [user]);

    useEffect(() => {
        let cancelled = false;
        let stopRole = () => {};
        let roleGeneration = 0;
        let companyData;
        let accessData;
        let loadedRoleId;
        const clearAccess = () => {
            setCompanyOwnerId(null);
            setCompanyUserAccess(null);
            setCompanyRole(null);
            setCompanyRoleLoading(false);
            setCompanyRoleLoaded(true);
        };
        setCompanyOwnerId(null);
        setCompanyUserAccess(null);
        setCompanyRole(null);
        setCompanyRoleLoaded(false);
        setCompanyRoleLoading(Boolean(user && accountType === "Company" && recentlySelectedCompany));
        if (!user || accountType !== "Company" || !recentlySelectedCompany) {
            setCompanyRoleLoading(false);
            return undefined;
        }
        const reconcile = () => {
            if (cancelled || companyData === undefined || accessData === undefined) return;
            const owner = companyData?.ownerId === user.uid;
            if (!companyData || (!owner && (!accessData || isCompanyAccessInactive(accessData)))) {
                roleGeneration += 1;
                stopRole();
                loadedRoleId = undefined;
                clearAccess();
                return;
            }
            setCompanyOwnerId(companyData.ownerId || null);
            setCompanyUserAccess(accessData);
            const roleId = accessData?.roleId;
            if (!roleId) {
                stopRole();
                roleGeneration += 1;
                loadedRoleId = undefined;
                setCompanyRole(null);
                setCompanyRoleLoading(false);
                setCompanyRoleLoaded(true);
                return;
            }
            if (loadedRoleId === roleId) return;
            stopRole();
            loadedRoleId = roleId;
            const generation = ++roleGeneration;
            setCompanyRole(null);
            setCompanyRoleLoading(true);
            stopRole = onSnapshot(doc(db, "companies", recentlySelectedCompany, "roles", roleId), snapshot => {
                if (cancelled || generation !== roleGeneration) return;
                setCompanyRole(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
                setCompanyRoleLoading(false);
                setCompanyRoleLoaded(true);
            }, error => {
                if (cancelled || generation !== roleGeneration) return;
                console.error("Company role access unavailable", error);
                clearAccess();
            });
        };
        const stopCompany = onSnapshot(doc(db, "companies", recentlySelectedCompany), snapshot => {
            if (cancelled) return;
            companyData = snapshot.exists() ? snapshot.data() : null;
            setCompanyOwnerId(companyData?.ownerId || null);
            setRecentlySelectedCompanyName(companyData ? getCompanyDisplayName(companyData) : null);
            setStripeConnectedAccountId(companyData ? getStripeConnectedAccountId(companyData) : null);
            setCustomerBillingEnabled(companyData ? isCustomerBillingEnabled(companyData) : false);
            setSalesBillingAutomationEnabled(companyData ? isSalesBillingAutomationEnabled(companyData) : false);
            setShoppingItemInstallInvoiceAutomationEnabled(companyData ? isShoppingItemInstallInvoiceAutomationEnabled(companyData) : false);
            setPayrollEnabled(companyData ? isPayrollEnabled(companyData) : true);
            reconcile();
        }, () => { if (!cancelled) { companyData = null; reconcile(); } });
        const stopAccess = onSnapshot(doc(db, "users", user.uid, "userAccess", recentlySelectedCompany), snapshot => {
            if (cancelled) return;
            accessData = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
            reconcile();
        }, () => { if (!cancelled) { accessData = null; reconcile(); } });
        return () => { cancelled = true; roleGeneration += 1; stopCompany(); stopAccess(); stopRole(); };
    }, [user, accountType, recentlySelectedCompany]);

    useEffect(() => {
        if (!recentlySelectedCompany || typeof window === "undefined") {
            setSelectedCustomerRegionTagState("");
            return;
        }

        try {
            setSelectedCustomerRegionTagState(
                normalizeCustomerTag(window.localStorage.getItem(`${CUSTOMER_REGION_FILTER_PREFIX}.${recentlySelectedCompany}`))
            );
        } catch (error) {
            console.warn("Unable to read customer region filter:", error);
            setSelectedCustomerRegionTagState("");
        }
    }, [recentlySelectedCompany]);

    const setSelectedCustomerRegionTag = useCallback((tag) => {
        const normalizedTag = normalizeCustomerTag(tag);
        setSelectedCustomerRegionTagState(normalizedTag);

        if (!recentlySelectedCompany || typeof window === "undefined") return;

        try {
            const key = `${CUSTOMER_REGION_FILTER_PREFIX}.${recentlySelectedCompany}`;
            if (normalizedTag) {
                window.localStorage.setItem(key, normalizedTag);
            } else {
                window.localStorage.removeItem(key);
            }
        } catch (error) {
            console.warn("Unable to store customer region filter:", error);
        }
    }, [recentlySelectedCompany]);

    const hasCompanyPermission = useCallback((permissionId) => {
        if (companyRoleLoading || !companyRoleLoaded) return false;
        if (companyOwnerId === user?.uid && String(permissionId) !== "300") return true;
        if (!companyUserAccess || isCompanyAccessInactive(companyUserAccess)) return false;
        if (Array.isArray(companyRole?.permissionIdList) && String(companyRole?.name || "").toLowerCase() === String(companyUserAccess.roleName || "").toLowerCase() && ["owner", "admin", "manager"].includes(String(companyUserAccess.roleName || "").toLowerCase()) && String(permissionId) !== "300") return true;
        return roleHasCompanyPermission(companyRole, permissionId);
    }, [companyRole, companyUserAccess, companyOwnerId, user?.uid, companyRoleLoading, companyRoleLoaded]);

    const isFeatureEnabled = useCallback((featureFlagId) => {
        if (featureFlagsOfflineFallback && !featureFlags[featureFlagId]) {
            return true;
        }

        return Boolean(featureFlags[featureFlagId]?.enabled);
    }, [featureFlags, featureFlagsOfflineFallback]);

    const values = {
        user,
        authRevision,
        refreshAccount,
        setUser,
        dataBaseUser,
        setDataBaseUser,
        accountType,
        name,
        photoUrl,
        recentlySelectedCompany,
        setRecentlySelectedCompany,
        stripeConnectedAccountId,
        setStripeConnectedAccountId,
        customerBillingEnabled,
        setCustomerBillingEnabled,
        salesBillingAutomationEnabled,
        setSalesBillingAutomationEnabled,
        shoppingItemInstallInvoiceAutomationEnabled,
        setShoppingItemInstallInvoiceAutomationEnabled,
        payrollEnabled,
        setPayrollEnabled,
        stripeId,
        setStripeId,
        recentlySelectedCompanyName,
        setRecentlySelectedCompanyName,
        role,
        setRole,
        companyUserAccess,
        companyOwnerId,
        setCompanyUserAccess,
        companyRole,
        setCompanyRole,
        companyRoleLoading,
        companyRoleLoaded,
        hasCompanyPermission,
        selectedCustomerRegionTag,
        setSelectedCustomerRegionTag,
        featureFlags,
        featureFlagsLoaded,
        featureFlagsOfflineFallback,
        isFeatureEnabled,
        companySubscription,
        setCompanySubscription,
        pendingInvite, // Pass invite data down
        setPendingInvite, // Pass setter function down
    };

    return (
        <Context.Provider value={values}>
            {!loading && children}
        </Context.Provider>
    );
}
