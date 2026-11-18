import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getDocs, setDoc, writeBatch } from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import ProductCatalog from "./ProductCatalog";
import ProductCatalogImport from "./ProductCatalogImport";
import { productAvailabilityPatch, updateProductAvailability } from "../../../utils/productAvailability";
import { deleteCatalogProduct, saveVendorProductConnection } from "../../../utils/productVendorConnections";
import { appConfirm } from "../../../utils/appDialog";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../utils/productAvailability", () => ({ ...jest.requireActual("../../../utils/productAvailability"), updateProductAvailability: jest.fn() }));
jest.mock("../../../utils/productVendorConnections", () => ({ deleteCatalogProduct: jest.fn(), saveVendorProductConnection: jest.fn() }));
jest.mock("../../../utils/appDialog", () => ({ appAlert: jest.fn(), appConfirm: jest.fn() }));
jest.mock("react-hot-toast", () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock("firebase/firestore", () => ({ getDocs: jest.fn(), setDoc: jest.fn(), writeBatch: jest.fn(), runTransaction: jest.fn(), orderBy: jest.fn(), query: (path) => path, collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/") }));
const record = (data) => ({ id: data.id, data: () => data });
const product = { id: "product", name: "Pool seal", commonName: "Pool seal", sellPrice: 4500, defaultCostCents: 1750, billable: true, preferredVendorItemId: "vendor" };
const vendor = { id: "vendor", name: "Supplier seal", storeName: "Pool supply", rate: 2300, productId: "product" };
let vendors, catalogProducts;
beforeEach(() => {
  jest.clearAllMocks(); vendors = [vendor]; catalogProducts = [product];
  updateProductAvailability.mockImplementation(async ({ productIds, changes }) => {
    const patch = productAvailabilityPatch(changes);
    catalogProducts = catalogProducts.map((item) => productIds.includes(item.id) ? { ...item, ...patch, updatedAt: new Date(), dateUpdated: new Date() } : item);
    return patch;
  });
  getDocs.mockImplementation(async (path) => ({ docs: (path.includes("genericItems") ? catalogProducts : vendors).map(record) }));
  setDoc.mockResolvedValue(undefined);
  appConfirm.mockResolvedValue(true);
  deleteCatalogProduct.mockImplementation(async ({ productId }) => {
    catalogProducts = catalogProducts.filter((item) => item.id !== productId);
  });
});
const open = (path = "/company/product-catalog", permission = true) => render(
  <Context.Provider value={{ recentlySelectedCompany: "company", companyRoleLoaded: true, companyRoleLoading: false, hasCompanyPermission: typeof permission === "function" ? permission : () => permission }}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/company/product-catalog/:productId?" element={<ProductCatalog />} />
        <Route path="/company/settings/product-catalog/:productId?" element={<ProductCatalog />} />
      </Routes>
    </MemoryRouter>
  </Context.Provider>
);

test("catalog list displays connected vendor cost separately from the product selling price", async () => {
  open();
  expect(await screen.findByText("$23.00")).toBeInTheDocument();
  expect(screen.getByText("$45.00")).toBeInTheDocument();
  expect(screen.getByText("Supplier seal")).toBeInTheDocument();
});

test.each(["/company/product-catalog", "/company/product-catalog/product"])("%s shows the supplier range while keeping preferred cost primary", async (path) => {
  vendors = [vendor, { id: "free", name: "Free supplier", productId: "product", rate: 0 }, { id: "expensive", name: "Other supplier", productId: "product", rate: 4200 }];
  open(path);
  expect(await screen.findByText(path.endsWith("/product") ? "$0.00 – $42.00" : "Range: $0.00 – $42.00")).toBeInTheDocument();
  expect(screen.getByText("$23.00")).toBeInTheDocument();
  expect(screen.getByText("$45.00")).toBeInTheDocument();
});

test("standalone products show manual cost and new products save cost in cents separately from price", async () => {
  vendors = [];
  open();
  expect(await screen.findByText("$17.50")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add new" }));
  expect(screen.queryByRole("button", { name: "Delete Product" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Product Name"), { target: { value: "Pump seal" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "Parts" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Subcategory" }), { target: { value: "Pump" } });
  fireEvent.change(screen.getByRole("combobox", { name: "UOM" }), { target: { value: "Unit" } });
  fireEvent.change(screen.getByLabelText(/Manual Unit Cost/), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("Sell Price"), { target: { value: "30.00" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Jobs", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Create Product" }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
  expect(setDoc.mock.calls[0][1]).toMatchObject({
    name: "Pump seal", category: "Parts", subCategory: "Pump", UOM: "Unit", defaultCostCents: 1250, rate: 1250, cost: 1250, sellPrice: 3000, availableForJobs: false, availableForJob: false, jobProductAvailable: false,
  });
});

test("edit uses the standard pickers and keeps saved custom values available", async () => {
  catalogProducts = [{ ...product, category: "Pool Supplies", subCategory: "Seal Kits", UOM: "Box" }];
  const update = jest.fn();
  writeBatch.mockReturnValueOnce({ update, set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) });

  open("/company/product-catalog/product");
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const category = screen.getByRole("combobox", { name: "Category" });
  expect(category).toHaveValue("Pool Supplies");
  expect(screen.getByRole("combobox", { name: "Subcategory" })).toHaveValue("Seal Kits");
  expect(screen.getByRole("combobox", { name: "UOM" })).toHaveValue("Box");
  fireEvent.change(category, { target: { value: "Parts" } });
  expect(within(category).getByRole("option", { name: "Pool Supplies" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save Product" }));

  await waitFor(() => expect(screen.queryByRole("button", { name: "Save Product" })).not.toBeInTheDocument());
  expect(update).toHaveBeenCalledWith(
    "companies/company/settings/genericItems/genericItems/product",
    expect.objectContaining({ category: "Parts", subCategory: "Seal Kits", UOM: "Box" })
  );
});

test("reconciliation uses the selected availability defaults with per-product overrides", async () => {
  catalogProducts = [];
  vendors = [{ id: "seal", name: "Seal" }, { id: "gasket", name: "Gasket" }];
  render(
    <Context.Provider value={{ recentlySelectedCompany: "company" }}>
      <MemoryRouter><ProductCatalogImport /></MemoryRouter>
    </Context.Provider>
  );
  const sealRow = within(await screen.findByRole("row", { name: /Seal/ }));
  fireEvent.click(screen.getByText("Default Availability for New Products"));
  const [defaultJobs] = screen.getAllByRole("checkbox", { name: "Jobs", exact: true });
  fireEvent.click(defaultJobs);
  fireEvent.click(sealRow.getByText("Product Availability"));
  const jobs = sealRow.getByRole("checkbox", { name: "Jobs", exact: true });
  expect(jobs).not.toBeChecked();
  fireEvent.click(jobs);

  fireEvent.click(screen.getByRole("button", { name: /^Create Products From All Unlinked Vendor Items/ }));
  await waitFor(() => expect(saveVendorProductConnection).toHaveBeenCalledTimes(2));
  expect(saveVendorProductConnection).toHaveBeenCalledWith(expect.objectContaining({
    vendorItemId: "seal", newProduct: expect.objectContaining({ availableForJobs: true }),
  }));
  expect(saveVendorProductConnection).toHaveBeenCalledWith(expect.objectContaining({
    vendorItemId: "gasket", newProduct: expect.objectContaining({ availableForJobs: false }),
  }));
});

test("product details expose vendor navigation and preferred supplier controls", async () => {
  open("/company/product-catalog/product");
  const link = await screen.findByRole("link", { name: "Supplier seal" });
  expect(link).toHaveAttribute("href", "/company/items/detail/vendor");
  expect(screen.getByRole("button", { name: "Disconnect Supplier seal" })).toBeEnabled();
});

test.each([
  "/company/product-catalog",
  "/company/product-catalog/product",
  "/company/settings/product-catalog/product",
])("%s can delete a product from the Edit popup and return to the list", async (path) => {
  open(path);
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete Product" }));

  expect(appConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Pool seal"), variant: "danger" }));
  expect(await screen.findByText("No products found.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Product Catalog" })).toBeInTheDocument();
  expect(deleteCatalogProduct).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company", productId: "product" }));
});

test("edit permission alone does not show the delete action", async () => {
  open(undefined, (permission) => permission !== "856");
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.getByRole("button", { name: "Save Product" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Delete Product" })).not.toBeInTheDocument();
});

test("canceling or failing deletion leaves the product and Edit popup available", async () => {
  appConfirm.mockResolvedValueOnce(false);
  deleteCatalogProduct.mockRejectedValueOnce(new Error("Offline"));
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const deleteButton = screen.getByRole("button", { name: "Delete Product" });

  fireEvent.click(deleteButton);
  await waitFor(() => expect(deleteButton).toBeEnabled());
  expect(deleteCatalogProduct).not.toHaveBeenCalled();

  fireEvent.click(deleteButton);
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: "Pool seal" })).toBeInTheDocument();
  expect(deleteButton).toBeEnabled();
});

test("read-only users can view costs but cannot edit or connect records", async () => {
  open("/company/product-catalog/product", false);
  await screen.findByRole("link", { name: "Supplier seal" });
  expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Disconnect Supplier seal" })).not.toBeInTheDocument();
});


test("bulk editing can select all filtered products across pages and applies only the requested setting", async () => {
  catalogProducts = Array.from({ length: 27 }, (_, index) => ({ ...product, id: `part-${index}`, name: `Part ${String(index).padStart(2, '0')}` }));
  vendors = [];
  open();
  await screen.findByText('Part 00');
  fireEvent.click(screen.getByRole('button', { name: 'Select page' }));
  expect(screen.getByText('25 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Part 26', exact: true }));
  expect(screen.getByText('26 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Select all filtered (27)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bulk Edit Availability' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Apply to 27 products' })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('Jobs'), { target: { value: 'no' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to 27 products' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(updateProductAvailability).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company', productIds: catalogProducts.map((item) => item.id), changes: { jobs: 'no' } }));
  expect(screen.getByText('0 selected')).toBeInTheDocument();
});

test("changing filters clears selection and retired duplicate products cannot be bulk reactivated", async () => {
  catalogProducts = [product, { ...product, id: 'retired', name: 'Retired seal', active: false, mergedIntoProductId: 'product' }];
  open();
  await screen.findByText('Retired seal');
  expect(screen.getByRole('checkbox', { name: 'Select Retired seal' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Select all filtered (1)' }));
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search products'), { target: { value: 'Pool' } });
  expect(screen.getByText('0 selected')).toBeInTheDocument();
});

test("availability can be combined with category, including legacy flags and defaults", async () => {
  const approvalOnly = { ...product, id: "approval", name: "Approval seal", category: "Parts", availableForJob: false, partApprovalAvailable: true, partPurchaseAvailable: false };
  catalogProducts = [
    approvalOnly,
    { ...product, name: "Legacy seal", category: "Parts" },
    { ...approvalOnly, id: "inactive", name: "Inactive seal", active: false },
    { ...approvalOnly, id: "purchasable", name: "Purchasable seal", partPurchaseAvailable: true },
    { ...approvalOnly, id: "no-approval", name: "No approval seal", partApprovalAvailable: false },
    { ...approvalOnly, id: "other-category", name: "Other category seal", category: "Misc" },
  ];
  open();
  await screen.findByRole("link", { name: "Legacy seal" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Legacy seal" }));
  expect(screen.queryByRole("combobox", { name: "Jobs" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Filter products" }));
  fireEvent.change(dialog.getByRole("combobox", { name: "Category" }), { target: { value: "Parts" } });
  for (const [label, value] of [["Active in catalog", "true"], ["Jobs", "false"], ["Part Approval Sales", "true"], ["Part Purchase", "false"]]) {
    fireEvent.change(dialog.getByRole("combobox", { name: label }), { target: { value } });
  }
  fireEvent.click(dialog.getByRole("button", { name: "Apply filters" }));

  const table = within(screen.getByRole("table"));
  expect(table.getAllByRole("link").map((link) => link.textContent)).toEqual(["Approval seal"]);
  expect(screen.getByRole("button", { name: "Select all filtered (1)" })).toBeEnabled();
  expect(screen.getByText("0 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Filters (5)" }));
  const reopened = within(await screen.findByRole("dialog", { name: "Filter products" }));
  expect(reopened.getByRole("combobox", { name: "Jobs" })).toHaveValue("false");
  fireEvent.click(reopened.getByRole("button", { name: "Reset filters" }));
  fireEvent.change(reopened.getByRole("combobox", { name: "Jobs" }), { target: { value: "true" } });
  fireEvent.click(reopened.getByRole("button", { name: "Apply filters" }));
  expect(within(screen.getByRole("table")).getAllByRole("link").map((link) => link.textContent)).toEqual(["Legacy seal"]);
});

test("rows per page stays on the toolbar and filter edits are applied only on confirmation", async () => {
  catalogProducts = Array.from({ length: 25 }, (_, index) => ({ ...product, id: `part-${index}`, name: `Part ${String(index).padStart(2, '0')}` }));
  open();
  await screen.findByRole("link", { name: "Part 00" });
  fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Filter products" }));
  expect(dialog.queryByRole("combobox", { name: "Rows per page" })).not.toBeInTheDocument();
  fireEvent.change(dialog.getByRole("combobox", { name: "Sort products" }), { target: { value: "nameDesc" } });
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  const reopened = within(await screen.findByRole("dialog", { name: "Filter products" }));
  expect(reopened.getByRole("combobox", { name: "Sort products" })).toHaveValue("nameAsc");
  fireEvent.change(reopened.getByRole("combobox", { name: "Sort products" }), { target: { value: "nameDesc" } });
  fireEvent.click(reopened.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  const links = within(screen.getByRole("table")).getAllByRole("link");
  expect(links).toHaveLength(10);
  expect(links[0]).toHaveTextContent("Part 24");
});

test("a failed bulk save retains the selected records and chosen availability for retry", async () => {
  updateProductAvailability.mockRejectedValueOnce(new Error('Offline'));
  open();
  await screen.findByText('Pool seal');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Pool seal', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Bulk Edit Availability' }));
  fireEvent.change(screen.getByLabelText('Jobs'), { target: { value: 'no' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 product' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Jobs')).toHaveValue('no');
  expect(screen.getByRole('button', { name: 'Apply to 1 product' })).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'Select Pool seal', exact: true })).toBeChecked();
});

test("read-only users have no bulk selection or bulk save action", async () => {
  open('/company/product-catalog', false);
  await screen.findByText('Pool seal');
  expect(screen.queryByRole('button', { name: 'Bulk Edit Availability' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test("active-only updates refresh legacy availability defaults and keep saved prices and connections", async () => {
  open();
  await screen.findByText('Pool seal');
  for (const active of ['no', 'yes']) {
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Pool seal', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Edit Availability' }));
    fireEvent.change(screen.getByLabelText('Active in catalog'), { target: { value: active } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 product' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText(active === 'no' ? 'No Jobs' : 'Jobs', { exact: true });
    expect(Boolean(screen.queryByText('Inactive', { exact: true }))).toBe(active === 'no');
  }
  expect(catalogProducts[0]).toMatchObject({ active: true, sellPrice: 4500, preferredVendorItemId: 'vendor', defaultCostCents: 1750 });
  expect(catalogProducts[0]).not.toHaveProperty('availableForJobs');
  expect(screen.getByText('$23.00')).toBeInTheDocument();
  expect(screen.getByText('$45.00')).toBeInTheDocument();
});
