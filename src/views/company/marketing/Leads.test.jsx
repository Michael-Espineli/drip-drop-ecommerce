import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { subDays } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import { MemoryRouter } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import Leads from './Leads';

let mockLeads;

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
jest.mock('../../../utils/config', () => ({ db: {} }));
jest.mock('../../../utils/leads/leadCancellation', () => ({}));
jest.mock('./LeadCancellationDialog', () => () => null);
jest.mock('firebase/firestore', () => {
    const db = {};
    return {
        Timestamp: jest.requireActual('firebase/firestore').Timestamp,
        getFirestore: () => db,
        collection: (_, ...parts) => parts.join('/'),
        query: (path) => path,
        where: jest.fn(),
        onSnapshot: (path, callback) => {
            callback({ docs: path === 'homeownerServiceRequests' ? mockLeads : [] });
            return () => {};
        },
    };
});

const now = new Date(2026, 10, 17, 12);
const cutoff = subDays(now, 30);
const lead = (homeownerName, status, dateCompleted) => ({
    id: homeownerName,
    data: () => ({ homeownerName, status, dateCompleted, createdAt: subDays(now, 90) }),
});

const openLeads = () => render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Context.Provider value={{ recentlySelectedCompany: 'company' }}>
            <Leads />
        </Context.Provider>
    </MemoryRouter>
);

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    mockLeads = [
        lead('Recently completed', 'Completed', Timestamp.fromDate(subDays(now, 2))),
        lead('At the cutoff', 'Completed', cutoff),
        lead('Past the cutoff', 'Completed', new Date(cutoff.getTime() - 1)),
        lead('Undated completion', 'Completed', null),
        lead('Long-pending lead', 'Pending'),
        lead('Long-cancelled lead', 'Cancelled', subDays(now, 90)),
    ];
});

afterEach(() => jest.useRealTimers());

test('counts and lists current completions by completion date, including under All statuses', () => {
    openLeads();
    const completedCard = screen.getByRole('button', { name: 'Show Completed (last 30 days) leads' });
    expect(within(completedCard).getByText('2')).toBeInTheDocument();

    fireEvent.click(completedCard);
    expect(screen.getByText('Recently completed')).toBeInTheDocument();
    expect(screen.getByText('At the cutoff')).toBeInTheDocument();
    expect(screen.queryByText('Past the cutoff')).not.toBeInTheDocument();
    expect(screen.queryByText('Undated completion')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Lead status' }), { target: { value: 'All' } });
    expect(screen.getByText('Long-pending lead')).toBeInTheDocument();
    expect(screen.getByText('Long-cancelled lead')).toBeInTheDocument();
    expect(screen.queryByText('Past the cutoff')).not.toBeInTheDocument();
});

test('expires a completion while the page is open', () => {
    openLeads();
    const completedCard = screen.getByRole('button', { name: 'Show Completed (last 30 days) leads' });
    fireEvent.click(completedCard);
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(within(completedCard).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('At the cutoff')).not.toBeInTheDocument();
});
