import React, { useContext } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { HomeIcon, WrenchScrewdriverIcon, ChatBubbleOvalLeftEllipsisIcon, CreditCardIcon, Squares2X2Icon, BellIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { Context } from '../context/AuthContext';
import ClientSidebar from './ClientSidebar';
export const clientNavigationSection = path => {
  if (path === '/client/dashboard') return 'Home';
  if (/^\/(client\/(my-pool|pools-spas|equipment|repair-requests|service-requests)|serviceLocation|serviceStop)/.test(path)) return 'My Pool';
  if (/^\/(client\/chat|messages\/newCompany)/.test(path)) return 'Messages';
  if (/^\/(client\/(finance|billing|service-agreements|part-approvals)|customer\/part-approvals)/.test(path)) return 'Billing';
  return 'More';
};
export default function ClientLayout() {
  const {
      pathname
    } = useLocation(),
    {
      featureFlagsLoaded,
      isFeatureEnabled
    } = useContext(Context);
  const section = clientNavigationSection(pathname),
    conversation = pathname.startsWith('/client/chat/details/');
  const nav = [['Home', '/client/dashboard', HomeIcon], ['My Pool', '/client/my-pool', WrenchScrewdriverIcon], ['Messages', '/client/chat', ChatBubbleOvalLeftEllipsisIcon], ['Billing', '/client/finance', CreditCardIcon], ['More', '/client/more', Squares2X2Icon]].filter(([name]) => name !== 'Messages' || (featureFlagsLoaded && isFeatureEnabled('feature_flag_001')));
  return <div className="theme-shell client-theme min-h-[100dvh] bg-slate-50 text-slate-950">
        <div className="hidden lg:block"><ClientSidebar showSidebar={false} setShowSidebar={() => {}} /></div>
        <div className={`lg:ml-[16.25rem] ${conversation ? 'flex h-[100dvh] flex-col' : 'min-h-[100dvh]'}`}>
            {!conversation && <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6"><Link to="/client/dashboard" className="text-xl font-bold tracking-tight text-blue-700">Drip Drop</Link><div className="flex items-center gap-2">{featureFlagsLoaded && isFeatureEnabled('feature_flag_011') && <Link aria-label="Notifications" to="/client/notifications" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600"><BellIcon className="h-6 w-6" /></Link>}<Link aria-label="My profile" to="/client/profile" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600"><UserCircleIcon className="h-7 w-7" /></Link></div></header>}
            <main className={`app-main-content min-w-0 ${conversation ? 'min-h-0 flex-1' : 'pb-[calc(6rem+env(safe-area-inset-bottom,0px))] lg:pb-8'}`}><Outlet /></main>
        </div>
        {!conversation && <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom,0px)] lg:hidden">{nav.map(([name, to, Icon]) => <NavLink key={name} to={to} aria-current={section === name ? 'page' : undefined} className={`flex min-h-[64px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold ${section === name ? 'text-blue-700' : 'text-slate-500'}`}><Icon className="h-6 w-6" /><span>{name}</span></NavLink>)}</nav>}
    </div>;
}
