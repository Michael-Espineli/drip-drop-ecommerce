import { jsPDF } from "jspdf";
import regularFontUrl from "../assets/fonts/NotoSans-Regular.ttf";
import boldFontUrl from "../assets/fonts/NotoSans-Bold.ttf";
import { performanceDate, performanceTypeLabel } from "./performanceTimelineExport";

let fontPromise;
const loadFonts = () => {
    if (!fontPromise) {
        fontPromise = Promise.all([regularFontUrl, boldFontUrl].map(async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Could not load the PDF fonts.");
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 32768) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
            }
            return btoa(binary);
        })).catch((error) => { fontPromise = null; throw error; });
    }
    return fontPromise;
};

// Strip non-printing controls while preserving the note's line breaks.
// eslint-disable-next-line no-control-regex
const cleanText = (value) => String(value || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const NAVY = [14, 36, 92];
const SLATE = [71, 85, 105];
const tones = { kudo: [4, 120, 87], complaint: [190, 18, 60], coaching: [161, 98, 7] };

export async function createPerformanceTimelinePdf({ reviews, technicianName, settings, range, generatedAt = new Date() }) {
    const [regular, bold] = await loadFonts();
    const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true, putOnlyUsedFonts: true });
    pdf.addFileToVFS("NotoSans-Regular.ttf", regular);
    pdf.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    pdf.addFileToVFS("NotoSans-Bold.ttf", bold);
    pdf.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
    pdf.setProperties({ title: `Performance Timeline - ${cleanText(technicianName)}`, subject: range.label, author: "Drip Drop", creator: "Drip Drop" });

    const margin = 42;
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const contentWidth = width - margin * 2;
    const bottom = height - 52;
    let y = margin;
    const setText = (size, boldText, color) => {
        pdf.setFont("NotoSans", boldText ? "bold" : "normal");
        pdf.setFontSize(size);
        pdf.setTextColor(...color);
    };
    const newPage = () => {
        pdf.addPage();
        y = margin;
        setText(10, true, NAVY);
        pdf.text("PERFORMANCE TIMELINE", margin, y);
        y += 17;
        setText(9, false, SLATE);
        // A short running name leaves space for content even with unusually long profile names.
        pdf.text(pdf.splitTextToSize(cleanText(technicianName), contentWidth)[0] || "Technician", margin, y);
        y += 20;
    };
    const ensureSpace = (amount) => { if (y + amount > bottom) newPage(); };
    const paragraph = (value, { size = 10, boldText = false, color = SLATE, indent = 0, after = 6 } = {}) => {
        setText(size, boldText, color);
        const lines = pdf.splitTextToSize(cleanText(value), contentWidth - indent);
        const lineHeight = size * 1.5;
        for (const line of lines) {
            ensureSpace(lineHeight);
            setText(size, boldText, color);
            pdf.text(line, margin + indent, y);
            y += lineHeight;
        }
        y += after;
    };

    paragraph("DRIP DROP / TECHNICIAN REVIEW", { size: 9, boldText: true, color: NAVY, after: 8 });
    paragraph("Performance Timeline", { size: 23, boldText: true, color: NAVY, after: 2 });
    paragraph(technicianName, { size: 15, boldText: true, color: NAVY, after: 8 });
    paragraph(`Time frame: ${range.label}`, { after: 2 });
    paragraph(`${settings.entryType === "complaint" ? "Complaints only" : "All performance entries"} | ${settings.order === "asc" ? "Oldest first" : "Newest first"}`, { after: 2 });
    paragraph(`Generated ${generatedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`, { size: 9, after: 12 });
    const counts = new Map();
    reviews.forEach((review) => {
        const label = performanceTypeLabel(review.type);
        counts.set(label, (counts.get(label) || 0) + 1);
    });
    paragraph(`${reviews.length} ${reviews.length === 1 ? "entry" : "entries"} in this report`, { size: 11, boldText: true, color: NAVY, after: 2 });
    paragraph([...counts].map(([label, count]) => `${label}: ${count}`).join("   |   "), { size: 9, after: 12 });

    reviews.forEach((review, index) => {
        ensureSpace(85);
        pdf.setDrawColor(226, 232, 240);
        pdf.line(margin, y - 6, width - margin, y - 6);
        y += 12;
        const color = tones[review.type] || NAVY;
        pdf.setFillColor(...color);
        pdf.circle(margin + 3, y - 4, 3, "F");
        paragraph(`${index + 1}. ${performanceTypeLabel(review.type)}`, { size: 11, boldText: true, color, indent: 14, after: 2 });
        const date = performanceDate(review.date || review.createdAt);
        paragraph(`${date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Date not set"} | By ${review.createdByName || "Management"} | ${review.visibleToTechnician ? "Technician-visible" : "Internal"}`, { size: 9, after: 8 });
        if (review.title) paragraph(review.title, { size: 11, boldText: true, color: NAVY });
        paragraph(review.note || "No notes recorded.", { after: 8 });

        const references = [...list(review.references?.serviceStops), ...list(review.references?.jobs)];
        if (references.length) {
            ensureSpace(40);
            paragraph("Work references", { size: 9, boldText: true, color: NAVY, after: 2 });
            references.forEach((reference) => paragraph([reference.label || reference.id || "Reference", reference.description].filter(Boolean).join(" - "), { size: 9, indent: 10, after: 2 }));
            y += 6;
        }
        const reports = list(review.attachedReports);
        if (reports.length) {
            ensureSpace(40);
            paragraph("Attached reports", { size: 9, boldText: true, color: NAVY, after: 2 });
            reports.forEach((report) => {
                paragraph(`${report.title || "Report"} (${report.isTechnicianVisible ? "Technician-visible" : "Internal"})`, { size: 9, indent: 10, after: 2 });
                if (report.notes) paragraph(report.notes, { size: 9, indent: 10, after: 2 });
            });
            y += 6;
        }
        const files = [...list(review.attachments), ...reports.flatMap((report) => list(report.attachments))]
            .filter((file, fileIndex, all) => all.findIndex((other) => (other.id || other.url || other.name) === (file.id || file.url || file.name)) === fileIndex);
        if (files.length) {
            ensureSpace(40);
            paragraph("Files (contents not included)", { size: 9, boldText: true, color: NAVY, after: 2 });
            files.forEach((file) => paragraph(file.name || file.title || "Attachment", { size: 9, indent: 10, after: 2 }));
        }
        y += 12;
    });

    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setDrawColor(226, 232, 240);
        pdf.line(margin, height - 35, width - margin, height - 35);
        setText(8, false, SLATE);
        pdf.text("Drip Drop | Technician review", margin, height - 20);
        pdf.text(`Page ${page} of ${pageCount}`, width - margin, height - 20, { align: "right" });
    }
    return pdf;
}
