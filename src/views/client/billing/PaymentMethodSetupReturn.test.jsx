import React,{Suspense} from 'react';
import {render,screen} from '@testing-library/react';
import {MemoryRouter,useRoutes} from 'react-router-dom';
import publicRoutes from '../../../routes/routes/publicRoutes';
const Routes=()=>useRoutes(publicRoutes);
test('saved-method return is reachable without staff authentication and does not claim an invoice was paid',async()=>{
 render(<MemoryRouter initialEntries={['/customer/payment-method-setup?paymentSetup=returned']}><Suspense fallback={<p>Loading</p>}><Routes/></Suspense></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:'Payment method setup'})).toBeInTheDocument();expect(screen.getByText(/Saving payment details does not pay an invoice/)).toBeInTheDocument();expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
});
test('canceled setup explains how to resume without exposing a company invoice',async()=>{
 render(<MemoryRouter initialEntries={['/customer/payment-method-setup?paymentSetup=canceled']}><Suspense fallback={<p>Loading</p>}><Routes/></Suspense></MemoryRouter>);
 expect(await screen.findByText(/You left the Stripe setup page/)).toBeInTheDocument();expect(screen.queryByText(/confirm when your saved payment method is ready/)).not.toBeInTheDocument();
});
