import { createContext, useState, useEffect, useCallback } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from "../utils/config";
import { getDoc, doc, getDocs, where, query, collection, onSnapshot } from "firebase/firestore";
import { roleHasCompanyPermission } from "../utils/companyPermissionAccess";
import { normalizeEmail } from "../utils/email";
import { isCompanyAccessInactive } from "../utils/invites";

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
    const [dataBaseUser, setDataBaseUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [accountType, setAccountType] = useState(null);
    const [name, setName] = useState(null);
    const [photoUrl, setPhotoUrl] = useState(null);

    // Company Information
    const [recentlySelectedCompany, setRecentlySelectedCompany] = useState(null);
    const [recentlySelectedCompanyName, setRecentlySelectedCompanyName] = useState(null);
    const [stripeConnectedAccountId, setStripeConnectedAccountId] = useState(null);
    const [stripeId, setStripeId] = useState(null);

    // Role Information
    const [role, setRole] = useState(null);
    const [companyUserAccess, setCompanyUserAccess] = useState(null);
    const [companyRole, setCompanyRole] = useState(null);
    const [companyRoleLoading, setCompanyRoleLoading] = useState(false);
    const [companyRoleLoaded, setCompanyRoleLoaded] = useState(false);

    // Subscription Information
    const [companySubscription, setCompanySubscription] = useState(null);

    // Invite Information
    const [pendingInvite, setPendingInvite] = useState(null);

    // Feature Flags
    const [featureFlags, setFeatureFlags] = useState({});
    const [featureFlagsLoaded, setFeatureFlagsLoaded] = useState(false);

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
                    console.log("currentUser.uid ", currentUser.uid)
                    if (docSnap.exists()) {
                        const dbUser = docSnap.data();
                        setDataBaseUser(dbUser);
                        setAccountType(dbUser.accountType);
                        setRole(dbUser.accountType);
                        setName(`${dbUser.firstName} ${dbUser.lastName}`);
                        setPhotoUrl(dbUser.photoUrl);
                        setStripeId(getStripeCustomerId(dbUser));

                        if (dbUser.accountType === 'Company') {
                            setRecentlySelectedCompany(dbUser.recentlySelectedCompany);

                            if (dbUser.recentlySelectedCompany) {
                                const companyDocRef = doc(db, "companies", dbUser.recentlySelectedCompany);
                                const companyDoc = await getDoc(companyDocRef);
                                if (companyDoc.exists()) {
                                    const companyData = companyDoc.data();
                                    setRecentlySelectedCompanyName(getCompanyDisplayName(companyData));
                                    setStripeConnectedAccountId(getStripeConnectedAccountId(companyData));
                                    setStripeId(getStripeCustomerId(dbUser) || getStripeCustomerId(companyData));
                                }
                            }
                        } else {
                            setRecentlySelectedCompany(null);
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
                setStripeId(null);
                setCompanyUserAccess(null);
                setCompanyRole(null);
                setCompanyRoleLoading(false);
                setCompanyRoleLoaded(false);
                setCompanySubscription(null);
                setPendingInvite(null);
                setFeatureFlags({});
                setFeatureFlagsLoaded(false);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [auth]);

    useEffect(() => {
        if (!user) {
            setFeatureFlags({});
            setFeatureFlagsLoaded(false);
            return undefined;
        }

        setFeatureFlagsLoaded(false);

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

                setFeatureFlags(nextFeatureFlags);
                setFeatureFlagsLoaded(true);
            },
            (error) => {
                console.error("Error loading feature flags:", error);
                setFeatureFlags({});
                setFeatureFlagsLoaded(true);
            }
        );

        return unsubscribe;
    }, [user]);

    useEffect(() => {
        let cancelled = false;

        const resetCompanyContext = () => {
            setRecentlySelectedCompanyName(null);
            setStripeConnectedAccountId(null);
            setCompanyUserAccess(null);
            setCompanyRole(null);
            setCompanyRoleLoading(false);
            setCompanyRoleLoaded(false);
        };

        const clearSelectedCompanyAccess = () => {
            setRecentlySelectedCompany(null);
            setRecentlySelectedCompanyName(null);
            setStripeConnectedAccountId(null);
            setCompanyUserAccess(null);
            setCompanyRole(null);
        };

        const loadSelectedCompanyContext = async () => {
            if (!user || accountType !== "Company" || !recentlySelectedCompany) {
                resetCompanyContext();
                return;
            }

            setCompanyRoleLoading(true);
            setCompanyRoleLoaded(false);

            try {
                const companyDocRef = doc(db, "companies", recentlySelectedCompany);
                const userAccessDocRef = doc(db, "users", user.uid, "userAccess", recentlySelectedCompany);

                const [companyDoc, userAccessDoc] = await Promise.all([
                    getDoc(companyDocRef),
                    getDoc(userAccessDocRef),
                ]);

                if (cancelled) return;

                if (companyDoc.exists()) {
                    const companyData = companyDoc.data();
                    setRecentlySelectedCompanyName(getCompanyDisplayName(companyData));
                    setStripeConnectedAccountId(getStripeConnectedAccountId(companyData));
                    setStripeId(getStripeCustomerId(dataBaseUser) || getStripeCustomerId(companyData));
                } else {
                    setRecentlySelectedCompanyName(null);
                    setStripeConnectedAccountId(null);
                }

                if (!userAccessDoc.exists()) {
                    clearSelectedCompanyAccess();
                    return;
                }

                const access = { id: userAccessDoc.id, ...userAccessDoc.data() };
                if (isCompanyAccessInactive(access)) {
                    clearSelectedCompanyAccess();
                    return;
                }

                setCompanyUserAccess(access);

                if (!access.roleId) {
                    setCompanyRole(null);
                    return;
                }

                const roleDoc = await getDoc(doc(db, "companies", recentlySelectedCompany, "roles", access.roleId));
                if (cancelled) return;

                setCompanyRole(roleDoc.exists() ? { id: roleDoc.id, ...roleDoc.data() } : null);
            } catch (error) {
                if (!cancelled) {
                    console.error("Error loading selected company role context:", error);
                    setCompanyUserAccess(null);
                    setCompanyRole(null);
                }
            } finally {
                if (!cancelled) {
                    setCompanyRoleLoading(false);
                    setCompanyRoleLoaded(true);
                }
            }
        };

        loadSelectedCompanyContext();

        return () => {
            cancelled = true;
        };
    }, [user, accountType, recentlySelectedCompany, dataBaseUser]);

    const hasCompanyPermission = useCallback((permissionId) => {
        return roleHasCompanyPermission(companyRole, permissionId);
    }, [companyRole]);

    const isFeatureEnabled = useCallback((featureFlagId) => {
        return Boolean(featureFlags[featureFlagId]?.enabled);
    }, [featureFlags]);

    const values = {
        user,
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
        stripeId,
        setStripeId,
        recentlySelectedCompanyName,
        setRecentlySelectedCompanyName,
        role,
        setRole,
        companyUserAccess,
        setCompanyUserAccess,
        companyRole,
        setCompanyRole,
        companyRoleLoading,
        companyRoleLoaded,
        hasCompanyPermission,
        featureFlags,
        featureFlagsLoaded,
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
