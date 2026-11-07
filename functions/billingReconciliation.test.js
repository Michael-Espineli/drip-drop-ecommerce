const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createBillingReconciliation,invoiceFindings}=require('./billingReconciliation');
const now=new Date('2026-11-06T20:00:00Z');
function fixture(){const db=new MemoryFirestore({'companies/company':{ownerId:'owner'},'companies/company/stripePayouts/po_paid':{companyId:'company',status:'paid',amountCents:12345,currency:'usd',stripeCreatedAt:now}});return {db,worker:createBillingReconciliation(db,()=>now)};}
const request=extra=>({auth:{uid:'owner'},data:{companyId:'company',payoutId:'po_paid',requestId:'confirm',amountCents:12345,currency:'usd',receivedAtMillis:now.getTime(),bankStatementReference:'Bank statement line 123',bankStatementChecked:true,...extra}});
test('bank confirmation requires an exact statement match and is idempotent and auditable',async()=>{
 const f=fixture(),result=await f.worker.confirmDeposit(request());assert.deepEqual(await f.worker.confirmDeposit(request()),result);assert.equal(f.db.records.get('companies/company/stripePayouts/po_paid').bankDepositVerification.confirmedByUserId,'owner');assert.equal([...f.db.records.keys()].filter(k=>k.includes('bankDepositConfirmations')).length,1);await assert.rejects(f.worker.confirmDeposit(request({amountCents:12000})),{code:'already-exists'});
});
test('unmatched amounts, failed payouts, absent statement evidence and read-only staff cannot confirm deposits',async()=>{
 for(const patch of [{amountCents:12344},{currency:'eur'},{bankStatementChecked:false},{bankStatementReference:'x'}]){const f=fixture();await assert.rejects(f.worker.confirmDeposit(request(patch)));assert.equal(f.db.records.get('companies/company/stripePayouts/po_paid').bankDepositVerification,undefined);}
 const f=fixture();f.db.set('companies/company/stripePayouts/po_paid',{status:'failed'},{merge:true});await assert.rejects(f.worker.confirmDeposit(request()),{code:'failed-precondition'});
 const reader=fixture();reader.db.set('users/reader/userAccess/company',{status:'active',roleId:'reader'});reader.db.set('companies/company/roles/reader',{permissionIdList:['400']});await assert.rejects(reader.worker.confirmDeposit({...request(),auth:{uid:'reader'}}),{code:'permission-denied'});
});
test('historical review finds credited balance errors without modifying money',async()=>{
 const f=fixture();f.db.set('salesInvoices/invoice',{companyId:'company',totalAmountCents:10000,amountPaidCents:8000,stripeCreditAmountCents:2000,amountDueCents:2000,status:'partiallyPaid'});const before=JSON.stringify([...f.db.records]);const result=await f.worker.report(request());assert.equal(result.scanned,1);assert.deepEqual(result.issues[0].findings,[{kind:'balanceMismatch',savedDueCents:2000,calculatedDueCents:0}]);assert.equal(JSON.stringify([...f.db.records]),before);
 assert.deepEqual(invoiceFindings({totalAmountCents:10000,amountPaidCents:8000,stripeCreditAmountCents:2000,amountDueCents:0,status:'paid'}),[]);
});
