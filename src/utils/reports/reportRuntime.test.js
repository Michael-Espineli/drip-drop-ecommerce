import { reportCatalog } from './reportCatalog';
import { generateReport, loadReportSources, prepareReportContext, reportSourcePlan, validateReportOptions } from './reportRuntime';
import { agreementRevenueCentsForRange, purchasePreTaxCents, purchaseTotalCents } from './reportEngine';
import { csvCell, printableReportHtml, reportSummarySheetRows } from './reportExport';
import { generateJSON, exportJSON, performanceNoteJSON } from './nativeReportRuntime';

const options = (reportType = 'readings', overrides = {}) => ({ companyId: 'company', reportType, mode: 'summary', groupBy: 'company',
  dateRange: { start: '2026-11-01', end: '2026-11-30' }, canViewPayrollInformation: true,
  readingHealthFilters: { templateId: 'ph', operator: 'gt', threshold: '8' },
  readingPerformanceStandards: [{ id: 'high-ph', templateId: 'ph', operator: 'gt', threshold: '8' }], readingPerformanceView: 'users', ...overrides });
const date = '2026-11-10T12:00:00';
const sources = () => ({ customers: [{ id: 'customer', firstName: 'Sam', tags: ['North'] }],
  readingTemplates: [{ id: 'ph', name: 'pH', UOM: 'pH', highWarning: 8 }],
  dosageTemplates: [{ id: 'chlorine', name: 'Chlorine', UOM: 'gal', linkedDataBaseItemIds: ['chemical'], priceCents: 500 }],
  databaseItems: [{ id: 'chemical', name: 'Chlorine', UOM: 'gal', size: '1 gal', category: 'Chemicals' }],
  stopData: [{ id: 'reading1', serviceStopId: 'stop', customerId: 'customer', customerName: 'Sam', userId: 'worker', userName: 'Alex', bodyOfWaterId: 'pool', date,
    readings: [{ templateId: 'ph', name: 'pH', value: '8.4', UOM: 'pH' }], dosages: [{ templateId: 'chlorine', name: 'Chlorine', amount: 2, UOM: 'gal' }] }],
  jobs: [{ id: 'job', customerId: 'customer', customerName: 'Sam', rate: 99999, totalAmountCents: 30000, dateCreated: date, billingStatus: 'Invoiced', operationStatus: 'Finished', laborCostCents: 5000 }],
  purchases: [{ id: 'purchase', itemId: 'chemical', name: 'Chlorine', customerId: 'customer', date, price: 1000, quantityString: '2', taxAmountCents: 100, workOrderId: 'job' }],
  payrollLines: [{ id: 'pay', technicianId: 'worker', technicianName: 'Alex', customerId: 'customer', jobId: 'job', totalAmountCents: 5000, completedDate: date, calculationStatus: 'approved' }],
  serviceStops: [{ id: 'stop', customerId: 'customer', techId: 'worker', tech: 'Alex', serviceDate: date, recurringServiceStopId: 'recurring' }],
  recurringServiceStops: [{ id: 'recurring', customerId: 'customer', serviceLocationId: 'site', techId: 'worker', tech: 'Alex' }],
  serviceAgreements: [{ id: 'agreement', customerId: 'customer', serviceLocationId: 'site', status: 'accepted', sourceType: 'recurringService', totalAmountCents: 30000, startDate: '2026-11-01', rateType: 'monthly' }],
  salesInvoices: [{ id: 'invoice', jobId: 'job', customerId: 'customer', totalAmountCents: 31000, taxAmountCents: 1000, status: 'paid', invoiceDate: date }],
  serviceLocations: [{ id: 'site', customerId: 'customer', name: 'Home' }], bodiesOfWater: [{ id: 'pool', customerId: 'customer', serviceLocationId: 'site', name: 'Pool' }],
  users: [{ id: 'company-worker', userId: 'worker', userName: 'Alex' }],
  vehicles: [{ id: 'van', nickName: 'Van' }], activeRoutes: [{ id: 'route', vehicalId: 'van', date, startMilage: 100, endMilage: 125 }],
  pipelineRows: [{ id: 'lead', customerId: 'customer', customerName: 'Sam', status: 'active', leadSource: 'Referral' }],
});
const stat = (report, label) => report.stats.find((item) => item.label === label)?.value;

describe.each(reportCatalog.map((report) => report.value))('%s report', (type) => {
  test.each(['summary', 'detail'])('%s generates native and web output, escaped HTML and export data', (mode) => {
    const config = options(type, { mode }), data = sources(), report = generateReport(config, data);
    expect(report.title).toBeTruthy(); expect(report.description).toBe(reportCatalog.find((item) => item.value === type).source);
    expect(report.columns.length).toBeGreaterThan(0); expect(reportSummarySheetRows(report).length).toBeGreaterThan(0);
    const input = JSON.stringify({ options: config, sources: data });
    const native = JSON.parse(generateJSON(input));
    expect(native.stats).toEqual(report.stats); expect(native.title).toEqual(report.title);
    expect(native.sections.every((section) => section.rows.every((row) => row.length === section.columns.length))).toBe(true);
    expect(printableReportHtml(report)).toContain(report.title.replace(/&/g, '&amp;'));
    expect(exportJSON(input, 'csv')).toContain('Date Range');
  });
});
test('source plans avoid unrelated readings and payroll requests', async () => {
  expect(reportSourcePlan(options('vehicle')).map((source) => source.key)).toEqual(['vehicles', 'activeRoutes']);
  expect(reportSourcePlan(options('payroll')).map((source) => source.key)).toEqual(['payrollLines']);
  expect(reportSourcePlan(options('purchases')).map((source) => source.key)).toEqual(['customers', 'purchases', 'databaseItems']);
  expect(reportSourcePlan(options('job', { canViewPayrollInformation: false })).some((source) => source.key === 'payrollLines')).toBe(false);
  const read = jest.fn(async () => []); await loadReportSources(options('vehicle'), read); expect(read).toHaveBeenCalledTimes(2);
});
test('missing sources fail visibly rather than produce partial reports', async () => {
  await expect(loadReportSources(options('vehicle'), async () => { throw new Error('permission denied'); })).rejects.toThrow('Could not read vehicles: permission denied');
});
test.each([{ start: '2026-12-01', end: '2026-11-01' }, { start: '2026-02-30', end: '2026-11-01' }, { start: '', end: '2026-11-01' }])('rejects invalid dates %j', (dateRange) => {
  expect(() => validateReportOptions(options('purchases', { dateRange }))).toThrow('Choose valid dates');
});
test('payroll requires permission, while other reports describe omitted payroll', () => {
  expect(() => generateReport(options('payroll', { canViewPayrollInformation: false }), sources())).toThrow('(420)');
  expect(generateReport(options('pnl', { canViewPayrollInformation: false }), {}).warnings.join()).toContain('Margin is incomplete');
});
test('end date includes milliseconds, excludes next day and unknown dates', () => {
  const data = { purchases: [{ id: 'yes', date: '2026-11-30T23:59:59.999', totalAfterTaxCents: 100 },
    { id: 'no', date: '2026-12-01T00:00:00', totalAfterTaxCents: 200 }, { id: 'unknown', totalAfterTaxCents: 300 }] };
  expect(prepareReportContext(options('purchases'), data).purchases.map((item) => item.id)).toEqual(['yes']);
});
test('timestamp maps and date-only strings preserve the local date', () => {
  const dateValue = new Date('2026-11-30T23:59:59.999');
  expect(prepareReportContext(options('purchases'), { purchases: [{ date: { seconds: dateValue.getTime() / 1000 } }] }).purchases).toHaveLength(1);
  expect(prepareReportContext(options('purchases'), { purchases: [{ date: '2026-11-01' }] }).purchases).toHaveLength(1);
});
test('zero quantity, explicit zero totals, saved tax and negative credits are preserved', () => {
  expect(purchaseTotalCents({ totalAfterTaxCents: 0, price: 1000 })).toBe(0);
  expect(purchaseTotalCents({ quantity: 0, price: 1000 })).toBe(0);
  expect(purchaseTotalCents({ quantity: 2, price: 1000, taxAmountCents: 100 })).toBe(2100);
  expect(purchasePreTaxCents({ totalCents: -100 })).toBe(-100);
  expect(purchaseTotalCents({ totalAfterTaxCents: -108 })).toBe(-108);
});
test('returned purchases and voided payroll do not inflate costs', () => {
  const data = sources(); data.purchases.push({ ...data.purchases[0], returned: true }); data.payrollLines.push({ ...data.payrollLines[0], voidedAt: date, totalAmountCents: 99999 });
  const report = generateReport(options('job'), data);
  expect(stat(report, 'Known Costs')).toBe('$71.00'); expect(report.groups[0].rows[0].revenueCents).toBe(31000);
});
test('job costs join legacy job aliases and omit unrelated costs', () => {
  const data = sources(); data.purchases.push({ ...data.purchases[0], workOrderId: 'other' });
  expect(stat(generateReport(options('job'), data), 'Known Costs')).toBe('$71.00');
});
test('P&L avoids duplicate job labor snapshots and ignores unaccepted agreement quotes', () => {
  const data = sources(); data.serviceAgreements[0].status = 'draft';
  const report = generateReport(options('pnl'), data);
  expect(stat(report, 'Revenue')).toBe('$310.00'); expect(stat(report, 'Costs')).toBe('$71.00');
});
test('tax uses canonical invoice amounts and excludes drafts and voids', () => {
  const data = sources(); data.salesInvoices.push({ ...data.salesInvoices[0], status: 'void', taxAmountCents: 99999 });
  expect(stat(generateReport(options('tax'), data), 'Revenue Tax')).toBe('$10.00');
  expect(stat(generateReport(options('tax'), data), 'Purchase Tax')).toBe('$1.00');
});
test('route mileage supports odometer aliases, zero distance and unknown vehicles', () => {
  const data = sources(); data.activeRoutes.push({ id: 'unknown', vehicleId: 'deleted', date, distanceMiles: 0, distance: 99 });
  const report = generateReport(options('vehicle'), data);
  expect(stat(report, 'Route Miles')).toBe('25'); expect(report.groups).toHaveLength(2);
});
test('limited empty regional grants return no customer records', () => {
  const report = generateReport(options('purchases', { regionalAccessEnabled: true, userAccess: { fullCustomerRegionAccess: false, customerRegionTags: [] } }), sources());
  expect(report.groups).toHaveLength(0);
});
test('tag and region filters apply to Pipeline and every customer source', () => {
  const config = options('pipeline', { regionalAccessEnabled: true, userAccess: { fullCustomerRegionAccess: false, customerRegionTags: ['South'] } });
  expect(prepareReportContext(config, sources()).pipelineRows).toHaveLength(0);
  expect(prepareReportContext(options('pipeline'), sources()).pipelineRows).toHaveLength(1);
});
test('pipeline merges legacy before canonical and labels its current snapshot', () => {
  const data = sources(); data.legacyPipelineRows = [{ ...data.pipelineRows[0], customerName: 'Old Name' }];
  expect(prepareReportContext(options('pipeline'), data).pipelineRows[0].customerName).toBe('Sam');
  expect(generateReport(options('pipeline'), data).warnings.join()).toContain('current snapshot');
});
test('monthly agreement proration follows calendar days across DST and cancellation', () => {
  const agreement = { status: 'accepted', sourceType: 'recurringService', totalAmountCents: 30000, rateType: 'monthly', startDate: '2026-11-01' };
  expect(agreementRevenueCentsForRange(agreement, new Date('2026-11-01T00:00:00'), new Date('2026-11-30T23:59:59.999'))).toBe(30000);
  expect(agreementRevenueCentsForRange({ ...agreement, status: 'canceled', canceledAt: '2026-11-15' }, new Date('2026-11-01T00:00:00'), new Date('2026-11-30T23:59:59.999'))).toBe(15000);
});
test('missing readings remain unassessed, with canonical value aliases supported', () => {
  const data = sources(); data.stopData.push({ ...data.stopData[0], id: 'missing', readings: [] });
  const report = generateReport(options('readingPerformance'), data);
  expect(stat(report, 'Unassessed Stops')).toBe('1'); expect(stat(report, 'Successful Stops')).toBe('0'); expect(stat(report, 'Failing Readings')).toBe('1');
  data.stopData[0].readings[0].value = '7.5';
  expect(stat(generateReport(options('readingPerformance'), data), 'Success Rate')).toBe('100.0%');
});
test('completed, canceled and skipped stops are not future estimates', () => {
  const data = sources(); data.payrollLines = []; data.serviceStops = ['Finished', 'Canceled', 'Skipped'].map((status, i) => ({ ...data.serviceStops[0], id: `stop${i}`, operationStatus: status }));
  expect(stat(generateReport(options('futurePayroll'), data), 'Predicted')).toBe('$0.00');
});
test('export cautions survive CSV, Excel summary and escaped PDF output', () => {
  const report = generateReport(options('pnl', { canViewPayrollInformation: false }), {});
  expect(reportSummarySheetRows(report).flat().join()).toContain('Margin is incomplete');
  expect(printableReportHtml({ ...report, description: '<script>bad</script>' })).toContain('&lt;script&gt;bad&lt;/script&gt;');
  expect(printableReportHtml(report)).toContain('Margin is incomplete');
  expect(csvCell('=HYPERLINK("bad")')).toContain("'=HYPERLINK");
});
test('native Excel exports contain a real workbook archive', () => {
  const result = exportJSON(JSON.stringify({ options: options('purchases'), sources: sources() }), 'xlsx');
  expect(atob(result).slice(0, 2)).toBe('PK');
});


test('chemical summaries keep different units separate and match detail totals', () => {
  const data = sources(); data.stopData[0].dosages.push({ ...data.stopData[0].dosages[0], amount: 3, UOM: 'lb' });
  for (const mode of ['summary', 'detail']) {
    const report = generateReport(options('chemicals', { mode }), data);
    expect(stat(report, 'Total gal')).toBe('2 gal'); expect(stat(report, 'Total lb')).toBe('3 lb');
  }
  expect(generateReport(options('chemicals'), data).groups[0].rows.map((row) => row.unit)).toEqual(['gal', 'lb']);
});
test('job chemical invoice lines are not counted twice in P&L', () => {
  const data = sources(); data.salesInvoices[0].lineItems = [{ sourceType: 'chemical', totalAmountCents: 5000, separatelyBilled: true }];
  expect(stat(generateReport(options('pnl'), data), 'Revenue')).toBe('$610.00');
});
test('financial adjustments are called out and omitted private payroll cannot leak from cached sources', () => {
  const data = sources(); data.salesInvoices[0].amountRefundedCents = 1000;
  expect(generateReport(options('tax'), data).warnings.join()).toContain('before credits, refunds');
  expect(prepareReportContext(options('pnl', { canViewPayrollInformation: false }), data).payrollLines).toEqual([]);
});
test('future payroll uses current per-body rates and excludes work with existing earnings', () => {
  const data = sources(); data.payrollLines = [];
  data.paySettings = { taskPaySource: 'technicianRate' };
  data.companyWorkTypes = [{ id: 'route', name: 'Commercial route', defaultRateType: 'perBodyOfWater' }];
  data.technicianRates = [{ id: 'rate', companyId: 'company', technicianId: 'worker', payTypeId: 'route', payBasis: 'serviceStop', rateType: 'perBodyOfWater', amountCents: 2500, status: 'active' }];
  data.serviceStops[0] = { ...data.serviceStops[0], typeId: 'route', serviceLocationId: 'site', operationStatus: 'Scheduled' };
  data.bodiesOfWater.push({ id: 'spa', customerId: 'customer', serviceLocationId: 'site' });
  expect(stat(generateReport(options('futurePayroll'), data), 'Predicted')).toBe('$50.00');
  data.payrollLines = [{ id: 'existing', serviceStopId: 'stop', technicianId: 'worker', totalAmountCents: 4000, completedDate: date, calculationStatus: 'paid' }];
  data.payrollLines[0].completedDate = '2026-10-01';
  expect(stat(generateReport(options('futurePayroll'), data), 'Predicted')).toBe('$0.00');
});
test('individual technician exports and history notes contain only that technician', () => {
  const data = sources(); data.users.push({ id: 'other-company-worker', userId: 'other-worker', userName: 'Someone Else' });
  data.stopData.push({ ...data.stopData[0], id: 'other-stop', userId: 'other-worker', userName: 'Someone Else', customerId: 'other-customer', customerName: 'Private Customer' });
  const input = JSON.stringify({ options: options('readingPerformance'), sources: data });
  const plan = JSON.parse(performanceNoteJSON(input, 'worker'));
  expect(plan.companyUserId).toBe('company-worker'); expect(plan.html).not.toContain('Someone Else'); expect(plan.html).not.toContain('Private Customer');
  expect(exportJSON(input, 'csv', 'worker')).not.toContain('Someone Else');
  expect(plan.customerNotes.map((note) => note.customerId)).toEqual(['customer']);
});


test('missing chemical and payroll costs are flagged instead of implying complete location margins', () => {
  const data = sources(); data.purchases = []; data.databaseItems = []; data.payrollLines = [];
  const report = generateReport(options('pnlPerPool'), data);
  expect(report.warnings.join()).toContain('no usable cost');
  expect(report.warnings.join()).toContain('payroll setup or rate review');
});
