import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Context } from '../context/AuthContext';
import { Protected } from './Protected';
import { sellerRoutes } from './routes/sellerRoutes';
import { allNav } from '../navigation/allNav';
import { roleHasCompanyPermission } from '../utils/companyPermissionAccess';
jest.mock('../utils/config',()=>({db:{}}));
jest.mock('firebase/auth',()=>({getAuth:()=>({currentUser:{uid:'tech',emailVerified:true}})}));

function mount({permissions=[],audience='company',subscription=null,loading=false,path='/company/payroll',routeConfig}={}) {
  const route=routeConfig || {path,role:audience};
  const context={user:{uid:'tech',emailVerified:true},accountType:'Company',recentlySelectedCompany:'company',companySubscription:subscription,
    companyRoleLoading:loading,companyRoleLoaded:!loading,featureFlagsLoaded:true,isFeatureEnabled:id=>id==='feature_flag_006',
    hasCompanyPermission:id=>roleHasCompanyPermission({permissionIdList:permissions},id)};
  return render(<Context.Provider value={context}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path={path} element={<Protected route={route}>Authorized payroll</Protected>} />
    <Route path="/company/dashboard" element={<div>Dashboard</div>} />
  </Routes></MemoryRouter></Context.Provider>);
}
test('null subscription does not bypass a company permission',()=>{mount();expect(screen.getByText('Dashboard')).toBeInTheDocument();expect(screen.queryByText('Authorized payroll')).not.toBeInTheDocument();});
test('null subscription does not bypass the route audience',()=>{mount({permissions:['420'],audience:'admin'});expect(screen.getByText('Dashboard')).toBeInTheDocument();});
test('payroll managers can read payroll regardless of subscription loading state',()=>{mount({permissions:['424']});expect(screen.getByText('Authorized payroll')).toBeInTheDocument();});
test('permissions stay closed until loaded',()=>{mount({permissions:['420'],loading:true});expect(screen.queryByText('Authorized payroll')).not.toBeInTheDocument();});

test('personal My Pay is separate from the payroll permission gate',()=>{mount({path:'/company/my-pay'});expect(screen.getByText('Authorized payroll')).toBeInTheDocument();});

test('registered My Pay route and sidebar entry use personal access separately from management Payroll',()=>{
 const personal=sellerRoutes.find(route=>route.path==='/company/my-pay');
 expect(personal).toBeDefined();
 expect(personal.permissionId).toBeUndefined();
 expect(allNav.find(item=>item.path==='/company/my-pay').permissionId).toBeUndefined();
 expect(allNav.find(item=>item.path==='/company/payroll').permissionId).toBe('420');
 mount({path:personal.path,routeConfig:personal});
 expect(screen.getByText('Authorized payroll')).toBeInTheDocument();
});
