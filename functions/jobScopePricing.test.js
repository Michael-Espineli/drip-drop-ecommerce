const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const server = require('./jobScopePricing');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/utils/jobScopePricing.js'), 'utf8').replaceAll('export const ', 'const ');
const browser = vm.runInNewContext(`${source}\n({ completeJobLaborLines, jobLaborTotals })`);

test('server and browser use the same pricing rules for extra work, zero prices, and scope coverage', () => {
  const scope = { laborLineItems: [{ id: 'line', totalPriceCents: 10000, internalCostCents: 1000, taskIds: ['included'], taxable: true }],
    tasks: [{ id: 'included', contractedRate: 4000 }, { id: 'extra', billingLaborPriceCents: 5000, contractedRate: 2000 }, { id: 'free', billingLaborPriceCents: 0, contractedRate: 1000 }],
    plannedServiceStops: [] };
  for (const fixture of [scope, { ...scope, laborLineItems: [] }, { ...scope, laborLineItems: [{ ...scope.laborLineItems[0], plannedServiceStopIds: ['visit'] }], plannedServiceStops: [{ id: 'visit', taskIds: ['extra'], plannedLaborCostCents: 2000 }] }]) {
    assert.deepEqual(server.jobLaborTotals(fixture), JSON.parse(JSON.stringify(browser.jobLaborTotals(fixture))));
    assert.deepEqual(server.completeJobLaborLines(fixture), JSON.parse(JSON.stringify(browser.completeJobLaborLines(fixture))));
  }
  assert.equal(server.jobLaborTotals(scope).priceCents, 15000);
});
