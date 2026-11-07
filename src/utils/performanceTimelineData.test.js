import { getDocsFromServer, query, startAfter } from "firebase/firestore";
import { loadPerformanceTimelineReviews } from "./performanceTimelineData";
import { defaultPerformanceExportSettings, performanceExportRange } from "./performanceTimelineExport";

jest.mock("./config", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({
    collection: (_, ...parts) => parts.join("/"), query: jest.fn((ref, ...constraints) => ({ ref, constraints })),
    where: (...args) => ({ where: args }), orderBy: (...args) => ({ orderBy: args }), limit: (value) => ({ limit: value }),
    startAfter: jest.fn((cursor) => ({ cursor })), getDocsFromServer: jest.fn(), Timestamp: { fromDate: (date) => date },
}));

const options = (settings = {}) => {
    const selected = { ...defaultPerformanceExportSettings(), timeFrame: "all", ...settings };
    return { companyId: "company-1", companyUserId: "membership-1", settings: selected, range: performanceExportRange(selected) };
};
const row = (index) => ({ id: `review-${index}`, data: () => ({ type: "complaint", date: new Date(2026, 10, 6, 12), note: `Full note ${index}` }) });
beforeEach(() => jest.clearAllMocks());

test("exports every server page beyond the 50-row preview, using the document cursor even when dates tie", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => row(index));
    getDocsFromServer.mockResolvedValueOnce({ docs: firstPage }).mockResolvedValueOnce({ docs: [row(200)] });
    const reviews = await loadPerformanceTimelineReviews(options());
    expect(reviews).toHaveLength(201);
    expect(new Set(reviews.map((review) => review.id)).size).toBe(201);
    expect(startAfter).toHaveBeenCalledWith(firstPage[199]);
    expect(query.mock.calls[0][0]).toBe("companyUserPerformanceReviews/company-1/companyUsers/membership-1/reviews");
    expect(query.mock.calls[0].slice(1)).toEqual([{ orderBy: ["date", "desc"] }, { limit: 200 }]);
});

test("custom dates constrain server reads with an exclusive next-day upper bound", async () => {
    getDocsFromServer.mockResolvedValue({ docs: [] });
    const selected = options({ timeFrame: "custom", startDate: "2026-11-01", endDate: "2026-11-06", entryType: "complaint" });
    await loadPerformanceTimelineReviews(selected);
    expect(query.mock.calls[0].slice(1)).toEqual([
        { where: ["date", ">=", new Date(2026, 10, 1)] },
        { where: ["date", "<", new Date(2026, 10, 7)] },
        { orderBy: ["date", "desc"] }, { limit: 200 },
    ]);
});

test("a later server failure rejects the whole export instead of returning a partial report", async () => {
    getDocsFromServer.mockResolvedValueOnce({ docs: Array.from({ length: 200 }, (_, index) => row(index)) }).mockRejectedValueOnce(new Error("Offline"));
    await expect(loadPerformanceTimelineReviews(options())).rejects.toThrow("Offline");
});

test("unmounting stops pagination and discards old-company results", async () => {
    let canceled = false;
    getDocsFromServer.mockImplementationOnce(async () => { canceled = true; return { docs: Array.from({ length: 200 }, (_, index) => row(index)) }; });
    expect(await loadPerformanceTimelineReviews({ ...options(), isCanceled: () => canceled })).toEqual([]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});
