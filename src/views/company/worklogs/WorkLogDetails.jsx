
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const DetailItem = ({ label, value }) => (
    <div className="py-3 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="font-semibold text-gray-800 text-lg">{value || 'N/A'}</p>
    </div>
);

const WorkLogDetails = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { id: logId } = useParams();

    const [log, setLog] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!logId || !recentlySelectedCompany) return;

        const fetchLog = async () => {
            setIsLoading(true);
            try {
                const logRef = doc(db, 'companies', recentlySelectedCompany, 'workLogs', logId);
                const docSnap = await getDoc(logRef);
                if (docSnap.exists()) {
                    setLog({ id: docSnap.id, ...docSnap.data() });
                } else {
                    toast.error("Work log not found.");
                    navigate('/company/worklogs');
                }
            } catch (error) {
                console.error("Error fetching work log: ", error);
                toast.error("Failed to load work log details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchLog();
    }, [logId, recentlySelectedCompany, navigate]);

    if (isLoading) {
        return <div className="text-center p-10">Loading work log details...</div>;
    }

    if (!log) {
        return null; 
    }

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Work Log Details</h1>
                        <p className="text-gray-600 mt-1">Review the recorded hours and details for this entry.</p>
                    </div>
                    <button onClick={() => navigate('/company/worklogs')} className='mt-4 sm:mt-0 py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>
                        Back to Logs
                    </button>
                </header>

                <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                        <div className="space-y-4">
                            <DetailItem label="Employee Name" value={log.userName} />
                            <DetailItem label="Job/Task" value={log.jobName} />
                            <DetailItem label="Customer" value={log.customerName} />
                            <DetailItem label="Date" value={log.date ? format(log.date.toDate(), 'EEEE, MMMM do, yyyy') : 'N/A'} />
                        </div>
                        <div className="space-y-4">
                            <DetailItem label="Hours Worked" value={`${log.hoursWorked} hours`} />
                            <DetailItem label="Rate" value={`$${log.rate}/hour`} />
                            <DetailItem label="Total Pay" value={`$${(log.hoursWorked * log.rate).toFixed(2)}`} />
                            <DetailItem label="Status" value={log.status} />
                        </div>
                    </div>
                    <div className="mt-8 pt-6 border-t border-gray-200">
                         <h3 className="text-xl font-bold text-gray-800 mb-2">Notes</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{log.notes || 'No notes were provided for this entry.'}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WorkLogDetails;
