import { CheckoutProvider } from '@stripe/react-stripe-js/checkout';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe('pk_live_51SR0FQAarMCMczenzad9KHz2dWM4tcMlSN1aquZVdN83md983TatYFy02H3usQAWeWldDMmlnPbVw5PvmhdjsXbn00sJx5TPCF');

const SubscriptionCheckOut= () => {
    return (
        <CheckoutProvider stripe={stripePromise}>
            {/* Your components */}
        </CheckoutProvider>
    );
}    
export default SubscriptionCheckOut;