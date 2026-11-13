import React from 'react';
import {render, screen} from '@testing-library/react';
import {MemoryRouter, Routes, Route} from 'react-router-dom';
import {onSnapshot} from 'firebase/firestore';
import {Context} from '../../../context/AuthContext';
import ClientInvoiceDetail from './ClientInvoiceDetail';
jest.mock('../../../utils/config',()=>({db:{},functions:{}}));
jest.mock('../../../utils/callableAuth',()=>({getCallableAuthPayload:async()=>({})}));
jest.mock('../../../context/AuthContext',()=>{const React=require('react');return {Context:React.createContext({})};});
jest.mock('firebase/firestore',()=>({doc:(_, ...parts)=>parts.join('/'),collection:jest.fn(),query:jest.fn(),where:jest.fn(),onSnapshot:jest.fn()}));
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
test('the invoice keeps identity, navigation and status together and displays the full job scope',async()=>{
 onSnapshot.mockImplementation((ref,next)=>{queueMicrotask(()=>next(typeof ref==='string'?{id:'invoice',exists:()=>true,data:()=>({invoiceNumber:'J2',companyName:'Pool company',email:'customer@example.test',status:'open',totalAmountCents:28800,amountDueCents:28800,lineItems:[{id:'service',name:'Filter clean',type:'service',quantity:1,unitAmountCents:16000,totalAmountCents:16000},{id:'part',name:'Filter grids',type:'material',quantity:8,unitAmountCents:1600,totalAmountCents:12800}]})}:{docs:[]}));return ()=>{};});
 render(<Context.Provider value={{user:{uid:'homeowner'}}}><MemoryRouter initialEntries={['/client/billing/invoices/invoice']} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Routes><Route path="/client/billing/invoices/:invoiceId" element={<ClientInvoiceDetail/>}/></Routes></MemoryRouter></Context.Provider>);
 const heading=await screen.findByRole('heading',{name:'J2',level:1});expect(screen.getByRole('banner')).toContainElement(heading);
 expect(screen.getByRole('banner')).toContainElement(screen.getByRole('button',{name:'Invoice status: Due. Refresh status'}));
 expect(screen.getByText('Pool company sent this invoice to customer@example.test.')).toHaveClass('workspace-header-description');expect(screen.getByRole('banner')).toContainElement(screen.getByRole('link',{name:'Finance'}));
 expect(screen.getAllByText('Filter clean').length).toBeGreaterThan(0);expect(screen.getAllByText('Filter grids').length).toBeGreaterThan(0);expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);
});
