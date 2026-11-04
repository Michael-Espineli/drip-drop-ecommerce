const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Exercise the actual component's conversion method without rendering its unrelated job workspace.
const source=fs.readFileSync(path.join(__dirname,'../src/views/company/jobs/JobDetailView.jsx'),'utf8');
const begin=source.indexOf('  const ensureJobSalesInvoice = async '),end=source.indexOf('  const activeWorkOfferTaskIds',begin);
function fixture(existing=null){
 const rows=new Map(),batches=[];
 const context={exports:{},getCustomerEmail:()=> 'homeowner@example.test',findLinkedSalesInvoice:async()=>existing || [...rows].find(([key])=>key.startsWith('salesInvoices/'))?.[1] || null,
  selectedSalesAgreement:{id:'agreement',totalAmountCents:10000},selectedContract:null,linkedSalesAgreement:null,getSalesLineItemsFromSnapshot:()=>[{id:'service',name:'Service',totalAmountCents:10000}],
  cents:value=>Number(value)||0,job:{rate:10000,customerId:'customer'},customer:{id:'customer'},jobId:'job',recentlySelectedCompany:'company',authCtx:{},
  getCustomerUserId:()=> 'homeowner',getCustomerDisplayName:()=> 'Homeowner',salesDueDateForTerms:()=>new Date('2026-11-02'),Timestamp:{fromDate:v=>v},
  serverTimestamp:()=>new Date('2026-11-02'),getServiceLocationSnapshot:()=>({}),doc:(db,...parts)=>parts.join('/'),db:{},salesCollectionNames:{invoices:'salesInvoices'},setLinkedSalesInvoice:()=>{},Date,
  functions:{}, getCallableAuthPayload:async()=>({}),
  httpsCallable:()=>async payload=>{
   if(context.commitError)throw context.commitError;
   const id=`si_job_${payload.companyId}_${payload.jobId}`;
   if(!rows.has(`salesInvoices/${id}`)){rows.set(`salesInvoices/${id}`,{id,companyId:payload.companyId,jobId:payload.jobId,...payload.invoiceDraft});rows.set(`companies/${payload.companyId}/workOrders/${payload.jobId}`,{salesInvoiceId:id});}
   return {data:{id}};
  },
  getDoc:async ref=>({id:ref.split('/').pop(),exists:()=>rows.has(ref),data:()=>rows.get(ref)}),
  writeBatch:()=>{const writes=[];batches.push(writes);return {set:(ref,data)=>writes.push({ref,data,type:'set'}),update:(ref,data)=>writes.push({ref,data,type:'update'}),commit:async()=>{
   if(context.commitError)throw context.commitError;
   if(writes.some(write=>write.ref.startsWith('salesInvoices/')&&rows.has(write.ref)))throw Error('Existing invoice updates are server-only');
   writes.forEach(({ref,data})=>rows.set(ref,{...rows.get(ref),...data}));
  }};},
 };
 vm.runInNewContext(source.slice(begin,end)+'\nexports.run=ensureJobSalesInvoice;',context);
 return {context,rows,batches,run:context.exports.run};
}
test('resending a partially paid job invoice preserves receipts and write-offs without financial writes',async()=>{
 const existing={id:'existing',companyId:'company',jobId:'job',status:'partiallyPaid',totalAmountCents:10000,amountPaidCents:2500,writeOffAmountCents:5000,amountDueCents:2500};
 const f=fixture(existing);assert.equal(await f.run(),existing);assert.equal(f.batches.length,0);assert.equal(existing.amountDueCents,2500);
});
test('void/uncollectible and foreign-linked job invoices cannot be revived or reused',async()=>{
 for(const existing of [{status:'void',companyId:'company'},{status:'uncollectible',companyId:'company'},{status:'open',companyId:'foreign'},{status:'open',companyId:'company',jobId:'other'}]){
  const f=fixture({id:'existing',...existing});await assert.rejects(f.run());assert.equal(f.batches.length,0);
 }
});
test('invoice creation and its job link commit together and failed commits leave no orphan bill',async()=>{
 const f=fixture();f.context.commitError=Error('offline');await assert.rejects(f.run(),/offline/);assert.equal(f.rows.size,0);
 delete f.context.commitError;const invoice=await f.run();assert.equal(invoice.id,'si_job_company_job');assert.equal(f.rows.get('companies/company/workOrders/job').salesInvoiceId,invoice.id);assert.equal(f.rows.get(`salesInvoices/${invoice.id}`).jobId,'job');
});
test('two concurrent job billing actions resolve to one invoice identity',async()=>{
 const f=fixture(),outcomes=await Promise.allSettled([f.run(),f.run()]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,2);
 assert.equal([...f.rows.keys()].filter(key=>key.startsWith('salesInvoices/')).length,1);assert.equal((await f.run()).id,'si_job_company_job');
});
