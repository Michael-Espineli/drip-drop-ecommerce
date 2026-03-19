import React, { useState, useContext, useEffect } from 'react';
import { FaShoppingCart, FaUsers } from 'react-icons/fa';
import { MdCurrencyExchange, MdConstruction } from 'react-icons/md';
import { Link } from 'react-router-dom';
import { query, collection, getDocs, limit, orderBy, getCountFromServer, where } from "firebase/firestore";
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import RecentChatsWidget from '../dashboard/components/RecentChatsWidget';

const Dashboard = () => {
    const { recentlySelectedCompany, user } = useContext(Context);

    const [customerCount, setCustomerCount] = useState(0);
    const [techCount, setTechCount] = useState(0);
    const [jobCount, setJobCount] = useState(0);
    const [totalSales, setTotalSales] = useState(0);
    const [workOrders, setWorkOrders] = useState([]);
    const [leads, setLeads] = useState([]);

    useEffect(() => {
        if (recentlySelectedCompany && user) {
            const getCounts = async () => {
                const customerCol = query(collection(db, "companies", recentlySelectedCompany, "customers"), where("active", "==", true));
                const customerSnapshot = await getCountFromServer(customerCol);
                setCustomerCount(customerSnapshot.data().count);

                const techCol = query(collection(db, "companies", recentlySelectedCompany, "companyUsers"), where("status", "==", "Active"));
                const techSnapshot = await getCountFromServer(techCol);
                setTechCount(techSnapshot.data().count);

                const jobCol = query(collection(db, "companies", recentlySelectedCompany, "workOrders"), where("operationStatus", "in", ["Estimate Pending", "Unscheduled", "Scheduled", "In Progress"]));
                const jobSnapshot = await getCountFromServer(jobCol);
                setJobCount(jobSnapshot.data().count);
            };

            const getWorkOrders = async () => {
                const jobsCol = collection(db, "companies", recentlySelectedCompany, "workOrders");
                const q = query(jobsCol, 
                    where("operationStatus", "in", ["Estimate Pending","Unscheduled", "Scheduled", "In Progress"]),
                    orderBy("internalId", "desc"),
                    limit(5));
                const querySnapshot = await getDocs(q);
                const orders = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setWorkOrders(orders);
            };
            
            const getLeads = async () => {
                const leadsCol = collection(db, "homeOwnerServiceRequests");
                const q = query(leadsCol, 
                    where("companyId", "==", recentlySelectedCompany),
                    where("status", "==", "Pending"),
                    orderBy("createdAt", "desc"),
                    limit(5));
                const querySnapshot = await getDocs(q);
                const leadsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setLeads(leadsData);
            };

            getCounts();
            getWorkOrders();
            getLeads();
        }
    }, [recentlySelectedCompany, user]);

    const stats = [
        { id: 1, name: 'Total Sales', stat: `$${totalSales.toFixed(2)}`, icon: MdCurrencyExchange, link: '/company/reports' },
        { id: 2, name: 'Active Customers', stat: customerCount, icon: FaUsers, link: '/company/customers'  },
        { id: 3, name: 'Technicians', stat: techCount, icon: FaUsers, link: '/company/companyUsers'  },
        { id: 4, name: 'Jobs', stat: jobCount, icon: MdConstruction, link: '/company/jobs'  },
    ]

    return (
        <div className="p-4 md:p-8">
            <h1 className="text-2xl font-bold mb-4">Company Dashboard</h1>
            <div>
                <h3 className="text-base font-semibold leading-6 text-gray-900">Last 30 days</h3>
                <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    {stats.map((item) => (
                        <div key={item.id} className="relative overflow-hidden rounded-lg bg-white px-4 pb-12 pt-5 shadow sm:px-6 sm:pt-6">
                            <dt>
                                <div className="absolute rounded-md bg-indigo-500 p-3">
                                    <item.icon className="h-6 w-6 text-white" aria-hidden="true" />
                                </div>
                                <p className="ml-16 truncate text-sm font-medium text-gray-500">{item.name}</p>
                            </dt>
                            <div className="ml-16 flex items-baseline pb-6 sm:pb-7">
                                <p className="text-2xl font-semibold text-gray-900">{item.stat}</p>
                                <div className="absolute inset-x-0 bottom-0 bg-gray-50 px-4 py-4 sm:px-6">
                                    <div className="text-sm">

                                        <Link to={item.link} className="font-medium text-indigo-600 hover:text-indigo-500">
                                            View all<span className="sr-only"> {item.name} stats</span>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </dl>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
                 <div className="lg:col-span-1">
                    <h2 className="text-xl font-bold mb-4">Recent Leads</h2>
                    <div className="bg-white rounded-lg shadow p-4">
                        {leads.length > 0 ? (
                            <ul className="divide-y divide-gray-200">
                                {leads.map((lead) => (
                                    <li key={lead.id} className="py-4">
                                        <Link to={`/company/leads/${lead.id}`} className="flex space-x-3">
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <h3 className="text-sm font-medium">{lead.serviceName || 'N/A'}</h3>
                                                    <p className="text-sm text-gray-500">{lead.createdAt?.toDate().toLocaleDateString()}</p>
                                                </div>
                                                <p className="text-sm text-gray-500">{lead.homeownerName}</p>
                                            </div>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>No recent leads.</p>
                        )}
                    </div>
                </div>
                <div className="lg:col-span-1">
                    <h2 className="text-xl font-bold mb-4">Current Work Orders</h2>
                    <div className="bg-white rounded-lg shadow p-4">
                        {workOrders.length > 0 ? (
                            <ul className="divide-y divide-gray-200">
                                {workOrders.map((order) => (
                                    <li key={order.id} className="py-4">
                                        <Link to={`/company/jobs/detail/${order.id}`} className="flex space-x-3">
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <h3 className="text-sm font-medium">{order.customerName || 'Unnamed Job'}</h3>
                                                    <p className="text-sm text-gray-500">{order.dateCreated?.toDate().toLocaleDateString()}</p>
                                                </div>
                                                <p className="text-sm text-gray-500">{order.operationStatus}•{order.billingStatus}</p>
                                            </div>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>No current work orders.</p>
                        )}
                    </div>
                </div>
                <div className="lg:col-span-1">
                    <h2 className="text-xl font-bold mb-4">Recent Seller Messages</h2>
                    <RecentChatsWidget />
                </div>
            </div>
        </div>
    )
}

export default Dashboard;
