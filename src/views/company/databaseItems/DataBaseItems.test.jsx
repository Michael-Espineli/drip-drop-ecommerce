import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import DataBaseItems from "./DataBaseItems";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({ getDocs: jest.fn(), collection: (_, ...parts) => parts.join("/"), doc: jest.fn() }));
const vendor = { id: 'vendor', name: 'Supplier seal', category: 'Parts', subCategory: 'Seal', UOM: 'Unit', sku: 'SEAL', rate: 0, cost: 999, sellPrice: 1000, productId: 'product', billable: true, storeName: 'Supply West' };
let vendors;
beforeEach(() => {
  jest.clearAllMocks(); vendors = [vendor, { ...vendor, id: 'other', name: 'Other fitting', productId: '', category: 'PVC', billable: false, rate: 1200 }];
  getDocs.mockImplementation(async (path) => ({ docs: (path.includes('genericItems') ? [{ id: 'product', name: 'Pool seal', sellPrice: 4500 }] : vendors).map((data) => ({ id: data.id, data: () => data })) }));
});
const open = (pathname = '/company/items', allowed = true) => render(<Context.Provider value={{ recentlySelectedCompany: 'company', companyRoleLoaded: true, companyRoleLoading: false, hasCompanyPermission: () => allowed }}><MemoryRouter initialEntries={[pathname]}><DataBaseItems /></MemoryRouter></Context.Provider>);

test("vendor list keeps supplier cost separate from the connected product selling price and links both records", async () => {
  open();
  const row = (await screen.findByRole('link', { name: 'Supplier seal' })).closest('tr');
  expect(within(row).getByText('$0.00')).toBeInTheDocument();
  expect(within(row).getByText('$45.00')).toBeInTheDocument();
  expect(within(row).getByRole('link', { name: 'Pool seal' })).toHaveAttribute('href', '/company/product-catalog/product');
  expect(within(row).getByRole('link', { name: 'View' })).toHaveAttribute('href', '/company/items/detail/vendor');
});

test("category and non-billable filters retain their existing behavior", async () => {
  open(); await screen.findByRole('link', { name: 'Supplier seal' });
  fireEvent.change(screen.getByLabelText('Filter by billable status'), { target: { value: 'nonBillable' } });
  expect(screen.queryByRole('link', { name: 'Supplier seal' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Other fitting' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'Parts' } });
  expect(screen.getByRole('link', { name: 'Supplier seal' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Other fitting' })).not.toBeInTheDocument();
});

test("settings routes and read-only creation permissions are preserved", async () => {
  open('/company/settings/vendor-items', false);
  expect(await screen.findByRole('link', { name: 'Supplier seal' })).toHaveAttribute('href', '/company/settings/vendor-items/detail/vendor');
  expect(screen.queryByRole('link', { name: 'Add new' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add new' })).not.toBeInTheDocument();
});

test("load failures are visible and can be retried", async () => {
  getDocs.mockRejectedValueOnce(new Error('Offline'));
  open(); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry vendor items' }));
  expect(await screen.findByRole('link', { name: 'Supplier seal' })).toBeInTheDocument();
});
