import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateDoc } from 'firebase/firestore';
import { Context } from '../../context/AuthContext';
import NavigationOrderSettings from './NavigationOrderSettings';
import { DEFAULT_COMPANY_CATEGORY_ORDER } from '../../navigation';

jest.mock('../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../utils/config', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({ doc: (_, ...parts) => parts.join('/'), updateDoc: jest.fn() }));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));

const baseContext = {
    user: { uid: 'user-1' },
    companyRoleLoading: false,
    hasCompanyPermission: () => true,
    featureFlagsLoaded: true,
    isFeatureEnabled: () => true,
};
let lastProfile;

const Harness = ({ settings = {}, context = {} }) => {
    const [profile, setProfile] = useState({ name: 'Alex', settings: { theme: 'dark', ...settings } });
    lastProfile = profile;
    return <Context.Provider value={{ ...baseContext, ...context, dataBaseUser: profile, setDataBaseUser: setProfile }}><NavigationOrderSettings /></Context.Provider>;
};

const openEditor = (props = {}) => {
    render(<Harness {...props} />);
    expect(screen.getByRole('heading', { name: 'Navigation Order' })).toBeInTheDocument();
    act(() => userEvent.click(screen.getByRole('button', { name: 'Edit Order' })));
    return screen.getByRole('dialog', { name: 'Edit Navigation Order' });
};

beforeEach(() => { jest.clearAllMocks(); updateDoc.mockResolvedValue(undefined); });

test('moves any link including Dashboard to All the rest and restores it using only the personal settings field', async () => {
    const dialog = openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Dashboard to All the rest' }));
    await waitFor(() => expect(updateDoc).toHaveBeenCalledWith('users/user-1', { 'settings.companyNavigationAllTheRest': ['/company/dashboard'] }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Move Dashboard back to sidebar' })).toBeEnabled());
    expect(lastProfile).toEqual({ name: 'Alex', settings: { theme: 'dark', companyNavigationAllTheRest: ['/company/dashboard'] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Dashboard back to sidebar' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationAllTheRest).toEqual([]));
    expect(within(dialog).getByRole('button', { name: 'Move Dashboard to All the rest' })).toBeInTheDocument();
});

test('restores all links without clearing category order or bookmarks', async () => {
    const settings = { companyNavigationAllTheRest: ['/company/customers', '/company/dashboard'], companyNavigationBookmarks: ['/company/customers'], companyNavigationCategoryOrder: ['Finance', 'Operations'] };
    const dialog = openEditor({ settings });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore all links' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationAllTheRest).toEqual([]));
    expect(lastProfile.settings.companyNavigationBookmarks).toEqual(settings.companyNavigationBookmarks);
    expect(lastProfile.settings.companyNavigationCategoryOrder).toEqual(settings.companyNavigationCategoryOrder);
});

test('a failed save restores the original sidebar and permits retry', async () => {
    updateDoc.mockRejectedValueOnce(new Error('Offline'));
    const dialog = openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Customers to All the rest' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not save your sidebar changes');
    expect(within(dialog).getByRole('button', { name: 'Move Customers to All the rest' })).toBeEnabled();
    expect(lastProfile.settings.companyNavigationAllTheRest).toBeUndefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Customers to All the rest' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationAllTheRest).toEqual(['/company/customers']));
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
});

test('locks competing saves and dismissal until the current write completes', async () => {
    let finishSave;
    updateDoc.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    const dialog = openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Customers to All the rest' }));
    const otherMove = within(dialog).getByRole('button', { name: 'Move Dashboard to All the rest' });
    expect(otherMove).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeDisabled();
    fireEvent.click(otherMove);
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(updateDoc).toHaveBeenCalledTimes(1);
    await act(async () => { finishSave(); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('keeps category order controls and reset separate from moved links', async () => {
    const dialog = openEditor({ settings: { companyNavigationAllTheRest: ['/company/dashboard'] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Category order', exact: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Finance up' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationCategoryOrder).toEqual(['Operations', 'Finance', 'Management', 'Marketing', 'Migration']));
    expect(lastProfile.settings.companyNavigationAllTheRest).toEqual(['/company/dashboard']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset Default' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationCategoryOrder).toEqual(DEFAULT_COMPANY_CATEGORY_ORDER));
    expect(lastProfile.settings.companyNavigationAllTheRest).toEqual(['/company/dashboard']);
});

test('keeps bookmark preferences when a bookmarked link moves to All the rest', async () => {
    const dialog = openEditor({ settings: { companyNavigationBookmarks: ['/company/customers'] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Customers to All the rest' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationAllTheRest).toEqual(['/company/customers']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book Marks', exact: true }));
    expect(within(dialog).queryByRole('checkbox', { name: 'Bookmark Customers' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Bookmark Repair Requests' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationBookmarks).toEqual(['/company/customers', '/company/repair-requests']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sidebar links', exact: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Customers back to sidebar' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationAllTheRest).toEqual([]));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book Marks', exact: true }));
    expect(within(dialog).getByRole('checkbox', { name: 'Bookmark Customers' })).toBeChecked();
});

test('shows only permitted feature-enabled links in every editor section', () => {
    const dialog = openEditor({ context: { hasCompanyPermission: () => false, isFeatureEnabled: () => false }, settings: { companyNavigationAllTheRest: ['/company/customers', '/company/messages', '/admin/dashboard'] } });
    expect(within(dialog).queryByRole('button', { name: /Move Customers/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Move Messages/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Move Setup Guide/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Move Dashboard to All the rest' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book Marks', exact: true }));
    expect(within(dialog).queryByRole('checkbox', { name: 'Bookmark Customers' })).not.toBeInTheDocument();
});

test('supports Escape dismissal and returns keyboard focus to the settings trigger', async () => {
    const dialog = openEditor();
    await waitFor(() => expect(dialog).toContainElement(document.activeElement));
    act(() => userEvent.tab());
    expect(dialog).toContainElement(document.activeElement);
    act(() => userEvent.keyboard('{Escape}'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Order' })).toHaveFocus());
});

test('reloads personal preferences on reopening', async () => {
    let dialog = openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Messages to All the rest' }));
    await waitFor(() => expect(lastProfile.settings.companyNavigationAllTheRest).toEqual(['/company/messages']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Order' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Move Messages back to sidebar' })).toBeInTheDocument();
});
