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

    const { user, accountType, dataBaseUser, recentlySelectedCompany, companySubscription, companyRoleLoading, companyRoleLoaded, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
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
        if (!accountType) {
            return (
                <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 text-center">
                    <h1 className="text-2xl font-bold text-slate-900">Account profile unavailable</h1>
                    <p className="mt-3 text-sm text-slate-600">
                        We could not load a web role for this account. Please contact support and include this user id:
                    </p>
                    <p className="mt-3 break-all rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                        {dataBaseUser?.id || user.uid}
                    </p>
                </div>
            );
        }

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
                    const requiredPermissionIds = [
                        ...(Array.isArray(route.permissionIds) ? route.permissionIds : []),
                        ...(route.permissionId ? [route.permissionId] : []),
                    ];
                    if (requiredPermissionIds.length === 0) {
                        const mappedPermissionId = getCompanyPermissionForPath(route.path);
                        if (mappedPermissionId) requiredPermissionIds.push(mappedPermissionId);
                    }

                    if (requiredPermissionIds.length > 0 && !recentlySelectedCompany) {
                        return <Navigate to='/company/selection' replace />
                    }

                    if (requiredPermissionIds.length > 0 && (companyRoleLoading || !companyRoleLoaded)) {
                        return null;
                    }

                    if (requiredPermissionIds.length > 0 && !requiredPermissionIds.some((permissionId) => hasCompanyPermission(permissionId))) {
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

        return <Navigate to='/' replace />
    }
}
