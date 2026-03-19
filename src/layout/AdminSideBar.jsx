import React, { useEffect, useState, useContext, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import { getNav } from '../navigation/index';
import { ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';
import { getAuth, signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../utils/config';

const AdminSideBar = ({ showSidebar, setShowSidebar }) => {
  const ADMIN_YELLOW = '#debf44';

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

  // Build queries only when we have what we need (prevents undefined query refs)
  const leadsQuery = useMemo(() => {
    if (!recentlySelectedCompany || !user) return null;
    // NOTE: adjust collection/path/filters to match your schema
    // This is a safe default based on typical patterns.
    return query(
      collection(db, 'leads'),
      where('companyId', '==', recentlySelectedCompany?.id || recentlySelectedCompany),
      where('status', '==', 'new')
    );
  }, [recentlySelectedCompany, user]);

  const messagesQuery = useMemo(() => {
    if (!recentlySelectedCompany || !user) return null;
    // NOTE: adjust collection/path/filters to match your schema
    return query(
      collection(db, 'messages'),
      where('companyId', '==', recentlySelectedCompany?.id || recentlySelectedCompany),
      where('unread', '==', true)
    );
  }, [recentlySelectedCompany, user]);

  useEffect(() => {
    if (!recentlySelectedCompany || !user) return;
    if (!leadsQuery || !messagesQuery) return;

    const unsubscribeLeads = onSnapshot(leadsQuery, (snapshot) => {
      setCounts((prev) => ({ ...prev, leads: snapshot.size }));
    });

    const unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
      setCounts((prev) => ({ ...prev, messages: snapshot.size }));
    });

    return () => {
      unsubscribeLeads();
      unsubscribeMessages();
    };
  }, [recentlySelectedCompany, user, leadsQuery, messagesQuery]);

  const logout = async () => {
    try {
      await signOut(auth);
      handleLogout();
    } catch (error) {
      console.error('Logout failed:', error.message);
    }
  };

  const getPath = (itemPath) => itemPath;

  return (
    <div>
      {/* Overlay for mobile view */}
      <div
        onClick={() => setShowSidebar(false)}
        className={`fixed duration-200 lg:hidden ${
          showSidebar ? 'w-screen h-screen bg-black/70 top-0 left-0 z-10' : 'w-0'
        }`}
      ></div>

      {/* Sidebar */}
      <div
        className={`w-[260px] fixed z-50 top-0 h-screen shadow-2xl transition-all
          bg-slate-950 text-slate-100 border-r border-slate-800/60
          ${showSidebar ? 'left-0' : '-left-[260px] lg:left-0'}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="h-[95px] flex justify-center items-center border-b border-slate-800/60 shrink-0">
            <Link
              to="/"
              className="text-2xl font-extrabold tracking-tight transition"
              style={{ color: ADMIN_YELLOW }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Drip Drop <span className="text-slate-300">[Admin]</span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="px-2 pt-5 text-slate-200 flex-grow overflow-y-auto">
            {Object.keys(navItemsByCategory).map((category) => (
              <div key={category} className="mb-3">
                {category !== 'NA' && (
                  <h3 className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    {category}
                  </h3>
                )}

                <ul className="flex flex-col gap-1">
                  {navItemsByCategory[category].map((item) => {
                    const isActive = pathname.toLowerCase() === item.path.toLowerCase();
                    const count =
                      item.title === 'Leads'
                        ? counts.leads
                        : item.title === 'Messages'
                        ? counts.messages
                        : 0;

                    return (
                      <li key={`${item.path}-${item.title}`}>
                        <Link
                          to={getPath(item.path)}
                          className={`group w-full px-3 py-2 rounded-md flex justify-between items-center gap-3 font-medium transition-all
                            ${
                              isActive
                                ? `bg-slate-900/80 ring-1 ring-[${ADMIN_YELLOW}]/30 shadow-[0_0_0_1px_rgba(222,191,68,0.10)]`
                                : 'hover:bg-slate-900/60 text-slate-200'
                            }`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`w-6 h-6 transition ${
                                isActive ? '' : 'text-slate-400 group-hover:text-slate-200'
                              }`}
                              style={isActive ? { color: ADMIN_YELLOW } : undefined}
                            >
                              {item.icon}
                            </span>

                            <span
                              className="transition"
                              style={isActive ? { color: ADMIN_YELLOW } : undefined}
                            >
                              {item.title}
                            </span>
                          </div>

                          {count > 0 && (
                            <span
                              className={`text-xs font-semibold px-2.5 py-0.5 rounded-full
                                bg-[${ADMIN_YELLOW}]/15 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/30`}
                            >
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
          <div className="p-4 border-t border-slate-800/60 shrink-0">
            <button
              onClick={logout}
              className="w-full flex items-center px-4 py-3 text-left rounded-lg font-medium transition
                text-red-300 hover:text-red-200 hover:bg-red-500/10 ring-1 ring-transparent hover:ring-red-500/20"
            >
              <ArrowLeftOnRectangleIcon className="w-6 h-6 mr-3" />
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSideBar;
