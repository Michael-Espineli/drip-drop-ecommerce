import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import RepairRequestDetailView from './RepairRequestDetailView';
import { appAlert } from '../../../utils/appDialog';

let mockCanUpdate = true;

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {}, storage: {} }));
jest.mock('../../../utils/customerNotes', () => ({ createCustomerNote: jest.fn() }));
jest.mock('../../../utils/appDialog', () => ({ appAlert: jest.fn(), appConfirm: jest.fn() }));
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({ can: () => mockCanUpdate, requirePermission: () => mockCanUpdate }));
jest.mock('../../components/share/ShareItemButton', () => () => null);
jest.mock('../jobs/CreateJobFlowLauncher', () => ({ buttonLabel, contextState, disabled }) => <button disabled={disabled} data-priority={contextState.repairRequest.issuePriorityLevel}>{buttonLabel}</button>);
jest.mock('../partApprovals/PartApprovalCreateModal', () => ({ open, onCreated, onClose }) => open ? (
  <button onClick={() => { onCreated({ id: 'approval-1', status: 'pending' }); onClose(); }}>
    Complete approval creation
  </button>
) : null);
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'),
  doc: (_, ...parts) => parts.join('/'),
  query: (ref) => ref,
  where: jest.fn(),
  orderBy: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  onSnapshot: (_, onChange) => { onChange({ docs: [] }); return () => {}; },
  updateDoc: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanUpdate = true;
  updateDoc.mockResolvedValue(undefined);
  getDoc.mockResolvedValue({
    id: 'request-1',
    exists: () => true,
    data: () => ({ id: 'request-1', status: 'Unresolved', customerId: 'customer-1', description: 'Leaking pump' }),
  });
  getDocs.mockResolvedValue({ docs: [] });
});

test('successful approval creation immediately closes the visible request and shows the linked approval', async () => {
  await act(async () => { render(
    <MemoryRouter initialEntries={['/requests/request-1']}>
      <Context.Provider value={{ recentlySelectedCompany: 'company-1', user: { uid: 'tech-1' } }}>
        <Routes><Route path="/requests/:repairRequestId" element={<RepairRequestDetailView />} /></Routes>
      </Context.Provider>
    </MemoryRouter>
  ); });
  const info = (await screen.findByRole('heading', { name: 'Information' })).parentElement;
  const status = within(info).getByRole('combobox', { name: 'Status' });
  expect(status).toHaveValue('Unresolved');
  fireEvent.click(screen.getByRole('button', { name: 'Create Part Approval' }));
  fireEvent.click(screen.getByRole('button', { name: 'Complete approval creation' }));
  await waitFor(() => expect(status).toHaveValue('Resolved'));
  expect(screen.queryByText('No connected part approvals.')).not.toBeInTheDocument();
  const connectedApprovals = screen.getByRole('heading', { name: 'Connected Part Approvals' }).parentElement;
  expect(within(connectedApprovals).getByRole('link')).toHaveAttribute('href', '/company/part-approvals');
  expect(updateDoc).not.toHaveBeenCalled();

  const comments = screen.getByRole('heading', { name: 'Comments' });
  const actions = screen.getByRole('button', { name: 'Create Job from Request' });
  const details = screen.getByRole('heading', { name: 'Request Details' }).parentElement.parentElement;
  expect(info.nextElementSibling).toBe(details);
  expect(info.closest('aside')).toBeNull();
  expect(comments.closest('aside')).not.toBeNull();
  expect(actions.closest('aside')).toBe(comments.closest('aside'));
  expect(actions.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

const openRequest = async (sourcePath = 'company') => {
  await act(async () => { render(
    <MemoryRouter initialEntries={[{ pathname: '/requests/request-1', state: { sourcePath } }]}>
      <Context.Provider value={{ recentlySelectedCompany: 'company-1', user: { uid: 'tech-1' } }}>
        <Routes><Route path="/requests/:repairRequestId" element={<RepairRequestDetailView />} /></Routes>
      </Context.Provider>
    </MemoryRouter>
  ); });
  return screen.findByRole('combobox', { name: 'Priority', exact: true });
};

test.each(['company', 'homeowner'])('priority edits persist on the %s source and feed job creation', async (sourcePath) => {
  const priority = await openRequest(sourcePath);
  expect(priority).toHaveValue('2');
  let resolve;
  updateDoc.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  fireEvent.change(priority, { target: { value: '1' } });
  expect(priority).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Create Job from Request' })).toBeDisabled();
  await act(async () => resolve());
  expect(updateDoc).toHaveBeenCalledWith(sourcePath === 'homeowner' ? 'homeownerRepairRequests/request-1' : 'companies/company-1/repairRequests/request-1', {
    issuePriorityLevel: 1, issuePriorityLabel: 'Critical', priorityLevel: 1, priorityLabel: 'Critical',
  });
  expect(priority).toHaveValue('1');
  expect(screen.getByRole('button', { name: 'Create Job from Request' })).toHaveAttribute('data-priority', '1');
});

test('a failed priority edit keeps the saved priority for job creation', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const priority = await openRequest();
  updateDoc.mockRejectedValueOnce(new Error('offline'));
  fireEvent.change(priority, { target: { value: '4' } });
  await waitFor(() => expect(appAlert).toHaveBeenCalledWith('Failed to update repair request priority.'));
  expect(priority).toHaveValue('2');
  expect(screen.getByRole('button', { name: 'Create Job from Request' })).toHaveAttribute('data-priority', '2');
  log.mockRestore();
});

test('priority editing respects update permission', async () => {
  mockCanUpdate = false;
  expect(await openRequest()).toBeDisabled();
  expect(updateDoc).not.toHaveBeenCalled();
});

test('a source-aware link from iOS opens the homeowner record even when a company record shares its ID', async () => {
  await act(async () => { render(
    <MemoryRouter initialEntries={['/requests/request-1?sourcePath=homeowner']}>
      <Context.Provider value={{ recentlySelectedCompany: 'company-1', user: { uid: 'tech-1' } }}>
        <Routes><Route path="/requests/:repairRequestId" element={<RepairRequestDetailView />} /></Routes>
      </Context.Provider>
    </MemoryRouter>
  ); });
  expect(await screen.findByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('2');
  expect(getDoc).toHaveBeenNthCalledWith(1, 'homeownerRepairRequests/request-1');
});
