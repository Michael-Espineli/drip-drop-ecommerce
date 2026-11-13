import React from 'react';import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {httpsCallable} from 'firebase/functions';import {ClientInvoicePayment} from './ClientPaymentActions';
jest.mock('../../utils/config',()=>({db:{},functions:{}}));jest.mock('../../utils/callableAuth',()=>({getCallableAuthPayload:async()=>({idToken:'test'})}));jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));jest.mock('firebase/firestore',()=>({doc:jest.fn(),getDoc:jest.fn()}));
test('the customer can choose ACH for one invoice without seeing company processing fees',async()=>{const command=jest.fn().mockResolvedValue({data:{status:'processing'}});httpsCallable.mockReturnValue(command);render(<ClientInvoicePayment invoice={{id:'invoice',companyId:'company',currency:'usd',status:'open',onlinePaymentAvailable:true}} balanceCents={10000} user={{uid:'home'}}/>);expect(screen.queryByText('Drip Drop fee estimate')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:/Bank account/}));fireEvent.click(screen.getByRole('button',{name:'Pay $100.00'}));await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({invoiceId:'invoice',paymentMethodType:'ach'})));expect(await screen.findByRole('button',{name:'Payment processing'})).toBeDisabled();expect(screen.getByText(/does not authorize recurring charges/)).toBeInTheDocument();});
test('an internal Checkout failure shows a useful error and permits retry',async()=>{
 const command=jest.fn().mockRejectedValueOnce({code:'functions/internal',message:'INTERNAL'}).mockResolvedValueOnce({data:{status:'processing'}});httpsCallable.mockReturnValue(command);
 render(<ClientInvoicePayment invoice={{id:'invoice',status:'open',onlinePaymentAvailable:true}} balanceCents={28800} user={{uid:'home'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Pay $288.00'}));expect(await screen.findByRole('alert')).toHaveTextContent('Payment could not be opened. Please try again.');expect(screen.getByRole('button',{name:'Pay $288.00'})).not.toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Pay $288.00'}));expect(await screen.findByRole('button',{name:'Payment processing'})).toBeDisabled();expect(command).toHaveBeenCalledTimes(2);
});
test('an incomplete Checkout response does not lock the invoice as processing',async()=>{
 httpsCallable.mockReturnValue(jest.fn().mockResolvedValue({data:{}}));render(<ClientInvoicePayment invoice={{id:'invoice',status:'open',onlinePaymentAvailable:true}} balanceCents={28800}/>);
 fireEvent.click(screen.getByRole('button',{name:'Pay $288.00'}));expect(await screen.findByRole('alert')).toHaveTextContent('Payment could not be opened.');expect(screen.getByRole('button',{name:'Pay $288.00'})).not.toBeDisabled();
});
