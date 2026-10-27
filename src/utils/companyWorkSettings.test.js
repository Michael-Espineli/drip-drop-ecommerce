import {normalizeCompanyWorkSettings} from './companyWorkSettings';
test('coverage modes preserve legacy assignment-review settings',()=>{
 expect(normalizeCompanyWorkSettings({workOffersRequireApprovalBeforeAssignment:true}).routeCoverageMode).toBe('review');
 expect(normalizeCompanyWorkSettings({workOffersAutoAssignOnAcceptance:false}).routeCoverageMode).toBe('review');
 expect(normalizeCompanyWorkSettings({}).routeCoverageMode).toBe('automatic');
 expect(normalizeCompanyWorkSettings({routeCoverageMode:'notify',workOffersRequireApprovalBeforeAssignment:true}).routeCoverageMode).toBe('notify');
});
