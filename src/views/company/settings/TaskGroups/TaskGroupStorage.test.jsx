import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { collection, doc, query, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Context } from '../../../../context/AuthContext';
import TaskGroups from './TaskGroups';
import TaskGroupDetails from './TaskGroupDetails';
import CreateNewTaskGroup from './CreateNewTaskGroup';

jest.mock('../../../../utils/config', () => ({ db: {}, auth: { currentUser: { uid: 'owner' } } }));
jest.mock('../../../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
jest.mock('../../../../hooks/useCompanyPermissions', () => () => ({ can: () => true, requirePermission: () => true }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: Object.assign(jest.fn(), { success: jest.fn(), dismiss: jest.fn() }) }));
jest.mock('react-select', () => props => <select aria-label="Task type" onChange={event => props.onChange(props.options.find(option => option.value === event.target.value))}>
  <option value="">Choose</option>{props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
</select>);
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...parts) => parts.filter(part => typeof part === 'string').join('/')),
  doc: jest.fn((...parts) => parts.filter(part => typeof part === 'string').join('/')),
  query: jest.fn(ref => ref), getDoc: jest.fn(), getDocs: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(), deleteDoc: jest.fn(), serverTimestamp: () => 'SERVER_TIME',
}));
const base = 'companies/company/settings/taskGroup/taskGroup';
const snapshot = (id, data) => ({ id, exists: () => true, data: () => data });
beforeEach(() => {
  jest.clearAllMocks();
  collection.mockImplementation((...parts) => parts.filter(part => typeof part === 'string').join('/'));
  doc.mockImplementation((...parts) => parts.filter(part => typeof part === 'string').join('/'));
  query.mockImplementation(ref => ref);
  getDoc.mockResolvedValue(snapshot('group', { groupName: 'Weekly Service', numberOfTasks: 1, canDelete: false }));
  getDocs.mockImplementation(async path => { const docs = path === 'universal/settings/taskTypes' ? [snapshot('clean', { name: 'Clean' })]
    : path === base ? [snapshot('group', { id: 'stale', groupName: 'Weekly Service', numberOfTasks: 1 })]
      : path.endsWith('/taskItems') ? [snapshot('brush', { name: 'Brush', type: 'Clean', contractedRate: 0, estimatedTime: 5 })] : [];
    return { docs, forEach: callback => docs.forEach(callback) }; });
  setDoc.mockResolvedValue(); updateDoc.mockResolvedValue(); deleteDoc.mockResolvedValue();
});
const renderPage = (page, company = 'company') => render(<MemoryRouter initialEntries={['/groups/group']}><Context.Provider value={{ recentlySelectedCompany: company }}>
  <Routes><Route path="/groups/:taskGroupId" element={page} /><Route path="/company/taskGroups/details/:taskGroupId" element={<p>Saved group</p>} /></Routes>
</Context.Provider></MemoryRouter>);

test('the management list reads canonical groups and accepts groupName with document identity', async () => {
  renderPage(<TaskGroups />);
  await screen.findByText('Weekly Service');
  expect(getDocs).toHaveBeenCalledWith(base);
  expect(screen.getByRole('row', { name: /Weekly Service/ })).toHaveTextContent('1 tasks');
  expect(getDocs).not.toHaveBeenCalledWith(expect.stringContaining('/taskGroups/'));
});
test('details read canonical taskItems and preserve the protected default-group flag', async () => {
  renderPage(<TaskGroupDetails />);
  await screen.findByText('Brush');
  expect(getDoc).toHaveBeenCalledWith(`${base}/group`);
  expect(getDocs).toHaveBeenCalledWith(`${base}/group/taskItems`);
  expect(screen.getByText('Weekly Service')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Delete Group$/ })).not.toBeInTheDocument();
});
test('adding an item from group details writes taskItems and updates the canonical header', async () => {
  renderPage(<TaskGroupDetails />); await screen.findByText('Brush');
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Skim' } });
  fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Skim pool' } });
  fireEvent.change(screen.getByPlaceholderText('Contracted Rate'), { target: { value: '0' } });
  fireEvent.change(screen.getByPlaceholderText('Estimated Time'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Task type'), { target: { value: 'Clean' } });
  fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${base}/group/taskItems/`)), expect.objectContaining({ name: 'Skim' })));
  await waitFor(() => expect(updateDoc).toHaveBeenCalledWith(`${base}/group`, { numberOfTasks: 2 }));
});
test('creating a group writes its header and items to the historical canonical collections', async () => {
  renderPage(<CreateNewTaskGroup />);
  await screen.findByRole('option', { name: 'Clean' });
  fireEvent.change(screen.getByPlaceholderText('e.g. Weekly Pool Service'), { target: { value: 'Routine' } });
  fireEvent.change(screen.getByPlaceholderText('Task name'), { target: { value: 'Brush' } });
  fireEvent.change(screen.getByPlaceholderText('Task description'), { target: { value: 'Brush walls' } });
  fireEvent.change(screen.getByPlaceholderText('Labor cost'), { target: { value: '0' } });
  fireEvent.change(screen.getByPlaceholderText('Estimated time (min)'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Task type'), { target: { value: 'Clean' } });
  fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
  await screen.findByText('Brush');
  fireEvent.click(screen.getAllByRole('button', { name: 'Create Task Group' })[0]);
  await screen.findByText('Saved group');
  const header = setDoc.mock.calls.find(([, data]) => data.name === 'Routine');
  expect(header[0]).toMatch(new RegExp(`^${base}/[^/]+$`));
  expect(header[1]).toEqual(expect.objectContaining({ createdByUserId: 'owner', createdAt: 'SERVER_TIME', isActive: true, estimatedMinutes: 5 }));
  expect(setDoc).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${base}/[^/]+/taskItems/`)), expect.objectContaining({ name: 'Brush' }));
});
