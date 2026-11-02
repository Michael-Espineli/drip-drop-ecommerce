import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import JobTemplateDialog from './JobTemplateDialog';

jest.mock('react-select', () => ({ options, onChange, ...props }) => <select aria-label={props['aria-label']} value="" onChange={(event) => onChange(options.find((option) => option.value === event.target.value))}><option value="">Select</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>);
const service = { id: 'service', name: 'Filter cleaning', unitAmountCents: 15000, metadata: { taskTemplates: [{ name: 'Clean cartridges', type: 'Basic' }] } };
const product = { id: 'product', genericItemId: 'generic-product', dbItemId: 'vendor-product', name: 'O-ring', sellPrice: 1000 };
function Editor({ onSave = jest.fn(), onClose = jest.fn(), error = '', saving = false }) {
  const [form, setForm] = useState({ name: '', description: '', defaultIssuePriorityLevel: 2, defaultRate: '0.00', defaultLaborCost: '0.00', isActive: true, technicianCanAdd: false, locked: false });
  return <JobTemplateDialog mode="create" form={form} setForm={setForm} services={[service]} products={[product]} payTypes={[]} onSave={(event, scope) => { event.preventDefault(); onSave(form, scope); }} onClose={onClose} error={error} saving={saving} />;
}
test('the first popup can build and submit all template components in one pass', () => {
  const save = jest.fn();
  render(<Editor onSave={save} />);
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Filter service' } });
  fireEvent.change(screen.getByLabelText('Add a catalog service'), { target: { value: 'service' } });
  expect(screen.getByLabelText('Task 1 name')).toHaveValue('Clean cartridges');
  fireEvent.click(screen.getByRole('button', { name: '+ Add visit' }));
  fireEvent.change(screen.getByLabelText('Visit 1 name'), { target: { value: 'Service visit' } });
  // The second task checkbox belongs to the visit; the first controls service coverage.
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Clean cartridges' })[1]);
  fireEvent.change(screen.getByLabelText('Add a catalog product'), { target: { value: 'product' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Available to Technicians/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
  expect(save).toHaveBeenCalledTimes(1);
  const [form, scope] = save.mock.calls[0];
  expect(form).toEqual(expect.objectContaining({ name: 'Filter service', technicianCanAdd: true }));
  expect(scope.tasks).toHaveLength(1);
  expect(scope.plannedServiceStops[0].taskTemplateIds).toEqual([scope.tasks[0].id]);
  expect(scope.laborLineItems).toHaveLength(1);
  expect(scope.shoppingItems[0].genericItemId).toBe('generic-product');
  expect(screen.getByText('Template price: $160.00')).toBeInTheDocument();
});
test('cancelling an unsaved template does not call save', () => {
  const close = jest.fn(), save = jest.fn();
  render(<Editor onClose={close} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});
test('save errors remain inside the popup without clearing the template draft', () => {
  render(<Editor error="Could not save. Try again." />);
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
  fireEvent.change(screen.getByLabelText('Task 1 name'), { target: { value: 'Inspect filter' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
  expect(screen.getByLabelText('Template name')).toHaveValue('Keep this draft');
  expect(screen.getByLabelText('Task 1 name')).toHaveValue('Inspect filter');
});
