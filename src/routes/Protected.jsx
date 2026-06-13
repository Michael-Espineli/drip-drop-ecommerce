import { Navigate, useLocation } from "react-router-dom";
import React, { useContext } from "react";
import { getAuth } from "firebase/auth";
import { Context } from "../context/AuthContext";
import { getCompanyPermissionForPath } from "../utils/companyPermissionAccess";
import { CONFIRM_USER_EMAIL_ON_INVITE_FEATURE_FLAG_ID } from "../utils/models/FeatureFlag";

const emailVerificationAllowedCompanyPaths = [
    /^\/company\/selector/i,
    /^\/company\/selection/i,
    /^\/company\/create-info/i,
];

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
        if (requiredFeatureFlagIds.length > 0) {
            if (!featureFlagsLoaded) {
                return null;
            }

            if (!requiredFeatureFlagIds.every((featureFlagId) => isFeatureEnabled(featureFlagId))) {
                const fallbackPath = routeRole === 'client' ? '/client/dashboard' : routeRole === 'company' ? '/company/dashboard' : '/';
                return <Navigate to={fallbackPath} replace />
            }
        }

        if (accountType === 'Admin') {
            if (routeRole === 'admin') {
                return children
            } else {
                return <Navigate to='/' replace />
            }
        } else if (accountType === 'Company') {
            if (routeRole === 'company') {
                if (!featureFlagsLoaded) {
                    return null;
                }

                const confirmEmailOnInviteEnabled = isFeatureEnabled(CONFIRM_USER_EMAIL_ON_INVITE_FEATURE_FLAG_ID);
                const currentAuthUser = getAuth().currentUser || user;
                const emailVerified = currentAuthUser?.emailVerified === true || user?.emailVerified === true;
                const emailVerificationPathAllowed = emailVerificationAllowedCompanyPaths.some((pattern) => pattern.test(location.pathname));

                if (confirmEmailOnInviteEnabled && !emailVerified && !emailVerificationPathAllowed) {
                    return <Navigate to='/company/selector?verifyEmail=1' replace />
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
