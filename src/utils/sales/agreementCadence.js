export const serviceFrequencyOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'twiceWeekly', label: 'Twice Weekly' },
  { value: 'threeTimesWeekly', label: 'Three Times Weekly' },
  { value: 'biweekly', label: 'Every Other Week' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'daily', label: 'Daily' },
  { value: 'oneTime', label: 'One Time' },
  { value: 'custom', label: 'Custom' },
];

export const billingFrequencyOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'oneTime', label: 'One Time' },
  { value: 'custom', label: 'Custom' },
];

const normalizeKey = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const optionLabel = (options, value) => {
  const key = normalizeKey(value);
  return options.find((option) => normalizeKey(option.value) === key)?.label || '';
};

export const labelizeCadence = (value) => {
  if (!value) return 'Not set';

  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const billingFrequencyForAgreement = (agreement = {}) => (
  agreement.billingFrequency ||
  agreement.billingCadence ||
  agreement.invoiceFrequency ||
  agreement.interval ||
  agreement.serviceCadence ||
  agreement.rateType ||
  'monthly'
);

export const billingFrequencyCountForAgreement = (agreement = {}) => (
  Math.max(Number(
    agreement.billingFrequencyCount ||
    agreement.billingCadenceCount ||
    agreement.invoiceFrequencyCount ||
    agreement.intervalCount ||
    agreement.serviceCadenceCount ||
    1
  ), 1)
);

export const billingIntervalCountForAgreement = (agreement = {}) => {
  const frequency = billingFrequencyForAgreement(agreement);
  const key = normalizeKey(frequency);
  const count = billingFrequencyCountForAgreement(agreement);

  if (key === 'biweekly') return 2;
  if (key === 'quarterly') return 3;
  return count;
};

export const serviceFrequencyForAgreement = (agreement = {}) => (
  agreement.serviceCadence ||
  agreement.serviceFrequency ||
  ''
);

export const serviceFrequencyCountForAgreement = (agreement = {}) => (
  Math.max(Number(
    agreement.serviceCadenceCount ||
    agreement.serviceFrequencyCount ||
    1
  ), 1)
);

export const formatBillingFrequency = (agreement = {}) => {
  const frequency = billingFrequencyForAgreement(agreement);
  const count = billingFrequencyCountForAgreement(agreement);
  const label = optionLabel(billingFrequencyOptions, frequency) || labelizeCadence(frequency);

  if (normalizeKey(frequency) === 'quarterly') return 'Quarterly';
  if (normalizeKey(frequency) === 'annually') return 'Annually';
  if (normalizeKey(frequency) === 'biweekly') return 'Biweekly';
  if (count > 1 && !['custom', 'onetime'].includes(normalizeKey(frequency))) {
    return `Every ${count} ${label.toLowerCase()}`;
  }

  return label;
};

export const normalizeDaysOfWeek = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((day) => day.trim())
      .filter(Boolean);
  }
  return [];
};

export const formatServiceFrequency = (agreement = {}) => {
  const frequency = serviceFrequencyForAgreement(agreement);
  const count = serviceFrequencyCountForAgreement(agreement);
  const key = normalizeKey(frequency);
  const label = optionLabel(serviceFrequencyOptions, frequency) || labelizeCadence(frequency);
  const days = normalizeDaysOfWeek(agreement.serviceDaysOfWeek || agreement.daysOfWeek || agreement.serviceDays || agreement.day);
  const dayText = days.length ? ` on ${days.join(', ')}` : '';

  if (key === 'twiceweekly') return `Twice Weekly${dayText}`;
  if (key === 'threetimesweekly' || key === 'tripleweekly') return `Three Times Weekly${dayText}`;
  if (key === 'biweekly' || key === 'everyotherweek') return `Every Other Week${dayText}`;
  if (count > 1 && !['custom', 'onetime'].includes(key)) return `${count}x ${label}${dayText}`;

  return `${label}${dayText}`;
};

export const recurringFrequencyToAgreementService = ({
  frequency = '',
  daysOfWeek = '',
  day = '',
} = {}) => {
  const key = normalizeKey(frequency);
  let serviceCadence = 'weekly';
  let serviceCadenceCount = 1;

  if (key.includes('daily')) serviceCadence = 'daily';
  if (key.includes('biweekly') || key.includes('everyotherweek') || key.includes('every2weeks')) serviceCadence = 'biweekly';
  if (key.includes('monthly') || key.includes('every4weeks')) serviceCadence = 'monthly';
  if (key.includes('twiceweekly') || key.includes('2xweekly') || key.includes('twoperweek')) {
    serviceCadence = 'twiceWeekly';
    serviceCadenceCount = 2;
  }
  if (key.includes('threetimesweekly') || key.includes('tripleweekly') || key.includes('3xweekly') || key.includes('threeperweek')) {
    serviceCadence = 'threeTimesWeekly';
    serviceCadenceCount = 3;
  }
  if (key.includes('custom')) serviceCadence = 'custom';

  const normalizedDays = normalizeDaysOfWeek(daysOfWeek || day);

  return {
    serviceCadence,
    serviceCadenceCount,
    serviceDaysOfWeek: normalizedDays,
    serviceFrequencyLabel: formatServiceFrequency({
      serviceCadence,
      serviceCadenceCount,
      serviceDaysOfWeek: normalizedDays,
    }),
  };
};

export const billingFrequencyToStripeInterval = (frequency = '', fallback = '') => {
  const key = normalizeKey(frequency || fallback);

  if (key.includes('week')) return 'week';
  if (key.includes('year') || key.includes('annual')) return 'year';
  if (key.includes('day')) return 'day';
  return 'month';
};
