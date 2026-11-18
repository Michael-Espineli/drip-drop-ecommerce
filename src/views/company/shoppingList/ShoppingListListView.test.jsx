import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { MemoryRouter } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import ShoppingListListView from './ShoppingListListView';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
jest.mock('../../../utils/config', () => ({ db: {}, functions: {}, storage: {} }));
jest.mock('../../../utils/sales/shoppingItemInvoiceAutomation', () => ({}));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock('firebase/firestore', () => ({
    collection: (_, ...parts) => parts.join('/'),
    doc: (_, ...parts) => parts.join('/'),
    query: (path) => path,
    orderBy: jest.fn(),
    getDoc: jest.fn(async () => ({ exists: () => false })),
    getDocs: jest.fn(),
    runTransaction: jest.fn(),
    serverTimestamp: () => 'server-time',
    Timestamp: jest.requireActual('firebase/firestore').Timestamp,
}));

const itemPath = 'companies/company/shoppingList/pump';
const itemName = 'Replacement pump';
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: `Actions for ${itemName}` }));
let currentItem;
let update;

beforeEach(() => {
    jest.clearAllMocks();
    currentItem = { name: itemName, status: 'Need to Purchase', quantity: '2', purchasedItem: 'linked-receipt-line' };
    update = jest.fn();
    getDocs.mockImplementation(async (path) => ({
        docs: path === 'companies/company/shoppingList'
            ? [{ id: 'pump', data: () => ({ ...currentItem }) }]
            : [],
    }));
    runTransaction.mockImplementation(async (_, operation) => operation({
        get: async (path) => ({ data: () => path === itemPath ? currentItem : undefined }),
        update,
    }));
});

const openList = async (mayEdit = true, preset) => {
    render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Context.Provider value={{
                recentlySelectedCompany: 'company',
                user: { uid: 'staff-1', displayName: 'Alex Staff' },
                companyRoleLoaded: true,
                hasCompanyPermission: (permission) => mayEdit && permission === '104',
            }}>
                <ShoppingListListView />
            </Context.Provider>
        </MemoryRouter>
    );
    if (preset) fireEvent.change(screen.getByLabelText('View'), { target: { value: preset } });
    await screen.findByText(itemName);
    openMenu();
};

test('marks a ready item purchased in place and makes it visible in the Purchased view', async () => {
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Purchased' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Marked as purchased.'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(itemPath, {
        status: 'Purchased',
        datePurchased: expect.any(Timestamp),
        purchasedAt: 'server-time',
        purchasedByUserId: 'staff-1',
        purchasedByUserName: 'Alex Staff',
        purchaserId: 'staff-1',
        purchaserName: 'Alex Staff',
        needsAction: false,
        updatedAt: 'server-time',
    });
    expect(screen.queryByText(itemName)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('View'), { target: { value: 'purchased' } });
    expect(screen.getByText(itemName)).toBeInTheDocument();
    expect(screen.getByText('Alex Staff')).toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('button', { name: 'Change Purchased Item' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as Purchased' })).not.toBeInTheDocument();
});

test('keeps previously recorded purchase details when an eligible legacy item already has them', async () => {
    const datePurchased = Timestamp.fromDate(new Date(2026, 10, 14));
    currentItem = { ...currentItem, datePurchased, purchaserId: 'buyer', purchaserName: 'Existing buyer' };
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Purchased' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(itemPath, expect.objectContaining({
        datePurchased, purchaserId: 'buyer', purchaserName: 'Existing buyer', purchasedByUserId: 'staff-1',
    })));
});

test.each([
    ['read-only employee', {}, false],
    ['pending approval', { status: 'Pending Approval' }, true],
    ['rejected approval', { status: 'Customer Rejected' }, true],
    ['legacy invoice', { invoiced: true }, true],
    ['installed item', { status: 'Installed' }, true],
])('hides the shortcut for a %s', async (_, properties, mayEdit) => {
    currentItem = { ...currentItem, ...properties };
    await openList(mayEdit, 'allStatuses');
    expect(screen.queryByRole('button', { name: 'Mark as Purchased' })).not.toBeInTheDocument();
});

test('leaves a concurrently installed item untouched', async () => {
    await openList();
    currentItem = { ...currentItem, status: 'Installed' };
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Purchased' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This item is no longer ready to purchase.'));
    expect(update).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
});
