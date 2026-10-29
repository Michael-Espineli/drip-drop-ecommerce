import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { getDoc, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../../context/AuthContext';
import { runWorkCompletionEffects } from '../../../utils/workCompletionEffects';
import ServiceStopDetails from './ServiceStopDetails';

let mockPermissions;
let mockRouteFailure;
const mockBatchUpdate = jest.fn();
const mockCommit = jest.fn();
const mockSendReport = jest.fn();
jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {}, functions: {}, storage: {} }));
jest.mock('../../../utils/workCompletionEffects', () => ({ runWorkCompletionEffects: jest.fn(async () => ({})) }));
jest.mock('../../../utils/stopData', () => ({ fetchStopDataForServiceStop: async () => [] }));
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({
  can: (id) => mockPermissions.includes(String(id)),
  requirePermission: (id) => mockPermissions.includes(String(id)),
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../components/share/ShareItemButton', () => () => null);
jest.mock('../partApprovals/PartApprovalCreateModal', () => () => null);
jest.mock('../marketing/ConnectAgreementModal', () => () => null);
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockSendReport) }));
jest.mock('firebase/firestore', () => {
  const ref = (first, ...parts) => [typeof first === 'string' ? first : '', ...parts].filter(Boolean).join('/');
  return {
    doc: ref, collection: ref, query: (path, ...constraints) => ({ path, constraints }), where: (...args) => args,
    orderBy: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn(), updateDoc: jest.fn(), setDoc: jest.fn(), addDoc: jest.fn(),
    Timestamp: class { static fromDate(value) { return value; } }, serverTimestamp: () => 'server-time', arrayUnion: jest.fn(),
    writeBatch: jest.fn(() => ({ update: mockBatchUpdate, commit: mockCommit })),
  };
});

const snapshot = (id, data) => ({ id, ref: id, exists: () => !!data, data: () => data });
const stop = {
  id: 'visit', internalId: 'VISIT-42', type: 'Job Visit', jobId: 'job', techId: 'alex', tech: 'Alex Rivera',
  operationStatus: 'Not Finished', serviceDate: new Date('2026-10-28T18:00:00Z'), address: {},
};
const Destination = () => {
  const location = useLocation();
  return <pre data-testid="job-destination">{JSON.stringify({ path: location.pathname, state: location.state })}</pre>;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['244', '24'];
  mockRouteFailure = false;
  updateDoc.mockResolvedValue(undefined);
  mockCommit.mockResolvedValue(undefined);
  mockSendReport.mockResolvedValue({ data: {} });
  httpsCallable.mockImplementation(() => mockSendReport);
  writeBatch.mockImplementation(() => ({ update: mockBatchUpdate, commit: mockCommit }));
  runWorkCompletionEffects.mockResolvedValue({});
  getDoc.mockImplementation(async (path) => snapshot(path.split('/').pop(), path.endsWith('/serviceStops/visit') ? stop : null));
  getDocs.mockImplementation(async (ref) => {
    const path = ref.path || ref;
    if (path.endsWith('/activeRoutes') && mockRouteFailure) throw new Error('Route summary unavailable');
    const docs = path.endsWith('/serviceStops/visit/tasks') ? [snapshot('cleanup', { name: 'Clean up', type: 'Basic', status: 'Not Finished', jobTaskId: 'job-task' })]
      : path.endsWith('/companyUsers') ? [
        snapshot('alex-member', { userId: 'alex', firstName: 'Alex', lastName: 'Rivera' }),
        snapshot('blair-member', { userId: 'blair', firstName: 'Blair', lastName: 'Chen' }),
      ] : [];
    return { docs, empty: !docs.length, size: docs.length };
  });
});

const openStop = async () => {
  await act(async () => { render(
    <MemoryRouter initialEntries={['/company/serviceStops/detail/visit']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Context.Provider value={{ recentlySelectedCompany: 'company', user: { uid: 'admin' } }}>
        <Routes>
          <Route path="/company/serviceStops/detail/:serviceStopId" element={<ServiceStopDetails />} />
          <Route path="/company/jobs/detail/:jobId/:section" element={<Destination />} />
        </Routes>
      </Context.Provider>
    </MemoryRouter>
  ); });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
  return screen.findByRole('dialog', { name: 'Admin Edit' });
};
const openFinishStop = async () => {
  const admin = await openStop();
  fireEvent.click(within(admin).getByRole('button', { name: 'Finish Service Stop Manually' }));
  return screen.findByRole('dialog', { name: 'Finish Service Stop' });
};

test('Admin Edit searches technician names and saves the user ID rather than the membership ID', async () => {
  const dialog = await openStop();
  const input = within(dialog).getByRole('combobox', { name: 'Technician' });
  fireEvent.change(input, { target: { value: 'Blair' } });
  fireEvent.click(await screen.findByText('Blair Chen'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(mockBatchUpdate).toHaveBeenCalledWith('companies/company/serviceStops/visit', expect.objectContaining({ techId: 'blair', tech: 'Blair Chen' })));
  expect(writeBatch).toHaveBeenCalled();
});

test('Keep job open finishes the selected stop tasks without deriving job completion', async () => {
  const dialog = await openFinishStop();
  expect(within(dialog).getByRole('radio', { name: /^Keep job open/ })).toBeChecked();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finish Stop', exact: true }));
  await waitFor(() => expect(updateDoc).toHaveBeenCalledWith('companies/company/serviceStops/visit', expect.objectContaining({ operationStatus: 'Finished', completedByUserId: 'admin' })));
  expect(runWorkCompletionEffects).toHaveBeenCalledWith(expect.objectContaining({ syncJobStatus: false }));
  expect(screen.queryByTestId('job-destination')).not.toBeInTheDocument();
  expect(updateDoc).not.toHaveBeenCalledWith('companies/company/workOrders/job', expect.objectContaining({ operationStatus: 'Finished' }));
});

test.each([
  ['Finish linked job', 'Finish Stop and Review Job', 'openFinishJobConfirm'],
  ['Schedule next stop', 'Finish Stop and Schedule Next', 'openScheduleServiceStop'],
])('%s routes completed work to the correct job dialog', async (label, button, stateKey) => {
  const dialog = await openFinishStop();
  fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(`^${label}`) }));
  fireEvent.click(within(dialog).getByRole('button', { name: button }));
  const destination = await screen.findByTestId('job-destination');
  expect(JSON.parse(destination.textContent)).toEqual({ path: '/company/jobs/detail/job/actual', state: { [stateKey]: true, fromServiceStopId: 'visit' } });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'sendServiceReportOnFinish');
});

test('route summary failure does not strand a finished stop before its linked-job handoff', async () => {
  mockRouteFailure = true;
  const dialog = await openFinishStop();
  fireEvent.click(within(dialog).getByRole('radio', { name: /^Finish linked job/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finish Stop and Review Job' }));
  expect(await screen.findByTestId('job-destination')).toHaveTextContent('openFinishJobConfirm');
});

test('stop editors without job edit permission only see the keep-open option', async () => {
  mockPermissions = ['244'];
  const dialog = await openFinishStop();
  expect(within(dialog).queryByRole('radio', { name: /^Finish linked job/ })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('radio', { name: /^Schedule next stop/ })).not.toBeInTheDocument();
});
