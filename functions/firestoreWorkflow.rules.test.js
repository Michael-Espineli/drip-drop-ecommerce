const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const {initializeApp,deleteApp}=require('firebase/app');
const {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,setDoc,updateDoc,collection,query,where,terminate}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST) throw Error('This test requires the local Firestore emulator.');
const projectId='demo-dripdrop-workflow';
admin.initializeApp({projectId});const db=admin.firestore(),clients=[];
function client(uid){const app=initializeApp({projectId,apiKey:'local-test'},uid);const firestore=getFirestore(app);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(firestore,host,Number(port),{mockUserToken:{sub:uid,user_id:uid}});clients.push({app,firestore});return firestore;}
const tech=client('tech'),manager=client('manager'),viewer=client('viewer'),outsider=client('outsider');
const p='companies/company/';
const seeded=(async()=>{const docs={
 'companies/company':{ownerId:'owner'},'users/tech/userAccess/company':{roleId:'tech',roleName:'Technician'},'users/manager/userAccess/company':{roleId:'manager',roleName:'Team Lead'},'users/viewer/userAccess/company':{roleId:'viewer',roleName:'Viewer'},
 [p+'roles/tech']:{permissionIdList:['322','334']},[p+'roles/manager']:{permissionIdList:['424']},[p+'roles/viewer']:{permissionIdList:['420']},
 [p+'technicianRates/own']:{technicianId:'tech',amountCents:5000},[p+'technicianRates/other']:{technicianId:'other',amountCents:8000},
 [p+'technicianPayLineItems/own']:{technicianId:'tech',totalAmountCents:5000},[p+'technicianPayLineItems/other']:{technicianId:'other',totalAmountCents:8000},
 [p+'workOffers/offer']:{postedToBoard:true,status:'Posted',createdByUserId:'tech',claims:[]},[p+'payChangeRequests/own']:{technicianId:'tech'},[p+'payChangeRequests/other']:{technicianId:'other'},
 [p+'workLogs/own']:{userId:'tech',current:true},[p+'workLogs/other']:{userId:'other',current:true},[p+'shifts/own']:{techId:'tech',isCurrent:true},[p+'settings/companyWide']:{routeCoverageMode:'review'},[p+'paySettings/main']:{payrollEnabled:true},
 [p+'workOrders/job/tasks/task']:{workerId:'tech',payTypeId:'repair',status:'Scheduled'},[p+'serviceStops/stop']:{techId:'tech',payTypeId:'repair',operationStatus:'Not Finished'}
 };const batch=db.batch();Object.entries(docs).forEach(([path,value])=>batch.set(db.doc(path),value));await batch.commit();})();
const denied=fn=>assert.rejects(fn,error=>error.code==='permission-denied');
test('technicians read their own pay and cannot list or read another technician pay',async()=>{await seeded;await getDoc(doc(tech,p+'technicianPayLineItems/own'));await getDocs(query(collection(tech,p+'technicianPayLineItems'),where('technicianId','==','tech')));await denied(()=>getDocs(collection(tech,p+'technicianPayLineItems')));await denied(()=>getDoc(doc(tech,p+'technicianPayLineItems/other')));await denied(()=>getDoc(doc(tech,p+'technicianRates/other')));});
test('clients cannot forge pay, rates, decisions, work claims, clock records, or company approval policy',async()=>{await seeded;for(const [path,value] of [['technicianPayLineItems/own',{totalAmountCents:999999}],['technicianRates/own',{amountCents:999999}],['payChangeRequests/own',{status:'Approved'}],['workOffers/offer',{acceptedByUserId:'tech',status:'Accepted'}],['workLogs/own',{current:false}],['shifts/own',{isCurrent:false}],['settings/companyWide',{routeCoverageMode:'automatic'}],['paySettings/main',{payrollEnabled:false}],['roles/tech',{permissionIdList:['424']}]] ) await denied(()=>updateDoc(doc(tech,p+path),value));});
test('clock and request history is private and offered-work snapshots use the server list',async()=>{await seeded;await getDoc(doc(tech,p+'workLogs/own'));await getDoc(doc(tech,p+'payChangeRequests/own'));await denied(()=>getDoc(doc(tech,p+'workLogs/other')));await denied(()=>getDoc(doc(tech,p+'payChangeRequests/other')));await denied(()=>getDoc(doc(tech,p+'workOffers/offer')));await denied(()=>getDoc(doc(outsider,p+'paySettings/main')));});
test('pay readers and pay managers have distinct financial capabilities',async()=>{await seeded;await getDocs(collection(viewer,p+'technicianPayLineItems'));await denied(()=>updateDoc(doc(viewer,p+'technicianRates/own'),{amountCents:6000}));await updateDoc(doc(manager,p+'technicianRates/own'),{amountCents:6000});await denied(()=>updateDoc(doc(manager,p+'workOffers/offer'),{status:'Accepted'}));});
test('normal task completion cannot smuggle a pay-term or assignment change',async()=>{await seeded;await updateDoc(doc(tech,p+'workOrders/job/tasks/task'),{status:'Finished'});await denied(()=>updateDoc(doc(tech,p+'workOrders/job/tasks/task'),{contractedRate:999999}));await denied(()=>updateDoc(doc(tech,p+'workOrders/job/tasks/task'),{workerId:'other'}));await denied(()=>updateDoc(doc(tech,p+'serviceStops/stop'),{manualPayOverrideCents:999999}));});
test('new tasks cannot smuggle a contracted payment, accepted terms, or self-assignment',async()=>{await seeded;
 for(const payload of [{contractedRate:999999},{payrollAgreement:{offerId:'fake'}},{workerId:'tech',status:'Finished'}])await denied(()=>setDoc(doc(tech,p+'workOrders/job/tasks/forged'),payload));
 await setDoc(doc(tech,p+'workOrders/job/tasks/draft'),{name:'Additional finding',status:'Draft',workerId:'',contractedRate:0,payTypeId:'repair'});
});
after(async()=>{for(const item of clients){await terminate(item.firestore);await deleteApp(item.app);}await admin.app().delete();});
