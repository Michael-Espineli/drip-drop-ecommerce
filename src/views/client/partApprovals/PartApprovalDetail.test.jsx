import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../../context/AuthContext';
import PartApprovalDetail from './PartApprovalDetail';
jest.mock('../../../context/AuthContext',()=>({Context:require('react').createContext({})}));
jest.mock('../../../utils/config',()=>({db:{},functions:{}}));
jest.mock('../../../utils/callableAuth',()=>({getCallableAuthPayload:async()=>({})}));
jest.mock('firebase/firestore',()=>({doc:(_, ...path)=>path.join('/'),onSnapshot:jest.fn()}));
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
jest.mock('react-hot-toast',()=>({success:jest.fn(),error:jest.fn()}));
let options,save,loadError;
beforeEach(()=>{
 options=[{id:'plan',label:'Weekly pool service'}];save=jest.fn(async()=>({data:{status:'success'}}));loadError=false;
 onSnapshot.mockImplementation((_,next)=>{next({id:'approval',exists:()=>true,data:()=>({companyId:'company',customerId:'customer',customerUserId:'homeowner',status:'pending',itemName:'Seal kit',plannedTotalPriceCents:2500})});return ()=>{};});
 httpsCallable.mockImplementation((_,name)=>name==='getPartApprovalRecurringOptions'?async()=>{if(loadError)throw Error('offline');return {data:{options}};}:save);
});
function open(){return render(<MemoryRouter initialEntries={['/approval/a']} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Context.Provider value={{user:{uid:'homeowner',email:'homeowner@example.test'},featureFlagsLoaded:true,isFeatureEnabled:()=>false}}><Routes><Route path="/approval/:approvalId" element={<PartApprovalDetail/>}/></Routes></Context.Provider></MemoryRouter>);}
test('one recurring plan is selected automatically and sent with next-bill approval',async()=>{
 open();const choice=await screen.findByRole('button',{name:'Include on next bill'});await waitFor(()=>expect(choice).toBeEnabled());fireEvent.click(choice);fireEvent.click(screen.getByRole('button',{name:'Approve Part'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({paymentPreference:'nextBill',nextBillSubscriptionId:'plan'})));
 expect(screen.getByText(/after delivery or installation and uses/)).toBeInTheDocument();
});
test('multiple eligible plans require the customer to choose the recurring bill',async()=>{
 options=[{id:'first',label:'First pool'},{id:'second',label:'Second pool'}];open();const choice=await screen.findByRole('button',{name:'Include on next bill'});await waitFor(()=>expect(choice).toBeEnabled());fireEvent.click(choice);fireEvent.click(screen.getByRole('button',{name:'Approve Part'}));expect(save).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Recurring service bill'),{target:{value:'second'}});fireEvent.click(screen.getByRole('button',{name:'Approve Part'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({nextBillSubscriptionId:'second'})));
});
test('no recurring plan disables next bill while keeping the existing choices available',async()=>{
 options=[];open();const choice=await screen.findByRole('button',{name:'Include on next bill'});await screen.findByText(/An eligible recurring service bill is required/);expect(choice).toBeDisabled();expect(screen.getByRole('button',{name:'Invoice immediately'})).toBeEnabled();
});
test('a billing-options failure cannot select a guessed plan or block ordinary invoice approval',async()=>{
 loadError=true;open();await screen.findByText(/Recurring billing choices could not be loaded/);expect(screen.getByRole('button',{name:'Include on next bill'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Invoice immediately'}));fireEvent.click(screen.getByRole('button',{name:'Approve Part'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({paymentPreference:'payNow'})));
});
