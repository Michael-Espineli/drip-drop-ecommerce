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

test('custom amount replaces automatic stop/task pay, including an intentional zero', () => {
  assert.equal(sum(calculate({ serviceStop: { ...stop, manualPayOverrideCents: 9000 } })), 9000);
  const zero = calculate({ serviceStop: { ...stop, manualPayOverrideCents: 0 } });
  assert.equal(zero.length, 1); assert.equal(zero[0].totalAmountCents, 0); assert.equal(zero[0].payrollMode, 'custom');
  assert.equal(calculate({ serviceStop: { ...stop, manualPayOverrideCents: -1 } })[0].calculationStatus, 'needsReview');
});

test('missing pay items, missing workers and missing rates survive as review records', () => {
  for (const extra of [{ rates: [], settings: { taskPaySource: 'technicianRate' } }, { workTypes: [] }, { serviceStop: { ...stop, techId: '' } },
    { tasks: [{ ...task, payTypeId: '' }], settings: { routePaySource: 'completedTasks' } }]) {
    const lines = calculate(extra);
    assert.ok(lines.length); assert.ok(lines.every((line) => line.calculationStatus === 'needsReview'));
  }
  assert.deepEqual(calculate({ serviceStop: { ...stop, payrollMode: 'unpaid' }, tasks: [{ ...task, payrollMode: 'included' }] }), []);
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
