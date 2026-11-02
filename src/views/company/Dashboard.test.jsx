import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getDocs, onSnapshot } from 'firebase/firestore';
import { Context } from '../../context/AuthContext';
import Dashboard from './Dashboard';

jest.mock('../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
jest.mock('../../utils/config', () => ({ db: {} }));
jest.mock('../../hooks/useCompanyRepairRequests', () => () => ({ requests: [] }));
jest.mock('../dashboard/components/RecentChatsWidget', () => () => <div>Personal conversations</div>);
jest.mock('react-apexcharts', () => () => <div aria-label="Financial chart" />);
jest.mock('firebase/firestore', () => ({
    collection: (_, ...parts) => parts.join('/'),
    query: (path) => path,
    where: jest.fn(),
    orderBy: jest.fn(),
    getDocs: jest.fn(),
    onSnapshot: jest.fn(),
}));

const fixtures = {
    customers: [
        { id: 'north', firstName: 'Nora', tags: ['North'], active: true },
        { id: 'south', firstName: 'Sam', tags: ['South'], active: true },
    ],
    workOrders: [
        { id: 'north-job', internalId: 'North pump', customerId: 'north', tags: ['South'], adminId: 'me', operationStatus: 'Unscheduled' },
        { id: 'south-job', internalId: 'South filter', customerId: 'south', operationStatus: 'Scheduled' },
        { id: 'unlinked-job', internalId: 'Unlinked work', operationStatus: 'In Progress' },
    ],
    salesInvoices: [
        { id: 'north-invoice', customerId: 'north', status: 'open', totalAmountCents: 10000 },
        { id: 'south-invoice', customerId: 'south', status: 'open', totalAmountCents: 20000 },
        { id: 'unlinked-invoice', status: 'open', totalAmountCents: 5000 },
    ],
};
const currentUser = { uid: 'me' };
const databaseUser = { id: 'me' };

beforeEach(() => {
    jest.clearAllMocks();
    getDocs.mockImplementation(async (path) => ({
        docs: (fixtures[path.split('/').pop()] || []).map(({ id, ...data }) => ({ id, data: () => data })),
    }));
    onSnapshot.mockImplementation((_, next) => {
        next({ docs: [] });
        return jest.fn();
    });
});

function Harness({ role = {}, userAccess = {}, initialTag = '' }) {
    const [selectedTag, setSelectedTag] = useState(initialTag);
    return (
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Context.Provider value={{
                recentlySelectedCompany: 'company',
                user: currentUser,
                dataBaseUser: databaseUser,
                companyRole: role,
                companyUserAccess: userAccess,
                selectedCustomerRegionTag: selectedTag,
                setSelectedCustomerRegionTag: setSelectedTag,
                featureFlagsLoaded: true,
                isFeatureEnabled: () => false,
            }}>
                <Dashboard />
            </Context.Provider>
        </MemoryRouter>
    );
}

const openJobsTile = () => screen.getByRole('link', { name: /Open Jobs/ });
const moneyMetric = () => screen.getByRole('group', { name: 'Business Done' });
const selectArea = (tag) => fireEvent.change(screen.getByRole('combobox', { name: 'Customer area' }), { target: { value: tag } });

test('Personal and Manager replace the three views, and the same Manager page filters all work and money', async () => {
    render(<Harness />);
    expect(await screen.findByRole('button', { name: 'Personal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Personal conversations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tag / Regional' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Whole Company' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manager' }));
    expect(screen.getByRole('combobox', { name: 'Customer area' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Everything' })).toBeInTheDocument();
    expect(within(openJobsTile()).getByText('3')).toBeInTheDocument();
    expect(moneyMetric()).toHaveTextContent('$350.00');

    selectArea('North');
    expect(within(openJobsTile()).getByText('1')).toBeInTheDocument();
    expect(moneyMetric()).toHaveTextContent('$100.00');
    expect(screen.getByText('Manager: North')).toBeInTheDocument();
    expect(screen.queryByText('South filter')).not.toBeInTheDocument();
    expect(screen.queryByText('Unlinked work')).not.toBeInTheDocument();

    selectArea('South');
    expect(moneyMetric()).toHaveTextContent('$200.00');
    expect(screen.queryByText('North pump')).not.toBeInTheDocument();
    selectArea('');
    expect(within(openJobsTile()).getByText('3')).toBeInTheDocument();
    expect(moneyMetric()).toHaveTextContent('$350.00');
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    expect(screen.getByText('Personal conversations')).toBeInTheDocument();
    expect(screen.getByText('North pump')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Customer area' })).not.toBeInTheDocument();
});

test('Manager retains its chosen tag when switching to Personal and back', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manager' }));
    selectArea('North');
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manager' }));
    expect(screen.getByRole('combobox', { name: 'Customer area' })).toHaveValue('North');
    expect(moneyMetric()).toHaveTextContent('$100.00');
});

test('company-only access still supports Everything and individual tag filters', async () => {
    render(<Harness role={{ dashboardScopeAccess: ['company'] }} />);
    const picker = await screen.findByRole('combobox', { name: 'Customer area' });
    expect(screen.queryByRole('button', { name: 'Personal' })).not.toBeInTheDocument();
    expect(picker).toHaveValue('');
    selectArea('North');
    expect(moneyMetric()).toHaveTextContent('$100.00');
    selectArea('');
    expect(moneyMetric()).toHaveTextContent('$350.00');
});

test('regional-only access selects a permitted tag and never offers Everything', async () => {
    render(<Harness initialTag="South" role={{ dashboardScopeAccess: ['regional'], fullCustomerRegionAccess: false, customerRegionTags: ['North'] }} />);
    expect(await screen.findByRole('combobox', { name: 'Customer area' })).toHaveValue('North');
    expect(screen.queryByRole('option', { name: 'Everything' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'South' })).not.toBeInTheDocument();
    expect(within(openJobsTile()).getByText('1')).toBeInTheDocument();
    expect(moneyMetric()).toHaveTextContent('$100.00');
});

test('limited Company access combines only granted tags and excludes unlinked records', async () => {
    render(<Harness role={{ dashboardScopeAccess: ['company'], fullCustomerRegionAccess: false, customerRegionTags: ['North', 'South'] }} />);
    expect(await screen.findByRole('combobox', { name: 'Customer area' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'All permitted areas' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Everything' })).not.toBeInTheDocument();
    expect(within(openJobsTile()).getByText('2')).toBeInTheDocument();
    expect(moneyMetric()).toHaveTextContent('$300.00');
    expect(screen.queryByText('Unlinked work')).not.toBeInTheDocument();
});

test.each([
    { dashboardScopeAccess: ['regional'], fullCustomerRegionAccess: false, customerRegionTags: [] },
    { dashboardScopeAccess: ['company'], fullCustomerRegionAccess: false, customerRegionTags: [] },
])('empty limited tag grants cannot fall through to whole-company data (%j)', async (role) => {
    render(<Harness role={role} />);
    expect(await screen.findByText(/No areas available\. Ask/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Customer area' })).toBeDisabled();
    expect(screen.queryByText('Business Done')).not.toBeInTheDocument();
    expect(screen.queryByText('North pump')).not.toBeInTheDocument();
});

test('user scope overrides and explicit empty grants preserve access boundaries', async () => {
    const { rerender } = render(<Harness role={{ dashboardScopeAccess: ['company'] }} userAccess={{ dashboardScopeAccess: ['personal'] }} />);
    expect(await screen.findByRole('button', { name: 'Personal' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manager' })).not.toBeInTheDocument();
    rerender(<Harness role={{ dashboardScopeAccess: ['company'] }} userAccess={{ dashboardScopeAccess: [] }} />);
    expect(screen.getByText(/No dashboard access/)).toBeInTheDocument();
    expect(screen.queryByText('Business Done')).not.toBeInTheDocument();
});

test('access changes replace a stale regional selection and remove a revoked Manager view', async () => {
    const { rerender } = render(<Harness initialTag="North" role={{ dashboardScopeAccess: ['regional'], fullCustomerRegionAccess: false, customerRegionTags: ['North'] }} />);
    expect(await screen.findByRole('combobox', { name: 'Customer area' })).toHaveValue('North');
    rerender(<Harness role={{ dashboardScopeAccess: ['regional'], fullCustomerRegionAccess: false, customerRegionTags: ['South'] }} />);
    expect(screen.getByRole('combobox', { name: 'Customer area' })).toHaveValue('South');
    expect(moneyMetric()).toHaveTextContent('$200.00');
    expect(screen.queryByText('North pump')).not.toBeInTheDocument();
    rerender(<Harness role={{ dashboardScopeAccess: ['personal'] }} />);
    expect(screen.getByRole('button', { name: 'Personal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Manager' })).not.toBeInTheDocument();
    expect(screen.queryByText('Money Overview')).not.toBeInTheDocument();
});

test.each(['Deleted tag', ''])('an invalid or empty saved tag resolves to Everything for Company access (%s)', async (initialTag) => {
    render(<Harness role={{ dashboardScopeAccess: ['company'] }} initialTag={initialTag} />);
    expect(await screen.findByRole('combobox', { name: 'Customer area' })).toHaveValue('');
    expect(moneyMetric()).toHaveTextContent('$350.00');
});
