import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConversationLinkCard from './ConversationLinkCard';

test.each(['client','company'])('%s chat shows an invoice number while keeping the document ID inside the destination', audience=>{
  render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><ConversationLinkCard audience={audience} link={{id:'link',recordId:'x7QaB2cD9eF0gH1jK3mN',type:'invoice',title:'INV-2026-0042'}}/></MemoryRouter>);
  expect(screen.getByText('INV-2026-0042')).toBeInTheDocument();
  expect(screen.queryByText('x7QaB2cD9eF0gH1jK3mN')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Open Invoice/i})).toBeInTheDocument();
});
test('an older shared card whose title is the ID uses a safe label',()=>{
  render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><ConversationLinkCard link={{recordId:'x7QaB2cD9eF0gH1jK3mN',type:'job',title:'x7QaB2cD9eF0gH1jK3mN'}}/></MemoryRouter>);
  expect(screen.queryByText('x7QaB2cD9eF0gH1jK3mN')).not.toBeInTheDocument();
  expect(screen.getAllByText('Job').length).toBeGreaterThan(0);
});
