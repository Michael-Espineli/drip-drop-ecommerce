import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {httpsCallable} from 'firebase/functions';
import StripePaymentRefund from './StripePaymentRefund';
jest.mock('../../utils/config',()=>({functions:{}}));
jest.mock('../../utils/callableAuth',()=>({getCallableAuthPayload:async()=>({idToken:'test'})}));
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
const command=jest.fn(),invoice={id:'invoice',companyId:'company',currency:'usd'},payments=[{id:'payment',status:'posted',method:'stripeCard',stripePaymentIntentId:'pi_payment',amountCents:10000}];
beforeEach(()=>{sessionStorage.clear();command.mockReset();httpsCallable.mockReturnValue(command);});
test('partial refund keeps the same request and exact amount after a network failure',async()=>{
 command.mockRejectedValueOnce(Error('Network unavailable')).mockResolvedValueOnce({data:{status:'succeeded',amountCents:4000}});
 render(<StripePaymentRefund invoice={invoice} payments={payments} userId="owner"/>);
 fireEvent.change(screen.getByLabelText('Payment to refund'),{target:{value:'payment'}});fireEvent.change(screen.getByLabelText('Refund amount'),{target:{value:'40'}});fireEvent.change(screen.getByLabelText('Refund reason'),{target:{value:'Customer returned the part'}});
 fireEvent.click(screen.getByRole('button',{name:'Issue refund'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Issue refund'}));
 await screen.findByText('Refund issued: $40.00.');expect(command).toHaveBeenCalledTimes(2);expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);expect(command.mock.calls[0][0]).toEqual(expect.objectContaining({action:'refund',amountCents:4000,paymentId:'payment',companyId:'company'}));
});
test('manual, failed, disputed and fully refunded receipts do not offer another refund',()=>{
 render(<StripePaymentRefund invoice={invoice} payments={[{...payments[0],status:'disputed'},{...payments[0],status:'refunded'},{id:'manual',status:'posted',amountCents:10000}]} userId="owner"/>);
 expect(screen.queryByRole('button',{name:'Issue refund'})).not.toBeInTheDocument();
});

test('a lost full-refund response can be confirmed after the receipt becomes fully refunded',async()=>{
 command.mockRejectedValueOnce(Error('Response lost')).mockResolvedValueOnce({data:{status:'succeeded',amountCents:10000}});
 const view=render(<StripePaymentRefund invoice={invoice} payments={payments} userId="owner"/>);
 fireEvent.change(screen.getByLabelText('Payment to refund'),{target:{value:'payment'}});fireEvent.change(screen.getByLabelText('Refund amount'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('Refund reason'),{target:{value:'Customer canceled the repair'}});fireEvent.click(screen.getByRole('button',{name:'Issue refund'}));await screen.findByRole('alert');
 view.rerender(<StripePaymentRefund invoice={invoice} payments={[{...payments[0],status:'refunded',refundedAmountCents:10000}]} userId="owner"/>);
 fireEvent.click(screen.getByRole('button',{name:'Confirm refund status'}));await screen.findByText('Refund issued: $100.00.');expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);
});

test('a refund rejected before any processor request can be revised with a fresh request identity',async()=>{
 command.mockRejectedValueOnce(Object.assign(Error('Stripe balance changed'),{details:{safeToRevise:true}})).mockResolvedValueOnce({data:{status:'succeeded',amountCents:1000}});
 render(<StripePaymentRefund invoice={invoice} payments={payments} userId="owner"/>);fireEvent.change(screen.getByLabelText('Payment to refund'),{target:{value:'payment'}});fireEvent.change(screen.getByLabelText('Refund amount'),{target:{value:'40'}});fireEvent.change(screen.getByLabelText('Refund reason'),{target:{value:'Customer returned the part'}});fireEvent.click(screen.getByRole('button',{name:'Issue refund'}));await screen.findByRole('alert');
 expect(screen.getByLabelText('Refund amount')).not.toBeDisabled();fireEvent.change(screen.getByLabelText('Refund amount'),{target:{value:'10'}});fireEvent.click(screen.getByRole('button',{name:'Issue refund'}));await screen.findByText('Refund issued: $10.00.');expect(command.mock.calls[0][0].requestId).not.toEqual(command.mock.calls[1][0].requestId);
});
