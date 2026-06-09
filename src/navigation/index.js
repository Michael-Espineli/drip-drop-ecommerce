import { allNav } from './allNav';

export const DEFAULT_COMPANY_CATEGORY_ORDER = [
    'NA',
    'Operations',
    'Routing',
    'Finance',
    'Marketing',
    'Users',
    'Migration',
    'Settings',
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
    const sourceOrder = Array.isArray(categoryOrderOverride) && categoryOrderOverride.length > 0
        ? [
            ...categoryOrderOverride,
            ...fallbackOrder.filter((category) => !categoryOrderOverride.includes(category)),
        ]
        : fallbackOrder;
    const seen = new Set();

    return sourceOrder.filter((category) => {
        if (!category || seen.has(category)) return false;
        seen.add(category);
        return true;
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

    // Iterate over the defined category order and add the groups in that order
    categoryOrder.forEach(category => {
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
