const {test}=require('node:test');
const assert=require('node:assert/strict');
const {legacyCallable}=require('./legacyCallable');
test('legacy billing handlers receive Firebase’s verified v2 auth and the actual payload',async()=>{
 const callable=legacyCallable((data,context)=>({companyId:data.companyId,uid:context.auth?.uid}));
 assert.deepEqual(await callable.run({data:{companyId:'company',auth:{uid:'forged'}},auth:{uid:'verified'},rawRequest:{on(){}}}),{companyId:'company',uid:'verified'});
 assert.equal(callable.__endpoint.platform,'gcfv2');
});
test('caller-provided auth cannot authenticate an anonymous v2 request',async()=>{
 const callable=legacyCallable((_data,context)=>context.auth?.uid || null);
 assert.equal(await callable.run({data:{auth:{uid:'forged'},rawRequest:{on:'forged'}},rawRequest:{on(){}}}),null);
});
test('direct legacy calls retain their data/context shape and callable options',async()=>{
 const callable=legacyCallable({timeoutSeconds:120},(data,context)=>({value:data.value,uid:context.auth.uid}));
 assert.deepEqual(await callable.run({value:42},{auth:{uid:'owner'}}),{value:42,uid:'owner'});
 assert.equal(callable.__endpoint.timeoutSeconds,120);
});
