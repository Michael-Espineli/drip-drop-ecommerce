import React from 'react';
import {useSearchParams} from 'react-router-dom';

export default function PaymentMethodSetupReturn(){
 const [params]=useSearchParams(),canceled=params.get('paymentSetup')==='canceled';
 return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-slate-950"><section className="max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
  <h1 className="text-2xl font-bold">Payment method setup</h1>
  <p>{canceled?'You left the Stripe setup page. Contact your service company when you are ready to finish.':'You have returned from Stripe. Your service company can confirm when your saved payment method is ready.'}</p>
  {!canceled&&<p>If your bank account needs verification, follow Stripe’s verification instructions before it can be used for payment.</p>}
  <p>Saving payment details does not pay an invoice. You can close this page.</p>
 </section></main>;
}
