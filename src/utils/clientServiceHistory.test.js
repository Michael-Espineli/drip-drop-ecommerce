import {clientVisitSummary} from './clientServiceHistory';
import {safeClientReturnPath} from './clientNavigation';
test('next visit excludes completed, cancelled and old work while history excludes future work',()=>{
 const now=new Date('2026-11-02T12:00:00');const result=clientVisitSummary([{id:'done',status:'Finished',serviceDate:new Date('2026-11-01')},{id:'cancelled',status:'Cancelled',serviceDate:new Date('2026-11-03')},{id:'next',status:'Scheduled',serviceDate:new Date('2026-11-04')},{id:'later',status:'Scheduled',serviceDate:new Date('2026-11-05')},{id:'old',status:'Scheduled',serviceDate:new Date('2026-10-20')}],now);expect(result.lastService.id).toBe('done');expect(result.nextService.id).toBe('next');expect(result.completed.map(x=>x.id)).toEqual(['done']);
});
test('return destinations cannot leave the site or use ambiguous backslash paths',()=>{for(const path of ['//evil.example','https://evil.example','/\\evil.example','\r\n//evil.example'])expect(safeClientReturnPath(path)).toBe('/client/dashboard');expect(safeClientReturnPath('/client/service-requests/new/company?chatId=abc')).toBe('/client/service-requests/new/company?chatId=abc');});
