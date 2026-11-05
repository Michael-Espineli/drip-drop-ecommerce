import WorkspaceRecordHeader from '../../components/workspace/WorkspaceRecordHeader';
import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { getAuth, signOut } from 'firebase/auth';
import { Context } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
export default function More() {
  const {
      featureFlagsLoaded,
      isFeatureEnabled
    } = useContext(Context),
    {
      isDarkMode,
      toggleTheme
    } = useTheme();
  const groups = [['My pool', [['Service requests', '/client/service-requests'], ['Repair requests', '/client/repair-requests'], ['Equipment', '/client/equipment']]], ['Companies', [['Find pool service', '/client/companies'], ['Saved companies', '/client/saved-companies']]], ['Billing', [['Estimates & agreements', '/client/service-agreements'], ['Part approvals', '/client/part-approvals']]], ['Account', [['My profile', '/client/profile'], ['Notification settings', '/client/settings'], ...(featureFlagsLoaded && isFeatureEnabled('feature_flag_011') ? [['Notifications', '/client/notifications']] : []), ['Help & feedback', '/feedback'], ['Privacy policy', '/privacyPolicy'], ['Terms of service', '/termsOfService']]]];
  return <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6"><WorkspaceRecordHeader title={<>More</>} eyebrow="My account"></WorkspaceRecordHeader>{groups.map(([title, links]) => <section key={title} className="overflow-hidden rounded-xl border bg-white"><h2 className="px-4 pb-2 pt-4 text-sm font-bold text-slate-500">{title}</h2><div className="divide-y divide-slate-100">{links.map(([label, to]) => <Link key={to} to={to} className="flex min-h-[52px] items-center justify-between px-4 font-semibold text-slate-800">{label}<span aria-hidden="true" className="text-slate-400">›</span></Link>)}</div></section>)}<button onClick={toggleTheme} className="min-h-[48px] w-full rounded-lg border bg-white px-4 text-left font-semibold">{isDarkMode ? 'Use light appearance' : 'Use dark appearance'}</button><button onClick={() => signOut(getAuth())} className="min-h-[48px] w-full rounded-lg border border-red-200 px-4 text-left font-semibold text-red-700">Sign out</button></div>;
}
