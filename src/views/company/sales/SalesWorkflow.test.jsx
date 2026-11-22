import React, { Suspense } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import { sellerRoutes } from '../../../routes/routes/sellerRoutes';
import { SERVICE_AGREEMENTS_PERMISSION_ID } from '../../../utils/companyPermissions';

jest.mock('../../../utils/config', () => ({ db: {}, functions: {} }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'),
  query: (path) => path,
  where: jest.fn(),
  onSnapshot: (_, onChange) => {
    onChange({ docs: [] });
    return () => {};
  },
}));

const workflowTitles = ['Estimates', 'Service Agreements', 'Billing Subscriptions', 'Invoices', 'Payment History'];
const workflowPaths = [
  '/company/estimates', '/company/sales/agreements', '/company/sales/subscriptions',
  '/company/sales/invoices', '/company/sales/payments',
];
const testRoutes = sellerRoutes.filter(({ path }) => workflowPaths.includes(path) || path === '/company/sales');

const renderWorkflow = ({ path, permissions = ['400', '620', '622'], flags = ['feature_flag_004', 'feature_flag_007'] }) => render(
  <Context.Provider value={{
    recentlySelectedCompany: 'company',
    companyRoleLoaded: true,
    featureFlagsLoaded: true,
    hasCompanyPermission: (id) => permissions.includes(id),
    isFeatureEnabled: (id) => flags.includes(id),
  }}>
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={null}>
        <Routes>
          {testRoutes.map(({ path: routePath, element }) => <Route key={routePath} path={routePath} element={element} />)}
        </Routes>
      </Suspense>
    </MemoryRouter>
  </Context.Provider>
);

const workflow = () => within(screen.getByRole('navigation', { name: 'Sales workflow' }));

test('the five existing routes are linked in order with the current page selected', async () => {
  renderWorkflow({ path: '/company/estimates?status=draft' });
  await screen.findByRole('heading', { level: 1, name: 'Estimates' });
  expect(workflow().getAllByRole('link').map((link) => link.textContent)).toEqual(workflowTitles);
  expect(workflow().getByRole('link', { current: 'page' })).toHaveTextContent('Estimates');
  expect(screen.getByRole('combobox', { name: 'Estimate status' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'New Job Estimate' })).toHaveAttribute('href', '/company/jobs/createNew');

  for (const title of workflowTitles.slice(1)) {
    fireEvent.click(workflow().getByRole('link', { name: title }));
    await screen.findByRole('heading', { level: 1, name: title });
    expect(workflow().getByRole('link', { current: 'page' })).toHaveTextContent(title);
    if (title === 'Invoices') {
      fireEvent.change(screen.getByPlaceholderText('Search customer or source'), { target: { value: 'Example customer' } });
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'overdue' } });
    }
  }

  expect(screen.getByPlaceholderText('Search customer or source')).toHaveValue('');
  expect(screen.getByRole('combobox')).toHaveValue('all');
});

test('an agreement-only role sees its authorized enabled workflow links', async () => {
  renderWorkflow({ path: '/company/sales/agreements', permissions: [SERVICE_AGREEMENTS_PERMISSION_ID, '620'], flags: ['feature_flag_004'] });
  await screen.findByRole('heading', { level: 1, name: 'Service Agreements' });
  expect(workflow().getAllByRole('link').map((link) => link.textContent)).toEqual(['Service Agreements']);
});

test.each([
  [['feature_flag_004'], ['400', '420'], false],
  [['feature_flag_004', 'feature_flag_016'], ['400'], false],
  [['feature_flag_004', 'feature_flag_016'], ['400', '420'], true],
])('Sales Dashboard shows the PNL Viewer link only when authorized (%j, %j)', async (flags, permissions, allowed) => {
  renderWorkflow({ path: '/company/sales', flags, permissions });
  await screen.findByRole('heading', { level: 1, name: 'Sales Dashboard' });
  const link = screen.queryByRole('link', { name: 'PNL Viewer' });
  if (allowed) {
    expect(link).toHaveAttribute('href', '/company/sales/pnl-viewer');
  } else {
    expect(link).not.toBeInTheDocument();
  }
});
