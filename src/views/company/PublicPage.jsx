import React from 'react';
import CompanyProfile from './profile/CompanyProfile';
import useCompanyProfile from '../../hooks/useCompanyProfile';

const PublicPage = () => {
    const { company, loading, error } = useCompanyProfile();

    if (loading) return <div className='dark-theme'>Loading company profile...</div>;
    if (error) return <div className='dark-theme'>{error}</div>;

    return (
        <div className='dark-theme'>
            <CompanyProfile viewType="self" companyData={company} />
        </div>
    );
};

export default PublicPage;
