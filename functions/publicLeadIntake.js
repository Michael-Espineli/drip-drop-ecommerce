const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const { v4: uuidv4 } = require("uuid");
const { maskEmail } = require("./customerAccountInvites");
const { resolveEmailDeliveryRecipient } = require("./emailDelivery");

const PUBLIC_LEAD_VERIFICATION_COLLECTION = "publicLeadVerifications";
const PUBLIC_LEAD_VERIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_LEAD_CALLABLE_CORS_ORIGINS = [
  "https://dripdrop-poolapp.com",
  "https://www.dripdrop-poolapp.com",
  "https://the-pool-app-3e652.web.app",
  "https://the-pool-app-3e652.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3020",
  "http://localhost:3021",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3020",
  "http://127.0.0.1:3021",
];
const publicLeadCallableOptions = {
  cors: PUBLIC_LEAD_CALLABLE_CORS_ORIGINS,
};

if (process.env.SEND_GRID_API_KEY && process.env.SEND_GRID_API_KEY.startsWith("SG.")) {
  sgMail.setApiKey(process.env.SEND_GRID_API_KEY);
}

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const getCallablePayload = (data) => data?.data ?? data ?? {};

const getCallableContext = (request = {}) => ({
  auth: request.auth,
  rawRequest: request.rawRequest,
});

const cleanText = (value, maxLength = 500) => (
  String(value || "").trim().slice(0, maxLength)
);

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }

  return "";
};

const firstTextWithLimit = (maxLength, ...values) => {
  for (const value of values) {
    const text = cleanText(value, maxLength);
    if (text) return text;
  }

  return "";
};

const escapeHtml = (value = "") => (
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
);

const removeUndefinedDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedDeep).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (typeof value.toDate === "function") return value;
    if (value.constructor && value.constructor.name !== "Object") return value;

    return Object.entries(value).reduce((clean, [key, item]) => {
      const cleanedValue = removeUndefinedDeep(item);
      if (cleanedValue !== undefined) clean[key] = cleanedValue;
      return clean;
    }, {});
  }

  return value === undefined ? undefined : value;
};

const getAppBaseUrl = (preferredBaseUrl = "") => (
  String(preferredBaseUrl || process.env.APP_BASE_URL || "https://dripdrop-poolapp.com")
    .trim()
    .replace(/\/+$/, "")
);

const buildUrl = (baseUrl, path, query = {}) => {
  const cleanBaseUrl = getAppBaseUrl(baseUrl);
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path || ""}`;
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return `${cleanBaseUrl}${cleanPath}${queryString ? `?${queryString}` : ""}`;
};

const buildPublicLeadIntakeUrl = (baseUrl, companyId) => (
  buildUrl(baseUrl, `/request-service/${companyId}`)
);

const buildPublicLeadVerificationUrl = (baseUrl, verificationId, email = "") => (
  buildUrl(baseUrl, `/public-service-request/verify/${verificationId}`, { email })
);

const getCompanyDisplayName = (company = {}) => (
  firstText(company.name, company.companyName, company.displayName, "Pool company")
);

const getCompanyContact = (company = {}) => ({
  email: firstText(company.email, company.companyEmail, company.billingEmail, company.mainContact?.email),
  phone: firstText(company.phoneNumber, company.phone, company.mainContact?.phoneNumber),
  website: firstText(company.websiteURL, company.website, company.websiteUrl, company.url),
});

const normalizeStringArray = (value, maxItems = 12) => {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, maxItems);
  }

  if (typeof value === "string") {
    return value.split(",").map((item) => cleanText(item, 120)).filter(Boolean).slice(0, maxItems);
  }

  return [];
};

const getSafeCompanySummary = (company = {}, companyId = "", baseUrl = "") => {
  const contact = getCompanyContact(company);
  const services = normalizeStringArray(company.services, 12);

  return {
    id: companyId,
    name: getCompanyDisplayName(company),
    logoUrl: firstText(company.logoUrl, company.logoURL, company.photoUrl, company.imageUrl),
    photoUrl: firstText(company.photoUrl, company.logoUrl, company.logoURL, company.imageUrl),
    phone: contact.phone,
    phoneNumber: contact.phone,
    email: contact.email,
    website: contact.website,
    websiteURL: contact.website,
    publicHeaderImageUrl: firstText(
      company.publicHeaderImageUrl,
      company.headerImageUrl,
      company.coverPhotoUrl,
      company.coverImageUrl,
      company.backgroundImageUrl
    ),
    bio: firstText(company.bio, company.description, company.about, company.mission).slice(0, 480),
    ownerName: firstText(company.ownerName),
    verified: Boolean(company.verified),
    services,
    serviceAreas: normalizeStringArray(company.serviceAreas, 12),
    serviceZipCodes: normalizeStringArray(company.serviceZipCodes, 20),
    region: firstText(company.region),
    profileUrl: buildUrl(baseUrl, `/companies/profile/${companyId}`),
    publicLeadIntakeUrl: buildPublicLeadIntakeUrl(baseUrl, companyId),
  };
};

const normalizeAddress = (payload = {}) => {
  const address = payload.serviceLocationAddress || payload.address || {};

  return removeUndefinedDeep({
    streetAddress: firstText(address.streetAddress, address.address, payload.streetAddress),
    city: firstText(address.city, payload.city),
    state: firstText(address.state, payload.state),
    zip: firstText(address.zip, address.zipCode, payload.zip, payload.zipCode),
    zipCode: firstText(address.zipCode, address.zip, payload.zipCode, payload.zip),
    latitude: address.latitude ?? payload.latitude ?? null,
    longitude: address.longitude ?? payload.longitude ?? null,
  });
};

const normalizeEquipment = (equipment = {}, index = 0) => removeUndefinedDeep({
  id: cleanText(equipment.id, 80) || `public_equipment_${index + 1}`,
  name: firstText(equipment.name, equipment.type, "Equipment"),
  type: firstText(equipment.type, equipment.category),
  make: firstText(equipment.make),
  model: firstText(equipment.model),
  notes: firstTextWithLimit(500, equipment.notes, equipment.description),
  needsService: Boolean(equipment.needsService),
});

const normalizeBodiesOfWater = (value) => {
  const bodies = Array.isArray(value) ? value : [];

  return bodies.slice(0, 8).map((body = {}, bodyIndex) => {
    const equipment = Array.isArray(body.equipment)
      ? body.equipment.slice(0, 12).map((item, equipmentIndex) => normalizeEquipment(item, equipmentIndex))
      : [];

    return removeUndefinedDeep({
      id: cleanText(body.id, 80) || `public_body_${bodyIndex + 1}`,
      name: firstText(body.name, body.type, body.bodyOfWaterType, `Pool / Spa ${bodyIndex + 1}`),
      type: firstText(body.type, body.bodyOfWaterType),
      sizeCategory: firstText(body.sizeCategory, body.size),
      gallons: firstText(body.gallons, body.volume),
      waterType: firstText(body.waterType),
      condition: firstText(body.condition, body.waterCondition),
      material: firstText(body.material, body.surface),
      shape: firstText(body.shape),
      length: firstText(body.length),
      width: firstText(body.width),
      depth: firstText(body.depth),
      notes: firstText(body.notes, body.description),
      equipment,
    });
  });
};

const normalizeFlatEquipment = (value) => {
  const equipment = Array.isArray(value) ? value : [];
  return equipment.slice(0, 16).map((item, index) => normalizeEquipment(item, index));
};

const getVerifiedCallableAuth = async (payload = {}, context = {}) => {
  if (context.auth?.uid) {
    return {
      uid: context.auth.uid,
      token: context.auth.token || {},
    };
  }

  const authorizationHeader =
    context.rawRequest?.headers?.authorization ||
    context.rawRequest?.headers?.Authorization ||
    "";
  const bearerToken = String(authorizationHeader).startsWith("Bearer ")
    ? String(authorizationHeader).slice("Bearer ".length).trim()
    : "";
  const idToken = [
    payload.idToken,
    payload.auth?.idToken,
    payload.data?.idToken,
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
    console.error("Unable to verify public lead callable auth token", error);
    return null;
  }
};

const getAuthEmail = async (authContext = {}) => {
  const tokenEmail = normalizeEmail(authContext.token?.email);
  if (tokenEmail) return tokenEmail;

  if (!authContext.uid) return "";

  try {
    const authUser = await admin.auth().getUser(authContext.uid);
    return normalizeEmail(authUser.email);
  } catch (error) {
    console.warn("Unable to load auth user email for public lead claim", error);
    return "";
  }
};

const getTimestampDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isVerificationExpired = (verification = {}) => {
  const expiresAt = getTimestampDate(verification.expiresAt);
  return Boolean(expiresAt && expiresAt.getTime() < Date.now());
};

const sendPublicLeadVerificationEmail = async ({
  company = {},
  homeownerName = "",
  to = "",
  verificationUrl = "",
  serviceName = "",
}) => {
  if (!process.env.SEND_GRID_API_KEY || !process.env.SEND_GRID_API_KEY.startsWith("SG.")) {
    return { sent: false, reason: "missingSendGridKey" };
  }

  const companyName = getCompanyDisplayName(company);
  const companyContact = getCompanyContact(company);
  const fromEmail = process.env.SEND_GRID_FROM_EMAIL || "info@dripdrop-poolapp.com";
  const replyToEmail = companyContact.email || fromEmail;
  const emailDelivery = await resolveEmailDeliveryRecipient(to);
  const subject = `Confirm your service request with ${companyName}`;
  const preHeader = "Your service request was received. Connect it to a Drip Drop homeowner account if you want to track it.";
  const safeHomeownerName = firstText(homeownerName, "there");
  const safeServiceName = firstText(serviceName, "service request");
  const safeCompanyNameHtml = escapeHtml(companyName);
  const safeHomeownerNameHtml = escapeHtml(safeHomeownerName);
  const safeServiceNameHtml = escapeHtml(safeServiceName);
  const safeVerificationUrlHtml = escapeHtml(verificationUrl);
  const safeCompanyPhoneHtml = escapeHtml(companyContact.phone);
  const safeCompanyEmailHtml = escapeHtml(companyContact.email);
  const safeCompanyWebsiteHtml = escapeHtml(companyContact.website);
  const safePreHeaderHtml = escapeHtml(preHeader);
  const safeIntendedToHtml = escapeHtml(emailDelivery.intendedTo || "unknown recipient");
  const testModeText = emailDelivery.testMode
    ? `TEST MODE: intended recipient was ${emailDelivery.intendedTo || "unknown recipient"}.\n\n`
    : "";
  const testModeHtml = emailDelivery.testMode
    ? `
        <div style="background-color:#FFF8E6; border-bottom:1px solid #F1D794; color:#6B4A00; font-size:13px; line-height:20px; padding:12px 16px; text-align:center;">
          Test mode: intended recipient was ${safeIntendedToHtml}.
        </div>
      `
    : "";

  const contactTextLines = [
    companyContact.phone ? `Company phone: ${companyContact.phone}` : "",
    companyContact.email ? `Company email: ${companyContact.email}` : "",
  ].filter(Boolean);
  const text = [
    `${testModeText}Hi ${safeHomeownerName},`,
    "",
    `We received your ${safeServiceName} request for ${companyName}.`,
    "Your request has been sent to the company.",
    "",
    "Optional next step:",
    "Connect this request to a Drip Drop homeowner account so you can track it later.",
    verificationUrl,
    "",
    ...contactTextLines,
    ...(contactTextLines.length ? [""] : []),
    "If you did not submit this request, you can ignore this email.",
  ].join("\n");

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>Service Request Received</title>
      </head>
      <body style="margin:0; padding:0; background-color:#F3F5F8; font-family:Arial, Helvetica, sans-serif; color:#172033;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
          ${safePreHeaderHtml}
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F5F8; margin:0; padding:0;">
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px; background-color:#FFFFFF; border-radius:18px; overflow:hidden; box-shadow:0 8px 24px rgba(15,23,42,0.08);">
                ${testModeHtml}
                <tr>
                  <td style="background-color:#1D2E76; padding:30px 28px 26px 28px; text-align:left;">
                    <div style="font-size:13px; line-height:18px; color:#E0AE36; font-weight:bold; letter-spacing:0.8px; text-transform:uppercase;">
                      Service Request Received
                    </div>
                    <h1 style="margin:8px 0 0 0; font-size:28px; line-height:34px; color:#FFFFFF; font-weight:700;">
                      We sent your request to ${safeCompanyNameHtml}
                    </h1>
                    <p style="margin:10px 0 0 0; font-size:15px; line-height:22px; color:#DDE5FF;">
                      Hi ${safeHomeownerNameHtml}, connect this request to a homeowner account if you want to track it later.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 24px 10px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC; border:1px solid #E6EAF0; border-radius:14px;">
                      <tr>
                        <td style="padding:20px;">
                          <table width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding-bottom:14px;">
                                <div style="font-size:13px; line-height:18px; color:#687386; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px;">
                                  Request Summary
                                </div>
                                <div style="font-size:18px; line-height:26px; color:#172033; font-weight:700; margin-top:4px;">
                                  ${safeServiceNameHtml}
                                </div>
                                <div style="font-size:15px; line-height:22px; color:#4B5565;">
                                  ${safeCompanyNameHtml}
                                </div>
                              </td>
                            </tr>
                            <tr>
                              <td style="border-top:1px solid #E6EAF0; padding-top:14px;">
                                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                  <tr>
                                    <td width="50%" style="padding-right:8px; vertical-align:top;">
                                      <div style="font-size:12px; line-height:16px; color:#687386; font-weight:bold; text-transform:uppercase;">
                                        Submitted by
                                      </div>
                                      <div style="font-size:15px; line-height:22px; color:#172033; font-weight:700;">
                                        ${safeHomeownerNameHtml}
                                      </div>
                                    </td>
                                    <td width="50%" style="padding-left:8px; vertical-align:top;">
                                      <div style="font-size:12px; line-height:16px; color:#687386; font-weight:bold; text-transform:uppercase;">
                                        Next step
                                      </div>
                                      <div style="font-size:15px; line-height:22px; color:#172033; font-weight:700;">
                                        Connect account
                                      </div>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:14px 24px 24px 24px;">
                    <p style="margin:0 0 16px 0; font-size:15px; line-height:24px; color:#374151;">
                      Your service request is already in ${safeCompanyNameHtml}'s lead queue. Creating or signing into a homeowner account is optional, but it helps you keep the request connected to your pool profile in Drip Drop.
                    </p>
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#E0AE36; border-radius:999px;">
                          <a href="${safeVerificationUrlHtml}" target="_blank" style="display:inline-block; padding:13px 22px; font-size:15px; line-height:20px; color:#172033; text-decoration:none; font-weight:700;">
                            Connect Request
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 24px 22px 24px;">
                    <h2 style="margin:0 0 12px 0; font-size:20px; line-height:26px; color:#1D2E76;">
                      Company Contact
                    </h2>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF0; border-radius:14px; overflow:hidden;">
                      ${companyContact.phone ? `
                      <tr>
                        <td style="padding:14px 16px; border-bottom:1px solid #E6EAF0; font-size:13px; line-height:18px; color:#687386; font-weight:bold; text-transform:uppercase;">
                          Phone
                        </td>
                        <td align="right" style="padding:14px 16px; border-bottom:1px solid #E6EAF0; font-size:15px; line-height:20px; color:#172033; font-weight:700;">
                          ${safeCompanyPhoneHtml}
                        </td>
                      </tr>
                      ` : ""}
                      ${companyContact.email ? `
                      <tr>
                        <td style="padding:14px 16px; border-bottom:1px solid #E6EAF0; font-size:13px; line-height:18px; color:#687386; font-weight:bold; text-transform:uppercase;">
                          Email
                        </td>
                        <td align="right" style="padding:14px 16px; border-bottom:1px solid #E6EAF0; font-size:15px; line-height:20px; color:#172033; font-weight:700;">
                          ${safeCompanyEmailHtml}
                        </td>
                      </tr>
                      ` : ""}
                      ${companyContact.website ? `
                      <tr>
                        <td style="padding:14px 16px; font-size:13px; line-height:18px; color:#687386; font-weight:bold; text-transform:uppercase;">
                          Website
                        </td>
                        <td align="right" style="padding:14px 16px; font-size:15px; line-height:20px; color:#172033; font-weight:700;">
                          ${safeCompanyWebsiteHtml}
                        </td>
                      </tr>
                      ` : ""}
                      ${!companyContact.phone && !companyContact.email && !companyContact.website ? `
                      <tr>
                        <td style="padding:14px 16px; font-size:15px; line-height:22px; color:#4B5565;">
                          The company will use the contact information from your request.
                        </td>
                      </tr>
                      ` : ""}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 24px 24px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF8E6; border:1px solid #F1D794; border-radius:14px;">
                      <tr>
                        <td style="padding:16px;">
                          <div style="font-size:14px; line-height:22px; color:#6B4A00;">
                            If the button does not work, paste this link into your browser:
                          </div>
                          <div style="font-size:13px; line-height:20px; color:#1D2E76; word-break:break-all; margin-top:6px;">
                            <a href="${safeVerificationUrlHtml}" target="_blank" style="color:#1D2E76; text-decoration:underline;">${safeVerificationUrlHtml}</a>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="background-color:#F8FAFC; border-top:1px solid #E6EAF0; padding:18px 24px; text-align:center;">
                    <p style="margin:0; font-size:12px; line-height:18px; color:#687386;">
                      You received this email because someone submitted a service request using this email address. If that was not you, you can ignore it.
                    </p>
                    <p style="margin:10px 0 0 0; font-size:12px; line-height:18px; color:#687386;">
                      Powered by Drip Drop
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  await sgMail.send({
    to: emailDelivery.actualTo,
    from: fromEmail,
    replyTo: replyToEmail,
    subject,
    text,
    html,
  });

  return {
    sent: true,
    reason: "",
    emailDelivery: {
      to: emailDelivery.actualTo,
      intendedTo: emailDelivery.intendedTo,
      testMode: emailDelivery.testMode,
      realEmailsFeatureFlagId: emailDelivery.realEmailsFeatureFlagId,
      realEmailsEnabled: emailDelivery.realEmailsEnabled,
    },
  };
};

exports.getPublicLeadIntakeCompany = onCall(publicLeadCallableOptions, async (request) => {
  try {
    const payload = getCallablePayload(request.data);
    const companyId = cleanText(payload.companyId, 160);

    if (!companyId) {
      return { status: 400, error: "Missing companyId" };
    }

    const firestore = admin.firestore();
    const companySnap = await firestore.collection("companies").doc(companyId).get();

    if (!companySnap.exists) {
      return { status: 404, error: "Company not found" };
    }

    const company = companySnap.data() || {};

    return {
      status: 200,
      company: getSafeCompanySummary(company, companyId, payload.baseUrl || payload.appBaseUrl || ""),
    };
  } catch (error) {
    console.error("Error loading public lead intake company", error);
    return {
      status: 500,
      error: error.message || "Could not load company intake information",
    };
  }
});

exports.listPublicCompanies = onCall(publicLeadCallableOptions, async (request) => {
  try {
    const payload = getCallablePayload(request.data);
    const baseUrl = payload.baseUrl || payload.appBaseUrl || "";
    const searchTerm = cleanText(payload.searchTerm, 120).toLowerCase();
    const requestedLimit = Number(payload.limit);
    const maxResults = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 80, 1), 120);

    const firestore = admin.firestore();
    const companiesSnap = await firestore.collection("companies").limit(300).get();
    const companies = [];

    companiesSnap.docs.forEach((companyDoc) => {
      const company = companyDoc.data() || {};

      if (company.hideFromBrowse === true || company.publicProfileDisabled === true || company.deleted === true) {
        return;
      }

      const summary = getSafeCompanySummary(company, companyDoc.id, baseUrl);
      const searchableText = [
        summary.name,
        summary.bio,
        summary.region,
        summary.services.join(" "),
        summary.serviceAreas.join(" "),
        summary.serviceZipCodes.join(" "),
      ].join(" ").toLowerCase();

      if (searchTerm && !searchableText.includes(searchTerm)) {
        return;
      }

      companies.push(summary);
    });

    companies.sort((left, right) => {
      if (left.verified !== right.verified) return left.verified ? -1 : 1;
      return String(left.name || "").localeCompare(String(right.name || ""));
    });

    return {
      status: 200,
      companies: companies.slice(0, maxResults),
      totalCount: companies.length,
    };
  } catch (error) {
    console.error("Error loading public companies", error);
    return {
      status: 500,
      error: error.message || "Could not load public companies",
    };
  }
});

exports.submitPublicServiceRequestLead = onCall(publicLeadCallableOptions, async (request) => {
  try {
    const payload = getCallablePayload(request.data);
    const companyId = cleanText(payload.companyId, 160);
    const homeownerName = firstText(payload.homeownerName, payload.name, `${payload.firstName || ""} ${payload.lastName || ""}`);
    const homeownerEmail = normalizeEmail(payload.homeownerEmail || payload.email);
    const homeownerPhone = firstText(payload.homeownerPhone, payload.phone, payload.phoneNumber);
    const serviceLocationAddress = normalizeAddress(payload);
    const serviceType = firstText(payload.serviceType, payload.requestType, payload.serviceName);
    const serviceName = firstText(payload.serviceName, serviceType, "Public Service Request");
    const serviceDescription = firstTextWithLimit(3000, payload.serviceDescription, payload.description, payload.notes);

    if (!companyId) return { status: 400, error: "Missing companyId" };
    if (!homeownerName) return { status: 400, error: "Please provide your name" };
    if (!homeownerEmail || !homeownerEmail.includes("@")) return { status: 400, error: "Please provide a valid email address" };
    if (!homeownerPhone) return { status: 400, error: "Please provide a phone number" };
    if (!serviceLocationAddress.streetAddress) return { status: 400, error: "Please provide the service address" };
    if (!serviceDescription) return { status: 400, error: "Please describe the requested service" };

    const firestore = admin.firestore();
    const companyRef = firestore.collection("companies").doc(companyId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      return { status: 404, error: "Company not found" };
    }

    const company = companySnap.data() || {};
    const baseUrl = payload.baseUrl || payload.appBaseUrl || "";
    const leadId = `hosr_${uuidv4()}`;
    const verificationId = `plv_${uuidv4()}`;
    const verificationUrl = buildPublicLeadVerificationUrl(baseUrl, verificationId, homeownerEmail);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + PUBLIC_LEAD_VERIFICATION_TTL_MS));
    const bodiesOfWater = normalizeBodiesOfWater(payload.bodiesOfWater);
    const flatEquipment = normalizeFlatEquipment(payload.equipment);
    const leadIntake = removeUndefinedDeep({
      source: "publicNoAccount",
      formVersion: "public-lead-intake-v1",
      submittedFromUrl: cleanText(payload.submittedFromUrl || payload.sourceUrl, 500),
      preferredContactMethod: firstText(payload.preferredContactMethod),
      bestTimeToContact: firstText(payload.bestTimeToContact),
      preferredStartDate: firstText(payload.preferredStartDate),
      urgency: firstText(payload.urgency),
      serviceType,
      propertyType: firstText(payload.propertyType),
      treeTypes: firstText(payload.treeTypes),
      treeDebrisLevel: firstText(payload.treeDebrisLevel),
      overhangingTrees: firstText(payload.overhangingTrees),
      currentProvider: firstText(payload.currentProvider),
      gateCode: firstText(payload.gateCode),
      accessNotes: firstText(payload.accessNotes),
      petsOnProperty: firstText(payload.petsOnProperty),
      bodiesOfWater,
      equipment: flatEquipment,
      customerMessage: serviceDescription,
    });
    const companySummary = getSafeCompanySummary(company, companyId, baseUrl);
    const leadRef = firestore.collection("homeownerServiceRequests").doc(leadId);
    const verificationRef = firestore.collection(PUBLIC_LEAD_VERIFICATION_COLLECTION).doc(verificationId);

    await firestore.runTransaction(async (transaction) => {
      transaction.set(leadRef, removeUndefinedDeep({
        id: leadId,
        source: "Public",
        sourceType: "publicNoAccount",
        requestOrigin: "publicNoAccount",
        publicLead: true,
        status: "Pending",
        createdAt: now,
        updatedAt: now,
        companyId,
        companyName: companySummary.name,
        companySummary: {
          id: companySummary.id,
          name: companySummary.name,
          logoUrl: companySummary.logoUrl,
          photoUrl: companySummary.photoUrl,
          phoneNumber: companySummary.phoneNumber,
          email: companySummary.email,
          websiteURL: companySummary.websiteURL,
          bio: companySummary.bio,
          verified: companySummary.verified,
          services: companySummary.services.slice(0, 8),
          profileUrl: companySummary.profileUrl,
        },
        serviceDescription,
        serviceName,
        serviceType,
        serviceLocationAddress,
        creatorId: "",
        creatorName: homeownerName,
        creatorEmail: homeownerEmail,
        creatorPhone: homeownerPhone,
        customerId: "",
        customerName: "",
        customerUserId: "",
        homeownerName,
        homeownerEmail,
        homeownerPhone,
        homeownerId: "",
        homeownerUserId: "",
        homeownerServiceLocationId: "",
        homeownerBodyOfWaterId: "",
        homeownerEquipmentId: "",
        relationshipId: "",
        customerCompanyRelationshipId: "",
        requestType: firstText(payload.requestType, "service"),
        leadIntake,
        publicLeadIntake: leadIntake,
        publicLeadVerificationId: verificationId,
        publicLeadVerificationStatus: "pending",
        homeownerEmailVerified: false,
        dateCompleted: null,
      }));

      transaction.set(verificationRef, removeUndefinedDeep({
        id: verificationId,
        source: "publicServiceRequestLead",
        companyId,
        companyName: companySummary.name,
        leadId,
        homeownerName,
        email: homeownerEmail,
        maskedEmail: maskEmail(homeownerEmail),
        status: "pending",
        claimed: false,
        verificationUrl,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      }));
    });

    let verificationEmail = { sent: false, reason: "" };
    try {
      verificationEmail = await sendPublicLeadVerificationEmail({
        company,
        homeownerName,
        to: homeownerEmail,
        verificationUrl,
        serviceName,
      });
    } catch (emailError) {
      console.error("Public lead verification email failed", {
        companyId,
        leadId,
        verificationId,
        error: emailError.message || String(emailError),
      });
      verificationEmail = { sent: false, reason: "sendFailed" };
    }

    await verificationRef.set({
      emailSent: verificationEmail.sent,
      emailSendReason: verificationEmail.reason || "",
      emailSentAt: verificationEmail.sent ? now : null,
      emailDelivery: verificationEmail.emailDelivery || null,
    }, { merge: true });

    return {
      status: 200,
      leadId,
      companyId,
      verificationId,
      verificationUrl,
      verificationEmailSent: verificationEmail.sent,
      maskedEmail: maskEmail(homeownerEmail),
    };
  } catch (error) {
    console.error("Error submitting public service request lead", error);
    return {
      status: 500,
      error: error.message || "Could not submit service request",
    };
  }
});

exports.getPublicLeadVerificationPreview = onCall(publicLeadCallableOptions, async (request) => {
  try {
    const payload = getCallablePayload(request.data);
    const verificationId = cleanText(payload.verificationId || payload.id, 160);

    if (!verificationId) {
      return { status: 400, error: "Missing verification id" };
    }

    const firestore = admin.firestore();
    const verificationRef = firestore.collection(PUBLIC_LEAD_VERIFICATION_COLLECTION).doc(verificationId);
    const verificationSnap = await verificationRef.get();

    if (!verificationSnap.exists) {
      return { status: 404, error: "Verification link not found" };
    }

    const verification = { id: verificationSnap.id, ...verificationSnap.data() };
    const [companySnap, leadSnap] = await Promise.all([
      verification.companyId ? firestore.collection("companies").doc(verification.companyId).get() : null,
      verification.leadId ? firestore.collection("homeownerServiceRequests").doc(verification.leadId).get() : null,
    ]);
    const company = companySnap?.exists ? companySnap.data() || {} : {};
    const lead = leadSnap?.exists ? leadSnap.data() || {} : {};
    const expired = isVerificationExpired(verification);
    const status = String(verification.status || "").toLowerCase();

    return {
      status: 200,
      verification: {
        id: verificationId,
        status: verification.status || "pending",
        claimed: verification.claimed === true || status === "claimed",
        expired,
        maskedEmail: verification.maskedEmail || maskEmail(verification.email),
        email: normalizeEmail(verification.email),
      },
      company: getSafeCompanySummary(company, verification.companyId || "", payload.baseUrl || payload.appBaseUrl || ""),
      request: {
        id: verification.leadId || "",
        serviceName: lead.serviceName || "Service request",
        serviceDescription: lead.serviceDescription || "",
        status: lead.status || "Pending",
        submittedName: lead.homeownerName || verification.homeownerName || "",
        addressSummary: [
          lead.serviceLocationAddress?.streetAddress,
          lead.serviceLocationAddress?.city,
          lead.serviceLocationAddress?.state,
          lead.serviceLocationAddress?.zip || lead.serviceLocationAddress?.zipCode,
        ].filter(Boolean).join(", "),
        clientWebPath: verification.leadId ? `/client/service-requests/${verification.leadId}` : "/client/service-requests",
      },
      canClaim: !expired && !(verification.claimed === true || status === "claimed"),
    };
  } catch (error) {
    console.error("Error loading public lead verification preview", error);
    return {
      status: 500,
      error: error.message || "Could not load verification link",
    };
  }
});

exports.claimPublicServiceRequestLead = onCall(publicLeadCallableOptions, async (request) => {
  try {
    const payload = getCallablePayload(request.data);
    const authContext = await getVerifiedCallableAuth(payload, getCallableContext(request));
    const authUserId = authContext?.uid;
    const verificationId = cleanText(payload.verificationId || payload.id, 160);

    if (!authUserId) {
      return { status: 401, error: "You must be signed in with a homeowner account to connect this request" };
    }

    if (!verificationId) {
      return { status: 400, error: "Missing verification id" };
    }

    const authEmail = await getAuthEmail(authContext);
    const firestore = admin.firestore();
    const verificationRef = firestore.collection(PUBLIC_LEAD_VERIFICATION_COLLECTION).doc(verificationId);
    const verificationSnap = await verificationRef.get();

    if (!verificationSnap.exists) {
      return { status: 404, error: "Verification link not found" };
    }

    const verification = { id: verificationSnap.id, ...verificationSnap.data() };

    if (isVerificationExpired(verification)) {
      return { status: 410, error: "This verification link has expired. Please submit a new service request." };
    }

    const verificationEmail = normalizeEmail(verification.email);
    if (verificationEmail && authEmail && verificationEmail !== authEmail) {
      return { status: 403, error: "Sign in with the email address that submitted this service request." };
    }

    if (!verification.leadId) {
      return { status: 400, error: "Verification link is missing the service request" };
    }

    const leadRef = firestore.collection("homeownerServiceRequests").doc(verification.leadId);
    const leadSnap = await leadRef.get();

    if (!leadSnap.exists) {
      return { status: 404, error: "Service request not found" };
    }

    const lead = leadSnap.data() || {};
    const status = String(verification.status || "").toLowerCase();

    if ((verification.claimed === true || status === "claimed") && lead.homeownerId && lead.homeownerId !== authUserId) {
      return { status: 409, error: "This service request is already connected to another homeowner account." };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = firestore.batch();

    batch.set(leadRef, removeUndefinedDeep({
      homeownerId: authUserId,
      homeownerUserId: authUserId,
      customerUserId: authUserId,
      creatorId: lead.creatorId || authUserId,
      homeownerEmail: verificationEmail || lead.homeownerEmail || authEmail,
      homeownerEmailVerified: true,
      homeownerEmailVerifiedAt: now,
      publicLeadVerificationStatus: "claimed",
      publicLeadClaimedAt: now,
      publicLeadClaimedByUserId: authUserId,
      updatedAt: now,
    }), { merge: true });

    batch.set(verificationRef, removeUndefinedDeep({
      status: "claimed",
      claimed: true,
      claimedAt: now,
      claimedByUserId: authUserId,
      homeownerId: authUserId,
      updatedAt: now,
    }), { merge: true });

    await batch.commit();

    return {
      status: 200,
      leadId: verification.leadId,
      companyId: verification.companyId || lead.companyId || "",
      clientWebPath: `/client/service-requests/${verification.leadId}`,
    };
  } catch (error) {
    console.error("Error claiming public service request lead", error);
    return {
      status: 500,
      error: error.message || "Could not connect this service request",
    };
  }
});
