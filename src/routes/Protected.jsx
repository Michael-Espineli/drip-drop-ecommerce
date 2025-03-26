import { Navigate } from "react-router-dom";
import React, { useContext } from "react";
import { Context } from "../context/AuthContext";



export function Protected({route,children}){

    const {user, accountType} = useContext(Context);

    if (!user) {

        return <Navigate to='/' replace />

    } else {

        if (accountType == 'Admin') {

            if (route.role == 'Admin') {

                return children

            } else {

                return <Navigate to='/admin/dashboard' replace />

            }

        } else if (accountType == 'Company') {
            if (route.role == 'Company') {

                return children

            } else {

                return <Navigate to='/company/dashboard' replace />

            }
        } else if (accountType == 'Client') {
            if (route.role == 'Client') {

                return children

            } else {
                console.log('No Access')
                return <Navigate to='/dashboard' replace />

            }
        }
        }
}