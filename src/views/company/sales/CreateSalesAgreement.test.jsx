import React, { act } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { saveSalesCatalogItem, saveSalesModel } from '../../../utils/sales/salesFirestore';
import { getTerms, listenTermsTemplates, saveTermsTemplateWithTerms } from '../../../utils/terms/termsTemplateFirestore';
import CreateSalesAgreement from './CreateSalesAgreement';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
let mockCanEdit;
let mockCatalogItems;
jest.mock('../../../hooks/useCompanyPermissions', () => () => ({ can: () => mockCanEdit, requirePermission: () => mockCanEdit }));
jest.mock('../../../utils/config', () => ({ db: {}, functions: {} }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
jest.mock('../../../utils/recurringServiceStopTasks', () => ({ fetchRecurringTaskGroupOptions: async () => [], fetchTaskGroupTasks: async () => [] }));
jest.mock('../../../utils/sales/salesFirestore', () => ({
  salesCatalogCollection: (_, companyId) => `companies/${companyId}/salesCatalogItems`,
  saveSalesModel: jest.fn(),
  saveSalesCatalogItem: jest.fn(),
}));
jest.mock('../../../utils/terms/termsTemplateFirestore', () => ({
  listenTermsTemplates: jest.fn(),
  getTerms: jest.fn(),
  saveTermsTemplateWithTerms: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'),
  doc: (_, ...parts) => parts.join('/'),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  query: (path) => path,
  onSnapshot: jest.fn(),
  serverTimestamp: jest.fn(),
  updateDoc: jest.fn(),
}));

const customer = { id: 'customer', firstName: 'Amy', lastName: 'Adams', email: 'amy@example.com', active: true };
const location = { id: 'location', customerId: customer.id, nickName: 'Main Pool' };
const snapshot = (records = []) => ({
  docs: records.map(({ id, ...data }) => ({ id, data: () => data })),
});
const record = (data) => ({ exists: () => true, data: () => data });
const CurrentPath = () => <output data-testid="current-path">{useLocation().pathname}</output>;
const openPage = (search = '') => render(
  <MemoryRouter initialEntries={[`/company/sales/agreements/new${search}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Context.Provider value={{ recentlySelectedCompany: 'company', currentUser: { uid: 'user' } }}>
      <CreateSalesAgreement />
      <CurrentPath />
    </Context.Provider>
  </MemoryRouter>
);

const originalResizeObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });

beforeEach(() => {
  jest.clearAllMocks();
  mockCanEdit = true;
  mockCatalogItems = [];
  getDocs.mockResolvedValue(snapshot());
  getTerms.mockResolvedValue([]);
  listenTermsTemplates.mockImplementation((_, callback) => { callback([]); return () => {}; });
  saveTermsTemplateWithTerms.mockImplementation(async (_, template, terms) => ({ template, terms }));
  saveSalesCatalogItem.mockResolvedValue(undefined);
  getDoc.mockResolvedValue({ exists: () => false });
  onSnapshot.mockImplementation((path, callback) => {
    callback(snapshot(path.endsWith('/customers') ? [customer] : path.endsWith('/serviceLocations') ? [location] : path.endsWith('/salesCatalogItems') ? mockCatalogItems : []));
    return () => {};
  });
});

test('opens from the customer detail plus button without a lead and can save a draft', async () => {
  openPage('?customerId=customer');
  expect(await screen.findByDisplayValue('Amy Adams Service Agreement')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /^Customer Email/ })).toHaveValue('amy@example.com');
  expect(getDoc).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('checkbox', { name: /Main Pool/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Manual Item' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Agreement Draft' }));

  await waitFor(() => expect(saveSalesModel).toHaveBeenCalled());
  expect(saveSalesModel.mock.calls[0][2]).toEqual(expect.objectContaining({
    customerId: 'customer',
    email: 'amy@example.com',
    title: 'Amy Adams Service Agreement',
    serviceLocationIds: ['location'],
    sourceType: 'manual',
  }));
});

test('waits for the customer snapshot before applying customer details', async () => {
  let receiveCustomers;
  const defaultSnapshot = onSnapshot.getMockImplementation();
  onSnapshot.mockImplementation((path, callback) => {
    if (!path.endsWith('/customers')) return defaultSnapshot(path, callback);
    receiveCustomers = callback;
    return () => {};
  });
  // The route context can be ready before the customer snapshot arrives.
  openPage('?customerId=customer&serviceLocationId=location');
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');

  await act(async () => receiveCustomers(snapshot([customer])));

  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Amy Adams Service Agreement');
  expect(screen.getByRole('textbox', { name: /^Customer Email/ })).toHaveValue('amy@example.com');
  expect(screen.getByRole('checkbox', { name: /Main Pool/ })).toBeChecked();
});

test('opens from a service stop without a lead and keeps its customer, location, and recommendation', async () => {
  getDoc.mockResolvedValue(record({
    customerId: customer.id,
    serviceLocationId: location.id,
    recommendedServiceAgreementPriceCents: 15000,
    recommendedServiceAgreementRateType: 'oneTime',
  }));
  openPage('?serviceStopId=survey');

  expect(await screen.findByDisplayValue('Amy Adams Service Agreement')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Main Pool/ })).toBeChecked();
  expect(screen.getByRole('combobox', { name: 'Rate Type' })).toHaveValue('oneTime');
  expect(screen.getByDisplayValue('Recommended Service Plan')).toBeInTheDocument();
});

test.each([
  { companyCustomerId: customer.id, companyServiceLocationId: location.id },
  { customerId: customer.id, serviceLocationId: location.id },
])('preserves lead prefilling for supported customer and location fields: %j', async (links) => {
  getDoc.mockResolvedValue(record({ companyId: 'company', ...links, serviceName: 'Weekly Pool Care', homeownerEmail: 'lead@example.com' }));
  openPage('?leadId=lead');

  expect(await screen.findByDisplayValue('Weekly Pool Care Service Agreement')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /^Customer Email/ })).toHaveValue('lead@example.com');
  expect(screen.getByRole('checkbox', { name: /Main Pool/ })).toBeChecked();
});

test('a missing lead still allows the customer query to prefill the form', async () => {
  openPage('?leadId=missing&customerId=customer');

  expect(await screen.findByDisplayValue('Amy Adams Service Agreement')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /^Customer Email/ })).toHaveValue('amy@example.com');
});

test('opens a new agreement without source query parameters', () => {
  openPage();

  expect(screen.getByRole('heading', { name: 'New Service Agreement' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  expect(screen.getByText('Select a customer first.')).toBeInTheDocument();
});

const editDraft = async () => {
  openPage('?customerId=customer');
  await screen.findByDisplayValue('Amy Adams Service Agreement');
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'My unsaved agreement' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Main Pool/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Manual Item' }));
  fireEvent.change(screen.getByPlaceholderText('Item name'), { target: { value: 'Custom service' } });
};

const expectDraftRetained = () => {
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My unsaved agreement');
  expect(screen.getByRole('checkbox', { name: /Main Pool/ })).toBeChecked();
  expect(screen.getByDisplayValue('Custom service')).toBeInTheDocument();
  expect(screen.getByTestId('current-path')).toHaveTextContent('/company/sales/agreements/new');
  expect(saveSalesModel).not.toHaveBeenCalled();
};

test('creates a reusable template with defaults and terms, then applies it without leaving the draft', async () => {
  await editDraft();
  fireEvent.click(screen.getByRole('button', { name: 'Create Template', exact: true }));
  const editor = within(await screen.findByRole('dialog', { name: 'New Service Agreement Template' }));
  fireEvent.change(editor.getByLabelText('Template Name'), { target: { value: 'Weekly service' } });
  fireEvent.change(editor.getByLabelText('Template Content'), { target: { value: 'Reusable terms content' } });
  fireEvent.change(editor.getByLabelText('Default Billing Frequency'), { target: { value: 'weekly' } });
  fireEvent.click(editor.getByRole('button', { name: 'Add Template Term' }));
  fireEvent.change(editor.getByLabelText('Term 1'), { target: { value: 'Keep the gate accessible.' } });
  // A local listener update while saving must not apply incomplete defaults to the draft.
  await act(async () => listenTermsTemplates.mock.calls[0][1]([{ id: 'temporary', name: 'Local change', content: 'Not applied' }]));
  fireEvent.click(editor.getByRole('button', { name: 'Save & Use Template' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const saved = saveTermsTemplateWithTerms.mock.calls[0];
  expect(saved[0]).toBe('company');
  expect(saved[1]).toEqual(expect.objectContaining({ name: 'Weekly service', content: 'Reusable terms content', billingFrequency: 'weekly' }));
  expect(saved[2]).toEqual([expect.objectContaining({ description: 'Keep the gate accessible.' })]);
  expect(screen.getByRole('combobox', { name: 'Service Agreement Template' })).toHaveValue(saved[1].id);
  expect(screen.getByRole('combobox', { name: 'Billing Frequency' })).toHaveValue('weekly');
  expect(screen.getByLabelText('Template Default Content')).toHaveValue('Reusable terms content');
  expect(screen.getByLabelText('Agreement term 1')).toHaveValue('Keep the gate accessible.');
  expectDraftRetained();
});

test('saving current agreement terms as a template includes custom content and terms, while cancel preserves the draft', async () => {
  await editDraft();
  fireEvent.change(screen.getByLabelText('Template Default Content'), { target: { value: 'My custom content' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Line', exact: true }));
  fireEvent.change(screen.getByLabelText('Agreement term 1'), { target: { value: 'My custom term' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Terms as Template' }));
  const editor = within(await screen.findByRole('dialog'));
  expect(editor.getByLabelText('Template Content')).toHaveValue('My custom content');
  expect(editor.getByLabelText('Term 1')).toHaveValue('My custom term');
  expect(editor.getByLabelText('Default Billing Frequency')).toHaveValue('monthly');
  fireEvent.change(editor.getByLabelText('Term 1'), { target: { value: 'Canceled change' } });
  fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Agreement term 1')).toHaveValue('My custom term');
  expect(screen.getByLabelText('Template Default Content')).toHaveValue('My custom content');
  expect(saveTermsTemplateWithTerms).not.toHaveBeenCalled();
  expectDraftRetained();
});

test('edits the selected shared template and its saved terms from the agreement', async () => {
  const template = { id: 'template', name: 'Existing template', content: 'Existing content' };
  const clause = { id: 'clause', description: 'Existing term' };
  listenTermsTemplates.mockImplementation((_, callback) => { callback([template]); return () => {}; });
  getTerms.mockResolvedValue([clause]);
  await editDraft();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Template Terms' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Edit Template Terms' }));
  const editor = within(await screen.findByRole('dialog', { name: 'Edit Service Agreement Template' }));
  await waitFor(() => expect(editor.getByLabelText('Term 1')).toHaveValue('Existing term'));
  fireEvent.change(editor.getByLabelText('Template Name'), { target: { value: 'Updated template' } });
  fireEvent.change(editor.getByLabelText('Term 1'), { target: { value: 'Updated reusable term' } });
  fireEvent.click(editor.getByRole('button', { name: 'Save & Use Template' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(saveTermsTemplateWithTerms.mock.calls[0][1]).toEqual(expect.objectContaining({ id: 'template', name: 'Updated template' }));
  expect(saveTermsTemplateWithTerms.mock.calls[0][3]).toEqual([clause]);
  expect(screen.getByLabelText('Agreement term 1')).toHaveValue('Updated reusable term');
  expectDraftRetained();
});

test('a failed template save retains editor changes for retry and never submits the agreement', async () => {
  saveTermsTemplateWithTerms.mockRejectedValueOnce(new Error('Unavailable'));
  await editDraft();
  fireEvent.click(screen.getByRole('button', { name: 'Create Template', exact: true }));
  const editor = within(await screen.findByRole('dialog'));
  fireEvent.change(editor.getByLabelText('Template Name'), { target: { value: 'Retry template' } });
  fireEvent.click(editor.getByRole('button', { name: 'Save & Use Template' }));
  expect(await editor.findByRole('alert')).toHaveTextContent('Could not save the template');
  expect(editor.getByLabelText('Template Name')).toHaveValue('Retry template');
  fireEvent.click(editor.getByRole('button', { name: 'Save & Use Template' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(saveTermsTemplateWithTerms).toHaveBeenCalledTimes(2);
  expect(saveTermsTemplateWithTerms.mock.calls[1][1].id).toBe(saveTermsTemplateWithTerms.mock.calls[0][1].id);
  expectDraftRetained();
});

test('an unsuccessful terms load blocks saving and can be retried without replacing existing clauses', async () => {
  const template = { id: 'template', name: 'Existing template', content: 'Existing content' };
  const clause = { id: 'clause', description: 'Keep this clause' };
  listenTermsTemplates.mockImplementation((_, callback) => { callback([template]); return () => {}; });
  getTerms.mockResolvedValue([clause]);
  await editDraft();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Template' })).toBeEnabled());
  getTerms.mockRejectedValueOnce(new Error('Unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Template' }));
  const editor = within(await screen.findByRole('dialog'));
  expect(await editor.findByRole('alert')).toHaveTextContent('Could not load the template terms');
  expect(editor.getByRole('button', { name: 'Save & Use Template' })).toBeDisabled();
  expect(saveTermsTemplateWithTerms).not.toHaveBeenCalled();
  fireEvent.click(editor.getByRole('button', { name: 'Retry loading terms' }));
  expect(await editor.findByLabelText('Term 1')).toHaveValue('Keep this clause');
  expect(editor.getByRole('button', { name: 'Save & Use Template' })).toBeEnabled();
  fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Agreement term 1')).toHaveValue('Keep this clause');
  expectDraftRetained();
});

test('creates and selects a catalog item in place, ready to add without losing existing agreement rows', async () => {
  await editDraft();
  fireEvent.click(screen.getByRole('button', { name: 'Create Catalog Item' }));
  const editor = within(screen.getByRole('form', { name: 'Create Service' }));
  fireEvent.change(editor.getByLabelText('Name', { exact: true }), { target: { value: 'New catalog service' } });
  fireEvent.change(editor.getByLabelText('Customer Price'), { target: { value: '175' } });
  fireEvent.click(editor.getByRole('button', { name: 'Create Service', exact: true }));

  await waitFor(() => expect(screen.queryByRole('form', { name: 'Create Service' })).not.toBeInTheDocument());
  const item = saveSalesCatalogItem.mock.calls[0][2];
  expect(item).toEqual(expect.objectContaining({ name: 'New catalog service', unitAmountCents: 17500 }));
  expect(screen.getByRole('combobox', { name: 'Select sales catalog item' })).toHaveValue(item.id);
  fireEvent.click(screen.getByRole('button', { name: 'Add Selected' }));
  expect(screen.getByDisplayValue('New catalog service')).toBeInTheDocument();
  expect(screen.getByLabelText('Unit amount for New catalog service')).toHaveValue(175);
  expectDraftRetained();
});

test('edits a selected catalog item without navigating and preserves catalog metadata', async () => {
  mockCatalogItems = [{ id: 'existing-service', name: 'Existing service', unitAmountCents: 10000, metadata: { retained: 'custom setting' } }];
  await editDraft();
  fireEvent.click(screen.getByRole('button', { name: 'Add Catalog Item' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Selected Catalog Item' }));
  const editor = within(screen.getByRole('form', { name: 'Edit Service' }));
  fireEvent.change(editor.getByLabelText('Customer Price'), { target: { value: '200' } });
  fireEvent.click(editor.getByRole('button', { name: 'Save Service' }));

  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Service' })).not.toBeInTheDocument());
  expect(saveSalesCatalogItem.mock.calls[0][2]).toEqual(expect.objectContaining({ id: 'existing-service', unitAmountCents: 20000, metadata: expect.objectContaining({ retained: 'custom setting' }) }));
  expect(screen.getByRole('option', { name: /Existing service - \$200.00/ })).toBeInTheDocument();
  expectDraftRetained();
});

test('canceling the catalog editor leaves all draft values unchanged', async () => {
  await editDraft();
  fireEvent.click(screen.getByRole('button', { name: 'Create Catalog Item' }));
  const editor = within(screen.getByRole('form', { name: 'Create Service' }));
  fireEvent.change(editor.getByLabelText('Name', { exact: true }), { target: { value: 'Canceled catalog service' } });
  fireEvent.click(editor.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.queryByRole('form', { name: 'Create Service' })).not.toBeInTheDocument();
  expect(saveSalesCatalogItem).not.toHaveBeenCalled();
  expectDraftRetained();
});

test('a failed catalog save keeps the editor open for retry without submitting the agreement', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    saveSalesCatalogItem.mockRejectedValueOnce(new Error('Unavailable'));
    await editDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Create Catalog Item' }));
    const form = screen.getByRole('form', { name: 'Create Service' });
    const editor = within(form);
    fireEvent.change(editor.getByLabelText('Name', { exact: true }), { target: { value: 'Retry service' } });
    fireEvent.click(editor.getByRole('button', { name: 'Create Service', exact: true }));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Unable to save service catalog item', expect.any(Error)));
    expect(editor.getByLabelText('Name', { exact: true })).toHaveValue('Retry service');
    fireEvent.click(editor.getByRole('button', { name: 'Create Service', exact: true }));
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(saveSalesCatalogItem).toHaveBeenCalledTimes(2);
    expectDraftRetained();
  } finally { consoleError.mockRestore(); }
});

test('inline creation and editing respect the existing company permissions', async () => {
  mockCanEdit = false;
  await editDraft();
  expect(screen.queryByRole('button', { name: 'Create Template', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit Template', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save Terms as Template' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create Catalog Item' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add Catalog Item' }));
  expect(screen.queryByRole('button', { name: 'Edit Selected Catalog Item' })).not.toBeInTheDocument();
});
