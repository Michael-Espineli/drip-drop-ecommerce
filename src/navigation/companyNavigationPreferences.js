import { COMPANY_PINNED_CATEGORY, DEFAULT_COMPANY_CATEGORY_ORDER, getNav } from './index';

const companyItems = Object.values(getNav('Company')).flat().filter((item) => item.path !== '/company/setup-guide');
const companyPaths = new Set(companyItems.map((item) => item.path));
const bookmarkPaths = new Set(companyItems.filter((item) => item.category !== COMPANY_PINNED_CATEGORY).map((item) => item.path));

const normalizePaths = (paths, allowedPaths) => [...new Set(
    (Array.isArray(paths) ? paths : []).filter((path) => typeof path === 'string' && allowedPaths.has(path))
)];

export const normalizeNavigationOrder = (savedOrder) => [...new Set([
    ...(Array.isArray(savedOrder) ? savedOrder : []).filter((category) => DEFAULT_COMPANY_CATEGORY_ORDER.includes(category)),
    ...DEFAULT_COMPANY_CATEGORY_ORDER,
])];

export const normalizeBookmarkPaths = (paths) => normalizePaths(paths, bookmarkPaths);
export const normalizeAllTheRestPaths = (paths) => normalizePaths(paths, companyPaths);

export const getCompanyNavigationCandidates = ({ companyRoleLoading, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled }) => (
    companyItems.filter((item) => {
        const permissions = [item.permissionId, ...(item.permissionIds || [])].filter(Boolean);
        const featureFlags = [item.featureFlagId, ...(item.featureFlagIds || [])].filter(Boolean);
        return (permissions.length === 0 || companyRoleLoading || permissions.some((id) => hasCompanyPermission(id))) &&
            (featureFlags.length === 0 || (featureFlagsLoaded && featureFlags.every((id) => isFeatureEnabled(id))));
    })
);

// Work only with already permission/feature-filtered items. Preferences never grant access.
export const splitSidebarNavigation = (navItemsByCategory, savedRestPaths) => {
    const restPaths = new Set(normalizeAllTheRestPaths(savedRestPaths));
    const main = {};
    const restByPath = new Map();

    Object.entries(navItemsByCategory).forEach(([category, items]) => {
        const visible = items.filter((item) => {
            if (!restPaths.has(item.path)) return true;
            restByPath.set(item.path, item);
            return false;
        });
        if (visible.length) main[category] = visible;
    });

    return { main, allTheRest: [...restByPath.values()] };
};
