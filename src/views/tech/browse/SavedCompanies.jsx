import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';

const SavedCompanies = () => {
    const { user } = useContext(Context);
    const [savedCompanies, setSavedCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user?.uid) return;

        setLoading(true);
        const savedCompaniesRef = collection(db, 'users/',user.uid,'/savedCompanies');
        const q = query(savedCompaniesRef);

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            const companyPromises = snapshot.docs.map(async (savedDoc) => {
                const companyId = savedDoc.data().companyId;
                const companyRef = doc(db, 'companies', companyId);
                const companySnap = await getDoc(companyRef);
                return companySnap.exists() ? { id: companySnap.id, ...companySnap.data() } : null;
            });

            const companies = (await Promise.all(companyPromises)).filter(Boolean);
            setSavedCompanies(companies);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching saved companies: ", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleCompanyClick = (companyId) => {
        navigate(`/companies-detail/${companyId}`);
    };

    const renderSkeleton = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-lg shadow-md p-6 animate-pulse">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-gray-200 rounded-full"></div>
                        <div className="flex-grow">
                            <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
                            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">My Saved Companies</h1>
                    <p className="mt-1 text-md text-gray-600">Companies you've bookmarked for future reference.</p>
                </div>

                {loading ? renderSkeleton() : (
                    savedCompanies.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {savedCompanies.map(company => (
                                <div 
                                    key={company.id} 
                                    onClick={() => handleCompanyClick(company.id)} 
                                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 bg-gray-100 rounded-full flex-shrink-0 overflow-hidden">
                                            {company.logoUrl ? (
                                                <img src={company.logoUrl} alt={`${company.name} logo`} className="w-full h-full object-cover" />
                                            ) : (
                                                <BuildingOffice2Icon className="w-10 h-10 text-gray-400 mx-auto mt-3"/>
                                            )}
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-bold text-gray-800">{company.name}</h2>
                                            <p className="text-sm text-gray-500">{company.industry || 'No industry specified'}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-20 bg-white rounded-lg shadow">
                            <BuildingOffice2Icon className="w-16 h-16 mx-auto text-gray-400" />
                            <h2 className="mt-4 text-xl font-semibold text-gray-800">No Saved Companies</h2>
                            <p className="mt-2 text-gray-500">You haven't saved any companies yet. Start browsing to find companies you're interested in.</p>
                            <button onClick={() => navigate('/browse-companies')} className="mt-6 bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors duration-300">
                                Browse Companies
                            </button>
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

export default SavedCompanies;
