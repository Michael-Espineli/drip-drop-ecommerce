import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import RepairRequestDetailView from './RepairRequestDetailView';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {}, storage: {} }));
jest.mock('../../../utils/customerNotes', () => ({ createCustomerNote: jest.fn() }));
jest.mock('../../../utils/appDialog', () => ({ appAlert: jest.fn(), appConfirm: jest.fn() }));
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({ can: () => true, requirePermission: () => true }));
jest.mock('../../components/share/ShareItemButton', () => () => null);
jest.mock('../jobs/CreateJobFlowLauncher', () => ({ buttonLabel }) => <button>{buttonLabel}</button>);
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
  const status = within(info).getByRole('combobox');
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
