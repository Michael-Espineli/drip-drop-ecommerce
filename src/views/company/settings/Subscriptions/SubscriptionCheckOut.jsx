import { CheckoutProvider } from '@stripe/react-stripe-js/checkout';
import { loadStripe } from '@stripe/stripe-js';

const stripePublishableKey = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : Promise.resolve(null);

const SubscriptionCheckOut= () => {
    return (
        <CheckoutProvider stripe={stripePromise}>
            {/* Your components */}
        </CheckoutProvider>
    );
}    
export default SubscriptionCheckOut;
