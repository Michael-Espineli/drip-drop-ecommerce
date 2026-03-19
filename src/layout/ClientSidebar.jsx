import React, { useEffect, useState, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import {
    HomeIcon,
    ChatBubbleOvalLeftEllipsisIcon,
    BuildingStorefrontIcon,
    HeartIcon,
    DocumentTextIcon,
    ArrowPathIcon,
    WrenchScrewdriverIcon,
    CogIcon,
    ArrowLeftOnRectangleIcon,
    TruckIcon
} from '@heroicons/react/24/outline';
import { getAuth, signOut } from "firebase/auth";

const clientNavItems = {
    'Menu': [
        { title: 'Home', icon: <HomeIcon />, path: '/client/dashboard' },
        { title: 'Chats', icon: <ChatBubbleOvalLeftEllipsisIcon />, path: '/client/chat' },
    ],
    'My Property': [
        { title: 'My Pool', icon: <WrenchScrewdriverIcon />, path: '/client/my-pool' },
        { title: 'Repair Requests', icon: <TruckIcon />, path: '/client/repair-requests' },
        { title: 'Service Requests', icon: <DocumentTextIcon />, path: '/client/service-requests' },
    ],
    // 'Agreements': [
    //     { title: 'Contracts', icon: <DocumentTextIcon />, path: '/client/contracts' },
    //     { title: 'Recurring Contracts', icon: <ArrowPathIcon />, path: '/client/recurring-contracts' },
    // ],
    'Companies': [
        { title: 'Browse Companies', icon: <BuildingStorefrontIcon />, path: '/client/companies' },
        { title: 'Saved Companies', icon: <HeartIcon />, path: '/client/saved-companies' },
    ],
    'NA': [
        { title: 'Settings', icon: <CogIcon />, path: '/client/settings' },
    ]
};

const ClientSidebar = ({ showSidebar, setShowSidebar }) => {
    const auth = getAuth();
    const { pathname } = useLocation();

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
                        {Object.keys(clientNavItems).map(category => (
                            <div key={category} className="mb-3">
                                {category !== 'NA' && (
                                     <h3 className="px-3 py-2 text-xs font-bold uppercase text-gray-500 tracking-wider">{category}</h3>
                                )}
                                <ul className='flex flex-col gap-1'>
                                    {clientNavItems[category].map(item => {
                                        const isActive = pathname.toLowerCase() === item.path.toLowerCase();
                                        return (
                                            <li key={`${item.path}-${item.title}`}>
                                                <Link 
                                                    to={item.path}
                                                    className={`w-full px-3 py-2 rounded-md flex justify-start items-center gap-3 font-medium transition-all ${isActive ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-100'}`}>
                                                    <span className={`w-6 h-6 ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>{item.icon}</span>
                                                    <span>{item.title}</span>
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

export default ClientSidebar;
