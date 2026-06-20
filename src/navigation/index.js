import { allNav } from './allNav';

export const DEFAULT_COMPANY_CATEGORY_ORDER = [
    'Operations',
    'Management',
    'Finance',
    'Marketing',
    'Migration',
    'Settings',
];

export const COMPANY_PINNED_CATEGORY = 'NA';

const COMPANY_PINNED_TITLE_ORDER = [
    'Dashboard',
    'Messages',
];

const DEFAULT_ADMIN_CATEGORY_ORDER = [
    'NA',
    'Development',
    'Management',
];

const DEFAULT_CATEGORY_ORDER = [
    'NA',
    'Operations',
    'Routing',
    'Finance',
    'Marketing',
    'Physical Locations',
    'Users',
    'Stripe',
    'Reports',
    'Auditing',
    'Settings',
];

const normalizeCategoryOrder = (categoryOrderOverride, fallbackOrder = DEFAULT_CATEGORY_ORDER) => {
    const fallbackCategories = new Set(fallbackOrder);
    const overrideOrder = Array.isArray(categoryOrderOverride)
        ? categoryOrderOverride.filter((category) => fallbackCategories.has(category))
        : [];
    const sourceOrder = overrideOrder.length > 0
        ? [
            ...overrideOrder,
            ...fallbackOrder.filter((category) => !overrideOrder.includes(category)),
        ]
        : fallbackOrder;
    const seen = new Set();

    return sourceOrder.filter((category) => {
        if (!category || seen.has(category)) return false;
        seen.add(category);
        return true;
    });
};

const sortCompanyPinnedItems = (items = []) => {
    return [...items].sort((a, b) => {
        const aIndex = COMPANY_PINNED_TITLE_ORDER.indexOf(a.title);
        const bIndex = COMPANY_PINNED_TITLE_ORDER.indexOf(b.title);

        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });
};

export const getNav = (accountType, categoryOrderOverride = null) => {
    // Return an empty object if there's no account type or if allNav is not an array
    if (!accountType || !Array.isArray(allNav)) {
        return {};
    }

    // Filter the navigation items that match the user's account type
    const filteredNavs = allNav.filter(nav => nav.role === accountType);

    const fallbackOrder =
        accountType === 'Company'
            ? DEFAULT_COMPANY_CATEGORY_ORDER
            : accountType === 'Admin'
                ? DEFAULT_ADMIN_CATEGORY_ORDER
                : DEFAULT_CATEGORY_ORDER;
    const categoryOrder = normalizeCategoryOrder(categoryOrderOverride, fallbackOrder);

    // Group the filtered items by their 'category' property
    const grouped = filteredNavs.reduce((acc, item) => {
        const category = item.category || 'NA';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(item);
        return acc;
    }, {});

    // Create a new object to store the sorted categories
    const sortedGrouped = {};

    if (accountType === 'Company' && grouped[COMPANY_PINNED_CATEGORY]) {
        sortedGrouped[COMPANY_PINNED_CATEGORY] = sortCompanyPinnedItems(grouped[COMPANY_PINNED_CATEGORY]);
    }

    // Iterate over the defined category order and add the groups in that order
    categoryOrder.forEach(category => {
        if (accountType === 'Company' && category === COMPANY_PINNED_CATEGORY) return;

        if (grouped[category]) {
            sortedGrouped[category] = grouped[category];
        }
    });

    // Add any remaining categories that were not in the defined order
    Object.keys(grouped).forEach(category => {
        if (!sortedGrouped[category]) {
            sortedGrouped[category] = grouped[category];
        }
    });

    return sortedGrouped;
};
