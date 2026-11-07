export const clientServiceAgreementPath = agreementId => agreementId
  ? `/client/service-agreements/${encodeURIComponent(agreementId)}`
  : '/client/service-agreements';

export const safeClientReturnPath = (value, fallback = '/client/dashboard') => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return fallback;
  // Older email sign-in links return to the guest page. Signed-in homeowners use their profile instead.
  const privateAgreement = value.match(/^\/customer\/service-agreements\/([^/?#]+)\/?(?:[?#].*)?$/);
  return privateAgreement ? `/client/service-agreements/${privateAgreement[1]}` : value;
};
export const clientVerificationPath = destination => `/client/verify-email?redirect=${encodeURIComponent(safeClientReturnPath(destination))}`;
