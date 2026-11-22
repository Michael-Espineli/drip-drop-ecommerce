import { getNav } from './index';
import {
    getCompanyNavigationCandidates,
    normalizeAllTheRestPaths,
    normalizeBookmarkPaths,
    normalizeNavigationOrder,
    splitSidebarNavigation,
} from './companyNavigationPreferences';

test('normalizes old and malformed preferences while permitting every sidebar link to move', () => {
    expect(normalizeAllTheRestPaths(null)).toEqual([]);
    expect(normalizeAllTheRestPaths(['/company/dashboard', '/company/messages', '/company/dashboard', null, '/company/setup-guide', '/admin/users', '/bad'])).toEqual(['/company/dashboard', '/company/messages']);
    expect(normalizeBookmarkPaths(['/company/dashboard', '/company/customers', '/company/customers', null])).toEqual(['/company/customers']);
    expect(normalizeNavigationOrder(['Finance', 'Finance', 'NA', null])).toEqual(['Finance', 'Operations', 'Management', 'Marketing', 'Migration']);
});

test('splits only existing visible links, preserves configured order, and never duplicates a path', () => {
    const nav = getNav('Company', ['Finance', 'Operations']);
    const { main, allTheRest } = splitSidebarNavigation(nav, ['/company/dashboard', '/company/customers', '/company/customers', '/company/sales/invoices']);
    expect(Object.keys(main).slice(0, 3)).toEqual(['NA', 'Finance', 'Operations']);
    expect(allTheRest.map((item) => item.path)).toEqual(['/company/dashboard', '/company/sales/invoices', '/company/customers']);
    expect(Object.values(main).flat().some((item) => item.path === '/company/customers')).toBe(false);
});

test('does not recreate a saved link when permissions or feature flags remove it', () => {
    const candidates = getCompanyNavigationCandidates({ companyRoleLoading: false, hasCompanyPermission: () => false, featureFlagsLoaded: true, isFeatureEnabled: () => false });
    const permitted = { NA: candidates.filter((item) => item.category === 'NA') };
    const { allTheRest } = splitSidebarNavigation(permitted, ['/company/customers', '/company/messages', '/company/dashboard']);
    expect(allTheRest.map((item) => item.path)).toEqual(['/company/dashboard']);
});

test('removes an empty category and restores the original grouping when preferences are cleared', () => {
    const item = { path: '/company/customers', title: 'Customers' };
    expect(splitSidebarNavigation({ Operations: [item] }, [item.path])).toEqual({ main: {}, allTheRest: [item] });
    expect(splitSidebarNavigation({ Operations: [item] }, [])).toEqual({ main: { Operations: [item] }, allTheRest: [] });
});

test('keeps the sales workflow together directly above the catalogs and payroll', () => {
    const financeTitles = getNav('Company').Finance.map((item) => item.title);
    expect(financeTitles.slice(-8)).toEqual([
        'Estimates', 'Service Agreements', 'Billing Subscriptions', 'Invoices', 'Payment History',
        'Product Catalog', 'Service Catalog', 'Payroll',
    ]);
});
