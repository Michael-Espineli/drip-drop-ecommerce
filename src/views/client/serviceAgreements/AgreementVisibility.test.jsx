import React, { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../../context/AuthContext';
import ServiceAgreements from './ServiceAgreements';
import ServiceAgreementDetail from './ServiceAgreementDetail';
import ClientFinance from '../finance/ClientFinance';
import { CUSTOMER_VISIBLE_AGREEMENT_STATUSES } from '../../../utils/sales/customerAgreementVisibility';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
jest.mock('../../../utils/config', () => ({ db: {}, functions: {} }));
jest.mock('../../../components/sales/PaymentMethodSelector', () => () => null);
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'), doc: (_, ...parts) => parts.join('/'),
  where: (...constraint) => constraint, query: (path, ...filters) => ({ path, filters }),
  onSnapshot: jest.fn(),
}));
const user = { uid: 'homeowner', email: 'homeowner@example.test', emailVerified: true };
const published = { id: 'sent', status: 'sent', customerUserId: user.uid, companyId: 'company', customerName: 'Home Owner', title: 'Sent weekly service', totalAmountCents: 10000, terms: 'Sent terms' };
const draft = { ...published, id: 'draft', status: 'draft', title: 'Private draft pricing', totalAmountCents: 900000, terms: 'Private draft terms' };
const snapshot = (records = []) => ({ docs: records.map(({ id, ...data }) => ({ id, data: () => data })) });
const document = (data) => ({ exists: () => true, id: data.id, data: () => data });
let detail;
const mount = (page, path = '/client/service-agreements', signedInUser = user) => render(
  <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Context.Provider value={{ user: signedInUser, featureFlagsLoaded: true, isFeatureEnabled: () => false }}>
      <Routes><Route path="*" element={page} /><Route path="/client/service-agreements/:agreementId" element={<ServiceAgreementDetail />} /><Route path="/customer/service-agreements/:agreementId" element={<ServiceAgreementDetail />} /></Routes>
    </Context.Provider>
  </MemoryRouter>
);
beforeEach(() => {
  jest.clearAllMocks();
  detail = published;
  onSnapshot.mockImplementation((ref, next) => {
    queueMicrotask(() => next(typeof ref === 'string' ? document(detail) : snapshot(ref.path === 'salesAgreements' ? [published, draft, { ...draft, id: 'missing', status: undefined }] : [])));
    return () => {};
  });
  httpsCallable.mockReturnValue(jest.fn().mockResolvedValue({ data: { agreement: detail } }));
});

test('the homeowner agreement list excludes private drafts and constrains linked and verified-email queries', async () => {
  mount(<ServiceAgreements />);
  expect((await screen.findAllByText('Sent weekly service')).length).toBeGreaterThan(0);
  expect(screen.queryByText('Private draft pricing')).not.toBeInTheDocument();
  expect(screen.queryByText('Sent, revised, or draft records')).not.toBeInTheDocument();
  const queries = onSnapshot.mock.calls.map(([ref]) => ref).filter(ref => ref.path === 'salesAgreements');
  expect(queries).toHaveLength(2);
  queries.forEach(ref => expect(ref.filters).toContainEqual(['status', 'in', CUSTOMER_VISIBLE_AGREEMENT_STATUSES]));
});
test('Finance excludes draft amounts and draft attention items', async () => {
  mount(<ClientFinance />, '/client/finance');
  await screen.findAllByText('Sent weekly service');
  expect(screen.queryByText('Private draft pricing')).not.toBeInTheDocument();
  expect(screen.queryByText('$9,000.00')).not.toBeInTheDocument();
});
test.each(['draft', '', undefined, 'unknown'])('opening an unpublished agreement directly does not reveal its content: %s', async status => {
  detail = { ...draft, status };
  mount(null, '/client/service-agreements/draft');
  expect(await screen.findByText('This service agreement is not available for review.')).toBeInTheDocument();
  expect(screen.queryByText('Private draft pricing')).not.toBeInTheDocument();
  expect(screen.queryByText('Private draft terms')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Accept / })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
});
test('sent agreements remain visible and can be reviewed', async () => {
  mount(null, '/client/service-agreements/sent');
  expect((await screen.findAllByText('Sent weekly service')).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /^Accept / })).toBeInTheDocument();
});
test('an email-link response containing a draft is also hidden', async () => {
  httpsCallable.mockReturnValue(jest.fn().mockResolvedValue({ data: { agreement: draft } }));
  mount(null, '/customer/service-agreements/draft?accessToken=secure-link', null);
  await waitFor(() => expect(httpsCallable).toHaveBeenCalled());
  expect(await screen.findByText('Service agreement not found.')).toBeInTheDocument();
  expect(screen.queryByText('Private draft pricing')).not.toBeInTheDocument();
});
test('an open customer review is cleared if the agreement returns to draft', async () => {
  mount(null, '/client/service-agreements/sent');
  await screen.findAllByText('Sent weekly service');
  const receive = onSnapshot.mock.calls.find(([ref]) => ref === 'salesAgreements/sent')[1];
  await act(async () => receive(document(draft)));
  expect(screen.getByText('This service agreement is not available for review.')).toBeInTheDocument();
  expect(screen.queryByText('Sent weekly service')).not.toBeInTheDocument();
  expect(screen.queryByText('Private draft pricing')).not.toBeInTheDocument();
});
