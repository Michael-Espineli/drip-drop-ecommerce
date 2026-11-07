import {stripePublishableKeyForEnvironment} from './stripeEnvironment';
test('development and production select only their respective publishable keys',()=>{
 const keys={REACT_APP_STRIPE_DEVELOPMENT_PUBLISHABLE_KEY:'pk_test_fixture',REACT_APP_STRIPE_PUBLISHABLE_KEY:'pk_live_fixture'};
 expect(stripePublishableKeyForEnvironment('development',keys)).toBe('pk_test_fixture');
 expect(stripePublishableKeyForEnvironment('production',keys)).toBe('pk_live_fixture');
 expect(stripePublishableKeyForEnvironment('production',{REACT_APP_STRIPE_DEVELOPMENT_PUBLISHABLE_KEY:'pk_test_fixture'})).toBe('');
 expect(()=>stripePublishableKeyForEnvironment('production',{REACT_APP_STRIPE_PUBLISHABLE_KEY:'pk_test_fixture'})).toThrow(/wrong mode/);
 expect(()=>stripePublishableKeyForEnvironment('development',{REACT_APP_STRIPE_DEVELOPMENT_PUBLISHABLE_KEY:'pk_live_fixture'})).toThrow(/wrong mode/);
});
