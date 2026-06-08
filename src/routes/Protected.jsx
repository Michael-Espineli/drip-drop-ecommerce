import { Navigate, useLocation } from "react-router-dom";
import React, { useContext } from "react";
import { Context } from "../context/AuthContext";
import { getCompanyPermissionForPath } from "../utils/companyPermissionAccess";

export function Protected({ route, children }) {

    const { user, accountType, recentlySelectedCompany, companySubscription, companyRoleLoading, companyRoleLoaded, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
    const location = useLocation();
    const routeRole = String(route.role || "").toLowerCase();
    const requiredFeatureFlagIds = [
        route.featureFlagId,
        ...(Array.isArray(route.featureFlagIds) ? route.featureFlagIds : []),
    ].filter(Boolean);

    if (!user) {
        console.log('no user')
        const redirectTarget = encodeURIComponent(`${location.pathname}${location.search || ""}`);
        const signInPath = routeRole === "client" ? "/homeownerSignIn" : "/signIn";
        return <Navigate to={`${signInPath}?redirect=${redirectTarget}`} />;

    } else {
        if (accountType === 'Admin') {
            if (routeRole === 'admin') {
                return children
            } else {
                return <Navigate to='/' replace />
            }
        } else if (accountType === 'Company') {
            if (routeRole === 'company' && requiredFeatureFlagIds.length > 0) {
                if (!featureFlagsLoaded) {
                    return null;
                }

                if (!requiredFeatureFlagIds.every((featureFlagId) => isFeatureEnabled(featureFlagId))) {
                    return <Navigate to='/company/dashboard' replace />
                }
            }

            if (companySubscription === null) {
                return children;
            } else {
                if (route.path === "/signIn") {
                    return <Navigate to='/company/dashboard' replace />
                }
                if (routeRole === 'company') {
                    const requiredPermissionId = route.permissionId || getCompanyPermissionForPath(route.path);

                    if (requiredPermissionId && !recentlySelectedCompany) {
                        return <Navigate to='/company/selection' replace />
                    }

                    if (requiredPermissionId && (companyRoleLoading || !companyRoleLoaded)) {
                        return null;
                    }

                    if (requiredPermissionId && !hasCompanyPermission(requiredPermissionId)) {
                        return <Navigate to='/company/dashboard' replace />
                    }

                    return children
                } else {
                    return <Navigate to='/company/dashboard' replace />
                }
            }

        } else if (accountType === 'Client') {
            if (route.path === "/homeownerSignIn") {
                return <Navigate to='/client/dashboard' />
            }
            if (routeRole === 'client') {
                return children
            } else {
                console.log('No Access')
                return <Navigate to='/client/dashboard' replace />
            }
        }
    }
}
