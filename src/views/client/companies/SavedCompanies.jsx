
import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';

const SavedCompanies = () => {
    const { user } = useContext(Context);
    const [savedCompanies, setSavedCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const savedCompaniesRef = collection(db, 'users/',user.uid,'/savedCompanies');
        const q = query(savedCompaniesRef);

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            if (snapshot.empty) {
                setSavedCompanies([]);
                setLoading(false);
                return;
            }

            const companyPromises = snapshot.docs.map(async (savedDoc) => {
                const companyId = savedDoc.data().companyId;
                const companyRef = doc(db, 'companies', companyId);
                const companySnap = await getDoc(companyRef);
                return companySnap.exists() ? { id: companySnap.id, ...companySnap.data() } : null;
            });

            const companies = (await Promise.all(companyPromises)).filter(Boolean);
            setSavedCompanies(companies);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleCompanyClick = (companyId) => {
        navigate(`/companies/profile/${companyId}`);
    };

    if (loading) {
        return <div className="p-8">Loading saved companies...</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Saved Companies</h1>
                    <p className="mt-1 text-lg text-gray-600">Your bookmarked companies for future reference.</p>
                </div>

                {savedCompanies.length === 0 ? (
                    <div className="text-center bg-white p-12 rounded-lg shadow-md">
                        <BuildingOffice2Icon className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-2 text-xl font-medium text-gray-900">No saved companies</h3>
                        <p className="mt-1 text-sm text-gray-500">You haven't bookmarked any companies yet.</p>
                        <div className="mt-6">
                            <Link
                                to="/client/companies"
                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            >
                                Browse Companies
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {savedCompanies.map(company => (
                            <div
                                key={company.id}
                                onClick={() => handleCompanyClick(company.id)}
                                className="bg-white rounded-lg shadow-md p-6 transition-shadow cursor-pointer hover:shadow-xl"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 bg-gray-100 rounded-full flex-shrink-0 overflow-hidden">
                                        {company.logoUrl && <img src={company.logoUrl} alt={`${company.name} logo`} className="w-full h-full object-cover" />}
                                    </div>
                                    <div>
                                         <div className="flex items-center gap-2">
                                            <h2 className="text-xl font-bold text-gray-800">{company.name}</h2>
                                            {company.verified && <CheckBadgeIcon className="w-6 h-6 text-blue-500" title="Verified Company"/>}
                                        </div>
                                        <p className="text-sm text-gray-500">{company.ownerName || 'No owner specified'}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SavedCompanies;
