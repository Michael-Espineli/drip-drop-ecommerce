import React, { act } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { getDoc, getDocs } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import Customers from './Customers';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
jest.mock('../../../utils/config', () => ({ db: {} }));
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({ can: () => true }));
jest.mock('../../../utils/customerMerge', () => ({ mergeDuplicateCustomers: jest.fn(), previewCustomerMerge: jest.fn() }));
jest.mock('firebase/firestore', () => ({
    collection: (_, ...parts) => parts.join('/'),
    doc: (_, ...parts) => parts.join('/'),
    query: (ref) => ref,
    where: jest.fn(),
    orderBy: jest.fn(),
    getDocs: jest.fn(),
    getDoc: jest.fn(),
    updateDoc: jest.fn(),
}));

const snapshot = (records = []) => ({
    docs: records.map(({ id, ...data }) => ({ id, data: () => data })),
    empty: records.length === 0,
    size: records.length,
});
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};
const customers = [
    { id: 'amy', firstName: 'Amy', lastName: 'Adams', active: true, email: 'amy@example.com', tags: ['East'] },
    { id: 'ben', firstName: 'Ben', lastName: 'Brown', active: true, email: 'ben@example.com', tags: ['West'] },
    { id: 'iris', firstName: 'Iris', active: false, tags: ['East'] },
];
const baseContext = {
    recentlySelectedCompany: 'company',
    featureFlagsLoaded: true,
    isFeatureEnabled: () => true,
};
const CurrentPath = () => <output data-testid="current-path">{useLocation().pathname}</output>;
const page = (context = {}) => (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Context.Provider value={{ ...baseContext, ...context }}>
            <Customers />
            <CurrentPath />
        </Context.Provider>
    </MemoryRouter>
);

beforeEach(() => {
    jest.clearAllMocks();
    getDocs.mockImplementation(async (ref) => snapshot(ref.endsWith('/customers') ? customers : []));
    getDoc.mockResolvedValue({ exists: () => false });
});

test('shows every matching customer and supports navigation while subscription and notes are still loading', async () => {
    const customerRequest = deferred();
    const subscriptionRequest = deferred();
    const amyNotes = deferred();
    const benNotes = deferred();
    getDocs.mockImplementation((ref) => {
        if (ref.endsWith('/customers')) return customerRequest.promise;
        if (ref.endsWith('/subscriptions')) return subscriptionRequest.promise;
        return ref.includes('/amy/') ? amyNotes.promise : benNotes.promise;
    });
    render(page());
    expect(screen.getByRole('status', { name: 'Loading customers' })).toBeInTheDocument();
    await act(async () => customerRequest.resolve(snapshot(customers)));

    expect(screen.getByRole('row', { name: /Amy Adams/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Ben Brown/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Iris/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading customers' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 3 visible customers')).toBeInTheDocument();
    expect(screen.getByText('Loading customer details...')).toBeInTheDocument();
    expect(screen.queryByText('Approaching Limit')).not.toBeInTheDocument();

    // Each badge can arrive independently of every other customer's notes.
    await act(async () => amyNotes.resolve(snapshot([{ id: 'note-1' }, { id: 'note-2' }])));
    expect(within(screen.getByRole('row', { name: /Amy Adams/ })).getByText('2 unresolved notes')).toBeInTheDocument();
    expect(screen.getByText('Loading customer details...')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Amy Adams'));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/company/customers/details/amy');

    await act(async () => {
        subscriptionRequest.resolve(snapshot());
        benNotes.resolve(snapshot());
    });
    expect(screen.queryByText('Loading customer details...')).not.toBeInTheDocument();
    expect(screen.getByText('You can only add 3 more customer(s). Please upgrade your plan soon.')).toBeInTheDocument();
});

test('keeps rows visible while the subscription plan document loads', async () => {
    const planRequest = deferred();
    getDocs.mockImplementation(async (ref) => {
        if (ref.endsWith('/subscriptions')) return snapshot([{ id: 'sub', dripDropSubscriptionId: 'plan' }]);
        return snapshot(ref.endsWith('/customers') ? customers : []);
    });
    getDoc.mockReturnValue(planRequest.promise);
    render(page());
    expect(await screen.findByRole('row', { name: /Amy Adams/ })).toBeInTheDocument();
    expect(screen.getByText('Loading customer details...')).toBeInTheDocument();
    await act(async () => planRequest.resolve({ exists: () => true, data: () => ({ features: [{ name: 'customerCount', limit: 2 }] }) }));
    expect(screen.getByText('Upgrade Required')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Ben Brown/ })).toBeInTheDocument();
});

test('search, status, and regional filters keep working without reloading customers or subscriptions', async () => {
    const view = render(page());
    await screen.findByRole('row', { name: /Amy Adams/ });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Amy' } });
    expect(screen.queryByRole('row', { name: /Ben Brown/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'All', exact: true }));
    expect(screen.getByRole('row', { name: /Iris/ })).toBeInTheDocument();

    view.rerender(page({ selectedCustomerRegionTag: 'West' }));
    expect(screen.getByRole('row', { name: /Ben Brown/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Amy Adams/ })).not.toBeInTheDocument();
    view.rerender(page({ companyUserAccess: { fullCustomerRegionAccess: false, customerTagAccess: ['East'] } }));
    expect(screen.getByRole('row', { name: /Amy Adams/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Ben Brown/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Loading customer details...')).not.toBeInTheDocument());
    expect(getDocs.mock.calls.filter(([ref]) => ref.endsWith('/customers'))).toHaveLength(1);
    expect(getDocs.mock.calls.filter(([ref]) => ref.endsWith('/subscriptions'))).toHaveLength(1);
});

test('failed secondary requests leave rows and successful note badges available', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
        getDocs.mockImplementation(async (ref) => {
            if (ref.endsWith('/customers')) return snapshot(customers);
            if (ref.includes('/amy/notes')) return snapshot([{ id: 'note' }]);
            throw new Error('Secondary request failed');
        });
        render(page());
        expect(await screen.findByText('1 unresolved note')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Loading customer details...')).not.toBeInTheDocument());
        expect(screen.getByRole('row', { name: /Amy Adams/ })).toBeInTheDocument();
        expect(screen.getByRole('row', { name: /Ben Brown/ })).toBeInTheDocument();
    } finally {
        consoleError.mockRestore();
    }
});

test('ignores customer and subscription responses from the previous company', async () => {
    const oldCustomers = deferred();
    const oldPlan = deferred();
    getDocs.mockImplementation(async (ref) => {
        if (ref === 'companies/company/customers') return oldCustomers.promise;
        if (ref === 'companies/company/subscriptions') return snapshot([{ id: 'sub', dripDropSubscriptionId: 'old-plan' }]);
        if (ref.endsWith('/customers')) return snapshot([{ id: 'new', firstName: 'New company customer', active: true }]);
        return snapshot();
    });
    getDoc.mockReturnValue(oldPlan.promise);
    const view = render(page());
    await waitFor(() => expect(getDoc).toHaveBeenCalledWith('subscriptions/old-plan'));
    view.rerender(page({ recentlySelectedCompany: 'new-company' }));
    await screen.findByRole('row', { name: /New company customer/ });
    await act(async () => {
        oldCustomers.resolve(snapshot(customers));
        oldPlan.resolve({ exists: () => true, data: () => ({ features: [{ name: 'customerCount', limit: 0 }] }) });
    });
    expect(screen.queryByRole('row', { name: /Amy Adams/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /New company customer/ })).toBeInTheDocument();
    expect(screen.queryByText('Upgrade Required')).not.toBeInTheDocument();
    expect(screen.getByText('You can only add 4 more customer(s). Please upgrade your plan soon.')).toBeInTheDocument();
});

test('ignores old note counts after switching companies with the same customer ID', async () => {
    const oldNotes = deferred();
    getDocs.mockImplementation(async (ref) => {
        if (ref.endsWith('/customers')) return snapshot(customers.slice(0, 1));
        if (ref === 'companies/company/customers/amy/notes') return oldNotes.promise;
        return snapshot();
    });
    const view = render(page());
    await screen.findByRole('row', { name: /Amy Adams/ });
    view.rerender(page({ recentlySelectedCompany: 'new-company' }));
    await waitFor(() => expect(screen.queryByText('Loading customer details...')).not.toBeInTheDocument());
    await act(async () => oldNotes.resolve(snapshot([{ id: 'old-note' }])));
    expect(screen.queryByText('1 unresolved note')).not.toBeInTheDocument();
});

test('reports a customer request failure instead of showing an empty list', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
        getDocs.mockImplementation(async (ref) => {
            if (ref.endsWith('/customers')) throw new Error('Customer request failed');
            return snapshot();
        });
        render(page());
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load customers. Please try again.');
        expect(screen.queryByText('No customers found.')).not.toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Loading customers' })).not.toBeInTheDocument();
    } finally {
        consoleError.mockRestore();
    }
});
