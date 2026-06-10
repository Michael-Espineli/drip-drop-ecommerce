import React, { useContext, useState } from "react";
import { Link } from 'react-router-dom';
import { Context } from "../context/AuthContext";
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { FaClipboardList } from "react-icons/fa";
import CompanyCommandSearch from "./CompanyCommandSearch";
import StartChatModal from "../views/components/chat/StartChatModal";
 
const Header = ({ showSidebar, setShowSidebar, isCompanySidebarCollapsed }) => {
    const [isStartChatOpen, setIsStartChatOpen] = useState(false);
    const {
        name,
        accountType,
        photoUrl,
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        companyRoleLoading,
        hasCompanyPermission,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);

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
    const startChatMode = accountType === 'Company' ? 'company' : 'client';
    // const profileLink = '/company/profile' 
    return (
        <>
            <div className='fixed top-0 left-0 w-full py-5 px-2 lg:px-1.69 z-40'>
                <div className={`ml-0 ${shellMarginClass} rounded-md h-[65px] flex items-center justify-between gap-4 bg-[#0e245c] px-3 sm:px-5 transition-all`}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        {/* Hamburger Icon */}
                        <button
                            type="button"
                            onClick={() => setShowSidebar(!showSidebar)}
                            className='flex h-[35px] w-[35px] shrink-0 items-center justify-center rounded-sm border border-slate-400 text-white cursor-pointer hover:bg-blue-500 lg:hidden'
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
                        {canStartChat && (
                            <button
                                type="button"
                                onClick={() => setIsStartChatOpen(true)}
                                className="flex h-10 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/20"
                                aria-label="Start a new chat"
                            >
                                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                                <span className="hidden xl:inline">Message</span>
                            </button>
                        )}
                        {canOpenSetupGuide && (
                            <Link
                                to="/company/setup-guide"
                                className="flex h-10 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/20"
                            >
                                <FaClipboardList className="h-4 w-4" />
                                <span className="hidden xl:inline">Setup Guide</span>
                            </Link>
                        )}
                        <div>
                            <Link to={profileLink} className="w-auto h-[50px]">
                                <div className='flex justify-center items-center gap-3'>
                                    <div className='hidden max-w-[220px] flex-col items-end justify-center text-end text-white sm:flex'>
                                        <h2 className='line-clamp-1 text-md font-bold'>
                                            {accountType === 'Company' ? `${name} - ${accountType}` : name}
                                        </h2>
                                        {accountType === 'Company' && recentlySelectedCompanyName && (
                                            <span className='w-full truncate text-[14px] font-normal'>{recentlySelectedCompanyName}</span>
                                        )}
                                    </div>
                                    <img className='h-[45px] w-[45px] rounded-full bg-white object-cover' src={photoUrl} alt="profile" />
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
