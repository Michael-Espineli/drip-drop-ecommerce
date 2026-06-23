export const SalesPaymentMethodType = {
  ach: 'ach',
  card: 'card',
};

export const salesPaymentMethodOptions = [
  {
    id: SalesPaymentMethodType.ach,
    label: 'Bank account',
    shortLabel: 'ACH',
    stripePaymentMethodType: 'us_bank_account',
    platformFeePercent: 0.19,
    stripeFeeDescription: 'Stripe ACH: min(amount x 0.8%, $5.00)',
    platformFeeDescription: 'Drip Drop ACH: amount x 0.19%',
    helper: 'Lowest-cost option for recurring pool service billing.',
  },
  {
    id: SalesPaymentMethodType.card,
    label: 'Card',
    shortLabel: 'Card',
    stripePaymentMethodType: 'card',
    platformFeePercent: 0.08,
    stripeFeeDescription: 'Stripe card: amount x 2.9% + $0.30',
    platformFeeDescription: 'Drip Drop card: amount x 0.08%',
    helper: 'Useful when the homeowner prefers card convenience.',
  },
];

export const normalizeSalesPaymentMethodType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['ach', 'bank', 'bank_account', 'us_bank_account'].includes(normalized)) {
    return SalesPaymentMethodType.ach;
  }
  if (['card', 'credit_card', 'debit_card'].includes(normalized)) {
    return SalesPaymentMethodType.card;
  }
  return SalesPaymentMethodType.ach;
};

export const getSalesPaymentMethodOption = (value) => {
  const normalized = normalizeSalesPaymentMethodType(value);
  return salesPaymentMethodOptions.find((option) => option.id === normalized) || salesPaymentMethodOptions[0];
};

export const calculatePlatformFeeCents = (amountCents = 0, paymentMethodType = SalesPaymentMethodType.ach) => {
  const option = getSalesPaymentMethodOption(paymentMethodType);
  return Math.round((Number(amountCents || 0) * option.platformFeePercent) / 100);
};

export const formatSalesPaymentFeeSummary = (amountCents = 0, paymentMethodType = SalesPaymentMethodType.ach) => {
  const option = getSalesPaymentMethodOption(paymentMethodType);
  const feeCents = calculatePlatformFeeCents(amountCents, option.id);

  return {
    ...option,
    platformFeeCents: feeCents,
  };
};
