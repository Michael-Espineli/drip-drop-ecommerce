import React, { useState, useEffect, useContext } from 'react';
import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import { ClipLoader } from 'react-spinners';
import { format } from 'date-fns';

const Estimates = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();
    const [estimates, setEstimates] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const contractsRef = collection(db, 'contracts');
        const q = query(contractsRef, 
            where('senderId', '==', recentlySelectedCompany),
            where('status', '==', 'Pending') // Changed to only query for 'Pending'
        );

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const estimatesData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));
            
            setEstimates(estimatesData);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching estimates:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [recentlySelectedCompany, db]);

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;
    }

    return (
        <div className="container mx-auto p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Estimates</h1>
                <Link to="/company/estimates/create" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
                    Create Estimate
                </Link>
            </div>

            {estimates.length === 0 ? (
                <div className="text-center p-12 bg-white shadow-md rounded-lg">
                    <h2 className="text-xl font-semibold">No Pending Estimates</h2>
                    <p className="text-gray-500 mt-2">When you create new estimates, they will appear here.</p>
                </div>
            ) : (
                <div className="bg-white shadow-md rounded-lg overflow-hidden">
                    <table className="min-w-full leading-normal">
                        <thead>
                            <tr>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Customer
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Amount
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Date Created
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {estimates.map(estimate => (
                                <tr key={estimate.id}>
                                    <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                        <p className="text-gray-900 whitespace-no-wrap">{estimate.customerName || 'N/A'}</p>
                                    </td>
                                    <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                        <p className="text-gray-900 whitespace-no-wrap">${estimate.total ? estimate.total.toLocaleString() : '0.00'}</p>
                                    </td>
                                    <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                        <span className={'relative inline-block px-3 py-1 font-semibold text-yellow-900 leading-tight'}>
                                            <span aria-hidden className={'absolute inset-0 bg-yellow-200 opacity-50 rounded-full'}></span>
                                            <span className="relative">{estimate.status}</span>
                                        </span>
                                    </td>
                                    <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                        <p className="text-gray-900 whitespace-no-wrap">
                                            {estimate.createdAt ? format(estimate.createdAt.toDate(), 'PPP') : 'N/A'}
                                        </p>
                                    </td>
                                    <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm text-right">
                                        <Link to={`/company/contract/detail/${estimate.id}`} className="text-blue-600 hover:underline">
                                            View Details
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default Estimates;
