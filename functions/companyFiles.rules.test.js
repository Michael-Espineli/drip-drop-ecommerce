const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { initializeApp, deleteApp } = require('firebase/app');
const { getStorage, connectStorageEmulator, ref, uploadBytes, getBytes, deleteObject } = require('firebase/storage');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw Error('Local Firestore and Storage emulators required.');
const projectId='demo-company-permissions';admin.initializeApp({projectId});const db=admin.firestore(),apps=[];
function client(uid){const app=initializeApp({projectId,apiKey:'local-test',storageBucket:`${projectId}.appspot.com`},uid);apps.push(app);const store=getStorage(app);const [host,port]=process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');connectStorageEmulator(store,host,Number(port),{mockUserToken:{sub:uid,user_id:uid}});return store;}
const owner=client('owner'),worker=client('worker'),files=client('files'),outsider=client('outsider'),revoked=client('revoked');
const seeded=(async()=>{const records={
 'companies/files-company':{ownerId:'owner'},'companies/foreign':{ownerId:'foreign-owner'},
 'users/worker/userAccess/files-company':{roleId:'worker',roleName:'Technician',active:true},
 'companies/files-company/roles/worker':{permissionIdList:['100','102','104','106','240']},
 'users/files/userAccess/files-company':{roleId:'files',roleName:'Custom',active:true},
 'companies/files-company/roles/files':{permissionIdList:['268','274']},
 'users/revoked/userAccess/files-company':{roleId:'worker',roleName:'Manager',active:false,status:'Revoked'},
 'companies/files-company/serviceStops/own':{techId:'worker'},'companies/files-company/serviceStops/other':{techId:'other'},
};const batch=db.batch();Object.entries(records).forEach(([path,value])=>batch.set(db.doc(path),value));await batch.commit();})();
const denied=fn=>assert.rejects(fn,error=>error.code==='storage/unauthorized');
const upload=(store,path,type='image/png')=>uploadBytes(ref(store,path),new Uint8Array([1,2,3]),{contentType:type});
test('receipts are company scoped, role gated, and revoked memberships cannot access them',async()=>{
 await seeded;const path='companies/files-company/receipts/receipt/file.png';await upload(worker,path);
 await getBytes(ref(worker,path));
 for(const store of [outsider,revoked]){await denied(()=>getBytes(ref(store,path)));await denied(()=>upload(store,path));await denied(()=>deleteObject(ref(store,path)));}
 await denied(()=>upload(worker,'companies/foreign/receipts/receipt/file.png'));await deleteObject(ref(worker,path));
});
test('legacy unscoped repair-request files are closed',async()=>{await seeded;await denied(()=>upload(worker,'repair-request/request/file.png'));});
test('private personnel files require explicit grants and do not follow directory/receipt viewing',async()=>{
 await seeded;const path='companies/files-company/companyUsers/other/files/private.pdf';await upload(files,path,'application/pdf');await getBytes(ref(files,path));
 await denied(()=>getBytes(ref(worker,path)));await denied(()=>getBytes(ref(outsider,path)));await denied(()=>upload(worker,path,'application/pdf'));await deleteObject(ref(files,path));
});
test('assigned technicians can upload stop photos but cannot alter other technicians photos',async()=>{
 await seeded;await upload(worker,'companies/files-company/serviceStops/own/photo.png');
 await denied(()=>upload(worker,'companies/files-company/serviceStops/other/photo.png'));
});
test('company owner can use company files without a membership document',async()=>{await seeded;await upload(owner,'companies/files-company/receipts/owner/file.pdf','application/pdf');});
after(async()=>{for(const app of apps)await deleteApp(app);await admin.app().delete();});
