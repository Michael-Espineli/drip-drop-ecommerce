import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { Context } from '../../context/AuthContext';
import ClientHome from './ClientHome';

jest.mock('../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../utils/config', () => ({ db: {} }));
jest.mock('./ClientCompanyInvites', () => () => null);
jest.mock('firebase/firestore', () => ({
  collection: (_, path) => path, where: (...args) => args,
  query: (path, ...filters) => ({ path, filters }), onSnapshot: jest.fn(),
}));
const user = { uid: 'home', email: 'home@example.test', emailVerified: true };
const agreement = { id: 'weekly', customerUserId: 'home', status: 'accepted', title: 'Weekly pool care', companyName: 'Pool Company', sourceType: 'recurringService' };
const snapshot = rows => ({ docs: rows.map(({ id, ...data }) => ({ id, data: () => data })) });
let rows, listeners;
const mount = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
  <Context.Provider value={{ user, name: 'Home Owner', featureFlagsLoaded: true, isFeatureEnabled: () => false }}>
    <ClientHome />
  </Context.Provider>
</MemoryRouter>);
async function updateAgreements(next) {
  rows = next;
  await act(async () => listeners.filter(listener => listener.query.path === 'salesAgreements')
    .forEach(listener => listener.callback(snapshot(next))));
}
beforeEach(() => {
  rows = [agreement]; listeners = [];
  onSnapshot.mockReset().mockImplementation((query, callback) => {
    const stop = jest.fn();
    listeners.push({ query, callback, stop });
    queueMicrotask(() => callback(snapshot(query.path === 'salesAgreements' ? rows : [])));
    return stop;
  });
});

test('accepted recurring agreements appear in progress with the detail banner and direct link', async () => {
  mount();
  const progress = await screen.findByRole('region', { name: 'In progress' });
  expect(within(progress).getByText('Waiting on company setup')).toBeInTheDocument();
  expect(within(progress).getByText('Pool Company is setting up your recurring service stop and route.')).toBeInTheDocument();
  expect(within(progress).getByRole('link')).toHaveAttribute('href', '/client/service-agreements/weekly');
  expect(screen.getByText('You are all caught up.')).toBeInTheDocument();
});

test('live acceptance moves a review item into progress, then stop creation retains route planning until routed', async () => {
  rows = [{ ...agreement, status: 'sent' }]; mount();
  expect(await screen.findByRole('link', { name: /Weekly pool care Ready for review/ })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument();
  await updateAgreements([agreement]);
  expect(screen.queryByText('Ready for review')).not.toBeInTheDocument();
  expect(screen.getByText('Waiting on company setup')).toBeInTheDocument();
  await updateAgreements([{ ...agreement, recurringServiceStopId: 'stop', operationsSetupStatus: 'recurringServiceStopCreated' }]);
  expect(screen.getByText('Recurring service setup started')).toBeInTheDocument();
  expect(screen.getByText(/Route planning is still in progress/)).toBeInTheDocument();
  await updateAgreements([{ ...agreement, recurringServiceStopId: 'stop', recurringRouteId: 'route' }]);
  expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument();
});

test('terminal records, drafts, estimates, routed and completed service are excluded while review items remain', async () => {
  rows = [agreement,
    ...['canceled', 'superseded', 'rejected', 'expired', 'draft'].map(status => ({ ...agreement, id: status, title: `Hidden ${status}`, status })),
    ...[{ sourceType: 'oneOffJob' }, { sourceType: 'workOffer' }, { sourceType: 'lead' }, { rateType: 'oneTime' }, { serviceCadence: 'oneTime' }, { operationsSetupStatus: 'ready' }, { operationsSetupStatus: 'recurringRouteAssigned' }]
      .map((change, i) => ({ ...agreement, id: `hidden-${i}`, title: `Hidden ${i}`, ...change })),
    { ...agreement, id: 'review', title: 'New agreement', status: 'revised' },
  ];
  mount();
  const progress = await screen.findByRole('region', { name: 'In progress' });
  expect(within(progress).getAllByRole('link')).toHaveLength(1);
  expect(within(progress).queryByText(/Hidden/)).not.toBeInTheDocument();
  expect(screen.getByText('New agreement')).toBeInTheDocument();
});

test('waiting agreements are not lost behind newer accepted or completed records', async () => {
  rows = [...Array.from({ length: 8 }, (_, i) => ({ ...agreement, id: `routed-${i}`, title: `Routed ${i}`, recurringRouteId: 'route' })), agreement,
    { ...agreement, id: 'other', title: 'Second property', companyName: 'Other Company' }];
  mount();
  const progress = await screen.findByRole('region', { name: 'In progress' });
  expect(within(progress).getAllByRole('link')).toHaveLength(2);
  expect(within(progress).getByText(/Other Company is setting up/)).toBeInTheDocument();
});

test('verified email recipients see accepted agreements before account linking and listeners clean up', async () => {
  rows = [{ ...agreement, customerUserId: '', email: user.email }];
  const view = mount();
  await screen.findByText('Waiting on company setup');
  expect(listeners.some(({ query }) => query.path === 'salesAgreements' && query.filters.some(filter => filter[0] === 'email' && filter[2] === user.email))).toBe(true);
  view.unmount();
  listeners.forEach(({ stop }) => expect(stop).toHaveBeenCalledTimes(1));
});

test('cancellation removes the progress card immediately', async () => {
  mount();
  await screen.findByText('Waiting on company setup');
  await updateAgreements([{ ...agreement, status: 'canceled' }]);
  expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument();
});
