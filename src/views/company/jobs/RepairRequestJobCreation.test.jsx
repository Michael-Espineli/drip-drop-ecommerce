import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getDoc, getDocs } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { createJobAtomically } from '../../../utils/createJobAtomically';
import { appAlert } from '../../../utils/appDialog';
import CreateNewJob from './CreateNewJob';
import BasicWorkOrderCreate from './BasicWorkOrderCreate';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {} }));
jest.mock('../../../utils/productCatalog', () => ({ loadJobProductCatalog: async () => ({ items: [], categories: [], vendorItems: [] }) }));
jest.mock('../../../utils/createJobAtomically', () => ({ createJobAtomically: jest.fn() }));
jest.mock('../../../utils/appDialog', () => ({ appAlert: jest.fn(), appConfirm: jest.fn(async () => true) }));
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({ can: () => true, requirePermission: () => true, permissionsReady: true }));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock('../../components/equipment/EquipmentCatalogPicker', () => () => null);
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'), doc: (_, ...parts) => parts.join('/'),
  query: (ref) => ref, where: jest.fn(), orderBy: jest.fn(), arrayUnion: (...items) => items,
  serverTimestamp: () => 'server-time', Timestamp: { fromDate: (date) => date, now: () => new Date() },
  getDoc: jest.fn(), getDocs: jest.fn(), updateDoc: jest.fn(),
}));

const snapshot = (id, data) => ({ id, exists: () => true, data: () => data });
const template = { id: 'template-1', name: 'Pump repair', description: 'Template scope', defaultIssuePriorityLevel: 4 };
let writes;
beforeEach(() => {
  jest.clearAllMocks();
  writes = new Map();
  getDoc.mockImplementation(async (path) => snapshot(path.split('/').pop(), path.endsWith('/location-1') ? { customerId: 'customer-1', address: { streetAddress: '123 Pool Street' } } : {}));
  getDocs.mockImplementation(async (path) => ({ docs: path.endsWith('/companyUsers')
    ? [snapshot('admin-1', { userId: 'user-1', userName: 'Alex', status: 'Active' })]
    : path.endsWith('/customers') ? [snapshot('customer-1', { firstName: 'Taylor', lastName: 'Customer' })]
    : path.endsWith('/serviceLocations') ? [snapshot('location-1', { customerId: 'customer-1', address: { streetAddress: '123 Pool Street' } })]
    : path.endsWith('/jobTemplates') ? [snapshot(template.id, { ...template, isActive: true, technicianCanAdd: true })]
    : [] }));
  createJobAtomically.mockImplementation(async (_, __, build) => {
    await build({
      get: getDoc, set: async (ref, data) => writes.set(ref, data),
      update: async (ref, data) => writes.set(ref, { ...writes.get(ref), ...data }),
    });
    return { existing: false };
  });
});

const openJob = async (request, startingTemplate) => {
  render(<MemoryRouter initialEntries={[{ pathname: '/company/jobs/create', state: { repairRequest: request, startingTemplate } }]}>
    <Context.Provider value={{ recentlySelectedCompany: 'company-1', user: { uid: 'user-1', displayName: 'Alex' } }}>
      <CreateNewJob />
    </Context.Provider>
  </MemoryRouter>);
  return screen.findByRole('combobox', { name: 'Issue Priority' });
};

test.each([undefined, template])('request priority carries into the job and starter plan with template %s', async (startingTemplate) => {
  const priority = await openJob({ id: 'request-1', customerId: 'customer-1', locationId: 'location-1', description: 'Pump leaking', issuePriorityLevel: 1 }, startingTemplate);
  if (startingTemplate) {
    await waitFor(() => expect(getDocs).toHaveBeenCalledWith('companies/company-1/jobTemplates/template-1/laborLineItems'));
    await act(async () => {});
  }
  expect(priority).toHaveValue('1');
  const button = screen.getAllByRole('button', { name: 'Create Job' })[0];
  await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
  await act(async () => fireEvent.click(button));
  await waitFor(() => expect(createJobAtomically).toHaveBeenCalled());
  await waitFor(() => expect([...writes.keys()].some((key) => /\/workOrders\/[^/]+$/.test(key))).toBe(true));
  const job = [...writes.entries()].find(([key]) => /\/workOrders\/[^/]+$/.test(key))[1];
  const plan = [...writes.entries()].find(([key]) => /\/plans\/[^/]+$/.test(key))[1];
  expect(job).toEqual(expect.objectContaining({ issuePriorityLevel: 1, issuePriorityLabel: 'Critical', priorityLevel: 1, repairRequestId: 'request-1' }));
  expect(plan).toEqual(expect.objectContaining({ issuePriorityLevel: 1, issuePriorityLabel: 'Critical' }));
  expect(appAlert).not.toHaveBeenCalled();
});

test('request priority can be adjusted before creating a job', async () => {
  const priority = await openJob({ id: 'request-1', issuePriorityLevel: 3 });
  expect(priority).toHaveValue('3');
  fireEvent.change(priority, { target: { value: '4' } });
  expect(priority).toHaveValue('4');
});

test.each(['custom', 'template'])('basic %s jobs inherit the request priority in the job and plan', async (mode) => {
  render(<MemoryRouter initialEntries={[{ pathname: '/company/jobs/basic-create', search: mode === 'template' ? '?templateId=template-1' : '', state: {
    repairRequest: { id: 'request-1', customerId: 'customer-1', locationId: 'location-1', issuePriorityLevel: 3, description: 'Maintain pump' },
  } }]}>
    <Context.Provider value={{ recentlySelectedCompany: 'company-1', user: { uid: 'user-1', displayName: 'Alex' } }}>
      <BasicWorkOrderCreate />
    </Context.Provider>
  </MemoryRouter>);
  if (mode === 'custom') fireEvent.click(await screen.findByRole('button', { name: /^Custom/ }));
  const button = await screen.findByRole('button', { name: 'Create and Schedule' });
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => fireEvent.click(button));
  await waitFor(() => expect(createJobAtomically).toHaveBeenCalled());
  await waitFor(() => expect([...writes.keys()].some((key) => /\/workOrders\/[^/]+$/.test(key))).toBe(true));
  const job = [...writes.entries()].find(([key]) => /\/workOrders\/[^/]+$/.test(key))[1];
  const plan = [...writes.entries()].find(([key]) => /\/plans\/[^/]+$/.test(key))[1];
  expect(job).toEqual(expect.objectContaining({ issuePriorityLevel: 3, issuePriorityLabel: 'Preventive', repairRequestId: 'request-1' }));
  expect(plan).toEqual(expect.objectContaining({ issuePriorityLevel: 3, issuePriorityLabel: 'Preventive' }));
  expect(appAlert).not.toHaveBeenCalled();
});
