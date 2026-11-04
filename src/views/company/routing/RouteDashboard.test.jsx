import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import RouteDashboard from './RouteDashboard';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {}, functions: {} }));
jest.mock('../../components/AddressAutocomplete', () => () => null);
jest.mock('../../../utils/vendors', () => ({ fetchCompanyVendors: async () => [] }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
    collection: (_db, ...parts) => parts.join('/'),
    query: (path, ...constraints) => ({ path, constraints }),
    where: (field, operator, value) => ({ field, operator, value }),
    orderBy: jest.fn(),
    getDocs: jest.fn(),
    getDoc: jest.fn(),
    doc: jest.fn(),
    updateDoc: jest.fn(),
    setDoc: jest.fn(),
    writeBatch: jest.fn(),
    Timestamp: { fromDate: (date) => date },
}));

const dateKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

const expectStopRangeLoaded = (start, end) => {
    expect(getDocs.mock.calls.some(([request]) => (
        request.path?.endsWith('/serviceStops')
        && request.constraints.some(({ field, operator, value }) => field === 'serviceDate' && operator === '>=' && dateKey(value) === start)
        && request.constraints.some(({ field, operator, value }) => field === 'serviceDate' && operator === '<=' && dateKey(value) === end)
    ))).toBe(true);
};

const openBoard = async () => {
    await act(async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Context.Provider value={{ recentlySelectedCompany: 'company-1' }}>
                    <RouteDashboard />
                </Context.Provider>
            </MemoryRouter>
        );
    });
};

const click = async (element) => {
    await act(async () => { fireEvent.click(element); });
};

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 2, 12));
    getDocs.mockReset().mockResolvedValue({ docs: [] });
});

afterEach(() => { jest.useRealTimers(); });

test('previous weeks retain the selected weekday and load historical daily and weekly stops', async () => {
    await openBoard();
    const previous = screen.getByRole('button', { name: 'Previous week' });
    expect(previous).toBeEnabled();

    await click(previous);
    expect(screen.getByDisplayValue('10/26/2026')).toBeInTheDocument();
    expectStopRangeLoaded('2026-10-26', '2026-10-26');
    expectStopRangeLoaded('2026-10-25', '2026-10-31');

    await click(screen.getByRole('button', { name: /Friday Oct 30/ }));
    expect(screen.getByDisplayValue('10/30/2026')).toBeInTheDocument();
    await click(previous);
    expect(screen.getByDisplayValue('10/23/2026')).toBeInTheDocument();
    expectStopRangeLoaded('2026-10-23', '2026-10-23');
    expectStopRangeLoaded('2026-10-18', '2026-10-24');

    await click(screen.getByRole('button', { name: 'Today', exact: true }));
    expect(screen.getByDisplayValue('11/02/2026')).toBeInTheDocument();
    expect(previous).toBeEnabled();
});

test('the calendar allows selecting a date in the previous week', async () => {
    await openBoard();
    await click(screen.getByDisplayValue('11/02/2026'));
    await click(screen.getByRole('button', { name: 'Previous Month' }));
    const historicalDay = screen.getByRole('option', { name: /Choose Friday, October 30th, 2026/ });
    expect(historicalDay).toHaveAttribute('aria-disabled', 'false');
    await click(historicalDay);

    expect(screen.getByDisplayValue('10/30/2026')).toBeInTheDocument();
    expectStopRangeLoaded('2026-10-30', '2026-10-30');
    expectStopRangeLoaded('2026-10-25', '2026-10-31');
});

test('future navigation still stops after three weeks and can return to earlier weeks', async () => {
    await openBoard();
    const next = screen.getByRole('button', { name: 'Next week' });
    for (let week = 0; week < 3; week += 1) await click(next);

    expect(screen.getByDisplayValue('11/23/2026')).toBeInTheDocument();
    expect(next).toBeDisabled();
    await click(screen.getByDisplayValue('11/23/2026'));
    expect(screen.getByRole('option', { name: /Choose Saturday, November 28th, 2026/ })).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('option', { name: /Not available Sunday, November 29th, 2026/ })).toHaveAttribute('aria-disabled', 'true');
    await click(screen.getByRole('option', { name: /Choose Saturday, November 28th, 2026/ }));

    await click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByDisplayValue('11/21/2026')).toBeInTheDocument();
    expect(next).toBeEnabled();
});
