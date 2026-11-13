import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getDoc, getDocs, setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import Reports from './Reports';
import CustomReports from './CustomReports';
import fixture from '../../../utils/reports/fixtures/modern-reports.json';
let mockPermissions;
let mockReady;
jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {}, storage: {} }));
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({ can: (id) => mockReady && mockPermissions.includes(id), permissionsReady: mockReady }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), loading: jest.fn(() => 'toast'), dismiss: jest.fn() } }));
jest.mock('firebase/storage', () => ({ ref: jest.fn(), uploadBytes: jest.fn(), getDownloadURL: jest.fn() }));
jest.mock('firebase/firestore', () => {
  const reference = (first, ...parts) => [typeof first === 'string' ? first : '', ...parts].filter(Boolean).join('/');
  return { collection: reference, doc: reference, getDoc: jest.fn(), getDocs: jest.fn(), addDoc: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(), deleteDoc: jest.fn(),
    query: (path, ...constraints) => ({ path, constraints }), where: (...values) => values, orderBy: (...values) => values,
    serverTimestamp: () => 'now', Timestamp: { fromDate: (date) => date },
  };
});
const snapshot = (records = []) => ({ docs: records.map((record) => ({ id: record.id, data: () => record })) });
const context = (company = 'company') => ({ recentlySelectedCompany: company, companyRole: { name: 'Manager' }, companyUserAccess: {},
  selectedCustomerRegionTag: '', user: { uid: 'manager' }, dataBaseUser: {}, featureFlagsLoaded: true, isFeatureEnabled: () => false });
const view = (value, Page = Reports) => <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Context.Provider value={value}><Page /></Context.Provider></MemoryRouter>;
const select = (label) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label} `) }));
beforeEach(() => {
  jest.clearAllMocks(); mockReady = true; mockPermissions = ['870', '420', '872', '874', '876'];
  getDoc.mockResolvedValue({ exists: () => false });
  getDocs.mockImplementation(async (source) => {
    const path = source.path || source;
    if (path.endsWith('/vehicals')) return snapshot([{ id: 'van', nickName: 'Van' }]);
    if (path.endsWith('/activeRoutes')) return snapshot([{ id: 'route', date: new Date(), vehicalId: 'van', distanceMiles: 25 }]);
    return snapshot();
  });
});
test('generates fleet output without requiring stop readings and clears exports when dates change', async () => {
  render(view(context())); select('Vehicle');
  fireEvent.click(screen.getByRole('button', { name: 'Generate', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Vehicle Report' })).toBeInTheDocument();
  expect(screen.getByText('Van')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2025-01-01' } });
  expect(screen.queryByRole('heading', { name: 'Vehicle Report' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
});
test('an old-company response cannot display or export after a company switch', async () => {
  let resolve;
  const deferred = new Promise((done) => { resolve = done; });
  const original = getDocs.getMockImplementation();
  getDocs.mockImplementation((source) => (source.path || source) === 'companies/company/activeRoutes' ? deferred : original(source));
  const { rerender } = render(view(context())); select('Vehicle'); fireEvent.click(screen.getByRole('button', { name: 'Generate', exact: true }));
  await waitFor(() => expect(getDocs).toHaveBeenCalledWith(expect.objectContaining({ path: 'companies/company/activeRoutes' })));
  rerender(view(context('other')));
  await act(async () => { resolve(snapshot([{ id: 'old', date: new Date(), distanceMiles: 999 }])); });
  expect(screen.queryByRole('heading', { name: 'Vehicle Report' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
});
test('failed reads show an error and permit retry', async () => {
  const original = getDocs.getMockImplementation(); let fail = true;
  getDocs.mockImplementation((source) => (source.path || source).endsWith('/activeRoutes') && fail ? Promise.reject(new Error('access unavailable')) : original(source));
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(view(context())); select('Vehicle'); fireEvent.click(screen.getByRole('button', { name: 'Generate', exact: true }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Could not read activeRoutes'), expect.anything()));
  fail = false; fireEvent.click(screen.getByRole('button', { name: 'Generate', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Vehicle Report' })).toBeInTheDocument(); error.mockRestore();
});
test('loading and denied report access cannot generate, and payroll choices stay hidden', async () => {
  mockReady = false; const { rerender } = render(view(context()));
  expect(screen.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  mockReady = true; mockPermissions = ['870']; rerender(view(context()));
  expect(screen.queryByRole('button', { name: /^Payroll / })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Future Payroll / })).not.toBeInTheDocument();
  mockPermissions = []; rerender(view(context())); expect(screen.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
});
test('invalid dates never trigger report source reads', async () => {
  render(view(context())); select('Vehicle'); fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2099-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate', exact: true }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Choose valid dates'), expect.anything()));
  expect(getDocs.mock.calls.some(([source]) => (source.path || source).endsWith('/activeRoutes'))).toBe(false);
});
test('custom reports include records without updatedAt and discard old-company loads', async () => {
  let resolve;
  getDocs.mockImplementation(async (source) => {
    const path = source.path || source;
    if (path === 'companies/company/customReports') return new Promise((done) => { resolve = done; });
    if (path === 'companies/other/customReports') return snapshot([{ id: 'new', title: 'Current company report', controls: { reportType: 'vehicle' } }]);
    return snapshot();
  });
  const { rerender } = render(view(context(), CustomReports));
  await waitFor(() => expect(resolve).toBeDefined()); rerender(view(context('other'), CustomReports));
  expect(await screen.findByText('Current company report')).toBeInTheDocument();
  await act(async () => resolve(snapshot([{ id: 'old', title: 'Old company report' }])));
  expect(screen.queryByText('Old company report')).not.toBeInTheDocument(); expect(screen.getByText('Current company report')).toBeInTheDocument();
});

const readingPerformanceSources = async (source) => {
  const key = (source.path || source).split('/').pop();
  const aliases = { readings: 'readingTemplates', companyUsers: 'users', recurringServiceStop: 'recurringServiceStops' };
  return snapshot(fixture.sources[aliases[key] || key] || []);
};
test('performance history attachments require both the feature and the write permission', async () => {
  getDocs.mockImplementation(readingPerformanceSources);
  render(view({ ...context(), isFeatureEnabled: () => true })); select('Reading Performance');
  await screen.findByDisplayValue('8'); fireEvent.click(screen.getByRole('button', { name: 'Generate', exact: true }));
  await screen.findByRole('heading', { name: /^Reading Performance by User Report/ });
  expect(screen.getByRole('button', { name: 'Note', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add All Reports to Technicians', exact: true })).toBeDisabled();
  expect(setDoc).not.toHaveBeenCalled();
});
test('repeated history attachment actions reuse one review identity for the generated report', async () => {
  mockPermissions.push('274'); getDocs.mockImplementation(readingPerformanceSources); setDoc.mockResolvedValue();
  render(view({ ...context(), isFeatureEnabled: () => true })); select('Reading Performance');
  await screen.findByDisplayValue('8'); fireEvent.click(screen.getByRole('button', { name: 'Generate', exact: true }));
  await screen.findByRole('heading', { name: /^Reading Performance by User Report/ });
  fireEvent.click(screen.getByRole('button', { name: 'Note', exact: true }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Note', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Note', exact: true }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(2));
  expect(setDoc.mock.calls[0][0]).toEqual(setDoc.mock.calls[1][0]);
  expect(setDoc.mock.calls[0][1].companyUserId).toBe('company-worker');
});
