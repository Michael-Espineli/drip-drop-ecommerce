import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import InvoiceWorkflowStatus from './InvoiceWorkflowStatus';
jest.mock('../../utils/config', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({ doc: (_, path) => path, onSnapshot: jest.fn() }));
let listener, fail, stop;
beforeEach(() => { stop=jest.fn();onSnapshot.mockImplementation((_, next, error) => { listener=next;fail=error;return stop; }); });
const show = props => render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><InvoiceWorkflowStatus {...props}/></MemoryRouter>);
const emit = data => act(() => listener({exists:()=>true,data:()=>data}));
test('a draft has a real invoice link and remains visibly separate from issued billing', () => {
 show({record:{invoiceId:'invoice-1',invoiceStatus:'draft',invoiced:false}});
 expect(screen.getByText('Invoice: draft')).toBeInTheDocument();expect(screen.getByRole('link',{name:'Open Invoice'})).toHaveAttribute('href','/company/sales/invoices/invoice-1');
 expect(screen.getByText(/Created in Sales/)).toBeInTheDocument();
});
test('live completion turns waiting for delivery into an invoice link', () => {
 show({recordPath:'companies/company/shoppingList/shopping'});emit({billingAutomationStatus:'awaitingDelivery'});
 expect(screen.getByText(/created after delivery/)).toBeInTheDocument();
 emit({salesInvoiceId:'issued',invoiceStatus:'open',billingAutomationStatus:'invoiced'});
 expect(screen.getByText('Invoice: open')).toBeInTheDocument();expect(screen.getByRole('link')).toHaveAttribute('href','/company/sales/invoices/issued');
});
test('failed delivery keeps the invoice accessible with its recovery explanation', () => {
 show({record:{invoiceId:'draft',invoiceStatus:'draft',billingAutomationStatus:'emailNeedsReview',billingAutomationError:'Review and send from Sales.'}});
 expect(screen.getByText('Invoice needs review')).toBeInTheDocument();expect(screen.getByRole('status')).toHaveTextContent('Review and send from Sales.');expect(screen.getByRole('link')).toBeInTheDocument();
});
test('a company/record switch releases the old listener and removes its invoice', () => {
 const view=show({recordPath:'companies/first/shoppingList/a'});emit({invoiceId:'old',invoiceStatus:'open'});
 view.rerender(<MemoryRouter><InvoiceWorkflowStatus recordPath="companies/second/shoppingList/b"/></MemoryRouter>);
 expect(stop).toHaveBeenCalled();expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
test('read failures explain the missing status rather than falsely claiming invoicing succeeded', () => {
 show({recordPath:'companies/company/shoppingList/shopping'});act(()=>fail(new Error('denied')));
 expect(screen.getByRole('status')).toHaveTextContent('Invoice status could not be loaded');expect(screen.queryByRole('link')).not.toBeInTheDocument();
});


test('next-bill waiting and attached drafts explain the recurring collection policy', () => {
 const view=show({record:{billingAutomationStatus:'awaitingNextBill'}});
 expect(screen.getByText('Queued for the next recurring service bill.')).toBeInTheDocument();
 view.rerender(<MemoryRouter><InvoiceWorkflowStatus record={{invoiceId:'recurring',invoiceStatus:'draft',invoiceType:'recurringServiceInvoice',billingAutomationStatus:'nextBillAttached'}}/></MemoryRouter>);
 expect(screen.getByRole('link')).toHaveAttribute('href','/company/sales/invoices/recurring');
 expect(screen.getByText(/usual delivery and payment settings apply/)).toBeInTheDocument();
});
