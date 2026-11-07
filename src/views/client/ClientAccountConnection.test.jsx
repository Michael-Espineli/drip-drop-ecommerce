import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../context/AuthContext';
import { sendClientEmailVerification } from '../../utils/accountEmails';
import HomeOwnerSignUp from '../auth/HomeOwnerSignUp';
import HomeOwnerSignIn from '../auth/HomeOwnerSignIn';
import ClientEmailVerification from '../auth/ClientEmailVerification';
import ClientAccountInviteLanding from './ClientAccountInviteLanding';
import ClientCompanyInvites from './ClientCompanyInvites';

jest.mock('../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../utils/config', () => ({ functions: {}, auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
jest.mock('../../utils/accountEmails', () => ({ sendClientEmailVerification: jest.fn(), requestAccountEmail: jest.fn() }));
jest.mock('firebase/auth', () => {
  const auth = { currentUser: null };
  return { getAuth: () => auth, createUserWithEmailAndPassword: jest.fn(), signInWithEmailAndPassword: jest.fn(), signOut: jest.fn() };
});
jest.mock('firebase/firestore', () => ({ getFirestore: () => ({}), doc: (_, ...parts) => parts.join('/'), getDoc: jest.fn(), setDoc: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));

const invitePath = '/client/customer-account-invite/invite-one';
const homeowner = { uid: 'homeowner', email: 'alex@example.test', emailVerified: false };
const preview = { status: 200, invite: { id: 'invite-one', accepted: false }, company: { name: 'Pool Company' }, customer: { name: 'Alex', email: homeowner.email, maskedEmail: 'al***@example.test', linkedCustomerIds: [], hasEmail: true } };
let setAccount, refreshAccount, claim, listInvites;
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function mount(initialPath, initialAccount = {}) {
  function Provider() {
    const [account, update] = React.useState(initialAccount);
    setAccount = update;
    return <Context.Provider value={{ ...account, refreshAccount }}><Routes>
      <Route path="/client/customer-account-invite/:inviteId" element={<ClientAccountInviteLanding />} />
      <Route path="/homeownerSignUp" element={<HomeOwnerSignUp />} />
      <Route path="/homeownerSignIn" element={<HomeOwnerSignIn />} />
      <Route path="/client/verify-email" element={<ClientEmailVerification />} />
      <Route path="/client/dashboard" element={<><h1>Homeowner dashboard</h1><ClientCompanyInvites user={account.user} /></>} />
    </Routes><Location /></Context.Provider>;
  }
  return render(<MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Provider /></MemoryRouter>);
}
beforeEach(() => {
  jest.clearAllMocks(); getAuth().currentUser = null;
  refreshAccount = jest.fn().mockResolvedValue(false);
  claim = jest.fn().mockResolvedValue({ data: { status: 200, relationshipId: 'linked' } });
  listInvites = jest.fn().mockResolvedValue({ data: { invitations: [] } });
  httpsCallable.mockImplementation((_, name) => name === 'getCustomerAccountInvitePreview' ? async () => ({ data: preview }) : name === 'acceptLinkedInvite' ? claim : listInvites);
  sendClientEmailVerification.mockResolvedValue();
  getDoc.mockResolvedValue({ exists: () => false });
  createUserWithEmailAndPassword.mockImplementation(async () => {
    getAuth().currentUser = { ...homeowner };
    setAccount({ user: getAuth().currentUser, accountType: null });
    return { user: getAuth().currentUser };
  });
  setDoc.mockImplementation(async () => setAccount({ user: getAuth().currentUser, accountType: 'Client', dataBaseUser: { accountType: 'Client' } }));
});

test('email invitation survives new signup and verification, then explicitly connects the original customer', async () => {
  mount(invitePath);
  fireEvent.click(await screen.findByRole('link', { name: 'Create homeowner account' }));
  expect(screen.getByLabelText('Email address')).toHaveValue(homeowner.email);
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alex' } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Homeowner' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'emulator-only-password' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'emulator-only-password' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign Up' }).closest('form'));
  await screen.findByRole('heading', { name: 'Verify your email' });
  expect(sendClientEmailVerification).toHaveBeenCalledWith(getAuth(), `/client/verify-email?redirect=${encodeURIComponent(invitePath)}`);
  expect(claim).not.toHaveBeenCalled();
  refreshAccount.mockResolvedValue(true);
  await act(async () => { getAuth().currentUser.emailVerified = true; });
  fireEvent.click(screen.getByRole('button', { name: 'I verified my email' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Connect my homeowner account' }));
  await screen.findByRole('heading', { name: 'Homeowner dashboard' });
  expect(claim).toHaveBeenCalledTimes(1);
  expect(claim).toHaveBeenCalledWith(expect.objectContaining({ inviteId: 'invite-one', homeownerId: 'homeowner', idToken: 'test-token' }));
});

test('verification completed in another tab resumes the invitation when this window gets focus', async () => {
  mount(`/client/verify-email?redirect=${encodeURIComponent(invitePath)}`, { user: { ...homeowner }, accountType: 'Client' });
  await waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(1));
  refreshAccount.mockResolvedValue(true);
  fireEvent(window, new Event('focus'));
  await screen.findByRole('button', { name: 'Verify email to connect' });
  expect(screen.getByTestId('location')).toHaveTextContent(invitePath);
});

test('an existing signed-in homeowner is sent to verification with the exact invitation preserved', async () => {
  mount(invitePath, { user: { ...homeowner }, accountType: 'Client' });
  fireEvent.click(await screen.findByRole('button', { name: 'Verify email to connect' }));
  await screen.findByRole('heading', { name: 'Verify your email' });
  expect(screen.getByTestId('location')).toHaveTextContent(encodeURIComponent(invitePath));
  expect(claim).not.toHaveBeenCalled();
});

test('a homeowner who signed up separately can recover the invitation from the dashboard', async () => {
  listInvites.mockResolvedValue({ data: { invitations: [{ inviteId: 'invite-one', companyName: 'Pool Company', customerName: 'Alex' }] } });
  mount('/client/dashboard', { user: { ...homeowner, emailVerified: true }, accountType: 'Client' });
  fireEvent.click(await screen.findByRole('link', { name: 'Review & connect' }));
  await screen.findByRole('button', { name: 'Connect my homeowner account' });
  expect(screen.getByTestId('location')).toHaveTextContent(invitePath);
});

test('wrong-email and company accounts see a recovery action rather than being allowed to connect', async () => {
  mount(invitePath, { user: { ...homeowner, email: 'other@example.test', emailVerified: true }, accountType: 'Client' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Use the email this invitation was sent to');
  expect(screen.getByRole('button', { name: 'Connect my homeowner account' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Use a different account' })).toBeInTheDocument();
  await act(async () => setAccount({ user: { ...homeowner, emailVerified: true }, accountType: 'Company' }));
  expect(screen.getByRole('alert')).toHaveTextContent('company account');
  expect(claim).not.toHaveBeenCalled();
});

test('invitation lookup failures have a working retry and unverified users do not query invitations', async () => {
  listInvites.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ data: { invitations: [{ inviteId: 'invite-one', companyName: 'Pool Company', customerName: 'Alex' }] } });
  mount('/client/dashboard', { user: { ...homeowner }, accountType: 'Client' });
  expect(listInvites).not.toHaveBeenCalled();
  await act(async () => setAccount({ user: { ...homeowner, emailVerified: true }, accountType: 'Client' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Check invitations again' }));
  await screen.findByRole('link', { name: 'Review & connect' });
});
