import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {httpsCallable} from 'firebase/functions';
import SavedInvoicePayment from './SavedInvoicePayment';
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
jest.mock('../../utils/config',()=>({functions:{}}));
jest.mock('../../utils/callableAuth',()=>({getCallableAuthPayload:async()=>({})}));
const command=jest.fn(),invoice={id:'invoice',companyId:'company',customerId:'customer',currency:'usd',status:'open'};
beforeEach(()=>{sessionStorage.clear();command.mockReset();httpsCallable.mockReturnValue(command);});
test('office collection freezes and reuses its original instructions after an uncertain outcome',async()=>{
 command.mockResolvedValueOnce({data:{methods:[{id:'pm_saved',brand:'visa',last4:'4242'}],pending:[]}}).mockRejectedValueOnce(Error('Response lost')).mockResolvedValueOnce({data:{status:'succeeded'}});
 render(<SavedInvoicePayment invoice={invoice} userId="owner"/>);fireEvent.click(screen.getByRole('button',{name:'Refresh saved methods'}));await screen.findByText('visa ending 4242');fireEvent.change(screen.getByLabelText('Saved method'),{target:{value:'pm_saved'}});fireEvent.change(screen.getByLabelText('Authorization reference'),{target:{value:'Signed agreement 123'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Collect invoice balance'}));await screen.findByText('Response lost');expect(screen.getByLabelText('Saved method')).toBeDisabled();const original=command.mock.calls[1][0];fireEvent.click(screen.getByRole('button',{name:'Confirm original payment'}));await screen.findByText('Payment collected.');expect(command.mock.calls[2][0].requestId).toBe(original.requestId);expect(command.mock.calls[2][0].authorizationReference).toBe('Signed agreement 123');
});
test('setup provides a shareable Stripe link without taking a payment',async()=>{
 command.mockResolvedValue({data:{url:'https://checkout.stripe.com/setup'}});render(<SavedInvoicePayment invoice={invoice} userId="owner"/>);fireEvent.change(screen.getByLabelText('Method to save'),{target:{value:'ach'}});fireEvent.click(screen.getByRole('button',{name:'Create secure setup link'}));await waitFor(()=>expect(screen.getByLabelText('Customer setup link')).toHaveValue('https://checkout.stripe.com/setup'));expect(command).toHaveBeenCalledWith(expect.objectContaining({paymentMethodType:'ach'}));expect(httpsCallable).toHaveBeenCalledWith(expect.anything(),'createSavedPaymentSetup');
});
