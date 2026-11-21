import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getDoc, getDocs, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import DataBaseItemDetailView from "./DataBaseItemDetailView";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {}, storage: {} }));
jest.mock("react-hot-toast", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../productCatalog/CatalogConnections", () => () => <h2>Connected Product</h2>);
jest.mock("../productCatalog/CatalogPurchaseHistory", () => () => <h2>Purchases and Receipts</h2>);
jest.mock("firebase/firestore", () => ({ getDoc: jest.fn(), getDocs: jest.fn(), writeBatch: jest.fn(), collection: (_, ...parts) => parts.join('/'), doc: (_, ...parts) => parts.join('/') }));
let batch;
beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ id: 'vendor', name: 'Supplier seal', category: 'Parts', UOM: 'Unit', rate: 0, sellPrice: 0, sku: 'SEAL', description: 'Replacement seal', storeName: 'Supply West' }) });
  getDocs.mockResolvedValue({ docs: [] });
  batch = { update: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) }; writeBatch.mockReturnValue(batch);
});
const open = (allowed = true) => render(<Context.Provider value={{ recentlySelectedCompany: 'company', companyRoleLoaded: true, companyRoleLoading: false, hasCompanyPermission: () => allowed }}><MemoryRouter initialEntries={['/company/items/detail/vendor']}><Routes><Route path='/company/items/detail/:id' element={<DataBaseItemDetailView />} /></Routes></MemoryRouter></Context.Provider>);

test("vendor detail opens the shared merge dialog with the current vendor item selected", async () => {
  getDocs.mockImplementation(async path => ({ docs: path.includes('dataBase') ? [
    { id: 'vendor', data: () => ({ name: 'Supplier seal' }) },
    { id: 'other', data: () => ({ name: 'Seal duplicate' }) },
  ] : [] }));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Merge duplicate' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Merge vendor items' }));
  await waitFor(() => expect(dialog.getByRole('combobox', { name: 'Record to keep' })).toHaveValue('vendor'));
  expect(within(dialog.getByRole('combobox', { name: 'Duplicate to archive' })).getByRole('option', { name: /Seal duplicate/ })).toHaveValue('other');
});

test("the vendor sheet preserves edit/save behavior and zero cost and price values", async () => {
  open(); await screen.findByRole('heading', { name: 'Supplier seal', level: 1 });
  expect(screen.getByRole('heading', { name: 'Vendor Item Sheet' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Catalog Summary' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  fireEvent.change(screen.getByPlaceholderText('Vendor Item Name'), { target: { value: 'Updated seal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(batch.update).toHaveBeenCalledWith('companies/company/settings/dataBase/dataBase/vendor', expect.objectContaining({ name: 'Updated seal', rate: 0, sellPrice: 0, billingRate: 0 }));
  expect(await screen.findByRole('heading', { name: 'Updated seal', level: 1 })).toBeInTheDocument();
});

test("view-only users retain information and connections without editing actions", async () => {
  open(false); await screen.findByRole('heading', { name: 'Supplier seal', level: 1 });
  expect(screen.getByRole('heading', { name: 'Connected Product' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
});
