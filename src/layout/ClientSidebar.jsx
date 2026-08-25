import React, { useContext, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    HomeIcon,
    BellIcon,
    ChatBubbleOvalLeftEllipsisIcon,
    BuildingStorefrontIcon,
    HeartIcon,
    DocumentTextIcon,
    WrenchScrewdriverIcon,
    CogIcon,
    ArrowLeftOnRectangleIcon,
    TruckIcon,
    CreditCardIcon,
    XMarkIcon,
    ClipboardDocumentCheckIcon
} from '@heroicons/react/24/outline';
import { getAuth, signOut } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { Context } from '../context/AuthContext';
import { db } from '../utils/config';
import {
    ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID,
    alertNeedsAttention,
    normalizeAlertNotification,
} from '../utils/models/AlertNotification';

const clientNavItems = {
    'Menu': [
        { title: 'Home', icon: <HomeIcon />, path: '/client/dashboard' },
        { title: 'Messages', icon: <ChatBubbleOvalLeftEllipsisIcon />, path: '/client/chat', featureFlagId: 'feature_flag_001' },
        { title: 'Notifications', icon: <BellIcon />, path: '/client/notifications', featureFlagId: 'feature_flag_011' },
    ],
    'My Property': [
        { title: 'My Pool', icon: <WrenchScrewdriverIcon />, path: '/client/my-pool' },
        { title: 'Repair Requests', icon: <TruckIcon />, path: '/client/repair-requests' },
        { title: 'Service Requests', icon: <DocumentTextIcon />, path: '/client/service-requests' },
    ],
    'Companies': [
        { title: 'Browse Companies', icon: <BuildingStorefrontIcon />, path: '/client/companies' },
        { title: 'Saved Companies', icon: <HeartIcon />, path: '/client/saved-companies' },
    ],
    'Finance': [
        {
            title: 'Finance',
            icon: <CreditCardIcon />,
            path: '/client/finance',
            aliases: ['/client/billing'],
        },
        { title: 'Estimates', icon: <DocumentTextIcon />, path: '/client/service-agreements' },
        { title: 'Part Approvals', icon: <ClipboardDocumentCheckIcon />, path: '/client/part-approvals' },
    ],
    'NA': [
        { title: 'Settings', icon: <CogIcon />, path: '/client/settings' },
    ]
};

const ClientSidebar = ({ showSidebar, setShowSidebar }) => {
    const auth = getAuth();
    const { pathname } = useLocation();
    const { user, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
    const [notificationCount, setNotificationCount] = useState(0);

    useEffect(() => {
        setShowSidebar(false);
    }, [pathname, setShowSidebar]);

    useEffect(() => {
        const alertsEnabled = featureFlagsLoaded && isFeatureEnabled(ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID);
        if (!user?.uid || !alertsEnabled) {
            setNotificationCount(0);
            return undefined;
        }

        const unsubscribe = onSnapshot(
            collection(db, "users", user.uid, "alerts"),
            snapshot => {
                const count = snapshot.docs
                    .map(normalizeAlertNotification)
                    .filter(alertNeedsAttention)
                    .length;

                setNotificationCount(count);
            },
            error => {
                console.error("Error loading client notification count:", error);
                setNotificationCount(0);
            }
        );

        return () => unsubscribe();
    }, [featureFlagsLoaded, isFeatureEnabled, user]);

    const logout = async () => {
        try {
          await signOut(auth);
          console.log("User signed out successfully");
        } catch (error) {
          console.error("Logout failed:", error.message);
        }
    };

    return (
        <div>
            {/* Overlay for mobile view */}
            <div
                aria-hidden="true"
                onClick={() => setShowSidebar(false)}
                className={`app-mobile-sidebar-overlay fixed left-0 z-40 w-screen bg-black/50 transition-opacity duration-200 lg:hidden ${showSidebar ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
            ></div>

            {/* Sidebar */}
            <div className={`app-mobile-sidebar-shell fixed top-0 z-50 h-screen w-[min(20rem,88vw)] bg-white shadow-lg transition-all lg:w-[260px] ${showSidebar ? 'left-0' : '-left-full lg:left-0'}`}>
                <div className='flex h-full flex-col overflow-hidden'>
                    {/* Header */}
                    <div className='h-[95px] flex items-center justify-between border-b border-b-slate-200 px-4 shrink-0 lg:justify-center'>
                        <Link to='/' className='text-gray-800 font-bold text-3xl'>
                            Drip Drop
                        </Link>
                        <button
                            type="button"
                            onClick={() => setShowSidebar(false)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-100 lg:hidden"
                            aria-label="Close navigation"
                            title="Close navigation"
                        >
                            <XMarkIcon className="h-5 w-5" />
                        </button>
                    </div>
                    
                    {/* Navigation */}
                    <nav className='min-h-0 flex-grow overflow-y-auto overscroll-contain px-2 pt-5 text-gray-700'>
                        {Object.keys(clientNavItems).map(category => (
                            <div key={category} className="mb-3">
                                {category !== 'NA' && (
                                     <h3 className="px-3 py-2 text-xs font-bold uppercase text-gray-500 tracking-wider">{category}</h3>
                                )}
                                <ul className='flex flex-col gap-1'>
                                    {clientNavItems[category].filter((item) => (
                                        !item.featureFlagId || (featureFlagsLoaded && isFeatureEnabled(item.featureFlagId))
                                    )).map(item => {
                                        const itemPath = item.path.toLowerCase();
                                        const currentPath = pathname.toLowerCase();
                                        const aliasPaths = (item.aliases || []).map(alias => alias.toLowerCase());
                                        const isActive = (
                                            currentPath === itemPath ||
                                            currentPath.startsWith(`${itemPath}/`) ||
                                            aliasPaths.some(alias => currentPath === alias || currentPath.startsWith(`${alias}/`))
                                        );
                                        const count = item.title === 'Notifications' ? notificationCount : 0;
                                        return (
                                            <li key={`${item.path}-${item.title}`}>
                                                <Link 
                                                    to={item.path}
                                                    className={`w-full px-3 py-2 rounded-md flex justify-start items-center gap-3 font-medium transition-all ${isActive ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-100'}`}>
                                                    <span className={`w-6 h-6 ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>{item.icon}</span>
                                                    <span>{item.title}</span>
                                                    {count > 0 && (
                                                        <span className="ml-auto rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-semibold text-white">
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
                    <div className="app-sidebar-mobile-footer-safe p-4 border-t border-t-slate-200 shrink-0">
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

export default ClientSidebar;
