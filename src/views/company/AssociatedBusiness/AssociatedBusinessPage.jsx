import React from 'react';
import { useParams } from 'react-router-dom';
import CompanyProfile from '../profile/CompanyProfile';
import useCompanyProfile from '../../../hooks/useCompanyProfile';

const AssociatedBusinessPage = () => {
    const { companyId } = useParams();
    const { company, loading, error } = useCompanyProfile(companyId);

    if (loading) return <div className='dark-theme'>Loading company profile...</div>;
    if (error) return <div className='dark-theme'>{error}</div>;

    return (
        <div className='dark-theme'>
            <CompanyProfile viewType="b2b" companyData={company} />
        </div>
    );
};

export default AssociatedBusinessPage;
