import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Context } from '../../context/AuthContext';
import { AccountHomeRedirect } from './BillingReturnPage';
import Cancel from '../../views/Cancel';
import Success from '../../views/Success';
import SuccessfulSubscription from '../../views/SuccessfulSubscription';
import Return from '../../views/Return';
import Refresh from '../../views/Refresh';
import NotFound from '../../views/NotFound';
jest.mock('../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
const future = { v7_startTransition: true, v7_relativeSplatPath: true };
const Location = () => <output data-testid="location">{useLocation().pathname}</output>;

test.each([['Company','/company/dashboard'],['Client','/client/dashboard'],['Admin','/admin/dashboard'],['','/']])('return home respects %s account', (accountType, destination) => {
  render(<Context.Provider value={{ accountType }}><MemoryRouter future={future}><Cancel /></MemoryRouter></Context.Provider>);
  expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', destination);
});
test.each([Success, SuccessfulSubscription, Return, Refresh, NotFound])('%p does not display provider IDs from the URL', (Component) => {
  render(<Context.Provider value={{ accountType: 'Company' }}><MemoryRouter future={future} initialEntries={['/return/audit-secret-record-id']}><Routes><Route path="/return/:connectedAccountId" element={<><Component /><Location /></>} /></Routes></MemoryRouter></Context.Provider>);
  expect(screen.queryByText('audit-secret-record-id')).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/return/audit-secret-record-id');
  expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href','/company/dashboard');
});
test('old dashboard bookmark redirects to the correct client dashboard', () => {
  render(<Context.Provider value={{ accountType:'Client' }}><MemoryRouter future={future} initialEntries={['/dashboard']}><Routes><Route path="/dashboard" element={<AccountHomeRedirect />} /><Route path="/client/dashboard" element={<p>Client home</p>} /></Routes></MemoryRouter></Context.Provider>);
  expect(screen.getByText('Client home')).toBeInTheDocument();
});
