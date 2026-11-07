const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {getStripeApiKey}=require('./stripe/stripeClient');
const saved={...process.env};
function configuration(project,key){process.env.GCLOUD_PROJECT=project;process.env.STRIPE_API_KEY=key;delete process.env.STRIPE_SECRET_KEY;delete process.env.stripe_secret_key;}
test('development and production reject each other’s processor credentials before creating a Stripe client',()=>{
 configuration('the-pool-app-dev','sk_live_fixture');assert.throws(getStripeApiKey,{code:'failed-precondition'});
 configuration('the-pool-app-dev','sk_test_fixture');assert.equal(getStripeApiKey(),'sk_test_fixture');
 configuration('the-pool-app-3e652','sk_test_fixture');assert.throws(getStripeApiKey,{code:'failed-precondition'});
 configuration('the-pool-app-3e652','sk_live_fixture');assert.equal(getStripeApiKey(),'sk_live_fixture');
});
after(()=>{for(const key of ['GCLOUD_PROJECT','STRIPE_API_KEY','STRIPE_SECRET_KEY','stripe_secret_key']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
