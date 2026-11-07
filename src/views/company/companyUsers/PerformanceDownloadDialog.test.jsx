import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPerformanceTimelineReviews } from "../../../utils/performanceTimelineData";
import { createPerformanceTimelinePdf } from "../../../utils/performanceTimelinePdf";
import PerformanceDownloadDialog from "./PerformanceDownloadDialog";

const mockRequirePermission = jest.fn();
const mockSave = jest.fn();
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ requirePermission: mockRequirePermission }));
jest.mock("../../../utils/performanceTimelineData", () => ({ loadPerformanceTimelineReviews: jest.fn() }));
jest.mock("../../../utils/performanceTimelinePdf", () => ({ createPerformanceTimelinePdf: jest.fn() }));
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });
const reviews = [{ id: "note-1", type: "complaint", note: "Full performance note", date: new Date(2026, 10, 1) }];
beforeEach(() => {
    jest.clearAllMocks();
    mockRequirePermission.mockReturnValue(true);
    loadPerformanceTimelineReviews.mockResolvedValue(reviews);
    createPerformanceTimelinePdf.mockResolvedValue({ save: mockSave });
    mockSave.mockResolvedValue(undefined);
});
const open = () => {
    const onClose = jest.fn();
    const view = render(<PerformanceDownloadDialog companyId="company-1" companyUserId="membership-1" technicianName="Taylor Technician" onClose={onClose} />);
    return { ...view, onClose };
};

test("opening does not fetch or download; confirmation uses the selected dates, type and order", async () => {
    const { onClose } = open();
    expect(screen.getByRole("dialog", { name: "Download Performance Timeline" })).toBeInTheDocument();
    expect(loadPerformanceTimelineReviews).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Time frame"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-11-06" } });
    fireEvent.change(screen.getByLabelText("Entries"), { target: { value: "complaint" } });
    fireEvent.change(screen.getByLabelText("Timeline order"), { target: { value: "asc" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Download" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRequirePermission).toHaveBeenCalledWith("260", "download performance history");
    expect(loadPerformanceTimelineReviews).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1", companyUserId: "membership-1", settings: expect.objectContaining({ startDate: "2026-10-01", endDate: "2026-11-06", entryType: "complaint", order: "asc" }) }));
    expect(createPerformanceTimelinePdf).toHaveBeenCalledWith(expect.objectContaining({ reviews, technicianName: "Taylor Technician" }));
    expect(mockSave).toHaveBeenCalledWith(expect.stringMatching(/Taylor-Technician-performance-2026-10-01_to_2026-11-06-.*\.pdf$/), { returnPromise: true });
});

test.each(["Cancel", "Close download settings", "Escape"])("%s dismisses without fetching or downloading", async (action) => {
    const { onClose } = open();
    if (action === "Escape") userEvent.keyboard("{Escape}");
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadPerformanceTimelineReviews).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
});

test("reversed dates and denied read permission cannot export", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Time frame"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-07" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-11-06" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("on or after");
    expect(loadPerformanceTimelineReviews).not.toHaveBeenCalled();
    mockRequirePermission.mockReturnValue(false);
    fireEvent.change(screen.getByLabelText("Time frame"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Download" }));
    expect(loadPerformanceTimelineReviews).not.toHaveBeenCalled();
});

test("empty periods show an explanation and do not download an empty PDF", async () => {
    loadPerformanceTimelineReviews.mockResolvedValue([]);
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No performance entries match");
    expect(createPerformanceTimelinePdf).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
});

test("a failure preserves settings for retry and duplicate submissions are blocked while preparing", async () => {
    loadPerformanceTimelineReviews.mockRejectedValueOnce(new Error("Offline"));
    const { onClose } = open();
    fireEvent.change(screen.getByLabelText("Time frame"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Download" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Time frame")).toHaveValue("all");
    let finish;
    loadPerformanceTimelineReviews.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Download" }));
    const busy = screen.getByRole("button", { name: "Downloading..." });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Download performance timeline" }));
    userEvent.keyboard("{Escape}");
    expect(loadPerformanceTimelineReviews).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish(reviews));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

test("leaving the technician page during a pending read cannot download an obsolete report", async () => {
    let finish;
    loadPerformanceTimelineReviews.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = open();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Download" }));
    unmount();
    await act(async () => finish(reviews));
    expect(createPerformanceTimelinePdf).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
});
