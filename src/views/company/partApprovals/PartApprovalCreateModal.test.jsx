import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getDocs, writeBatch } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import PartApprovalCreateModal from './PartApprovalCreateModal';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {} }));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'),
  doc: (_, ...parts) => parts.join('/'),
  query: (ref) => ref,
  where: jest.fn(),
  getDocs: jest.fn(async () => ({ docs: [] })),
  serverTimestamp: () => 'server-time',
  arrayUnion: (...ids) => ({ arrayUnion: ids }),
  writeBatch: jest.fn(),
}));

const customer = { id: 'customer-1', displayName: 'Taylor Homeowner', customerUserId: 'homeowner-1' };
const location = { id: 'location-1', name: 'Backyard' };
const defaultForm = { mode: 'manual', name: 'Pump seal', unitPrice: '25', quantity: '1' };
let batch;
let onCreated;
let onClose;

beforeEach(() => {
  jest.clearAllMocks();
  getDocs.mockResolvedValue({ docs: [] });
  batch = { set: jest.fn(), update: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
  onCreated = jest.fn();
  onClose = jest.fn();
});

const openModal = async (workflowContext = {}, extra = {}) => {
  await act(async () => {
    render(
      <Context.Provider value={{ recentlySelectedCompany: 'company-1', user: { uid: 'tech-1' } }}>
        <PartApprovalCreateModal
          open
          fixedCustomer={customer}
          fixedServiceLocation={location}
          defaultForm={defaultForm}
          workflowContext={workflowContext}
          onCreated={onCreated}
          onClose={onClose}
          {...extra}
        />
      </Context.Provider>
    );
  });
};

test.each([
  ['company', 'companies/company-1/repairRequests/request-1'],
  ['homeowner', 'homeownerRepairRequests/request-1'],
])('creating an approval closes and links the %s request in the same commit', async (source, requestPath) => {
  let finishCommit;
  batch.commit.mockReturnValue(new Promise((resolve) => { finishCommit = resolve; }));
  await openModal({ sourceRecordType: 'repairRequest', repairRequestId: 'request-1', repairRequestSourcePath: source });
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval' }));

  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  const [approvalPath, approval] = batch.set.mock.calls[0];
  expect(approvalPath).toBe(`customerPartApprovals/${approval.id}`);
  expect(approval).toMatchObject({ status: 'pending', repairRequestId: 'request-1' });
  expect(batch.update).toHaveBeenCalledWith(requestPath, {
    status: 'Resolved',
    partApprovalIds: { arrayUnion: [approval.id] },
    lastPartApprovalId: approval.id,
    lastPartApprovalStatus: 'pending',
    updatedAt: 'server-time',
  });
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => { finishCommit(); });
  expect(onCreated).toHaveBeenCalledWith(approval);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('failed saves keep the repair request workflow open without reporting success', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  batch.commit.mockRejectedValueOnce(new Error('Unable to save changes'));
  await openModal({ sourceRecordType: 'repairRequest', repairRequestId: 'request-1', repairRequestSourcePath: 'company' });
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval' }));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unable to save changes'));
  expect(toast.success).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Create Customer Approval' })).toBeEnabled();
  expect(screen.getByPlaceholderText('Part name')).toHaveValue('Pump seal');
  errorLog.mockRestore();
});

test('approvals created outside a repair request do not close any request', async () => {
  await openModal();
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(batch.set).toHaveBeenCalledTimes(1);
  expect(batch.update).not.toHaveBeenCalled();
});

test('in-person approvals still save their shopping item in the same batch', async () => {
  await openModal({}, { allowInPersonApproval: true });
  fireEvent.click(screen.getByRole('button', { name: 'Approved In Person' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  const approval = onCreated.mock.calls[0][0];
  expect(approval.status).toBe('approved');
  expect(batch.set).toHaveBeenCalledWith(
    `companies/company-1/shoppingList/${approval.shoppingListItemId}`,
    expect.objectContaining({ approvalRequestId: approval.id }),
    { merge: true }
  );
  expect(batch.commit).toHaveBeenCalledTimes(1);
});

test('cancelling approval creation does not write or close a repair request', async () => {
  await openModal({ sourceRecordType: 'repairRequest', repairRequestId: 'request-1' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Customer Approval' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onCreated).not.toHaveBeenCalled();
  expect(writeBatch).not.toHaveBeenCalled();
});
