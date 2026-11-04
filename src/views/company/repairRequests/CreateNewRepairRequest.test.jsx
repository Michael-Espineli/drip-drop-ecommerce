import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getDoc, getDocs, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../../context/AuthContext';
import CreateNewRepairRequest from './CreateNewRepairRequest';
import NewRepairRequest from '../../client/repairRequests/NewRepairRequest';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {}, storage: {} }));
jest.mock('../../../firebase', () => ({ db: {}, storage: {}, functions: {} }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../utils/callableAuth', () => ({ getCallableAuthPayload: async () => ({ idToken: 'fixture' }) }));
const submitHomeowner = jest.fn();
jest.mock('../../../utils/repairRequestPhotos', () => ({ buildCompanyRepairRequestPhotoPath: jest.fn(), uploadRepairRequestPhoto: jest.fn() }));
jest.mock('../../../utils/appDialog', () => ({ appAlert: jest.fn() }));
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({ requirePermission: () => true }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'), doc: (_, ...parts) => parts.join('/'), query: (ref) => ref,
  where: jest.fn(), orderBy: jest.fn(), serverTimestamp: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  submitHomeowner.mockResolvedValue({ data: { requestId: "new-homeowner-request" } });
  httpsCallable.mockReturnValue(submitHomeowner);
  getDoc.mockResolvedValue({ id: 'customer-1', exists: () => true, data: () => ({ firstName: 'Taylor', lastName: 'Customer' }) });
  getDocs.mockImplementation(async (path) => ({ docs: path === 'homeownerServiceLocations'
    ? [{ id: 'location-1', data: () => ({ nickName: 'Backyard' }) }]
    : path === 'customerCompanyRelationships' ? [{ id: 'relationship', data: () => ({ companyId: 'company-1', companyName: 'Pool Company', status: 'active' }) }] : [] }));
  setDoc.mockResolvedValue(undefined);
});

test.each(['company', 'homeowner'])('%s intake saves the selected priority', async (source) => {
  const company = source === 'company';
  await act(async () => render(
    <MemoryRouter initialEntries={['/create/customer-1']}>
      <Context.Provider value={{ recentlySelectedCompany: 'company-1', user: { uid: 'user-1', displayName: 'Alex' } }}>
        <Routes>
          <Route path="/create/:customerId" element={company ? <CreateNewRepairRequest /> : <NewRepairRequest />} />
          <Route path="*" element={<p>Requests</p>} />
        </Routes>
      </Context.Provider>
    </MemoryRouter>
  ));
  const priority = await screen.findByRole('combobox', { name: 'Priority', exact: true });
  expect(priority).toHaveValue('2');
  fireEvent.change(priority, { target: { value: '4' } });
  if (!company) fireEvent.change(screen.getByRole('combobox', { name: 'Service address' }), { target: { value: 'location-1' } });
  fireEvent.change(screen.getByRole('textbox', { name: company ? 'Description' : 'Describe the issue', exact: true }), { target: { value: 'Upgrade pool controls' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: company ? /Submit Request/ : /Send repair request/ })));
  if (company) await waitFor(() => expect(setDoc).toHaveBeenCalledWith(
    expect.stringMatching(/^companies\/company-1\/repairRequests\//),
    expect.objectContaining({ issuePriorityLevel: 4, issuePriorityLabel: 'Optional Upgrade', priorityLevel: 4, priorityLabel: 'Optional Upgrade' }),
  ));
  else await waitFor(() => expect(submitHomeowner).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-1', locationId: 'location-1', issuePriorityLevel: 4 })));

});
