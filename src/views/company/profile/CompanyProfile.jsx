import React from 'react';
import B2BView from './B2BView';
import CustomerView from './CustomerView';
import SelfView from './SelfView';

const CompanyProfile = ({ viewType, companyData }) => {
    if (!companyData) {
        return <div>Loading...</div>;
    }

    return (
        <div className='w-full min-h-screen bg-gray-50'>
            {viewType === 'self' && <SelfView companyData={companyData} />}
            {viewType === 'b2b' && <B2BView companyData={companyData} />}
            {viewType === 'customer' && <CustomerView companyData={companyData} />}
        </div>
    );
};

export default CompanyProfile;
