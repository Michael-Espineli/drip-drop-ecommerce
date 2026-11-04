const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const {initializeApp,deleteApp}=require('firebase/app');
const {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,setDoc,updateDoc,collection,query,where,terminate}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Local Firestore emulator required.');
const projectId='demo-client-portal';admin.initializeApp({projectId});const db=admin.firestore(),clients=[];
function client(uid,verified=true){const app=initializeApp({projectId,apiKey:'local-test'},`${uid}-${verified}`),store=getFirestore(app);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(store,host,Number(port),{mockUserToken:{sub:uid,user_id:uid,email:'homeowner@example.test',email_verified:verified}});clients.push({app,store});return store;}
const homeowner=client('homeowner'),other=client('other'),unverified=client('unverified',false);
const seeded=(async()=>{const records={
 'companies/company':{ownerId:'owner'},'companies/company/customers/customer':{email:'homeowner@example.test',linkedCustomerIds:['homeowner']},
 'customerCompanyRelationships/relation':{companyId:'company',companyCustomerId:'customer',homeownerUserId:'homeowner',status:'active'},
 'homeownerServiceRequests/request':{homeownerId:'homeowner',customerUserId:'homeowner',companyId:'company'},
 'homeownerServiceLocations/site':{userId:'homeowner',linkedCompanyId:'company'},
 'homeownerBodiesOfWater/pool':{userId:'homeowner',serviceLocationId:'site'},
 'homeownerEquipment/pump':{userId:'homeowner',bodyOfWaterId:'pool'},
 'homeownerRepairRequests/request':{userId:'homeowner',equipmentId:'pump',companyId:'company'},
 'homeownerServiceStops/stop':{userId:'homeowner',companyId:'company',status:'Finished'},
 'salesInvoices/unlinked':{customerUserId:'',companyId:'company',email:'homeowner@example.test',status:'open'},
 'salesInvoices/linked':{customerUserId:'homeowner',companyId:'company',email:'homeowner@example.test',status:'open'},
 'salesInvoices/foreign':{customerUserId:'someone-else',companyId:'company',email:'homeowner@example.test',status:'open'},
};const batch=db.batch();Object.entries(records).forEach(([path,value])=>batch.set(db.doc(path),value));await batch.commit();})();
const denied=fn=>assert.rejects(fn,error=>error.code==='permission-denied');
test('homeowner request and connected company lists accept their canonical and legacy owner fields',async()=>{await seeded;assert.equal((await getDocs(query(collection(homeowner,'homeownerServiceRequests'),where('homeownerId','==','homeowner')))).size,1);assert.equal((await getDocs(query(collection(homeowner,'customerCompanyRelationships'),where('homeownerUserId','==','homeowner')))).size,1);await denied(()=>getDoc(doc(other,'customerCompanyRelationships/relation')));});
test('dependent pools, equipment and repair history require owner-scoped queries',async()=>{await seeded;for(const [group,parent,id]of [['homeownerBodiesOfWater','serviceLocationId','site'],['homeownerEquipment','bodyOfWaterId','pool'],['homeownerRepairRequests','equipmentId','pump']]){assert.equal((await getDocs(query(collection(homeowner,group),where(parent,'==',id),where('userId','==','homeowner')))).size,1);await denied(()=>getDocs(query(collection(other,group),where(parent,'==',id))));}});
test('homeowners cannot forge company relationships, publish visits, bypass repair validation or change record ownership',async()=>{await seeded;await denied(()=>setDoc(doc(homeowner,'customerCompanyRelationships/forged'),{homeownerUserId:'homeowner',companyId:'company',status:'active'}));await denied(()=>setDoc(doc(homeowner,'homeownerRepairRequests/forged'),{userId:'homeowner',companyId:'company'}));await denied(()=>updateDoc(doc(homeowner,'homeownerServiceStops/stop'),{status:'Finished',notes:'Forged'}));await denied(()=>updateDoc(doc(homeowner,'homeownerServiceLocations/site'),{userId:'other'}));await denied(()=>updateDoc(doc(homeowner,'homeownerServiceLocations/site'),{linkedCompanyServiceLocationId:'foreign'}));await updateDoc(doc(homeowner,'homeownerServiceLocations/site'),{nickName:'My home'});});
test('unclaimed finance needs verified email and cannot expose another linked customer',async()=>{await seeded;await denied(()=>getDoc(doc(unverified,'salesInvoices/unlinked')));await getDoc(doc(homeowner,'salesInvoices/unlinked'));await getDoc(doc(homeowner,'salesInvoices/linked'));await denied(()=>getDoc(doc(other,'salesInvoices/foreign')));const records=await getDocs(query(collection(homeowner,'salesInvoices'),where('email','==','homeowner@example.test'),where('customerUserId','in',['',null])));assert.deepEqual(records.docs.map(d=>d.id),['unlinked']);});
test('legacy raw CRM previews remain private while the customer claims through the callable',async()=>{await seeded;await denied(()=>getDoc(doc(homeowner,'companies/company/customers/customer')));await denied(()=>getDoc(doc(other,'homeownerServiceStops/stop')));});
after(async()=>{for(const {app,store}of clients){await terminate(store);await deleteApp(app);}await admin.app().delete();});
