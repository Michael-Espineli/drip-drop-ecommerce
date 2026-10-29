const { createHash } = require('node:crypto');
const { fail } = require('./companyActor');
const str = v => String(v ?? '').trim();
const ids = values => [...new Set((values || []).map(v => str(typeof v === 'object' ? v?.id : v)).filter(Boolean))];
const date = value => { if(value==null)return null; const d = value?.toDate?.() || new Date(value instanceof Date ? value.getTime() : value?.seconds != null ? value.seconds * 1000 : value?._seconds != null ? value._seconds * 1000 : value); return Number.isFinite(d.getTime()) ? d : null; };
const normalized = value => str(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
const finished = value => ['finished','completed','complete','done','skipped','cancelled','canceled'].includes(normalized(value?.operationStatus || value?.status)) || Boolean(value?.endTime || value?.finishedAt || value?.completedAt);
const started = value => finished(value) || Boolean(value?.startTime || value?.startedAt || value?.actualTime > 0) || ['inprogress','started'].includes(normalized(value?.operationStatus || value?.status));
function timeZone(company = {}, fallback = 'UTC') {
  const zone = company.timeZone || company.timezone || company.timeZoneId || fallback || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date()); return zone; } catch (_) { fail('invalid-argument', 'Choose a valid company timezone.'); }
}
function dateKey(value, zone = 'UTC') {
  const d = date(value); if (!d) fail('invalid-argument', 'A valid service date is required.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
  const p = Object.fromEntries(parts.map(v => [v.type,v.value])); return `${p.year}-${p.month}-${p.day}`;
}
function calendarDate(key, zone = 'UTC', hour = 12) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(key))) fail('invalid-argument', 'Use a calendar date in YYYY-MM-DD format.');
  const [y,m,d] = key.split('-').map(Number), target = Date.UTC(y,m-1,d,hour);
  if (new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10) !== key) fail('invalid-argument', 'The calendar date is invalid.');
  let result = new Date(target);
  for (let n=0;n<3;n++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(result).map(v=>[v.type,v.value]));
    const offset = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second) - result.getTime();
    result = new Date(target-offset);
  }
  return result;
}
const addCalendarDays = (key, count) => { const d = new Date(key+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10); };
const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function shiftDay(key, target) { const index=weekdays.indexOf(target); if(index<0)fail('invalid-argument','Select a valid weekday.');return addCalendarDays(key,(index-new Date(key+'T12:00:00Z').getUTCDay()+7)%7); }
const routeStopIds = route => ids([...(route.serviceStopsIds || route.serviceStopIds || []),...(route.order || []).map(v=>v.serviceStopId)]);
const recurringOrder = route => route.order?.length ? route.order : route.recurringRouteOrder || [];
const recurringIds = route => ids([...(route.rssIds || []),...recurringOrder(route).map(v=>v.recurringServiceStopId)]);
const stable = value => createHash('sha256').update(value).digest('hex').slice(0,32);
function newActiveRoute({companyId, workerId, workerName, dayKey, zone}) {
  return { id:`com_ar_${dayKey.replace(/-/g,'')}_${workerId}`, companyId, date:calendarDate(dayKey,zone,0), serviceDateKey:dayKey,
    techId:workerId, techName:workerName, tech:workerName, name:`${workerName}'s Route`, serviceStopsIds:[], order:[], totalStops:0, finishedStops:0,
    status:'Did Not Start', durationSeconds:0, durationMin:0, distanceMiles:0, distance:0, vehicalId:'', vehicleSource:'', personalVehicleOwnerId:'',
    vehicleLabel:'', vehiclePlate:'', vehicleKind:'', startTime:null, endTime:null, startMilage:null, endMilage:null, startMileage:null, endMileage:null };
}
function orderedRoute(route, stops) {
  const byId = new Map(stops.map(s=>[s.id,s]));
  const orderIds = ids([...[...(route.order || [])].sort((a,b)=>Number(a.order||0)-Number(b.order||0)).map(v=>v.serviceStopId),...(route.serviceStopsIds || [])]);
  const ordered = [...orderIds.filter(id=>byId.has(id)),...stops.map(s=>s.id).filter(id=>!orderIds.includes(id))];
  const old = new Map((route.order || []).map(v=>[v.serviceStopId,v]));
  const order=ordered.map((id,i)=>({...(old.get(id)||{}),id:old.get(id)?.id || 'route_order_'+id,serviceStopId:id,recurringServiceStopId:str(byId.get(id).recurringServiceStopId),order:i+1}));
  const finishedStops=stops.filter(finished).length;
  // Closing the workday and completing visits are separate. Never clear clock,
  // vehicle, mileage, or historical closeout evidence while moving membership.
  const status=route.endTime ? route.status : stops.length && finishedStops===stops.length && route.endMilage!=null ? 'Finished'
    : route.startTime || route.startMilage!=null || finishedStops>0 || stops.some(started) ? (['Traveling','Break','On Break'].includes(route.status)?route.status:'In Progress') : 'Did Not Start';
  return { ...route, serviceStopsIds:ordered, order, totalStops:ordered.length, finishedStops, status, membershipState:ordered.length?'Active':'Empty' };
}
module.exports={str,ids,date,normalized,finished,started,timeZone,dateKey,calendarDate,addCalendarDays,shiftDay,weekdays,routeStopIds,recurringOrder,recurringIds,stable,newActiveRoute,orderedRoute};
