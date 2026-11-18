import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { getDocs, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import DataBaseItems from "./DataBaseItems";
import CreateNewDataBaseItem from "./CreateNewDataBaseItem";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {}, storage: {} }));
jest.mock("react-hot-toast", () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock("../../../utils/vendors", () => ({ fetchCompanyVendors: async () => [{ id: 'supplier', name: 'Supply West', label: 'Supply West' }] }));
jest.mock("firebase/firestore", () => ({
  getDocs: jest.fn(), writeBatch: jest.fn(), collection: (_, ...parts) => parts.join('/'), doc: (_, ...parts) => parts.join('/'), query: (path) => path, orderBy: jest.fn(), arrayUnion: (...values) => values,
}));
jest.mock("react-select", () => ({ inputId, value, options = [], onChange, isDisabled }) => <select id={inputId} disabled={isDisabled} value={value?.id || value?.value || value?.label || ''} onChange={(event) => onChange(options.find((option) => String(option.id || option.value || option.label) === event.target.value) || null)}>
  <option value="">Choose</option>{options.map((option) => <option key={option.id || option.value || option.label} value={option.id || option.value || option.label}>{option.label}</option>)}
</select>);

let vendors, products, writes, commit;
beforeEach(() => {
  jest.clearAllMocks();
  vendors = [];
  products = [{ id: 'product', commonName: 'Existing seal', sellPrice: 4500 }];
  writes = [];
  getDocs.mockImplementation(async (path) => ({ docs: (path.includes('genericItems') ? products : path.includes('dataBase') ? vendors : []).map((data) => ({ id: data.id, data: () => data })) }));
  commit = jest.fn(async () => {
    for (const write of writes) {
      if (write.type !== 'set') continue;
      if (write.path.includes('dataBase')) vendors.push(write.data);
      else if (write.path.includes('genericItems')) products.push(write.data);
    }
  });
  writeBatch.mockImplementation(() => ({ set: (path, data) => writes.push({ type: 'set', path, data }), update: (path, data) => writes.push({ type: 'update', path, data }), commit }));
});
const context = (company = 'company', allowed = true) => ({ recentlySelectedCompany: company, companyRoleLoaded: true, companyRoleLoading: false, hasCompanyPermission: () => allowed });
const Location = () => <span data-testid="pathname">{useLocation().pathname}</span>;
const open = (standalone = false) => render(<Context.Provider value={context()}><MemoryRouter initialEntries={[standalone ? '/company/items/createNew' : '/company/items']}><Location />{standalone ? <CreateNewDataBaseItem /> : <DataBaseItems />}</MemoryRouter></Context.Provider>);
const start = async () => {
  const trigger = screen.getByRole('button', { name: 'Add new' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByLabelText('Vendor')).toHaveValue('supplier'));
  return dialog;
};

test('Add new opens a compact draft on the list; cancel resets it and restores focus; Product Catalog links directly', async () => {
  open(); const dialog = await start();
  fireEvent.change(within(dialog).getByLabelText('Vendor Item Name'), { target: { value: 'Draft seal' } });
  expect(screen.getByTestId('pathname')).toHaveTextContent('/company/items');
  expect(screen.getByRole('link', { name: 'Product Catalog', exact: true })).toHaveAttribute('href', '/company/product-catalog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add new' })).toHaveFocus();
  expect(writeBatch).not.toHaveBeenCalled();
  await start(); expect(screen.getByLabelText('Vendor Item Name')).toHaveValue('');
});

test('creating saves supplier cost and new product selling price together and refreshes the list without navigation', async () => {
  open(); const dialog = await start();
  fireEvent.change(within(dialog).getByLabelText('Vendor Item Name'), { target: { value: 'Pump seal' } });
  expect(within(dialog).getByLabelText('Product Name')).toHaveValue('Pump seal');
  fireEvent.change(within(dialog).getByLabelText('Rate'), { target: { value: '12.50' } });
  fireEvent.change(within(dialog).getByLabelText('Product Sell Price'), { target: { value: '35.00' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Part Purchase', exact: true }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create Vendor Item', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(commit).toHaveBeenCalledTimes(1);
  const vendorWrite = writes.find((write) => write.path.includes('dataBase'));
  const productWrite = writes.find((write) => write.path.includes('genericItems'));
  expect(vendorWrite).toMatchObject({ type: 'set', data: { name: 'Pump seal', rate: 1250, storeName: 'Supply West', vendorId: 'supplier', productId: productWrite.data.id } });
  expect(productWrite.data).toMatchObject({
    name: 'Pump seal', sellPrice: 3500, vendorItemIds: [vendorWrite.data.id],
    availableForPartPurchase: false, partPurchaseAvailable: false,
  });
  expect(vendorWrite.data.availableForPartPurchase).toBe(true);
  expect(await screen.findAllByRole('link', { name: 'Pump seal', exact: true })).toHaveLength(2);
  expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/company\/items$/);
});

test('connect existing keeps the product price and permits zero supplier cost', async () => {
  open(); const dialog = await start();
  fireEvent.change(within(dialog).getByLabelText('Vendor Item Name'), { target: { value: 'Free seal' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Connect Product' }));
  expect(within(dialog).queryByRole('group', { name: 'Availability' })).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Existing Product'), { target: { value: 'product' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create Vendor Item', exact: true }));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(writes.find((write) => write.path.includes('dataBase')).data).toMatchObject({ rate: 0, productId: 'product' });
  expect(writes.find((write) => write.path.includes('genericItems'))).toMatchObject({ type: 'update' });
  expect(writes.find((write) => write.path.includes('genericItems')).data).not.toHaveProperty('sellPrice');
});

test('a failed save retains draft values for retry and prevents duplicate submission while saving', async () => {
  let rejectSave; commit.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
  open(); const dialog = await start();
  fireEvent.change(within(dialog).getByLabelText('Vendor Item Name'), { target: { value: 'Retry seal' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Skip', exact: true }));
  fireEvent.submit(dialog.querySelector('form')); fireEvent.submit(dialog.querySelector('form'));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  rejectSave(new Error('Offline'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not create this vendor item. Please try again.');
  expect(screen.getByLabelText('Vendor Item Name')).toHaveValue('Retry seal');
  expect(screen.getByRole('button', { name: 'Create Vendor Item', exact: true })).toBeEnabled();
  expect(writes.every((write) => write.path.startsWith('companies/company/'))).toBe(true);
  expect(writes.filter((write) => write.path.includes('genericItems'))).toHaveLength(0);
});

test('company changes close the draft without writing it into the newly selected company', async () => {
  const view = (company) => <Context.Provider value={context(company)}><MemoryRouter><DataBaseItems /></MemoryRouter></Context.Provider>;
  const rendered = render(view('first')); await start();
  fireEvent.change(screen.getByLabelText('Vendor Item Name'), { target: { value: 'First company draft' } });
  rendered.rerender(view('second'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(commit).not.toHaveBeenCalled();
  await start(); expect(screen.getByLabelText('Vendor Item Name')).toHaveValue('');
});

test.each([
  ['product', 'Choose an existing product or switch to creating a new product.'],
  ['equipment', 'Connect this equipment item to universal equipment or enter custom type, make, and model.'],
])('missing %s selections show a specific correction and create no records', async (kind, message) => {
  open(); const dialog = await start();
  fireEvent.change(within(dialog).getByLabelText('Vendor Item Name'), { target: { value: 'Incomplete item' } });
  if (kind === 'product') fireEvent.click(within(dialog).getByRole('button', { name: 'Connect Product' }));
  else fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: '5' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create Vendor Item', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(writeBatch).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('button', { name: 'Create Vendor Item', exact: true })).toBeEnabled();
});

test('the direct create page retains its details navigation after saving', async () => {
  open(true);
  fireEvent.change(screen.getByLabelText('Vendor Item Name'), { target: { value: 'Page seal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Skip', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Vendor Item', exact: true }));
  await waitFor(() => expect(screen.getByTestId('pathname').textContent).toMatch(/^\/company\/items\/detail\/com_sett_db_/));
});
