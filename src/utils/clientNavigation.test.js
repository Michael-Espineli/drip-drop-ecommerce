import { clientServiceAgreementPath, clientVerificationPath, safeClientReturnPath } from './clientNavigation';

test.each([
  '/customer/service-agreements/sa_123',
  '/customer/service-agreements/sa_123?accessToken=secret&email=homeowner%40example.test',
  '/customer/service-agreements/sa_123/?reviewToken=secret#agreement-response',
])('old private agreement return links resolve to the homeowner profile: %s', path => {
  expect(safeClientReturnPath(path)).toBe('/client/service-agreements/sa_123');
});
test.each([null, undefined, 'https://other.example', '//other.example', '/\\other.example', '/client/\nother'])('unsafe return paths remain blocked: %s', path => {
  expect(safeClientReturnPath(path)).toBe('/client/dashboard');
});
test.each(['/client/finance', '/client/customer-account-invite/invite?returnTo=profile', '/customer/service-agreements/sa_123/inspection-report?accessToken=secret'])('other return destinations remain intact: %s', path => {
  expect(safeClientReturnPath(path)).toBe(path);
});
test('verification and canonical agreement links retain the exact record without copying the private token', () => {
  const verification = new URL(clientVerificationPath('/customer/service-agreements/sa_123?accessToken=secret'), 'https://example.test');
  expect(verification.searchParams.get('redirect')).toBe('/client/service-agreements/sa_123');
  expect(verification.href).not.toContain('secret');
  expect(clientServiceAgreementPath('sa_123')).toBe('/client/service-agreements/sa_123');
  expect(clientServiceAgreementPath('record with spaces')).toBe('/client/service-agreements/record%20with%20spaces');
  expect(clientServiceAgreementPath()).toBe('/client/service-agreements');
});
