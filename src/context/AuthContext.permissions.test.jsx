import React, { useContext } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthContext, Context } from './AuthContext';
const mockUser={uid:'tech',email:'tech@example.test',emailVerified:true,getIdTokenResult:async()=>({claims:{}})};
const mockAuth={currentUser:mockUser};
let mockAuthCallback;
const mockListeners=new Map();
const mockProfile={id:'tech',accountType:'Company',recentlySelectedCompany:'company',firstName:'Test',lastName:'Worker'};
const snapshot=(id,data)=>({id,exists:()=>data!==null,data:()=>data});
jest.mock('../utils/config',()=>({db:{}}));
jest.mock('firebase/auth',()=>({getAuth:()=>mockAuth,onAuthStateChanged:(_auth,callback)=>{mockAuthCallback=callback;return ()=>{};}}));
jest.mock('firebase/firestore',()=>({
  doc:(_db,...parts)=>({path:parts.join('/')}),collection:(_db,...parts)=>({path:parts.join('/')}),query:ref=>ref,where:()=>({}),
  getDoc:async ref=>({id:'tech',exists:()=>true,data:()=>ref.path==='users/tech'?mockProfile:{ownerId:'owner',name:'Company'}}),
  getDocs:async()=>({empty:true,docs:[]}),
  onSnapshot:(ref,next,error)=>{const listener={next,error};mockListeners.set(ref.path,listener);return ()=>{if(mockListeners.get(ref.path)===listener)mockListeners.delete(ref.path);};},
}));
function Probe(){const value=useContext(Context);return <div>
  <span data-testid="access">{String(value.hasCompanyPermission('10'))}</span>
  <span data-testid="account">{value.accountType||'none'}</span>
  <span data-testid="ready">{String(value.companyRoleLoaded)}</span>
  <span data-testid="sales-enabled">{String(value.isFeatureEnabled('feature_flag_004'))}</span>
  <span data-testid="pnl-enabled">{String(value.isFeatureEnabled('feature_flag_016'))}</span>
</div>;}
const emit=async(path,data)=>{await act(async()=>{await mockListeners.get(path).next(snapshot(path.split('/').pop(),data));});};
test('role changes apply live and revoked access clears authority, including late role callbacks',async()=>{
  render(<AuthContext><Probe/></AuthContext>);
  await act(async()=>{await mockAuthCallback(mockUser);});
  await waitFor(()=>expect(mockListeners.has('users/tech/userAccess/company')).toBe(true));
  await emit('companies/company',{ownerId:'owner',name:'Company'});
  await emit('users/tech/userAccess/company',{roleId:'viewer',roleName:'Viewer',status:'Active'});
  await waitFor(()=>expect(mockListeners.has('companies/company/roles/viewer')).toBe(true));
  const oldRole=mockListeners.get('companies/company/roles/viewer');
  await emit('companies/company/roles/viewer',{name:'Viewer',permissionIdList:[]});expect(screen.getByTestId('access')).toHaveTextContent('false');
  await emit('companies/company/roles/viewer',{name:'Viewer',permissionIdList:['10']});expect(screen.getByTestId('access')).toHaveTextContent('true');
  await emit('users/tech/userAccess/company',{roleId:'viewer',roleName:'Viewer',active:false});expect(screen.getByTestId('access')).toHaveTextContent('false');
  await act(async()=>oldRole.next(snapshot('viewer',{name:'Manager',permissionIdList:['10']})));
  expect(screen.getByTestId('access')).toHaveTextContent('false');
  await emit('users/tech',{...mockProfile,accountType:'Admin'});expect(screen.getByTestId('account')).toHaveTextContent('none');
});

test('a missing flag 16 stays off when the offline fallback enables legacy features', async () => {
  window.localStorage.removeItem('dripdrop.featureFlags.v1');
  render(<AuthContext><Probe /></AuthContext>);
  await act(async () => { await mockAuthCallback(mockUser); });
  await act(async () => {
    mockListeners.get('featureFlags').next({ docs: [], metadata: { fromCache: true } });
  });
  expect(screen.getByTestId('sales-enabled')).toHaveTextContent('true');
  expect(screen.getByTestId('pnl-enabled')).toHaveTextContent('false');
  await act(async () => {
    mockListeners.get('featureFlags').next({ docs: [snapshot('feature_flag_016', { enabled: true })] });
  });
  expect(screen.getByTestId('pnl-enabled')).toHaveTextContent('true');
  window.localStorage.removeItem('dripdrop.featureFlags.v1');
});
