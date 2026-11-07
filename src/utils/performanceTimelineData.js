import { collection, getDocsFromServer, limit, orderBy, query, startAfter, Timestamp, where } from "firebase/firestore";
import { db } from "./config";
import { selectPerformanceExportReviews } from "./performanceTimelineExport";

const PAGE_SIZE = 200;

// Read separately from the page's latest-50 preview, and fail rather than export an incomplete offline cache.
export async function loadPerformanceTimelineReviews({ companyId, companyUserId, settings, range, isCanceled = () => false }) {
    if (!companyId || !companyUserId) throw new Error("Choose a company user before downloading.");
    const reviewsRef = collection(db, "companyUserPerformanceReviews", companyId, "companyUsers", companyUserId, "reviews");
    const constraints = [];
    if (range.start) constraints.push(where("date", ">=", Timestamp.fromDate(range.start)));
    if (range.endExclusive) constraints.push(where("date", "<", Timestamp.fromDate(range.endExclusive)));
    constraints.push(orderBy("date", "desc"));
    const reviews = [];
    let cursor = null;
    while (!isCanceled()) {
        const page = await getDocsFromServer(query(reviewsRef, ...constraints, ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE)));
        if (isCanceled()) return [];
        reviews.push(...page.docs.map((reviewDoc) => ({ ...reviewDoc.data(), id: reviewDoc.id })));
        if (page.docs.length < PAGE_SIZE) break;
        cursor = page.docs[page.docs.length - 1];
    }
    return selectPerformanceExportReviews(reviews, settings, range);
}
