import { CheckoutProvider } from '@stripe/react-stripe-js/checkout';
import { loadStripe } from '@stripe/stripe-js';
import {firebaseEnvironment} from '../../../../firebase';
import {stripePublishableKeyForEnvironment} from '../../../../utils/stripeEnvironment';

const stripePublishableKey = stripePublishableKeyForEnvironment(firebaseEnvironment);
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : Promise.resolve(null);

const SubscriptionCheckOut= () => {
    return (
        <CheckoutProvider stripe={stripePromise}>
            {/* Your components */}
        </CheckoutProvider>
    );
}    
export default SubscriptionCheckOut;
