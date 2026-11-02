import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkOfferReturnDialog from "./WorkOfferReturnDialog";
import { manageTechnicianWork } from "../../../utils/technicianWorkflow";
jest.mock("../../../utils/technicianWorkflow", () => ({ manageTechnicianWork: jest.fn() }));
const offer = { id: "offer", title: "Repair pump" };
const claim = { id: "claim", workerName: "Alex" };
beforeEach(() => manageTechnicianWork.mockReset());
test("requires a reason and submits the selected accepted claim", async () => {
  const onReturned = jest.fn(), onClose = jest.fn();
  manageTechnicianWork.mockResolvedValue({ offerId: "offer", claimId: "claim", status: "Rejected" });
  render(<WorkOfferReturnDialog companyId="company" offer={offer} claim={claim} onReturned={onReturned} onClose={onClose} />);
  expect(screen.getByRole("button", { name: "Return work" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Reason (required)" }), { target: { value: "  Schedule conflict  " } });
  fireEvent.click(screen.getByRole("button", { name: "Return work" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(manageTechnicianWork).toHaveBeenCalledWith("company", "withdraw", { offerId: "offer", claimId: "claim", reason: "Schedule conflict" });
  expect(onReturned).toHaveBeenCalledWith({ offerId: "offer", claimId: "claim", status: "Rejected" });
});
test("server refusal retains the reason and leaves accepted work open", async () => {
  const onReturned = jest.fn(), onClose = jest.fn();
  manageTechnicianWork.mockRejectedValue(Error("Work has started. Ask management to review."));
  render(<WorkOfferReturnDialog companyId="company" offer={offer} claim={claim} onReturned={onReturned} onClose={onClose} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Conflict" } });
  fireEvent.click(screen.getByRole("button", { name: "Return work" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Work has started");
  expect(screen.getByRole("textbox")).toHaveValue("Conflict");
  expect(onReturned).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});
test("keeping accepted work makes no mutation", () => {
  const onClose = jest.fn();
  render(<WorkOfferReturnDialog companyId="company" offer={offer} claim={claim} onReturned={jest.fn()} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Keep work" }));
  expect(onClose).toHaveBeenCalled(); expect(manageTechnicianWork).not.toHaveBeenCalled();
});
