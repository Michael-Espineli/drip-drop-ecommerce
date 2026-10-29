import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import JobTaskProductPicker from "./JobTaskProductPicker";

const planned = { value: "plan:pump", label: "Quoted pump · Qty 2", planMaterialId: "pump", dbItemId: "supplier", make: "Pentair", model: "VS" };
const catalog = { value: "catalog:heater", label: "New heater", dbItemId: "heater" };
test("the picker prioritizes plan products and exposes exact row identity", () => {
  const onChange = jest.fn();
  render(<JobTaskProductPicker options={{ planned: [planned], catalog: [catalog] }} value={planned} onChange={onChange} quantity="1" onQuantityChange={jest.fn()} />);
  const select = screen.getByRole("combobox", { name: "Product for this task" });
  expect(within(select).getAllByRole("group").map((group) => group.label)).toEqual(["Products already on this plan", "Add a product from the catalog"]);
  expect(screen.getByText(/quantity and quoted price are managed in Products/)).toBeInTheDocument();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.getByText(/Database item connected · Pentair VS/)).toBeInTheDocument();
  fireEvent.change(select, { target: { value: catalog.value } });
  expect(onChange).toHaveBeenCalledWith(catalog);
});

test("new product quantities are editable and missing database links are explicit", () => {
  render(<JobTaskProductPicker options={{ planned: [], catalog: [catalog] }} value={{ ...catalog, dbItemId: "" }} onChange={jest.fn()} quantity="3" onQuantityChange={jest.fn()} />);
  expect(screen.getByRole("spinbutton", { name: "Product quantity" })).toHaveValue(3);
  expect(screen.getByRole("alert")).toHaveTextContent("needs a linked database item");
});
