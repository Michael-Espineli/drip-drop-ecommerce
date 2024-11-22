import { createContext, useState,useEffect } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useFormAction } from "react-router-dom";
import { db } from "../utils/config";
import { getDoc, doc } from "firebase/firestore";

export const Context = createContext();
export function AuthContext({children}) {
    const auth = getAuth()
    const [user,setUser] = useState();
    const [loading,setLoading] = useState(true);
    const [accountType,setAccountType] = useState();
    const [name,setName] = useState();
    const [photoUrl,setPhotoUrl] = useState();
    const [recentlySelectedCompany,setRecentlySelectedCompany] = useState();
    const [recentlySelectedCompanyName,setRecentlySelectedCompanyName] = useState();

    const [stripeConnectedAccountId,setStripeConnectedAccountId] = useState();

    useEffect(() => {
        (async () => {

            let unsubscribe;
            unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
                setLoading(false)
                if (currentUser) {
                    setUser(currentUser)
                    console.log('Has Current User')
                    console.log(currentUser.uid)
                    try {

                        const docRef = doc(db, "users", currentUser.uid);

                        const docSnap = await getDoc(docRef);

                        if (docSnap){
                            
                            const dbUser = docSnap.data()

                            setAccountType(dbUser.accountType)

                            const firstName = dbUser.firstName

                            const lastName = dbUser.lastName

                            setName(firstName + ' ' + lastName)

                            setPhotoUrl(dbUser.photoUrl)

                            setRecentlySelectedCompany(dbUser.recentlySelectedCompany)
                            
                            setStripeConnectedAccountId(dbUser.stripeConnectedAccountId)
                            //Get Company Info
                            try{
                                const docRef = doc(db, "companies",dbUser.recentlySelectedCompany);
                                const companyDoc = await getDoc(docRef);
                                if (companyDoc.exists()) {
                                    setRecentlySelectedCompanyName(companyDoc.data().name)
                                  } else {
                                    console.log("No such document!");
                                  }
                            } catch(error){
                                console.log('Error')
                            }
                        }
                    } catch(error) {

                        console.log('Error')

                    }
                } else {

                    setUser(null)

                    setAccountType(null)
                    
                    setName(null)

                }
            });
            return () => {
                if (unsubscribe) {

                    unsubscribe();

                }
            }
        })();

    },[])
    const values = {
        user : user,
        setUser : setUser,
        accountType : accountType,
        name : name,
        photoUrl : photoUrl,
        recentlySelectedCompany:recentlySelectedCompany,
        setRecentlySelectedCompany:setRecentlySelectedCompany,
        stripeConnectedAccountId:stripeConnectedAccountId,
        setStripeConnectedAccountId:setStripeConnectedAccountId,
        recentlySelectedCompanyName:recentlySelectedCompanyName,
        setRecentlySelectedCompanyName:setRecentlySelectedCompanyName
    }
    
    return <Context.Provider value={values}>
        {
            !loading && 
            children
        }
    </Context.Provider>
}