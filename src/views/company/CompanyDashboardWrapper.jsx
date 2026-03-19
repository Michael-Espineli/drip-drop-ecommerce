import React, { useContext } from 'react';
import { Context } from '../../context/AuthContext';
import Dashboard from './Dashboard';
import NoCompanySelected from './NoCompanySelected';

const CompanyDashboardWrapper = () => {
    const { recentlySelectedCompany } = useContext(Context);

    // If a company is selected, show the main dashboard.
    // Otherwise, show the "No Company Selected" page.
    return recentlySelectedCompany ? <Dashboard /> : <NoCompanySelected />;
};

export default CompanyDashboardWrapper;
