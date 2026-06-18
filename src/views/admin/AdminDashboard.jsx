import React, { useState, useContext, useEffect } from 'react';
import {
  FaComments,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaFlag,
  FaInbox,
  FaTools,
  FaUsers,
} from 'react-icons/fa';
import { MdCurrencyExchange, MdMarkEmailUnread, MdOutlineFeedback } from 'react-icons/md';
import { Link } from 'react-router-dom';
import {
  query,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  getCountFromServer,
  where,
} from 'firebase/firestore';
import { db } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  CONTACT_MESSAGES_COLLECTION,
  PRODUCT_FEEDBACK_COLLECTION,
} from '../../utils/adminInbox';
import { APP_ERRORS_COLLECTION } from '../../utils/errorReporting';
import { APP_LIVE_FEATURE_FLAG_ID } from '../../utils/models/FeatureFlag';

const functions = getFunctions();

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return 'No date';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

const formatCount = (value) => Number(value || 0).toLocaleString();

const AdminDashboard = () => {
  const ADMIN_YELLOW = '#debf44';

  const { recentlySelectedCompany } = useContext(Context);
  const selectedCompanyId = recentlySelectedCompany?.id || recentlySelectedCompany;

  const [alertList, setAlertList] = useState([]);

  const [customerCount, setCustomerCount] = useState(0);
  const [techCount, setTechCount] = useState(0);
  const [jobCount, setJobCount] = useState(0);
  const [totalSales] = useState(32232.78);

  const [companyCount, setCompanyCount] = useState(0);
  const [activeCompanyCount, setActiveCompanyCount] = useState(0);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [unverifiedCompanyCount, setUnverifiedCompanyCount] = useState(0);

  const [developmentStats, setDevelopmentStats] = useState({
    universalEquipmentModels: 0,
    universalEquipmentTypes: 0,
    featureFlags: 0,
    enabledFeatureFlags: 0,
    appLaunchEnabled: false,
    appLaunchReleaseDate: null,
    productFeedback: 0,
    newProductFeedback: 0,
    appErrors: 0,
    newAppErrors: 0,
  });

  const [communicationStats, setCommunicationStats] = useState({
    liveChatThreads: 0,
    unreadMessageRecords: 0,
    reachOutMessages: 0,
    newReachOutMessages: 0,
    unhandledComplaints: 0,
  });

  const [recentReachOutMessages, setRecentReachOutMessages] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const readCount = async (targetQuery) => {
          const snapshot = await getCountFromServer(targetQuery);
          return snapshot.data().count || 0;
        };

        const [
          companiesAll,
          companiesActive,
          companiesUnverified,
          subsAll,
          universalEquipmentModels,
          universalEquipmentTypes,
          featureFlags,
          enabledFeatureFlags,
          productFeedback,
          newProductFeedback,
          appErrors,
          newAppErrors,
          liveChatThreads,
          unreadMessageRecords,
          reachOutMessages,
          newReachOutMessages,
          reachOutSnapshot,
          appLaunchSnapshot,
        ] = await Promise.all([
          readCount(query(collection(db, 'companies'))),
          readCount(query(collection(db, 'companies'), where('status', '==', 'active'))),
          readCount(query(collection(db, 'companies'), where('verified', '==', false))),
          readCount(query(collection(db, 'subscriptions'))),
          readCount(query(collection(db, 'universal', 'equipment', 'equipment'))),
          readCount(query(collection(db, 'universal', 'equipment', 'equipmentTypes'))),
          readCount(query(collection(db, 'featureFlags'))),
          readCount(query(collection(db, 'featureFlags'), where('enabled', '==', true))),
          readCount(query(collection(db, PRODUCT_FEEDBACK_COLLECTION))),
          readCount(query(collection(db, PRODUCT_FEEDBACK_COLLECTION), where('status', '==', 'New'))),
          readCount(query(collection(db, APP_ERRORS_COLLECTION))),
          readCount(query(collection(db, APP_ERRORS_COLLECTION), where('status', '==', 'New'))),
          readCount(query(collection(db, 'chats'))),
          readCount(query(collection(db, 'messages'), where('read', '==', false))),
          readCount(query(collection(db, CONTACT_MESSAGES_COLLECTION))),
          readCount(query(collection(db, CONTACT_MESSAGES_COLLECTION), where('status', '==', 'New'))),
          getDocs(query(
            collection(db, CONTACT_MESSAGES_COLLECTION),
            orderBy('createdAt', 'desc'),
            limit(3)
          )),
          getDoc(doc(db, 'featureFlags', APP_LIVE_FEATURE_FLAG_ID)),
        ]);
        const appLaunchFlag = appLaunchSnapshot.exists() ? appLaunchSnapshot.data() : null;

        setCompanyCount(companiesAll);
        setActiveCompanyCount(companiesActive);
        setUnverifiedCompanyCount(companiesUnverified);
        setSubscriptionCount(subsAll);
        setDevelopmentStats({
          universalEquipmentModels,
          universalEquipmentTypes,
          featureFlags,
          enabledFeatureFlags,
          appLaunchEnabled: Boolean(appLaunchFlag?.enabled),
          appLaunchReleaseDate: appLaunchFlag?.releaseDate || null,
          productFeedback,
          newProductFeedback,
          appErrors,
          newAppErrors,
        });
        setCommunicationStats({
          liveChatThreads,
          unreadMessageRecords,
          reachOutMessages,
          newReachOutMessages,
          unhandledComplaints: 0,
        });
        setRecentReachOutMessages(
          reachOutSnapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }))
        );

        if (!selectedCompanyId) return;

        const qAlerts = query(
          collection(db, 'companies', selectedCompanyId, 'alerts'),
          limit(4)
        );
        const alertSnap = await getDocs(qAlerts);
        const nextAlerts = [];
        alertSnap.forEach((d) => {
          const a = d.data();
          nextAlerts.push({ id: a.id || d.id, name: a.name, description: a.description });
        });
        setAlertList(nextAlerts);

        const qCustomers = query(
          collection(db, 'companies', selectedCompanyId, 'customers'),
          orderBy('firstName'),
          where('active', '==', true)
        );
        setCustomerCount(await readCount(qCustomers));

        const qUsers = query(collection(db, 'companies', selectedCompanyId, 'companyUsers'));
        setTechCount(await readCount(qUsers));

        const qJobs = query(
          collection(db, 'companies', selectedCompanyId, 'workOrders'),
          where('billingStatus', 'not-in', ['Paid', 'Invoiced'])
        );
        setJobCount(await readCount(qJobs));
      } catch (error) {
        console.log(error);
      }
    })();
  }, [selectedCompanyId]);

  async function sendServiceReportOnFinish(e) {
    e.preventDefault();

    const functionName = httpsCallable(functions, 'sendServiceReportOnFinish');
    functionName({
      email: 'michaelespineli2000@gmail.com',
      customerName: 'Brett Murdock',
    })
      .then((result) => {
        console.log(result);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  const pageWrap = 'px-2 md:px-7 py-5 bg-slate-900 min-h-screen';
  const card =
    'bg-slate-950 text-slate-100 border border-slate-800/60 rounded-xl shadow-2xl';
  const subCard =
    'bg-slate-900/40 text-slate-100 border border-slate-800/60 rounded-xl';
  const statTitle = 'text-sm font-semibold text-slate-400';
  const statValue = 'text-3xl font-extrabold';
  const statHint = 'text-xs text-slate-500 mt-1';

  const developmentCards = [
    {
      title: 'Universal Equipment',
      value: developmentStats.universalEquipmentModels,
      label: 'equipment models',
      hint: `${formatCount(developmentStats.universalEquipmentTypes)} equipment types`,
      to: '/admin/universal-equipment',
      icon: FaTools,
      accent: ADMIN_YELLOW,
    },
    {
      title: 'App Launch',
      value: developmentStats.appLaunchEnabled ? 'Live' : 'Closed',
      label: developmentStats.appLaunchEnabled ? 'company creation open' : 'countdown mode',
      hint: developmentStats.appLaunchReleaseDate
        ? `Release ${formatDate(developmentStats.appLaunchReleaseDate)}`
        : 'No release date set',
      to: '/admin/feature-flags',
      icon: FaFlag,
      accent: developmentStats.appLaunchEnabled ? '#86efac' : '#fbbf24',
    },
    {
      title: 'Feature Flags',
      value: developmentStats.enabledFeatureFlags,
      label: 'enabled flags',
      hint: `${formatCount(developmentStats.featureFlags)} total flags`,
      to: '/admin/feature-flags',
      icon: FaFlag,
      accent: '#93c5fd',
    },
    {
      title: 'Production Feedback',
      value: developmentStats.newProductFeedback,
      label: 'new items',
      hint: `${formatCount(developmentStats.productFeedback)} total bug reports and feature requests`,
      to: '/admin/product-feedback',
      icon: MdOutlineFeedback,
      accent: '#86efac',
    },
    {
      title: 'Errors',
      value: developmentStats.newAppErrors,
      label: 'new app errors',
      hint: `${formatCount(developmentStats.appErrors)} total captured errors`,
      to: '/admin/errors',
      icon: FaExclamationTriangle,
      accent: '#fca5a5',
    },
  ];

  const communicationCards = [
    {
      title: 'Live Chat',
      value: communicationStats.liveChatThreads,
      label: 'chat threads',
      hint: `${formatCount(communicationStats.unreadMessageRecords)} unread message records`,
      to: '/admin/dashboard/chat-seller',
      icon: FaComments,
      accent: ADMIN_YELLOW,
      actionLabel: 'Open live chat',
    },
    {
      title: 'Reach Out Messages',
      value: communicationStats.newReachOutMessages,
      label: 'new messages',
      hint: `${formatCount(communicationStats.reachOutMessages)} total contact messages`,
      to: '/admin/reach-out-messages',
      icon: MdMarkEmailUnread,
      accent: '#93c5fd',
      actionLabel: 'Review messages',
    },
    {
      title: 'Complaints',
      value: communicationStats.unhandledComplaints,
      label: 'unhandled complaints',
      hint: 'Complaint counter placeholder',
      to: '/admin/dashboard/payment-request',
      icon: FaExclamationTriangle,
      accent: '#fed7aa',
      actionLabel: 'Open complaints',
    },
  ];

  const MetricCard = ({ title, value, label, hint, to, icon: Icon, accent, actionLabel }) => (
    <Link
      to={to}
      className="group block h-full rounded-lg border border-slate-800/60 bg-slate-900/40 p-4 transition hover:bg-slate-900/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-300">{title}</p>
          <p className="mt-3 text-3xl font-extrabold" style={{ color: accent }}>
            {typeof value === 'number' ? formatCount(value) : value}
          </p>
          <p className="mt-1 text-sm text-slate-400">{label}</p>
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 ring-1 ring-slate-800/80"
          style={{ color: accent }}
        >
          <Icon />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800/60 pt-3">
        <p className="min-w-0 text-xs text-slate-500">{hint}</p>
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-bold text-slate-300 group-hover:text-slate-100">
          {actionLabel || 'Open'}
          <FaExternalLinkAlt className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );

  return (
    <div className={pageWrap}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Admin Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            High-level system stats + selected company activity
          </p>
        </div>

        <Link
          to="/admin/subscriptions"
          className="px-4 py-2 rounded-md font-semibold bg-[#debf44] text-slate-950 hover:bg-[#debf44]/90 transition"
        >
          Manage Subscriptions
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={statTitle}>Companies Signed Up</div>
              <div className={statValue} style={{ color: ADMIN_YELLOW }}>
                {companyCount}
              </div>
              <div className={statHint}>Total companies in Firestore</div>
            </div>
            <div className="p-3 rounded-lg bg-[#debf44]/10 ring-1 ring-[#debf44]/30">
              <FaUsers style={{ color: ADMIN_YELLOW }} />
            </div>
          </div>
        </div>

        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={statTitle}>Active Companies</div>
              <div className={statValue}>{activeCompanyCount}</div>
              <div className={statHint}>where status == "active"</div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <FaUsers className="text-emerald-300" />
            </div>
          </div>
        </div>

        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={statTitle}>Unverified Companies</div>
              <div className={statValue}>{unverifiedCompanyCount}</div>
              <div className={statHint}>where verified == false</div>
            </div>
            <div className="p-3 rounded-lg bg-orange-500/10 ring-1 ring-orange-500/20">
              <FaUsers className="text-orange-200" />
            </div>
          </div>
        </div>

        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={statTitle}>Subscription Plans</div>
              <div className={statValue}>{subscriptionCount}</div>
              <div className={statHint}>Total plans configured</div>
            </div>
            <div className="p-3 rounded-lg bg-[#debf44]/10 ring-1 ring-[#debf44]/30">
              <MdCurrencyExchange style={{ color: ADMIN_YELLOW }} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${subCard} p-4`}>
          <div className={statTitle}>Active Customers (Selected Company)</div>
          <div className="text-2xl font-extrabold" style={{ color: ADMIN_YELLOW }}>
            {customerCount}
          </div>
        </div>
        <div className={`${subCard} p-4`}>
          <div className={statTitle}>Company Users</div>
          <div className="text-2xl font-extrabold text-slate-100">{techCount}</div>
        </div>
        <div className={`${subCard} p-4`}>
          <div className={statTitle}>Open Billing Jobs</div>
          <div className="text-2xl font-extrabold text-orange-200">{jobCount}</div>
        </div>
        <div className={`${subCard} p-4`}>
          <div className={statTitle}>Total Sales (placeholder)</div>
          <div className="text-2xl font-extrabold text-emerald-300">
            ${totalSales.toLocaleString()}
          </div>
        </div>
      </div>

      <div className={`${card} p-4 mt-6`}>
        <div className="flex justify-between items-center pb-3 font-bold">
          <h2 className="text-xl font-extrabold" style={{ color: ADMIN_YELLOW }}>
            Alerts
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => sendServiceReportOnFinish(e)}
              className="px-3 py-2 rounded-md bg-[#debf44]/10 text-[#debf44] ring-1 ring-[#debf44]/30 hover:bg-[#debf44]/15 transition"
            >
              Tester Function
            </button>
            <Link to="/company/alerts" className="font-semibold text-sm text-slate-300 hover:text-slate-100">
              View All
            </Link>
          </div>
        </div>

        <p className="text-sm text-slate-400">Display most important and recent alerts</p>

        <div className="mt-3 space-y-2">
          {alertList?.map((alert) => (
            <div key={alert.id} className="flex w-full">
              <Link
                to="/company/alerts"
                className="w-full rounded-md bg-slate-900/40 border border-slate-800/60 py-2 px-3 hover:bg-slate-900/60 transition"
              >
                <div className="flex justify-between items-center">
                  <p className="font-semibold" style={{ color: ADMIN_YELLOW }}>
                    {alert.name}
                  </p>
                  <span className="text-xs text-slate-500">Open</span>
                </div>
                {alert.description && <p className="text-sm text-slate-300 mt-1">{alert.description}</p>}
              </Link>
            </div>
          ))}

          {alertList?.length === 0 && (
            <div className="text-sm text-slate-500 mt-2">No alerts found.</div>
          )}
        </div>
      </div>

      <section className={`${card} p-4 mt-7`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-extrabold" style={{ color: ADMIN_YELLOW }}>
              Development Information
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Universal catalog, release switches, and production feedback.
            </p>
          </div>
          <Link
            to="/admin/documentation"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-slate-100"
          >
            Documentation
            <FaExternalLinkAlt className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
          {developmentCards.map((item) => (
            <MetricCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {communicationCards.map((item) => (
          <div key={item.title} className={`${card} p-4`}>
            <MetricCard {...item} />

            {item.title === 'Reach Out Messages' && (
              <div className="mt-4 rounded-lg border border-slate-800/60 bg-slate-900/30">
                <div className="flex items-center gap-2 border-b border-slate-800/60 px-3 py-2 text-sm font-bold text-slate-300">
                  <FaInbox className="text-slate-500" />
                  Recent reach outs
                </div>

                <div className="divide-y divide-slate-800/60">
                  {recentReachOutMessages.map((message) => (
                    <Link
                      key={message.id}
                      to="/admin/reach-out-messages"
                      className="block px-3 py-3 hover:bg-slate-900/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100">
                            {message.subject || message.name || 'Reach out message'}
                          </p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {message.email || message.audience || 'No contact detail'}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">
                          {formatDate(message.createdAt)}
                        </span>
                      </div>
                    </Link>
                  ))}

                  {recentReachOutMessages.length === 0 && (
                    <div className="px-3 py-4 text-sm text-slate-500">No reach out messages found.</div>
                  )}
                </div>
              </div>
            )}

            {item.title === 'Complaints' && (
              <div className="mt-4 rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-3">
                <p className="text-sm font-semibold text-orange-100">Unhandled complaint counter</p>
                <p className="mt-1 text-xs text-orange-100/70">
                  Placeholder count is ready for the complaints data source.
                </p>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
};

export default AdminDashboard;
