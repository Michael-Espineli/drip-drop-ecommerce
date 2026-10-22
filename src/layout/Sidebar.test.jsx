import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getDocs, onSnapshot } from 'firebase/firestore';
import { getFilteredDocsCount, getServerCount, sumServerCounts } from '../utils/firestoreCounts';
import { Context } from '../context/AuthContext';
import Sidebar from './Sidebar';

jest.mock('../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../utils/config', () => ({ db: {} }));
jest.mock('firebase/auth', () => ({ getAuth: jest.fn(), signOut: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'),
  query: (path, ...filters) => ({ path, filters }),
  where: (field, operator, value) => ({ field, operator, value }),
  getDocs: jest.fn(async () => ({ docs: [] })),
  onSnapshot: jest.fn(),
}));
jest.mock('../utils/firestoreCounts', () => ({
  getServerCount: jest.fn(async () => 0),
  getFilteredDocsCount: jest.fn(async () => 0),
  sumServerCounts: jest.fn(async () => 0),
  listenForForegroundRefresh: () => () => {},
}));
jest.mock('../utils/chatMessaging', () => ({ isChatUnreadFor: jest.fn(), listenVisibleChats: jest.fn() }));
jest.mock('../navigation/index', () => ({
  COMPANY_PINNED_CATEGORY: 'Pinned',
  getNav: () => ({ Operations: [{ path: '/company/part-approvals', title: 'Part Approvals', role: 'Company' }] }),
}));

const context = {
  role: 'Company',
  recentlySelectedCompany: 'company-1',
  user: { uid: 'tech-1' },
  dataBaseUser: {},
  featureFlagsLoaded: true,
  isFeatureEnabled: () => false,
  hasCompanyPermission: () => true,
};
let subscriptions;

beforeEach(() => {
  jest.clearAllMocks();
  getDocs.mockResolvedValue({ docs: [] });
  getServerCount.mockResolvedValue(0);
  getFilteredDocsCount.mockResolvedValue(0);
  sumServerCounts.mockResolvedValue(0);
  subscriptions = [];
  onSnapshot.mockImplementation((query, onChange, onError) => {
    const unsubscribe = jest.fn();
    subscriptions.push({ query, onChange, onError, unsubscribe });
    return unsubscribe;
  });
});

const sidebar = (value = context, props = {}) => (
  <MemoryRouter>
    <Context.Provider value={value}>
      <Sidebar showSidebar setShowSidebar={jest.fn()} isCollapsed={false} setIsCollapsed={jest.fn()} {...props} />
    </Context.Provider>
  </MemoryRouter>
);
const emit = (subscription, approvals) => act(() => subscription.onChange({
  docs: approvals.map((approval) => ({ data: () => approval })),
}));
const renderSidebar = async (value, props) => {
  let view;
  await act(async () => { view = render(sidebar(value, props)); });
  return view;
};

test('the company-scoped badge counts pending approvals and updates as responses arrive', async () => {
  await renderSidebar();
  const link = await screen.findByRole('link', { name: 'Part Approvals' });
  expect(subscriptions[0].query).toEqual({
    path: 'customerPartApprovals',
    filters: [{ field: 'companyId', operator: '==', value: 'company-1' }],
  });
  emit(subscriptions[0], [
    { status: 'pending' },
    { status: 'Pending' },
    { approvalStatus: 'pending' },
    {},
    { status: 'approved', approvalStatus: 'pending' },
    { status: 'rejected' },
    { status: 'resolved' },
  ]);
  expect(within(link).getByText('4')).toBeInTheDocument();
  emit(subscriptions[0], [{ status: 'pending' }, { status: 'approved' }]);
  expect(within(link).getByText('1')).toBeInTheDocument();
  emit(subscriptions[0], [{ status: 'approved' }]);
  expect(link).toHaveTextContent(/^Part Approvals$/);
  await waitFor(() => expect(link).toHaveTextContent(/^Part Approvals$/));
});

test('collapsed and bookmarked part approval links use the same badge and existing 99+ cap', async () => {
  await renderSidebar({ ...context, dataBaseUser: { settings: { companyNavigationBookmarks: ['/company/part-approvals'] } } }, { isCollapsed: true });
  await screen.findAllByRole('link', { name: 'Part Approvals' });
  emit(subscriptions[0], Array.from({ length: 100 }, () => ({ status: 'pending' })));
  const links = screen.getAllByRole('link', { name: 'Part Approvals 99+' });
  expect(links).toHaveLength(2);
  links.forEach((link) => expect(within(link).getByText('99+')).toBeInTheDocument());
});

test('company changes clear the old badge, unsubscribe, and ignore old callbacks', async () => {
  const view = await renderSidebar();
  const link = await screen.findByRole('link', { name: 'Part Approvals' });
  const previous = subscriptions[0];
  emit(previous, [{ status: 'pending' }]);
  expect(within(link).getByText('1')).toBeInTheDocument();
  await act(async () => { view.rerender(sidebar({ ...context, recentlySelectedCompany: 'company-2' })); });
  expect(previous.unsubscribe).toHaveBeenCalledTimes(1);
  expect(link).toHaveTextContent(/^Part Approvals$/);
  emit(previous, [{ status: 'pending' }]);
  expect(link).toHaveTextContent(/^Part Approvals$/);
  expect(subscriptions[1].query.filters[0].value).toBe('company-2');
  emit(subscriptions[1], [{ status: 'pending' }, { status: 'pending' }]);
  expect(within(link).getByText('2')).toBeInTheDocument();
  view.unmount();
  expect(subscriptions[1].unsubscribe).toHaveBeenCalledTimes(1);
});
