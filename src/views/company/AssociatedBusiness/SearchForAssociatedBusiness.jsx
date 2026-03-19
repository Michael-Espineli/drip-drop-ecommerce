
import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, limit, startAt, endAt, orderBy, doc, setDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { debounce } from 'lodash';
import toast from 'react-hot-toast';

const SearchResultCard = ({ business, onAssociate, isAlreadyAssociated, isPending }) => (
    <div className="bg-white p-5 rounded-xl shadow-lg border border-gray-200 flex justify-between items-center">
        <div>
            <h4 className="font-bold text-lg text-gray-800">{business.name}</h4>
            <p className="text-sm text-gray-500">ID: {business.id}</p>
        </div>
        <button 
            onClick={() => onAssociate(business)}
            disabled={isAlreadyAssociated || isPending}
            className={`py-2 px-5 font-semibold rounded-lg shadow-md transition-all ${isAlreadyAssociated || isPending ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {isAlreadyAssociated ? 'Associated' : (isPending ? 'Request Sent' : 'Request to Associate')}
        </button>
    </div>
);

const SearchForAssociatedBusiness = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany, name: myCompanyName } = useContext(Context);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [pendingRequests, setPendingRequests] = useState(new Set());
    const [existingAssociations, setExistingAssociations] = useState(new Set());

    // Fetch existing associations and pending requests to manage button states
    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchInitialData = async () => {
            // Fetch existing associations
            const assocRef = collection(db, 'companies', recentlySelectedCompany, 'associatedBusinesses');
            const assocSnap = await getDocs(assocRef);
            const assocIds = new Set(assocSnap.docs.map(d => d.id));
            setExistingAssociations(assocIds);

            // Fetch pending requests sent by this company
            const reqRef = collection(db, 'associationRequests');
            const q = query(reqRef, where('requestingCompanyId', '==', recentlySelectedCompany), where('status', '==', 'pending'));
            const reqSnap = await getDocs(q);
            const pendingIds = new Set(reqSnap.docs.map(d => d.data().targetCompanyId));
            setPendingRequests(pendingIds);
        };

        fetchInitialData();
    }, [recentlySelectedCompany]);

    const performSearch = async (searchVal) => {
        if (searchVal.length < 3) {
            setSearchResults([]);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const companiesRef = collection(db, 'companies');
            const q = query(
                companiesRef,
                orderBy('name_lowercase'),
                startAt(searchVal.toLowerCase()),
                endAt(searchVal.toLowerCase() + '\uf8ff'),
                limit(10)
            );
            const querySnapshot = await getDocs(q);
            const results = querySnapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(biz => biz.id !== recentlySelectedCompany); // Exclude self
            setSearchResults(results);
        } catch (error) {
            console.error("Error searching businesses: ", error);
            toast.error("Search failed. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const debouncedSearch = useCallback(debounce(performSearch, 500), []);

    useEffect(() => {
        setIsLoading(true);
        debouncedSearch(searchTerm);
        return () => debouncedSearch.cancel();
    }, [searchTerm, debouncedSearch]);

    const handleAssociationRequest = async (targetCompany) => {
        const toastId = toast.loading('Sending association request...');
        try {
            const requestId = `req_${recentlySelectedCompany}_${targetCompany.id}`;
            const requestRef = doc(db, 'associationRequests', requestId);

            await setDoc(requestRef, {
                id: requestId,
                requestingCompanyId: recentlySelectedCompany,
                requestingCompanyName: myCompanyName,
                targetCompanyId: targetCompany.id,
                targetCompanyName: targetCompany.name,
                status: 'pending', 
                dateCreated: new Date()
            });

            setPendingRequests(prev => new Set(prev).add(targetCompany.id));
            toast.success('Association request sent!', { id: toastId });
        } catch (error) {
            console.error("Error creating association request: ", error);
            toast.error(`Request failed: ${error.message}`, { id: toastId });
        }
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Search Businesses</h1>
                        <p className="text-gray-600 mt-1">Find and associate with other companies.</p>
                    </div>
                    <button onClick={() => navigate('/company/associatedBusiness')} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Back</button>
                </header>

                <div className="bg-white p-4 rounded-xl shadow-lg mb-8">
                    <input 
                        type="text"
                        placeholder="Type a business name (min. 3 characters)..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-100 border-2 border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 p-3"
                    />
                </div>

                <div className="space-y-4">
                    {isLoading && <p className="text-center text-gray-500">Searching...</p>}
                    {!isLoading && searchResults.length > 0 && (
                        searchResults.map(biz => (
                            <SearchResultCard 
                                key={biz.id} 
                                business={biz} 
                                onAssociate={handleAssociationRequest} 
                                isAlreadyAssociated={existingAssociations.has(biz.id)}
                                isPending={pendingRequests.has(biz.id)}
                            />
                        ))
                    )}
                    {!isLoading && searchResults.length === 0 && searchTerm.length >= 3 && (
                         <div className="text-center py-12 bg-white rounded-xl shadow-lg border">
                            <h3 className="text-xl font-semibold text-gray-700">No Businesses Found</h3>
                            <p className="text-gray-500 mt-2">Try a different search term or check for typos.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SearchForAssociatedBusiness;
