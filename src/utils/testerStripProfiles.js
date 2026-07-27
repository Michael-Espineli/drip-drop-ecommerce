export const TESTER_STRIP_PROFILE_COLLECTION = [
  'universal',
  'settings',
  'testerStripProfiles',
];

export const AQUACHEK_7_IN_1_PROFILE_ID = 'aquachek_7_in_1';

export const AQUACHEK_7_IN_1_PROFILE = {
  id: AQUACHEK_7_IN_1_PROFILE_ID,
  brand: 'AquaChek',
  productName: '7-in-1',
  displayName: 'AquaChek 7-in-1',
  status: 'active',
  enabledForAllCompanies: false,
  enabledCompanyIds: [],
  referenceSource: 'AquaChek 7-in-1 Color Chart',
  stripOrientation: 'handleToTip',
  readWindowSeconds: 15,
  lightingNormalization: {
    method: 'referenceChartWhiteBalance',
    referenceWhiteHex: '#FFFFFF',
    referenceBlackHex: '#111827',
    maxDeltaEForHighConfidence: 14,
    maxDeltaEForUsableMatch: 32,
    requiresReferenceChartInFrame: true,
  },
  captureGuidance: [
    'Place the used strip next to the bottle color chart.',
    'Keep the chart and strip in the same light.',
    'Avoid glare and heavy shadows across the pads.',
  ],
  pads: [
    {
      id: 'total_hardness',
      order: 1,
      label: 'Total Hardness',
      readingMappings: [{ key: 'total_hardness', label: 'Total Hardness', unit: 'ppm' }],
      colorStops: [
        { id: 'hardness_0', label: '0', amount: '0', hex: '#17239F', zone: 'low' },
        { id: 'hardness_100', label: '100', amount: '100', hex: '#2D3EA9', zone: 'low' },
        { id: 'hardness_250', label: '250', amount: '250', hex: '#4B32A2', zone: 'ok' },
        { id: 'hardness_500', label: '500', amount: '500', hex: '#87379C', zone: 'ok' },
        { id: 'hardness_1000', label: '1000', amount: '1000', hex: '#98208D', zone: 'high' },
      ],
    },
    {
      id: 'total_chlorine_bromine',
      order: 2,
      label: 'Total Chlorine / Total Bromine',
      readingMappings: [
        { key: 'total_chlorine', label: 'Total Chlorine', unit: 'ppm' },
        { key: 'total_bromine', label: 'Total Bromine', unit: 'ppm' },
      ],
      colorStops: [
        { id: 'tc_0', label: '0', amount: '0', hex: '#FBF8C7', zone: 'low' },
        { id: 'tc_05', label: '0.5', amount: '0.5', hex: '#E9EBC4', zone: 'low' },
        { id: 'tc_1', label: '1', amount: '1', hex: '#DDEB8D', zone: 'ideal' },
        { id: 'tc_3', label: '3', amount: '3', hex: '#CAE47A', zone: 'ideal' },
        { id: 'tc_5', label: '5', amount: '5', hex: '#87C058', zone: 'ok' },
        { id: 'tc_10', label: '10', amount: '10', hex: '#4EA060', zone: 'high' },
      ],
    },
    {
      id: 'free_chlorine',
      order: 3,
      label: 'Free Chlorine',
      readingMappings: [{ key: 'free_chlorine', label: 'Free Chlorine', unit: 'ppm' }],
      colorStops: [
        { id: 'fc_0', label: '0', amount: '0', hex: '#FBF8C8', zone: 'low' },
        { id: 'fc_05', label: '0.5', amount: '0.5', hex: '#EEF0D7', zone: 'low' },
        { id: 'fc_1', label: '1', amount: '1', hex: '#D8D1CA', zone: 'pool_ok' },
        { id: 'fc_3', label: '3', amount: '3', hex: '#B893D7', zone: 'spa_ok' },
        { id: 'fc_5', label: '5', amount: '5', hex: '#9A72C7', zone: 'spa_ok' },
        { id: 'fc_10', label: '10', amount: '10', hex: '#83229F', zone: 'high' },
      ],
    },
    {
      id: 'ph',
      order: 4,
      label: 'pH',
      readingMappings: [{ key: 'ph', label: 'pH', unit: '' }],
      colorStops: [
        { id: 'ph_62', label: '6.2', amount: '6.2', hex: '#F7B53B', zone: 'low' },
        { id: 'ph_68', label: '6.8', amount: '6.8', hex: '#F26B2A', zone: 'low' },
        { id: 'ph_72', label: '7.2', amount: '7.2', hex: '#E8422A', zone: 'ok' },
        { id: 'ph_78', label: '7.8', amount: '7.8', hex: '#E51F2B', zone: 'ok' },
        { id: 'ph_84', label: '8.4', amount: '8.4', hex: '#E3322B', zone: 'high' },
      ],
    },
    {
      id: 'total_alkalinity',
      order: 5,
      label: 'Total Alkalinity',
      readingMappings: [{ key: 'total_alkalinity', label: 'Total Alkalinity', unit: 'ppm' }],
      colorStops: [
        { id: 'ta_0', label: '0', amount: '0', hex: '#E3CB35', zone: 'low' },
        { id: 'ta_40', label: '40', amount: '40', hex: '#BBB628', zone: 'low' },
        { id: 'ta_80', label: '80', amount: '80', hex: '#8EA326', zone: 'ok' },
        { id: 'ta_120', label: '120', amount: '120', hex: '#557742', zone: 'ok' },
        { id: 'ta_180', label: '180', amount: '180', hex: '#1F5A39', zone: 'high' },
        { id: 'ta_240', label: '240', amount: '240', hex: '#205C69', zone: 'high' },
      ],
    },
    {
      id: 'cyanuric_acid',
      order: 6,
      label: 'Cyanuric Acid',
      readingMappings: [{ key: 'cyanuric_acid', label: 'Cyanuric Acid', unit: 'ppm' }],
      colorStops: [
        { id: 'cya_0', label: '0', amount: '0', hex: '#E97424', zone: 'low' },
        { id: 'cya_30_50', label: '30-50', amount: '30-50', hex: '#E35D24', zone: 'ok' },
        { id: 'cya_100', label: '100', amount: '100', hex: '#CC2927', zone: 'ok' },
        { id: 'cya_150', label: '150', amount: '150', hex: '#BE2053', zone: 'high' },
        { id: 'cya_300', label: '300', amount: '300', hex: '#7F1F87', zone: 'high' },
      ],
    },
  ],
};

export const normalizeHexColor = (value, fallback = '#000000') => {
  const clean = String(value || '').trim();
  const match = clean.match(/^#?([0-9a-fA-F]{6})$/);

  return match ? `#${match[1].toUpperCase()}` : fallback;
};

const hexToRgb = (hex) => {
  const normalized = normalizeHexColor(hex);
  const value = normalized.slice(1);

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const pivotRgb = (value) => {
  const channel = value / 255;
  return channel > 0.04045
    ? Math.pow((channel + 0.055) / 1.055, 2.4)
    : channel / 12.92;
};

const pivotXyz = (value) => (
  value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116)
);

const rgbToLab = ({ r, g, b }) => {
  const sr = pivotRgb(r);
  const sg = pivotRgb(g);
  const sb = pivotRgb(b);

  const x = ((sr * 0.4124) + (sg * 0.3576) + (sb * 0.1805)) / 0.95047;
  const y = ((sr * 0.2126) + (sg * 0.7152) + (sb * 0.0722)) / 1.00000;
  const z = ((sr * 0.0193) + (sg * 0.1192) + (sb * 0.9505)) / 1.08883;

  const fx = pivotXyz(x);
  const fy = pivotXyz(y);
  const fz = pivotXyz(z);

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
};

const deltaE76 = (left, right) => Math.sqrt(
  Math.pow(left.l - right.l, 2) +
  Math.pow(left.a - right.a, 2) +
  Math.pow(left.b - right.b, 2)
);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const matchTesterStripPadColor = (pad = {}, observedHex = '', options = {}) => {
  const colorStops = Array.isArray(pad.colorStops) ? pad.colorStops : [];
  if (!colorStops.length) return null;

  const observedLab = rgbToLab(hexToRgb(observedHex));
  const rankedStops = colorStops
    .map((stop) => ({
      ...stop,
      deltaE: deltaE76(observedLab, rgbToLab(hexToRgb(stop.hex))),
    }))
    .sort((left, right) => left.deltaE - right.deltaE);

  const bestStop = rankedStops[0];
  const secondStop = rankedStops[1] || null;
  const usableDelta = Number(options.maxDeltaEForUsableMatch || 32);
  const confidence = clamp(1 - (bestStop.deltaE / usableDelta), 0, 1);

  return {
    padId: pad.id || '',
    padLabel: pad.label || '',
    observedHex: normalizeHexColor(observedHex),
    matchedStop: bestStop,
    secondClosestStop: secondStop,
    confidence,
    confidenceLabel:
      confidence >= 0.72 ? 'High' :
      confidence >= 0.42 ? 'Review' :
      'Low',
  };
};

export const profileIsEnabledForCompany = (profile = {}, companyId = '') => {
  if (profile.enabledForAllCompanies === true) return true;
  const enabledCompanyIds = Array.isArray(profile.enabledCompanyIds)
    ? profile.enabledCompanyIds
    : [];

  return enabledCompanyIds.includes(companyId);
};
