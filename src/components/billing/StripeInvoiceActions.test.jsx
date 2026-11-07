import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {httpsCallable} from 'firebase/functions';
import StripeInvoiceActions from './StripeInvoiceActions';
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
jest.mock('../../utils/config',()=>({functions:{}}));
jest.mock('../../utils/callableAuth',()=>({getCallableAuthPayload:async()=>({})}));
const command=jest.fn(),invoice={id:'invoice',companyId:'company',stripeInvoiceId:'in_invoice',currency:'usd',status:'open',totalAmountCents:10000,lineItems:[]};
beforeEach(()=>{sessionStorage.clear();command.mockReset();httpsCallable.mockReturnValue(command);});
test('Stripe invoice retries preserve their amount, reason, request ID and original total after new snapshots',async()=>{
 command.mockRejectedValueOnce(Error('Response lost')).mockResolvedValueOnce({data:{status:'synchronized'}});
 const view=render(<StripeInvoiceActions invoice={invoice} userId="owner"/>);fireEvent.change(screen.getByLabelText('Stripe invoice action'),{target:{value:'credit'}});fireEvent.change(screen.getByLabelText('Amount'),{target:{value:'25.00'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Skipped service approved'}});fireEvent.click(screen.getByRole('button',{name:'Apply invoice action'}));await screen.findByText('Response lost');expect(screen.getByLabelText('Amount')).toBeDisabled();const original=command.mock.calls[0][0];view.rerender(<StripeInvoiceActions invoice={{...invoice,totalAmountCents:9000}} userId="owner"/>);fireEvent.click(screen.getByRole('button',{name:'Confirm original change'}));await screen.findByText('Stripe invoice synchronized.');expect(command.mock.calls[1][0]).toEqual(original);expect(original.amountCents).toBe(2500);expect(original.expectedTotalAmountCents).toBe(10000);
});
test('known rejection before Stripe mutation allows a corrected request with a fresh ID',async()=>{
 command.mockRejectedValueOnce(Object.assign(Error('Balance changed'),{details:{safeToRevise:true}}));render(<StripeInvoiceActions invoice={invoice} userId="owner"/>);fireEvent.change(screen.getByLabelText('Stripe invoice action'),{target:{value:'credit'}});fireEvent.change(screen.getByLabelText('Amount'),{target:{value:'25.00'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Skipped service approved'}});fireEvent.click(screen.getByRole('button',{name:'Apply invoice action'}));await screen.findByText('Balance changed');await waitFor(()=>expect(screen.getByLabelText('Amount')).toBeEnabled());expect(JSON.parse(sessionStorage.getItem('stripe-invoice-command:owner:company:invoice')).requestId).not.toBe(command.mock.calls[0][0].requestId);
});
