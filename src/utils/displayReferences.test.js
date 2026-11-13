import { displayRecordReference, displayReferenceValue, isOpaqueId, linkedReferenceText } from './displayReferences';

describe('visible record references', () => {
  test.each(['J123', 'JOB-123', 'INV-2026-0042', 'INV_12345', 'REC-2026-11-12-ABC123', '#1234567890123456', '2026-000042'])('keeps readable business number %s', (number) => {
    expect(isOpaqueId(number)).toBe(false);
    expect(displayReferenceValue(number, 'Record')).toBe(number);
  });
  test.each(['x7QaB2cD9eF0gH1jK3mN', '370cc052-4db1-4cbc-b86b-7589b7b76ea7', 'comp_wor_370cc052-4db1-4cbc-b86b-7589b7b76ea7', 'job_123_370cc052-4db1-4cbc-b86b-7589b7b76ea7', 'price_abc', 'cs_test_abcd'])('hides opaque identifier %s', (id) => {
    expect(isOpaqueId(id)).toBe(true);
    expect(displayReferenceValue(id, 'Job')).toBe('Job');
    expect(linkedReferenceText('Job', id)).toBe('Open Job');
  });
  test('uses a readable invoice number after an opaque legacy internalId', () => {
    expect(displayRecordReference({ internalId: 'x7QaB2cD9eF0gH1jK3mN', invoiceNumber: 'INV-2026-0042', id: 'document' }, 'Invoice')).toBe('INV-2026-0042');
  });
  test('retains names and uses a useful fallback when only an opaque ID exists', () => {
    expect(displayRecordReference({ name: 'Filter clean' }, 'Job')).toBe('Filter clean');
    expect(displayRecordReference({ id: 'x7QaB2cD9eF0gH1jK3mN' }, 'Invoice')).toBe('Invoice');
    expect(displayRecordReference({ id: 'record-1' }, 'Invoice')).toBe('Invoice');
    expect(linkedReferenceText('Customer', 'customer-1')).toBe('Open Customer');
    expect(displayRecordReference({ id: 'INV-2026-0042' }, 'Invoice')).toBe('INV-2026-0042');
  });
});
