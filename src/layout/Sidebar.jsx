import React, { useEffect, useState, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import { getNav } from '../navigation/index';
import { ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';
import { getAuth, signOut } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from '../utils/config';
import { isOpenRepairRequestStatus } from '../utils/models/RepairRequest';

const Sidebar = ({ showSidebar, setShowSidebar }) => {
    const auth = getAuth();
    const { role, recentlySelectedCompany, user, dataBaseUser, handleLogout, companyRoleLoading, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
    const { pathname } = useLocation();
    const [navItemsByCategory, setNavItemsByCategory] = useState({});
    const [counts, setCounts] = useState({ leads: 0, messages: 0, shopping: 0, repairRequests: 0 });

    useEffect(() => {
        if (role) {
            const savedCategoryOrder = dataBaseUser?.settings?.companyNavigationCategoryOrder;
            const navs = getNav(role, savedCategoryOrder);
            const filteredNavs = Object.entries(navs).reduce((acc, [category, items]) => {
                const visibleItems = items.filter((item) => (
                    item.role !== "Company" ||
                    (
                        (!item.permissionId || companyRoleLoading || hasCompanyPermission(item.permissionId)) &&
                        (!item.featureFlagId || (featureFlagsLoaded && isFeatureEnabled(item.featureFlagId)))
                    )
                ));

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
            setCounts({ leads: 0, messages: 0, shopping: 0, legacyShopping: 0, repairRequests: 0, repairRequestSources: {} });
            return;
        }

        setCounts(prev => ({ ...prev, repairRequests: 0, repairRequestSources: {} }));

        const leadsQuery = query(
            collection(db, "homeownerServiceRequests"),
            where("companyId", "==", recentlySelectedCompany),
            where("status", "==", "Pending")
        );

        const messagesQuery = query(
            collection(db, "chats"),
            where("participantIds", "array-contains", user.uid)
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

        const unsubscribeMessages = onSnapshot(messagesQuery, snapshot => {
            const unreadCount = snapshot.docs.filter((chatDoc) => {
                const data = chatDoc.data();
                return data.userWhoHaveNotRead?.includes(user.uid) || data.unreadMessages?.includes(user.uid);
            }).length;

            setCounts(prev => ({ ...prev, messages: unreadCount }));
        });

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
            unsubscribeShopping();
            unsubscribeLegacyShopping();
            unsubscribeInternalRepairRequests();
            unsubscribeExternalRepairRequests();
        };
    }, [recentlySelectedCompany, user]);

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
            <div className={`w-[260px] fixed bg-white z-50 top-0 h-screen shadow-lg transition-all ${showSidebar ? 'left-0' : '-left-[260px] lg:left-0'}`}>
                <div className='flex flex-col h-full'>
                    {/* Header */}
                    <div className='h-[95px] flex justify-center items-center border-b border-b-slate-200 shrink-0'>
                        <Link to='/' className='text-gray-800 font-bold text-3xl'>
                            Drip Drop
                        </Link>
                    </div>

                    {/* Navigation */}
                    <nav className='px-2 pt-5 text-gray-700 flex-grow overflow-y-auto'>
                        {Object.keys(navItemsByCategory).map(category => (
                            <div key={category} className="mb-3">
                                {category !== 'NA' && (
                                    <h3 className="px-3 py-2 text-xs font-bold uppercase text-gray-500 tracking-wider">{category}</h3>
                                )}
                                <ul className='flex flex-col gap-1'>
                                    {navItemsByCategory[category].map(item => {
                                        const isActive = pathname.toLowerCase() === item.path.toLowerCase();
                                        const count =
                                            item.title === 'Leads'
                                                ? counts.leads
                                                : item.title === 'Messages'
                                                    ? counts.messages
                                                    : item.title === 'Shopping List'
                                                        ? (counts.shopping || 0) + (counts.legacyShopping || 0)
                                                        : item.title === 'Repair Requests'
                                                            ? counts.repairRequests
                                                            : 0;

                                        return (
                                            <li key={`${item.path}-${item.title}`}>
                                                <Link
                                                    to={getPath(item.path)}
                                                    className={`w-full px-3 py-2 rounded-md flex justify-start items-center gap-3 font-medium transition-all ${isActive ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-100'}`}>
                                                    <span className={`w-6 h-6 ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>{item.icon}</span>
                                                    <span>{item.title}</span>
                                                    {count > 0 && (
                                                        <span className="ml-auto bg-red-500 text-white text-xs font-semibold px-2.5 py-0.5 rounded-full">
                                                            {count}
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
                        <button onClick={logout} className="w-full flex items-center px-4 py-3 text-left text-red-500 hover:bg-red-50 rounded-lg font-medium">
                            <ArrowLeftOnRectangleIcon className="w-6 h-6 mr-3" />
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
