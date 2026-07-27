const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const db = admin.firestore();
const AQUACHEK_7_IN_1_PROFILE_ID = "aquachek_7_in_1";
const AQUACHEK_7_IN_1_PROFILE = {
  id: AQUACHEK_7_IN_1_PROFILE_ID,
  brand: "AquaChek",
  productName: "7-in-1",
  displayName: "AquaChek 7-in-1",
  status: "active",
  enabledForAllCompanies: true,
  enabledCompanyIds: [],
  referenceSource: "AquaChek 7-in-1 Color Chart",
  stripOrientation: "handleToTip",
  readWindowSeconds: 15,
  lightingNormalization: {
    method: "referenceChartWhiteBalance",
    referenceWhiteHex: "#FFFFFF",
    referenceBlackHex: "#111827",
    maxDeltaEForHighConfidence: 14,
    maxDeltaEForUsableMatch: 32,
    requiresReferenceChartInFrame: true,
  },
  captureGuidance: [
    "Place the used strip next to the bottle color chart.",
    "Keep the chart and strip in the same light.",
    "Avoid glare and heavy shadows across the pads.",
  ],
  pads: [
    {
      id: "total_hardness",
      order: 1,
      label: "Total Hardness",
      readingMappings: [{ key: "total_hardness", label: "Total Hardness", unit: "ppm" }],
      colorStops: [
        { id: "hardness_0", label: "0", amount: "0", hex: "#17239F", zone: "low" },
        { id: "hardness_100", label: "100", amount: "100", hex: "#2D3EA9", zone: "low" },
        { id: "hardness_250", label: "250", amount: "250", hex: "#4B32A2", zone: "ok" },
        { id: "hardness_500", label: "500", amount: "500", hex: "#87379C", zone: "ok" },
        { id: "hardness_1000", label: "1000", amount: "1000", hex: "#98208D", zone: "high" },
      ],
    },
    {
      id: "total_chlorine_bromine",
      order: 2,
      label: "Total Chlorine / Total Bromine",
      readingMappings: [
        { key: "total_chlorine", label: "Total Chlorine", unit: "ppm" },
        { key: "total_bromine", label: "Total Bromine", unit: "ppm" },
      ],
      colorStops: [
        { id: "tc_0", label: "0", amount: "0", hex: "#FBF8C7", zone: "low" },
        { id: "tc_05", label: "0.5", amount: "0.5", hex: "#E9EBC4", zone: "low" },
        { id: "tc_1", label: "1", amount: "1", hex: "#DDEB8D", zone: "ideal" },
        { id: "tc_3", label: "3", amount: "3", hex: "#CAE47A", zone: "ideal" },
        { id: "tc_5", label: "5", amount: "5", hex: "#87C058", zone: "ok" },
        { id: "tc_10", label: "10", amount: "10", hex: "#4EA060", zone: "high" },
      ],
    },
    {
      id: "free_chlorine",
      order: 3,
      label: "Free Chlorine",
      readingMappings: [{ key: "free_chlorine", label: "Free Chlorine", unit: "ppm" }],
      colorStops: [
        { id: "fc_0", label: "0", amount: "0", hex: "#FBF8C8", zone: "low" },
        { id: "fc_05", label: "0.5", amount: "0.5", hex: "#EEF0D7", zone: "low" },
        { id: "fc_1", label: "1", amount: "1", hex: "#D8D1CA", zone: "pool_ok" },
        { id: "fc_3", label: "3", amount: "3", hex: "#B893D7", zone: "spa_ok" },
        { id: "fc_5", label: "5", amount: "5", hex: "#9A72C7", zone: "spa_ok" },
        { id: "fc_10", label: "10", amount: "10", hex: "#83229F", zone: "high" },
      ],
    },
    {
      id: "ph",
      order: 4,
      label: "pH",
      readingMappings: [{ key: "ph", label: "pH", unit: "" }],
      colorStops: [
        { id: "ph_62", label: "6.2", amount: "6.2", hex: "#F7B53B", zone: "low" },
        { id: "ph_68", label: "6.8", amount: "6.8", hex: "#F26B2A", zone: "low" },
        { id: "ph_72", label: "7.2", amount: "7.2", hex: "#E8422A", zone: "ok" },
        { id: "ph_78", label: "7.8", amount: "7.8", hex: "#E51F2B", zone: "ok" },
        { id: "ph_84", label: "8.4", amount: "8.4", hex: "#E3322B", zone: "high" },
      ],
    },
    {
      id: "total_alkalinity",
      order: 5,
      label: "Total Alkalinity",
      readingMappings: [{ key: "total_alkalinity", label: "Total Alkalinity", unit: "ppm" }],
      colorStops: [
        { id: "ta_0", label: "0", amount: "0", hex: "#E3CB35", zone: "low" },
        { id: "ta_40", label: "40", amount: "40", hex: "#BBB628", zone: "low" },
        { id: "ta_80", label: "80", amount: "80", hex: "#8EA326", zone: "ok" },
        { id: "ta_120", label: "120", amount: "120", hex: "#557742", zone: "ok" },
        { id: "ta_180", label: "180", amount: "180", hex: "#1F5A39", zone: "high" },
        { id: "ta_240", label: "240", amount: "240", hex: "#205C69", zone: "high" },
      ],
    },
    {
      id: "cyanuric_acid",
      order: 6,
      label: "Cyanuric Acid",
      readingMappings: [{ key: "cyanuric_acid", label: "Cyanuric Acid", unit: "ppm" }],
      colorStops: [
        { id: "cya_0", label: "0", amount: "0", hex: "#E97424", zone: "low" },
        { id: "cya_30_50", label: "30-50", amount: "30-50", hex: "#E35D24", zone: "ok" },
        { id: "cya_100", label: "100", amount: "100", hex: "#CC2927", zone: "ok" },
        { id: "cya_150", label: "150", amount: "150", hex: "#BE2053", zone: "high" },
        { id: "cya_300", label: "300", amount: "300", hex: "#7F1F87", zone: "high" },
      ],
    },
  ],
};

const getCallablePayload = (data) => data?.data ?? data ?? {};

const getVerifiedCallableAuth = async (payload = {}, request = {}) => {
  if (request.auth?.uid) {
    return {
      uid: request.auth.uid,
      token: request.auth.token || {},
    };
  }

  const authorizationHeader =
    request.rawRequest?.headers?.authorization ||
    request.rawRequest?.headers?.Authorization ||
    "";
  const bearerToken = String(authorizationHeader).startsWith("Bearer ")
    ? String(authorizationHeader).slice("Bearer ".length).trim()
    : "";
  const idToken = [
    payload.idToken,
    payload.auth?.idToken,
    bearerToken,
  ].find((candidate) => String(candidate || "").trim());

  if (!idToken) return null;

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return {
      uid: decodedToken.uid,
      token: decodedToken,
    };
  } catch (error) {
    console.error("Unable to verify tester strip callable auth token", error);
    return null;
  }
};

const getRequiredDripDropAdmin = async (uid = "") => {
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const userSnapshot = await db.collection("users").doc(uid).get();
  const userData = userSnapshot.exists ? userSnapshot.data() || {} : {};

  if (userData.accountType !== "Admin") {
    throw new HttpsError("permission-denied", "Only platform admins can manage tester strip profiles.");
  }

  return userData;
};

const normalizeHexColor = (value, fallback = "#000000") => {
  const clean = String(value || "").trim();
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

const rgbToHex = ({ r, g, b }) => (
  `#${[r, g, b].map((channel) => {
    const value = Math.max(0, Math.min(255, Math.round(channel)));
    return value.toString(16).padStart(2, "0");
  }).join("")}`.toUpperCase()
);

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

const parseNumericAmount = (amount) => {
  const value = String(amount || "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const amountDecimalPlaces = (amount) => {
  const value = String(amount || "").trim();
  const decimal = value.match(/\.(\d+)$/);
  return decimal ? decimal[1].length : 0;
};

const formatInterpolatedAmount = (value, leftAmount, rightAmount) => {
  if (!Number.isFinite(value)) return "";

  const left = parseNumericAmount(leftAmount);
  const right = parseNumericAmount(rightAmount);
  const range = Math.abs((right ?? value) - (left ?? value));
  const precision = Math.max(
    amountDecimalPlaces(leftAmount),
    amountDecimalPlaces(rightAmount),
    value < 10 || range <= 10 ? 1 : 0
  );

  return Number(value.toFixed(Math.min(precision, 2))).toString();
};

const closestPointOnLabSegment = (observedLab, leftLab, rightLab) => {
  const segment = {
    l: rightLab.l - leftLab.l,
    a: rightLab.a - leftLab.a,
    b: rightLab.b - leftLab.b,
  };
  const observed = {
    l: observedLab.l - leftLab.l,
    a: observedLab.a - leftLab.a,
    b: observedLab.b - leftLab.b,
  };
  const segmentLengthSquared =
    Math.pow(segment.l, 2) +
    Math.pow(segment.a, 2) +
    Math.pow(segment.b, 2);

  if (segmentLengthSquared <= 0) {
    return {
      ratio: 0,
      deltaE: deltaE76(observedLab, leftLab),
    };
  }

  const rawRatio = (
    (observed.l * segment.l) +
    (observed.a * segment.a) +
    (observed.b * segment.b)
  ) / segmentLengthSquared;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const closestLab = {
    l: leftLab.l + (segment.l * ratio),
    a: leftLab.a + (segment.a * ratio),
    b: leftLab.b + (segment.b * ratio),
  };

  return {
    ratio,
    deltaE: deltaE76(observedLab, closestLab),
  };
};

const interpolatedStopMatch = (colorStops = [], observedLab) => {
  let bestSegment = null;

  for (let index = 0; index < colorStops.length - 1; index += 1) {
    const leftStop = colorStops[index];
    const rightStop = colorStops[index + 1];
    const leftAmount = parseNumericAmount(leftStop.amount || leftStop.label);
    const rightAmount = parseNumericAmount(rightStop.amount || rightStop.label);

    if (leftAmount === null || rightAmount === null) continue;

    const leftLab = rgbToLab(hexToRgb(leftStop.hex));
    const rightLab = rgbToLab(hexToRgb(rightStop.hex));
    const segmentMatch = closestPointOnLabSegment(observedLab, leftLab, rightLab);
    const estimatedValue = leftAmount + ((rightAmount - leftAmount) * segmentMatch.ratio);

    if (!bestSegment || segmentMatch.deltaE < bestSegment.deltaE) {
      bestSegment = {
        leftStop,
        rightStop,
        ratio: segmentMatch.ratio,
        deltaE: segmentMatch.deltaE,
        estimatedAmount: formatInterpolatedAmount(
          estimatedValue,
          leftStop.amount || leftStop.label,
          rightStop.amount || rightStop.label
        ),
      };
    }
  }

  return bestSegment;
};

const normalizeColorForLighting = (hex, calibration = {}, lighting = {}) => {
  const observed = hexToRgb(hex);
  const observedWhiteHex = calibration.observedWhiteHex || calibration.whiteHex;
  const observedBlackHex = calibration.observedBlackHex || calibration.blackHex;
  const referenceWhiteHex = calibration.referenceWhiteHex || lighting.referenceWhiteHex || "#FFFFFF";
  const referenceBlackHex = calibration.referenceBlackHex || lighting.referenceBlackHex || "#000000";

  if (observedWhiteHex && observedBlackHex) {
    const observedWhite = hexToRgb(observedWhiteHex);
    const observedBlack = hexToRgb(observedBlackHex);
    const referenceWhite = hexToRgb(referenceWhiteHex);
    const referenceBlack = hexToRgb(referenceBlackHex);

    const normalizeChannel = (channel) => {
      const observedRange = Math.max(1, observedWhite[channel] - observedBlack[channel]);
      const referenceRange = referenceWhite[channel] - referenceBlack[channel];
      const ratio = (observed[channel] - observedBlack[channel]) / observedRange;
      return referenceBlack[channel] + (ratio * referenceRange);
    };

    return rgbToHex({
      r: normalizeChannel("r"),
      g: normalizeChannel("g"),
      b: normalizeChannel("b"),
    });
  }

  if (observedWhiteHex) {
    const observedWhite = hexToRgb(observedWhiteHex);
    const referenceWhite = hexToRgb(referenceWhiteHex);

    const scaleChannel = (channel) => (
      observed[channel] * (referenceWhite[channel] / Math.max(1, observedWhite[channel]))
    );

    return rgbToHex({
      r: scaleChannel("r"),
      g: scaleChannel("g"),
      b: scaleChannel("b"),
    });
  }

  return normalizeHexColor(hex);
};

const confidenceForDelta = (deltaE, lighting = {}) => {
  const highThreshold = Number(lighting.maxDeltaEForHighConfidence || 14);
  const usableThreshold = Number(lighting.maxDeltaEForUsableMatch || 32);

  if (deltaE <= highThreshold) {
    return {
      confidence: Math.max(0.72, 1 - (deltaE / Math.max(usableThreshold, 1))),
      confidenceLabel: "High",
    };
  }

  if (deltaE <= usableThreshold) {
    return {
      confidence: Math.max(0.42, 1 - (deltaE / Math.max(usableThreshold, 1))),
      confidenceLabel: "Review",
    };
  }

  return {
    confidence: Math.max(0, 1 - (deltaE / Math.max(usableThreshold, 1))),
    confidenceLabel: "Low",
  };
};

const matchPadColor = (pad = {}, observedHex = "", calibration = {}, lighting = {}) => {
  const colorStops = Array.isArray(pad.colorStops) ? pad.colorStops : [];
  if (!colorStops.length) return null;

  const normalizedHex = normalizeColorForLighting(observedHex, calibration, lighting);
  const observedLab = rgbToLab(hexToRgb(normalizedHex));
  const rankedStops = colorStops
    .map((stop) => ({
      ...stop,
      deltaE: deltaE76(observedLab, rgbToLab(hexToRgb(stop.hex))),
    }))
    .sort((left, right) => left.deltaE - right.deltaE);
  const matchedStop = rankedStops[0];
  const interpolatedMatch = interpolatedStopMatch(colorStops, observedLab);
  const usableInterpolatedMatch = interpolatedMatch && interpolatedMatch.deltaE <= matchedStop.deltaE + 0.01
    ? interpolatedMatch
    : null;
  const comparisonDelta = usableInterpolatedMatch
    ? usableInterpolatedMatch.deltaE
    : matchedStop.deltaE;
  const confidence = confidenceForDelta(comparisonDelta, lighting);

  return {
    padId: pad.id || "",
    padLabel: pad.label || "",
    observedHex: normalizeHexColor(observedHex),
    normalizedHex,
    matchedStop,
    secondClosestStop: rankedStops[1] || null,
    interpolatedMatch: usableInterpolatedMatch,
    estimatedAmount: usableInterpolatedMatch?.estimatedAmount || String(matchedStop.amount || matchedStop.label || ""),
    estimatedAmountSource: usableInterpolatedMatch ? "interpolated" : "nearestStop",
    ...confidence,
  };
};

const normalizedKey = (value = "") => (
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
);

const buildTemplateLookup = (templates = []) => {
  const lookup = new Map();

  templates.forEach((template) => {
    [
      template.id,
      template.readingsTemplateId,
      template.universalTemplateId,
      template.chemType,
      template.name,
    ].forEach((key) => {
      const normalized = normalizedKey(key);
      if (normalized && !lookup.has(normalized)) {
        lookup.set(normalized, template);
      }
    });
  });

  return lookup;
};

const templateForMapping = (mapping = {}, pad = {}, templateLookup) => {
  const candidates = [
    mapping.key,
    mapping.label,
    pad.id,
    pad.label,
  ];

  for (const candidate of candidates) {
    const template = templateLookup.get(normalizedKey(candidate));
    if (template) return template;
  }

  return null;
};

const configuredTemplateForMapping = (mapping = {}, pad = {}, profileMapping = {}, templateLookup) => {
  const configuredMappings = profileMapping.readingMappings || {};
  const candidateKeys = [
    mapping.key,
    mapping.label,
    pad.id,
    pad.label,
  ].map(normalizedKey).filter(Boolean);
  const configuredMapping = Object.entries(configuredMappings).find(([key]) =>
    candidateKeys.includes(normalizedKey(key))
  )?.[1];

  if (!configuredMapping) return null;

  const templateCandidates = [
    configuredMapping.templateId,
    configuredMapping.readingsTemplateId,
    configuredMapping.universalTemplateId,
    configuredMapping.name,
  ];

  for (const candidate of templateCandidates) {
    const template = templateLookup.get(normalizedKey(candidate));
    if (template) return template;
  }

  if (configuredMapping.templateId || configuredMapping.readingsTemplateId) {
    return {
      id: configuredMapping.templateId || "",
      readingsTemplateId: configuredMapping.readingsTemplateId || configuredMapping.universalTemplateId || "",
      chemType: configuredMapping.chemType || "",
      name: configuredMapping.name || "",
      UOM: configuredMapping.UOM || configuredMapping.unit || "",
    };
  }

  return null;
};

const buildSuggestedReadings = ({
  matches = [],
  padsById,
  bodyOfWaterId = "",
  readingTemplates = [],
  profileMapping = {},
}) => {
  const templateLookup = buildTemplateLookup(readingTemplates);
  const readings = [];

  matches.forEach((match) => {
    const pad = padsById.get(match.padId);
    if (!pad || !match.matchedStop) return;

    const readingMappings = Array.isArray(pad.readingMappings) ? pad.readingMappings : [];

    readingMappings.forEach((mapping) => {
      const template =
        configuredTemplateForMapping(mapping, pad, profileMapping, templateLookup) ||
        templateForMapping(mapping, pad, templateLookup);
      const readingId = `scan_read_${pad.id}_${mapping.key || mapping.label || uuidv4()}`;

      readings.push({
        id: readingId.replace(/[^a-zA-Z0-9_-]/g, "_"),
        templateId: template?.id || "",
        universalTemplateId: template?.readingsTemplateId || template?.universalTemplateId || template?.id || "",
        dosageType: template?.chemType || mapping.key || pad.id || "",
        name: template?.name || mapping.label || pad.label || "Reading",
        amount: String(match.estimatedAmount || match.matchedStop.amount || match.matchedStop.label || ""),
        UOM: template?.UOM || mapping.unit || "",
        bodyOfWaterId,
        scanConfidence: match.confidence,
        scanConfidenceLabel: match.confidenceLabel,
        testerStripPadId: pad.id || "",
        testerStripMatchedStopId: match.matchedStop.id || "",
        testerStripEstimatedAmountSource: match.estimatedAmountSource || "",
        testerStripInterpolatedMatch: match.interpolatedMatch ? {
          leftStopId: match.interpolatedMatch.leftStop?.id || "",
          rightStopId: match.interpolatedMatch.rightStop?.id || "",
          ratio: match.interpolatedMatch.ratio,
          estimatedAmount: match.interpolatedMatch.estimatedAmount,
          deltaE: match.interpolatedMatch.deltaE,
        } : null,
      });
    });
  });

  return readings;
};

const userCanAnalyzeCompany = async (uid, companyId) => {
  const [userSnapshot, accessSnapshot] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("users").doc(uid).collection("userAccess").doc(companyId).get(),
  ]);

  return {
    isAdmin: userSnapshot.exists && userSnapshot.data()?.accountType === "Admin",
    hasCompanyAccess: accessSnapshot.exists,
  };
};

const profileEnabledForCompany = (profile = {}, companyId = "") => {
  if (profile.enabledForAllCompanies === true) return true;
  const enabledCompanyIds = Array.isArray(profile.enabledCompanyIds)
    ? profile.enabledCompanyIds
    : [];

  return enabledCompanyIds.includes(companyId);
};

const getCompanyTesterStripSettings = async (companyId = "") => {
  const snapshot = await db
    .collection("companies")
    .doc(companyId)
    .collection("settings")
    .doc("testerStripProfiles")
    .get();

  return {
    exists: snapshot.exists,
    data: snapshot.exists ? snapshot.data() || {} : {},
  };
};

const profileEnabledByCompanySettings = (settings = {}, profileId = "") => {
  const enabledProfileIds = Array.isArray(settings.enabledProfileIds)
    ? settings.enabledProfileIds
    : [];
  const profileConfig = settings.profileMappings?.[profileId] || {};

  return enabledProfileIds.includes(profileId) || profileConfig.enabled === true;
};

exports.seedAquaChekTesterStripProfile = onCall(async (request) => {
  const payload = getCallablePayload(request.data);
  const authContext = await getVerifiedCallableAuth(payload, request);
  const adminUser = await getRequiredDripDropAdmin(authContext?.uid);
  const profileRef = db
    .collection("universal")
    .doc("settings")
    .collection("testerStripProfiles")
    .doc(AQUACHEK_7_IN_1_PROFILE_ID);

  await profileRef.set({
    ...AQUACHEK_7_IN_1_PROFILE,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByUserId: authContext.uid,
    updatedByName: adminUser.name || adminUser.displayName || "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    status: 200,
    profileId: AQUACHEK_7_IN_1_PROFILE_ID,
    displayName: AQUACHEK_7_IN_1_PROFILE.displayName,
  };
});

exports.analyzeTesterStripScan = onCall(async (request) => {
  const payload = getCallablePayload(request.data);
  const authContext = await getVerifiedCallableAuth(payload, request);

  if (!authContext?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to analyze a tester strip scan.");
  }

  const companyId = String(payload.companyId || "").trim();
  const profileId = String(payload.profileId || "").trim();
  const bodyOfWaterId = String(payload.bodyOfWaterId || "").trim();
  const serviceStopId = String(payload.serviceStopId || "").trim();
  const observedPads = Array.isArray(payload.observedPads) ? payload.observedPads : [];
  const calibration = payload.calibration || {};
  const persist = payload.persist !== false;

  if (!companyId || !profileId) {
    throw new HttpsError("invalid-argument", "companyId and profileId are required.");
  }

  if (!observedPads.length) {
    throw new HttpsError("invalid-argument", "At least one observed pad color is required.");
  }

  const access = await userCanAnalyzeCompany(authContext.uid, companyId);
  if (!access.isAdmin && !access.hasCompanyAccess) {
    throw new HttpsError("permission-denied", "You do not have access to this company.");
  }

  const profileSnapshot = await db
    .collection("universal")
    .doc("settings")
    .collection("testerStripProfiles")
    .doc(profileId)
    .get();

  let profile;
  if (!profileSnapshot.exists && profileId === AQUACHEK_7_IN_1_PROFILE_ID) {
    profile = AQUACHEK_7_IN_1_PROFILE;
  } else if (!profileSnapshot.exists) {
    throw new HttpsError("not-found", "Tester strip profile was not found.");
  } else {
    profile = { id: profileSnapshot.id, ...profileSnapshot.data() };
  }

  if (profile.status !== "active") {
    throw new HttpsError("failed-precondition", "Tester strip profile is not active.");
  }

  const companyTesterStripSettings = await getCompanyTesterStripSettings(companyId);
  const companyProfileMapping = companyTesterStripSettings.data.profileMappings?.[profileId] || {};
  const profileEnabledForRequest = companyTesterStripSettings.exists
    ? profileEnabledByCompanySettings(companyTesterStripSettings.data, profileId)
    : profileEnabledForCompany(profile, companyId);

  if (!access.isAdmin && !profileEnabledForRequest) {
    throw new HttpsError("failed-precondition", "Tester strip profile is not enabled for this company.");
  }

  const pads = Array.isArray(profile.pads) ? profile.pads : [];
  const padsById = new Map(pads.map((pad) => [pad.id, pad]));
  const matches = observedPads
    .map((observedPad, index) => {
      const padId = String(
        observedPad.padId ||
        observedPad.id ||
        observedPad.key ||
        pads[index]?.id ||
        ""
      ).trim();
      const pad = padsById.get(padId);
      const observedHex = observedPad.hex || observedPad.observedHex;

      if (!pad || !observedHex) return null;
      return matchPadColor(pad, observedHex, calibration, profile.lightingNormalization || {});
    })
    .filter(Boolean);

  if (!matches.length) {
    throw new HttpsError("invalid-argument", "No observed pad colors matched this profile.");
  }

  const readingTemplatesSnapshot = await db
    .collection("companies")
    .doc(companyId)
    .collection("settings")
    .doc("readings")
    .collection("readings")
    .get();
  const readingTemplates = readingTemplatesSnapshot.docs.map((readingDoc) => ({
    id: readingDoc.id,
    ...readingDoc.data(),
  }));
  const suggestedReadings = buildSuggestedReadings({
    matches,
    padsById,
    bodyOfWaterId,
    readingTemplates,
    profileMapping: companyProfileMapping,
  });
  const scanId = String(payload.scanId || `tester_strip_scan_${uuidv4()}`).trim();
  const response = {
    status: 200,
    scanId,
    companyId,
    profileId,
    serviceStopId,
    bodyOfWaterId,
    scanImagePath: payload.scanImagePath || "",
    padMatches: matches,
    suggestedReadings,
    needsReview: matches.some((match) => match.confidenceLabel !== "High"),
  };

  if (persist) {
    await db
      .collection("companies")
      .doc(companyId)
      .collection("testerStripScans")
      .doc(scanId)
      .set({
        ...response,
        observedPads,
        calibration,
        createdByUserId: authContext.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
  }

  return response;
});
