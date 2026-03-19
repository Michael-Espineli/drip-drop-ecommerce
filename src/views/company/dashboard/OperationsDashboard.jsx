
import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { 
    BriefcaseIcon, 
    WrenchScrewdriverIcon, 
    MapIcon, 
    DocumentTextIcon, 
    ArrowRightIcon
} from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';

const StatCard = ({ icon, title, value, linkTo }) => (
    <Link to={linkTo} className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200 hover:shadow-xl hover:border-blue-500 transition-all flex items-center justify-between">
        <div>
            <div className="w-12 h-12 flex items-center justify-center bg-gray-100 rounded-xl mb-4 text-blue-600">{icon}</div>
            <p className="text-3xl font-bold text-gray-800">{value}</p>
            <p className="text-gray-500 font-medium">{title}</p>
        </div>
        <ArrowRightIcon className="w-6 h-6 text-gray-400" />
    </Link>
);

const InfoListItem = ({ primary, secondary, date, linkTo }) => (
    <Link to={linkTo} className="block p-3 hover:bg-gray-50 rounded-lg">
        <div className="flex justify-between items-center">
            <div>
                <p className="font-semibold text-gray-800">{primary}</p>
                <p className="text-sm text-gray-500">{secondary}</p>
            </div>
            {date && <p className="text-sm text-gray-500 text-right">{date}</p>}
        </div>
    </Link>
);

const InfoSection = ({ title, children, viewAllLink }) => (
    <div className="bg-white p-6 rounded-2xl shadow-xl border border-gray-200">
        <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-100">
            <h3 className="text-xl font-bold text-gray-800">{title}</h3>
            <Link to={viewAllLink} className="text-sm font-semibold text-blue-600 hover:underline">View all</Link>
        </div>
        <div className="space-y-2">{children}</div>
    </div>
);

const OperationsDashboard = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [stats, setStats] = useState({ jobs: 0, repairs: 0, routes: 0, contracts: 0 });
    const [upcomingJobs, setUpcomingJobs] = useState([]);
    const [repairRequests, setRepairRequests] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const jobsRef = collection(db, 'companies', recentlySelectedCompany, 'jobs');
                const repairsRef = collection(db, 'companies', recentlySelectedCompany, 'repairRequests');
                const routesRef = collection(db, 'companies', recentlySelectedCompany, 'routes');
                const contractsRef = collection(db, 'companies', recentlySelectedCompany, 'contracts');

                const [jobsSnap, repairsSnap, routesSnap, contractsSnap, upcomingJobsSnap, repairRequestsSnap] = await Promise.all([
                    getDocs(query(jobsRef, where('status', '==', 'active'))),
                    getDocs(query(repairsRef, where('status', '==', 'pending'))),
                    getDocs(query(routesRef)),
                    getDocs(query(contractsRef, where('status', '==', 'active'))),
                    getDocs(query(jobsRef, where('status', '==', 'active'), orderBy('startDate'), limit(5))),
                    getDocs(query(repairsRef, where('status', '==', 'pending'), orderBy('requestDate', 'desc'), limit(5))),
                ]);

                setStats({
                    jobs: jobsSnap.size,
                    repairs: repairsSnap.size,
                    routes: routesSnap.size,
                    contracts: contractsSnap.size,
                });

                setUpcomingJobs(upcomingJobsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setRepairRequests(repairRequestsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            } catch (error) {
                console.error("Error fetching dashboard data: ", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [recentlySelectedCompany]);

    if (isLoading) {
        return <div className="p-10 text-center">Loading Dashboard...</div>;
    }

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800">Operations Dashboard</h1>
                    <p className="text-gray-600 mt-1">A real-time overview of your company's activities.</p>
                </header>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard icon={<BriefcaseIcon className='w-6 h-6' />} title="Active Jobs" value={stats.jobs} linkTo="/company/jobs" />
                    <StatCard icon={<WrenchScrewdriverIcon className='w-6 h-6' />} title="Pending Repairs" value={stats.repairs} linkTo="/company/repair-requests" />
                    <StatCard icon={<MapIcon className='w-6 h-6' />} title="Today's Routes" value={stats.routes} linkTo="/company/route-dashboard" />
                    <StatCard icon={<DocumentTextIcon className='w-6 h-6' />} title="Equipment" value={stats.contracts} linkTo="/company/equipment" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <InfoSection title="Upcoming Jobs" viewAllLink="/company/jobs">
                        {upcomingJobs.length > 0 ? (
                            upcomingJobs.map(job => (
                                <InfoListItem 
                                    key={job.id} 
                                    primary={job.name}
                                    secondary={job.customerName}
                                    date={job.startDate?.toDate().toLocaleDateString()}
                                    linkTo={`/company/jobs/${job.id}`}
                                />
                            ))
                        ) : <p className='text-gray-500 p-3'>No upcoming jobs.</p>}
                    </InfoSection>
                    <InfoSection title="Recent Repair Requests" viewAllLink="/company/repairs">
                         {repairRequests.length > 0 ? (
                            repairRequests.map(req => (
                                <InfoListItem 
                                    key={req.id} 
                                    primary={req.issueDescription}
                                    secondary={req.customerName}
                                    date={req.requestDate?.toDate().toLocaleDateString()}
                                    linkTo={`/company/repairs/${req.id}`}
                                />
                            ))
                        ) : <p className='text-gray-500 p-3'>No pending repair requests.</p>}
                    </InfoSection>
                </div>
            </div>
        </div>
    );
};

export default OperationsDashboard;
