import React, { useEffect, useState, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import { COMPANY_PINNED_CATEGORY, getNav } from '../navigation/index';
import { ArrowLeftOnRectangleIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, Cog6ToothIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { getAuth, signOut } from "firebase/auth";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from '../utils/config';
import { COMPANY_WIDE_MESSAGES_PERMISSION_ID, TODO_ALL_BOARDS_PERMISSION_ID } from '../utils/companyPermissions';
import { REPAIR_REQUEST_STATUS } from '../utils/models/RepairRequest';
import { isChatUnreadFor, listenVisibleChats } from '../utils/chatMessaging';
import { getFilteredDocsCount, getServerCount, listenForForegroundRefresh, sumServerCounts } from '../utils/firestoreCounts';
import {
    buildCustomerActiveById,
    equipmentNeedsMaintenanceForActiveBoard,
} from '../utils/equipmentMaintenance';
import {
    SHOPPING_LIST_STATUS,
    canonicalShoppingListStatus,
    normalizeShoppingListStatus,
} from '../utils/shoppingListStatus';
import {
    TODO_LIST_FEATURE_FLAG_ID,
    normalizeTodo,
    todoIsOpen,
    todoVisibleToUser,
    todoUserIdSet,
} from '../utils/models/TodoItem';
import {
    ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID,
    alertBelongsToCompany,
    alertNeedsAttention,
    attachAlertNotificationSource,
    mergeAlertNotifications,
} from '../utils/models/AlertNotification';
import {
    JOB_BILLING_STATUS,
    JOB_OPERATION_STATUS,
    isActionableOperationsJob,
    isFinishedOutstandingJob,
} from '../utils/jobStatusFilters';

const normalizeBookmarkPaths = (savedBookmarks) => (
    Array.isArray(savedBookmarks)
        ? [...new Set(savedBookmarks.filter((path) => typeof path === 'string' && path.trim()))]
        : []
);

const getBookmarkedNavItems = (navItemsByCategory, savedBookmarks) => {
    const visibleItemsByPath = new Map();

    Object.entries(navItemsByCategory).forEach(([category, items]) => {
        if (category === COMPANY_PINNED_CATEGORY) return;

        items.forEach((item) => {
            if (!visibleItemsByPath.has(item.path)) {
                visibleItemsByPath.set(item.path, item);
            }
        });
    });

    return normalizeBookmarkPaths(savedBookmarks)
        .map((path) => visibleItemsByPath.get(path))
        .filter(Boolean);
};

const isFirestorePermissionDenied = (error) => (
    error?.code === "permission-denied" ||
    String(error?.message || "").toLowerCase().includes("insufficient permissions")
);

const openWorkOfferStatusValues = [
    "Draft",
    "Sent",
    "Posted",
    "Viewed",
    "Pending",
    "Open",
    "Offered",
    "draft",
    "sent",
    "posted",
    "viewed",
    "pending",
    "open",
    "offered",
];

const purchaseReadyShoppingStatusValues = [
    SHOPPING_LIST_STATUS.needToPurchase,
    "Need To Purchase",
    "needToPurchase",
    "Need Purchase",
    "needPurchase",
    "Ready to Purchase",
    "readyToPurchase",
    "readytopurchase",
    "approved",
    "Approved",
];

const approvalReadyStatusValues = new Set([
    "approved",
    "approvedawaitingpurchase",
]);

const rejectedShoppingStatusValues = new Set([
    "customerrejected",
    "rejected",
    "denied",
]);

const waitingApprovalShoppingStatusValues = new Set([
    "needsapproval",
    "needscustomerapproval",
    "customerapproval",
    "pendingapproval",
    "pendingcustomerapproval",
    "awaitingcustomerapproval",
]);

const shoppingItemComesFromPartApproval = (item = {}) => {
    const sourceType = normalizeShoppingListStatus(item.sourceType || item.sourceRecordType || item.sourceRecordTypeLabel);

    return Boolean(
        item.partApprovalRequestId ||
        item.approvalRequestId ||
        item.customerApprovalRequestId ||
        sourceType === "partapproval" ||
        sourceType === "partapprovalrequest" ||
        sourceType === "customerpartapproval" ||
        sourceType === "customerpartapprovalrequest"
    );
};

const shoppingItemApprovalIsReady = (item = {}) => {
    const approvalRequired = Boolean(item.customerApprovalRequired || shoppingItemComesFromPartApproval(item));
    if (!approvalRequired) return true;

    return [
        item.status,
        item.customerApprovalStatus,
        item.customerApprovalResponse,
        item.approvalStatus,
        item.response,
        item.fulfillmentStatus,
    ].some((value) => approvalReadyStatusValues.has(normalizeShoppingListStatus(value)));
};

const shoppingItemIsReadyToPurchase = (item = {}) => {
    const status = normalizeShoppingListStatus(item.status || SHOPPING_LIST_STATUS.needToPurchase);
    if (rejectedShoppingStatusValues.has(status)) return false;
    if (waitingApprovalShoppingStatusValues.has(status) && !shoppingItemApprovalIsReady(item)) return false;

    return (
        canonicalShoppingListStatus(item.status || SHOPPING_LIST_STATUS.needToPurchase) === SHOPPING_LIST_STATUS.needToPurchase &&
        shoppingItemApprovalIsReady(item)
    );
};

const Sidebar = ({ showSidebar, setShowSidebar, isCollapsed, setIsCollapsed }) => {
    const auth = getAuth();
    const { role, recentlySelectedCompany, user, dataBaseUser, handleLogout, companyUserAccess, companyRoleLoading, companyRoleLoaded, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
    const { pathname } = useLocation();
    const [navItemsByCategory, setNavItemsByCategory] = useState({});
    const [counts, setCounts] = useState({ leads: 0, messages: 0, notifications: 0, shopping: 0, legacyShopping: 0, repairRequests: 0, todoItems: 0, finishedJobs: 0, actionableJobs: 0, offeredWork: 0, equipmentMaintenance: 0 });
    const categoryLabel = (category) => category;
    const categoryInitial = (category) => categoryLabel(category).charAt(0).toUpperCase();
    const bookmarkItems = getBookmarkedNavItems(navItemsByCategory, dataBaseUser?.settings?.companyNavigationBookmarks);
    const navigationSections = [
        ...(navItemsByCategory[COMPANY_PINNED_CATEGORY]?.length
            ? [{
                key: COMPANY_PINNED_CATEGORY,
                category: COMPANY_PINNED_CATEGORY,
                label: 'Dashboard Items',
                items: navItemsByCategory[COMPANY_PINNED_CATEGORY],
            }]
            : []),
        ...(bookmarkItems.length
            ? [{
                key: 'book-marks',
                category: 'Book Marks',
                label: 'Book Marks',
                items: bookmarkItems,
            }]
            : []),
        ...Object.entries(navItemsByCategory)
            .filter(([category]) => category !== COMPANY_PINNED_CATEGORY)
            .map(([category, items]) => ({
                key: category,
                category,
                label: categoryLabel(category),
                items,
            })),
    ];

    useEffect(() => {
        if (role) {
            const featureFlagsEnabledForItem = (item) => {
                const featureFlagIds = [
                    item.featureFlagId,
                    ...(Array.isArray(item.featureFlagIds) ? item.featureFlagIds : []),
                ].filter(Boolean);

                return featureFlagIds.length === 0 || (featureFlagsLoaded && featureFlagIds.every((featureFlagId) => isFeatureEnabled(featureFlagId)));
            };

            const savedCategoryOrder = dataBaseUser?.settings?.companyNavigationCategoryOrder;
            const navs = getNav(role, savedCategoryOrder);
            const filteredNavs = Object.entries(navs).reduce((acc, [category, items]) => {
                const visibleItems = items.filter((item) => {
                    if (item.path === "/company/setup-guide") return false;

                    return (
                        item.role !== "Company" ||
                        (
                            (!item.permissionId || companyRoleLoading || hasCompanyPermission(item.permissionId)) &&
                            featureFlagsEnabledForItem(item)
                        )
                    );
                });

                if (visibleItems.length > 0) {
                    acc[category] = visibleItems;
                }

                return acc;
            }, {});

            setNavItemsByCategory(filteredNavs);
        }
    }, [role, dataBaseUser, companyRoleLoading, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled]);

    useEffect(() => {
        if (!recentlySelectedCompany || !user) {
            setCounts({ leads: 0, messages: 0, notifications: 0, shopping: 0, legacyShopping: 0, repairRequests: 0, repairRequestSources: {}, todoItems: 0, finishedJobs: 0, actionableJobs: 0, offeredWork: 0, equipmentMaintenance: 0 });
            return;
        }

        let cancelled = false;

        setCounts(prev => ({ ...prev, repairRequests: 0, repairRequestSources: {}, finishedJobs: 0, actionableJobs: 0, offeredWork: 0, equipmentMaintenance: 0 }));

        const leadsQuery = query(
            collection(db, "homeownerServiceRequests"),
            where("companyId", "==", recentlySelectedCompany),
            where("status", "==", "Pending")
        );

        const equipmentRef = collection(db, "companies", recentlySelectedCompany, "equipment");

        const internalRepairRequestsOpenQuery = query(
            collection(db, "companies", recentlySelectedCompany, "repairRequests"),
            where("status", "==", REPAIR_REQUEST_STATUS.UNRESOLVED)
        );

        const externalRepairRequestsOpenQuery = query(
            collection(db, "homeownerRepairRequests"),
            where("companyId", "==", recentlySelectedCompany),
            where("status", "==", REPAIR_REQUEST_STATUS.UNRESOLVED)
        );

        const workOrdersRef = collection(db, "companies", recentlySelectedCompany, "workOrders");
        const workOffersRef = collection(db, "companies", recentlySelectedCompany, "workOffers");

        const finishedJobsQuery = query(
            workOrdersRef,
            where("operationStatus", "==", JOB_OPERATION_STATUS.finished)
        );

        const draftOperationJobsQuery = query(
            workOrdersRef,
            where("operationStatus", "==", JOB_OPERATION_STATUS.draft)
        );

        const draftBillingJobsQuery = query(
            workOrdersRef,
            where("billingStatus", "==", JOB_BILLING_STATUS.draft)
        );

        const acceptedJobsQuery = query(
            workOrdersRef,
            where("billingStatus", "==", JOB_BILLING_STATUS.accepted)
        );

        const openWorkOfferQueries = [];
        for (let index = 0; index < openWorkOfferStatusValues.length; index += 10) {
            openWorkOfferQueries.push(query(
                workOffersRef,
                where("status", "in", openWorkOfferStatusValues.slice(index, index + 10))
            ));
        }

        const loadCount = async (label, loader) => {
            try {
                return await loader();
            } catch (error) {
                console.error(`Error loading ${label} count:`, error);
                return 0;
            }
        };

        const getEquipmentMaintenanceCount = async () => {
            const [equipmentSnap, customersSnap] = await Promise.all([
                getDocs(equipmentRef),
                getDocs(collection(db, "companies", recentlySelectedCompany, "customers")).catch((error) => {
                    console.warn("Unable to load customers for equipment maintenance count:", error);
                    return { docs: [] };
                }),
            ]);
            const customerActiveById = buildCustomerActiveById(
                customersSnap.docs.map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() }))
            );

            return equipmentSnap.docs
                .map((equipmentDoc) => ({ id: equipmentDoc.id, ...equipmentDoc.data() }))
                .filter((equipment) => equipmentNeedsMaintenanceForActiveBoard(equipment, customerActiveById))
                .length;
        };

        const getActionableJobCount = async () => {
            const snapshots = await Promise.all([
                getDocs(draftOperationJobsQuery),
                getDocs(draftBillingJobsQuery),
                getDocs(acceptedJobsQuery),
            ]);
            const actionableJobIds = new Set();

            snapshots.forEach((snapshot) => {
                snapshot.docs
                    .map((jobDoc) => ({ id: jobDoc.id, ...jobDoc.data() }))
                    .filter(isActionableOperationsJob)
                    .forEach((job) => actionableJobIds.add(job.id));
            });

            return actionableJobIds.size;
        };

        const getPurchaseReadyShoppingCount = async (collectionName) => {
            const snapshot = await getDocs(query(
                collection(db, "companies", recentlySelectedCompany, collectionName),
                where("status", "in", purchaseReadyShoppingStatusValues)
            ));

            return snapshot.docs
                .map((shoppingDoc) => ({ id: shoppingDoc.id, ...shoppingDoc.data() }))
                .filter(shoppingItemIsReadyToPurchase)
                .length;
        };

        const loadServerBackedCounts = async () => {
            const [
                leads,
                shopping,
                legacyShopping,
                repairRequests,
                finishedJobs,
                actionableJobs,
                offeredWork,
                equipmentMaintenance,
            ] = await Promise.all([
                loadCount("lead", () => getServerCount(leadsQuery)),
                loadCount("shopping", () => getPurchaseReadyShoppingCount("shoppingList")),
                loadCount("legacy shopping", () => getPurchaseReadyShoppingCount("shoppingListItems")),
                loadCount("repair request", () => sumServerCounts([
                    internalRepairRequestsOpenQuery,
                    externalRepairRequestsOpenQuery,
                ])),
                loadCount("finished job", () => getFilteredDocsCount(
                    finishedJobsQuery,
                    (jobDoc) => isFinishedOutstandingJob({ id: jobDoc.id, ...jobDoc.data() })
                )),
                loadCount("actionable job", getActionableJobCount),
                loadCount("offered work", () => sumServerCounts(openWorkOfferQueries)),
                loadCount("equipment maintenance", getEquipmentMaintenanceCount),
            ]);

            if (cancelled) return;

            setCounts(prev => ({
                ...prev,
                leads,
                shopping,
                legacyShopping,
                repairRequests,
                repairRequestSources: {},
                finishedJobs,
                actionableJobs,
                offeredWork,
                equipmentMaintenance,
            }));
        };

        loadServerBackedCounts();
        const removeForegroundRefresh = listenForForegroundRefresh(loadServerBackedCounts);

        const messagesEnabled = featureFlagsLoaded && isFeatureEnabled("feature_flag_001");
        let unsubscribeMessages = () => {};

        if (messagesEnabled && companyRoleLoaded && companyUserAccess) {
            const includeCompanyWide = hasCompanyPermission(COMPANY_WIDE_MESSAGES_PERMISSION_ID);

            unsubscribeMessages = listenVisibleChats({
                db,
                userId: user.uid,
                companyId: recentlySelectedCompany,
                includeCompanyWide,
                onChange: (visibleChats) => {
                    const unreadCount = visibleChats.filter((chat) => (
                        isChatUnreadFor(chat, user.uid, recentlySelectedCompany)
                    )).length;

                    setCounts(prev => ({ ...prev, messages: unreadCount }));
                },
                onError: (error) => {
                    console.error("Error loading message count:", error);
                    setCounts(prev => ({ ...prev, messages: 0 }));
                },
            });
        } else {
            setCounts(prev => ({ ...prev, messages: 0 }));
        }

        const alertsEnabled = featureFlagsLoaded && isFeatureEnabled(ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID);
        const firebaseAuthUserId = String(user?.uid || "").trim();
        let unsubscribeNotifications = () => {};
        let unsubscribePersonalNotifications = () => {};

        if (alertsEnabled) {
            const notificationSources = { company: [], personal: [] };
            const updateNotificationCount = (scope, nextAlerts) => {
                notificationSources[scope] = nextAlerts;
                const notifications = mergeAlertNotifications([
                    ...notificationSources.personal,
                    ...notificationSources.company,
                ])
                    .filter((alert) => alertBelongsToCompany(alert, recentlySelectedCompany))
                    .filter(alertNeedsAttention)
                    .length;

                setCounts(prev => ({ ...prev, notifications }));
            };

            unsubscribeNotifications = onSnapshot(
                collection(db, "companies", recentlySelectedCompany, "alerts"),
                snapshot => {
                    updateNotificationCount(
                        "company",
                        snapshot.docs.map((alertDoc) => attachAlertNotificationSource(alertDoc, "company"))
                    );
                },
                error => {
                    console.error("Error loading notification count:", error);
                    updateNotificationCount("company", []);
                }
            );

            if (firebaseAuthUserId) {
                unsubscribePersonalNotifications = onSnapshot(
                    collection(db, "users", firebaseAuthUserId, "alerts"),
                    snapshot => {
                        updateNotificationCount(
                            "personal",
                            snapshot.docs
                                .map((alertDoc) => attachAlertNotificationSource(alertDoc, "personal"))
                                .filter((alert) => alertBelongsToCompany(alert, recentlySelectedCompany))
                        );
                    },
                    error => {
                        if (!isFirestorePermissionDenied(error)) {
                            console.error("Error loading personal notification count:", error);
                        }
                        updateNotificationCount("personal", []);
                    }
                );
            } else {
                updateNotificationCount("personal", []);
            }
        } else {
            setCounts(prev => ({ ...prev, notifications: 0 }));
        }

        const todoListEnabled = featureFlagsLoaded && isFeatureEnabled(TODO_LIST_FEATURE_FLAG_ID);
        const canViewAllTodoItems = companyRoleLoaded &&
            !companyRoleLoading &&
            hasCompanyPermission(TODO_ALL_BOARDS_PERMISSION_ID);
        let unsubscribeTodos = () => {};

        if (todoListEnabled) {
            const todoUserIds = todoUserIdSet([
                user.uid,
                dataBaseUser?.id,
                dataBaseUser?.uid,
                dataBaseUser?.userId,
                companyUserAccess?.uid,
                companyUserAccess?.userId,
                companyUserAccess?.companyUserId,
                companyUserAccess?.companyUserDocId,
            ]);

            unsubscribeTodos = onSnapshot(
                collection(db, "companies", recentlySelectedCompany, "todoItems"),
                snapshot => {
                    const openCount = snapshot.docs
                        .map(normalizeTodo)
                        .filter(todoIsOpen)
                        .filter((todo) => canViewAllTodoItems || todoVisibleToUser(todo, todoUserIds))
                        .length;

                    setCounts(prev => ({ ...prev, todoItems: openCount }));
                },
                error => {
                    console.error("Error loading todo count:", error);
                    setCounts(prev => ({ ...prev, todoItems: 0 }));
                }
            );
        } else {
            setCounts(prev => ({ ...prev, todoItems: 0 }));
        }

        return () => {
            cancelled = true;
            removeForegroundRefresh();
            unsubscribeMessages();
            unsubscribeNotifications();
            unsubscribePersonalNotifications();
            unsubscribeTodos();
        };
    }, [recentlySelectedCompany, user, dataBaseUser, companyRoleLoaded, companyRoleLoading, companyUserAccess, featureFlagsLoaded, isFeatureEnabled, hasCompanyPermission]);

    const logout = async () => {
        try {
            await signOut(auth);
            handleLogout(); // Assuming handleLogout clears context/redirects
        } catch (error) {
            console.error("Logout failed:", error.message);
        }
    };

    const getPath = (itemPath) => {
        if (!recentlySelectedCompany && itemPath !== '/company/selection') {
            return '/company/selection';
        }
        return itemPath;
    };

    const settingsFooterPath = '/company/settings';
    const settingsFooterUploadPaths = new Set([
        '/company/migration/customer-export-import',
        '/company/migration/equipment-import',
        '/company/migration/skimmer-previous-dosages-upload',
        '/company/migration/performance-history-import',
    ]);
    const normalizedPathname = pathname.toLowerCase();
    const settingsFooterIsActive = (
        normalizedPathname.startsWith(settingsFooterPath) ||
        settingsFooterUploadPaths.has(normalizedPathname)
    );
    const showSettingsFooterLink = role === 'Company' && (companyRoleLoading || hasCompanyPermission('800'));

    return (
        <div>
            {/* Overlay for mobile view */}
            <div onClick={() => setShowSidebar(false)} className={`fixed duration-200 lg:hidden ${showSidebar ? 'w-screen h-screen bg-black/50 top-0 left-0 z-10' : 'w-0'}`}></div>

            {/* Sidebar */}
            <div className={`app-sidebar-shell app-mobile-sidebar-shell fixed top-0 z-50 h-screen w-full transition-all duration-200 ${isCollapsed ? 'lg:w-[76px]' : 'lg:w-[260px]'} ${showSidebar ? 'left-0' : '-left-full lg:left-0'}`}>
                <div className='flex h-full flex-col overflow-hidden'>
                    {/* Header */}
                    <div className={`app-sidebar-header h-[95px] flex items-center gap-2 border-b px-4 shrink-0 ${isCollapsed ? 'justify-between lg:justify-center lg:px-0' : 'justify-between'}`}>
                        <Link to='/' className={`app-sidebar-brand min-w-0 text-3xl font-bold ${isCollapsed ? 'lg:hidden' : ''}`}>
                            Drip Drop
                        </Link>
                        <button
                            type="button"
                            onClick={() => setShowSidebar(false)}
                            className="app-sidebar-collapse-button flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition lg:hidden"
                            aria-label="Close navigation"
                            title="Close navigation"
                        >
                            <XMarkIcon className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsCollapsed((current) => !current)}
                            className="app-sidebar-collapse-button hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border transition lg:flex"
                            aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
                            title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
                        >
                            {isCollapsed ? (
                                <ChevronDoubleRightIcon className="h-5 w-5" />
                            ) : (
                                <ChevronDoubleLeftIcon className="h-5 w-5" />
                            )}
                        </button>
                    </div>

                    {/* Navigation */}
                    <nav className={`app-sidebar-nav min-h-0 flex-grow overflow-y-auto overscroll-contain px-2 pt-5 ${isCollapsed ? 'lg:px-2' : ''}`}>
                        {navigationSections.map((section, categoryIndex) => (
                            <div
                                key={section.key}
                                className={`mb-3 ${isCollapsed && categoryIndex > 0 ? 'lg:mt-5 lg:pt-2' : ''}`}
                            >
                                {categoryIndex > 0 && (
                                    <div
                                        className={`hidden items-center px-1 pb-3 ${isCollapsed ? 'lg:flex' : ''}`}
                                        role="separator"
                                        aria-label={`${section.label} section`}
                                        title={section.label}
                                    >
                                        <span className="app-sidebar-section-rule h-[2px] flex-1" />
                                        <span className="app-sidebar-section-initial mx-2 shrink-0 text-[11px] font-bold uppercase leading-none">
                                            {categoryInitial(section.label)}
                                        </span>
                                        <span className="app-sidebar-section-rule h-[2px] flex-1" />
                                    </div>
                                )}
                                {section.category !== COMPANY_PINNED_CATEGORY && (
                                    <h3 className={`app-sidebar-section-title px-3 py-2 text-xs font-bold uppercase tracking-wider ${isCollapsed ? 'lg:hidden' : ''}`}>{section.label}</h3>
                                )}
                                <ul className='flex flex-col gap-1'>
                                    {section.items.map(item => {
                                        const isActive = pathname.toLowerCase() === item.path.toLowerCase();
                                        const count =
                                            item.title === 'Leads'
                                                ? counts.leads
                                                : item.title === 'Messages'
                                                    ? counts.messages
                                                    : item.title === 'Notifications'
                                                        ? counts.notifications
                                                    : item.title === 'Todo List'
                                                        ? counts.todoItems
                                                        : item.title === 'Shopping List'
                                                            ? (counts.shopping || 0) + (counts.legacyShopping || 0)
                                                            : item.title === 'Repair Requests'
                                                                ? counts.repairRequests
                                                                : item.title === 'Finished Jobs'
                                                                    ? counts.finishedJobs
                                                                    : item.title === 'Jobs'
                                                                        ? counts.actionableJobs
                                                                        : item.title === 'Offered Work'
                                                                            ? counts.offeredWork
                                                                        : item.title === 'Equipment'
                                                                            ? counts.equipmentMaintenance
                                                                        : 0;

                                        return (
                                            <li key={`${section.key}-${item.path}-${item.title}`}>
                                                <Link
                                                    to={getPath(item.path)}
                                                    title={item.title}
                                                    className={`app-sidebar-link relative flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 font-semibold transition-all ${isCollapsed ? 'lg:justify-center lg:gap-0 lg:px-2' : ''} ${isActive ? 'app-sidebar-link-active' : ''}`}>
                                                    <span className={`app-sidebar-icon flex h-6 w-6 shrink-0 items-center justify-center ${isActive ? 'app-sidebar-icon-active' : ''} [&>svg]:h-5 [&>svg]:w-5`}>{item.icon}</span>
                                                    <span className={isCollapsed ? 'lg:hidden' : ''}>{item.title}</span>
                                                    {count > 0 && (
                                                        <span className={`ml-auto rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-semibold text-white ${isCollapsed ? 'lg:absolute lg:-right-1 lg:-top-1 lg:ml-0 lg:flex lg:h-[18px] lg:min-w-[18px] lg:items-center lg:justify-center lg:px-1 lg:text-[10px]' : ''}`}>
                                                            {count > 99 ? '99+' : count}
                                                        </span>
                                                    )}
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </nav>

                    {/* Footer actions */}
                    <div className="app-sidebar-footer app-sidebar-mobile-footer-safe flex flex-col gap-2 p-4 border-t shrink-0">
                        {showSettingsFooterLink && (
                            <Link
                                to={getPath(settingsFooterPath)}
                                title="Settings"
                                className={`app-sidebar-link relative flex w-full items-center justify-start gap-3 rounded-md px-4 py-3 font-semibold transition-all ${isCollapsed ? 'lg:justify-center lg:gap-0 lg:px-2' : ''} ${settingsFooterIsActive ? 'app-sidebar-link-active' : ''}`}
                            >
                                <Cog6ToothIcon className={`h-6 w-6 shrink-0 ${settingsFooterIsActive ? 'app-sidebar-icon-active' : 'app-sidebar-icon'}`} />
                                <span className={isCollapsed ? 'lg:hidden' : ''}>Settings</span>
                            </Link>
                        )}
                        <button
                            onClick={logout}
                            className={`app-sidebar-logout w-full flex items-center px-4 py-3 text-left rounded-lg font-semibold transition ${isCollapsed ? 'lg:justify-center lg:px-2' : ''}`}
                            title="Logout"
                        >
                            <ArrowLeftOnRectangleIcon className={`w-6 h-6 ${isCollapsed ? 'lg:mr-0' : 'mr-3'}`} />
                            <span className={isCollapsed ? 'lg:hidden' : ''}>Logout</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
