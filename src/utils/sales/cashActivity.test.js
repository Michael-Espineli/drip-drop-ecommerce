import {cashActivity} from './cashActivity';
test('a refund belongs to its movement month while the original receipt stays in its received month',()=>{
 const payments=[{id:'payment',grossPosted:true,status:'partiallyRefunded',amountCents:10000,refundedAmountCents:4000,receivedAt:new Date('2026-10-15T12:00:00Z')}],adjustments=[{id:'refund',kind:'refund',status:'succeeded',amountCents:4000,createdAt:new Date('2026-11-03T12:00:00Z')}];
 expect(cashActivity(payments,adjustments,Date.parse('2026-10-01'),Date.parse('2026-11-01')).byCurrency.usd.netCents).toBe(10000);
 const november=cashActivity(payments,adjustments,Date.parse('2026-11-01'),Date.parse('2026-12-01'));expect(november.byCurrency.usd.netCents).toBe(-4000);expect(november.estimatedDates).toBe(1);
});
test('Stripe balance transaction dates, dispute withdrawals and reinstatements are signed and deduplicated',()=>{
 const withdrawal={id:'txn_debit',amountCents:-10000,currency:'usd',createdAtMillis:Date.parse('2026-11-02')},restore={id:'txn_restore',amountCents:10000,currency:'usd',createdAtMillis:Date.parse('2026-12-02')};
 const adjustments=[{id:'dispute',kind:'dispute',cashMovements:[withdrawal,restore]},{id:'duplicate',kind:'dispute',cashMovements:[withdrawal]}];
 expect(cashActivity([],adjustments,Date.parse('2026-11-01'),Date.parse('2026-12-01')).byCurrency.usd.netCents).toBe(-10000);
 expect(cashActivity([],adjustments,Date.parse('2026-12-01'),Date.parse('2027-01-01')).byCurrency.usd.netCents).toBe(10000);
});
test('pending refunds and invoice credits do not invent cash movements, and currencies remain separate',()=>{
 const date=new Date('2026-11-02');const report=cashActivity([{id:'usd',status:'posted',amountCents:100,currency:'USD',receivedAt:date},{id:'eur',status:'posted',amountCents:200,currency:'eur',receivedAt:date}],[{id:'pending',kind:'refund',status:'pending',amountCents:50,createdAt:date},{id:'credit',kind:'applyCredit',amountCents:50,createdAt:date}],Date.parse('2026-11-01'),Date.parse('2026-12-01'));expect(report.byCurrency.usd.netCents).toBe(100);expect(report.byCurrency.eur.netCents).toBe(200);
});
