import React from 'react';
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(value)||0)/100);
export default function PaymentAdjustmentNote({payment={}}){
  if(!payment.refundedAmountCents&&!payment.reversedAmountCents)return null;
  return <span className="mt-1 block text-xs font-normal text-slate-500">Original {money(payment.amountCents)}{payment.refundedAmountCents?` · Refunded ${money(payment.refundedAmountCents)}`:''}{payment.reversedAmountCents?` · Reversed / disputed ${money(payment.reversedAmountCents)}`:''}</span>;
}
