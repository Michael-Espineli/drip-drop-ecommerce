const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const server = require('./payrollCalculation');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/payroll/payCalculation.js'), 'utf8');
const browser = vm.runInNewContext(source.replaceAll('export const ', 'const ') + '\n({ calculatePayLines, reconcilePayLines, jobPayFields })');
const type = { id: 'repair', name: 'Repair', category: 'repair', defaultRateType: 'flatPerTask', defaultStackBehavior: 'stackable' };
const stop = { id: 'stop', companyId: 'company', jobId: 'job', operationStatus: 'Finished', techId: 'tech-A', payTypeId: 'repair', typeId: 'repair', serviceDate: new Date('2026-10-20'), duration: 90, estimatedMinutes: 90, serviceLocationId: 'site' };
const task = { id: 'task', jobTaskId: 'job-task', name: 'Repair', status: 'Finished', payTypeId: 'repair', actualTime: 90, estimatedTime: 90, contractedRate: 3000 };
const rate = (worker = 'tech-A', value = 5000, extra = {}) => ({ id: `rate-${worker}`, companyId: 'company', technicianId: worker, payTypeId: 'repair', rateType: 'flatPerTask', payBasis: 'serviceStopTask', amountCents: value, effectiveStartDate: new Date('2026-01-01'), status: 'active', ...extra });
const input = (extra = {}) => ({ companyId: 'company', serviceStop: stop, tasks: [task], workTypes: [type], rates: [rate(), rate('tech-B', 8000)], settings: {}, ...extra });
const sum = (lines) => lines.reduce((total, line) => total + line.totalAmountCents, 0);
const calculate = (extra) => server.calculatePayLines(input(extra));

test('browser and deployed engine have identical rules and results', () => {
  const normalized = source.replace(source.split('\n')[0], '').replaceAll('export const ', 'const ').trim();
  const deployed = fs.readFileSync(path.join(__dirname, 'payrollCalculation.js'), 'utf8');
  assert.equal(deployed.slice(deployed.indexOf('\n') + 1, deployed.lastIndexOf('\nmodule.exports')).trim(), normalized);
  for (const fixture of [input(), input({ rates: [] }), input({ serviceStop: { ...stop, techId: '' } }), input({ serviceStop: { ...stop, manualPayOverrideCents: 0 } })]) {
    const normalize = (lines) => JSON.parse(JSON.stringify(lines.map(({ calculatedAt, ...line }) => line)));
    assert.deepEqual(normalize(server.calculatePayLines(fixture)), normalize(browser.calculatePayLines(fixture)));
  }
});

test('the same repair pays once and resolves the assigned technician rate', () => {
  assert.equal(sum(calculate()), 5000);
  assert.equal(calculate().length, 1);
  assert.equal(sum(calculate({ serviceStop: { ...stop, techId: 'tech-B' } })), 8000);
  assert.equal(sum(calculate({ tasks: [{ ...task, workerId: 'tech-B' }] })), 13000);
});

test('identical linked task copies pay once in actual earnings and planning previews', () => {
  for (const mode of ['actual', 'preview']) {
    const original = { ...task, id: 'original' }, duplicate = { ...task, id: 'duplicate' };
    const a = calculate({ tasks: [original, duplicate], mode });
    const b = calculate({ tasks: [duplicate, original], mode });
    assert.equal(a.length, 1); assert.equal(sum(a), 5000);
    assert.equal(a[0].id, b[0].id, 'input ordering cannot change the selected source');
    const browserLines = browser.calculatePayLines(input({ tasks: [original, duplicate], mode }));
    assert.equal(browserLines.length, 1); assert.equal(sum(browserLines), 5000);
  }
});

test('duplicate collapse retains the recorded source and computes a percentage bonus once', () => {
  const original = { ...task, id: 'z-original' };
  const agreement = { offerId: 'offer', claimId: 'claim', workerId: 'tech-A', paySource: 'Technician Rate',
    rates: [rate()], workTypes: [type], settings: { routePaySource: 'completedTasks' },
    taskIds: ['job-task'], incentiveReady: true, incentivePaymentStopId: 'stop',
    incentive: { type: 'percentage', percentage: 10 } };
  const serviceStop = { ...stop, payrollAgreement: agreement };
  const prior = calculate({ serviceStop, tasks: [original] });
  const rows = calculate({ serviceStop, tasks: [original, { ...task, id: 'a-duplicate' }], payHistory: prior });
  assert.equal(rows.filter(row => row.payrollSource !== 'workOfferIncentive')[0].id, prior[0].id);
  assert.equal(sum(rows), 5500);
  const approved = { ...prior[0], calculationStatus: 'approved', approvedAt: new Date() };
  const result = server.reconcilePayLines({ generated: rows, existing: [approved, prior[1]] });
  assert.equal(result.writes.some(row => row.id === approved.id), false);
  assert.deepEqual(result.conflicts, []);
});

test('distinct tasks, workers and intentionally different pay calculations are not collapsed', () => {
  const settings = { routePaySource: 'completedTasks' };
  assert.equal(sum(calculate({ settings, tasks: [task, { ...task, id: 'other', jobTaskId: 'other-job-task' }] })), 10000);
  assert.equal(sum(calculate({ settings, tasks: [task, { ...task, id: 'other-worker', workerId: 'tech-B' }] })), 13000);
  const custom = value => ({ ...task, id: String(value), payrollMode: 'custom', manualPayOverrideCents: value });
  assert.equal(sum(calculate({ settings, tasks: [custom(2000), custom(3000)] })), 5000);
  const standalone = { ...task, jobTaskId: '' };
  assert.equal(sum(calculate({ settings, tasks: [standalone, { ...standalone, id: 'another-task' }] })), 10000);
});

test('custom amount replaces automatic stop/task pay and intentional zero produces no line', () => {
  assert.equal(sum(calculate({ serviceStop: { ...stop, manualPayOverrideCents: 9000 } })), 9000);
  const zero = calculate({ serviceStop: { ...stop, manualPayOverrideCents: 0 } });
  assert.deepEqual(zero, []);
  assert.equal(calculate({ serviceStop: { ...stop, manualPayOverrideCents: -1 } })[0].calculationStatus, 'needsReview');
});

test('known zero stop pay and rounded zero earnings never generate calculated lines in preview or actual mode', () => {
  const cases = [
    { serviceStop: { ...stop, payrollMode: 'custom', manualPayOverrideCents: 0 }, tasks: [] },
    { serviceStop: { ...stop, payrollMode: 'custom', manualPayOverrideCents: 0.2 }, tasks: [] },
    { rates: [rate('tech-A', 0, { payBasis: 'serviceStop', rateType: 'flatPerStop' })], tasks: [] },
    { serviceStop: { ...stop, payrollBaseAmountCents: 0 }, rates: [rate('tech-A', 1000, { payBasis: 'serviceStop', rateType: 'percentage' })], tasks: [] },
    { serviceStop: { ...stop, duration: 1, estimatedMinutes: 1 }, rates: [rate('tech-A', 1, { payBasis: 'technicianHourly', rateType: 'hourly' })], tasks: [], settings: { routePaySource: 'hourlyServiceStopDuration' } },
    { serviceStop: { ...stop, payrollAgreement: { workerId: 'tech-A', paySource: 'Unpaid', taskIds: [], rates: [], workTypes: [type] } }, tasks: [] },
  ];
  for (const mode of ['actual', 'preview']) {
    for (const extra of cases) assert.deepEqual(calculate({ ...extra, mode }), [], JSON.stringify({ mode, extra }));
  }
});

test('zero task replacements do not suppress positive stop pay, and unpaid offers can still earn an incentive', () => {
  const zeroTask = { ...task, payrollStackBehavior: 'replacesBase', payrollAgreement: {
    workerId: 'tech-A', paySource: 'Unpaid', taskIds: ['job-task'], rates: [], workTypes: [type],
  } };
  const lines = calculate({ tasks: [zeroTask] });
  assert.deepEqual(lines.map(line => [line.source, line.totalAmountCents]), [['serviceStop', 5000]]);
  const rounded = calculate({ tasks: [{ ...task, contractedRate: 1, payQuantity: 0.1, payrollStackBehavior: 'replacesBase' }],
    settings: { taskPaySource: 'taskContractedRate' } });
  assert.deepEqual(rounded.map(line => [line.source, line.totalAmountCents]), [['serviceStop', 5000]]);
  for (const hourlyOnly of [false, true]) {
    const agreement = { workerId: 'tech-A', offerId: 'offer', claimId: 'claim', paySource: 'Unpaid',
      taskIds: [], rates: [], workTypes: [type], incentive: { type: 'flat', amountCents: 1200 } };
    const earned = calculate({ tasks: [], serviceStop: { ...stop, payrollAgreement: agreement },
      settings: hourlyOnly ? { payMode: 'hourlyOnly', hourlyPaySource: 'workLogs' } : {} });
    assert.deepEqual(earned.map(line => [line.payrollSource, line.totalAmountCents]), [['workOfferIncentive', 1200]]);
  }
});

test('missing pay items, missing workers and missing rates survive as review records', () => {
  for (const extra of [{ rates: [], settings: { taskPaySource: 'technicianRate' } }, { workTypes: [] }, { serviceStop: { ...stop, techId: '' } },
    { tasks: [{ ...task, payTypeId: '' }], settings: { routePaySource: 'completedTasks' } }]) {
    const lines = calculate(extra);
    assert.ok(lines.length); assert.ok(lines.every((line) => line.calculationStatus === 'needsReview'));
  }
  assert.deepEqual(calculate({ serviceStop: { ...stop, payrollMode: 'unpaid' }, tasks: [{ ...task, payrollMode: 'included' }] }), []);
});

test('explicit zero task pay creates no line and does not displace the visit payment', () => {
  const visitType = { ...type, category: 'route', defaultRateType: 'flatPerStop' };
  for (const policy of [{ payrollMode: 'included' }, { payrollMode: 'unpaid' },
    { payrollMode: 'custom', manualPayOverrideCents: 0, payrollStackBehavior: 'stackable' }]) {
    const lines = calculate({ workTypes: [visitType], tasks: [{ ...task, ...policy }] });
    assert.equal(lines.length, 1); assert.equal(lines[0].source, 'serviceStop'); assert.equal(sum(lines), 5000);
  }
  const taskOnly = { serviceStop: { ...stop, payrollMode: 'unpaid' }, settings: { routePaySource: 'completedTasks', taskPaySource: 'taskContractedRate' } };
  assert.deepEqual(calculate({ ...taskOnly, tasks: [{ ...task, contractedRate: 0 }] }), []);
  assert.deepEqual(calculate({ ...taskOnly, tasks: [{ ...task, workerId: '', payrollMode: 'custom', manualPayOverrideCents: 0 }] }), []);
  assert.deepEqual(calculate({ settings: { routePaySource: 'completedTasks' }, rates: [rate('tech-A', 0)] }), []);
  // The old default zero budget is not an explicit override of an active rate.
  assert.equal(sum(calculate({ tasks: [{ ...task, contractedRate: 0 }], settings: { routePaySource: 'completedTasks' } })), 5000);
  assert.equal(calculate({ ...taskOnly, tasks: [{ ...task, contractedRate: undefined }] })[0].calculationStatus, 'needsReview');
  assert.equal(calculate({ rates: [], settings: { routePaySource: 'completedTasks', taskPaySource: 'technicianRate' }, tasks: [{ ...task, contractedRate: 0 }] })[0].calculationStatus, 'needsReview');
});

test('clearing only admits explicit zero tasks outside payment, statement, export, and adjustment history', () => {
  const line = { source: 'serviceStopTask', totalAmountCents: 0, calculationStatus: 'needsReview' };
  assert.equal(server.canClearZeroTask(line), true);
  assert.equal(server.canClearZeroTask({ ...line, calculationStatus: 'approved', approvedAt: new Date() }), true);
  for (const change of [{ source: 'serviceStop' }, { payrollSource: 'workOfferIncentive' }, { totalAmountCents: 100 },
    { totalAmountCents: null }, { totalAmountCents: undefined }, { totalAmountCents: 'invalid' }, { totalAmountCents: false }, { totalAmountCents: ' ' }, { paidAt: new Date() },
    { payStatementId: 'statement' }, { exportBatchId: 'export' }, { calculationStatus: 'paid' },
    { calculationStatus: 'adjusted' }, { calculationStatus: 'voided' }]) {
    assert.equal(server.canClearZeroTask({ ...line, ...change }), false, JSON.stringify(change));
  }
});

test('hourly previews and completion agree and use the correct time source', () => {
  const extra = { tasks: [], rates: [rate('tech-A', 3000, { payBasis: 'technicianHourly', rateType: 'hourly' })], settings: { routePaySource: 'hourlyServiceStopDuration', taskPaySource: 'none' } };
  assert.equal(sum(calculate(extra)), 4500);
  assert.equal(sum(calculate({ ...extra, mode: 'preview' })), 4500);
  assert.equal(calculate({ ...extra, serviceStop: { ...stop, duration: 0 } })[0].calculationStatus, 'needsReview');
});

test('pay quantity, body count and explicit percentage base are calculated without guessing', () => {
  assert.equal(sum(calculate({ tasks: [{ ...task, payQuantity: 3 }], settings: { routePaySource: 'completedTasks' } })), 15000);
  const body = { tasks: [], rates: [rate('tech-A', 2000, { rateType: 'perBodyOfWater', payBasis: 'serviceStop' })] };
  assert.equal(sum(calculate({ ...body, serviceStop: { ...stop, bodyOfWaterIds: ['pool', 'spa', 'fountain'] } })), 6000);
  assert.equal(calculate(body)[0].calculationStatus, 'needsReview');
  const percent = { tasks: [], rates: [rate('tech-A', 1000, { rateType: 'percentage', payBasis: 'serviceStop' })] };
  assert.equal(calculate(percent)[0].calculationStatus, 'needsReview');
  assert.equal(sum(calculate({ ...percent, serviceStop: { ...stop, payrollBaseAmountCents: 20000 } })), 2000);
});

test('explicit stacking, exclusive and replacement rules control additional work', () => {
  assert.equal(sum(calculate({ tasks: [{ ...task, payrollStackBehavior: 'stackable' }] })), 10000);
  const two = [{ ...task, id: 'one', payTypeId: 'repair' }, { ...task, id: 'two', payTypeId: 'extra' }];
  const extraType = { ...type, id: 'extra', defaultStackBehavior: 'replacesBase' };
  const rates = [rate(), rate('tech-A', 3000, { id: 'extra-rate', payTypeId: 'extra' })];
  assert.equal(sum(calculate({ tasks: two, workTypes: [type, extraType], rates })), 8000);
  assert.equal(sum(calculate({ tasks: two, workTypes: [{ ...type, defaultStackBehavior: 'exclusive' }, extraType], rates })), 5000);
});

test('browser and server multiply the resolved location BOWs, preserving explicit scope first', () => {
  const fixture = input({ tasks: [], rates: [rate('tech-A', 2000, { rateType: 'perBodyOfWater', payBasis: 'serviceStop' })],
    bodyOfWaterIdsByServiceLocation: { site: ['pool', 'spa', 'pool'] } });
  for (const engine of [server, browser]) for (const mode of ['actual', 'preview']) {
    const lines = engine.calculatePayLines({ ...fixture, mode });
    assert.equal(lines.length, 1); assert.equal(lines[0].quantity, 2);
    assert.equal(lines[0].quantityUnit, 'bodyOfWater'); assert.equal(sum(lines), 4000);
    for (const scope of [{ bodyOfWaterCount: 3 }, { bodyOfWaterIds: ['pool', 'spa', 'fountain'] }]) {
      assert.equal(sum(engine.calculatePayLines({ ...fixture, mode, serviceStop: { ...stop, ...scope } })), 6000);
    }
    assert.equal(sum(engine.calculatePayLines({ ...fixture, mode, serviceStop: { ...stop, bodyOfWaterId: 'pool' } })), 2000);
    for (const scope of [{ bodyOfWaterCount: 0 }, { bodyOfWaterCount: 1.5 }, { bodyOfWaterCount: 'bad' }]) {
      assert.equal(engine.calculatePayLines({ ...fixture, mode, serviceStop: { ...stop, ...scope } })[0].calculationStatus, 'needsReview');
    }
  }
});

test('a single-body task never inherits its visit count or its other body IDs', () => {
  const fixture = input({ serviceStop: { ...stop, bodyOfWaterCount: 4, bodyOfWaterIds: ['one', 'two', 'three', 'four'] },
    settings: { routePaySource: 'completedTasks' }, rates: [rate('tech-A', 2000, { rateType: 'perBodyOfWater' })],
    bodyOfWaterIdsByServiceLocation: { site: ['one', 'two', 'three', 'four'], other: ['pond', 'fountain'] } });
  for (const engine of [server, browser]) {
    for (const scope of [{ bodyOfWaterId: 'one' }, { bodyOfWaterIds: ['one'] }, { bodyOfWaterCount: 1 }]) {
      const lines = engine.calculatePayLines({ ...fixture, tasks: [{ ...task, ...scope }] });
      assert.equal(lines[0].quantity, 1); assert.equal(sum(lines), 2000);
    }
    const otherSite = engine.calculatePayLines({ ...fixture, tasks: [{ ...task, serviceLocationId: 'other' }] });
    assert.equal(otherSite[0].quantity, 2); assert.equal(sum(otherSite), 4000);
    assert.equal(sum(engine.calculatePayLines({ ...fixture, tasks: [task] })), 8000);
  }
});

test('empty resolved locations remain reviewable and legacy BOW links count distinctly', () => {
  const fixture = input({ tasks: [], rates: [rate('tech-A', 2000, { rateType: 'perBodyOfWater', payBasis: 'serviceStop' })] });
  for (const engine of [server, browser]) {
    assert.equal(engine.calculatePayLines({ ...fixture, bodyOfWaterIdsByServiceLocation: { site: [] } })[0].calculationStatus, 'needsReview');
    const legacy = engine.calculatePayLines({ ...fixture, tasks: [
      { ...task, id: 'one', payrollMode: 'included', bodyOfWaterId: 'pool' },
      { ...task, id: 'two', payrollMode: 'included', bodyOfWaterId: 'pool' },
      { ...task, id: 'three', payrollMode: 'included', bodyOfWaterIds: ['spa'] },
    ] });
    assert.equal(legacy[0].quantity, 2); assert.equal(sum(legacy), 4000);
  }
});

test('per-location task scope and native endTime completion dates are respected', () => {
  const ended = new Date('2026-10-22T20:00:00Z');
  const fixture = input({ serviceStop: { ...stop, serviceLocationCount: 3, endTime: ended }, tasks: [],
    rates: [rate('tech-A', 2000, { rateType: 'perServiceLocation', payBasis: 'serviceStop' })] });
  for (const engine of [server, browser]) {
    const visit = engine.calculatePayLines(fixture)[0];
    assert.equal(visit.totalAmountCents, 6000); assert.equal(visit.completedDate.getTime(), ended.getTime());
    const taskLine = engine.calculatePayLines({ ...fixture, settings: { routePaySource: 'completedTasks' },
      rates: [rate('tech-A', 2000, { rateType: 'perServiceLocation' })], tasks: [{ ...task, serviceLocationId: 'site' }] })[0];
    assert.equal(taskLine.quantity, 1); assert.equal(taskLine.totalAmountCents, 2000);
  }
});

test('completed job tasks earn pay without a stop; scheduled partial tasks do not require closing the visit', () => {
  const direct = calculate({ jobTaskSource: true, serviceStop: { ...stop, id: 'job_job', techId: '' }, tasks: [{ ...task, workerId: 'tech-A' }] });
  assert.equal(sum(direct), 5000); assert.equal(direct[0].serviceStopId, null); assert.equal(direct[0].payrollSource, 'jobTask');
  assert.equal(sum(calculate({ serviceStop: { ...stop, operationStatus: 'In Progress' } })), 5000);
  assert.deepEqual(calculate({ serviceStop: { ...stop, operationStatus: 'In Progress' }, tasks: [{ ...task, status: 'Draft' }] }), []);
});

test('payroll switches and explicit unpaid work suppress earnings', () => {
  assert.deepEqual(calculate({ settings: { payrollEnabled: false } }), []);
  assert.deepEqual(calculate({ settings: { payMode: 'hourlyOnly', hourlyPaySource: 'activeRouteLogs' } }), []);
});

test('service inheritance preserves explicit task rules and never picks an unrelated pay item', () => {
  assert.equal(server.jobPayFields({}, { sourceType: 'serviceStopType', sourceId: 'repair', name: 'Repair' }).payTypeId, 'repair');
  assert.equal(server.jobPayFields({ payTypeId: 'extra', manualPayOverrideCents: 0 }, { payTypeId: 'repair' }).payTypeId, 'extra');
  assert.equal(server.jobPayFields({ manualPayOverrideCents: 0 }).manualPayOverrideCents, 0);
  assert.equal(server.jobPayFields({}).payTypeId, '');
});

test('reassignment supersedes the old unapproved row and repeated regeneration is idempotent', () => {
  const existing = calculate(); const generated = calculate({ serviceStop: { ...stop, techId: 'tech-B' } });
  const first = server.reconcilePayLines({ generated, existing });
  assert.equal(first.writes.filter((line) => line.calculationStatus === 'voided').length, 1);
  const stored = new Map(existing.map((line) => [line.id, line])); first.writes.forEach((line) => stored.set(line.id, line));
  const second = server.reconcilePayLines({ generated, existing: [...stored.values()] });
  second.writes.forEach((line) => stored.set(line.id, line));
  assert.equal(sum([...stored.values()].filter((line) => line.calculationStatus !== 'voided')), 8000);
});

test('approved, paid and statement-linked pay stays locked and conflicting replacements require adjustment', () => {
  for (const lock of [{ calculationStatus: 'approved' }, { calculationStatus: 'paid' }, { payStatementId: 'statement' }, { calculationStatus: 'adjusted' }]) {
    const old = { ...calculate()[0], ...lock };
    const result = server.reconcilePayLines({ generated: calculate({ serviceStop: { ...stop, techId: 'tech-B' } }), existing: [old] });
    assert.equal(result.writes.length, 0); assert.deepEqual(result.conflicts, [old.id]);
  }
});


test('a locked visit payment does not hide another technician performing a matching task', () => {
  const type = { id: 'route', name: 'Route', category: 'route' };
  const rates = ['tech-A','tech-B'].map((technicianId) => ({ id: technicianId, technicianId, payTypeId: 'route', payBasis: 'serviceStop', rateType: 'flatPerStop', amountCents: 5000 }));
  rates.push({ id: 'b-task', technicianId: 'tech-B', payTypeId: 'route', payBasis: 'serviceStopTask', rateType: 'flatPerTask', amountCents: 2000 });
  const initial = calculate({ workTypes: [type], rates, serviceStop: { ...stop, payTypeId: 'route' }, tasks: [] });
  const generated = calculate({ workTypes: [type], rates, serviceStop: { ...stop, payTypeId: 'route' }, tasks: [{ ...task, payTypeId: 'route', workerId: 'tech-B' }] });
  const result = server.reconcilePayLines({ generated, existing: [{ ...initial[0], calculationStatus: 'approved' }] });
  assert.equal(result.writes.length, 1); assert.equal(result.writes[0].technicianId, 'tech-B'); assert.equal(result.writes[0].totalAmountCents, 2000);
});


test('an hourly service pay item uses the technician hourly rate for its linked tasks', () => {
  const output = calculate({ mode: 'preview', jobTaskSource: true, workTypes: [{ ...type, defaultRateType: 'hourly' }], rates: [{ technicianId: 'tech-A', payBasis: 'technicianHourly', rateType: 'hourly', amountCents: 3000 }], tasks: [{ ...task, workerId: 'tech-A', estimatedTime: 90 }] });
  assert.equal(sum(output), 4500); assert.equal(output[0].calculationStatus, 'calculated');
});

test('restoring automatic pay ignores a leftover legacy override amount', () => {
  assert.equal(sum(calculate({ serviceStop: { ...stop, payrollMode: 'automatic', manualPayOverrideCents: 99999 } })), 5000);
  assert.equal(sum(calculate({ tasks: [{ ...task, payrollMode: 'automatic', manualPayOverrideCents: 99999 }] })), 5000);
});


test('a custom visit payment includes its technician work and preserves another technician earnings', () => {
  const output = calculate({ serviceStop: { ...stop, manualPayOverrideCents: 9000 }, tasks: [task, { ...task, id: 'other', jobTaskId: 'other', workerId: 'tech-B' }] });
  assert.deepEqual(output.map((line) => [line.technicianId, line.totalAmountCents]).sort(), [['tech-A', 9000], ['tech-B', 8000]]);
  const locked = { ...output[0], calculationStatus: 'approved' };
  const reconciled = server.reconcilePayLines({ generated: output, existing: [locked] });
  assert.equal(reconciled.writes.length, 1); assert.equal(reconciled.writes[0].technicianId, 'tech-B');
});

test('stop pay prefers its own rate and additional task pay remains a separate component', () => {
  const rates = [rate('tech-A', 5000, { id: 'stop-rate', payBasis: 'serviceStop', rateType: 'flatPerStop' }), rate('tech-A', 1500)];
  const ordinary = { ...task, payTypeId: '', contractedRate: 0, payrollMode: 'included' };
  const extra = { ...task, id: 'extra', jobTaskId: 'extra', contractedRate: 0, payrollStackBehavior: 'stackable' };
  const base = calculate({ rates, tasks: [ordinary] });
  assert.deepEqual(base.map(line => [line.source, line.totalAmountCents]), [['serviceStop', 5000]]);
  const lines = calculate({ rates, tasks: [ordinary, extra] });
  assert.deepEqual(lines.map(line => [line.source, line.totalAmountCents]), [['serviceStop', 5000], ['serviceStopTask', 1500]]);
  for (const manualPayOverrideCents of [0, 1200]) {
    const custom = { ...extra, payrollMode: 'custom', manualPayOverrideCents };
    assert.equal(sum(calculate({ rates, tasks: [ordinary, custom] })), 5000 + manualPayOverrideCents);
    assert.equal(sum(calculate({ rates, serviceStop: { ...stop, payrollMode: 'custom', manualPayOverrideCents: 5000 }, tasks: [ordinary, custom] })), 5000 + manualPayOverrideCents);
  }
  assert.equal(sum(calculate({ rates, serviceStop: { ...stop, payrollStackBehavior: 'exclusive' }, tasks: [ordinary, extra] })), 6500);
  const approvedBase = { ...base[0], calculationStatus: 'approved' };
  const added = server.reconcilePayLines({ generated: lines, existing: [approvedBase] });
  assert.deepEqual(added.conflicts, []);
  assert.deepEqual(added.writes.map(line => line.totalAmountCents), [1500]);
  const removed = server.reconcilePayLines({ generated: base, existing: [approvedBase, ...added.writes] });
  assert.deepEqual(removed.conflicts, []);
  assert.deepEqual(removed.writes.map(line => line.calculationStatus), ['voided']);
});
