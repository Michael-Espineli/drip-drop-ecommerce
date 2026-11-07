import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getDocs, onSnapshot } from 'firebase/firestore';
import { getFilteredDocsCount, getServerCount, sumServerCounts, listenForForegroundRefresh } from '../utils/firestoreCounts';
import { signOut } from 'firebase/auth';
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
  listenForForegroundRefresh: jest.fn(() => () => {}),
}));
jest.mock('../utils/chatMessaging', () => ({ isChatUnreadFor: jest.fn(), listenVisibleChats: jest.fn() }));
jest.mock('../navigation/index', () => ({
  COMPANY_PINNED_CATEGORY: 'Pinned',
  getNav: () => ({ Operations: [{ path: '/company/part-approvals', title: 'Part Approvals', role: 'Company' }, { path: '/company/repair-requests', title: 'Repair Requests', role: 'Company' }] }),
}));

const context = {
  role: 'Company',
  recentlySelectedCompany: 'company-1',
  user: { uid: 'tech-1' },
  dataBaseUser: {},
  companyRoleLoaded: true,
  companyRoleLoading: false,
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
  listenForForegroundRefresh.mockImplementation(() => () => {});
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
  const view = render(sidebar(value, props));
  await act(async () => { await Promise.resolve(); });
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
  view.rerender(sidebar({ ...context, recentlySelectedCompany: 'company-2' }));
  await act(async () => { await Promise.resolve(); });
  expect(previous.unsubscribe).toHaveBeenCalledTimes(1);
  expect(link).toHaveTextContent(/^Part Approvals$/);
  emit(previous, [{ status: 'pending' }]);
  expect(link).toHaveTextContent(/^Part Approvals$/);
  expect(subscriptions.find((item) => item.query.path === 'customerPartApprovals' && item.query.filters[0].value === 'company-2').query.filters[0].value).toBe('company-2');
  const current = subscriptions.find((item) => item.query.path === 'customerPartApprovals' && item.query.filters[0].value === 'company-2');
  emit(current, [{ status: 'pending' }, { status: 'pending' }]);
  expect(within(link).getByText('2')).toBeInTheDocument();
  view.unmount();
  expect(current.unsubscribe).toHaveBeenCalledTimes(1);
});

test('repair badge matches the default list and reacts to changes from both sources', async () => {
  const requests = require('../utils/models/repairRequestQueueFixtures.json');
  await renderSidebar();
  const company = subscriptions.find((item) => item.query === 'companies/company-1/repairRequests');
  const homeowner = subscriptions.find((item) => item.query.path === 'homeownerRepairRequests');
  expect(homeowner.query.filters).toEqual([{ field: 'companyId', operator: '==', value: 'company-1' }]);
  const link = await screen.findByRole('link', { name: 'Repair Requests' });
  emit(company, requests.filter((request) => request.sourcePath === 'company'));
  emit(homeowner, requests.filter((request) => request.sourcePath === 'homeowner'));
  expect(within(link).getByText('12')).toBeInTheDocument();
  emit(homeowner, [{ status: 'Resolved' }]);
  expect(within(link).getByText('9')).toBeInTheDocument();
  emit(company, [{ status: 'Converted To Job' }]);
  expect(link).toHaveTextContent(/^Repair Requests$/);
});

test('waits for company permissions before starting badge requests', async () => {
  const view = await renderSidebar({ ...context, companyRoleLoaded: false, companyRoleLoading: true });
  expect(onSnapshot).not.toHaveBeenCalled();
  expect(getDocs).not.toHaveBeenCalled();
  expect(getServerCount).not.toHaveBeenCalled();
  view.rerender(sidebar(context));
  await act(async () => { await Promise.resolve(); });
  expect(onSnapshot).toHaveBeenCalled();
  expect(getDocs).toHaveBeenCalled();
});

test('does not query shopping, jobs, equipment, or company-wide offers without their read permissions', async () => {
  await renderSidebar({ ...context, hasCompanyPermission: (id) => id === '320' });
  expect(getDocs).not.toHaveBeenCalled();
  expect(getServerCount).not.toHaveBeenCalled();
  expect(getFilteredDocsCount).not.toHaveBeenCalled();
  expect(onSnapshot).not.toHaveBeenCalled();
});

test('a denied legacy shopping count is not retried on every foreground event', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    getDocs.mockImplementation(async (ref) => {
      if (ref.path?.endsWith('/shoppingListItems')) {
        throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      }
      return { docs: [] };
    });
    await renderSidebar();
    const refresh = listenForForegroundRefresh.mock.calls[0][0];
    await act(async () => { await refresh(); await refresh(); });
    expect(getDocs.mock.calls.filter(([ref]) => ref.path?.endsWith('/shoppingListItems'))).toHaveLength(1);
    expect(getDocs.mock.calls.filter(([ref]) => ref.path?.endsWith('/shoppingList'))).toHaveLength(3);
    expect(errorLog).toHaveBeenCalledTimes(1);
  } finally { errorLog.mockRestore(); }
});

test('does not overlap initial counts with foreground requests or restart reads after unmount', async () => {
  let finish;
  getServerCount.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await renderSidebar();
  const refresh = listenForForegroundRefresh.mock.calls[0][0];
  const initialCalls = getDocs.mock.calls.length;
  await act(async () => { await refresh(); await refresh(); });
  expect(getDocs).toHaveBeenCalledTimes(initialCalls);
  await act(async () => { finish(0); });
  view.unmount();
  await refresh();
  expect(getDocs).toHaveBeenCalledTimes(initialCalls);
});

test('pauses count refreshes after a fatal browser-storage failure', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    getDocs.mockRejectedValue(new Error('FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"hc":"The transaction was aborted, so the request cannot be fulfilled."}'));
    await renderSidebar();
    const initialCalls = getDocs.mock.calls.length;
    await act(async () => { await listenForForegroundRefresh.mock.calls[0][0](); });
    expect(getDocs).toHaveBeenCalledTimes(initialCalls);
    expect(warning.mock.calls.filter(([message]) => message.startsWith('Sidebar counts paused'))).toHaveLength(1);
  } finally { warning.mockRestore(); }
});

test('logout relies on the auth listener and succeeds without an extra context callback', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    signOut.mockResolvedValue(undefined);
    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /logout/i }));
    await act(async () => { await Promise.resolve(); });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(errorLog).not.toHaveBeenCalled();
  } finally { errorLog.mockRestore(); }
});
