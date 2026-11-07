#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const dotenv=require('../functions/node_modules/dotenv'),Stripe=require('../functions/node_modules/stripe');
const {createStripeWebhookSetup}=require('../functions/stripeWebhookSetup');
const {connectedEvents,missingEvents}=require('../functions/stripeWebhookPolicy');
const args=process.argv.slice(2),mode=args[0] || 'plan',project=args[1];
if(!['plan','stage','activate'].includes(mode) || !['the-pool-app-3e652','the-pool-app-dev'].includes(project))throw Error('Usage: reconcile-stripe-webhooks.cjs plan|stage|activate PROJECT_ID [STATE_FILE]');
const envPath=path.join(root,'functions',`.env.${project}`),env=dotenv.parse(fs.readFileSync(envPath));
const key=env.STRIPE_API_KEY || env.STRIPE_SECRET_KEY;
if(!key || project==='the-pool-app-dev' && !key.startsWith('sk_test_') || project==='the-pool-app-3e652' && !key.startsWith('sk_live_'))throw Error('The Stripe key is missing or has the wrong environment mode.');
const stripe=Stripe(key,{apiVersion:'2025-02-24.acacia',maxNetworkRetries:2});
const url=env.STRIPE_WEBHOOK_URL || (project==='the-pool-app-3e652'?'https://stripewebhook-52bwqpekza-uc.a.run.app':`https://us-central1-${project}.cloudfunctions.net/stripeWebHook`);
const statePath=args[2] || path.resolve(root,'../outputs/billing-repairs-2026-11-06',`stripe-webhook-${project}.json`);
const loadSecrets=()=>{const current=dotenv.parse(fs.readFileSync(envPath));return [...new Set([...(current.STRIPE_WEBHOOK_SECRET || '').split(','),...(current.STRIPE_WEBHOOK_SECRETS || '').split(',')].map(s=>s.trim()).filter(Boolean))];};
const worker=createStripeWebhookSetup(stripe,{url,loadState:()=>fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):null,
 saveState:state=>{fs.mkdirSync(path.dirname(statePath),{recursive:true});fs.writeFileSync(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});},loadSecrets,
 saveSecret:secret=>{const all=[...new Set([...loadSecrets(),secret])];let content=fs.readFileSync(envPath,'utf8');const line=`STRIPE_WEBHOOK_SECRETS=${all.join(',')}`;content=/^STRIPE_WEBHOOK_SECRETS=.*$/m.test(content)?content.replace(/^STRIPE_WEBHOOK_SECRETS=.*$/m,line):content.trimEnd()+'\n'+line+'\n';fs.writeFileSync(envPath,content,{mode:0o600});}});
(async()=>{
 if(mode==='plan'){const endpoints=await worker.plan();console.log(JSON.stringify({project,url,signingSecretCount:loadSecrets().length,endpoints:endpoints.map(e=>({id:e.id,status:e.status,apiVersion:e.api_version,scope:e.metadata?.dripdropWebhookScope || 'legacy',missingConnectedEvents:missingEvents(e.enabled_events,connectedEvents)}))},null,2));}
 else if(mode==='stage'){const state=await worker.stage();console.log(JSON.stringify({project,statePath,endpoints:state.endpoints.map(({id,scope})=>({id,scope})),message:'Replacement endpoints staged. Deploy stripeWebHook with the saved signing secrets, then activate.'},null,2));}
 else {const state=await worker.activate(async(url,secret)=>{const payload=JSON.stringify({id:`evt_configuration_probe_${Date.now()}`,object:'event',type:'billing.configuration_probe',data:{object:{id:'configuration_probe'}}});const signature=stripe.webhooks.generateTestHeaderString({payload,secret});const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature},body:payload});return response.status===200;});console.log(JSON.stringify({project,activated:state.activated,endpoints:state.endpoints.map(({id,scope})=>({id,scope})),retiredEndpointIds:state.legacyIds},null,2));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
