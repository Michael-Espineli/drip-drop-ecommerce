import { RepairRequest, getRepairRequestIssuePriority, isOpenRepairRequestStatus, isRepairRequestSubmittedByUser, displayRepairRequestStatus } from './RepairRequest';

test.each([[1, 'Critical'], [2, 'Recommended'], [3, 'Preventive'], [4, 'Optional Upgrade']])('priority %s survives a Firestore round trip', (level, label) => {
  const stored = new RepairRequest({ issuePriorityLevel: level }).toFirestore();
  expect(stored).toEqual(expect.objectContaining({ issuePriorityLevel: level, issuePriorityLabel: label, priorityLevel: level, priorityLabel: label }));
  const loaded = RepairRequest.fromFirestore({ data: () => ({ ...stored, date: { toDate: () => new Date() } }) });
  expect(loaded.issuePriorityLevel).toBe(level);
  expect(loaded.issuePriorityLabel).toBe(label);
});

test('older requests default to Recommended and priority aliases remain readable', () => {
  expect(new RepairRequest().issuePriorityLevel).toBe(2);
  expect(getRepairRequestIssuePriority({ priorityLevel: 3 })).toBe(3);
  expect(getRepairRequestIssuePriority({ issuePriorityLevel: 1, priorityLevel: 4 })).toBe(1);
  expect(getRepairRequestIssuePriority({ issuePriorityLevel: 999 })).toBe(2);
});

const requests = require('./repairRequestQueueFixtures.json');
test('the default action queue includes all sources and legacy pending, without a date or active-tech cutoff', () => {
  expect(requests.filter((request) => isOpenRepairRequestStatus(request.status)).map((request) => `${request.sourcePath}:${request.id}`)).toEqual([
    'company:old-open', 'company:lowercase', 'company:pending', 'homeowner:pending-lower',
    'company:public-tech', 'homeowner:homeowner', 'company:shared', 'homeowner:shared',
    'company:missing-status', 'company:blank-status', 'company:assigned-customer', 'company:different-submitter',
  ]);
});
test('technician action queues use the submitter, with aliases only for records without a requester', () => {
  expect(requests.filter((request) => isOpenRepairRequestStatus(request.status) && isRepairRequestSubmittedByUser(request, ['tech-1'])).map((request) => request.id)).toEqual([
    'lowercase', 'pending', 'pending-lower', 'public-tech', 'missing-status', 'blank-status',
  ]);
  expect(isRepairRequestSubmittedByUser({ requesterId: 'tech-1' }, [])).toBe(false);
  expect(displayRepairRequestStatus('Pending')).toBe('Unresolved');
  expect(displayRepairRequestStatus('in-progress')).toBe('Converted To Job');
});
