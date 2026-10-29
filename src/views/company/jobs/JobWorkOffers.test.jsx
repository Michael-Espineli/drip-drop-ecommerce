import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Context } from "../../../context/AuthContext";
import JobWorkOffers from "./JobWorkOffers";
jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: id => ["324", "328"].includes(id) }));
jest.mock("../offeredWork/WorkOfferManagementDialog", () => props => <div role="dialog" aria-label="Manage offer"><p>{props.offer.title} · {props.initialTab}</p><button onClick={() => props.onChanged({ offerId: props.offer.id })}>Saved offer</button></div>);
const offers = [
  { id: "comp_work_offer_open", title: "Pump repair", status: "Sent", offerType: "Direct User", jobTaskIds: ["task"], offeredToUserName: "Alex" },
  { id: "comp_work_offer_done", title: "Old cleaning", status: "Completed", offerType: "Internal Board" },
];
test("job offers render active and previous cards with direct management actions", () => {
  const onChanged = jest.fn();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Context.Provider value={{ user: { uid: "manager" } }}><JobWorkOffers companyId="company" offers={offers} workers={[]} tasks={[]} onChanged={onChanged} /></Context.Provider></MemoryRouter>);
  const active = screen.getByRole("region", { name: "Active work offers" });
  expect(active).toHaveTextContent("Pump repair");
  const previous = screen.getByRole("region", { name: "Previous work offers" });
  expect(previous).toHaveTextContent("Old cleaning");
  expect(within(previous).getByRole("button", { name: "Delete offer" })).toBeDisabled();
  fireEvent.click(within(active).getByRole("button", { name: "Edit offer" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Pump repair · edit");
  fireEvent.click(screen.getByRole("button", { name: "Saved offer" }));
  expect(onChanged).toHaveBeenCalledWith({ offerId: "comp_work_offer_open" });
});
