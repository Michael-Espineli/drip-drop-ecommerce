import React, { useEffect, useState, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import { getNav } from '../navigation/index';
import { ArrowLeftOnRectangleIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from '@heroicons/react/24/outline';
import { getAuth, signOut } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from '../utils/config';
import { isOpenRepairRequestStatus } from '../utils/models/RepairRequest';
import { isChatUnreadFor, listenVisibleChats } from '../utils/chatMessaging';
import {
    TODO_LIST_FEATURE_FLAG_ID,
    normalizeTodo,
    todoIsOpen,
} from '../utils/models/TodoItem';

const Sidebar = ({ showSidebar, setShowSidebar, isCollapsed, setIsCollapsed }) => {
    const auth = getAuth();
    const { role, recentlySelectedCompany, user, dataBaseUser, handleLogout, companyRoleLoading, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
    const { pathname } = useLocation();
    const [navItemsByCategory, setNavItemsByCategory] = useState({});
    const [counts, setCounts] = useState({ leads: 0, messages: 0, shopping: 0, repairRequests: 0, todoItems: 0 });
    const categoryLabel = (category) => category === 'Users' ? 'Users, Vendors & Fleet' : category;
    const categoryInitial = (category) => categoryLabel(category).charAt(0).toUpperCase();

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
            setCounts({ leads: 0, messages: 0, shopping: 0, legacyShopping: 0, repairRequests: 0, repairRequestSources: {}, todoItems: 0 });
            return;
        }

        setCounts(prev => ({ ...prev, repairRequests: 0, repairRequestSources: {} }));

        const leadsQuery = query(
            collection(db, "homeownerServiceRequests"),
            where("companyId", "==", recentlySelectedCompany),
            where("status", "==", "Pending")
        );

        const shoppingQuery = query(
            collection(db, "companies", recentlySelectedCompany, "shoppingList"),
            where("status", "==", "Need to Purchase")
        );

        const legacyShoppingQuery = query(
            collection(db, "companies", recentlySelectedCompany, "shoppingListItems"),
            where("status", "==", "Need to Purchase")
        );

        const internalRepairRequestsQuery = collection(
            db,
            "companies",
            recentlySelectedCompany,
            "repairRequests"
        );

        const externalRepairRequestsQuery = query(
            collection(db, "homeownerRepairRequests"),
            where("companyId", "==", recentlySelectedCompany)
        );

        const unsubscribeLeads = onSnapshot(leadsQuery, snapshot => {
            setCounts(prev => ({ ...prev, leads: snapshot.size }));
        });

        const messagesEnabled = featureFlagsLoaded && isFeatureEnabled("feature_flag_001");
        let unsubscribeMessages = () => {};

        if (messagesEnabled) {
            unsubscribeMessages = listenVisibleChats({
                db,
                userId: user.uid,
                companyId: recentlySelectedCompany,
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

        const todoListEnabled = featureFlagsLoaded && isFeatureEnabled(TODO_LIST_FEATURE_FLAG_ID);
        let unsubscribeTodos = () => {};

        if (todoListEnabled) {
            unsubscribeTodos = onSnapshot(
                collection(db, "companies", recentlySelectedCompany, "todoItems"),
                snapshot => {
                    const openCount = snapshot.docs
                        .map(normalizeTodo)
                        .filter(todoIsOpen)
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

        const unsubscribeShopping = onSnapshot(shoppingQuery, snapshot => {
            setCounts(prev => ({ ...prev, shopping: snapshot.size }));
        });

        const unsubscribeLegacyShopping = onSnapshot(legacyShoppingQuery, snapshot => {
            setCounts(prev => ({ ...prev, legacyShopping: snapshot.size }));
        });

        const updateRepairRequestCount = (source, snapshot) => {
            const count = snapshot.docs.filter((requestDoc) => (
                isOpenRepairRequestStatus(requestDoc.data()?.status)
            )).length;

            setCounts(prev => {
                const repairRequestSources = {
                    ...prev.repairRequestSources,
                    [source]: count,
                };

                return {
                    ...prev,
                    repairRequestSources,
                    repairRequests: Object.values(repairRequestSources).reduce((total, value) => total + value, 0),
                };
            });
        };

        const unsubscribeInternalRepairRequests = onSnapshot(internalRepairRequestsQuery, snapshot => {
            updateRepairRequestCount("internal", snapshot);
        });

        const unsubscribeExternalRepairRequests = onSnapshot(externalRepairRequestsQuery, snapshot => {
            updateRepairRequestCount("external", snapshot);
        });

        return () => {
            unsubscribeLeads();
            unsubscribeMessages();
            unsubscribeTodos();
            unsubscribeShopping();
            unsubscribeLegacyShopping();
            unsubscribeInternalRepairRequests();
            unsubscribeExternalRepairRequests();
        };
    }, [recentlySelectedCompany, user, featureFlagsLoaded, isFeatureEnabled]);

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

    return (
        <div>
            {/* Overlay for mobile view */}
            <div onClick={() => setShowSidebar(false)} className={`fixed duration-200 lg:hidden ${showSidebar ? 'w-screen h-screen bg-black/50 top-0 left-0 z-10' : 'w-0'}`}></div>

            {/* Sidebar */}
            <div className={`fixed top-0 z-50 h-screen w-[260px] bg-white shadow-lg transition-all duration-200 ${isCollapsed ? 'lg:w-[76px]' : 'lg:w-[260px]'} ${showSidebar ? 'left-0' : '-left-[260px] lg:left-0'}`}>
                <div className='flex flex-col h-full'>
                    {/* Header */}
                    <div className={`h-[95px] flex items-center gap-2 border-b border-b-slate-200 px-4 shrink-0 ${isCollapsed ? 'lg:justify-center' : 'justify-between'}`}>
                        <Link to='/' className='min-w-0 text-gray-800 font-bold text-3xl'>
                            <span className={isCollapsed ? 'hidden lg:inline' : 'hidden'}>DD</span>
                            <span className={isCollapsed ? 'lg:hidden' : ''}>Drip Drop</span>
                        </Link>
                        <button
                            type="button"
                            onClick={() => setIsCollapsed((current) => !current)}
                            className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100 lg:flex ${isCollapsed ? 'lg:absolute lg:-right-4 lg:bg-white lg:shadow-sm' : ''}`}
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
                    <nav className={`px-2 pt-5 text-gray-700 flex-grow overflow-y-auto ${isCollapsed ? 'lg:px-2' : ''}`}>
                        {Object.keys(navItemsByCategory).map((category, categoryIndex) => (
                            <div
                                key={category}
                                className={`mb-3 ${isCollapsed && categoryIndex > 0 ? 'lg:mt-5 lg:pt-2' : ''}`}
                            >
                                {categoryIndex > 0 && (
                                    <div
                                        className={`hidden items-center px-1 pb-3 ${isCollapsed ? 'lg:flex' : ''}`}
                                        role="separator"
                                        aria-label={`${categoryLabel(category)} section`}
                                        title={categoryLabel(category)}
                                    >
                                        <span className="h-[2px] flex-1 bg-slate-500" />
                                        <span className="mx-2 shrink-0 text-[11px] font-bold uppercase leading-none text-slate-700">
                                            {categoryInitial(category)}
                                        </span>
                                        <span className="h-[2px] flex-1 bg-slate-500" />
                                    </div>
                                )}
                                {category !== 'NA' && (
                                    <h3 className={`px-3 py-2 text-xs font-bold uppercase text-gray-500 tracking-wider ${isCollapsed ? 'lg:hidden' : ''}`}>{categoryLabel(category)}</h3>
                                )}
                                <ul className='flex flex-col gap-1'>
                                    {navItemsByCategory[category].map(item => {
                                        const isActive = pathname.toLowerCase() === item.path.toLowerCase();
                                        const count =
                                            item.title === 'Leads'
                                                ? counts.leads
                                                : item.title === 'Messages'
                                                    ? counts.messages
                                                    : item.title === 'Todo List'
                                                        ? counts.todoItems
                                                        : item.title === 'Shopping List'
                                                            ? (counts.shopping || 0) + (counts.legacyShopping || 0)
                                                            : item.title === 'Repair Requests'
                                                                ? counts.repairRequests
                                                                : 0;

                                        return (
                                            <li key={`${item.path}-${item.title}`}>
                                                <Link
                                                    to={getPath(item.path)}
                                                    title={item.title}
                                                    className={`relative w-full px-3 py-2 rounded-md flex justify-start items-center gap-3 font-medium transition-all ${isCollapsed ? 'lg:justify-center lg:gap-0 lg:px-2' : ''} ${isActive ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-100'}`}>
                                                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${isActive ? 'text-blue-600' : 'text-gray-500'} [&>svg]:h-5 [&>svg]:w-5`}>{item.icon}</span>
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

                    {/* Logout Button */}
                    <div className="p-4 border-t border-t-slate-200 shrink-0">
                        <button
                            onClick={logout}
                            className={`w-full flex items-center px-4 py-3 text-left text-red-500 hover:bg-red-50 rounded-lg font-medium ${isCollapsed ? 'lg:justify-center lg:px-2' : ''}`}
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
