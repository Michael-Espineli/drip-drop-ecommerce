import { useState, useEffect, useContext } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../utils/config';
import { Context } from '../context/AuthContext';

const useCompanyProfile = (companyId) => {
    const [company, setCompany] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { recentlySelectedCompany } = useContext(Context);

    useEffect(() => {
        const companyToFetch = companyId || recentlySelectedCompany;
        if (!companyToFetch) return;

        const fetchCompanyData = async () => {
            try {
                const docRef = doc(db, 'companies', companyToFetch);
                const companyDoc = await getDoc(docRef);

                if (companyDoc.exists()) {
                    setCompany(companyDoc.data());
                } else {
                    setError('No such document!');
                }
            } catch (err) {
                setError('Error loading company data');
                console.error(err);
            }
            setLoading(false);
        };

        fetchCompanyData();
    }, [companyId, recentlySelectedCompany]);

    return { company, loading, error };
};

export default useCompanyProfile;
