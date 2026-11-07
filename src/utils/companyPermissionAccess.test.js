import { getCompanyPermissionForPath, roleHasCompanyPermission } from './companyPermissionAccess';
import { isCompanyAccessInactive } from './invites';
import { companyPermissions } from './companyPermissions';

test('missing, malformed and empty roles deny sensitive grants', () => {
  for (const role of [null, {}, {permissionIdList:'bad'}, {permissionIdList:[]}]) {
    expect(roleHasCompanyPermission(role,'424')).toBe(false);
    expect(roleHasCompanyPermission(role,'864')).toBe(false);
  }
});
test('management grants include their matching reads without exposing other domains', () => {
  expect(roleHasCompanyPermission({permissionIdList:['424']},'420')).toBe(true);
  expect(roleHasCompanyPermission({permissionIdList:['404']},'400')).toBe(true);
  expect(roleHasCompanyPermission({permissionIdList:['430']},'400')).toBe(false);
  expect(roleHasCompanyPermission({permissionIdList:['420']},'424')).toBe(false);
});
test('specific routes use action permissions before broader read routes', () => {
  expect(getCompanyPermissionForPath('/company/customers/create-from-lead')).toBe('612');
  expect(getCompanyPermissionForPath('/company/shopping-list/create/customer')).toBe('102');
  expect(getCompanyPermissionForPath('/company/shopping-list/detail/item')).toBe('100');
  expect(getCompanyPermissionForPath('/company/settings/job-templates/template')).toBe('920');
  expect(getCompanyPermissionForPath('/company/StripeProfile')).toBe('408');
});
test('every inactive access alias revokes the web role', () => {
  for (const access of [{active:false},{isActive:false},{accessActive:false},{revoked:true},{status:'Revoked'},{companyUserStatus:'Inactive'},{userStatus:'Past'},{accessStatus:'Expired'},{userAccessStatus:'Pending'}]) {
    expect(isCompanyAccessInactive(access)).toBe(true);
  }
  expect(isCompanyAccessInactive({status:'Active',active:true})).toBe(false);
});
test('new capabilities have unique permission IDs', () => {
  const ids = companyPermissions.map(p=>p.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ['100','102','104','106','268','274','408','920']) expect(ids).toContain(id);
});

test('My Pay uses own-record access while company Payroll still requires permission 420', () => {
  expect(getCompanyPermissionForPath('/company/my-pay')).toBe(null);
  expect(getCompanyPermissionForPath('/company/payroll')).toBe('420');
  expect(getCompanyPermissionForPath('/company/payroll/setup')).toBe('420');
});
