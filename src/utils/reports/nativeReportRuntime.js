import { individualReportDataForGroup, individualPerformanceNoteText, individualCustomerPerformanceNoteText } from "./reportPerformance";
import * as XLSX from 'xlsx';
import { reportCatalog } from './reportCatalog';
import { reportSourcePlan, reportTaskStops, generateReport } from './reportRuntime';
import { displayColumnValue, reportSummarySheetRows, reportRowsForExport, csvCell, printableReportHtml } from './reportExport';
const table = (section, columns) => ({
  title: section.title || section.name || 'Results',
  columns: (section.columns || columns || []).map((column) => ({ key: column.key, label: column.label })),
  rows: [...(section.rows || []), ...(section.footerRow ? [section.footerRow] : [])].map((row) =>
    (section.columns || columns || []).map((column) => String(displayColumnValue(column, row) ?? ''))),
});
export const catalogJSON = () => JSON.stringify(reportCatalog);
export const sourcePlanJSON = (optionsJSON) => JSON.stringify(reportSourcePlan(JSON.parse(optionsJSON)));
export const taskStopIdsJSON = (inputJSON) => {
  const { options, sources } = JSON.parse(inputJSON);
  return JSON.stringify(reportTaskStops(options, sources).map((stop) => stop.id));
};
export const generateJSON = (inputJSON) => {
  const { options, sources } = JSON.parse(inputJSON), report = generateReport(options, sources);
  return JSON.stringify({ title: report.title, description: report.description, warnings: report.warnings,
    stats: report.stats, total: report.total,
    sections: [...(report.summarySections || []).map((section) => table(section)), ...(report.groups || []).map((group) => table(group, report.columns))],
    individualUsers: report.reportType === 'readingPerformance' && report.performanceView === 'users'
      ? (report.groups || []).map((group) => ({ id: group.id, name: group.technicianName || group.name, companyUserId: group.companyUserId || '' })) : [],
    chartSections: report.chartSections || [], chartRange: report.chartRange,
  });
};
export const exportJSON = (inputJSON, type, groupId = '') => {
  const { options, sources } = JSON.parse(inputJSON);
  let report = generateReport(options, sources);
  if (groupId) {
    const group = report.groups.find((group) => group.id === groupId);
    if (!group) throw new Error('This user is no longer in the report.');
    report = individualReportDataForGroup(report, group);
  }
  if (type === 'html') return printableReportHtml(report);
  if (type === 'csv') {
    const columns = ['Group', ...report.columns.map((column) => column.label)];
    return [...reportSummarySheetRows(report), [], columns, ...reportRowsForExport(report).map((row) => columns.map((key) => row[key] ?? ''))]
      .map((row) => row.map(csvCell).join(',')).join('\n');
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(reportSummarySheetRows(report)), 'Summary');
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(reportRowsForExport(report)), 'Report Data');
  return XLSX.write(book, { type: 'base64', bookType: 'xlsx' });
};

export const performanceNoteJSON = (inputJSON, groupId) => {
  const { options, sources } = JSON.parse(inputJSON), report = generateReport(options, sources);
  if (report.reportType !== 'readingPerformance' || report.performanceView !== 'users') throw new Error('Generate a user reading performance report first.');
  const group = report.groups.find((group) => group.id === groupId);
  if (!group?.companyUserId) throw new Error('This report row could not be matched to a company user.');
  const individual = individualReportDataForGroup(report, group);
  return JSON.stringify({ title: individual.title, reportTitle: report.title, note: individualPerformanceNoteText(report, group),
    companyUserId: group.companyUserId, technicianUserId: group.technicianUserId, technicianName: group.technicianName || group.name,
    html: printableReportHtml(individual),
    customerNotes: (group.customerReferences || []).map((reference) => ({ ...reference, note: individualCustomerPerformanceNoteText(report, group, reference) })),
  });
};
