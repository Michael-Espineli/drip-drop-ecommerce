// The hosts supply authenticated Firestore reads. This module never writes data.
import * as engine from './reportEngine';
import { reportCatalog, payrollOnlyReportTypes } from './reportCatalog';
import { customerHasAnyTag, filterCustomersByRegionalAccess, filterRecordsByCustomerTags, getEffectiveCustomerRegionAccess } from '../customerTags';

export const reportBuilders = {
  funReadingsDosages: engine.buildFunReadingsDosagesReport, readings: engine.buildReadingReport,
  readingHealth: engine.buildReadingHealthReport, readingPerformance: engine.buildReadingPerformanceReport,
  chemicals: engine.buildChemicalReport, purchases: engine.buildPurchaseReport, waste: engine.buildWasteReport,
  payroll: engine.buildPayrollReport, futurePayroll: engine.buildFuturePayrollReport, users: engine.buildUsersReport,
  pipeline: engine.buildCustomerPipelineReport, pnlPerPool: engine.buildPnlPerPoolReport,
  pnl: engine.buildPnlReport, job: engine.buildJobReport, vehicle: engine.buildVehicleReport, tax: engine.buildTaxReport,
};
export const validateReportOptions = (options) => {
  if (!reportBuilders[options.reportType]) throw new Error('Select a supported report.');
  const { start, end } = options.dateRange || {};
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && engine.dateFromValue(value) && engine.dateFromValue(value).getDate() === Number(value.slice(-2));
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Choose valid dates with the start on or before the end.');
  if (!options.companyId || String(options.companyId).includes('/')) throw new Error('Please select a company.');
  if (payrollOnlyReportTypes.has(options.reportType) && !options.canViewPayrollInformation) throw new Error('Payroll reports require payroll information permission (420).');
};
export const reportSourcePlan = (options) => {
  validateReportOptions(options);
  const { companyId, reportType: type, canViewPayrollInformation: payroll } = options;
  const plan = [];
  const has = (...types) => types.includes(type);
  const add = (key, path, kind = 'collection', companyFilter = false, dateFilter = false) => plan.push({ key, path, kind, companyFilter, dateFilter });
  const company = (key, path = key) => add(key, `companies/${companyId}/${path}`);
  const readings = has('funReadingsDosages', 'readings', 'readingHealth', 'readingPerformance');
  const chemicals = has('funReadingsDosages', 'readings', 'chemicals', 'waste', 'pnlPerPool');
  if (readings || chemicals) add('stopData', `companies/${companyId}/stopData`, 'collection', false, true);
  if (readings) company('readingTemplates', 'settings/readings/readings');
  if (chemicals) company('dosageTemplates', 'settings/dosages/dosages');
  const access = getEffectiveCustomerRegionAccess({ userAccess: options.userAccess, role: options.role });
  const filtered = (options.selectedCustomerTags || []).length || (options.regionalAccessEnabled && (!access.fullAccess || options.selectedRegionTag));
  if (!has('vehicle', 'payroll') || filtered) company('customers');
  if (has('purchases', 'waste', 'pnl', 'job', 'tax', 'users', 'pnlPerPool')) {
    company('purchases', 'purchasedItems'); company('databaseItems', 'settings/dataBase/dataBase');
  }
  if (has('pnl', 'job', 'users')) company('jobs', 'workOrders');
  if (payroll && has('payroll', 'futurePayroll', 'pnl', 'job', 'users', 'pnlPerPool')) company('payrollLines', 'technicianPayLineItems');
  if (has('users', 'readingPerformance', 'futurePayroll', 'pnlPerPool')) company('serviceStops');
  if (has('readingPerformance', 'pnlPerPool')) company('recurringServiceStops', 'recurringServiceStop');
  if (has('pnl', 'pnlPerPool')) add('serviceAgreements', 'salesAgreements', 'collection', true);
  if (has('pnl', 'job', 'tax')) add('salesInvoices', 'salesInvoices', 'collection', true);
  if (has('pnlPerPool')) company('serviceLocations');
  if (has('users', 'readingPerformance') || (payroll && has('futurePayroll', 'pnlPerPool'))) company('users', 'companyUsers');
  if (has('vehicle')) { company('vehicles', 'vehicals'); company('activeRoutes'); }
  if (has('readingHealth', 'readingPerformance', 'pnlPerPool', 'futurePayroll')) company('bodiesOfWater');
  if (payroll && has('futurePayroll', 'pnlPerPool')) {
    add('paySettings', `companies/${companyId}/paySettings/main`, 'document');
    company('companyWorkTypes', 'companyPayTypes'); company('technicianRates');
  }
  if (has('pipeline')) {
    company('pipelineRows', 'customerPipeline');
    if (options.includeLegacyPipeline) company('legacyPipelineRows', 'customerMigrationTracker');
    company('pipelineItems', 'settings/customerPipeline/items');
  }
  return plan;
};
const isReturned = (item) => item.returned === true || String(item.returned).toLowerCase() === 'true' || engine.reportStatusKey(item.status) === 'returned';
const jobId = (record) => record.jobId || record.workOrderId || record.assignedJobId || '';
export const prepareReportContext = (options, sources = {}) => {
  validateReportOptions(options);
  const startDate = new Date(`${options.dateRange.start}T00:00:00`), endDate = new Date(`${options.dateRange.end}T23:59:59.999`);
  const access = getEffectiveCustomerRegionAccess({ userAccess: options.userAccess, role: options.role });
  const emptyGrant = options.regionalAccessEnabled && !access.fullAccess && !access.tags.length;
  const visibleCustomers = emptyGrant ? [] : filterCustomersByRegionalAccess(sources.customers || [], options);
  const customers = visibleCustomers.filter((customer) => customerHasAnyTag(customer, options.selectedCustomerTags));
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const filter = (records = []) => emptyGrant ? [] : filterRecordsByCustomerTags({ ...options, customersById, selectedTags: options.selectedCustomerTags, records });
  const range = (records, fields) => (records || []).filter((record) => engine.inRange(record, startDate, endDate, fields));
  const allInvoices = filter(sources.salesInvoices);
  const jobs = filter(range(sources.jobs, ['invoiceDate', 'dateCreated', 'createdAt', 'completedAt'])).map((job) => {
    const invoices = allInvoices.filter((invoice) => jobId(invoice) === job.id || invoice.id === job.salesInvoiceId);
    return invoices.length ? { ...job, reportRevenueCents: invoices.filter(engine.invoiceRevenueStatusCounts).reduce((total, invoice) => total + engine.cents(invoice.totalAmountCents ?? invoice.totalCents), 0) } : job;
  });
  const pipeline = new Map((sources.legacyPipelineRows || []).map((record) => [record.id, record]));
  (sources.pipelineRows || []).forEach((record) => pipeline.set(record.id, record));
  const pipelineRows = filter([...pipeline.values()].map((record) => ({ ...record, customerId: record.customerId || record.companyCustomerId || '' })));
  const context = {
    ...options, dateRangeStart: startDate, dateRangeEnd: endDate, customersById,
    stopData: filter(range(sources.stopData, ['date'])), readingTemplates: sources.readingTemplates || [], dosageTemplates: sources.dosageTemplates || [],
    purchases: filter(range(sources.purchases, ['date', 'createdAt', 'dateCreated'])).filter((item) => !isReturned(item)),
    databaseItemById: new Map((sources.databaseItems || []).map((item) => [item.id, item])), jobs,
    allPayrollLines: options.canViewPayrollInformation ? filter(sources.payrollLines).filter((line) => !engine.isPayrollLineVoided(line)) : [],
    payrollLines: options.canViewPayrollInformation ? filter(range(sources.payrollLines, ['completedDate', 'workDate', 'serviceDate', 'createdAt', 'paidAt'])).filter((line) => !engine.isPayrollLineVoided(line)) : [],
    serviceStops: filter(options.reportType === 'readingPerformance' ? sources.serviceStops : range(sources.serviceStops, ['serviceDate', 'date', 'createdAt'])),
    recurringServiceStops: filter(sources.recurringServiceStops), serviceAgreements: filter(sources.serviceAgreements),
    salesInvoices: range(allInvoices, ['invoiceDate', 'issuedAt', 'sentAt', 'createdAt', 'date']),
    serviceLocations: filter(sources.serviceLocations), bodiesOfWater: filter(sources.bodiesOfWater),
    users: sources.users || [], companyUsers: sources.users || [],
    paySettings: sources.paySettings || null, companyServiceStopTypes: sources.companyWorkTypes || [],
    companyWorkTypes: sources.companyWorkTypes || [], workTypeMappings: [], technicianRates: sources.technicianRates || [],
    serviceStopTasksById: new Map(Object.entries(sources.serviceStopTasksById || {})),
    pipelineRows, pipelineItems: sources.pipelineItems || [], vehicles: sources.vehicles || [],
    activeRoutes: range(sources.activeRoutes, ['date', 'routeDate', 'startTime', 'createdAt']),
    mode: options.mode === 'detail' ? 'detail' : 'summary', groupBy: options.groupBy || 'company',
  };
  if (options.reportType === 'pnl') context.jobs = context.jobs.filter((job) => !['draft', 'estimate', 'estimatepending', 'rejected', 'canceled', 'cancelled', 'void'].includes(engine.reportStatusKey(job.billingStatus)));
  return context;
};
export const generateReport = (options, sources) => {
  const context = prepareReportContext(options, sources);
  if (options.reportType === 'readingHealth' && (!context.readingTemplates.some((template) => engine.readingTemplateKey(template) === options.readingHealthFilters?.templateId) ||
      !Number.isFinite(engine.parseReadingNumber(options.readingHealthFilters?.threshold)))) throw new Error('Select a reading and enter a numeric threshold.');
  if (options.reportType === 'readingPerformance' && !engine.activeReadingPerformanceStandards(options.readingPerformanceStandards, context.readingTemplates).length) throw new Error('Add at least one good standing standard.');
  const report = reportBuilders[options.reportType](context), warnings = [...(report.warnings || [])];
  if (context.payrollLines.some((line) => engine.reportStatusKey(line.calculationStatus) === 'needsreview') || report.stats?.some((stat) => stat.label === 'Needs Review' && Number(stat.value) > 0)) warnings.push('Some payroll amounts need review. Missing rates or setup can leave the recorded totals incomplete.');
  if (['futurePayroll', 'pnlPerPool'].includes(options.reportType) && (context.paySettings?.payrollEnabled === false || context.paySettings?.companyPayrollEnabled === false || context.paySettings?.payrollDisabled === true)) warnings.push('Company payroll estimates are disabled. Existing earned payroll remains in the report.');
  if (!options.canViewPayrollInformation && ['users', 'job', 'pnl', 'pnlPerPool'].includes(options.reportType)) warnings.push('Payroll costs are omitted because payroll information permission (420) is required. Margin is incomplete.');
  if (options.reportType === 'pipeline') warnings.push('Pipeline shows the current snapshot. Selected dates do not filter historical stage changes.');
  if (['purchases', 'tax', 'pnl', 'job', 'users', 'pnlPerPool', 'waste'].includes(options.reportType) && context.purchases.some((item) =>
    [item.totalAfterTaxCents, item.totalAmountCents, item.costAfterTax, item.taxAmountCents, item.taxCents, item.tax].every((value) => value === undefined || value === null || value === ''))) warnings.push('Some purchases have no recorded tax or total. Their totals use the legacy 8.5% tax estimate.');
  if (['pnl', 'job', 'tax'].includes(options.reportType) && context.salesInvoices.some((invoice) =>
    ['creditAmountCents', 'stripeCreditAmountCents', 'refundCreditCents', 'disputeCreditCents', 'writeOffAmountCents', 'amountRefundedCents', 'amountReversedCents'].some((key) => Number(invoice[key]) > 0))) warnings.push('Invoice amounts are issued totals before credits, refunds, reversals and write-offs. Review these adjustments separately; this report does not reconcile cash receipts.');
  const groups = (report.groups || []).map((group) => ({ ...group, metrics: Object.fromEntries(Object.entries(group.metrics || {}).map(([key, value]) => {
    const label = key.replace(/Cents$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
    const formatted = typeof value === 'number' ? (/Cents$/.test(key) || key === 'spend' ? engine.moneyFromCents(value) : value.toLocaleString()) : value;
    return [label, formatted];
  })) }));
  return { ...report, groups, reportType: options.reportType, mode: context.mode,
    description: reportCatalog.find((item) => item.value === options.reportType)?.source, warnings,
    performanceView: options.reportType === 'readingPerformance' ? options.readingPerformanceView : report.performanceView,
    stats: [...(report.stats || []), { label: 'Date Range', value: engine.displayDateRange(options.dateRange) },
      { label: 'Customer Tags', value: options.selectedCustomerTags?.join(', ') || options.selectedRegionTag || 'All permitted customers' }],
  };
};
export const reportTaskStops = (options, sources) => {
  if (!options.canViewPayrollInformation || !['futurePayroll', 'pnlPerPool'].includes(options.reportType)) return [];
  const context = prepareReportContext(options, sources);
  const id = (value) => typeof value === 'object' ? value?.id || value?.serviceStopId || '' : String(value || '');
  const paidStops = new Set(context.allPayrollLines.map((line) => id(line.serviceStopId || line.serviceStopID || line.stopId)).filter(Boolean));
  return context.serviceStops.filter((stop) => {
    if (!stop.id || paidStops.has(stop.id)) return false;
    const status = engine.reportStatusKey(stop.operationStatus || stop.status);
    if (['skipped', 'canceled', 'cancelled'].includes(status)) return false;
    return options.reportType !== 'futurePayroll' || !(stop.completed === true || stop.isFinished === true || stop.endTime || stop.completedAt || stop.finishedAt || ['finished', 'complete', 'completed'].includes(status));
  });
};

export const loadReportSources = async (options, readSource) => {
  const entries = await Promise.all(reportSourcePlan(options).map(async (source) => {
    try { return [source.key, await readSource(source)]; }
    catch (error) { error.message = `Could not read ${source.key}: ${error.message}`; throw error; }
  }));
  const sources = Object.fromEntries(entries);
  if (options.canViewPayrollInformation && ['futurePayroll', 'pnlPerPool'].includes(options.reportType)) {
    const stops = reportTaskStops(options, sources);
    sources.serviceStopTasksById = {};
    for (let index = 0; index < stops.length; index += 12) {
      await Promise.all(stops.slice(index, index + 12).map(async (stop) => {
        if (stop.id) sources.serviceStopTasksById[stop.id] = await readSource({ key: 'tasks', path: `companies/${options.companyId}/serviceStops/${stop.id}/tasks`, kind: 'collection' });
      }));
    }
  }
  return sources;
};
