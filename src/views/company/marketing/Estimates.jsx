import React, { useState, useContext, useEffect } from 'react';
import { query, collection, getDocs, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Link } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';

const SectionCard = ({ title, children, rightContent }) => (
    <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
            {rightContent}
        </div>
        {children}
    </div>
);

const EmptyState = ({ text }) => (
    <div className="py-8 text-center text-gray-500 text-sm">
        {text}
    </div>
);

const ContractTable = ({ contracts, emptyText = 'No contracts found in this section.' }) => {
    if (!contracts?.length) {
        return <EmptyState text={emptyText} />;
    }

    return (
        <div className="relative overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Company Name</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Amount</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Status</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Type</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {contracts.map((contract) => (
                        <tr key={contract.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 border-b text-sm text-gray-800">
                                {contract.companyName || contract.receiverName || 'N/A'}
                            </td>
                            <td className="px-4 py-3 border-b text-sm text-gray-800">
                                ${Number((contract.rate || 0) / 100).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 border-b text-sm text-gray-800">
                                {contract.status || 'N/A'}
                            </td>
                            <td className="px-4 py-3 border-b text-sm text-gray-800">
                                {contract.contractType || 'N/A'}
                            </td>
                            <td className="px-4 py-3 border-b">
                                <Link
                                    className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                                    to={`/company/contracts/contract/${contract.id}`}
                                >
                                    View Details
                                </Link>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

function Estimates() {
    const { recentlySelectedCompany } = useContext(Context);

    const [pendingRecurringContracts, setPendingRecurringContracts] = useState([]);
    const [pendingOneTimeContracts, setPendingOneTimeContracts] = useState([]);
    const [allEstimates, setAllEstimates] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);

                const recurringPendingQuery = query(
                    collection(db, 'contracts'),
                    where('status', '==', 'Pending'),
                    where('senderId', '==', recentlySelectedCompany)
                );

                const recurringPendingSnapshot = await getDocs(recurringPendingQuery);
                const recurringPending = recurringPendingSnapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        companyName: data.companyName,
                        rate: data.rate,
                        status: data.status,
                        contractType: 'Recurring',
                        ...data,
                    };
                });

                const oneTimePendingQuery = query(
                    collection(db, 'contracts'),
                    where('status', '==', 'Draft'),
                    where('senderId', '==', recentlySelectedCompany)
                );

                const oneTimePendingSnapshot = await getDocs(oneTimePendingQuery);
                const oneTimePending = oneTimePendingSnapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        companyName: data.companyName,
                        rate: data.rate,
                        status: data.status,
                        contractType: 'One Time',
                        ...data,
                    };
                });

                setPendingRecurringContracts(recurringPending);
                setPendingOneTimeContracts(oneTimePending);
                setAllEstimates([...recurringPending, ...oneTimePending]);
            } catch (error) {
                console.error('Error loading estimates:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [recentlySelectedCompany]);

    if (loading) {
        return (
            <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-7xl">
                    <div className="bg-white shadow-lg rounded-2xl p-6">
                        <p className="text-gray-600">Loading estimates...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="mx-auto">
                <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <Link
                                to="/company/contracts"
                                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                &larr; Back to Contracts
                            </Link>
                            <h1 className="text-3xl font-bold text-gray-900">Estimates</h1>
                            <p className="text-gray-500 mt-1">
                                Review pending recurring and one-time contracts in one place.
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <Link
                                to="/company/contracts/createNew/NA"
                                className="px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-xl shadow-sm hover:bg-yellow-100 transition"
                            >
                                Send New Contract
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-white shadow-lg rounded-2xl p-5">
                        <p className="text-sm text-gray-500">Recurring Pending</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{pendingRecurringContracts.length}</p>
                    </div>
                    <div className="bg-white shadow-lg rounded-2xl p-5">
                        <p className="text-sm text-gray-500">One-Time Pending</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{pendingOneTimeContracts.length}</p>
                    </div>
                    <div className="bg-white shadow-lg rounded-2xl p-5">
                        <p className="text-sm text-gray-500">Total Estimates</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{allEstimates.length}</p>
                    </div>
                </div>

                <SectionCard title="All Estimates">
                    <ContractTable
                        contracts={allEstimates}
                        emptyText="No pending recurring or one-time contracts found."
                    />
                </SectionCard>

                <SectionCard title="Pending Recurring Contracts">
                    <ContractTable
                        contracts={pendingRecurringContracts}
                        emptyText="No pending recurring contracts found."
                    />
                </SectionCard>

                <SectionCard title="Pending One-Time Contracts">
                    <ContractTable
                        contracts={pendingOneTimeContracts}
                        emptyText="No pending one-time contracts found."
                    />
                </SectionCard>
            </div>
        </div>
    );
}

export default Estimates;


// import React, { useState, useEffect, useContext } from 'react';
// import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';
// import { Link } from 'react-router-dom';
// import { Context } from '../../../context/AuthContext';
// import { ClipLoader } from 'react-spinners';
// import { format } from 'date-fns';

// const Estimates = () => {
//     const { recentlySelectedCompany } = useContext(Context);
//     const db = getFirestore();
//     const [estimates, setEstimates] = useState([]);
//     const [loading, setLoading] = useState(true);

//     useEffect(() => {
//         if (!recentlySelectedCompany) {
//             setLoading(false);
//             return;
//         }

//         setLoading(true);
//         const contractsRef = collection(db, 'contracts');
//         const q = query(contractsRef,
//             where('senderId', '==', recentlySelectedCompany),
//             where('status', '==', 'Pending') // Changed to only query for 'Pending'
//         );

//         const unsubscribe = onSnapshot(q, (querySnapshot) => {
//             const estimatesData = querySnapshot.docs.map(doc => ({
//                 id: doc.id,
//                 ...doc.data(),
//             }));

//             setEstimates(estimatesData);
//             setLoading(false);
//         }, (error) => {
//             console.error("Error fetching estimates:", error);
//             setLoading(false);
//         });

//         return () => unsubscribe();
//     }, [recentlySelectedCompany, db]);

//     if (loading) {
//         return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;
//     }

//     return (
//         <div className="container mx-auto p-6">
//             <div className="flex justify-between items-center mb-6">
//                 <h1 className="text-3xl font-bold">Estimates</h1>
//                 <Link to="/company/recurring-contracts/create" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
//                     Create Estimate
//                 </Link>
//             </div>

//             {estimates.length === 0 ? (
//                 <div className="text-center p-12 bg-white shadow-md rounded-lg">
//                     <h2 className="text-xl font-semibold">No Pending Estimates</h2>
//                     <p className="text-gray-500 mt-2">When you create new estimates, they will appear here.</p>
//                 </div>
//             ) : (
//                 <div className="bg-white shadow-md rounded-lg overflow-hidden">
//                     <table className="min-w-full leading-normal">
//                         <thead>
//                             <tr>
//                                 <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
//                                     Customer
//                                 </th>
//                                 <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
//                                     Amount
//                                 </th>
//                                 <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
//                                     Status
//                                 </th>
//                                 <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
//                                     Date Created
//                                 </th>
//                                 <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100"></th>
//                             </tr>
//                         </thead>
//                         <tbody>
//                             {estimates.map(estimate => (
//                                 <tr key={estimate.id}>
//                                     <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
//                                         <p className="text-gray-900 whitespace-no-wrap">{estimate.customerName || 'N/A'}</p>
//                                     </td>
//                                     <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
//                                         <p className="text-gray-900 whitespace-no-wrap">${estimate.total ? estimate.total.toLocaleString() : '0.00'}</p>
//                                     </td>
//                                     <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
//                                         <span className={'relative inline-block px-3 py-1 font-semibold text-yellow-900 leading-tight'}>
//                                             <span aria-hidden className={'absolute inset-0 bg-yellow-200 opacity-50 rounded-full'}></span>
//                                             <span className="relative">{estimate.status}</span>
//                                         </span>
//                                     </td>
//                                     <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
//                                         <p className="text-gray-900 whitespace-no-wrap">
//                                             {estimate.createdAt ? format(estimate.createdAt.toDate(), 'PPP') : 'N/A'}
//                                         </p>
//                                     </td>
//                                     <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm text-right">
//                                         <Link to={`/company/contract/detail/${estimate.id}`} className="text-blue-600 hover:underline">
//                                             View Details
//                                         </Link>
//                                     </td>
//                                 </tr>
//                             ))}
//                         </tbody>
//                     </table>
//                 </div>
//             )}
//         </div>
//     );
// };

// export default Estimates;
