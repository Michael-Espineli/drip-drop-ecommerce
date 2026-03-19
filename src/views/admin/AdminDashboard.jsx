import React, { useState, useContext, useEffect } from 'react';
import { FaUsers } from 'react-icons/fa';
import { MdProductionQuantityLimits, MdCurrencyExchange } from 'react-icons/md';
import Chart from 'react-apexcharts';
import { Link } from 'react-router-dom';
import {
  query,
  collection,
  getDocs,
  limit,
  orderBy,
  getCountFromServer,
  where,
} from 'firebase/firestore';
import { db } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

const AdminDashboard = () => {
  const ADMIN_YELLOW = '#debf44';

  const { recentlySelectedCompany, user } = useContext(Context);

  const [alertList, setAlertList] = useState([]);

  const [customerCount, setCustomerCount] = useState(0);
  const [techCount, setTechCount] = useState(0);
  const [jobCount, setJobCount] = useState(0);
  const [totalSales, setTotalSales] = useState(32232.78);

  // NEW: global/admin stats
  const [companyCount, setCompanyCount] = useState(0);
  const [activeCompanyCount, setActiveCompanyCount] = useState(0);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [unverifiedCompanyCount, setUnverifiedCompanyCount] = useState(0);

  const state = {
    series: [
      { name: 'Orders', data: [23, 34, 45, 56, 78, 34, 54, 18, 84, 52, 54, 51] },
      { name: 'Revenue', data: [23, 34, 45, 56, 78, 34, 54, 18, 84, 52, 54, 51] },
      { name: 'Sellers', data: [23, 34, 45, 56, 78, 34, 54, 18, 84, 52, 54, 51] },
    ],
    options: {
      color: ['#181ee8', '#181ee8'],
      plotOptions: { radius: 30 },
      chart: { background: 'transparent', foreColor: '#d0d2d6' },
      dataLabels: { enabled: false },
      strock: {
        show: true,
        curve: ['smooth', 'straight', 'stepline'],
        lineCap: 'butt',
        width: 0.5,
        dashAraray: 0,
      },
      xaxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] },
      legend: { position: 'top' },
      responsive: [
        {
          breakpoint: 565,
          yaxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] },
          options: {
            plotOptions: { bar: { horizontal: true } },
            chart: { height: '550px' },
          },
        },
      ],
    },
  };

  useEffect(() => {
    (async () => {
      try {
        // --- TOP STATS (global admin) ---
        const companiesAll = await getCountFromServer(query(collection(db, 'companies')));
        setCompanyCount(companiesAll.data().count);

        // Adjust these fields if your schema differs
        const companiesActive = await getCountFromServer(
          query(collection(db, 'companies'), where('status', '==', 'active'))
        );
        setActiveCompanyCount(companiesActive.data().count);

        const companiesUnverified = await getCountFromServer(
          query(collection(db, 'companies'), where('verified', '==', false))
        );
        setUnverifiedCompanyCount(companiesUnverified.data().count);

        const subsAll = await getCountFromServer(query(collection(db, 'subscriptions')));
        setSubscriptionCount(subsAll.data().count);

        // --- COMPANY-SCOPED sections (requires selected company) ---
        if (!recentlySelectedCompany) return;

        // alerts
        const qAlerts = query(
          collection(db, 'companies', recentlySelectedCompany, 'alerts'),
          limit(4)
        );
        const alertSnap = await getDocs(qAlerts);
        const nextAlerts = [];
        alertSnap.forEach((d) => {
          const a = d.data();
          nextAlerts.push({ id: a.id, name: a.name, description: a.description });
        });
        setAlertList(nextAlerts);

        // customers
        const qCustomers = query(
          collection(db, 'companies', recentlySelectedCompany, 'customers'),
          orderBy('firstName'),
          where('active', '==', true)
        );
        const customersCountSnap = await getCountFromServer(qCustomers);
        setCustomerCount(customersCountSnap.data().count);

        // users
        const qUsers = query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'));
        const usersCountSnap = await getCountFromServer(qUsers);
        setTechCount(usersCountSnap.data().count);

        // jobs (unpaid/uninvoiced)
        const qJobs = query(
          collection(db, 'companies', recentlySelectedCompany, 'jobs'),
          where('billingStatus', 'not-in', ['Paid', 'Invoiced'])
        );
        const jobsCountSnap = await getCountFromServer(qJobs);
        setJobCount(jobsCountSnap.data().count);
      } catch (error) {
        console.log(error);
      }
    })();
  }, [recentlySelectedCompany]);

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

  // --- Theme helpers ---
  const pageWrap = 'px-2 md:px-7 py-5 bg-slate-900 min-h-screen';
  const card =
    'bg-slate-950 text-slate-100 border border-slate-800/60 rounded-xl shadow-2xl';
  const subCard =
    'bg-slate-900/40 text-slate-100 border border-slate-800/60 rounded-xl';
  const statTitle = 'text-sm font-semibold text-slate-400';
  const statValue = 'text-3xl font-extrabold';
  const statHint = 'text-xs text-slate-500 mt-1';

  return (
    <div className={pageWrap}>
      {/* Top Header */}
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
          className={`px-4 py-2 rounded-md font-semibold bg-[${ADMIN_YELLOW}] text-slate-950 hover:bg-[${ADMIN_YELLOW}]/90 transition`}
        >
          Manage Subscriptions
        </Link>
      </div>

      {/* NEW: Top Stat Cards */}
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
            <div className={`p-3 rounded-lg bg-[${ADMIN_YELLOW}]/10 ring-1 ring-[${ADMIN_YELLOW}]/30`}>
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
            <div className={`p-3 rounded-lg bg-[${ADMIN_YELLOW}]/10 ring-1 ring-[${ADMIN_YELLOW}]/30`}>
              <MdCurrencyExchange style={{ color: ADMIN_YELLOW }} />
            </div>
          </div>
        </div>
      </div>

      {/* Company-scoped quick stats (optional) */}
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

      {/* Alerts Section */}
      <div className={`${card} p-4 mt-6`}>
        <div className="flex justify-between items-center pb-3 font-bold">
          <h2 className="text-xl font-extrabold" style={{ color: ADMIN_YELLOW }}>
            Alerts
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => sendServiceReportOnFinish(e)}
              className={`px-3 py-2 rounded-md bg-[${ADMIN_YELLOW}]/10 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/30 hover:bg-[${ADMIN_YELLOW}]/15 transition`}
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
                className={`w-full rounded-md bg-slate-900/40 border border-slate-800/60 py-2 px-3 hover:bg-slate-900/60 transition`}
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

      {/* Second Section */}
      <div className="w-full flex flex-wrap mt-7">
        {/* Chart */}
        <div className="w-full lg:w-7/12 lg:pr-3">
          <div className={`${card} p-4`}>
            <Chart options={state.options} series={state.series} type="bar" height={350} />
          </div>
        </div>

        {/* Recent Seller Message */}
        <div className="w-full lg:w-5/12 lg:pl-4 mt-6 lg:mt-0">
          <div className={`${card} p-4`}>
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-lg text-slate-100">Customer Message</h2>
              <Link to="/company/messages" className="font-semibold text-sm text-slate-300 hover:text-slate-100">
                See All
              </Link>
            </div>

            <div className="flex flex-col gap-2 pt-6 text-slate-200">
              <ol className="relative border-1 border-slate-800/60 ml-4">
                {[1, 2, 3].map((i) => (
                  <li key={i} className="mb-3 ml-6">
                    <div
                      className={`flex absolute -left-5 shadow-lg justify-center items-center w-10 h-10 p-[6px]
                        rounded-full z-10 bg-[${ADMIN_YELLOW}]/15 ring-1 ring-[${ADMIN_YELLOW}]/30`}
                    >
                      <div className="w-6 h-6 rounded-full bg-slate-800" />
                    </div>

                    <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800/60 shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-md font-normal" style={{ color: ADMIN_YELLOW }}>
                          Admin
                        </span>
                        <time className="mb-1 text-sm font-normal sm:order-last sm:mb-0 text-slate-400">
                          2 days ago
                        </time>
                      </div>
                      <div className="p-2 text-xs font-normal bg-slate-900/70 rounded-lg border border-slate-800/60">
                        How are you?
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className={`${card} p-4 mt-6`}>
        <div className="flex justify-between items-center pb-3 font-bold">
          <h2 className="text-xl font-extrabold" style={{ color: ADMIN_YELLOW }}>
            Recent Orders
          </h2>
          <Link className="font-semibold text-sm text-slate-300 hover:text-slate-100">
            View All
          </Link>
        </div>

        <div className="relative overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="w-full text-sm text-left text-slate-200">
            <thead className="text-sm uppercase bg-slate-900/70 border-b border-slate-800/60">
              <tr>
                <th scope="col" className="py-3 px-4">
                  Order Id
                </th>
                <th scope="col" className="py-3 px-4">
                  Price
                </th>
                <th scope="col" className="py-3 px-4">
                  Payment Status
                </th>
                <th scope="col" className="py-3 px-4">
                  Order Status
                </th>
                <th scope="col" className="py-3 px-4">
                  Active
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {[1, 2, 3, 4, 5].map((d) => (
                <tr key={d} className="hover:bg-slate-900/60 transition">
                  <td className="py-3 px-4 font-medium whitespace-nowrap">#123456</td>
                  <td className="py-3 px-4 font-medium whitespace-nowrap">$454</td>
                  <td className="py-3 px-4 font-medium whitespace-nowrap">Pending</td>
                  <td className="py-3 px-4 font-medium whitespace-nowrap">Pending</td>
                  <td className="py-3 px-4 font-medium whitespace-nowrap">
                    <Link className={`text-[${ADMIN_YELLOW}] hover:opacity-90`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
