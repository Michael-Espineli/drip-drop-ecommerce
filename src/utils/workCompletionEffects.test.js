import { getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { runWorkCompletionEffects } from './workCompletionEffects';

jest.mock('firebase/firestore', () => ({
  doc: (first, ...parts) => [typeof first === 'string' ? first : '', ...parts].filter(Boolean).join('/'),
  collection: (first, ...parts) => [typeof first === 'string' ? first : '', ...parts].filter(Boolean).join('/'),
  getDoc: jest.fn(), getDocs: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(),
  query: (ref) => ref, where: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ status: 'Needs Maintenance', serviceFrequency: 6, serviceFrequencyEvery: 'Monthly' }) });
  getDocs.mockResolvedValue({ docs: [] });
});

test.each(['Maintenance', 'Repair', 'Clean Filter', 'Filter Clean'])('%s effects leave equipment history to confirmed server completion', async (type) => {
  await runWorkCompletionEffects({ db: {}, companyId: 'company', jobId: 'job', task: { id: 'task', type, equipmentId: 'filter' } });
  expect(setDoc).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
});

test('equipment completion still synchronizes a scheduled task with its canonical job task', async () => {
  await runWorkCompletionEffects({ db: {}, companyId: 'company', jobId: 'job', serviceStop: { id: 'visit', jobId: 'job' }, task: { id: 'copy', jobTaskId: 'task', type: 'Maintenance', equipmentId: 'filter' } });
  expect(updateDoc).toHaveBeenCalledWith('companies/company/workOrders/job/tasks/task', expect.objectContaining({ status: 'Finished' }));
  expect(setDoc).not.toHaveBeenCalled();
});

test('water task history remains part of the existing completion flow', async () => {
  await runWorkCompletionEffects({ db: {}, companyId: 'company', jobId: 'job', task: { id: 'water', type: 'Fill Water', bodyOfWaterId: 'pool' } });
  expect(setDoc).toHaveBeenCalledWith('companies/company/bodiesOfWater/pool/waterHistory/auto_bow_hist_water', expect.objectContaining({ type: 'Fill' }), { merge: true });
});
