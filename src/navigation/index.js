import { allNav } from './allNav';

export const getNav = (accountType) => {
    // Return an empty object if there's no account type or if allNav is not an array
    if (!accountType || !Array.isArray(allNav)) {
        return {};
    }
    
    // Filter the navigation items that match the user's account type
    const filteredNavs = allNav.filter(nav => nav.role === accountType);

    // Define the desired order of categories
    const categoryOrder = [
        'NA', // For items without a category
        'Marketing',
        'Operations',
        'Physical Locations',
        'Routing',
        'Users',
        'Stripe',
        'Reports',
        'Settings'
    ];

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
