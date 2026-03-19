import { Navigate, useLocation } from "react-router-dom";
import React, { useContext } from "react";
import { Context } from "../context/AuthContext";

export function Protected({route,children}){

    const {user, accountType, recentlySelectedCompany, companySubscription} = useContext(Context);
    const location = useLocation();

    if (!user) {
        console.log('no user')
        // return <Navigate to='/signIn' replace />
        return <Navigate to={`/signin?redirect=${location.pathname}`} />;

    } else {
        if (accountType == 'Admin') {
            if (route.role == 'Admin') {
                return children
            } else {
                return <Navigate to='/' replace />
            }
        } else if (accountType == 'Company') {
            if (companySubscription === null) {
                return children;
            } else {
                if (route.path == "/signIn") {
                    return <Navigate to='/company/dashboard' replace />
                }
                if (route.role == 'Company') {
                    return children
                } else {
                    return <Navigate to='/company/dashboard' replace />
                }
            }

        } else if (accountType == 'Client') {
            if (route.path == "/homeOwnerSignIn") {
                return <Navigate to='/client/dashboard' />
            }
            if (route.role == 'Client') {
                return children
            } else {
                console.log('No Access')
                return <Navigate to='/client/dashboard' replace />
            }
        }
    }
}