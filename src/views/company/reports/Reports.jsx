
import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { format, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

const ReportControlCard = ({ reportType, setReportType, dateRange, setDateRange, onGenerate }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Generate Report</h3>
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
                <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="w-full p-2 bg-gray-100 border-2 border-gray-200 rounded-lg">
                    <option value="pnl">Profit & Loss</option>
                    <option value="expense_category">Expense by Category</option>
                </select>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
                <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="p-2 bg-gray-100 border-2 border-gray-200 rounded-lg"/>
                    <input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="p-2 bg-gray-100 border-2 border-gray-200 rounded-lg"/>
                </div>
            </div>
            <button onClick={onGenerate} className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition">Generate</button>
        </div>
    </div>
);

const ReportView = ({ data, reportType, isLoading }) => {
    if (isLoading) return <div className="text-center p-10">Generating report...</div>;
    if (!data) return <div className="text-center p-10 text-gray-500">Select a report type and date range to begin.</div>;

    // Simple P&L example
    if (reportType === 'pnl') {
        const totalRevenue = data.revenue.reduce((acc, item) => acc + item.total, 0);
        const totalExpense = data.expenses.reduce((acc, item) => acc + item.total, 0);
        const net = totalRevenue - totalExpense;

        return (
            <div className="bg-white p-6 rounded-2xl shadow-lg border">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Profit & Loss Summary</h2>
                <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="p-4 bg-green-100 rounded-lg"><p className="text-lg font-semibold text-green-800">Total Revenue</p><p className="text-2xl font-bold">${totalRevenue.toFixed(2)}</p></div>
                    <div className="p-4 bg-red-100 rounded-lg"><p className="text-lg font-semibold text-red-800">Total Expenses</p><p className="text-2xl font-bold">${totalExpense.toFixed(2)}</p></div>
                    <div className="p-4 bg-blue-100 rounded-lg"><p className="text-lg font-semibold text-blue-800">Net Profit</p><p className="text-2xl font-bold">${net.toFixed(2)}</p></div>
                </div>
            </div>
        );
    }
    
    // Add more report type views here
    return <div className="text-center p-10 text-gray-500">Report view for the selected type is not yet implemented.</div>;
};


const Reports = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [reportType, setReportType] = useState('pnl');
    const [dateRange, setDateRange] = useState({ 
        start: format(startOfMonth(new Date()), 'yyyy-MM-dd'), 
        end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
    });
    const [reportData, setReportData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerateReport = async () => {
        if (!recentlySelectedCompany || !reportType) {
            toast.error("Please select a company and report type.");
            return;
        }

        setIsLoading(true);
        const toastId = toast.loading('Generating report data...');

        try {
            const startDate = new Date(dateRange.start);
            const endDate = new Date(dateRange.end);
            
            // Example for P&L: Fetch revenue (e.g., from invoices) and expenses
            if (reportType === 'pnl') {
                const revenueRef = collection(db, 'companies', recentlySelectedCompany, 'invoices');
                const expenseRef = collection(db, 'companies', recentlySelectedCompany, 'purchasedItems');
                
                const revenueQuery = query(revenueRef, where("date", ">=", startDate), where("date", "<=", endDate));
                const expenseQuery = query(expenseRef, where("date", ">=", startDate), where("date", "<=", endDate));

                const [revenueSnap, expenseSnap] = await Promise.all([getDocs(revenueQuery), getDocs(expenseQuery)]);

                const revenue = revenueSnap.docs.map(doc => doc.data());
                const expenses = expenseSnap.docs.map(doc => doc.data());

                setReportData({ revenue, expenses });
            }

            toast.success('Report generated!', { id: toastId });
        } catch (error) {
            console.error("Error generating report: ", error);
            toast.error(`Report generation failed: ${error.message}`, { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800">Financial Reports</h1>
                    <p className="text-gray-600 mt-1">Analyze your company’s performance over time.</p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1">
                        <ReportControlCard 
                            reportType={reportType} 
                            setReportType={setReportType}
                            dateRange={dateRange}
                            setDateRange={setDateRange}
                            onGenerate={handleGenerateReport}
                        />
                    </div>
                    <div className="lg:col-span-2">
                       <ReportView data={reportData} reportType={reportType} isLoading={isLoading} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Reports;
