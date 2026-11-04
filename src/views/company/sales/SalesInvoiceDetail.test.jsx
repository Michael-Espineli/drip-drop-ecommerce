import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {onSnapshot} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {Context} from '../../../context/AuthContext';
import SalesInvoiceDetail from './SalesInvoiceDetail';

jest.mock('../../../context/AuthContext',()=>({Context:require('react').createContext()}));
jest.mock('../../../utils/config',()=>({db:{},functions:{}}));
jest.mock('../../../utils/callableAuth',()=>({getCallableAuthPayload:async()=>({idToken:'fixture'})}));
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
jest.mock('firebase/firestore',()=>({collection:(_, ...parts)=>parts.join('/'),doc:(_, ...parts)=>parts.join('/'),query:(path,...filters)=>({path,filters}),where:(...args)=>args,onSnapshot:jest.fn(),Timestamp:{fromDate:date=>({toMillis:()=>date.getTime()})}}));
jest.mock('./components/CustomerBillingNotesPanel',()=>()=>null);
jest.mock('../../components/share/ShareItemButton',()=>()=>null);
jest.mock('react-hot-toast',()=>({__esModule:true,default:{success:jest.fn(),error:jest.fn()}}));
let row,command,invoiceCallback;
const initial=()=>({companyId:'company',customerId:'customer',invoiceNumber:'INV-1',email:'homeowner@example.test',customerName:'Homeowner',status:'open',currency:'usd',totalAmountCents:10000,amountPaidCents:0,amountDueCents:10000,updatedAt:new Date('2026-11-02T18:00:00Z'),lineItems:[{id:'service',name:'Pool service',quantity:1,unitAmountCents:10000,totalAmountCents:10000}]});
const snapshot=()=>({id:'invoice',exists:()=>true,data:()=>row});
beforeEach(()=>{jest.clearAllMocks();sessionStorage.clear();row=initial();command=jest.fn().mockResolvedValue({data:{paymentId:'paid'}});httpsCallable.mockReturnValue(command);onSnapshot.mockImplementation((ref,next)=>{if(typeof ref==='string'){invoiceCallback=next;queueMicrotask(()=>next(snapshot()));}else queueMicrotask(()=>next({docs:[]}));return()=>{};});});
function mount(permissions=['400','404']){return render(<Context.Provider value={{recentlySelectedCompany:'company',recentlySelectedCompanyName:'Pool Company',user:{uid:'manager'},companyRole:{permissionIdList:permissions}}}><MemoryRouter initialEntries={['/company/sales/invoices/invoice']} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Routes><Route path="/company/sales/invoices/:invoiceId" element={<SalesInvoiceDetail/>}/></Routes></MemoryRouter></Context.Provider>);}
test('finance readers can view/print but cannot edit, send, void or record payment',async()=>{mount(['400']);await screen.findByRole('heading',{name:'INV-1',level:1});expect(screen.getByRole('button',{name:'Download'})).not.toBeDisabled();for(const name of ['Edit','Send Email','Record Payment','Void Invoice'])expect(screen.getByRole('button',{name})).toBeDisabled();});
test('company receipt UI retains its request identity and received date across a failed save',async()=>{
 command.mockRejectedValueOnce(new Error('offline'));mount();await screen.findByRole('heading',{name:'INV-1',level:1});fireEvent.click(screen.getByRole('button',{name:'Record Payment'}));
 fireEvent.change(screen.getByLabelText('Amount'),{target:{value:'25.00'}});fireEvent.change(screen.getByLabelText('Received date'),{target:{value:'2026-10-30'}});fireEvent.change(screen.getByLabelText('Reference Number'),{target:{value:'CHECK-1'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Payment'}));await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.getByRole('button',{name:'Save Payment'})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Save Payment'}));await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);expect(command.mock.calls[0][0]).toEqual(expect.objectContaining({action:'recordPayment',payment:expect.objectContaining({amountCents:2500,referenceNumber:'CHECK-1',receivedAtMillis:new Date('2026-10-30T12:00:00').getTime()})}));
});
test('editing sends the original revision rather than a later subscription snapshot',async()=>{
 mount();await screen.findByRole('heading',{name:'INV-1',level:1});fireEvent.click(screen.getByRole('button',{name:'Edit'}));await screen.findByRole('button',{name:'Save Changes'});
 await act(async()=>{row={...row,billingRevision:2,amountPaidCents:2500,amountDueCents:7500,updatedAt:new Date('2026-11-02T19:00:00Z')};invoiceCallback(snapshot());});
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));expect(command.mock.calls[0][0]).toEqual(expect.objectContaining({action:'update',expectedRevision:0,expectedUpdatedAtMillis:new Date('2026-11-02T18:00:00Z').getTime()}));
});
test('Stripe-backed invoices direct the company to Stripe and block local balance mutations',async()=>{
 row={...row,stripeInvoiceId:'in_live',stripeHostedInvoiceUrl:'https://invoice.stripe.com/example'};mount();await screen.findByRole('heading',{name:'INV-1',level:1});expect(screen.getByRole('link',{name:'Stripe'})).toHaveAttribute('href',row.stripeHostedInvoiceUrl);for(const name of ['Edit','Record Payment','Void Invoice'])expect(screen.getByRole('button',{name})).toBeDisabled();
});
