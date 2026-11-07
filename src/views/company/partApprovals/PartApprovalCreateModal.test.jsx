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

test('creating an approval and product saves linked records with unit prices in one commit', async () => {
  let finishCommit;
  batch.commit.mockReturnValue(new Promise((resolve) => { finishCommit = resolve; }));
  await openModal({}, {
    defaultForm: { ...defaultForm, unitCost: '12.34', unitPrice: '25.67', quantity: '3', description: 'Replacement seal' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval and Create New Product' }));

  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(batch.set).toHaveBeenCalledTimes(2);
  const [approvalPath, approval] = batch.set.mock.calls[0];
  const [productPath, product] = batch.set.mock.calls[1];
  expect(approvalPath).toBe(`customerPartApprovals/${approval.id}`);
  expect(productPath).toBe(`companies/company-1/settings/genericItems/genericItems/${product.id}`);
  expect(product.id).toMatch(/^com_prod_/);
  expect(product).toMatchObject({
    name: 'Pump seal',
    description: 'Replacement seal',
    rate: 1234,
    cost: 1234,
    sellPrice: 2567,
    billingRate: 2567,
    active: true,
    billable: true,
    UOM: 'Unit',
    availableForPartApproval: true,
    availableForPartPurchase: true,
    availableForJobs: true,
    createdAt: 'server-time',
  });
  expect(approval).toMatchObject({
    status: 'pending',
    productId: product.id,
    genericItemId: product.id,
    itemId: product.id,
    productName: 'Pump seal',
    itemType: 'Product',
    dbItemId: '',
    plannedUnitCostCents: 1234,
    plannedUnitPriceCents: 2567,
    plannedTotalPriceCents: 7701,
  });
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button', { name: 'Creating...' }).every((button) => button.disabled)).toBe(true);

  await act(async () => { finishCommit(); });
  expect(toast.success).toHaveBeenCalledWith('Part approval and product created.');
  expect(onCreated).toHaveBeenCalledWith(approval);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a failed combined save retains the form and does not report either record as created', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  batch.commit.mockRejectedValueOnce(new Error('Unable to create product'));
  await openModal();
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval and Create New Product' }));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unable to create product'));
  expect(toast.success).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('Part name')).toHaveValue('Pump seal');
  expect(screen.getByRole('button', { name: 'Create Customer Approval and Create New Product' })).toBeEnabled();
  errorLog.mockRestore();
});

test('the product creation action is only shown for manual parts and requires a valid approval', async () => {
  await openModal({}, { defaultForm: { mode: 'manual' } });
  expect(screen.getByRole('button', { name: 'Create Customer Approval and Create New Product' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Item Type'), { target: { value: 'database' } });
  expect(screen.queryByRole('button', { name: 'Create Customer Approval and Create New Product' })).not.toBeInTheDocument();
  expect(writeBatch).not.toHaveBeenCalled();
});

test('the combined action respects the form validation for invalid unit costs', async () => {
  await openModal({}, { defaultForm: { ...defaultForm, unitCost: '-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval and Create New Product' }));
  expect(writeBatch).not.toHaveBeenCalled();
});

const docsFor = (records) => ({ docs: records.map((record) => ({ id: record.id, data: () => record })) });
const locationA = { id: 'location-a', name: 'Backyard' };
const locationB = { id: 'location-b', name: 'Front pool' };

test('the first listed service location is selected by default and can be changed', async () => {
  getDocs.mockImplementation(async (ref) => (
    docsFor(ref.endsWith('/serviceLocations') ? [locationB, locationA] : [])
  ));
  await openModal({}, { fixedServiceLocation: null });
  expect(screen.getByText('Backyard')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Service Location'), { key: 'ArrowDown' });
  fireEvent.click(screen.getByText('Front pool'));
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval' }));

  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(onCreated.mock.calls[0][0]).toMatchObject({
    serviceLocationId: 'location-b',
    serviceLocationSnapshot: { id: 'location-b', name: 'Front pool' },
    productId: '',
    itemType: 'Part',
  });
  expect(batch.set).toHaveBeenCalledTimes(1);
});

test('the default service location is used in the approval when it is left unchanged', async () => {
  getDocs.mockImplementation(async (ref) => (
    docsFor(ref.endsWith('/serviceLocations') ? [locationB, locationA] : [])
  ));
  await openModal({}, { fixedServiceLocation: null });
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(onCreated.mock.calls[0][0].serviceLocationId).toBe('location-a');
});

test('customers without locations can still create an approval', async () => {
  await openModal({}, { fixedServiceLocation: null });
  expect(screen.getByText('Optional location')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(onCreated.mock.calls[0][0].serviceLocationId).toBe('');
});

test('changing customers clears the old location and selects the new customer location', async () => {
  const nextCustomer = { id: 'customer-2', displayName: 'Jordan Homeowner' };
  let finishLocations;
  let locationLoads = 0;
  getDocs.mockImplementation(async (ref) => {
    if (ref.endsWith('/customers')) return docsFor([customer, nextCustomer]);
    if (ref.endsWith('/serviceLocations')) {
      locationLoads += 1;
      if (locationLoads === 1) return docsFor([locationA]);
      return new Promise((resolve) => { finishLocations = resolve; });
    }
    return docsFor([]);
  });
  await openModal({}, { fixedCustomer: null, fixedServiceLocation: null });
  fireEvent.keyDown(screen.getByLabelText('Customer'), { key: 'ArrowDown' });
  fireEvent.click(screen.getByText('Taylor Homeowner'));
  await screen.findByText('Backyard');
  fireEvent.keyDown(screen.getByLabelText('Customer'), { key: 'ArrowDown' });
  fireEvent.click(screen.getByText('Jordan Homeowner'));
  expect(screen.queryByText('Backyard')).not.toBeInTheDocument();
  await act(async () => { finishLocations(docsFor([locationB])); });
  expect(screen.getByText('Front pool')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create Customer Approval' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(onCreated.mock.calls[0][0]).toMatchObject({ customerId: 'customer-2', serviceLocationId: 'location-b' });
});
