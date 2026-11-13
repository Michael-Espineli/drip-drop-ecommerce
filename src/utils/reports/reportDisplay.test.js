import { reportDisplayValue, visibleReportColumns } from './reportDisplay';

test('report display omits identifier columns while retaining business-number columns', () => {
  expect(visibleReportColumns([{key:'customerId'},{key:'serviceLocationId'},{key:'invoiceNumber'},{key:'jobNumber'},{key:'name'}]).map(column=>column.key)).toEqual(['invoiceNumber','jobNumber','name']);
});
test.each(['INV-2026-0042','J123','REC-2026-11-12-ABC123'])('report display retains %s',number=>expect(reportDisplayValue(number)).toBe(number));
test('report diagnostic text hides an embedded ID without changing the underlying row',()=>{
  const row={issue:'Missing location x7QaB2cD9eF0gH1jK3mN',amount:12500};
  expect(reportDisplayValue(row.issue,'Linked location')).toBe('Missing location Linked location');
  expect(reportDisplayValue(row.amount)).toBe(12500);
  expect(row.issue).toContain('x7QaB2cD9eF0gH1jK3mN');
});
