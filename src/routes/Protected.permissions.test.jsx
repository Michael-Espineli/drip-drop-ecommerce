import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import { Protected } from './Protected';
import { roleHasCompanyPermission } from '../utils/companyPermissionAccess';
jest.mock('../utils/config',()=>({db:{}}));
jest.mock('firebase/auth',()=>({getAuth:()=>({currentUser:{uid:'tech',emailVerified:true}})}));

function mount({permissions=[],audience='company',subscription=null,loading=false}={}) {
  const route={path:'/company/payroll',role:audience};
  const context={user:{uid:'tech',emailVerified:true},accountType:'Company',recentlySelectedCompany:'company',companySubscription:subscription,
    companyRoleLoading:loading,companyRoleLoaded:!loading,featureFlagsLoaded:true,isFeatureEnabled:()=>false,
    hasCompanyPermission:id=>roleHasCompanyPermission({permissionIdList:permissions},id)};
  return render(<Context.Provider value={context}><MemoryRouter initialEntries={['/company/payroll']}><Routes>
    <Route path="/company/payroll" element={<Protected route={route}>Authorized payroll</Protected>} />
    <Route path="/company/dashboard" element={<div>Dashboard</div>} />
  </Routes></MemoryRouter></Context.Provider>);
}
test('null subscription does not bypass a company permission',()=>{mount();expect(screen.getByText('Dashboard')).toBeInTheDocument();expect(screen.queryByText('Authorized payroll')).not.toBeInTheDocument();});
test('null subscription does not bypass the route audience',()=>{mount({permissions:['420'],audience:'admin'});expect(screen.getByText('Dashboard')).toBeInTheDocument();});
test('payroll managers can read payroll regardless of subscription loading state',()=>{mount({permissions:['424']});expect(screen.getByText('Authorized payroll')).toBeInTheDocument();});
test('permissions stay closed until loaded',()=>{mount({permissions:['420'],loading:true});expect(screen.queryByText('Authorized payroll')).not.toBeInTheDocument();});
