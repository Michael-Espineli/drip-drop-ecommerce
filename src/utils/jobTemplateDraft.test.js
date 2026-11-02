import { addServiceToTemplateDraft, emptyJobTemplateScope, newTemplateVisit, prepareJobTemplateScope, removeTemplateDraftItem } from './jobTemplateDraft';
import { jobLaborTotals } from './jobScopePricing';
import { canUseJobTemplate } from './jobTemplateAvailability';

const product = { id: 'product-row', genericItemId: 'sell-pump', dbItemId: 'supplier-pump', name: 'Pump', sellPrice: 30000, rate: 18000 };
const service = { id: 'install', name: 'Install pump', type: 'service', unitAmountCents: 10000, unitCostCents: 2000, taxable: false, metadata: { taskTemplates: [
  { id: 'install-task', name: 'Install', type: 'Install', genericItemId: 'sell-pump', productQuantity: 1, payTypeId: 'install-pay', payrollMode: 'custom', manualPayOverrideCents: 0 },
] } };

test('a new template stages a service, its tasks, and canonical product links without customer context', () => {
  const scope = addServiceToTemplateDraft(emptyJobTemplateScope(), service, [product]);
  const ready = prepareJobTemplateScope({ ...scope, plannedServiceStops: [{ ...newTemplateVisit(), name: 'Installation visit', taskTemplateIds: [scope.tasks[0].id] }] }, 'company', 'template');
  expect(ready.laborLineItems[0]).toEqual(expect.objectContaining({ taskTemplateIds: [ready.tasks[0].id], totalPriceCents: 10000, taxable: false, templateId: 'template' }));
  expect(ready.tasks[0]).toEqual(expect.objectContaining({ genericItemId: 'sell-pump', shoppingListItemIds: [ready.shoppingItems[0].id], manualPayOverrideCents: 0 }));
  expect(ready.shoppingItems[0]).toEqual(expect.objectContaining({ genericItemId: 'sell-pump', dbItemId: 'supplier-pump', linkedTaskIds: [ready.tasks[0].id], plannedTotalPriceCents: 30000 }));
  expect(ready.tasks[0].equipmentId).toBeUndefined();
  expect(jobLaborTotals(ready).priceCents).toBe(10000);
});
test('repeated service additions have independent scope IDs and reuse the physical product', () => {
  const first = addServiceToTemplateDraft(emptyJobTemplateScope(), service, [product]);
  const second = addServiceToTemplateDraft(first, service, [product]);
  expect(new Set(second.tasks.map((task) => task.id)).size).toBe(2);
  expect(second.shoppingItems).toHaveLength(1);
  expect(second.shoppingItems[0].linkedTaskIds).toEqual(second.tasks.map((task) => task.id));
  expect(first.shoppingItems[0].linkedTaskIds).toHaveLength(1);
});
test('new template service lines retain the technician pay type and budget for their default quantity', () => {
  const scope = addServiceToTemplateDraft(emptyJobTemplateScope(), { ...service, defaultQuantity: 2, payTypeId: 'service-pay',
    metadata: { taskTemplates: [{ name: 'Custom cleaning', payrollMode: 'custom', manualPayOverrideCents: 1500, estimatedMinutes: 30 }] },
  });
  expect(scope.laborLineItems[0]).toEqual(expect.objectContaining({ payTypeId: 'service-pay', quantity: 2, internalCostCents: 4000 }));
  expect(scope.tasks[0]).toEqual(expect.objectContaining({ manualPayOverrideCents: 3000, payQuantity: 2, estimatedTime: 60 }));
});
test('removing a staged task cleans the service, visit, and product links', () => {
  const scope = addServiceToTemplateDraft(emptyJobTemplateScope(), service, [product]);
  scope.plannedServiceStops = [{ ...newTemplateVisit(), name: 'Visit', taskTemplateIds: [scope.tasks[0].id] }];
  const result = removeTemplateDraftItem(scope, 'tasks', scope.tasks[0].id);
  expect(result.tasks).toHaveLength(0);
  expect(result.laborLineItems[0].taskIds).toEqual([]);
  expect(result.plannedServiceStops[0].taskTemplateIds).toEqual([]);
  expect(result.shoppingItems[0].linkedTaskIds).toEqual([]);
});
test('unavailable product requirements and invalid draft values fail before save', () => {
  expect(() => addServiceToTemplateDraft(emptyJobTemplateScope(), service)).toThrow('product required');
  const scope = addServiceToTemplateDraft(emptyJobTemplateScope(), service, [product]);
  scope.shoppingItems[0].quantity = '0';
  expect(() => prepareJobTemplateScope(scope, 'company', 'template')).toThrow('valid quantities');
  scope.shoppingItems[0].quantity = '1';
  scope.tasks[0].name = ' ';
  expect(() => prepareJobTemplateScope(scope, 'company', 'template')).toThrow('name');
});
test('managers can use active office templates while technician creation requires availability', () => {
  const office = { isActive: true, technicianCanAdd: false };
  expect(canUseJobTemplate(office)).toBe(true);
  expect(canUseJobTemplate(office, { technicianOnly: true })).toBe(false);
  expect(canUseJobTemplate({ isActive: false, technicianCanAdd: true })).toBe(false);
  expect(canUseJobTemplate({ active: false, technicianCanAdd: true })).toBe(false);
});
