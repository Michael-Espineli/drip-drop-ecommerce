export function stripePublishableKeyForEnvironment(firebaseEnvironment,environment=process.env){
 const development=firebaseEnvironment==='development';
 const key=development?environment.REACT_APP_STRIPE_DEVELOPMENT_PUBLISHABLE_KEY || '':environment.REACT_APP_STRIPE_PUBLISHABLE_KEY || '';
 if(key&&!key.startsWith(development?'pk_test_':'pk_live_'))throw new Error(`Stripe ${development?'development':'production'} publishable key has the wrong mode.`);
 return key;
}
