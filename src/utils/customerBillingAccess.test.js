import {canManageCustomerBilling,roleHasCompanyPermission} from './companyPermissionAccess';
test('finance readers cannot mutate billing and missing roles fail closed',()=>{
 expect(canManageCustomerBilling({companyRole:{permissionIdList:['400']}})).toBe(false);
 expect(canManageCustomerBilling({companyRole:{name:'Manager',permissionIdList:[]}})).toBe(false);
 expect(canManageCustomerBilling({companyRole:{}})).toBe(false);
 expect(canManageCustomerBilling({companyRole:{permissionIdList:['404']}})).toBe(true);
 expect(roleHasCompanyPermission({permissionIdList:['404']},'400')).toBe(true);
 expect(roleHasCompanyPermission({permissionIdList:['404']},'424')).toBe(false);
});
test('company owner and authoritative named management membership retain billing actions',()=>{
 expect(canManageCustomerBilling({companyOwnerId:'owner',user:{uid:'owner'}})).toBe(true);
 expect(canManageCustomerBilling({companyUserAccess:{roleName:'Manager'}})).toBe(true);
});
