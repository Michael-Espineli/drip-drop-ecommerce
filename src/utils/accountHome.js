export const getAccountHomePath = (accountType) => {
  switch (String(accountType || '').toLowerCase()) {
    case 'company': return '/company/dashboard';
    case 'client': return '/client/dashboard';
    case 'admin': return '/admin/dashboard';
    default: return '/';
  }
};
