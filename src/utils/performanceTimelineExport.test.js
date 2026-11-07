import {
    defaultPerformanceExportSettings, performanceDate, performanceExportFilename, performanceExportRange, selectPerformanceExportReviews,
} from "./performanceTimelineExport";

const settings = (changes = {}) => ({ ...defaultPerformanceExportSettings(), ...changes });

test.each(["30", "90", "365"])("the %s-day preset includes today and the correct first local calendar day", (timeFrame) => {
    const now = new Date(2026, 10, 6, 15, 40);
    const range = performanceExportRange(settings({ timeFrame }), now);
    const expected = new Date(2026, 10, 6);
    expected.setDate(expected.getDate() - Number(timeFrame) + 1);
    expect(range.start).toEqual(expected);
    expect(range.endExclusive).toEqual(new Date(2026, 10, 7));
});

test("custom days are inclusive through the end of a daylight saving transition day", () => {
    const options = settings({ timeFrame: "custom", startDate: "2026-11-01", endDate: "2026-11-01" });
    const range = performanceExportRange(options);
    expect(range.start).toEqual(new Date(2026, 10, 1));
    expect(range.endExclusive).toEqual(new Date(2026, 10, 2));
    const rows = [
        { id: "before", date: new Date(2026, 9, 31, 23, 59, 59) },
        { id: "first", date: new Date(2026, 10, 1, 0, 0, 0) },
        { id: "last", date: new Date(2026, 10, 1, 23, 59, 59, 999) },
        { id: "after", date: new Date(2026, 10, 2) },
    ];
    expect(selectPerformanceExportReviews(rows, options, range).map((row) => row.id)).toEqual(["last", "first"]);
});

test.each([
    { startDate: "", endDate: "2026-11-06" },
    { startDate: "2026-02-30", endDate: "2026-11-06" },
    { startDate: "2026-11-07", endDate: "2026-11-06" },
])("invalid or reversed custom dates are rejected: %o", (dates) => {
    expect(() => performanceExportRange(settings({ timeFrame: "custom", ...dates }))).toThrow();
});

test("all time includes older entries, supports Firestore timestamps, and sorts complaints without mutating the input", () => {
    const rows = [
        { id: "old", type: "complaint", date: { toDate: () => new Date(2020, 0, 1) } },
        { id: "praise", type: "kudo", date: new Date(2026, 10, 5) },
        { id: "new", type: "complaint", date: { seconds: new Date(2026, 10, 6).getTime() / 1000 } },
    ];
    const options = settings({ timeFrame: "all", entryType: "complaint", order: "asc" });
    const range = performanceExportRange(options);
    expect(range).toEqual({ start: null, endExclusive: null, label: "All time" });
    expect(selectPerformanceExportReviews(rows, options, range).map((row) => row.id)).toEqual(["old", "new"]);
    expect(rows.map((row) => row.id)).toEqual(["old", "praise", "new"]);
    expect(performanceDate("bad-date")).toBeNull();
});

test("filenames include the technician and selected period and cannot contain path characters", () => {
    const result = performanceExportFilename("José / Rivera", settings({ timeFrame: "custom", startDate: "2026-10-01", endDate: "2026-11-06" }), new Date(2026, 10, 6));
    expect(result).toBe("Jose-Rivera-performance-2026-10-01_to_2026-11-06-2026-11-06.pdf");
});
