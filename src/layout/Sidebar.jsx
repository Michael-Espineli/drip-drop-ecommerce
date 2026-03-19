import React, { useEffect, useState, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import { getNav } from '../navigation/index';
import { ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';
import { getAuth, signOut } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from '../utils/config';

const Sidebar = ({ showSidebar, setShowSidebar }) => {
    const auth = getAuth();
    const { role, recentlySelectedCompany, user, handleLogout } = useContext(Context);
    const { pathname } = useLocation();
    const [navItemsByCategory, setNavItemsByCategory] = useState({});
    const [counts, setCounts] = useState({ leads: 0, messages: 0 });

    useEffect(() => {
        if (role) {
            const navs = getNav(role);
            setNavItemsByCategory(navs);
        }
    }, [role]);

    useEffect(() => {
        if (!recentlySelectedCompany || !user) return;

        const leadsQuery = query(
            collection(db, "homeOwnerServiceRequests"),
            where("companyId", "==", recentlySelectedCompany),
            where("status", "==", "Pending")
        );

        const messagesQuery = query(
            collection(db, "chats"),
            where("participantIds", "array-contains", user.uid),
            where("unreadMessages", "array-contains", user.uid)
        );

        const unsubscribeLeads = onSnapshot(leadsQuery, snapshot => {
            setCounts(prev => ({ ...prev, leads: snapshot.size }));
        });

        const unsubscribeMessages = onSnapshot(messagesQuery, snapshot => {
            setCounts(prev => ({ ...prev, messages: snapshot.size }));
        });

        return () => {
            unsubscribeLeads();
            unsubscribeMessages();
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
                                        const count = item.title === 'Leads' ? counts.leads : item.title === 'Messages' ? counts.messages : 0;
                                        
                                        return (
                                            <li key={`${item.path}-${item.title}`}>
                                                <Link 
                                                    to={getPath(item.path)}
                                                    className={`w-full px-3 py-2 rounded-md flex justify-between items-center gap-3 font-medium transition-all ${isActive ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-100'}`}>
                                                    <div className="flex items-center gap-3">
                                                        <span className={`w-6 h-6 ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>{item.icon}</span>
                                                        <span>{item.title}</span>
                                                    </div>
                                                    {count > 0 && (
                                                        <span className="bg-red-500 text-white text-xs font-semibold mr-2 px-2.5 py-0.5 rounded-full">
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
