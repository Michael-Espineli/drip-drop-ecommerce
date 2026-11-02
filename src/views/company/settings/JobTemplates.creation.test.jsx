import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import JobTemplates from './JobTemplates';

jest.mock('../../../context/AuthContext', () => ({ Context: require('react').createContext() }));
jest.mock('../../../utils/config', () => ({ db: {} }));
jest.mock('../../../hooks/useServicePayrollData', () => () => ({}));
jest.mock('../../../utils/productCatalog', () => ({ loadJobProductCatalog: async () => ({ products: [], vendorItems: [] }), getJobMaterialVendorItemId: () => '' }));
jest.mock('../../../utils/sales/salesFirestore', () => ({ salesCatalogCollection: () => 'catalog', saveSalesCatalogItem: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'), doc: (base, ...parts) => typeof base === 'string' ? [base, ...parts].join('/') : parts.join('/'),
  query: (value) => value, orderBy: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn(), writeBatch: jest.fn(),
}));
let batch;
beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });
  getDocs.mockResolvedValue({ docs: [], size: 0 });
  batch = { set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
});
async function open() {
  render(<MemoryRouter><Context.Provider value={{ recentlySelectedCompany: 'company', user: { uid: 'creator' } }}><JobTemplates /></Context.Provider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'New Template' }));
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Complete filter template' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
  fireEvent.change(screen.getByLabelText('Task 1 name'), { target: { value: 'Inspect filter' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add visit' }));
  fireEvent.change(screen.getByLabelText('Visit 1 name'), { target: { value: 'Inspection' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Inspect filter' }));
}
test('metadata, tasks, and linked visits are committed in one batch', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(batch.set).toHaveBeenCalledTimes(3);
  const [templatePath, template] = batch.set.mock.calls[0];
  const [taskPath, task] = batch.set.mock.calls.find(([path]) => path.includes('/tasks/'));
  const [visitPath, visit] = batch.set.mock.calls.find(([path]) => path.includes('/plannedServiceStops/'));
  expect(template).toEqual(expect.objectContaining({ name: 'Complete filter template', taskCount: 1, plannedStopCount: 1, createdByUserId: 'creator', isActive: true, active: true }));
  expect(taskPath.startsWith(templatePath)).toBe(true);
  expect(visitPath.startsWith(templatePath)).toBe(true);
  expect(task.templateId).toBe(template.id);
  expect(visit.taskTemplateIds).toEqual([task.id]);
});
test('a failed atomic save retains all draft fields and reuses its template identity on retry', async () => {
  batch.commit.mockRejectedValueOnce(new Error('Connection failed'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection failed');
  expect(screen.getByLabelText('Template name')).toHaveValue('Complete filter template');
  expect(screen.getByLabelText('Task 1 name')).toHaveValue('Inspect filter');
  const templateId = batch.set.mock.calls[0][1].id;
  fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(2));
  expect(batch.set.mock.calls[3][1].id).toBe(templateId);
});
