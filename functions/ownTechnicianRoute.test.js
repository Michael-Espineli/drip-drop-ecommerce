const {test}=require('node:test');const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');const {createOwnTechnicianRoute}=require('./ownTechnicianRoute');
const day=new Date('2026-11-03T18:00:00Z');
function fixture(extra={}){const db=new MemoryFirestore({
 'companies/company':{ownerId:'owner',timeZone:'America/Los_Angeles'},
 'users/tech/userAccess/company':{roleId:'tech',roleName:'Technician',active:true},
 'companies/company/roles/tech':{name:'Technician',permissionIdList:['240']},
 'companies/company/companyUsers/tech':{userId:'tech',userName:'Worker',status:'Active'},
 'companies/company/serviceStops/own':{techId:'tech',serviceDate:day,operationStatus:'Not Finished'},
 'companies/company/serviceStops/other':{techId:'other',serviceDate:day},
 'companies/company/serviceStops/tomorrow':{techId:'tech',serviceDate:new Date('2026-11-04T18:00:00Z')},...extra,
});return{db,call:data=>createOwnTechnicianRoute(db)({auth:{uid:'tech',token:{}},data:{companyId:'company',serviceDateMillis:day.getTime(),...data}})};}
test('personal route is derived from current assigned stops, ignoring client scope and pay',async()=>{const f=fixture();const first=await f.call({serviceStopsIds:['other'],techName:'Forged',manualPayOverrideCents:99999});const second=await f.call();assert.equal(first.routeId,second.routeId);const saved=f.db.records.get('companies/company/activeRoutes/'+first.routeId);assert.deepEqual(saved.serviceStopsIds,['own']);assert.equal(saved.techName,'Worker');assert.equal(saved.manualPayOverrideCents,undefined);});
test('other-user, missing membership and inactive aliases cannot create routes',async()=>{await assert.rejects(fixture().call({techId:'other'}),{code:'permission-denied'});for(const access of [{active:false},{accessStatus:'Revoked'}]){const f=fixture({'users/tech/userAccess/company':{roleId:'tech',...access}});await assert.rejects(f.call(),{code:'permission-denied'});assert.equal([...f.db.records.keys()].filter(p=>p.includes('/activeRoutes/')).length,0);}});
test('route preparation preserves started route membership and original history',async()=>{const f=fixture({'companies/company/activeRoutes/existing':{id:'existing',techId:'tech',date:day,status:'In Progress',startTime:day,serviceStopsIds:['historic'],startMilage:100}});const result=await f.call();assert.equal(result.routeId,'existing');assert.deepEqual(f.db.records.get('companies/company/activeRoutes/existing').serviceStopsIds,['historic']);});
