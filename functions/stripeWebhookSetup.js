const {createHash}=require('node:crypto');
const policy=require('./stripeWebhookPolicy');
const digest=value=>createHash('sha256').update(value).digest('hex');

// State stores endpoint IDs and secret hashes only. The caller keeps the actual
// signing secrets in its environment file, never in logs or migration reports.
function createStripeWebhookSetup(stripe,{url,loadState,saveState,loadSecrets,saveSecret}) {
  async function plan(){
    const page=await stripe.webhookEndpoints.list({limit:100});
    if(page.has_more)throw Error('More than 100 endpoints need explicit review before changing configuration.');
    return page.data.filter(endpoint=>endpoint.url===url);
  }
  async function stage(){
    const endpoints=await plan();let state=loadState();
    if(!state){state={url,policyVersion:'billing-2026-11-06',legacyIds:endpoints.filter(e=>e.status==='enabled' && e.metadata?.dripdropWebhookPolicy!=='billing-2026-11-06').map(e=>e.id),endpoints:[]};saveState(state);}
    if(state.url!==url)throw Error('The saved webhook migration belongs to another URL.');
    if(state.activated)return state;
    for(const scope of ['connected','platform']){
      const saved=state.endpoints.find(e=>e.scope===scope);
      if(saved){await stripe.webhookEndpoints.update(saved.id,{disabled:true});continue;}
      const endpoint=await stripe.webhookEndpoints.create({url,connect:scope==='connected',api_version:policy.snapshotApiVersion,
        enabled_events:scope==='connected'?policy.connectedEvents:policy.platformEvents,
        description:`DripDrop ${scope} billing — verified event policy`,metadata:{dripdropWebhookScope:scope,dripdropWebhookPolicy:state.policyVersion}},
        {idempotencyKey:`webhook_${digest(`${url}:${scope}:${state.policyVersion}`)}`});
      if(!endpoint.secret)throw Error('Stripe did not return the new endpoint signing secret.');
      saveSecret(endpoint.secret);
      state.endpoints.push({id:endpoint.id,scope,secretHash:digest(endpoint.secret)});saveState(state);
      await stripe.webhookEndpoints.update(endpoint.id,{disabled:true});
    }
    return state;
  }
  async function activate(probe){
    const state=loadState();if(!state || state.url!==url || state.endpoints.length!==2)throw Error('Stage both endpoint scopes first.');
    const endpoints=await plan();
    for(const expected of state.endpoints){
      const endpoint=endpoints.find(e=>e.id===expected.id),required=expected.scope==='connected'?policy.connectedEvents:policy.platformEvents;
      if(!endpoint || endpoint.api_version!==policy.snapshotApiVersion || policy.missingEvents(endpoint.enabled_events,required).length)throw Error(`Endpoint ${expected.id} no longer matches the tested policy.`);
      const secret=loadSecrets().find(secret=>digest(secret)===expected.secretHash);
      if(!secret || !await probe(url,secret))throw Error(`The deployed webhook did not verify the ${expected.scope} signing secret. Existing endpoints remain enabled.`);
    }
    for(const endpoint of state.endpoints)await stripe.webhookEndpoints.update(endpoint.id,{disabled:false});
    // Retain old endpoint definitions for rollback; retire only the IDs captured
    // in this migration, after both replacements pass signature verification.
    for(const endpointId of state.legacyIds) {
      if(endpoints.some(e=>e.id===endpointId))await stripe.webhookEndpoints.update(endpointId,{disabled:true});
    }
    state.activated=true;state.activatedAt=new Date().toISOString();saveState(state);return state;
  }
  return {plan,stage,activate};
}
module.exports={createStripeWebhookSetup};
