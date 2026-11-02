import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import JobTemplates from './JobTemplates';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {} }));
const mockPayrollData = {
  companyId: 'company', loading: false, error: '',
  companySettings: { laborMultiplier: 2.5 },
  settings: { routePaySource: 'serviceStopAndCompletedTasks', taskPaySource: 'technicianRate' },
  companyUsers: [{ userId: 'a', name: 'Alex' }, { userId: 'b', name: 'Blair' }],
  payTypes: [{ id: 'visit', name: 'Service visit', defaultRateType: 'flatPerStop' }, { id: 'extra', name: 'Extra cleaning', defaultRateType: 'flatPerTask' }],
  rates: [
    ...[5000, 6000].map((amountCents, i) => ({ id: `stop-${i}`, technicianId: i ? 'b' : 'a', payTypeId: 'visit', payBasis: 'serviceStop', rateType: 'flatPerStop', amountCents, status: 'Active' })),
    ...[1500, 2000].map((amountCents, i) => ({ id: `task-${i}`, technicianId: i ? 'b' : 'a', payTypeId: 'extra', payBasis: 'serviceStopTask', rateType: 'flatPerTask', amountCents, status: 'Active' })),
  ],
};
jest.mock('../../../hooks/useServicePayrollData', () => () => mockPayrollData);
jest.mock('../../../utils/productCatalog', () => ({ loadJobProductCatalog: async () => ({ products: [], vendorItems: [] }), getJobMaterialVendorItemId: () => '' }));
jest.mock('../../../utils/sales/salesFirestore', () => ({ salesCatalogCollection: () => 'catalog', saveSalesCatalogItem: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'), doc: (base, ...parts) => typeof base === 'string' ? [base, ...parts].join('/') : parts.join('/'),
  query: (value) => value, orderBy: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(),
}));
const templatePath = 'companies/company/jobTemplates/template-1';
const record = (id, data) => ({ id, exists: () => true, data: () => ({ id, ...data }) });
const originalResizeObserver = global.ResizeObserver;
let templateFragment;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });
beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockResolvedValue(record('company', { defaultAdminId: 'office-user' }));
  getDocs.mockImplementation(async (path) => {
    const docs = path === 'companies/company/jobTemplates' ? [record('template-1', {
      name: 'Cartridge filter service', description: 'Clean and inspect filter elements.', isActive: true, technicianCanAdd: true,
      defaultIssuePriorityLevel: 3, defaultRateCents: 0, defaultLaborCostCents: 0,
    })] : path === 'catalog' ? [record('catalog-service', {
      name: 'Catalog filter service', type: 'service', sourceType: 'serviceStopType', sourceId: 'visit', unitAmountCents: 15000, unitCostCents: 3500, defaultQuantity: 1,
      metadata: { taskTemplates: [{ id: 'included', name: 'Routine checklist', payrollMode: 'included', estimatedMinutes: 30, equipmentId: 'old-equipment', serviceLocationId: 'old-site' },
        { id: 'extra-task', name: 'Additional cleaning', payTypeId: 'extra', payrollMode: 'automatic', payrollStackBehavior: 'stackable', estimatedMinutes: 15 }] },
    })] : path.endsWith('/companyPayTypes') ? mockPayrollData.payTypes.map((type) => record(type.id, type))
      : path.endsWith('/companyUsers') ? [record('office', { userId: 'office-user', userName: 'Sample Office', status: 'Active' })]
      : path === `${templatePath}/tasks` ? [record('task-1', { name: 'Clean filter', type: 'Basic', description: 'Rinse and inspect each element.', estimatedTime: 45, contractedRate: 1000, payrollMode: 'included' })]
        : path === `${templatePath}/plannedServiceStops` ? [record('visit-1', { name: 'Filter service visit', estimatedMinutes: 60, taskTemplateIds: ['task-1'] })]
          : path === `${templatePath}/laborLineItems` ? [record('service-1', { name: 'Filter cleaning', quantity: 1, unitPriceCents: 15000, totalPriceCents: 15000, internalCostCents: 4000, taskTemplateIds: ['task-1'] })]
            : path === `${templatePath}/shoppingItems` ? [record('product-1', { name: 'O-ring', quantity: '1', plannedUnitPriceCents: 1200, plannedTotalPriceCents: 1200, plannedUnitCostCents: 300, plannedTotalCostCents: 300, billable: true })] : [];
    return { docs, size: docs.length };
  });
});

async function openTemplate() {
  const view = render(<MemoryRouter initialEntries={['/company/settings/job-templates/detail/template-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Context.Provider value={{ recentlySelectedCompany: 'company', user: { uid: 'creator' } }}>
      <Routes><Route path="/company/settings/job-templates/detail/:templateId" element={<JobTemplates />} /></Routes>
    </Context.Provider>
  </MemoryRouter>);
  templateFragment = view.asFragment;
  const summary = await screen.findByRole('region', { name: 'Summary' });
  await waitFor(() => expect(within(summary).getByText('$162.00')).toBeInTheDocument());
  return summary;
}

test('the template summary explains future-job context and keeps job-only actions unavailable', async () => {
  const summary = await openTemplate();
  expect(screen.getByText('Editing a Job Template')).toBeInTheDocument();
  expect(screen.getByText(/Existing jobs keep their saved scope/)).toBeInTheDocument();
  expect(within(summary).getAllByText('Chosen for each job')).toHaveLength(2);
  expect(within(summary).getByText('Sample Office')).toBeInTheDocument();
  expect(within(summary).getByText('$119.00')).toBeInTheDocument();
  const sections = screen.getByRole('navigation', { name: 'Template sections' });
  expect(within(sections).getAllByRole('button')).toHaveLength(5);
  ['Overview', 'Create Plans', 'Actual', 'Billing', 'History'].forEach((label, index) => expect(within(sections).getAllByRole('button')[index]).toHaveAccessibleName(new RegExp(`^${label}`)));
  expect(within(sections).getByRole('button', { name: /^Overview/ })).toHaveAttribute('aria-current', 'page');
  for (const name of [/^Actual/, /^Billing/, /^History/]) expect(within(sections).getByRole('button', { name })).toBeDisabled();
  expect(screen.queryByText('Template Snapshot')).not.toBeInTheDocument();
  expect(screen.queryByText('Scheduled Date')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create and Schedule Job' })).toHaveAttribute('href', '/company/jobs/basic-create?templateId=template-1');
  expect(getDocs.mock.calls.every(([path]) => !path.includes('/workOrders'))).toBe(true);
  // Optional local sample capture uses the actual mounted component, never live data.
  if (process.env.JOB_TEMPLATE_LAYOUT_PREVIEW) {
    require('fs').writeFileSync(process.env.JOB_TEMPLATE_LAYOUT_PREVIEW, new XMLSerializer().serializeToString(templateFragment()));
  }
});

test('the job-style Actions menu edits only the reusable template metadata', async () => {
  await openTemplate();
  fireEvent.click(screen.getByRole('button', { name: 'Actions', exact: true }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit Template' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit Job Template' });
  fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Revised filter service' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Template' }));
  await waitFor(() => expect(updateDoc).toHaveBeenCalledWith(templatePath, expect.objectContaining({ name: 'Revised filter service' })));
  expect(await screen.findByRole('heading', { name: 'Revised filter service', level: 1 })).toBeInTheDocument();
});

test('scope section navigation still edits tasks in the template collection', async () => {
  await openTemplate();
  const sections = screen.getByRole('navigation', { name: 'Template sections' });
  fireEvent.click(within(sections).getByRole('button', { name: /^Create Plans/ }));
  expect(within(sections).getByRole('button', { name: /^Create Plans/ })).toHaveAttribute('aria-current', 'page');
  const editor = within(screen.getByRole('region', { name: 'Template plan editor' }));
  ['Template service lines', 'Template products', 'Template planned stops', 'Template tasks'].forEach((name) => expect(editor.getByRole('region', { name })).toBeInTheDocument());
  const row = within(editor.getByRole('region', { name: 'Template tasks' })).getByRole('row', { name: /Clean filter/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Edit', exact: true }));
  expect(screen.getByRole('heading', { name: 'Edit Template Task' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Clean filter elements' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledWith(`${templatePath}/tasks/task-1`, expect.objectContaining({ name: 'Clean filter elements', templateId: 'template-1' }), { merge: true }));
  fireEvent.click(within(sections).getByRole('button', { name: /^Overview/ }));
  expect(await screen.findByRole('region', { name: 'Summary' })).toBeInTheDocument();
});

test('a new service line previews catalog service pay and task extras before saving, and only applies cost on click', async () => {
  await openTemplate();
  fireEvent.click(screen.getByRole('button', { name: 'Service Line', exact: true }));
  const form = screen.getByRole('form', { name: 'Add Template Service Line' });
  const fields = within(form);
  fireEvent.click(fields.getByRole('button', { name: 'Choose Service', exact: true }));
  fireEvent.click(await fields.findByRole('button', { name: /Catalog filter service.*Price/ }));
  expect(fields.getByLabelText('Technician pay type')).toHaveValue('visit');
  const preview = fields.getByRole('region', { name: 'Service technician pay preview' });
  expect(within(fields.getByRole('region', { name: 'Service internal cost' })).getByRole('region', { name: 'Service technician pay preview' })).toBe(preview);
  expect(within(fields.getByRole('region', { name: 'Service internal cost' })).getByLabelText('Internal cost')).toHaveValue(35);
  expect(within(preview).getByText('$65.00 – $80.00')).toBeInTheDocument();
  expect(fields.getByLabelText('Internal cost')).toHaveValue(35);
  fireEvent.change(fields.getByLabelText('Quantity'), { target: { value: '2' } });
  expect(within(preview).getByText('$130.00 – $160.00')).toBeInTheDocument();
  expect(fields.getByLabelText('Internal cost')).toHaveValue(35);
  fireEvent.click(within(preview).getByRole('button', { name: 'Use high estimate for internal cost' }));
  expect(fields.getByLabelText('Internal cost')).toHaveValue(160);
  // Applying again is idempotent and does not add the same labor twice.
  fireEvent.click(within(preview).getByRole('button', { name: 'Use high estimate for internal cost' }));
  expect(fields.getByLabelText('Internal cost')).toHaveValue(160);
  expect(fields.getByLabelText('Total price')).toHaveValue(300);
  fireEvent.click(fields.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledWith(expect.stringMatching(/\/laborLineItems\//), expect.objectContaining({
    internalCostCents: 16000, totalPriceCents: 30000, quantity: 2, payTypeId: 'visit', sourceId: 'visit',
  }), { merge: true }));
  const savedTasks = setDoc.mock.calls.filter(([path]) => path.includes('/tasks/')).map(([, payload]) => payload);
  expect(savedTasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Routine checklist', payTypeId: 'visit', payrollMode: 'included', payQuantity: 2, estimatedTime: 60 }),
    expect.objectContaining({ name: 'Additional cleaning', payTypeId: 'extra', payrollStackBehavior: 'stackable', payQuantity: 2 }),
  ]));
  savedTasks.forEach((task) => {
    expect(task.equipmentId).toBeUndefined();
    expect(task.serviceLocationId).toBeUndefined();
    expect(task.estimatedMinutes).toBeUndefined();
  });
});

test('editing a line preserves the chosen pay type and manual budget until the estimate is applied', async () => {
  await openTemplate();
  fireEvent.click(within(await screen.findByRole('row', { name: /Filter cleaning/ })).getByRole('button', { name: 'Edit', exact: true }));
  const form = screen.getByRole('form', { name: 'Edit Template Service Line' });
  const fields = within(form);
  fireEvent.change(fields.getByLabelText('Technician pay type'), { target: { value: 'visit' } });
  expect(fields.getByLabelText('Internal cost')).toHaveValue(40);
  fireEvent.click(fields.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledWith(`${templatePath}/laborLineItems/service-1`, expect.objectContaining({ payTypeId: 'visit', internalCostCents: 4000 }), { merge: true }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Template Service Line' })).not.toBeInTheDocument());
  fireEvent.click(within(screen.getByRole('row', { name: /Filter cleaning/ })).getByRole('button', { name: 'Edit', exact: true }));
  expect(screen.getByLabelText('Technician pay type')).toHaveValue('visit');
  expect(screen.getByLabelText('Internal cost')).toHaveValue(40);
});

test('the template inline service creator groups costs with previews and hides costs for included tasks', async () => {
  await openTemplate();
  fireEvent.click(screen.getByRole('button', { name: 'Service Line', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose Service', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'New Catalog Item', exact: true }));
  const creator = within(screen.getByRole('region', { name: 'Create catalog service' }));
  const serviceCost = creator.getByRole('region', { name: 'Service internal cost' });
  expect(within(serviceCost).getByLabelText('Internal Cost')).toHaveValue(0);
  expect(within(serviceCost).getByRole('region', { name: 'Service technician pay preview' })).toBeInTheDocument();
  fireEvent.click(creator.getByRole('button', { name: 'Add Task', exact: true }));
  expect(creator.getByLabelText('Task pay')).toHaveValue('none');
  expect(creator.queryByLabelText('Tech Labor Cost')).not.toBeInTheDocument();
  expect(creator.queryByRole('region', { name: 'Task technician pay preview' })).not.toBeInTheDocument();
  fireEvent.change(creator.getByLabelText('Task pay'), { target: { value: 'additional' } });
  fireEvent.change(creator.getByLabelText('Payroll pay item'), { target: { value: 'extra' } });
  const taskCost = creator.getByRole('group', { name: 'Task labor cost' });
  fireEvent.click(within(taskCost).getByRole('button', { name: 'Use high estimate for task cost' }));
  expect(within(taskCost).getByLabelText('Tech Labor Cost')).toHaveValue(20);
  expect(within(serviceCost).getByLabelText('Internal Cost')).toHaveValue(0);
  fireEvent.change(creator.getByLabelText('Task pay'), { target: { value: 'none' } });
  expect(creator.queryByLabelText('Tech Labor Cost')).not.toBeInTheDocument();
  expect(creator.queryByRole('region', { name: 'Task technician pay preview' })).not.toBeInTheDocument();
});

test('a template service line applies a suggested total price and keeps unit price consistent with quantity', async () => {
  await openTemplate();
  fireEvent.click(screen.getByRole('button', { name: 'Service Line', exact: true }));
  const fields = within(screen.getByRole('form', { name: 'Add Template Service Line' }));
  fireEvent.click(fields.getByRole('button', { name: 'Choose Service', exact: true }));
  fireEvent.click(await fields.findByRole('button', { name: /Catalog filter service.*Price/ }));
  fireEvent.change(fields.getByLabelText('Quantity'), { target: { value: '2' } });
  fireEvent.change(fields.getByLabelText('Internal cost'), { target: { value: '40' } });
  expect(fields.getByText('Suggested customer price: $100.00')).toBeInTheDocument();
  expect(fields.getByLabelText('Total price')).toHaveValue(300);
  fireEvent.click(fields.getByRole('button', { name: 'Use suggested customer price' }));
  expect(fields.getByLabelText('Total price')).toHaveValue(100);
  expect(fields.getByLabelText('Unit price')).toHaveValue(50);
  fireEvent.click(fields.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledWith(expect.stringMatching(/\/laborLineItems\//), expect.objectContaining({
    totalPriceCents: 10000, unitPriceCents: 5000, internalCostCents: 4000, quantity: 2,
  }), { merge: true }));
});
