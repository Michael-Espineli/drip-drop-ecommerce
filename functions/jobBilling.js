const {onCall}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {billingActor}=require('./billingAccess');
const {documentId,fail}=require('./companyActor');
const {hash,key,money,pricing}=require('./billingMath');
const {dayStart,addInterval}=require('./billingCalendar');

function createJobBilling(db,now=()=>new Date()){
  async function create(request){
    const data=request.data||{},companyId=documentId(data.companyId,'Company'),jobId=documentId(data.jobId,'Job');
    const draft=data.invoiceDraft||{},agreementId=data.agreementId?documentId(data.agreementId,'Agreement'):'',contractId=data.contractId?documentId(data.contractId,'Contract'):'';
    return db.runTransaction(async tx=>{
      const actor=await billingActor(db,tx,companyId,request.auth?.uid);
      const jobRef=db.collection('companies').doc(companyId).collection('workOrders').doc(jobId),jobSnap=await tx.get(jobRef),job=jobSnap.data()||{};
      if(!jobSnap.exists)fail('not-found','Job not found.');
      const customerSnap=job.customerId?await tx.get(db.collection('companies').doc(companyId).collection('customers').doc(documentId(job.customerId,'Customer'))):null;
      const customer=customerSnap?.data()||{};
      const agreement=agreementId?await tx.get(db.collection('salesAgreements').doc(agreementId)):null;
      const contract=contractId?await tx.get(db.collection('contracts').doc(contractId)):null;
      for(const source of [agreement,contract])if(source&&(!source.exists||source.data().companyId!==companyId||source.data().customerId&&source.data().customerId!==job.customerId||source.data().jobId&&source.data().jobId!==jobId))fail('permission-denied','The pricing source belongs to another company, customer, or job.');
      const baseId=`si_job_${companyId}_${jobId}`;
      const linked=job.salesInvoiceId?await tx.get(db.collection('salesInvoices').doc(documentId(job.salesInvoiceId,'Invoice'))):null;
      const legacy=await tx.get(db.collection('salesInvoices').where('companyId','==',companyId).where('jobId','==',jobId));
      const candidates=[...new Map([...(linked?.exists?[linked]:[]),...legacy.docs].map(doc=>[doc.id,doc])).values()];
      if(candidates.some(doc=>doc.data().companyId!==companyId||doc.data().jobId&&doc.data().jobId!==jobId))fail('permission-denied','The linked invoice belongs to another job.');
      if(candidates.some(doc=>doc.data().billingScope==='approvedPart') && !candidates.some(doc=>doc.data().billingScope!=='approvedPart'))
        fail('failed-precondition','This job has separately invoiced parts. Review the remaining job scope in Sales before creating another invoice.');
      const jobCandidates=candidates.filter(doc=>doc.data().billingScope!=='approvedPart');
      const current=linked?.exists&&linked.data().billingScope!=='approvedPart'?linked:jobCandidates.find(doc=>!['void','voided','uncollectible','canceled','cancelled'].includes(key(doc.data().status)))||jobCandidates[0];
      const revision=Boolean(data.replaceClosedInvoiceId);
      if(current&&!revision){
        if(['void','voided','uncollectible','canceled','cancelled'].includes(key(current.data().status)))fail('failed-precondition','This job invoice is closed. A reviewed reissue requires a new accepted estimate revision and a reason.');
        tx.set(jobRef,{salesInvoiceId:current.id,invoiceRef:current.id,invoiceType:'salesInvoice'},{merge:true});
        return {...current.data(),id:current.id};
      }
      const savedSource=agreement?.data()||contract?.data()||job;
      const acceptedPlan=(savedSource.planOptions||savedSource.solutionOptions||[]).find(plan=>(plan.planId||plan.id||plan.solutionId)===(savedSource.acceptedPlanId||savedSource.acceptedSolutionId));
      const source={...savedSource,...(acceptedPlan?{lineItems:acceptedPlan.lineItems,totalAmountCents:acceptedPlan.totalAmountCents}:{} )};
      if(agreement&&!['accepted','active'].includes(key(source.status)))fail('failed-precondition','Accept the estimate before creating its invoice.');
      const lines=(Array.isArray(source.lineItems)&&source.lineItems.length?source.lineItems:draft.lineItems||[]).map((line,index)=>{
        const quantity=Number(line.quantity??1),total=Number(line.totalAmountCents??line.amount??line.price??line.unitAmountCents??0);
        return {...line,id:line.id||`line_${index}`,name:line.name||line.title||`Line ${index+1}`,quantity,unitAmountCents:Number(line.unitAmountCents??(quantity?Math.round(total/quantity):0)),totalAmountCents:total};
      });
      const amount=Number(source.totalAmountCents??source.rateAmountCents??source.rate??job.rate??0);
      const price=pricing({...source,lineItems:lines,amountCents:money(amount,'Saved job price'),currency:source.currency||'usd'});
      const snapshotHash=hash({agreementId,contractId,revision:source.revisionNumber||0,price});
      if(revision&&current?.data().replacesInvoiceId===data.replaceClosedInvoiceId&&current.data().acceptedPricingSnapshotHash===snapshotHash){
        if(current.data().reissueReason!==String(data.reason||'').trim())fail('already-exists','This reissue already has a recorded reason.');
        return {...current.data(),id:current.id};
      }
      if(revision&&(!current||current.id!==data.replaceClosedInvoiceId||!['void','voided'].includes(key(current.data().status))||!agreement||current.data().acceptedPricingSnapshotHash===snapshotHash||!current.data().acceptedPricingSnapshotHash||Number(current.data().amountPaidCents||0)>0||Number(current.data().grossAmountPaidCents||0)>0||Number(current.data().writeOffAmountCents||0)>0||String(data.reason||'').trim().length<8))
        fail('failed-precondition','Reissue requires an unpaid void invoice, a different accepted pricing revision, and an explanatory reason.');
      const invoiceId=revision?`${baseId}_r_${hash(`${current.id}:${snapshotHash}`).slice(0,16)}`:baseId;
      const ref=db.collection('salesInvoices').doc(invoiceId),existing=await tx.get(ref);
      if(existing.exists)fail('failed-precondition','Invoice identity already exists. Refresh this job before billing again.');
      const timeZone=actor.company.billingTimeZone||actor.company.timeZone||'UTC',paymentTerms=source.paymentTerms||'dueOnReceipt';
      const days=({net7:7,net14:14,net15:15,net30:30})[key(paymentTerms)]||0;
      const today=dayStart(now(),timeZone),email=customer.billingEmail||customer.email||source.email||draft.email||'';
      if(data.requireEmail!==false&&!email)fail('failed-precondition','Add the customer’s billing email before sending.');
      const fields={id:invoiceId,companyId,companyName:actor.company.name||actor.company.companyName||draft.companyName||'',jobId,contractId,agreementId,
        customerId:job.customerId||'',customerUserId:customer.customerUserId||customer.userId||source.customerUserId||null,customerName:customer.customerName||customer.name||source.customerName||draft.customerName||'',email,billingEmail:email,customerEmail:email,
        relationshipId:customer.relationshipId||source.relationshipId||'',customerCompanyRelationshipId:customer.customerCompanyRelationshipId||source.customerCompanyRelationshipId||'',
        stripeConnectedAccountId:actor.company.stripeConnectedAccountId||actor.company.stripeConnectAccountId||'',billingSubscriptionId:'',
        invoiceNumber:draft.invoiceNumber||`${job.internalId||'JOB'}-${invoiceId.slice(-8).toUpperCase()}`,type:'oneTime',status:'open',sourceType:'jobEstimateConversion',sourceId:jobId,
        paymentTerms,dueDate:days?addInterval(today,'day',days,timeZone):today,deliveryMethod:source.invoiceDeliveryMethod||'email',currency:price.currency,
        lineItems:price.lines,subtotalAmountCents:price.subtotalAmountCents,discountAmountCents:price.discountAmountCents,taxAmountCents:price.taxAmountCents,totalAmountCents:price.totalAmountCents,
        amountPaidCents:0,amountDueCents:price.totalAmountCents,writeOffAmountCents:0,creditAmountCents:0,memo:source.description||source.termsSummary||source.notes||job.description||'',
        acceptedPricingSnapshotHash:snapshotHash,acceptedPricingSnapshot:{agreementId,contractId,revisionNumber:source.revisionNumber||0,...price},billingRevision:0,
        serviceLocationSnapshots:job.serviceLocationSnapshots||draft.serviceLocationSnapshots||[],createdAt:now(),updatedAt:now(),createdByUserId:actor.uid};
      if(revision)Object.assign(fields,{replacesInvoiceId:current.id,reissueReason:String(data.reason).trim(),reissuedByUserId:actor.uid});
      tx.set(ref,fields);tx.set(jobRef,{salesInvoiceId:invoiceId,invoiceRef:invoiceId,invoiceType:'salesInvoice',invoiceDate:now()},{merge:true});
      if(contract?.exists)tx.set(contract.ref,{salesInvoiceId:invoiceId,updatedAt:now()},{merge:true});
      tx.set(db.collection('salesInvoiceEvents').doc(`job_${hash(invoiceId)}`),{companyId,invoiceId,jobId,action:revision?'reissue':'createFromJob',actorUserId:actor.uid,acceptedPricingSnapshotHash:snapshotHash,previousInvoiceId:current?.id||'',reason:revision?fields.reissueReason:'',createdAt:now()});
      return fields;
    });
  }
  return {create};
}
exports.createJobBilling=createJobBilling;
exports.createJobSalesInvoice=onCall({cors:true},request=>createJobBilling(admin.firestore()).create(request));
