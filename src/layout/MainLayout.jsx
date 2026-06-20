import React, { useEffect, useState, useContext } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ClientSidebar from './ClientSidebar';
import AdminSideBar from './AdminSideBar';

import NoCompanySidebar from '../components/NoCompanySidebar';
import Footer from './Footer';
import { Context } from '../context/AuthContext';

const MainLayout = () => {
    const [showSidebar, setShowSidebar] = useState(false);
    const [isCompanySidebarCollapsed, setIsCompanySidebarCollapsed] = useState(() => (
        window.localStorage.getItem('companySidebarCollapsed') === 'true'
    ));
    const { accountType, recentlySelectedCompany } = useContext(Context);
    const location = useLocation();

    useEffect(() => {
        window.localStorage.setItem('companySidebarCollapsed', String(isCompanySidebarCollapsed));
    }, [isCompanySidebarCollapsed]);

    const renderSidebar = () => {
        if (accountType === 'Admin') {
            return <AdminSideBar showSidebar={showSidebar} setShowSidebar={setShowSidebar} />;
        }
        if (accountType === 'Client') {
            return <ClientSidebar showSidebar={showSidebar} setShowSidebar={setShowSidebar} />;
        }

        if (recentlySelectedCompany) {
            return (
                <Sidebar
                    showSidebar={showSidebar}
                    setShowSidebar={setShowSidebar}
                    isCollapsed={isCompanySidebarCollapsed}
                    setIsCollapsed={setIsCompanySidebarCollapsed}
                />
            );
        }
        
        return <NoCompanySidebar showSidebar={showSidebar} setShowSidebar={setShowSidebar} />;
    };

    const isConversationPage =
    location.pathname.startsWith('/companies-chat/detail/') ||
    location.pathname.startsWith('/client/chat/details/');
    const isAccountingWorkspace = accountType === 'Company' && location.pathname.startsWith('/company/accounting');
    const shellMarginClass = accountType === 'Company' && recentlySelectedCompany && isCompanySidebarCollapsed
        ? "lg:ml-[76px]"
        : "lg:ml-[260px]";

    if (isAccountingWorkspace) {
        return (
            <div className="theme-shell min-h-screen w-full">
                <Outlet />
            </div>
        );
    }
    
    return (
        <div className={`theme-shell w-full ${accountType === 'Admin' ? 'admin-theme' : ''}`}>
            <Header
                showSidebar={showSidebar}
                setShowSidebar={setShowSidebar}
                isCompanySidebarCollapsed={isCompanySidebarCollapsed}
            />
            {renderSidebar()}
            {
                accountType !== 'Admin' ? (
                    <div className={`${shellMarginClass} transition-all`}>
                        {isConversationPage ? (
                            <div className="h-screen flex flex-col">
                                <div className="h-[95px] flex-shrink-0" />
                                <main className="flex-1 min-h-0">
                                    <Outlet />
                                </main>
                            </div>
                        ) : (
                            <div className="min-h-screen flex flex-col">
                                <main className="flex-grow pt-[95px]">
                                    <Outlet />
                                </main>
                                <Footer />
                            </div>
                        )}
                    </div>

                ):(
                    <div className="lg:ml-[260px] admin-theme">
                        <div className="min-h-screen flex flex-col">
                            <main className="flex-grow">
                                <Outlet />
                            </main>
                        </div>
                    </div>
                )
            }
        </div>
    );
};

export default MainLayout;
