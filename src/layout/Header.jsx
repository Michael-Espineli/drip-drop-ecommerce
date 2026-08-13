import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from 'react-router-dom';
import { Context } from "../context/AuthContext";
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { FaClipboardList, FaMoon, FaSun, FaUserPlus } from "react-icons/fa";
import { MdNotificationsActive } from "react-icons/md";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import CompanyCommandSearch from "./CompanyCommandSearch";
import StartChatModal from "../views/components/chat/StartChatModal";
import { useTheme } from "../context/ThemeContext";
import { db } from "../utils/config";
import { isChatUnreadFor, listenVisibleChats } from "../utils/chatMessaging";
import { COMPANY_WIDE_MESSAGES_PERMISSION_ID } from "../utils/companyPermissions";
import {
    getCustomerTagOptions,
    getEffectiveCustomerRegionAccess,
    normalizeCustomerTags,
} from "../utils/customerTags";
import {
    ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID,
    alertBelongsToCompany,
    alertNeedsAttention,
    attachAlertNotificationSource,
    mergeAlertNotifications,
} from "../utils/models/AlertNotification";
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from "../utils/models/FeatureFlag";

const HeaderBadge = ({ count }) => {
    if (!count) return null;

    return (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
            {count > 99 ? '99+' : count}
        </span>
    );
};

const Header = ({ showSidebar, setShowSidebar, isCompanySidebarCollapsed }) => {
    const [isStartChatOpen, setIsStartChatOpen] = useState(false);
    const [alertCount, setAlertCount] = useState(0);
    const [messageCount, setMessageCount] = useState(0);
    const [customerRegionOptions, setCustomerRegionOptions] = useState([]);
    const [isRegionLoading, setIsRegionLoading] = useState(false);
    const { isDarkMode, toggleTheme } = useTheme();
    const {
        name,
        accountType,
        user,
        photoUrl,
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        companyUserAccess,
        companyRole,
        companyRoleLoading,
        companyRoleLoaded,
        hasCompanyPermission,
        selectedCustomerRegionTag,
        setSelectedCustomerRegionTag,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);

    const customerRegionAccess = useMemo(
        () => getEffectiveCustomerRegionAccess({ userAccess: companyUserAccess, role: companyRole }),
        [companyUserAccess, companyRole]
    );

    const isCompanyShell = accountType === 'Company' && recentlySelectedCompany;
    const alertsEnabled = (accountType === 'Client' || isCompanyShell)
        && featureFlagsLoaded
        && isFeatureEnabled(ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID);
    const messagingEnabled = featureFlagsLoaded && isFeatureEnabled("feature_flag_001");
    const customerAreaFilteringEnabled = accountType === 'Company'
        && recentlySelectedCompany
        && featureFlagsLoaded
        && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);
    const customerAreaAccessReady = Boolean(
        customerAreaFilteringEnabled &&
        companyRoleLoaded &&
        companyUserAccess
    );
    const customerRegionSelectLabel = customerRegionAccess.fullAccess
        ? "Area"
        : customerRegionAccess.source === "role"
            ? "Role Area"
            : "Assigned Area";
    const customerRegionEmptyLabel = customerRegionAccess.fullAccess
        ? "All areas"
        : customerRegionAccess.source === "role"
            ? "All role areas"
            : "All assigned";

    useEffect(() => {
        if (!alertsEnabled || !user?.uid) {
            setAlertCount(0);
            return undefined;
        }

        const companyId = isCompanyShell ? recentlySelectedCompany : "";
        const alertSources = { company: [], personal: [] };

        const updateAlertCount = (scope, nextAlerts) => {
            alertSources[scope] = nextAlerts;
            const activeCount = mergeAlertNotifications([
                ...alertSources.personal,
                ...alertSources.company,
            ])
                .filter((alert) => alertBelongsToCompany(alert, companyId))
                .filter(alertNeedsAttention)
                .length;

            setAlertCount(activeCount);
        };

        let unsubscribeCompanyAlerts = () => {};
        let unsubscribePersonalAlerts = () => {};

        if (companyId) {
            unsubscribeCompanyAlerts = onSnapshot(
                collection(db, "companies", companyId, "alerts"),
                (snapshot) => {
                    updateAlertCount(
                        "company",
                        snapshot.docs.map((alertDoc) => attachAlertNotificationSource(alertDoc, "company"))
                    );
                },
                (error) => {
                    console.error("Error loading header company alert count:", error);
                    updateAlertCount("company", []);
                }
            );
        }

        unsubscribePersonalAlerts = onSnapshot(
            collection(db, "users", user.uid, "alerts"),
            (snapshot) => {
                const personalAlerts = snapshot.docs
                    .map((alertDoc) => attachAlertNotificationSource(alertDoc, "personal"))
                    .filter((alert) => alertBelongsToCompany(alert, companyId));

                updateAlertCount("personal", personalAlerts);
            },
            (error) => {
                console.error("Error loading header personal alert count:", error);
                updateAlertCount("personal", []);
            }
        );

        return () => {
            unsubscribeCompanyAlerts();
            unsubscribePersonalAlerts();
        };
    }, [alertsEnabled, isCompanyShell, recentlySelectedCompany, user]);

    useEffect(() => {
        const companyId = isCompanyShell ? recentlySelectedCompany : "";
        const canListenForMessages = messagingEnabled
            && user?.uid
            && (
                accountType === 'Client'
                || (isCompanyShell && companyRoleLoaded && companyUserAccess)
            );

        if (!canListenForMessages) {
            setMessageCount(0);
            return undefined;
        }

        const includeCompanyWide = isCompanyShell
            && companyRoleLoaded
            && hasCompanyPermission(COMPANY_WIDE_MESSAGES_PERMISSION_ID);

        return listenVisibleChats({
            db,
            userId: user.uid,
            companyId,
            includeCompanyWide,
            onChange: (visibleChats) => {
                const unreadCount = visibleChats
                    .filter((chat) => isChatUnreadFor(chat, user.uid, companyId))
                    .length;

                setMessageCount(unreadCount);
            },
            onError: (error) => {
                console.error("Error loading header message count:", error);
                setMessageCount(0);
            },
        });
    }, [
        accountType,
        companyRoleLoaded,
        companyUserAccess,
        isCompanyShell,
        messagingEnabled,
        recentlySelectedCompany,
        hasCompanyPermission,
        user,
    ]);

    useEffect(() => {
        let isActive = true;

        if (!customerAreaAccessReady || companyRoleLoading) {
            setCustomerRegionOptions([]);
            setIsRegionLoading(false);
            return () => {
                isActive = false;
            };
        }

        const loadCustomerRegions = async () => {
            if (!customerRegionAccess.fullAccess) {
                const allowedTags = normalizeCustomerTags(customerRegionAccess.tags);
                if (!isActive) return;
                setCustomerRegionOptions(allowedTags);
                setIsRegionLoading(false);
                if (
                    selectedCustomerRegionTag &&
                    !allowedTags.some((tag) => tag.toLowerCase() === selectedCustomerRegionTag.toLowerCase())
                ) {
                    setSelectedCustomerRegionTag("");
                }
                return;
            }

            setIsRegionLoading(true);
            try {
                const customersSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "customers"));
                if (!isActive) return;

                const tags = getCustomerTagOptions(customersSnap.docs.map((customerDoc) => ({
                    id: customerDoc.id,
                    ...customerDoc.data(),
                })));
                setCustomerRegionOptions(tags);

                if (
                    selectedCustomerRegionTag &&
                    !tags.some((tag) => tag.toLowerCase() === selectedCustomerRegionTag.toLowerCase())
                ) {
                    setSelectedCustomerRegionTag("");
                }
            } catch (error) {
                console.error("Error loading customer region tags:", error);
                if (isActive) setCustomerRegionOptions([]);
            } finally {
                if (isActive) setIsRegionLoading(false);
            }
        };

        loadCustomerRegions();

        return () => {
            isActive = false;
        };
    }, [
        accountType,
        recentlySelectedCompany,
        customerAreaAccessReady,
        companyRoleLoading,
        customerRegionAccess,
        selectedCustomerRegionTag,
        setSelectedCustomerRegionTag,
    ]);

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
    const canStartChat = messagingEnabled && (
        (accountType === 'Company' && recentlySelectedCompany)
        || accountType === 'Client'
    );
    const canAddLead = accountType === 'Company' && recentlySelectedCompany && (
        companyRoleLoading || hasCompanyPermission("612")
    );
    const startChatMode = accountType === 'Company' ? 'company' : 'client';
    const notificationsPath = accountType === 'Company' ? '/company/alerts' : '/client/notifications';
    // const profileLink = '/company/profile' 
    return (
        <>
            <div className='app-header-shell fixed top-0 left-0 z-40 w-full px-3 py-3 lg:px-4'>
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
                        {customerAreaAccessReady && customerRegionOptions.length > 0 && (
                            <label className="app-header-action hidden h-10 items-center gap-2 rounded-md px-2 text-xs font-semibold transition lg:flex">
                                <span className="hidden xl:inline">{customerRegionSelectLabel}</span>
                                <select
                                    value={selectedCustomerRegionTag || ""}
                                    onChange={(event) => setSelectedCustomerRegionTag(event.target.value)}
                                    disabled={isRegionLoading}
                                    className="h-8 max-w-[150px] rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-70"
                                    aria-label="Customer area filter"
                                >
                                    <option value="">{customerRegionEmptyLabel}</option>
                                    {customerRegionOptions.map((tag) => (
                                        <option key={tag} value={tag}>{tag}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {canAddLead && (
                            <Link
                                to="/company/leads/new"
                                className="app-header-primary-action hidden h-10 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-bold transition lg:flex"
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
                                to={notificationsPath}
                                className="app-header-action relative flex h-10 w-10 items-center justify-center rounded-md transition"
                                aria-label={alertCount > 0 ? `${alertCount} active notifications` : "Notifications"}
                                title="Notifications"
                            >
                                <MdNotificationsActive className="h-5 w-5" />
                                <HeaderBadge count={alertCount} />
                            </Link>
                        )}
                        {canStartChat && (
                            <button
                                type="button"
                                onClick={() => setIsStartChatOpen(true)}
                                className="app-header-action relative flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition"
                                aria-label={messageCount > 0 ? `Start a new chat, ${messageCount} unread messages` : "Start a new chat"}
                                title={messageCount > 0 ? `${messageCount} unread messages` : "Start a new chat"}
                            >
                                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                                <span className="hidden xl:inline">Message</span>
                                <HeaderBadge count={messageCount} />
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
