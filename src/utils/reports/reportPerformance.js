import { normalizeLookupValue } from "./reportEngine";
import { reportSummarySections } from "./reportExport";
const matchingIndividualSummaryRows = (section = {}, group = {}) => {
  const groupId = normalizeLookupValue(group.id);
  const groupName = normalizeLookupValue(group.name);

  return (section.rows || []).filter((row) => {
    const rowId = normalizeLookupValue(row.id || row.userId || row.companyUserId || row.customerId);
    const rowName = normalizeLookupValue(row.user || row.customer || row.worker || row.technician || row.name);
    return (groupId && rowId === groupId) || (groupName && rowName === groupName);
  });
};

const individualReportDataForGroup = (reportData, group) => {
  const summarySections = reportSummarySections(reportData)
    .map((section) => ({
      ...section,
      rows: matchingIndividualSummaryRows(section, group),
    }))
    .filter((section) => section.rows.length > 0);
  const groupMetricStats = Object.entries(group.metrics || {}).map(([label, value]) => ({
    label,
    value: typeof value === "number" ? value.toLocaleString() : String(value || "-"),
  }));
  const contextStats = (reportData.stats || []).filter((stat) =>
    ["Date Range", "Customer Tags"].includes(stat.label)
  );

  return {
    ...reportData,
    title: `${reportData.title || "Report"} - ${group.name}`,
    stats: [
      { label: "Technician", value: group.technicianName || group.name },
      ...groupMetricStats,
      ...contextStats,
    ],
    summarySections: summarySections.length
      ? summarySections
      : group.summary
        ? [{
          title: "Technician Summary",
          columns: Object.keys(group.summary)
            .filter((key) => !["id"].includes(key))
            .map((key) => ({ key, label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase()) })),
          rows: [group.summary],
        }]
        : [],
    groups: [{
      ...group,
      name: group.technicianName || group.name,
    }],
  };
};

const individualPerformanceNoteText = (reportData, group) => {
  const rows = Array.isArray(group.rows) ? group.rows : [];
  const standardLines = rows.slice(0, 10).map((row) => {
    if (row.standard) {
      return [
        `- ${row.standard}`,
        row.successRate ? `Success: ${row.successRate}` : "",
        row.failingRate ? `Fail: ${row.failingRate}` : "",
        row.failingReadings !== undefined ? `Failing readings: ${row.failingReadings}` : "",
        row.latestFail ? `Latest fail: ${row.latestFail}` : "",
      ].filter(Boolean).join(" | ");
    }

    return [
      `- ${row.date || "No date"}`,
      row.customer,
      row.pool,
      row.reading,
      row.value,
      row.rule,
    ].filter(Boolean).join(" | ");
  });
  const metricLines = Object.entries(group.metrics || {}).map(([label, value]) => (
    `- ${label}: ${typeof value === "number" ? value.toLocaleString() : value}`
  ));
  const dateRange = (reportData.stats || []).find((stat) => stat.label === "Date Range")?.value;

  return [
    `Reading performance note for ${group.technicianName || group.name}.`,
    dateRange ? `Date range: ${dateRange}` : "",
    "",
    "Performance summary:",
    ...(metricLines.length ? metricLines : ["- No metrics available."]),
    "",
    "Standards and detail:",
    ...(standardLines.length ? standardLines : ["- No failing standards found in this individual report."]),
    rows.length > 10 ? `- ${rows.length - 10} more row(s) included in the attached report.` : "",
    "",
    "Attached report includes only this technician's performance data.",
  ].filter((line) => line !== "").join("\n");
};

const individualCustomerPerformanceNoteText = (reportData, group, customerReference) => {
  const rows = Array.isArray(customerReference?.rows) ? customerReference.rows : [];
  const dateRange = (reportData.stats || []).find((stat) => stat.label === "Date Range")?.value;
  const technicianName = group.technicianName || group.name || "Technician";
  const detailLines = rows.slice(0, 10).map((row) => [
    `- ${row.date || "No date"}`,
    row.pool,
    row.reading || row.standard,
    row.value,
    row.rule,
  ].filter(Boolean).join(" | "));

  return [
    `Performance note copied from ${technicianName}'s reading performance report.`,
    dateRange ? `Date range: ${dateRange}` : "",
    "",
    "Customer-specific details:",
    ...(detailLines.length ? detailLines : ["- No customer-specific detail rows were available."]),
    rows.length > 10 ? `- ${rows.length - 10} more row(s) included in the technician report.` : "",
  ].filter((line) => line !== "").join("\n");
};


export { individualReportDataForGroup, individualPerformanceNoteText, individualCustomerPerformanceNoteText };
