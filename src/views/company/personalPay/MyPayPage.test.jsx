import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import { technicianWorkflow } from '../../../utils/technicianWorkflow';
import MyPayPage from './MyPayPage';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ auth: {}, db: {}, functions: {} }));
jest.mock('../../../utils/technicianWorkflow', () => ({ technicianWorkflow: jest.fn() }));
jest.mock('../payroll/PayRequestsPanel', () => props => <div role="region" aria-label="Personal requests">{props.audience} · {props.initialRequestType} · {props.initialPayLineItemId} · {props.initialReason}</div>);
const base = { user: { uid: 'alex' }, recentlySelectedCompany: 'north', recentlySelectedCompanyName: 'North Pools', companyUserAccess: { status: 'Active' }, companyOwnerId: 'owner', companyRoleLoaded: true, hasCompanyPermission: () => false };
const line = { id: 'line', title: 'Weekly service', technicianId: 'alex', completedDate: Date.UTC(2026, 10, 5), totalAmountCents: 5000, rateDescription: '1 × $50.00', isPaid: true, needsReview: false, statusLabel: 'Recorded paid', paidAt: Date.UTC(2026, 10, 5), paymentReference: 'ACH-123' };
const sheet = { version: 1, companyName: 'North Pools', technicianName: 'Alex', startDateKey: '2026-10-07', endDateKey: '2026-11-05', summary: { earnedCents: 7500, recordedPaidCents: 5000, remainingCents: 2500, olderUnpaidCents: 1000, olderReviewCount: 0, reviewCount: 1 }, earnings: [{ id: 'stops', label: 'Weekly service', amountCents: 5000 }, { id: 'tasks', label: 'Filter cleaning', amountCents: 2500 }], lineItems: [line], olderItems: [{ ...line, id: 'old', title: 'Older unpaid service', isPaid: false }], statements: [{ id: 'saved', reference: 'PS-12', startDate: Date.UTC(2026, 9, 1), endDate: Date.UTC(2026, 9, 15), status: 'paid', subtotalCents: 7000, adjustmentCents: -1000, totalCents: 6000 }], missingCount: 0,
  days: [{ id: '2026-11-05', routes: [{ id: 'route', name: 'Thursday route', totalCents: 7500, lines: [], stops: [{ id: 'stop', title: 'Jones home', subtitle: 'Weekly service · 12 Pool Lane', coverageLabel: 'Pay recorded', lines: [line], tasks: [{ id: 'test', title: 'Water test', coverageLabel: 'Included in stop pay', lines: [] }, { id: 'missing', title: 'Filter repair', coverageLabel: 'Pay needs review', lines: [] }] }] }] }] };
const page = (context = base, path = '/company/my-pay') => <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Context.Provider value={context}><MyPayPage /></Context.Provider></MemoryRouter>;
beforeEach(() => { jest.clearAllMocks(); technicianWorkflow.mockImplementation(async (_, input) => input.statementId ? { ...sheet, statement: sheet.statements[0], missingCount: 1 } : sheet); });

test('defaults to a live earnings stub, with the last 30 days and no technician selector', async () => {
  render(page(base, '/company/my-pay?technicianId=other'));
  const summary = await screen.findByRole('region', { name: 'Earnings summary' });
  expect(summary).toHaveTextContent('Oct 7, 2026 – Nov 5, 2026');
  expect(summary).toHaveTextContent('Live paysheet'); expect(summary).toHaveTextContent('$75.00');
  expect(summary).toHaveTextContent('Recorded paid'); expect(summary).toHaveTextContent('total may be incomplete');
  expect(technicianWorkflow).toHaveBeenCalledWith('getTechnicianPaysheet', expect.objectContaining({ companyId: 'north' }));
  expect(technicianWorkflow.mock.calls[0][1]).not.toHaveProperty('technicianId');
  expect(screen.getByRole('link', { name: 'Paysheet' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('region', { name: 'Personal requests' })).not.toBeInTheDocument();
});
test('work follows day, route and stop; included and missing tasks remain visible with payment evidence', async () => {
  render(page());
  const work = await screen.findByRole('region', { name: 'Work verification' });
  expect(work).toHaveTextContent('Thursday route'); fireEvent.click(within(work).getByText('Jones home'));
  expect(work).toHaveTextContent('Water test'); expect(work).toHaveTextContent('Included in stop pay');
  expect(work).toHaveTextContent('Filter repair'); expect(work).toHaveTextContent('Pay needs review');
  expect(work).toHaveTextContent('1 × $50.00'); expect(work).toHaveTextContent('ACH-123');
  const report = within(work).getByRole('link', { name: 'Report a pay issue for this task' });
  expect(report.getAttribute('href')).toContain('tab=requests'); expect(report.getAttribute('href')).toContain('Filter+repair');
});
test('history loads the saved statement and keeps its totals even when a work item is missing', async () => {
  render(page(base, '/company/my-pay?tab=history'));
  fireEvent.click(await screen.findByText('PS-12'));
  const saved = await screen.findByRole('region', { name: 'Earnings summary' });
  expect(saved).toHaveTextContent('Saved statement'); expect(saved).toHaveTextContent('$60.00'); expect(saved).toHaveTextContent('-$10.00');
  expect(saved).toHaveTextContent('breakdown is incomplete');
  expect(screen.queryByRole('button', { name: /Approve|Mark paid|Export/i })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Older unpaid work' })).toHaveTextContent('Older unpaid service');
});
test('the earlier statements URL still reaches history, and no statements does not hide live earnings', async () => {
  technicianWorkflow.mockResolvedValue({ ...sheet, statements: [] }); render(page(base, '/company/my-pay?tab=statements'));
  expect(await screen.findByText(/No finalized statements yet/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
});
test('requests stay self-scoped for managers and work issues prefill the correction', async () => {
  render(page({ ...base, companyOwnerId: 'alex', hasCompanyPermission: () => true }, '/company/my-pay?tab=requests&line=line&work=Filter+clean'));
  const requests = await screen.findByRole('region', { name: 'Personal requests' });
  expect(requests).toHaveTextContent('self · payCorrection · line · Please review pay for Filter clean.');
});
test('period selection changes the read request and last 30 days restores the default', async () => {
  render(page()); await screen.findByRole('region', { name: 'Earnings summary' });
  fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2026-09-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'View period' }));
  await waitFor(() => expect(technicianWorkflow).toHaveBeenLastCalledWith('getTechnicianPaysheet', expect.objectContaining({ startDateKey: '2026-09-01', endDateKey: '2026-09-30' })));
  fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
  await waitFor(() => expect(technicianWorkflow.mock.calls.at(-1)[1]).not.toHaveProperty('startDateKey'));
});
test('company changes clear old earnings and ignore late results', async () => {
  const view = render(page()); await screen.findByRole('region', { name: 'Earnings summary' });
  let finish; technicianWorkflow.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  view.rerender(page({ ...base, recentlySelectedCompany: 'south' })); expect(screen.queryByText('$75.00')).not.toBeInTheDocument();
  view.rerender(page({ ...base, recentlySelectedCompany: null })); await act(async () => finish(sheet));
  expect(screen.queryByRole('region', { name: 'Earnings summary' })).not.toBeInTheDocument();
});
test('inactive access cannot fetch personal payroll', () => {
  render(page({ ...base, companyUserAccess: { status: 'Revoked' } }));
  expect(screen.getByRole('alert')).toHaveTextContent('active access'); expect(technicianWorkflow).not.toHaveBeenCalled();
});
test('errors never become a zero balance, and refresh recovers', async () => {
  technicianWorkflow.mockRejectedValue(new Error('offline')); render(page());
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable'); expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  technicianWorkflow.mockResolvedValue(sheet); fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('region', { name: 'Earnings summary' })).toHaveTextContent('$75.00');
});
test('a correction from an older saved statement reloads that statement’s own work choices', async () => {
  render(page(base, '/company/my-pay?tab=requests&statement=saved&line=line&work=Older+work'));
  await waitFor(() => expect(technicianWorkflow).toHaveBeenCalledWith('getTechnicianPaysheet', expect.objectContaining({ statementId: 'saved' })));
  expect(screen.getByRole('region', { name: 'Personal requests' })).toHaveTextContent('payCorrection · line');
});
