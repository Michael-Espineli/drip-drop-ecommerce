const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const LINKED_INVITE_COLLECTION = "linkedInvite";
const CUSTOMER_ACCOUNT_INVITE_TYPE = "customerAccountClaim";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

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

const buildCustomerAccountInviteUrl = (baseUrl, inviteId) => (
  inviteId ? buildUrl(baseUrl, `/client/customer-account-invite/${inviteId}`) : ""
);

const getCustomerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return customer.companyName || customer.company || customer.displayName || "Customer";
  }

  return (
    customer.name ||
    customer.displayName ||
    `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
    customer.companyName ||
    "Customer"
  );
};

const getCompanyDisplayName = (company = {}) => (
  company.name || company.companyName || company.displayName || "Pool company"
);

const getCustomerEmail = (customer = {}) => (
  customer.email ||
  customer.billingEmail ||
  customer.mainContact?.email ||
  customer.contact?.email ||
  ""
);

const getCompanyContact = (company = {}) => ({
  email: company.email || company.companyEmail || company.billingEmail || company.mainContact?.email || "",
  phone: company.phoneNumber || company.phone || company.mainContact?.phoneNumber || "",
  website: company.website || company.websiteUrl || company.url || "",
});

const maskEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) return "";

  const [name, domain] = normalized.split("@");
  const safeName = name.length <= 2 ? `${name.slice(0, 1)}*` : `${name.slice(0, 2)}***`;
  return `${safeName}@${domain}`;
};

const formatAddressSummary = (address = {}) => (
  [
    address.streetAddress || address.address || "",
    address.city || "",
    address.state || "",
    address.zip || address.zipCode || "",
  ].filter(Boolean).join(", ")
);

const getLinkedCustomerIds = (customer = {}) => (
  Array.isArray(customer.linkedCustomerIds)
    ? customer.linkedCustomerIds.filter(Boolean)
    : []
);

const getInviteDoc = async (inviteId) => {
  if (!inviteId) return null;

  const firestore = admin.firestore();
  const inviteRef = firestore.collection(LINKED_INVITE_COLLECTION).doc(inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) return null;

  return {
    ref: inviteRef,
    snap: inviteSnap,
    data: { id: inviteSnap.id, ...inviteSnap.data() },
  };
};

const reusableInviteDoc = async ({ inviteId, companyId, customerId }) => {
  const inviteDoc = await getInviteDoc(inviteId);
  if (!inviteDoc) return null;

  const invite = inviteDoc.data || {};
  const status = String(invite.status || "").toLowerCase();
  if (invite.companyId !== companyId || invite.customerId !== customerId) return null;
  if (invite.accepted === true || status === "accepted" || status === "revoked") return null;

  return inviteDoc;
};

const ensureCustomerAccountInvite = async ({
  companyId,
  customerId,
  createdByUserId = "",
  source = "companyCustomerInvite",
  baseUrl = "",
  email = "",
  forceNew = false,
} = {}) => {
  const firestore = admin.firestore();

  if (!companyId || !customerId) {
    return {
      status: 400,
      error: "Missing companyId or customerId",
    };
  }

  const companyRef = firestore.collection("companies").doc(companyId);
  const customerRef = companyRef.collection("customers").doc(customerId);
  const [companySnap, customerSnap] = await Promise.all([
    companyRef.get(),
    customerRef.get(),
  ]);

  if (!companySnap.exists) {
    return { status: 404, error: "Company not found" };
  }

  if (!customerSnap.exists) {
    return { status: 404, error: "Company customer not found" };
  }

  const company = companySnap.data() || {};
  const customer = customerSnap.data() || {};
  const companyName = getCompanyDisplayName(company);
  const customerName = getCustomerDisplayName(customer);
  const customerEmail = normalizeEmail(email || getCustomerEmail(customer));
  const existingInviteId = customer.customerAccountInviteId || customer.linkedInviteId || "";
  const existingInvite = forceNew
    ? null
    : await reusableInviteDoc({ inviteId: existingInviteId, companyId, customerId });
  const inviteId = existingInvite?.snap?.id || `hoci_${uuidv4()}`;
  const inviteRef = firestore.collection(LINKED_INVITE_COLLECTION).doc(inviteId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const inviteUrl = buildCustomerAccountInviteUrl(baseUrl, inviteId);
  const allowTokenClaim = !customerEmail;
  const invitePayload = {
    id: inviteId,
    type: CUSTOMER_ACCOUNT_INVITE_TYPE,
    inviteType: CUSTOMER_ACCOUNT_INVITE_TYPE,
    source,
    companyId,
    companyName,
    customerId,
    customerName,
    email: customerEmail,
    customerEmail,
    status: "pending",
    accepted: false,
    allowTokenClaim,
    claimMode: allowTokenClaim ? "tokenOnly" : "emailVerified",
    inviteUrl,
    updatedAt: now,
    updatedByUserId: createdByUserId,
  };

  if (!existingInvite) {
    invitePayload.createdAt = now;
    invitePayload.createdByUserId = createdByUserId;
  }

  await inviteRef.set(invitePayload, { merge: true });
  await customerRef.set({
    linkedInviteId: inviteId,
    customerAccountInviteId: inviteId,
    customerAccountInviteUrl: inviteUrl,
    customerAccountInviteStatus: "pending",
    updatedAt: now,
  }, { merge: true });

  return {
    status: 200,
    inviteId,
    inviteUrl,
    claimAccountUrl: inviteUrl,
    companyId,
    companyName,
    customerId,
    customerName,
    customerEmail,
    maskedCustomerEmail: maskEmail(customerEmail),
    allowTokenClaim,
    reused: Boolean(existingInvite),
  };
};

const getCustomerAccountInvitePreview = async ({ inviteId, baseUrl = "" } = {}) => {
  const firestore = admin.firestore();
  const inviteDoc = await getInviteDoc(inviteId);

  if (!inviteDoc) {
    return {
      status: 404,
      error: "Customer account invite not found",
    };
  }

  const invite = inviteDoc.data;
  const companyId = invite.companyId || "";
  const customerId = invite.customerId || "";

  if (!companyId || !customerId) {
    return {
      status: 400,
      error: "Invite is missing company or customer information",
    };
  }

  const companyRef = firestore.collection("companies").doc(companyId);
  const customerRef = companyRef.collection("customers").doc(customerId);
  const [companySnap, customerSnap, serviceLocationsSnap, bodiesOfWaterSnap, equipmentSnap] = await Promise.all([
    companyRef.get(),
    customerRef.get(),
    companyRef.collection("serviceLocations").where("customerId", "==", customerId).get(),
    companyRef.collection("bodiesOfWater").where("customerId", "==", customerId).get(),
    companyRef.collection("equipment").where("customerId", "==", customerId).get(),
  ]);

  if (!companySnap.exists) {
    return { status: 404, error: "Company not found" };
  }

  if (!customerSnap.exists) {
    return { status: 404, error: "Company customer not found" };
  }

  const company = companySnap.data() || {};
  const customer = customerSnap.data() || {};
  const customerEmail = normalizeEmail(invite.customerEmail || invite.email || getCustomerEmail(customer));
  const status = String(invite.status || "").toLowerCase();
  const linkedCustomerIds = getLinkedCustomerIds(customer);
  const companyContact = getCompanyContact(company);

  return {
    status: 200,
    invite: {
      id: inviteId,
      status: invite.status || "pending",
      accepted: invite.accepted === true || status === "accepted",
      allowTokenClaim: invite.allowTokenClaim === true || !customerEmail,
      claimMode: invite.claimMode || (customerEmail ? "emailVerified" : "tokenOnly"),
      inviteUrl: buildCustomerAccountInviteUrl(baseUrl, inviteId),
    },
    company: {
      id: companyId,
      name: getCompanyDisplayName(company),
      logoUrl: company.logoUrl || company.logoURL || company.photoUrl || company.imageUrl || "",
      phone: companyContact.phone,
      email: companyContact.email,
      website: companyContact.website,
      profileUrl: buildUrl(baseUrl, `/companies/profile/${companyId}`),
      serviceAreas: Array.isArray(company.serviceAreas) ? company.serviceAreas.slice(0, 8) : [],
    },
    customer: {
      id: customerId,
      name: getCustomerDisplayName(customer),
      email: customerEmail,
      maskedEmail: maskEmail(customerEmail),
      hasEmail: Boolean(customerEmail),
      linkedCustomerIds,
      hasLinkedCustomerAccount: linkedCustomerIds.length > 0,
    },
    serviceLocations: serviceLocationsSnap.docs.map((locationDoc) => {
      const location = locationDoc.data() || {};
      const address = location.address || {};
      return {
        id: location.id || locationDoc.id,
        name: location.nickName || location.name || address.streetAddress || "Service location",
        addressSummary: formatAddressSummary(address),
      };
    }),
    bodiesOfWater: bodiesOfWaterSnap.docs.map((bodyDoc) => {
      const body = bodyDoc.data() || {};
      return {
        id: body.id || bodyDoc.id,
        name: body.name || "Pool or spa",
        type: body.type || body.bodyOfWaterType || body.waterType || "",
        serviceLocationId: body.serviceLocationId || "",
      };
    }),
    equipment: equipmentSnap.docs.map((equipmentDoc) => {
      const equipment = equipmentDoc.data() || {};
      return {
        id: equipment.id || equipmentDoc.id,
        name: equipment.name || equipment.type || "Equipment",
        type: equipment.type || equipment.category || "",
        make: equipment.make || "",
        model: equipment.model || "",
        bodyOfWaterId: equipment.bodyOfWaterId || "",
      };
    }),
  };
};

module.exports = {
  CUSTOMER_ACCOUNT_INVITE_TYPE,
  buildCustomerAccountInviteUrl,
  ensureCustomerAccountInvite,
  getCustomerAccountInvitePreview,
  maskEmail,
};
