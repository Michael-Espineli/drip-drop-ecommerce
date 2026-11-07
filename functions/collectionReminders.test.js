const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MemoryFirestore}=require('./testSupport/memoryFirestore');
const {createCollectionReminders}=require('./collectionReminders');
const now=new Date('2026-11-06T20:00:00Z');
function fixture(){const db=new MemoryFirestore({'companies/company':{ownerId:'owner',name:'Pool Company'},'salesInvoices/invoice':{companyId:'company',customerId:'customer',status:'partiallyPaid',totalAmountCents:10000,amountPaidCents:2000,creditAmountCents:1000,amountDueCents:7000,email:'home@example.test',sentAt:new Date('2026-10-01'),dueDate:new Date('2026-10-02'),emailDelivery:{reviewAccessToken:'keep-original-link'}}});let sends=0,lost=false;const worker=createCollectionReminders(db,{now:()=>now,send:async message=>{sends++;assert.match(message.text, /\$70.00/);assert.match(message.text,/keep-original-link/);assert.equal(message.to,'internal@example.test');if(lost)throw Error('Response lost');return [];},resolveDelivery:async intendedTo=>({intendedTo,actualTo:'internal@example.test',testMode:true})});return {db,worker,sends:()=>sends,lose:()=>{lost=true;}};}
const configure=enabled=>({auth:{uid:'owner'},data:{companyId:'company',enabled}});
test('reminders are opt-in, use credited outstanding money, preserve existing links and send only once',async()=>{
 const f=fixture();assert.equal((await f.worker.run()).queued,0);await f.worker.configure(configure(true));assert.equal((await f.worker.run()).queued,1);assert.equal((await f.worker.run()).queued,0);
 const job=f.db.records.get('salesInvoices/invoice').collectionReminderState.jobId;await f.worker.process('invoice',job);await f.worker.process('invoice',job);assert.equal(f.sends(),1);assert.equal(f.db.records.get('salesInvoices/invoice').status,'partiallyPaid');assert.equal(f.db.records.get('salesInvoices/invoice').amountDueCents,7000);assert.equal((await f.worker.run()).queued,0);
});
test('Stripe-owned, processing, under-review, unsent and already-paid invoices never queue reminders',async()=>{
 for(const patch of [{stripeInvoiceId:'in_stripe'},{paymentProcessing:true},{paymentReviewRequired:true},{sentAt:null},{amountPaidCents:9000},{status:'void'}]){const f=fixture();await f.worker.configure(configure(true));f.db.set('salesInvoices/invoice',patch,{merge:true});assert.equal((await f.worker.run()).queued,0);assert.equal(f.sends(),0);}
});
test('payment or opt-out before delivery cancels a queued reminder',async()=>{
 for(const change of ['paid','disabled']){const f=fixture();await f.worker.configure(configure(true));await f.worker.run();const job=f.db.records.get('salesInvoices/invoice').collectionReminderState.jobId;if(change==='paid')f.db.set('salesInvoices/invoice',{amountPaidCents:9000},{merge:true});else await f.worker.configure(configure(false));await f.worker.process('invoice',job);assert.equal(f.sends(),0);assert.equal(f.db.records.get(`salesInvoices/invoice/collectionReminders/${job}`).status,'canceled');}
});
test('ambiguous sends and crashed senders require review and never send automatically again',async()=>{
 const f=fixture();await f.worker.configure(configure(true));await f.worker.run();const job=f.db.records.get('salesInvoices/invoice').collectionReminderState.jobId;f.lose();await f.worker.process('invoice',job);await f.worker.process('invoice',job);assert.equal(f.sends(),1);assert.equal(f.db.records.get('salesInvoices/invoice').collectionReminderState.status,'reviewRequired');assert.equal((await f.worker.run()).queued,0);
 const stale=fixture();await stale.worker.configure(configure(true));stale.db.set('salesInvoices/invoice',{collectionReminderState:{jobId:'old',status:'sending',startedAt:new Date(now.getTime()-700000)}},{merge:true});await stale.worker.run();assert.equal(stale.db.records.get('salesInvoices/invoice').collectionReminderState.status,'reviewRequired');
});
test('nonbilling staff cannot enable reminders and cadence cannot spam customers',async()=>{
 const f=fixture();await assert.rejects(f.worker.configure({...configure(true),auth:{uid:'other'}}),{code:'permission-denied'});await assert.rejects(f.worker.configure({...configure(true),data:{...configure(true).data,repeatEveryDays:1}}),{code:'invalid-argument'});
});
