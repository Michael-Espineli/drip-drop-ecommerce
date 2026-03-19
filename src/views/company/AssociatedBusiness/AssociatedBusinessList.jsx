
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const BusinessCard = ({ business, onClick }) => (
    <div 
        onClick={onClick}
        className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200 hover:shadow-2xl hover:border-blue-500 transition-all duration-300 cursor-pointer"
    >
        <h3 className="text-xl font-bold text-gray-800 truncate">{business.name}</h3>
        <p className="text-blue-600 font-semibold mt-1">{business.role || 'General Association'}</p>
        <div className="mt-4 border-t border-gray-200 pt-4 text-sm text-gray-600">
            <p><span className="font-semibold">Contact:</span> {business.contactName || 'N/A'}</p>
            <p><span className="font-semibold">Email:</span> {business.email || 'N/A'}</p>
        </div>
    </div>
);

const AssociatedBusinessList = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const [associatedBusinesses, setAssociatedBusinesses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setIsLoading(false);
            return;
        }

        const fetchBusinesses = async () => {
            setIsLoading(true);
            try {
                // Corrected path to subcollection
                const businessesRef = collection(db, 'companies', recentlySelectedCompany, 'associatedBusinesses');
                const q = query(businessesRef);
                const querySnapshot = await getDocs(q);
                const businessesList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setAssociatedBusinesses(businessesList);
            } catch (error) {
                console.error("Error fetching associated businesses: ", error);
                toast.error("Could not load associated businesses.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchBusinesses();
    }, [recentlySelectedCompany]);

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Associated Businesses</h1>
                        <p className="text-gray-600 mt-1">A list of companies you work with.</p>
                    </div>
                    <button
                        onClick={() => navigate('/company/associatedBusiness/search')}
                        className='mt-4 sm:mt-0 py-2 px-6 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all'
                    >
                        Search & Add
                    </button>
                </header>

                {isLoading ? (
                    <div className="text-center py-10"><p className="text-gray-500">Loading businesses...</p></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {associatedBusinesses.length > 0 ? (
                            associatedBusinesses.map(biz => (
                                <BusinessCard 
                                    key={biz.id} 
                                    business={biz} 
                                    onClick={() => navigate(`/company/associatedBusiness/detail/${biz.id}`)}
                                />
                            ))
                        ) : (
                            <div className="col-span-full text-center py-16 bg-white rounded-2xl shadow-lg border">
                                <h3 className="text-2xl font-semibold text-gray-700">No Associated Businesses Found</h3>
                                <p className="text-gray-500 mt-3">Click "Search & Add" to build your network.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AssociatedBusinessList;
