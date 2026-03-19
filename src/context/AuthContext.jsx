import { createContext, useState, useEffect } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from "../utils/config";
import { getDoc, doc, getDocs, where, query, collection } from "firebase/firestore"; 

export const Context = createContext();

export function AuthContext({children}) {
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

    // Subscription Information
    const [companySubscription, setCompanySubscription] = useState(null);
    
    // Invite Information
    const [pendingInvite, setPendingInvite] = useState(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);

                // Check for pending invites first
                try {
                    const invitesRef = collection(db, "invites");
                    const q = query(
                        invitesRef,
                        where("email", "==", currentUser.email),
                        where("status", "==", "Pending")
                    );
                    const inviteSnapshot = await getDocs(q);
                    if (!inviteSnapshot.empty) {
                        const invite = { id: inviteSnapshot.docs[0].id, ...inviteSnapshot.docs[0].data() };
                        setPendingInvite(invite);
                    }
                } catch (error) {
                    console.error("Error checking for pending invites:", error);
                }

                // Then, fetch user data
                try {
                    const docRef = doc(db, "users", currentUser.uid);
                    const docSnap = await getDoc(docRef);
                    console.log("currentUser.uid ",currentUser.uid)
                    if (docSnap.exists()){
                        const dbUser = docSnap.data();
                        setDataBaseUser(dbUser);
                        setAccountType(dbUser.accountType);
                        setRole(dbUser.accountType);
                        setName(`${dbUser.firstName} ${dbUser.lastName}`);
                        setPhotoUrl(dbUser.photoUrl);

                        if (dbUser.accountType === 'Company') {
                            setRecentlySelectedCompany(dbUser.recentlySelectedCompany);

                            if (dbUser.recentlySelectedCompany) {
                                const companyDocRef = doc(db, "companies", dbUser.recentlySelectedCompany);
                                const companyDoc = await getDoc(companyDocRef);
                                if (companyDoc.exists()) {
                                    setRecentlySelectedCompanyName(companyDoc.data().name);
                                    setStripeConnectedAccountId(companyDoc.data().stripeConnectedAccountId);
                                    setStripeId(companyDoc.data().setStripeConnectedAccountId)
                                }
                            }
                        }
                    } else {
                        console.log("No DB User Found on Auth Context");
                    }
                } catch(error) {
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
                setPendingInvite(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [auth]);

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