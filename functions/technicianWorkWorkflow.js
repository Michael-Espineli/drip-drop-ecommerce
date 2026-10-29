const { HttpsError } = require('firebase-functions/v2/https');
const { createHash, randomUUID } = require('node:crypto');
const { calculatePayLines, jobPayFields } = require('./payrollCalculation');
const { started:workStarted, newActiveRoute } = require('./routeState');
const str = v => String(v ?? '').trim();
const id = v => str(typeof v === 'object' ? v?.id : v);
const list = v => Array.isArray(v) ? v : [];
const unique = v => [...new Set(list(v).map(id).filter(Boolean))];
const key = v => str(v).replace(/[^a-z0-9]/gi, '').toLowerCase();
const date = v => v?.toDate?.() || (v instanceof Date ? v : new Date(typeof v === 'number' ? v : v?.seconds ? v.seconds * 1000 : v));
const cents = v => Math.round(Number(v) || 0);
const rows = s => s.docs.map(d => ({ ...d.data(), id: d.id }));
const record = s => s.exists ? { ...s.data(), id: s.id } : null;
const done = v => ['finished','complete','completed','done','cancelled','canceled','skipped'].includes(key(v?.status || v?.operationStatus));
const fail = (code, message) => { throw new HttpsError(code, message); };
const total = lines => lines.reduce((n, l) => n + cents(l.totalAmountCents), 0);
const stable = v => createHash('sha256').update(v).digest('hex').slice(0, 24);
const scopeSignature = scope => {
  const fields=['id','name','description','typeId','equipmentId','bodyOfWaterId','dataBaseItemId','payTypeId','payrollMode','manualPayOverrideCents','payrollStackBehavior','payQuantity','quantity','estimatedTime','contractedRate','payTypeName','sourceStopId','instructions','taskIds'];
  const result={};
  for (const name of ['tasks','services','products','stops']) result[name]=list(scope[name]).map(row=>Object.fromEntries(fields.map(k=>[k,row[k] ?? null])));
  return stable(JSON.stringify(result));
};
const presentScope = scope => Object.fromEntries(Object.entries(scope).map(([name,items])=>[name,list(items).map(v=>({id:v.id,name:(v.sourceStopName?v.sourceStopName+' · ':'')+(v.name || v.itemName || v.dbItemName || v.customerName || v.type || 'Work item'),description:v.description || v.instructions || '',status:v.status || v.operationStatus || '',quantity:Number(v.quantity || 1),equipmentName:v.equipmentName || v.equipmentId || '',estimatedTime:Number(v.estimatedTime || v.estimatedMinutes || 0)}))]));
const stopIds = o => unique([o.serviceStopId, ...list(o.routeServiceStopIds), ...list(o.serviceStopIds), ...list(o.serviceStopsIds)]);
const routeIds = r => unique([...list(r.serviceStopsIds), ...list(r.serviceStopIds), ...list(r.rssIds), ...list(r.order).map(v => v.serviceStopId || v.recurringServiceStopId)]);
const agreementReference = a => { const {rates,settings,workTypes,quotedPayLines,baseCents,totalCents,...reference}=a; return reference; };
const allocation = (amount, scope, selected) => selected.reduce((n, value) => { const at = scope.indexOf(value); return n + (at < 0 ? 0 : Math.floor(amount / scope.length) + (at < amount % scope.length ? 1 : 0)); }, 0);
const coverageMode = s => ['review','notify','automatic'].includes(s.routeCoverageMode) ? s.routeCoverageMode : s.workOffersRequireApprovalBeforeAssignment || s.workOffersAutoAssignOnAcceptance === false ? 'review' : 'automatic';
const timestampFields = v => { const result = { ...v }; for (const k of ['serviceDate','proposedStartDate','proposedEndDate','completionDeadlineAt','routeDate','createdAt']) if (result[k] != null && !(result[k] instanceof Date)) { const d = date(result[k]); if (Number.isFinite(d.getTime())) result[k] = d; else delete result[k]; } return result; };

function createTechnicianWorkWorkflow(db, now = () => new Date()) {
  const company = companyId => db.collection('companies').doc(companyId);
  async function actorFor(t, companyId, uid) {
    const c = company(companyId);
    const [co, access, users] = await Promise.all([t.get(c), t.get(db.collection('users').doc(uid).collection('userAccess').doc(companyId)), t.get(c.collection('companyUsers').where('userId', '==', uid))]);
    if (!co.exists || !(access.exists || co.data().ownerId === uid)) fail('permission-denied', 'Company access is required.');
    const a = access.data() || {}, user = rows(users)[0] || {};
    const role = a.roleId ? record(await t.get(c.collection('roles').doc(a.roleId))) : null;
    const admin = co.data().ownerId === uid || ['owner','admin','manager'].includes(key(a.roleName));
    return { uid, name: user.userName || [user.firstName,user.lastName].filter(Boolean).join(' ') || a.userName || uid, workerType: user.workerType || 'Not Assigned', admin, permissions: list(role?.permissionIdList).map(str), user, company: co.data() };
  }
  const can = (a, permission) => a.admin || a.permissions.includes(permission);
  async function context(t, c, a) {
    const [wide, settings, types, rates] = await Promise.all([t.get(c.collection('settings').doc('companyWide')), t.get(c.collection('paySettings').doc('main')), t.get(c.collection('companyPayTypes')), t.get(c.collection('technicianRates').where('technicianId','==',a.uid))]);
    return { wide: wide.data() || {}, settings: { ...(settings.data() || {}), ...((wide.data()?.payrollEnabled === false || wide.data()?.companyPayrollEnabled === false || wide.data()?.payrollDisabled === true) ? { payrollEnabled:false } : {}) }, workTypes: rows(types), rates: rows(rates), workers:[{ ...a.user, userId:a.uid, userName:a.name }] };
  }
  async function scopeFor(t, c, offer) {
    const jobId = id(offer.jobId);
    const [job, tasks, services, products] = jobId ? await Promise.all([t.get(c.collection('workOrders').doc(jobId)), t.get(c.collection('workOrders').doc(jobId).collection('tasks')), t.get(c.collection('workOrders').doc(jobId).collection('laborLineItems')), t.get(c.collection('shoppingList').where('jobId','==',jobId))]) : [null,null,null,null];
    if (jobId && !job.exists) fail('not-found','The linked job no longer exists.');
    let ids = stopIds(offer);
    if (offer.routeId && !ids.length) { const route = record(await t.get(c.collection(offer.routeSource === 'recurringRoutes' ? 'recurringRoutes' : 'activeRoutes').doc(offer.routeId))); ids = route ? routeIds(route) : []; }
    let stops = (await Promise.all(ids.map(value => t.get(c.collection('serviceStops').doc(value))))).filter(s => s.exists).map(record);
    if (offer.routeSource === 'recurringRoutes') {
      const route = record(await t.get(c.collection('recurringRoutes').doc(offer.routeId)));
      const rssIds = route ? routeIds(route) : ids;
      const day = date(offer.routeDate || offer.proposedStartDate); day.setHours(0,0,0,0); const end = new Date(day.getTime()+86400000);
      if (!Number.isFinite(day.getTime())) fail('invalid-argument','Choose the date for recurring-route coverage.');
      stops = rows(await t.get(c.collection('serviceStops').where('serviceDate','>=',day).where('serviceDate','<',end))).filter(s => rssIds.includes(id(s.recurringServiceStopId)) && (!list(offer.requestedRecurringStopIds).length || offer.requestedRecurringStopIds.includes(id(s.recurringServiceStopId))));
    }
    if (offer.routeId && !stops.length) fail('failed-precondition','Generate the dated route stops before offering this coverage.');
    const selected = unique(offer.jobTaskIds), diagnostic=offer.workPurpose==='diagnostic' || key(offer.serviceStopTypeUseCaseRawValue).includes('estimate');
    const taskRows = tasks ? rows(tasks).filter(v => selected.length ? selected.includes(v.id) : diagnostic ? false : !done(v)) : [];
    if (selected.length !== taskRows.length && selected.length) fail('failed-precondition','Some selected tasks no longer exist. Refresh the scope.');
    const serviceRows = services ? rows(services).length ? rows(services) : list(job.data().laborLineItems) : [];
    const taskSet = new Set(taskRows.map(v=>v.id));
    const materialRows = products ? rows(products).filter(v => !selected.length && !diagnostic || taskSet.has(id(v.linkedTaskId || v.jobTaskId)) || taskRows.some(task=>id(task.shoppingListItemId)===v.id)) : [];
    const stopTaskSnaps=await Promise.all(stops.map(stop=>t.get(c.collection('serviceStops').doc(stop.id).collection('tasks'))));
    const storedTaskIds=offer.scopeSnapshot?.tasks?.map(v=>v.id);
    const routeTasks=stopTaskSnaps.flatMap((snap,index)=>rows(snap).filter(task=>storedTaskIds ? storedTaskIds.includes(task.id) : !done(task) && task.workerAssignmentMode!=='task' && (!task.workerId || task.workerId===stops[index].techId || task.workerAssignmentMode==='stop')).map(task=>({...task,sourceStopId:stops[index].id,sourceStopName:stops[index].customerName || stops[index].type || ''})));
    const stopProductSnaps=await Promise.all(stops.map(stop=>t.get(c.collection('shoppingList').where('serviceStopId','==',stop.id))));
    const routeProducts=stopProductSnaps.flatMap((snap,index)=>rows(snap).filter(item=>offer.scopeSnapshot ? list(offer.scopeSnapshot.products).some(v=>v.id===item.id) : key(item.status)!=='installed').map(item=>({...item,sourceStopId:stops[index].id})));
    const scope = { tasks:[...taskRows,...routeTasks], services:serviceRows.filter(v=>!selected.length && !diagnostic || list(v.taskIds?.length?v.taskIds:v.laborLineTaskIds).some(value=>taskSet.has(id(value)))), products:[...new Map([...materialRows,...routeProducts].map(v=>[v.id,v])).values()], stops };

    return { job:job?.exists ? record(job) : null, scope };
  }
  function estimate({companyId, offer, scope, ctx, actor}) {
    if(ctx.settings.payrollEnabled===false || ctx.settings.companyPayrollEnabled===false || ctx.settings.payrollDisabled===true)return {lines:[],baseCents:0,incentiveCents:0,totalCents:0,needsReview:offer.paySource!=='Unpaid' || Number(offer.incentive?.amountCents || 0)>0 || Number(offer.incentive?.percentage || 0)>0};
    const selectedIds = unique(scope.stops.map(v=>v.id));
    if (offer.paySource==='Task Contracted Rates') ctx={...ctx,settings:{...ctx.settings,routePaySource:'completedTasks',taskPaySource:'taskContractedRate'}};
    const allIds = selectedIds.length ? selectedIds : ['job'];
    const fixed = offer.paySource === 'Offered Amount';
    const incentive = offer.incentive || {};
    const lines = allIds.flatMap(stopId => {
      const stop = scope.stops.find(v=>v.id===stopId) || { id:'offer_preview', jobId:offer.jobId, typeId:offer.serviceStopTypeId, payTypeId:offer.serviceStopTypeId, serviceDate:offer.proposedStartDate || now(), estimatedDuration:offer.estimatedMinutes };
      const tasks = fixed || offer.paySource==='Unpaid' ? [] : selectedIds.length ? scope.tasks.filter(v=>v.sourceStopId===stopId).map(v=>({...v,workerId:actor.uid,workerName:actor.name,payrollAgreement:null})) : scope.tasks.map(v=>({...v,workerId:actor.uid,workerName:actor.name,payrollAgreement:null}));
      if (ctx.settings.payMode==='hourlyOnly' && ['workLogs','activeRouteDuration','activeRouteLogs'].includes(ctx.settings.hourlyPaySource) && !fixed && offer.paySource!=='Unpaid') {
        const minutes=Number(stop.estimatedDuration || stop.estimatedMinutes || offer.estimatedMinutes || tasks.reduce((n,v)=>n+Number(v.estimatedTime || 0),0));
        return calculatePayLines({...ctx,companyId,mode:'preview',tasks:[],serviceStop:{...stop,techId:actor.uid,payTypeId:'offer_hourly',estimatedDuration:minutes},workTypes:[{id:'offer_hourly',name:'Hourly work',defaultRateType:'hourly'}],settings:{payMode:'hourlyOnly',hourlyPaySource:'serviceStopDuration'}});
      }
      return calculatePayLines({ ...ctx, settings:!selectedIds.length && !offer.serviceStopTypeId ? {...ctx.settings,routePaySource:'completedTasks'} : ctx.settings, companyId, mode:'preview', serviceStop:{...stop, techId:actor.uid, tech:actor.name,
        ...(fixed || offer.paySource === 'Unpaid' ? { payrollMode:'custom', manualPayOverrideCents:fixed ? allocation(cents(offer.offeredAmountCents),allIds,[stopId]) : 0 } : {}) }, tasks });
    });
    if(ctx.settings.payMode==='hybrid' && ctx.settings.hourlyPaySource==='workLogs' && !fixed && offer.paySource!=='Unpaid') {
      for(const stopId of allIds) {
        const stop=scope.stops.find(v=>v.id===stopId),minutes=Number(stop?.estimatedMinutes || stop?.estimatedDuration || offer.estimatedMinutes || scope.tasks.filter(v=>!v.sourceStopId || v.sourceStopId===stopId).reduce((sum,v)=>sum+Number(v.estimatedTime || 0),0));
        lines.push(...calculatePayLines({...ctx,companyId,mode:'preview',tasks:[],serviceStop:{id:'hourly_'+stopId,techId:actor.uid,payTypeId:'offer_hourly',serviceDate:stop?.serviceDate || offer.proposedStartDate || now(),estimatedDuration:minutes},workTypes:[{id:'offer_hourly',name:'Estimated clocked time',defaultRateType:'hourly'}],settings:{payMode:'hourlyOnly',hourlyPaySource:'serviceStopDuration'}}));
      }
    }
    const bonus = incentive.type === 'flat' ? cents(incentive.amountCents) : incentive.type === 'percentage' ? Math.round(total(lines)*Number(incentive.percentage || 0)/100) : 0;
    return { lines, baseCents:total(lines), incentiveCents:Math.max(0,bonus), totalCents:total(lines)+Math.max(0,bonus), needsReview:lines.some(v=>v.calculationStatus==='needsReview') };
  }
  async function notify(t,c,offer,claim,mode,ownerId) {
    if (mode !== 'notify') return;
    if (ownerId) t.set(db.collection('users').doc(ownerId).collection('alerts').doc('coverage_'+offer.id+'_'+claim.id),{source:'workOffer',title:'Route coverage assigned',message:claim.workerName+' accepted '+offer.title,recipientUserId:ownerId,companyId:c.id,status:'Unread',read:false,createdAt:now(),date:now(),route:'/company/offeredWork'});
    t.set(c.collection('alerts').doc('coverage_'+offer.id+'_'+claim.id), { id:'coverage_'+offer.id+'_'+claim.id, source:'workOffer', category:'Route Coverage', title:'Route coverage assigned', message:claim.workerName+' accepted '+offer.title, relatedEntity:{type:'workOffer',id:offer.id}, route:'/company/offeredWork', status:'Unread', read:false, date:now(), createdAt:now(), managementOnly:true });
  }
  async function prepareAssignment(t,c,offer,claim) {
    const stops = (await Promise.all(claim.stopIds.map(value=>t.get(c.collection('serviceStops').doc(value))))).map(record);
    if (stops.some(s=>!s || done(s) || s.pendingWorkOfferId && s.pendingWorkOfferId!==offer.id || false)) fail('failed-precondition','Offered stops have changed or are finished.');
    const stopTasks=await Promise.all(stops.map(stop=>t.get(c.collection('serviceStops').doc(stop.id).collection('tasks'))));
    for (let index=0;index<stops.length;index++) {
      const stop=stops[index], original=offer.scopeSnapshot?.stops?.find(value=>value.id===stop.id);
      // Date/worker/revision are part of the offered scope even for an offer
      // posted before assignmentRevision existed. Check again during approval.
      if (!original || id(original.techId)!==id(stop.techId) || date(original.serviceDate).getTime()!==date(stop.serviceDate).getTime() || Number(original.assignmentRevision || 0)!==Number(stop.assignmentRevision || 0)) fail('failed-precondition','The offered assignment or date changed. Ask management to refresh this offer.');
      if (workStarted(stop) || rows(stopTasks[index]).some(workStarted)) fail('failed-precondition','Work has already started. Management must review completed work and pay before transferring this stop.');
    }
    const transfers=new Map();
    const linkedJobTasks=[];
    for(let index=0;index<stops.length;index++) {
      const stop=stops[index],previousId=stop.workOfferId;
      for(const task of rows(stopTasks[index]).filter(v=>(claim.agreement.stopTasks || []).some(ref=>ref.stopId===stop.id && ref.taskId===v.id))) {
        const jobTaskId=id(task.jobTaskId || task.workOrderTaskId),jobId=id(stop.jobId);
        if(jobTaskId && jobId){const doc=await t.get(c.collection('workOrders').doc(jobId).collection('tasks').doc(jobTaskId));if(doc.exists){if(workStarted(doc.data()))fail('failed-precondition','A linked task has already started. Review the work before transferring this stop.');linkedJobTasks.push(doc);}}
      }
      if(!previousId || previousId===offer.id)continue;
      if(['inprogress','started'].includes(key(stop.operationStatus)) || rows(stopTasks[index]).some(done)) fail('failed-precondition','Work has already started. Management must review completed work and pay before transferring this stop.');
      let previous=transfers.get(previousId);
      if(!previous){previous=record(await t.get(c.collection('workOffers').doc(previousId)));if(!previous)fail('failed-precondition','The previous accepted offer needs management review.');transfers.set(previousId,previous);}
      const prior=(previous.claims || []).find(v=>(v.stopIds || []).includes(stop.id) || v.serviceStopId===stop.id);
      if(!prior || !['Accepted','Scheduled'].includes(prior.status))fail('failed-precondition','The previous accepted offer needs management review before transfer.');
      const remaining=(prior.stopIds || []).filter(value=>value!==stop.id),wasJobStop=prior.serviceStopId===stop.id;
      previous.claims=previous.claims.map(v=>v.id!==prior.id?v:{...v,stopIds:remaining,...(wasJobStop?{serviceStopId:null,taskIds:[]}:{}),status:remaining.length?'Accepted':'Transferred',transferredStopIds:unique([...(v.transferredStopIds || []),stop.id]),transferredToOfferId:offer.id,transferredAt:now(),agreement:{...v.agreement,...(wasJobStop?{taskIds:[]}:{}),stopTasks:(v.agreement?.stopTasks || []).filter(value=>value.stopId!==stop.id)}});
      previous.transferredStopIds=unique([...(previous.transferredStopIds || []),stop.id]);
      previous.transferHistory=[...(previous.transferHistory || []),{stopId:stop.id,fromClaimId:prior.id,fromWorkerId:prior.workerId,toOfferId:offer.id,toClaimId:claim.id,toWorkerId:claim.workerId,at:now()}];

    }
    const routes = stops.length ? rows(await t.get(c.collection('activeRoutes'))) : [];
    const tasks = offer.jobId ? (await Promise.all(claim.taskIds.map(value=>t.get(c.collection('workOrders').doc(id(offer.jobId)).collection('tasks').doc(value))))).map(record) : [];
    if (tasks.some(v=>!v || workStarted(v) || (v.claimedWorkOfferId && v.claimedWorkOfferId !== offer.id))) fail('failed-precondition','Some tasks have already been started, completed or claimed.');
    if (stops.length + tasks.length + routes.length + linkedJobTasks.length + stopTasks.reduce((n,v)=>n+v.docs.length,0) > 350) fail('resource-exhausted','Split this offer into smaller scopes.');
    return () => {
      stopTasks.forEach((snap,index)=>rows(snap).filter(task=>(claim.agreement.stopTasks || []).some(v=>v.stopId===stops[index].id && v.taskId===task.id)).forEach(task=>t.set(c.collection('serviceStops').doc(stops[index].id).collection('tasks').doc(task.id),{workerId:claim.workerId,workerName:claim.workerName,workerType:claim.workerType,workerAssignmentMode:'stop',payrollAgreement:agreementReference(claim.agreement)},{merge:true})));
      transfers.forEach(previous=>t.set(c.collection('workOffers').doc(previous.id),{claims:previous.claims,transferredStopIds:previous.transferredStopIds,transferHistory:previous.transferHistory,status:previous.claims.every(v=>['Transferred','Cancelled','Rejected'].includes(v.status))?'Cancelled':previous.status,updatedAt:now()},{merge:true}));
      linkedJobTasks.forEach(doc=>t.set(doc.ref,{claimedWorkOfferId:offer.id,workerId:claim.workerId,workerName:claim.workerName,workerType:claim.workerType,workerAssignmentMode:'stop',payrollAgreement:agreementReference(claim.agreement)},{merge:true}));
      const scopeIds = stopIds(offer).length ? stopIds(offer) : claim.stopIds;
      stops.forEach(stop=> {
        const fixed = claim.agreement.paySource === 'Offered Amount';
        const agreement = { ...claim.agreement, fixedAmountCents:allocation(cents(offer.offeredAmountCents),scopeIds,[stop.id]), incentiveCents:claim.agreement.incentive.type === 'flat' ? allocation(cents(claim.agreement.incentive.amountCents),scopeIds,[stop.id]) : 0 };
        t.set(c.collection('serviceStops').doc(stop.id), { techId:claim.workerId, tech:claim.workerName, workOfferId:offer.id, workOfferClaimId:claim.id, payrollAgreement:agreementReference({...agreement,claimId:claim.id}), assignedFromWorkOffer:true, pendingWorkOfferId:null, originalTechnicianId:stop.originalTechnicianId || stop.techId || '', updatedAt:now(), ...(['Offered Amount','Unpaid'].includes(claim.agreement.paySource) ? { payrollMode:'custom', manualPayOverrideCents:fixed?agreement.fixedAmountCents:0 } : {payrollMode:'automatic',manualPayOverrideCents:null}) }, {merge:true});
      });
      tasks.forEach(task=>t.set(c.collection('workOrders').doc(id(offer.jobId)).collection('tasks').doc(task.id), { claimedWorkOfferId:offer.id, workerId:claim.workerId, workerName:claim.workerName, workerType:claim.workerType, workerAssignmentMode:'task', payrollAgreement:agreementReference({...claim.agreement,claimId:claim.id}) }, {merge:true}));
      const moved = new Set(claim.stopIds);
      const changedRoutes = new Map();
      const destinationIds = new Set();
      for (const stop of stops) {
        const day = date(stop.serviceDate); const dayKey = day.toISOString().slice(0,10);
        const target = routes.find(r=>id(r.techId)===claim.workerId && date(r.date).toISOString().slice(0,10)===dayKey);
        const targetId = target?.id || 'coverage_'+stable(claim.workerId+'_'+dayKey);
        destinationIds.add(targetId);
        let dest = changedRoutes.get(targetId);
        if (!dest) {
          const sources=routes.filter(r=>routeIds(r).includes(stop.id));
          dest = { ...(target || newActiveRoute({companyId:c.id,workerId:claim.workerId,workerName:claim.workerName,dayKey,zone:'UTC'})), id:targetId, date:day,
            coverageSourceRouteIds:unique([...(target?.coverageSourceRouteIds || []),...sources.map(r=>r.id)]) };
        }
        dest.coverageSourceRouteIds=unique([...(dest.coverageSourceRouteIds || []),...routes.filter(r=>routeIds(r).includes(stop.id)).map(r=>r.id)]);
        const ids = unique([...list(dest.serviceStopsIds),stop.id]);
        const order = list(dest.order).filter(v=>v.serviceStopId!==stop.id);
        order.push({ id:stop.id, serviceStopId:stop.id, order:order.length+1, customerId:stop.customerId || '', customerName:stop.customerName || '' });
        changedRoutes.set(targetId,{...dest,serviceStopsIds:ids,order,totalStops:ids.length});
      }
      routes.forEach(r=> { if (destinationIds.has(r.id) || !routeIds(r).some(v=>moved.has(v))) return;
        const ids = list(r.serviceStopsIds).filter(v=>!moved.has(v));
        changedRoutes.set(r.id,{...r,serviceStopsIds:ids,order:list(r.order).filter(v=>!moved.has(v.serviceStopId)).map((v,i)=>({...v,order:i+1})),totalStops:ids.length});
      });
      changedRoutes.forEach(r=>t.set(c.collection('activeRoutes').doc(r.id),r,{merge:true}));
    };
  }
  async function command(request) {
    const uid = request.auth?.uid; if (!uid) fail('unauthenticated','Sign in first.');
    const data = request.data || {}, companyId = id(data.companyId), action = data.action;
    if (!companyId) fail('invalid-argument','Select a company.');
    return db.runTransaction(async t=> {
      const c = company(companyId), actor = await actorFor(t,companyId,uid);
      const ctx = await context(t,c,actor);
      if (action === 'capabilities') return {canPost:can(actor,'322'),canPostForOthers:can(actor,'324'),canSplit:can(actor,'326'),canSetPay:can(actor,'324') || can(actor,'424'),canIncentivize:can(actor,'328'),routeCoverageMode:coverageMode(ctx.wide)};
      if (action === 'list') {
        const offers=rows(await t.get(data.jobId ? c.collection('workOffers').where('jobId','==',id(data.jobId)) : c.collection('workOffers')));
        const boards=rows(await t.get(c.collection('workOfferBoards')));
        const manager=can(actor,'324') || can(actor,'332');
        const visible=offers.filter(o=> manager || o.offeredToUserId===uid || o.createdByUserId===uid || list(o.claims).some(v=>v.workerId===uid) || o.acceptedByUserId===uid || o.postedToBoard && ['Posted','Viewed'].includes(o.status) && (!list(o.boardIds).length ? !list(o.boardMemberUserIds).length || o.boardMemberUserIds.includes(uid) : boards.some(b=>o.boardIds.includes(b.id) && list(b.memberUserIds).includes(uid))));
        const finance=can(actor,'420') || can(actor,'424');
        const terms=a=>a?{workerId:a.workerId,workerName:a.workerName,paySource:a.paySource,revision:a.revision,...(a.workerId===uid || finance?{baseCents:a.baseCents,totalCents:a.totalCents,fixedAmountCents:a.fixedAmountCents}:{})}:null;
        const publicOffer=o=> finance ? o : { ...o, adminNotes:manager?o.adminNotes:'', acceptedTerms:terms(o.acceptedTerms),
          scopeSnapshot:o.scopeSnapshot ? presentScope(o.scopeSnapshot) : null,
          claims:list(o.claims).map(v=>({...v,agreement:terms(v.agreement)})) };
        const json=value=>value?.toMillis ? value.toMillis() : value instanceof Date ? value.getTime() : Array.isArray(value) ? value.map(json) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,json(v)])) : value;
        return {offers:visible.map(publicOffer).map(json)};
      }
      if (action === 'quote') {
        if(!can(actor,'322')) fail('permission-denied','You cannot prepare offered work.');
        const draft=timestampFields(data.offer || {}),{scope}=await scopeFor(t,c,draft);
        if(draft.paySource==='Technician Rate' && !data.technicianId) return {lines:[],baseCents:0,incentiveCents:0,totalCents:null,needsReview:false,personal:false};
        const targetId=id(data.technicianId) || uid;
        if(targetId!==uid && !can(actor,'324') && !can(actor,'424')) return {lines:[],baseCents:0,incentiveCents:0,totalCents:null,needsReview:false,personal:false};
        const targetUser=targetId===uid?actor.user:rows(await t.get(c.collection('companyUsers').where('userId','==',targetId)))[0];
        if(!targetUser) fail('not-found','Select an active company technician.');
        const target={...actor,uid:targetId,user:targetUser,name:targetUser.userName || targetId};
        const quote=estimate({companyId,offer:draft,scope,ctx:targetId===uid?ctx:await context(t,c,target),actor:target});
        return {...quote,personal:true,lines:quote.lines.map(v=>({...v,title:v.taskName || v.workTypeName || 'Work Pay',sourceTaskId:v.jobTaskId || v.serviceStopTaskId || null}))};
      }
      if (action === 'save') {
        if (!can(actor,'322')) fail('permission-denied','You cannot post offered work.');
        const incoming = timestampFields(data.offer || {}); const offerId = id(incoming.id);
        if (!offerId || offerId.includes('/')) fail('invalid-argument','A stable offer ID is required.');
        const existing = record(await t.get(c.collection('workOffers').doc(offerId)));
        if (existing && !can(actor,'324') && existing.createdByUserId !== uid) fail('permission-denied','You cannot edit this offer.');
        if (existing && (list(existing.claims).length || existing.acceptedByUserId || ['Accepted','Scheduled','In Progress','Completed'].includes(existing.status))) fail('failed-precondition','Accepted terms are locked. Create an offer for additional work.');
        incoming.workPurpose=incoming.workPurpose || (key(incoming.serviceStopTypeUseCaseRawValue).includes('estimate')?'diagnostic':'execution');
        incoming.paySource=incoming.paySource || 'Technician Rate';
        if(!['Technician Rate','Task Contracted Rates','Offered Amount','Unpaid'].includes(incoming.paySource) || cents(incoming.offeredAmountCents)<0 || !['none','flat','percentage'].includes(incoming.incentive?.type || 'none') || Number(incoming.incentive?.amountCents || 0)<0 || Number(incoming.incentive?.percentage || 0)<0)fail('invalid-argument','Choose a valid pay source and non-negative pay and incentive.');
        if(incoming.proposedStartDate && (incoming.completionDeadlineAt || incoming.proposedEndDate) && date(incoming.proposedStartDate)>date(incoming.completionDeadlineAt || incoming.proposedEndDate))fail('invalid-argument','The deadline must follow the available date.');
        const {job,scope} = await scopeFor(t,c,incoming);
        const management = can(actor,'324');
        if (incoming.paySource==='Offered Amount' && !management && !can(actor,'424')) fail('permission-denied','Management must set fixed offered pay.');
        if ((cents(incoming.incentive?.amountCents)>0 || Number(incoming.incentive?.percentage)>0) && (!can(actor,'328') || ctx.wide.workOfferIncentivesCreatePayrollLines===false)) fail('permission-denied','Management must authorize payroll incentives.');
        if (!management && incoming.routeTechId && incoming.routeTechId !== uid) fail('permission-denied','You can only offer your own route.');
        if (!management && scope.stops.some(s=>s.techId !== uid)) fail('permission-denied','You can only offer stops assigned to you.');
        if (incoming.routeId && !management && ctx.wide[incoming.routeOfferMode === 'partial' ? 'technicianCanOfferPartialRoutes' : 'technicianCanOfferFullRoutes'] === false) fail('permission-denied','Route coverage posting is disabled.');
        if (incoming.routeSplitAllowed && !can(actor,'326')) fail('permission-denied','Splitting work requires permission.');
        const purpose = incoming.workPurpose || (key(incoming.serviceStopTypeUseCaseRawValue).includes('estimate') ? 'diagnostic' : 'execution');
        if (purpose==='diagnostic' && !incoming.serviceStopTypeId) incoming.serviceStopTypeId='system_job_estimate_service_stop';
        if (job && purpose !== 'diagnostic' && !scope.tasks.length) fail('failed-precondition','Select the work to offer, or choose an estimate visit.');
        const status = ctx.wide.workOffersRequireApprovalBeforePosting || ctx.wide.workOffersGoLiveByDefault === false ? 'Pending Approval' : incoming.offerType === 'Direct User' ? 'Sent' : 'Posted';
        const offer = { ...incoming, id:offerId, companyId, status, schemaVersion:2, revision:(existing?.revision || 0)+1, workPurpose:purpose, scopeSnapshot:scope, scopeSignature:scopeSignature(scope), jobTaskIds:scope.tasks.filter(v=>!v.sourceStopId).map(v=>v.id), routeServiceStopIds:scope.stops.map(v=>v.id), serviceStopIds:scope.stops.map(v=>v.id), acceptedByUserId:'', acceptedByUserName:'', claims:[], createdAt:existing?.createdAt || now(), createdByUserId:existing?.createdByUserId || uid, createdByUserName:existing?.createdByUserName || actor.name, updatedAt:now(), rejectionReason:'', workerNotes:incoming.workerNotes || '', adminNotes:incoming.adminNotes || '', serviceStopId:incoming.serviceStopId || '', serviceStopInternalId:incoming.serviceStopInternalId || '', sourceLaborContractId:'', externalCompanyId:'', externalCompanyName:'' };
        if(offer.paySource==='Technician Rate') { offer.estimatedPayLines=[];offer.estimatedPayTotalCents=null;offer.estimatedLaborCents=0; }
        t.set(c.collection('workOffers').doc(offerId),offer);
        return { offerId, status, revision:offer.revision, estimatedPayTotalCents:offer.estimatedPayTotalCents ?? null };
      }
      const offerId = id(data.offerId), ref = c.collection('workOffers').doc(offerId);
      if (!offerId) fail('invalid-argument','Choose a work offer.');
      const offer = record(await t.get(ref)); if (!offer) fail('not-found','Work offer not found.');
      const claims = list(offer.claims), management = can(actor,'330');
      if(action==='verifyScheduledStop') {
        if(!can(actor,'324') && !claims.some(v=>v.workerId===uid))fail('permission-denied','Only the accepted technician or management can access scheduling.');
        if(!claims.some(v=>v.serviceStopId===id(data.serviceStopId)) && offer.serviceStopId!==id(data.serviceStopId))fail('failed-precondition','Use Schedule Work to create and link the stop atomically.');
        return {offerId,serviceStopId:id(data.serviceStopId)};
      }
      if (action === 'status') {
        if (data.status === 'Viewed') { await checkEligibility(t,c,actor,offer); if (['Sent','Posted'].includes(offer.status)) t.set(ref,{status:'Viewed',viewedAt:now()},{merge:true}); return {offerId,status:'Viewed'}; }
        if (!can(actor,'324') || !['Sent','Posted','Draft','Expired','Completed'].includes(data.status) || claims.some(v=>['Accepted','Scheduled','In Progress','Completed'].includes(v.status))) fail('permission-denied','Use the acceptance, approval, or cancellation workflow.');
        t.set(ref,{status:data.status,updatedAt:now()},{merge:true}); return {offerId,status:data.status};
      }
      if (action === 'details') {
        if (!can(actor,'324') && offer.acceptedByUserId!==uid && offer.offeredToUserId!==uid && offer.createdByUserId!==uid && !claims.some(v=>v.workerId===uid)) await checkEligibility(t,c,actor,offer);
        const {scope}=await scopeFor(t,c,offer),stored=offer.scopeSnapshot || scope;
        const display=Object.fromEntries(Object.entries(stored).map(([name,items])=>[name,list(items).map(item=>{const live=list(scope[name]).find(v=>v.id===item.id);return {...item,status:live?.status || item.status,operationStatus:live?.operationStatus || item.operationStatus};})]));
        const ownClaim=claims.find(v=>v.workerId===uid && !['Rejected','Cancelled','Transferred'].includes(v.status));
        if(ownClaim && !can(actor,'324')){display.stops=display.stops.filter(v=>ownClaim.stopIds.includes(v.id) || v.id===ownClaim.serviceStopId);display.tasks=display.tasks.filter(v=>ownClaim.taskIds.includes(v.id) || (ownClaim.agreement.stopTasks || []).some(ref=>ref.taskId===v.id && ref.stopId===v.sourceStopId));display.products=display.products.filter(v=>!v.sourceStopId || ownClaim.stopIds.includes(v.sourceStopId));}
        const agreed=ownClaim?.agreement || ((can(actor,'420') || can(actor,'424'))?offer.acceptedTerms || claims.find(v=>!['Rejected','Cancelled','Transferred'].includes(v.status))?.agreement:null);
        const pay=agreed?{baseCents:agreed.baseCents || 0,totalCents:agreed.totalCents || 0,incentiveCents:(agreed.totalCents || 0)-(agreed.baseCents || 0),lines:agreed.quotedPayLines || [],hourlyPaySource:agreed.settings?.hourlyPaySource || null}:null;
        return {pay,scope:presentScope(display),scopeChanged:!!offer.scopeSignature && offer.scopeSignature!==scopeSignature(scope)};
      }
      if (action === 'preview') {
        await checkEligibility(t,c,actor,offer);
        const {scope} = await scopeFor(t,c,offer);
        const all=scope.stops.map(v=>v.id), reserved=new Set([...(offer.transferredStopIds || []),...claims.filter(v=>!['Rejected','Cancelled','Transferred'].includes(v.status)).flatMap(v=>v.stopIds || [])]), available=all.filter(v=>!reserved.has(v)), selected=data.stopIds ? unique(data.stopIds).filter(v=>available.includes(v)) : available;
        const quotedOffer=all.length ? {...offer,offeredAmountCents:allocation(cents(offer.offeredAmountCents),all,selected),incentive:offer.incentive?.type==='flat'?{...offer.incentive,amountCents:allocation(cents(offer.incentive.amountCents),all,selected)}:offer.incentive} : offer;
        const preview = estimate({companyId,offer:quotedOffer,scope:{...scope,stops:scope.stops.filter(v=>selected.includes(v.id))},ctx,actor});
        const availableScope={...scope,stops:scope.stops.filter(v=>available.includes(v.id)),tasks:scope.tasks.filter(v=>!v.sourceStopId || selected.includes(v.sourceStopId)),products:scope.products.filter(v=>!v.sourceStopId || selected.includes(v.sourceStopId))};
        return { ...preview, hourlyPaySource:ctx.settings.hourlyPaySource || null,scope:presentScope(availableScope), revision:offer.revision || 1 };
      }
      if (action === 'accept') {
        if(offer.offeredToUserId && offer.offeredToUserId!==uid) fail('permission-denied','Only the named technician can accept this offer.');
        if (!can(actor,'334')) fail('permission-denied','You cannot accept offered work.');
        await checkEligibility(t,c,actor,offer);
        const previous=claims.find(v=>v.workerId===uid && !['Rejected','Cancelled','Transferred'].includes(v.status) && (v.id===id(data.claimId) || !(v.stopIds || []).length && !stopIds(offer).length || Array.isArray(data.stopIds) && v.stopIds.length===unique(data.stopIds).length && v.stopIds.every(value=>data.stopIds.includes(value))));
        if(previous)return {offerId,claimId:previous.id,status:previous.status,alreadyAccepted:true};
        if(claims.some(v=>v.workerId===uid && !['Rejected','Cancelled','Transferred'].includes(v.status)))fail('failed-precondition','You already hold a claim on this offer. Ask management for a separate offer for additional stops.');
        if (data.revision != null && Number(data.revision)!==Number(offer.revision || 1)) fail('failed-precondition','This offer changed. Review its latest scope and pay.');

        if (!['posted','sent','viewed','accepted'].includes(key(offer.status))) fail('failed-precondition','This offer is no longer open.');
        const {scope} = await scopeFor(t,c,offer);
        if (offer.scopeSignature && offer.scopeSignature!==scopeSignature({...scope,stops:scope.stops.map(stop=>(offer.transferredStopIds || []).includes(stop.id) || claims.some(claim=>!['Rejected','Cancelled','Transferred'].includes(claim.status)&&(claim.stopIds || []).includes(stop.id)) ? offer.scopeSnapshot?.stops?.find(original=>original.id===stop.id) || stop : stop)})) fail('failed-precondition','The job scope changed. Ask management to refresh this offer before accepting it.');
        const all = scope.stops.map(v=>v.id), reserved = new Set([...(offer.transferredStopIds || []),...claims.filter(v=>!['Rejected','Cancelled','Transferred'].includes(v.status)).flatMap(v=>v.stopIds)]);
        if (!all.length && claims.some(v=>!['Rejected','Cancelled'].includes(v.status)) || !all.length && offer.acceptedByUserId) fail('already-exists','Another technician already claimed this work.');
        const requested = unique(data.stopIds ? data.stopIds : all.filter(v=>!reserved.has(v)));
        if (requested.some(v=>!all.includes(v) || reserved.has(v)) || all.length && !requested.length) fail('already-exists','Some stops have already been claimed.');
        if (all.length && offer.routeSplitAllowed !== true && (requested.length!==all.length || reserved.size)) fail('failed-precondition','This route must stay together.');
        const scoped = { ...scope, stops:scope.stops.filter(v=>requested.includes(v.id)) };
        const mode = all.length ? coverageMode(ctx.wide) : ctx.wide.workOffersRequireApprovalBeforeAssignment || ctx.wide.workOffersAutoAssignOnAcceptance === false ? 'review' : 'automatic';
        const preview = estimate({companyId,offer:{...offer,offeredAmountCents:all.length ? allocation(cents(offer.offeredAmountCents),all,requested) : offer.offeredAmountCents,incentive:all.length && offer.incentive?.type==='flat'?{...offer.incentive,amountCents:allocation(cents(offer.incentive.amountCents),all,requested)}:offer.incentive},scope:scoped,ctx,actor});
        if (preview.needsReview && (ctx.settings.payrollEnabled===false || ctx.settings.companyPayrollEnabled===false || ctx.settings.payrollDisabled===true))fail('failed-precondition','Enable company payroll before accepting paid work.');
        if (!['Offered Amount','Unpaid'].includes(offer.paySource) && preview.needsReview) fail('failed-precondition','A manager must resolve missing pay setup before this work can be accepted.');
        const selectedTypes = new Set([...scope.tasks.map(v=>jobPayFields(v).payTypeId),...scope.stops.flatMap(v=>[v.payTypeId || v.typeId,...(v.defaultWorkTypeIds || [])]),offer.serviceStopTypeId].filter(Boolean));
        const agreement = { offerId, revision:offer.revision || 1, workerId:uid, workerName:actor.name, taskIds:scope.tasks.filter(v=>!v.sourceStopId).map(v=>v.id), stopTasks:scope.tasks.filter(v=>requested.includes(v.sourceStopId)).map(v=>({stopId:v.sourceStopId,taskId:v.id})), scopeStopIds:all, paySource:offer.paySource, rateDate:offer.proposedStartDate || scope.stops[0]?.serviceDate || now(), fixedAmountCents:cents(offer.offeredAmountCents), incentive:offer.incentive || {type:'none'}, rates:ctx.rates, settings:offer.paySource==='Task Contracted Rates'?{...ctx.settings,routePaySource:'completedTasks',taskPaySource:'taskContractedRate'}:ctx.settings, workTypes:ctx.workTypes.filter(v=>selectedTypes.has(v.id)), quotedPayLines:preview.lines, acceptedAt:now(), baseCents:preview.baseCents, totalCents:preview.totalCents };
        const claim = { id:id(data.claimId) || stable(offerId+'_'+uid+'_'+claims.length), workerId:uid, workerName:actor.name, workerType:actor.workerType, stopIds:requested, taskIds:scope.tasks.filter(v=>!v.sourceStopId).map(v=>v.id), status:mode==='review' ? 'Acceptance Pending Approval' : 'Accepted', agreement, createdAt:now() };
        agreement.claimId=claim.id;
        const apply = await prepareAssignment(t,c,offer,claim);
        if (mode !== 'review') apply();
        else {
          claim.taskIds.forEach(taskId=>t.set(c.collection('workOrders').doc(id(offer.jobId)).collection('tasks').doc(taskId),{claimedWorkOfferId:offer.id},{merge:true}));
          claim.stopIds.forEach(stopId=>t.set(c.collection('serviceStops').doc(stopId),{pendingWorkOfferId:offer.id},{merge:true}));
        }
        const next = [...claims,claim], remaining = all.filter(v=>!(offer.transferredStopIds || []).includes(v) && !new Set(next.filter(c=>!['Rejected','Cancelled','Transferred'].includes(c.status)).flatMap(c=>c.stopIds)).has(v));
        const status = remaining.length ? 'Posted' : mode==='review' ? 'Acceptance Pending Approval' : 'Accepted';
        t.set(ref,{claims:next,claimedByUserIds:unique(next.map(v=>v.workerId)),remainingStopIds:remaining,status,acceptedByUserId:uid,acceptedByUserName:actor.name,acceptedAt:now(),updatedAt:now(),...(!all.length ? { acceptedTerms:agreement } : {})},{merge:true});
        if (mode !== 'review') await notify(t,c,offer,claim,mode,actor.company.ownerId);
        return {offerId,claimId:claim.id,status:claim.status,baseCents:preview.baseCents,totalCents:preview.totalCents};
      }
      if (action === 'approve') {
        if (!management) fail('permission-denied','Management approval is required.');
        const pending = claims.filter(v=>v.status==='Acceptance Pending Approval' && (!data.claimId || v.id===data.claimId));
        if (pending.length>1) fail('invalid-argument','Choose one pending claim to approve at a time.');
        if (pending.length) {
          const {scope}=await scopeFor(t,c,offer);
          const unchangedClaims=claims.filter(claim=>!pending.some(p=>p.id===claim.id) && !['Rejected','Cancelled','Transferred'].includes(claim.status));
          const checked={...scope,stops:scope.stops.map(stop=>(offer.transferredStopIds || []).includes(stop.id) || unchangedClaims.some(claim=>(claim.stopIds || []).includes(stop.id)) ? offer.scopeSnapshot?.stops?.find(original=>original.id===stop.id) || stop : stop)};
          if (offer.scopeSignature && offer.scopeSignature!==scopeSignature(checked)) fail('failed-precondition','The job scope changed. Refresh this offer before approving it.');
        }
        const applies = []; for (const claim of pending) applies.push(await prepareAssignment(t,c,offer,claim));
        applies.forEach(apply=>apply());
        if (!pending.length && key(offer.status)!=='pendingapproval') fail('failed-precondition','There is no pending approval.');
        const next = claims.map(v=>pending.some(p=>p.id===v.id) ? {...v,status:'Accepted',approvedAt:now(),approvedByUserId:uid} : v);
        const remaining = stopIds(offer).filter(value=>!next.some(v=>v.stopIds.includes(value)&&v.status==='Accepted'));
        const status = pending.length ? remaining.length ? 'Posted' : 'Accepted' : offer.offerType === 'Direct User' ? 'Sent' : 'Posted';
        t.set(ref,{claims:next,status,approvedAt:now(),approvedByUserId:uid,acceptedTerms:!stopIds(offer).length && next[0] ? next[0].agreement : null,updatedAt:now()},{merge:true});
        return {offerId,status};
      }
      if (action === 'rejectClaim') {
        if (!management) fail('permission-denied','Management must review this claim.');
        const claim=claims.find(v=>v.id===data.claimId && v.status==='Acceptance Pending Approval');
        if(!claim) fail('failed-precondition','This claim is no longer waiting for review.');
        const taskDocs=offer.jobId ? await Promise.all(claim.taskIds.map(value=>t.get(c.collection('workOrders').doc(id(offer.jobId)).collection('tasks').doc(value)))) : [];
        const stopDocs=await Promise.all(claim.stopIds.map(value=>t.get(c.collection('serviceStops').doc(value))));
        taskDocs.filter(v=>v.exists && v.data().claimedWorkOfferId===offer.id).forEach(v=>t.set(v.ref,{claimedWorkOfferId:null},{merge:true}));
        stopDocs.filter(v=>v.exists && v.data().pendingWorkOfferId===offer.id).forEach(v=>t.set(v.ref,{pendingWorkOfferId:null},{merge:true}));
        const next=claims.map(v=>v.id===claim.id?{...v,status:'Rejected',decisionAt:now(),decisionByUserId:uid,reason:str(data.reason)}:v);
        const reserved=new Set(next.filter(v=>!['Rejected','Cancelled'].includes(v.status)).flatMap(v=>v.stopIds));
        const remaining=stopIds(offer).filter(v=>!reserved.has(v));
        const status=offer.offerType==='Direct User'?'Sent':'Posted';
        t.set(ref,{claims:next,status,remainingStopIds:remaining,acceptedByUserId:'',acceptedByUserName:'',updatedAt:now()},{merge:true});
        return {offerId,status};
      }
      if (action === 'reject' || action === 'cancel') {
        if (action==='cancel' && !can(actor,'324') && offer.createdByUserId!==uid) fail('permission-denied','You cannot cancel this offer.');
        if (action==='reject' && offer.offeredToUserId!==uid && !management) fail('permission-denied','Only direct recipients or managers can reject an offer.');
        if (claims.some(v=>['Accepted','Scheduled','In Progress','Completed'].includes(v.status))) fail('failed-precondition','Accepted work must be reassigned explicitly.');
        const pending=claims.filter(v=>v.status==='Acceptance Pending Approval');
        const reservedTasks=offer.jobId ? await Promise.all([...new Set(pending.flatMap(v=>v.taskIds))].map(value=>t.get(c.collection('workOrders').doc(id(offer.jobId)).collection('tasks').doc(value)))) : [];
        const reservedStops=await Promise.all([...new Set(pending.flatMap(v=>v.stopIds))].map(value=>t.get(c.collection('serviceStops').doc(value))));
        reservedTasks.filter(v=>v.exists && v.data().claimedWorkOfferId===offer.id).forEach(v=>t.set(v.ref,{claimedWorkOfferId:null},{merge:true}));
        reservedStops.filter(v=>v.exists && v.data().pendingWorkOfferId===offer.id).forEach(v=>t.set(v.ref,{pendingWorkOfferId:null},{merge:true}));
        t.set(ref,{status:action==='cancel'?'Cancelled':'Rejected',rejectionReason:str(data.reason),rejectedByUserId:uid,rejectedAt:now(),updatedAt:now()},{merge:true});
        return {offerId,status:action==='cancel'?'Cancelled':'Rejected'};
      }
      if (action === 'incentive') {
        if (!can(actor,'328') || ctx.wide.workOfferIncentivesCreatePayrollLines===false) fail('permission-denied','You cannot change incentives.');
        if (claims.length && !list(offer.remainingStopIds).length) fail('failed-precondition','This work has already been claimed. Offer additional work separately.');
        const value = data.incentive || {}; if (!['none','flat','percentage'].includes(value.type) || Number(value.amountCents || 0)<0 || Number(value.percentage || 0)<0) fail('invalid-argument','Enter a valid non-negative incentive.');
        const incentive = {type:value.type,amountCents:cents(value.amountCents),percentage:Number(value.percentage || 0),notes:str(value.notes)};
        t.set(ref,{incentive,revision:(offer.revision || 1)+1,incentiveUpdatedAt:now(),updatedAt:now()},{merge:true});
        return {offerId,status:offer.status};
      }
      fail('invalid-argument','Unknown work-offer action.');
    });
  }
  async function checkEligibility(t,c,actor,offer) {
    if (offer.offeredToUserId && offer.offeredToUserId!==actor.uid && !can(actor,'324')) fail('permission-denied','This offer is for another technician.');
    if(!actor.admin && (actor.user.status && key(actor.user.status)!=='active' || !['employee','contractor','independentcontractor'].includes(key(actor.workerType)))) fail('permission-denied','Only active company technicians can accept this work.');
    const deadline = offer.completionDeadlineAt || offer.proposedEndDate; if (deadline && date(deadline)<now()) fail('failed-precondition','This offer has expired.');
    if (offer.postedToBoard) {
      const boards = unique(offer.boardIds);
      const boardRows = (await Promise.all(boards.map(value=>t.get(c.collection('workOfferBoards').doc(value))))).map(record).filter(Boolean);
      const members = unique([...list(offer.boardMemberUserIds), ...boardRows.flatMap(v=>list(v.memberUserIds))]);
      if (boards.length && !boardRows.some(v=>list(v.memberUserIds).includes(actor.uid)) && !actor.admin || !boards.length && members.length && !members.includes(actor.uid) && !actor.admin) fail('permission-denied','You are not a member of this board.');
      if (!actor.admin && (offer.boardVisibility==='Employees Only' && key(actor.workerType)!=='employee' || offer.boardVisibility==='Contractors Only' && !['contractor','independentcontractor'].includes(key(actor.workerType)) || offer.boardVisibility==='Admins Only')) fail('permission-denied','You are not eligible for this board.');
    }
  }
  return { command, actorFor, context, scopeFor, estimate, can, company };
}
module.exports = {createTechnicianWorkWorkflow, coverageMode, allocation, routeIds, stopIds, date, rows, record, id, key, done, stable, agreementReference};
