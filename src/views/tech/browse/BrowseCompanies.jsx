import React, { useState, useEffect, useContext } from 'react';
import { collection, getDocs, addDoc, query, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { useNavigate } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid';
import { BookmarkIcon as BookmarkIconOutline } from '@heroicons/react/24/outline';
import {v4 as uuidv4} from 'uuid';

const BrowseCompanies = () => {
    const { user } = useContext(Context);
    const [companies, setCompanies] = useState([]);
    const [savedCompanyIds, setSavedCompanyIds] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const fetchCompanies = async () => {
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

        const savedCompaniesRef = collection(db, 'users/',user.uid,'/savedCompanies');
        const q = query(savedCompaniesRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const ids = new Set(snapshot.docs.map(doc => doc.data().companyId));
            setSavedCompanyIds(ids);
        });

        return () => unsubscribe();
    }, [user]);

    const handleToggleSaveCompany = async (e, companyId,comapnyName) => {
        e.stopPropagation(); // Prevent card click event

        if (savedCompanyIds.has(companyId)) {
            // Note: Deleting would be more complex, so for now we just prevent re-adding
            console.log("Company already saved");
            return;
        }

        try {
            let savedComapnyId = "use_sc_" + uuidv4();
            await setDoc(doc(db, 'users/',user.uid,'/savedCompanies',savedComapnyId), {
                id:savedComapnyId,
                companyName: comapnyName,
                companyId: companyId,
            });
        } catch (error) {
            console.error("Error saving company: ", error);
        }
    };

    const filteredCompanies = companies.filter(company =>
        company.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleCompanyClick = (companyId) => {
        navigate(`/companies-detail/${companyId}`);
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
                    <h1 className="text-4xl font-extrabold text-gray-900">Find Your Next Opportunity</h1>
                    <p className="mt-2 text-lg text-gray-600">Search and connect with companies that match your criteria.</p>
                </div>

                <div className="p-4 bg-white rounded-lg shadow-lg mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <input 
                            type="text"
                            placeholder="Company name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="md:col-span-2 w-full px-4 py-3 bg-gray-100 border-transparent rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input 
                            type="text"
                            placeholder="Location (e.g., city, state)"
                            disabled
                            className="w-full px-4 py-3 bg-gray-200 border-transparent rounded-lg cursor-not-allowed"
                        />
                        <label className="flex items-center justify-center text-gray-500 bg-gray-200 rounded-lg cursor-not-allowed">
                            <input type="checkbox" className="form-checkbox h-5 w-5 text-blue-600" disabled />
                            <span className="ml-2">Actively Hiring</span>
                        </label>
                    </div>
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
                                    <div onClick={() => handleCompanyClick(company.id)} className="flex items-center gap-4 cursor-pointer">
                                        <div className="w-16 h-16 bg-gray-100 rounded-full flex-shrink-0 overflow-hidden">
                                            {company.logoUrl && <img src={company.logoUrl} alt={`${company.name} logo`} className="w-full h-full object-cover" />}
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-bold text-gray-800">{company.name}</h2>
                                            <p className="text-sm text-gray-500">{company.industry || 'No industry specified'}</p>
                                        </div>
                                    </div>
                                    <button onClick={(e) => handleToggleSaveCompany(e, company.id, company.name)} className="p-2 rounded-full hover:bg-gray-100">
                                        {savedCompanyIds.has(company.id) ? (
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

export default BrowseCompanies;
