import React, { useContext, useEffect, useState } from "react";
import { Link } from 'react-router-dom';
import { Context } from "../context/AuthContext";
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { FaClipboardList, FaMoon, FaSun, FaUserPlus } from "react-icons/fa";
import { MdNotificationsActive } from "react-icons/md";
import { collection, onSnapshot } from "firebase/firestore";
import CompanyCommandSearch from "./CompanyCommandSearch";
import StartChatModal from "../views/components/chat/StartChatModal";
import { useTheme } from "../context/ThemeContext";
import { db } from "../utils/config";
import {
    ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID,
    alertNeedsAttention,
    normalizeAlertNotification,
} from "../utils/models/AlertNotification";
 
const Header = ({ showSidebar, setShowSidebar, isCompanySidebarCollapsed }) => {
    const [isStartChatOpen, setIsStartChatOpen] = useState(false);
    const [alertCount, setAlertCount] = useState(0);
    const { isDarkMode, toggleTheme } = useTheme();
    const {
        name,
        accountType,
        user,
        photoUrl,
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        companyRoleLoading,
        hasCompanyPermission,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);

    const alertsEnabled = accountType === 'Company'
        && recentlySelectedCompany
        && featureFlagsLoaded
        && isFeatureEnabled(ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID);

    useEffect(() => {
        if (!alertsEnabled || !user) {
            setAlertCount(0);
            return undefined;
        }

        return onSnapshot(
            collection(db, "companies", recentlySelectedCompany, "alerts"),
            (snapshot) => {
                const activeCount = snapshot.docs
                    .map(normalizeAlertNotification)
                    .filter((alert) => alertNeedsAttention(alert))
                    .length;

                setAlertCount(activeCount);
            },
            (error) => {
                console.error("Error loading header alert count:", error);
                setAlertCount(0);
            }
        );
    }, [alertsEnabled, recentlySelectedCompany, user]);

    // Do not render the header for Admin or if the account type is not set
    if (accountType === 'Admin' || !accountType) {
        return  (     
            <div onClick={() => setShowSidebar(!showSidebar)} className='w-[35px] flex lg:hidden h-[35px] rounded-sm border border-slate-400 text-white justify-center items-center cursor-pointer hover:bg-blue-500'>
                <span>三</span>
            </div>
        )      
    }

    const profileLink = accountType === 'Company' ? '/company/profile' : '/client/profile';
    const canOpenSetupGuide = accountType === 'Company' && recentlySelectedCompany && (
        companyRoleLoading || hasCompanyPermission("800")
    );
    const shellMarginClass = accountType === 'Company' && recentlySelectedCompany && isCompanySidebarCollapsed
        ? "lg:ml-[76px]"
        : "lg:ml-[260px]";
    const messagingEnabled = featureFlagsLoaded && isFeatureEnabled("feature_flag_001");
    const canStartChat = messagingEnabled && (
        (accountType === 'Company' && recentlySelectedCompany)
        || accountType === 'Client'
    );
    const canAddLead = accountType === 'Company' && recentlySelectedCompany && (
        companyRoleLoading || hasCompanyPermission("612")
    );
    const startChatMode = accountType === 'Company' ? 'company' : 'client';
    // const profileLink = '/company/profile' 
    return (
        <>
            <div className='fixed top-0 left-0 z-40 w-full px-3 py-3 lg:px-4'>
                <div className={`app-header-bar ml-0 ${shellMarginClass} flex h-16 items-center justify-between gap-4 rounded-lg px-3 transition-all sm:px-5`}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        {/* Hamburger Icon */}
                        <button
                            type="button"
                            onClick={() => setShowSidebar(!showSidebar)}
                            className='app-header-action flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition lg:hidden'
                            aria-label="Open navigation"
                        >
                            <span>三</span>
                        </button>

                        {accountType === 'Company' && (
                            <div className='hidden min-w-[180px] flex-1 md:block'>
                                <CompanyCommandSearch />
                            </div>
                        )}
                    </div>

                    {/* Profile Section */}
                    <div className='relative flex shrink-0 items-center justify-center gap-3'>
                        {canAddLead && (
                            <Link
                                to="/company/leads/new"
                                className="app-header-primary-action flex h-10 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-bold transition"
                            >
                                <FaUserPlus className="h-4 w-4" />
                                <span>Add Lead</span>
                            </Link>
                        )}
                        <button
                            type="button"
                            onClick={toggleTheme}
                            className="app-header-action flex h-10 w-10 items-center justify-center rounded-md transition"
                            aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                            title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                        >
                            {isDarkMode ? <FaSun className="h-4 w-4" /> : <FaMoon className="h-4 w-4" />}
                        </button>
                        {alertsEnabled && (
                            <Link
                                to="/company/alerts"
                                className="app-header-action relative flex h-10 w-10 items-center justify-center rounded-md transition"
                                aria-label={alertCount > 0 ? `${alertCount} active notifications` : "Notifications"}
                                title="Notifications"
                            >
                                <MdNotificationsActive className="h-5 w-5" />
                                {alertCount > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
                                        {alertCount > 99 ? '99+' : alertCount}
                                    </span>
                                )}
                            </Link>
                        )}
                        {canStartChat && (
                            <button
                                type="button"
                                onClick={() => setIsStartChatOpen(true)}
                                className="app-header-action flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition"
                                aria-label="Start a new chat"
                            >
                                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                                <span className="hidden xl:inline">Message</span>
                            </button>
                        )}
                        {canOpenSetupGuide && (
                            <Link
                                to="/company/setup-guide"
                                className="app-header-action flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition"
                            >
                                <FaClipboardList className="h-4 w-4" />
                                <span className="hidden xl:inline">Setup Guide</span>
                            </Link>
                        )}
                        <div>
                            <Link to={profileLink} className="w-auto h-[50px]">
                                <div className='flex justify-center items-center gap-3'>
                                    <div className='hidden max-w-[220px] flex-col items-end justify-center text-end sm:flex'>
                                        <h2 className='line-clamp-1 text-md font-bold'>
                                            {accountType === 'Company' ? `${name} - ${accountType}` : name}
                                        </h2>
                                        {accountType === 'Company' && recentlySelectedCompanyName && (
                                            <span className='app-header-muted w-full truncate text-[14px] font-medium'>{recentlySelectedCompanyName}</span>
                                        )}
                                    </div>
                                    <img className='h-[45px] w-[45px] rounded-full bg-white object-cover ring-2 ring-white/35' src={photoUrl} alt="profile" />
                                </div>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
            {isStartChatOpen && (
                <StartChatModal mode={startChatMode} closeModal={() => setIsStartChatOpen(false)} />
            )}
        </>
    );
};

export default Header;
