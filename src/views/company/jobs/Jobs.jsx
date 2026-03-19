
import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, orderBy, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { Job } from "../../../utils/models/Job";
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const Jobs = () => {
    const [jobs, setJobs] = useState([]);
    const { recentlySelectedCompany } = useContext(Context);
    const [searchTerm, setSearchTerm] = useState('');
    const [showFilterModal, setShowFilterModal] = useState(false);
    const navigate = useNavigate();

    // Filter and Sort States
    const [operationStatusFilter, setOperationStatusFilter] = useState(["Estimate Pending", "Unscheduled", "Scheduled", "In Progress"]);
    const [billingStatusFilter, setBillingStatusFilter] = useState(["Draft", "Estimate", "Accepted", "In Progress"]);
    const [sortBy, setSortBy] = useState('dateCreated-desc');

    const operationStatusOptions = ["Estimate Pending", "Unscheduled", "Scheduled", "In Progress", "Finished"];
    const billingStatusOptions = ["Draft", "Estimate", "Accepted", "In Progress", "Invoiced", "Paid"];

    useEffect(() => {
        const fetchJobs = async () => {
            if (!recentlySelectedCompany) return;
            
            try {
                let q = collection(db, 'companies', recentlySelectedCompany, 'workOrders');
                let queries = [];

                if (operationStatusFilter.length > 0) {
                    queries.push(where('operationStatus', 'in', operationStatusFilter));
                }
                if (billingStatusFilter.length > 0) {
                    queries.push(where('billingStatus', 'in', billingStatusFilter));
                }

                const [sortField, sortDirection] = sortBy.split('-');
                queries.push(orderBy(sortField, sortDirection));

                q = query(q, ...queries);

                const querySnapshot = await getDocs(q);
                const jobsList = querySnapshot.docs.map(doc => Job.fromFirestore(doc));
                
                const filteredJobs = jobsList.filter(job =>
                    job.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    job.internalId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    job.description.toLowerCase().includes(searchTerm.toLowerCase())
                );

                setJobs(filteredJobs);
            } catch (error) {
                console.error("Error fetching jobs: ", error);
            }
        };

        fetchJobs();
    }, [recentlySelectedCompany, searchTerm, operationStatusFilter, billingStatusFilter, sortBy]);

    const handleApplyFilters = (newOperationFilters, newBillingFilters) => {
        setOperationStatusFilter(newOperationFilters);
        setBillingStatusFilter(newBillingFilters);
        setShowFilterModal(false);
    };
    
    const getStatusClass = (status) => {
        switch (status) {
            case "Draft":
            case "Estimate Pending":
            case "Unscheduled":
              return "bg-red-100 text-red-800";
            case "Estimate":
            case "In Progress":
              return "bg-yellow-100 text-yellow-800";
            case "Accepted":
            case "Scheduled":
            case "Finished":
            case "Paid":
              return "bg-green-100 text-green-800";
            case "Invoiced":
              return "bg-blue-100 text-blue-800";
            default:
              return "bg-gray-100 text-gray-800";
        }
    };

    const FilterModal = ({ onClose, applyFilters }) => {
        const [tempOperationFilters, setTempOperationFilters] = useState(operationStatusFilter);
        const [tempBillingFilters, setTempBillingFilters] = useState(billingStatusFilter);
    
        const handleOperationChange = (status) => {
            setTempOperationFilters(prev => 
                prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
            );
        };
    
        const handleBillingChange = (status) => {
            setTempBillingFilters(prev => 
                prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
            );
        };

        return (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
                <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-lg">
                    <h3 className="text-2xl font-bold mb-6 text-gray-800">Filter & Sort</h3>
                    <div className="space-y-6">
                        <div>
                            <label className="block mb-2 font-semibold text-gray-700">Sort by Date</label>
                            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500">
                                <option value="dateCreated-desc">Newest First</option>
                                <option value="dateCreated-asc">Oldest First</option>
                            </select>
                        </div>
                        <div>
                            <label className="block mb-3 font-semibold text-gray-700">Operational Status</label>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {operationStatusOptions.map(status => (
                                    <label key={status} className="flex items-center space-x-3 cursor-pointer">
                                        <input type="checkbox" checked={tempOperationFilters.includes(status)} onChange={() => handleOperationChange(status)} className="form-checkbox h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                                        <span className="text-gray-700">{status}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block mb-3 font-semibold text-gray-700">Billing Status</label>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {billingStatusOptions.map(status => (
                                    <label key={status} className="flex items-center space-x-3 cursor-pointer">
                                        <input type="checkbox" checked={tempBillingFilters.includes(status)} onChange={() => handleBillingChange(status)} className="form-checkbox h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                                        <span className="text-gray-700">{status}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end space-x-4 mt-8">
                        <button onClick={onClose} className="py-2 px-6 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition">Cancel</button>
                        <button onClick={() => applyFilters(tempOperationFilters, tempBillingFilters)} className="py-2 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">Apply</button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'> 
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-3xl font-bold text-gray-800">Jobs</h2>
                    <Link to={'/company/jobs/createNew'} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition'>
                        Create New Job
                    </Link>
                </div>

                <div className="bg-white shadow-lg rounded-xl p-6">
                    <div className='flex flex-col sm:flex-row justify-between items-center mb-4 gap-4'>
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full sm:w-2/5 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            type="text"
                            placeholder="Search by customer, ID, or description..."
                        />
                        <button onClick={() => setShowFilterModal(true)} className="w-full sm:w-auto py-3 px-5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition">
                            Filter & Sort
                        </button>
                    </div>

                    <div className='overflow-x-auto'>
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Id</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Date Created</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Customer</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Type</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Billing Status</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Operation Status</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden sm:table-cell'>Rate</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Description</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {jobs.map(job => (
                                    <tr key={job.id} className="hover:bg-gray-50 transition-colors"
                                    onClick={() => navigate(`/company/jobs/detail/${job.id}`)} >
                                        <td className='p-4 whitespace-nowrap'>{job.internalId}</td>
                                        <td className='p-4 whitespace-nowrap text-gray-700'>{job.dateCreated ? format(job.dateCreated, 'MM/dd/yyyy') : 'N/A'}</td>
                                        <td className='p-4 whitespace-nowrap text-gray-800 font-medium'>{job.customerName}</td>
                                        <td className='p-4 whitespace-nowrap text-gray-700'>{job.type}</td>
                                        <td className='p-4 whitespace-nowrap'>
                                            <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(job.billingStatus)}`}>
                                                {job.billingStatus}
                                            </span>
                                        </td>
                                        <td className='p-4 whitespace-nowrap'>
                                            <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(job.operationStatus)}`}>
                                                {job.operationStatus}
                                            </span>
                                        </td>
                                        <td className='p-4 whitespace-nowrap text-gray-800 hidden sm:table-cell'>${Number(job.rate/100 || 0).toFixed(2)}</td>
                                        <td className='p-4 whitespace-nowrap max-w-xs truncate text-gray-700' title={job.description}>{job.description}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {showFilterModal && <FilterModal onClose={() => setShowFilterModal(false)} applyFilters={handleApplyFilters} />}
        </div>
    );
}

export default Jobs;
