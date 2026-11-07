export const PERFORMANCE_TIME_FRAMES = [
    { value: "90", label: "Last 90 days" },
    { value: "30", label: "Last 30 days" },
    { value: "365", label: "Last 12 months" },
    { value: "all", label: "All time" },
    { value: "custom", label: "Custom dates" },
];

export const defaultPerformanceExportSettings = () => ({
    timeFrame: "90",
    startDate: "",
    endDate: "",
    entryType: "all",
    order: "desc",
});

export const performanceDate = (value) => {
    if (!value) return null;
    const date = typeof value.toDate === "function" ? value.toDate()
        : value.seconds !== undefined ? new Date(value.seconds * 1000)
            : value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const calendarDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

export const performanceExportRange = (settings, now = new Date()) => {
    if (!PERFORMANCE_TIME_FRAMES.some((option) => option.value === settings.timeFrame)) {
        throw new Error("Choose a time frame.");
    }
    if (settings.timeFrame === "all") return { start: null, endExclusive: null, label: "All time" };

    let start;
    let end;
    if (settings.timeFrame === "custom") {
        start = calendarDate(settings.startDate);
        end = calendarDate(settings.endDate);
        if (!start || !end) throw new Error("Choose a valid start date and end date.");
        if (start > end) throw new Error("The end date must be on or after the start date.");
    } else {
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start = new Date(end);
        // Calendar days keep both selected dates inclusive across daylight saving changes.
        start.setDate(start.getDate() - Number(settings.timeFrame) + 1);
    }
    const endExclusive = new Date(end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const format = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return { start, endExclusive, label: `${format(start)} - ${format(end)}` };
};

export const performanceTypeLabel = (type) => ({
    kudo: "Praise", complaint: "Complaint", coaching: "Coaching", observation: "Observation",
    summary: "Summary", sharedReport: "Shared Report",
}[type] || String(type || "Note").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " "));

export const selectPerformanceExportReviews = (reviews, settings, range) => reviews
    .filter((review) => {
        if (settings.entryType === "complaint" && review.type !== "complaint") return false;
        const date = performanceDate(review.date || review.createdAt);
        return (!range.start || (date && date >= range.start))
            && (!range.endExclusive || (date && date < range.endExclusive));
    })
    .sort((left, right) => {
        const difference = (performanceDate(left.date || left.createdAt)?.getTime() || 0)
            - (performanceDate(right.date || right.createdAt)?.getTime() || 0);
        return settings.order === "asc" ? difference : -difference;
    });

export const performanceExportFilename = (technicianName, settings, now = new Date()) => {
    const name = String(technicianName || "technician").normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "technician";
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    const period = settings.timeFrame === "custom" ? `${settings.startDate}_to_${settings.endDate}` : settings.timeFrame === "all" ? "all-time" : `last-${settings.timeFrame}-days`;
    return `${name}-performance-${period}-${date}.pdf`;
};
