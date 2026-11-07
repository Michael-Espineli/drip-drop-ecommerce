import { writeBatch } from 'firebase/firestore';
import { saveTermsTemplateWithTerms } from './termsTemplateFirestore';
import { TermsTemplate } from '../models/TermsTemplate';

jest.mock('../config', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: (_, ...parts) => parts.join('/'),
  writeBatch: jest.fn(),
}));
let batch;
beforeEach(() => {
  jest.clearAllMocks();
  batch = { set: jest.fn(), delete: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
});

test('commits the template and nonempty reusable terms together', async () => {
  const template = new TermsTemplate({ name: 'Weekly service' });
  const result = await saveTermsTemplateWithTerms('company', template, [{ id: 'clause', description: ' Keep access clear. ' }, { id: 'blank', description: ' ' }]);
  expect(batch.set.mock.calls).toEqual([
    [`companies/company/termsTemplates/${template.id}`, template.toFirestore(), { merge: true }],
    [`companies/company/termsTemplates/${template.id}/terms/clause`, { id: 'clause', description: 'Keep access clear.' }],
  ]);
  expect(batch.commit).toHaveBeenCalledTimes(1);
  expect(result.terms).toEqual([expect.objectContaining({ id: 'clause', description: 'Keep access clear.' })]);
});

test('updates retained terms and removes deleted terms in the same commit', async () => {
  await saveTermsTemplateWithTerms('company', { id: 'template', name: 'Updated template' }, [{ id: 'kept', description: 'Updated clause' }], [{ id: 'kept' }, { id: 'removed' }]);
  expect(batch.delete).toHaveBeenCalledWith('companies/company/termsTemplates/template/terms/removed');
  expect(batch.set).toHaveBeenCalledWith('companies/company/termsTemplates/template/terms/kept', { id: 'kept', description: 'Updated clause' });
  expect(batch.commit).toHaveBeenCalledTimes(1);
});

test('rejects an unsuccessful commit instead of returning a partially saved template', async () => {
  batch.commit.mockRejectedValue(new Error('Permission denied'));
  await expect(saveTermsTemplateWithTerms('company', { name: 'Template' }, [{ description: 'Clause' }])).rejects.toThrow('Permission denied');
});
