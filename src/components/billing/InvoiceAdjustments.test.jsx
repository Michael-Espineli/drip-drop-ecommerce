import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import InvoiceAdjustments from './InvoiceAdjustments';
import {manageSalesInvoice} from '../../utils/sales/invoiceCommands';
jest.mock('../../utils/sales/invoiceCommands',()=>({manageSalesInvoice:jest.fn()}));
const invoice={id:'invoice',companyId:'company',status:'open',amountDueCents:10000};
beforeEach(()=>{sessionStorage.clear();manageSalesInvoice.mockReset();});
test('an interrupted credit retains its reason, amount and retry ID across a remount',async()=>{
 manageSalesInvoice.mockRejectedValueOnce(Error('Response interrupted')).mockResolvedValueOnce({});
 const first=render(<InvoiceAdjustments invoice={invoice} payments={[]} userId="manager" />);
 fireEvent.change(screen.getByLabelText('Credit amount'),{target:{value:'20.00'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Service adjustment approved by owner'}});fireEvent.click(screen.getByRole('button',{name:'Record adjustment'}));
 await screen.findByText('Response interrupted');const requestId=manageSalesInvoice.mock.calls[0][0].requestId;first.unmount();
 render(<InvoiceAdjustments invoice={invoice} payments={[]} userId="manager" />);expect(screen.getByLabelText('Credit amount')).toHaveValue(20);fireEvent.click(screen.getByRole('button',{name:'Record adjustment'}));
 await waitFor(()=>expect(manageSalesInvoice).toHaveBeenCalledTimes(2));expect(manageSalesInvoice.mock.calls[1][0]).toEqual(expect.objectContaining({requestId,action:'applyCredit',adjustment:{amountCents:2000,reason:'Service adjustment approved by owner'}}));
});
test('receipt corrections only offer unreversed manual receipts and explain that no transfer occurs',()=>{
 render(<InvoiceAdjustments invoice={invoice} payments={[{id:'manual',source:'manual',status:'posted',method:'check',amountCents:2500},{id:'stripe',source:'stripe',status:'posted',amountCents:10000},{id:'old',source:'manual',status:'reversed',amountCents:1000}]} userId="manager" />);
 fireEvent.change(screen.getByLabelText('Adjustment'),{target:{value:'reversePayment'}});expect(screen.getByLabelText('Original receipt').options).toHaveLength(2);expect(screen.getByText(/do not transfer money/)).toBeInTheDocument();
});
test('Stripe-owned or unresolved payment reviews cannot offer a local accounting adjustment',()=>{
 const view=render(<InvoiceAdjustments invoice={{...invoice,stripeInvoiceId:'in_test'}} payments={[]} userId="manager" />);expect(screen.queryByRole('button')).toBeNull();view.rerender(<InvoiceAdjustments invoice={{...invoice,paymentReviewRequired:true}} payments={[]} userId="manager" />);expect(screen.queryByRole('button')).toBeNull();
});
