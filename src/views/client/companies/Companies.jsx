
import React, { useState, useEffect, useContext } from 'react';
import { collection, getDocs, addDoc, query, where, onSnapshot, getDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { useNavigate } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import { BookmarkIcon as BookmarkIconSolid, CheckBadgeIcon } from '@heroicons/react/24/solid';
import { BookmarkIcon as BookmarkIconOutline } from '@heroicons/react/24/outline';

const Companies = () => {
    const { user } = useContext(Context);
    const [companies, setCompanies] = useState([]);
    const [savedCompanyEntries, setSavedCompanyEntries] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const fetchCompanies = async () => {
            setLoading(true);
            try {
                const querySnapshot = await getDocs(collection(db, 'companies'));
                const companiesList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCompanies(companiesList);
            } catch (error) {
                console.error("Error fetching companies: ", error);
            }
            setLoading(false);
        };

        fetchCompanies();
    }, []);

    useEffect(() => {
        if (!user?.uid) return;

        // Note: Using a different collection for client's saved companies
        const savedCompaniesRef = collection(db, 'users/',user.uid,'/savedCompanies');
        const q = query(savedCompaniesRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const entries = new Map();
            snapshot.docs.forEach(doc => {
                entries.set(doc.data().companyId, doc.id);
            });
            setSavedCompanyEntries(entries);
        });

        return () => unsubscribe();
    }, [user]);

    const handleToggleSaveCompany = async (e, companyId) => {
        e.stopPropagation(); 
        if (!user) {
            console.error("User not logged in");
            return;
        }

        const isSaved = savedCompanyEntries.has(companyId);

        try {
            if (isSaved) {
                const docIdToDelete = savedCompanyEntries.get(companyId);
                await deleteDoc(doc(db, 'users/',user.uid,'/savedCompanies', docIdToDelete));
            } else {
                await addDoc(collection(db, 'users/',user.uid,'/savedCompanies'), {
                    userId: user.uid,
                    companyId: companyId,
                    createdAt: new Date(),
                });
            }
        } catch (error) {
            console.error("Error toggling saved company: ", error);
        }
    };
    
    const filteredCompanies = companies.filter(company =>
        company.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleCompanyClick = (companyId) => {
        // Updated to match your existing routing structure
        navigate(`/companies/profile/${companyId}`);
    };

    const renderSkeleton = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
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
                 <div className="mb-8 text-center">
                    <h1 className="text-4xl font-extrabold text-gray-900">Find a Service Company</h1>
                    <p className="mt-2 text-lg text-gray-600">Browse and connect with trusted pool service professionals.</p>
                </div>

                <div className="p-4 bg-white rounded-lg shadow-lg mb-8">
                    <input 
                        type="text"
                        placeholder="Search by company name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-100 border-transparent rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {loading ? renderSkeleton() : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredCompanies.map(company => (
                            <div 
                                key={company.id} 
                                onClick={() => handleCompanyClick(company.id)} 
                                className="bg-white rounded-lg shadow-md p-6 transition-shadow cursor-pointer flex flex-col justify-between hover:shadow-xl"
                            >
                                <div className="flex items-start justify-between">
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
                                    <button onClick={(e) => handleToggleSaveCompany(e, company.id)} className="p-2 rounded-full hover:bg-gray-100">
                                        {savedCompanyEntries.has(company.id) ? (
                                            <BookmarkIconSolid className="w-6 h-6 text-blue-500" />
                                        ) : (
                                            <BookmarkIconOutline className="w-6 h-6 text-gray-400" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Companies;
