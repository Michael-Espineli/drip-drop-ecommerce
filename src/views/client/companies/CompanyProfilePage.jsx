import React from 'react';
import { useParams } from 'react-router-dom';
import CompanyProfile from '../../company/profile/CompanyProfile';
import useCompanyProfile from '../../../hooks/useCompanyProfile';

const CompanyProfilePage = () => {
    const { companyId } = useParams();
    const { company, loading, error } = useCompanyProfile(companyId);

    if (loading) return <div>Loading company profile...</div>;
    if (error) return <div>{error}</div>;

    return (
        <CompanyProfile viewType="customer" companyData={company} />
    );
};

export default CompanyProfilePage;
