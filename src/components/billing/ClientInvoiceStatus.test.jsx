import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import ClientInvoiceStatus, {clientInvoiceStatus} from './ClientInvoiceStatus';

const now = new Date(2026, 10, 7, 15);
test.each([
  ['Due', {status:'open', dueDate:new Date(2026, 10, 8)}, 10000],
  ['Due', {status:'open', dueDate:new Date(2026, 10, 7)}, 10000],
  ['Due', {status:'partiallyPaid', dueDate:'2026-11-07'}, 5000],
  ['Due', {status:'open'}, 10000],
  ['Late', {status:'open', dueDate:new Date(2026, 10, 6)}, 10000],
  ['Late', {status:'partiallyPaid', dueDate:{toMillis:()=>new Date(2026, 10, 6).getTime()}}, 5000],
  ['Late', {status:'overdue'}, 10000],
  ['Paid', {status:'paid', dueDate:new Date(2026, 10, 6)}, 0],
  ['Refunded', {status:'refunded', amountPaidCents:0}, 0],
  ['Partially refunded', {status:'partiallyRefunded'}, 0],
  ['Draft', {status:'draft', dueDate:new Date(2026, 10, 6)}, 10000],
  ['Void', {status:'void'}, 0],
  ['Written off', {status:'uncollectible'}, 0],
  ['Needs review', {status:'open', paymentReviewRequired:true}, 10000],
  ['Processing', {status:'open', paymentProcessing:true}, 10000],
  ['No balance due', {status:'open'}, 0],
])('%s matches the saved invoice and remaining balance (%#)', (label, invoice, balance) => {
  expect(clientInvoiceStatus(invoice, balance, now).label).toBe(label);
});

test('the prominent status button refreshes status without changing the invoice',()=>{
  const onRefresh=jest.fn(),invoice={status:'paid',amountPaidCents:10000};
  const {rerender}=render(<ClientInvoiceStatus invoice={invoice} balanceCents={0} onRefresh={onRefresh}/>);
  fireEvent.click(screen.getByRole('button',{name:'Invoice status: Paid. Refresh status'}));
  expect(onRefresh).toHaveBeenCalledTimes(1);expect(invoice.status).toBe('paid');
  rerender(<ClientInvoiceStatus invoice={{status:'refunded'}} balanceCents={0} onRefresh={onRefresh}/>);
  expect(screen.getByRole('button',{name:'Invoice status: Refunded. Refresh status'})).toHaveClass('workspace-status-violet');
});
