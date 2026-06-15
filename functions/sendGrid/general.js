
const { onCall } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const HttpsError = functions.https.HttpsError;
const functions1 = require('firebase-functions/v1');
const { getFirestore } = require("firebase-admin/firestore");
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");

const sgMail = require("@sendgrid/mail");
const { ensureCustomerAccountInvite } = require("../customerAccountInvites");
const {
    resolveEmailDeliveryRecipient,
    addDeliveryModeTemplateData,
} = require("../emailDelivery");
if (process.env.SEND_GRID_API_KEY && process.env.SEND_GRID_API_KEY.startsWith('SG.')) {
    sgMail.setApiKey(process.env.SEND_GRID_API_KEY);
}

const db = admin.firestore();
const DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID = "d-a987a065df0e43378dafd14c1b7ee419";
const DEFAULT_JOB_ESTIMATE_TEMPLATE_ID = "d-566087cd96864db0a07167e8a080cc12";
const DEFAULT_SERVICE_AGREEMENT_TEMPLATE_ID = "d-866f4368544048aeabf108413f8b8c52";
const SERVICE_STOP_CATEGORIES = {
    route: "Route",
    job: "Job",
    jobEstimate: "Job Estimate",
    serviceAgreementEstimate: "Service Agreement Estimate",
    customerRelationship: "Customer Relationship",
};

const defaultServiceStopCategoryEmailSetting = (category, companyName = "Your Pool Company", legacyEmailConfig = {}) => {
    const legacyBody = String(legacyEmailConfig.emailBody || "").trim();

    const defaultByCategory = {
        [SERVICE_STOP_CATEGORIES.route]: {
            emailSubject: `${companyName} Service Report`,
            emailBody: `Thank you for letting ${companyName} service your pool. Here is a summary of today's visit.`,
            sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
        },
        [SERVICE_STOP_CATEGORIES.job]: {
            emailSubject: `${companyName} Job Visit Summary`,
            emailBody: `Thank you for choosing ${companyName}. Here is a summary of the work completed during this visit.`,
            sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
        },
        [SERVICE_STOP_CATEGORIES.jobEstimate]: {
            emailSubject: `${companyName} Estimate Visit Recap`,
            emailBody: `Thank you for meeting with ${companyName}. Here is a recap of the information gathered for your estimate.`,
            sendGridTemplateId: DEFAULT_JOB_ESTIMATE_TEMPLATE_ID,
        },
        [SERVICE_STOP_CATEGORIES.serviceAgreementEstimate]: {
            emailSubject: `${companyName} Service Agreement Visit Recap`,
            emailBody: `Thank you for considering ${companyName} for recurring service. Here is a recap of the service location information we gathered.`,
            sendGridTemplateId: DEFAULT_SERVICE_AGREEMENT_TEMPLATE_ID,
        },
        [SERVICE_STOP_CATEGORIES.customerRelationship]: {
            emailSubject: `${companyName} Visit Recap`,
            emailBody: `Thank you for taking the time to meet with ${companyName}. Here is a recap of the visit and any follow-up notes.`,
            sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
        },
    };

    const defaults = defaultByCategory[category] || defaultByCategory[SERVICE_STOP_CATEGORIES.route];

    return {
        category,
        sendEmailOnFinish: legacyEmailConfig.emailIsOn === true,
        requirePhotoOnFinish: legacyEmailConfig.requirePhoto === true,
        emailSubject: defaults.emailSubject,
        emailBody: legacyBody || defaults.emailBody,
        emailFooter: "Please contact us with any questions.",
        sendGridTemplateId: defaults.sendGridTemplateId,
    };
};

const inferServiceStopCategory = (serviceStopData = {}) => {
    const explicitCategory = String(serviceStopData.category || "").trim();
    if (Object.values(SERVICE_STOP_CATEGORIES).includes(explicitCategory)) {
        return explicitCategory;
    }

    const typeId = String(serviceStopData.typeId || "").trim();
    switch (typeId) {
        case "system_recurring_service_stop":
            return SERVICE_STOP_CATEGORIES.route;
        case "system_job_service_stop":
            return SERVICE_STOP_CATEGORIES.job;
        case "system_job_estimate_service_stop":
            return SERVICE_STOP_CATEGORIES.jobEstimate;
        case "system_service_agreement_estimate_service_stop":
            return SERVICE_STOP_CATEGORIES.serviceAgreementEstimate;
        case "system_customer_relationship_service_stop":
            return SERVICE_STOP_CATEGORIES.customerRelationship;
        default:
            break;
    }

    if (String(serviceStopData.recurringServiceStopId || "").trim()) {
        return SERVICE_STOP_CATEGORIES.route;
    }

    if (String(serviceStopData.jobId || "").trim()) {
        return SERVICE_STOP_CATEGORIES.job;
    }

    const searchableText = `${serviceStopData.type || ""} ${serviceStopData.description || ""}`.toLowerCase();
    if (
        searchableText.includes("service agreement") ||
        searchableText.includes("recurring service estimate") ||
        searchableText.includes("new pool") ||
        searchableText.includes("new service") ||
        searchableText.includes("startup") ||
        searchableText.includes("start up")
    ) {
        return SERVICE_STOP_CATEGORIES.serviceAgreementEstimate;
    }

    if (searchableText.includes("estimate") || searchableText.includes("estiamte")) {
        return SERVICE_STOP_CATEGORIES.jobEstimate;
    }

    // Legacy service stops predate categories; keep them on the original route email flow.
    return SERVICE_STOP_CATEGORIES.route;
};

const resolveServiceStopCategoryEmailSetting = ({
    emailConfigData = {},
    serviceStopData = {},
    companyName = "Your Pool Company",
}) => {
    const category = inferServiceStopCategory(serviceStopData);
    const categorySettings = emailConfigData.serviceStopCategorySettings || {};
    const configuredSetting = categorySettings[category];
    const fallbackSetting = defaultServiceStopCategoryEmailSetting(category, companyName, emailConfigData);

    return {
        ...fallbackSetting,
        ...(configuredSetting || {}),
        category,
    };
};

const getCallableData = (data) => data?.data || data || {};

const getCallableAuth = async (data, context, message) => {
    if (context.auth?.uid) {
        return {
            uid: context.auth.uid,
            token: context.auth.token || {}
        };
    }

    const payload = getCallableData(data);
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

    if (!idToken) {
        throw new HttpsError("unauthenticated", message);
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        return {
            uid: decodedToken.uid,
            token: decodedToken
        };
    } catch (error) {
        console.error("Unable to verify callable id token", error);
        throw new HttpsError("unauthenticated", message);
    }
};

const getCompanyContactEmail = (companyData = {}) => (
    companyData.email ||
    companyData.companyEmail ||
    companyData.billingEmail ||
    companyData.mainContact?.email ||
    ""
);

const getCompanyCustomerEmail = async ({ companyId, customerId }) => {
    if (!companyId || !customerId) return "";

    const customerDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("customers")
        .doc(customerId)
        .get();

    if (!customerDoc.exists) return "";

    const customer = customerDoc.data() || {};
    return (
        customer.email ||
        customer.billingEmail ||
        customer.mainContact?.email ||
        customer.contact?.email ||
        ""
    );
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const getFirstLinkedCustomerId = (customer = {}) => (
    Array.isArray(customer.linkedCustomerIds)
        ? customer.linkedCustomerIds.find(Boolean) || ""
        : ""
);

const getCustomerUserIdFromRecord = (record = {}) => (
    record.customerUserId ||
    record.userId ||
    record.homeownerUserId ||
    record.homeownerId ||
    record.linkedCustomerUserId ||
    record.linkedHomeownerUserId ||
    getFirstLinkedCustomerId(record) ||
    ""
);

const getCustomerRelationshipIdFromRecord = (record = {}) => (
    record.relationshipId ||
    record.customerCompanyRelationshipId ||
    record.linkedRelationshipId ||
    ""
);

const resolveCustomerRelationshipContext = async ({
    companyId,
    customerId,
    record = {},
    email = "",
}) => {
    const context = {
        companyId: companyId || record.companyId || "",
        customerId: customerId || record.customerId || record.companyCustomerId || "",
        customerUserId: getCustomerUserIdFromRecord(record),
        relationshipId: getCustomerRelationshipIdFromRecord(record),
        customerCompanyRelationshipId: record.customerCompanyRelationshipId || record.relationshipId || "",
        linkedInviteId: record.linkedInviteId || record.inviteId || "",
        customerEmail: normalizeEmail(email || record.email || record.customerEmail || record.homeownerEmail),
    };

    if (context.companyId && context.customerId) {
        try {
            const customerDoc = await db
                .collection("companies")
                .doc(context.companyId)
                .collection("customers")
                .doc(context.customerId)
                .get();

            if (customerDoc.exists) {
                const customer = customerDoc.data() || {};
                context.customerUserId = context.customerUserId || getCustomerUserIdFromRecord(customer);
                context.relationshipId = context.relationshipId || getCustomerRelationshipIdFromRecord(customer);
                context.customerCompanyRelationshipId = (
                    context.customerCompanyRelationshipId ||
                    customer.customerCompanyRelationshipId ||
                    customer.relationshipId ||
                    context.relationshipId ||
                    ""
                );
                context.linkedInviteId = context.linkedInviteId || customer.linkedInviteId || "";
                context.customerEmail = context.customerEmail || normalizeEmail(
                    customer.email ||
                    customer.billingEmail ||
                    customer.mainContact?.email ||
                    customer.contact?.email
                );
            }
        } catch (error) {
            console.warn("Unable to resolve customer relationship context", error.message);
        }
    }

    context.customerCompanyRelationshipId = context.customerCompanyRelationshipId || context.relationshipId || "";
    context.hasLinkedCustomerAccount = Boolean(context.customerUserId || context.relationshipId);

    return context;
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

const buildCompanyUserInviteUrl = (baseUrl, inviteId) => (
    inviteId ? buildUrl(baseUrl, `/company/invite/${inviteId}`) : ""
);

const buildCustomerAccessTemplateData = async ({
    companyId,
    customerId,
    email = "",
    record = {},
    actionUrl = "",
    baseUrl = "",
}) => {
    const relationshipContext = await resolveCustomerRelationshipContext({
        companyId,
        customerId,
        record,
        email,
    });
    const appBaseUrl = getAppBaseUrl(baseUrl);
    let claimAccountUrl = "";
    let customerAccountInviteId = relationshipContext.linkedInviteId || "";

    if (!relationshipContext.hasLinkedCustomerAccount && relationshipContext.companyId && relationshipContext.customerId) {
        try {
            const invite = await ensureCustomerAccountInvite({
                companyId: relationshipContext.companyId,
                customerId: relationshipContext.customerId,
                createdByUserId: "sendgrid-email",
                source: "customerEmail",
                baseUrl: appBaseUrl,
                email: relationshipContext.customerEmail,
            });

            if (invite.status === 200) {
                claimAccountUrl = invite.inviteUrl || invite.claimAccountUrl || "";
                customerAccountInviteId = invite.inviteId || customerAccountInviteId;
            } else {
                console.warn("Unable to create customer account invite link", invite.error);
            }
        } catch (error) {
            console.warn("Unable to create customer account invite link", error.message);
        }
    }

    if (!claimAccountUrl && relationshipContext.companyId && relationshipContext.customerId) {
        claimAccountUrl = buildUrl(appBaseUrl, "/client/connect-to-company", {
            companyId: relationshipContext.companyId,
            customerId: relationshipContext.customerId,
            email: relationshipContext.customerEmail,
        });
    }
    const homeownerSignInUrl = buildUrl(appBaseUrl, "/homeownerSignIn");
    const homeownerSignUpUrl = buildUrl(appBaseUrl, "/homeownerSignUp", {
        email: relationshipContext.customerEmail,
    });
    const customerPortalUrl = relationshipContext.hasLinkedCustomerAccount
        ? buildUrl(appBaseUrl, "/client/dashboard")
        : "";
    const customerActionUrl = actionUrl || customerPortalUrl || claimAccountUrl || homeownerSignInUrl;

    return {
        ...relationshipContext,
        linkedInviteId: customerAccountInviteId,
        customerAccountInviteId,
        customerActionUrl,
        customerPortalUrl,
        claimAccountUrl: relationshipContext.hasLinkedCustomerAccount ? "" : claimAccountUrl,
        homeownerSignInUrl,
        homeownerSignUpUrl,
        primaryCustomerUrl: relationshipContext.hasLinkedCustomerAccount
            ? customerActionUrl
            : claimAccountUrl || customerActionUrl,
        shouldShowClaimAccountLink: !relationshipContext.hasLinkedCustomerAccount && Boolean(claimAccountUrl),
    };
};

const userHasCompanyAccess = async (uid, companyId) => {
    if (!uid || !companyId) return false;

    const accessDoc = await db
        .collection("users")
        .doc(uid)
        .collection("userAccess")
        .doc(companyId)
        .get();

    return accessDoc.exists;
};

const formatCurrency = (amountCents = 0) => {
    const amount = (Number(amountCents) || 0) / 100;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format(amount);
};

const formatDate = (value) => {
    if (!value) return "";

    const date =
        typeof value.toDate === "function"
            ? value.toDate()
            : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Los_Angeles"
    });
};

const labelize = (value) => {
    if (!value) return "";
    return String(value)
        .replace(/([A-Z])/g, " $1")
        .replace(/[_-]/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeStatusKey = (value) => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const linkedJobIdForAgreement = (agreement = {}) => {
    if (agreement.jobId) return agreement.jobId;
    if (agreement.workOrderId) return agreement.workOrderId;
    if (normalizeStatusKey(agreement.sourceType) === "oneoffjob" && agreement.sourceId) return agreement.sourceId;
    return "";
};

const syncLinkedJobForAgreementStatus = async ({
    agreement,
    status,
    actorUserId = "",
    actorUserName = "",
    timestamp = admin.firestore.FieldValue.serverTimestamp(),
}) => {
    const jobId = linkedJobIdForAgreement(agreement);
    const companyId = agreement.companyId || "";
    if (!companyId || !jobId) return;

    const jobRef = db.collection("companies").doc(companyId).collection("workOrders").doc(jobId);
    const jobDoc = await jobRef.get();
    if (!jobDoc.exists) return;

    const job = jobDoc.data() || {};
    const statusKey = normalizeStatusKey(status);
    const update = {
        salesAgreementId: agreement.id || agreement.agreementId || "",
        salesAgreementStatus: status,
        salesAgreementStatusUpdatedAt: timestamp,
        salesAgreementStatusUpdatedByUserId: actorUserId,
        salesAgreementStatusUpdatedByUserName: actorUserName,
        updatedAt: timestamp,
    };

    if (statusKey === "sent") {
        update.billingStatus = "Estimate";
        update.salesAgreementSentAt = timestamp;
        if (!job.operationStatus || job.operationStatus === "Estimate Pending") {
            update.operationStatus = "Unscheduled";
        }
    }

    if (statusKey === "accepted") {
        update.billingStatus = "Accepted";
        update.salesAgreementAcceptedAt = timestamp;
        if (!job.operationStatus || ["Estimate Pending", "Unscheduled"].includes(job.operationStatus)) {
            update.operationStatus = "Unscheduled";
        }
    }

    await jobRef.set(update, { merge: true });
};

const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getCompanyInviteeName = (invite = {}) => (
    `${invite.firstName || ""} ${invite.lastName || ""}`.trim() ||
    invite.email ||
    "there"
);

const buildCompanyUserInviteFallbackText = (templateData = {}) => ([
    `${templateData.companyName} invited you to join DripDrop.`,
    "",
    `Role: ${templateData.roleName || "Company User"}`,
    templateData.workerType ? `Worker type: ${templateData.workerType}` : "",
    "",
    templateData.inviteMessage || "Use the invite link below to accept your invitation:",
    templateData.inviteUrl || "",
    "",
    templateData.companyProfileUrl ? `Company profile: ${templateData.companyProfileUrl}` : "",
    templateData.signInUrl ? `Already have an account? Sign in: ${templateData.signInUrl}` : "",
    "",
    `Invite ID: ${templateData.inviteId || ""}`,
    `This message was sent by ${templateData.companyName} through DripDrop.`,
].filter(Boolean).join("\n"));

const buildCompanyUserInviteFallbackHtml = (templateData = {}) => `
    <div style="background:#f8fafc;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 16px 32px rgba(15,23,42,0.08);">
            <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);color:#ffffff;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Company Invitation</div>
                <h1 style="margin:12px 0 8px;font-size:28px;line-height:1.2;">Join ${escapeHtml(templateData.companyName || "DripDrop")}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;opacity:0.92;">
                    ${escapeHtml(templateData.inviteMessage || "You have been invited to join a company workspace on DripDrop.")}
                </p>
            </div>

            <div style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">
                    Hi ${escapeHtml(templateData.inviteeName || "there")},
                </p>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:0 0 24px;">
                    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#f8fafc;">
                        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Role</div>
                        <div style="margin-top:6px;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(templateData.roleName || "Company User")}</div>
                    </div>
                    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#f8fafc;">
                        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Worker Type</div>
                        <div style="margin-top:6px;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(templateData.workerType || "Not specified")}</div>
                    </div>
                </div>

                <a href="${escapeHtml(templateData.inviteUrl || "")}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:10px;padding:14px 18px;font-weight:700;">
                    Accept Invite
                </a>

                <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#475569;">
                    If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:10px 0 0;padding:12px 14px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;word-break:break-all;font-size:13px;color:#1d4ed8;">
                    ${escapeHtml(templateData.inviteUrl || "")}
                </p>

                ${templateData.companyProfileUrl ? `
                    <p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#475569;">
                        You can also preview the company profile here:
                        <a href="${escapeHtml(templateData.companyProfileUrl)}" style="color:#2563eb;font-weight:700;">${escapeHtml(templateData.companyProfileUrl)}</a>
                    </p>
                ` : ""}

                ${templateData.signInUrl ? `
                    <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#475569;">
                        Already have a DripDrop company account? <a href="${escapeHtml(templateData.signInUrl)}" style="color:#2563eb;font-weight:700;">Sign in and accept the invite</a>.
                    </p>
                ` : ""}

                <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.7;color:#64748b;">
                    <div>Invite ID: ${escapeHtml(templateData.inviteId || "")}</div>
                    <div>This message was sent by ${escapeHtml(templateData.companyName || "DripDrop")} through DripDrop.</div>
                    <div>Questions? Reply to this email.</div>
                </div>
            </div>
        </div>
    </div>
`;

const sendCompanyUserInviteEmailInternal = async ({
    invite = {},
    companyData = {},
    baseUrl = "",
} = {}) => {
    const inviteId = String(invite.id || "").trim();
    const inviteEmail = normalizeEmail(invite.email);
    const companyName = companyData.name || companyData.companyName || invite.companyName || "DripDrop";

    if (!inviteId) {
        throw new HttpsError("invalid-argument", "Invite id is required to send an invite email.");
    }

    if (!inviteEmail) {
        throw new HttpsError("invalid-argument", "Invite email is required to send an invite email.");
    }

    if (!process.env.SEND_GRID_API_KEY || !process.env.SEND_GRID_API_KEY.startsWith("SG.")) {
        throw new HttpsError("failed-precondition", "Invite email delivery is not configured.");
    }

    const emailConfigDoc = invite.companyId
        ? await db.collection("companies").doc(invite.companyId).collection("settings").doc("emailConfiguration").get()
        : null;
    const emailConfig = emailConfigDoc?.exists ? emailConfigDoc.data() : {};
    const emailDelivery = await resolveEmailDeliveryRecipient(inviteEmail);
    const fromEmail = process.env.SEND_GRID_FROM_EMAIL || emailConfig.fromEmail || "info@dripdrop-poolapp.com";
    const replyToEmail = emailConfig.replyToEmail || getCompanyContactEmail(companyData) || fromEmail;
    const templateId = process.env.SEND_GRID_COMPANY_USER_INVITE_TEMPLATE_ID || process.env.SENDGRID_COMPANY_USER_INVITE_TEMPLATE_ID || "";
    const inviteUrl = buildCompanyUserInviteUrl(baseUrl, inviteId);
    const redirectPath = `/company/invite/${inviteId}`;

    const templateData = addDeliveryModeTemplateData({
        subject: `${companyName} invited you to join DripDrop`,
        preHeader: `Accept your invitation to join ${companyName}.`,
        inviteId,
        inviteUrl,
        inviteeName: getCompanyInviteeName(invite),
        inviteEmail,
        companyName,
        companyId: invite.companyId || "",
        roleName: invite.roleName || "Company User",
        workerType: invite.workerType || "",
        inviteMessage: `Use the link below to accept your invite and join ${companyName} on DripDrop.`,
        companyProfileUrl: invite.companyId ? buildUrl(baseUrl, `/companies/profile/${invite.companyId}`) : "",
        signInUrl: buildUrl(baseUrl, "/signIn", { redirect: redirectPath }),
        signUpUrl: buildUrl(baseUrl, "/signUp"),
        isExistingUserInvite: invite.currentUser === true,
    }, emailDelivery);

    const msg = templateId
        ? {
            to: emailDelivery.actualTo,
            from: fromEmail,
            replyTo: replyToEmail,
            templateId,
            dynamicTemplateData: templateData,
        }
        : {
            to: emailDelivery.actualTo,
            from: fromEmail,
            replyTo: replyToEmail,
            subject: templateData.subject,
            text: buildCompanyUserInviteFallbackText(templateData),
            html: buildCompanyUserInviteFallbackHtml(templateData),
        };

    await sgMail.send(msg);

    return {
        inviteUrl,
        to: emailDelivery.actualTo,
        intendedTo: emailDelivery.intendedTo,
        testMode: emailDelivery.testMode,
        provider: "sendGrid",
        templateId: templateId || "fallback-html",
        templateMode: templateId ? "sendGridDynamicTemplate" : "fallbackHtml",
        from: fromEmail,
        replyTo: replyToEmail,
    };
};

exports.sendCompanyUserInviteEmailInternal = sendCompanyUserInviteEmailInternal;

const normalizeAgreementLocation = (agreement) => {
    const firstLocation = Array.isArray(agreement.serviceLocationSnapshots)
        ? agreement.serviceLocationSnapshots[0]
        : null;

    return firstLocation || {};
};

const buildAgreementTerms = (agreement) => {
    if (Array.isArray(agreement.termsList) && agreement.termsList.length > 0) {
        return agreement.termsList
            .filter(Boolean)
            .map((term, index) => {
                if (typeof term === "string") {
                    return {
                        title: `Term ${index + 1}`,
                        description: term
                    };
                }

                return {
                    title: term?.title || term?.label || `Term ${index + 1}`,
                    description: String(term?.description || term?.value || term?.text || "")
                };
            })
            .filter((term) => term.description);
    }

    if (agreement.terms) {
        return [{
            title: "Agreement Terms",
            description: String(agreement.terms)
        }];
    }

    return [];
};

const normalizeFrequencyKey = (value) => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const normalizeDaysOfWeek = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") {
        return value
            .split(",")
            .map((day) => day.trim())
            .filter(Boolean);
    }
    return [];
};

const billingFrequencyForAgreement = (agreement = {}) => (
    agreement.billingFrequency ||
    agreement.billingCadence ||
    agreement.invoiceFrequency ||
    agreement.serviceCadence ||
    agreement.rateType ||
    "monthly"
);

const billingFrequencyCountForAgreement = (agreement = {}) => Math.max(Number(
    agreement.billingFrequencyCount ||
    agreement.billingCadenceCount ||
    agreement.invoiceFrequencyCount ||
    agreement.serviceCadenceCount ||
    1
), 1);

const formatBillingFrequency = (agreement = {}) => {
    const frequency = billingFrequencyForAgreement(agreement);
    const count = billingFrequencyCountForAgreement(agreement);
    const key = normalizeFrequencyKey(frequency);

    if (key === "biweekly") return "Biweekly";
    if (key === "quarterly") return "Quarterly";
    if (key === "annually" || key === "annual") return "Annually";
    if (count > 1 && !["custom", "onetime"].includes(key)) return `Every ${count} ${labelize(frequency).toLowerCase()}`;
    return labelize(frequency);
};

const serviceFrequencyForAgreement = (agreement = {}) => (
    agreement.serviceCadence ||
    agreement.serviceFrequency ||
    ""
);

const serviceFrequencyCountForAgreement = (agreement = {}) => Math.max(Number(
    agreement.serviceCadenceCount ||
    agreement.serviceFrequencyCount ||
    1
), 1);

const formatServiceFrequency = (agreement = {}) => {
    const frequency = serviceFrequencyForAgreement(agreement);
    const count = serviceFrequencyCountForAgreement(agreement);
    const key = normalizeFrequencyKey(frequency);
    const days = normalizeDaysOfWeek(agreement.serviceDaysOfWeek || agreement.daysOfWeek || agreement.serviceDays || agreement.day);
    const dayText = days.length ? ` on ${days.join(", ")}` : "";

    if (key === "twiceweekly") return `Twice Weekly${dayText}`;
    if (key === "threetimesweekly" || key === "tripleweekly") return `Three Times Weekly${dayText}`;
    if (key === "biweekly" || key === "everyotherweek") return `Every Other Week${dayText}`;
    if (count > 1 && !["custom", "onetime"].includes(key)) return `${count}x ${labelize(frequency)}${dayText}`;
    return `${labelize(frequency || "notSet")}${dayText}`;
};

const chemicalBillingModeLabel = (agreement = {}) => {
    const mode = normalizeFrequencyKey(agreement.chemicalBillingMode || agreement.chemicalBillingTreatment || agreement.chemicalBilling || "");
    if (mode === "billallseparately" || mode === "billall" || mode === "separateall") return "Bill All Chemicals Separately";
    if (mode === "mixed" || mode === "selected" || mode === "billselectedseparately") return "Mixed Chemical Billing";
    return "Chemicals Included In Service";
};

const normalizeAgreementList = (value) => (
    Array.isArray(value)
        ? value.map((item) => String(item || "").trim()).filter(Boolean)
        : String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
);

const buildServiceAgreementTemplateData = ({
    agreement,
    companyData,
    agreementUrl,
    customerAccess = {},
}) => {
    const companyName = agreement.companyName || companyData.name || companyData.companyName || "Your Pool Company";
    const location = normalizeAgreementLocation(agreement);
    const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
    const terms = buildAgreementTerms(agreement);
    const includedChemicalKeywords = normalizeAgreementList(agreement.includedChemicalKeywords);
    const includedChemicalIds = normalizeAgreementList(agreement.includedChemicalIds);
    const separatelyBilledChemicalKeywords = normalizeAgreementList(agreement.separatelyBilledChemicalKeywords);
    const separatelyBilledChemicalIds = normalizeAgreementList(agreement.separatelyBilledChemicalIds);
    const customerPurchasedChemicalKeywords = normalizeAgreementList(agreement.customerPurchasedChemicalKeywords);
    const customerPurchasedChemicalIds = normalizeAgreementList(agreement.customerPurchasedChemicalIds);

    return {
        subject: `${companyName} Service Agreement`,
        preHeader: "Your pool service agreement is ready to review.",
        customer: agreement.customerName || "Customer",
        companyName,
        agreementTitle: agreement.title || "Service Agreement",
        agreementNumber: agreement.id || "",
        agreementStatus: labelize(agreement.status || "sent"),
        agreementUrl,
        ...customerAccess,
        sentDate: formatDate(new Date()),
        expiresAt: formatDate(agreement.expiresAt),
        address01: location.streetAddress || "",
        address02: location.address02 || "",
        city: location.city || "",
        state: location.state || "",
        zip: location.zip || "",
        billingAmount: formatCurrency(agreement.totalAmountCents || agreement.rateAmountCents),
        billingFrequency: formatBillingFrequency(agreement),
        serviceFrequency: formatServiceFrequency(agreement),
        chemicalBillingMode: agreement.chemicalBillingMode || "includedAll",
        chemicalBillingModeLabel: chemicalBillingModeLabel(agreement),
        chemicalBillingNotes: agreement.chemicalBillingNotes || "",
        includedChemicalKeywords,
        includedChemicalIds,
        separatelyBilledChemicalKeywords,
        separatelyBilledChemicalIds,
        customerPurchasedChemicalKeywords,
        customerPurchasedChemicalIds,
        includedChemicalsSummary: includedChemicalKeywords.join(", "),
        separatelyBilledChemicalsSummary: separatelyBilledChemicalKeywords.join(", "),
        customerPurchasedChemicalsSummary: customerPurchasedChemicalKeywords.join(", "),
        billingStartDate: formatDate(agreement.startDate),
        paymentTerms: labelize(agreement.paymentTerms || "dueOnReceipt"),
        autopayStatus: "Optional",
        lineItems: lineItems.map((item) => ({
            name: item.name || item.description || "Service",
            description: item.description || "",
            quantity: String(item.quantity || 1),
            unitAmount: formatCurrency(item.unitAmountCents),
            totalAmount: formatCurrency(item.totalAmountCents)
        })),
        termsSummary: agreement.termsTemplateName
            ? `This agreement uses the ${agreement.termsTemplateName} terms template.`
            : "",
        terms,
        companyPhone: companyData.phoneNumber || companyData.phone || "",
        companyEmail: companyData.email || companyData.companyEmail || "",
        supportUrl: process.env.SUPPORT_URL || "https://dripdrop-poolapp.com/support",
        contactUrl: companyData.email ? `mailto:${companyData.email}` : "https://dripdrop-poolapp.com/contact",
        legalUrl: process.env.LEGAL_URL || "https://dripdrop-poolapp.com/legal"
    };
};

//----------Send Grid Functions//----------Send Grid Functions
exports.sendServiceAgreementEmail = functions.https.onCall(async (data, context) => {
    console.log("Send Service Agreement Email");

    const callableAuth = await getCallableAuth(
        data,
        context,
        "You must be signed in to send a service agreement."
    );

    const payload = getCallableData(data);
    const companyId = payload.companyId;
    const agreementId = payload.agreementId;
    const agreementBaseUrl = payload.agreementBaseUrl || process.env.SERVICE_AGREEMENT_BASE_URL || process.env.APP_BASE_URL || "";
    const templateId = process.env.SEND_GRID_SERVICE_AGREEMENT_TEMPLATE_ID || process.env.SENDGRID_SERVICE_AGREEMENT_TEMPLATE_ID || DEFAULT_SERVICE_AGREEMENT_TEMPLATE_ID;

    if (!companyId) {
        throw new HttpsError("invalid-argument", "Missing companyId.");
    }

    if (!agreementId) {
        throw new HttpsError("invalid-argument", "Missing agreementId.");
    }

    if (!(await userHasCompanyAccess(callableAuth.uid, companyId))) {
        throw new HttpsError("permission-denied", "You do not have access to send email for this company.");
    }

    if (!templateId) {
        throw new HttpsError("failed-precondition", "Missing SEND_GRID_SERVICE_AGREEMENT_TEMPLATE_ID.");
    }

    if (!agreementBaseUrl) {
        throw new HttpsError("failed-precondition", "Missing agreement review base URL.");
    }

    if (!process.env.SEND_GRID_API_KEY || !process.env.SEND_GRID_API_KEY.startsWith("SG.")) {
        throw new HttpsError("failed-precondition", "SendGrid API key is not configured.");
    }

    const agreementRef = db.collection("salesAgreements").doc(agreementId);
    const agreementDoc = await agreementRef.get();

    if (!agreementDoc.exists) {
        throw new HttpsError("not-found", "Service agreement not found.");
    }

    const agreement = {
        id: agreementDoc.id,
        ...agreementDoc.data()
    };

    if (agreement.companyId !== companyId) {
        throw new HttpsError("permission-denied", "Agreement does not belong to the selected company.");
    }

    if (!agreement.email) {
        throw new HttpsError("failed-precondition", "Agreement is missing a customer email.");
    }

    const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
    if (!lineItems.length) {
        throw new HttpsError("failed-precondition", "Agreement needs at least one line item before sending.");
    }

    if (!agreement.terms && !(Array.isArray(agreement.termsList) && agreement.termsList.length)) {
        throw new HttpsError("failed-precondition", "Agreement needs terms before sending.");
    }

    const companyRef = db.collection("companies").doc(companyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
        throw new HttpsError("not-found", "Company not found.");
    }

    const companyData = companyDoc.data() || {};
    const emailConfigDoc = await companyRef.collection("settings").doc("emailConfiguration").get();
    const emailConfig = emailConfigDoc.exists ? emailConfigDoc.data() : {};

    if (emailConfig.emailIsOn === false) {
        throw new HttpsError("failed-precondition", "Company email is turned off.");
    }

    const fromEmail = process.env.SEND_GRID_FROM_EMAIL || emailConfig.fromEmail || "info@dripdrop-poolapp.com";
    const replyToEmail = emailConfig.replyToEmail || companyData.email || companyData.companyEmail || fromEmail;
    const agreementUrl = `${agreementBaseUrl.replace(/\/$/, "")}/client/service-agreements/${agreementId}`;
    const customerAccess = await buildCustomerAccessTemplateData({
        companyId,
        customerId: agreement.customerId || "",
        email: agreement.email,
        record: agreement,
        actionUrl: agreementUrl,
        baseUrl: agreementBaseUrl,
    });
    const emailDelivery = await resolveEmailDeliveryRecipient(agreement.email);
    const dynamicTemplateData = buildServiceAgreementTemplateData({
        agreement,
        companyData,
        agreementUrl,
        customerAccess,
    });

    const msg = {
        to: emailDelivery.actualTo,
        from: fromEmail,
        replyTo: replyToEmail,
        templateId,
        dynamicTemplateData: addDeliveryModeTemplateData(dynamicTemplateData, emailDelivery)
    };

    let sendResult;
    try {
        sendResult = await sgMail.send(msg);
    } catch (error) {
        const providerErrors = error.response?.body?.errors || [];
        const providerMessage = providerErrors.length
            ? providerErrors.map((item) => item.message).filter(Boolean).join("; ")
            : error.message || "SendGrid rejected the request.";

        console.error("Unable to send service agreement email through SendGrid", {
            message: error.message,
            code: error.code,
            responseBody: error.response?.body,
        });

        throw new HttpsError("internal", `Unable to send service agreement email: ${providerMessage}`);
    }

    const messageId = sendResult?.[0]?.headers?.["x-message-id"] || "";

    const sentAt = admin.firestore.FieldValue.serverTimestamp();

    await agreementRef.set({
        status: "sent",
        customerUserId: agreement.customerUserId || customerAccess.customerUserId || null,
        relationshipId: agreement.relationshipId || customerAccess.relationshipId || "",
        customerCompanyRelationshipId: agreement.customerCompanyRelationshipId || customerAccess.customerCompanyRelationshipId || "",
        sentAt,
        sentByUserId: callableAuth.uid,
        updatedAt: sentAt,
        emailDelivery: {
            provider: "sendGrid",
            templateId,
            to: emailDelivery.actualTo,
            intendedTo: emailDelivery.intendedTo,
            from: fromEmail,
            replyTo: replyToEmail,
            messageId,
            agreementUrl,
            customerActionUrl: customerAccess.customerActionUrl,
            customerPortalUrl: customerAccess.customerPortalUrl,
            claimAccountUrl: customerAccess.claimAccountUrl,
            hasLinkedCustomerAccount: customerAccess.hasLinkedCustomerAccount,
            testMode: emailDelivery.testMode,
            realEmailsFeatureFlagId: emailDelivery.realEmailsFeatureFlagId,
            realEmailsEnabled: emailDelivery.realEmailsEnabled,
            lastSentAt: sentAt,
        }
    }, { merge: true });

    await syncLinkedJobForAgreementStatus({
        agreement: {
            ...agreement,
            customerUserId: agreement.customerUserId || customerAccess.customerUserId || null,
        },
        status: "sent",
        actorUserId: callableAuth.uid,
        actorUserName: callableAuth.token?.name || callableAuth.token?.email || "Company user",
        timestamp: sentAt,
    });

    return {
        status: 200,
        message: "Service agreement email sent.",
        messageId,
        agreementUrl,
        to: emailDelivery.actualTo,
        intendedTo: emailDelivery.intendedTo,
        testMode: emailDelivery.testMode
    };
});

const buildSalesInvoiceTemplateData = ({
    invoice,
    companyData,
    invoiceUrl,
    customerAccess = {},
}) => {
    const companyName = invoice.companyName || companyData.name || companyData.companyName || "Your Pool Company";
    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    const locations = Array.isArray(invoice.serviceLocationSnapshots) ? invoice.serviceLocationSnapshots : [];
    const firstLocation = locations[0] || {};

    return {
        subject: `${companyName} Invoice ${invoice.invoiceNumber || invoice.id}`,
        preHeader: "Your pool service invoice is ready to review.",
        customer: invoice.customerName || "Customer",
        companyName,
        invoiceTitle: invoice.title || "Invoice",
        invoiceNumber: invoice.invoiceNumber || invoice.id || "",
        invoiceStatus: labelize(invoice.status || "open"),
        invoiceUrl,
        ...customerAccess,
        sentDate: formatDate(new Date()),
        dueDate: formatDate(invoice.dueDate),
        address01: firstLocation.streetAddress || "",
        address02: firstLocation.address02 || "",
        city: firstLocation.city || "",
        state: firstLocation.state || "",
        zip: firstLocation.zip || "",
        subtotalAmount: formatCurrency(invoice.subtotalAmountCents),
        discountAmount: formatCurrency(invoice.discountAmountCents),
        taxAmount: formatCurrency(invoice.taxAmountCents),
        totalAmount: formatCurrency(invoice.totalAmountCents),
        amountPaid: formatCurrency(invoice.amountPaidCents),
        amountDue: formatCurrency(invoice.amountDueCents ?? invoice.totalAmountCents),
        memo: invoice.memo || "",
        lineItems: lineItems.map((item) => ({
            name: item.name || item.description || "Service",
            description: item.description || "",
            quantity: String(item.quantity || 1),
            unitAmount: formatCurrency(item.unitAmountCents),
            totalAmount: formatCurrency(item.totalAmountCents)
        })),
        companyPhone: companyData.phoneNumber || companyData.phone || "",
        companyEmail: companyData.email || companyData.companyEmail || "",
        supportUrl: process.env.SUPPORT_URL || "https://dripdrop-poolapp.com/support",
        contactUrl: companyData.email ? `mailto:${companyData.email}` : "https://dripdrop-poolapp.com/contact",
        legalUrl: process.env.LEGAL_URL || "https://dripdrop-poolapp.com/legal"
    };
};

const buildSalesInvoiceFallbackText = (templateData) => {
    const lines = [
        `${templateData.companyName} sent you ${templateData.invoiceTitle || "an invoice"}.`,
        `Invoice: ${templateData.invoiceNumber}`,
        `Total: ${templateData.totalAmount}`,
        `Amount due: ${templateData.amountDue}`,
        templateData.dueDate ? `Due date: ${templateData.dueDate}` : "",
        "",
        `Review invoice: ${templateData.invoiceUrl}`,
        templateData.claimAccountUrl ? `Create or link your homeowner account: ${templateData.claimAccountUrl}` : "",
    ];

    return lines.filter((line) => line !== "").join("\n");
};

const buildSalesInvoiceFallbackHtml = (templateData) => {
    const rows = Array.isArray(templateData.lineItems)
        ? templateData.lineItems.map((item) => `
            <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
                    <strong>${escapeHtml(item.name)}</strong>
                    ${item.description ? `<div style="color:#64748b;font-size:13px;margin-top:3px;">${escapeHtml(item.description)}</div>` : ""}
                </td>
                <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:center;">${escapeHtml(item.quantity)}</td>
                <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(item.totalAmount)}</td>
            </tr>
        `).join("")
        : "";

    return `
        <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
            <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
                <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
                    <p style="margin:0 0 8px;color:#64748b;font-size:14px;">${escapeHtml(templateData.companyName)}</p>
                    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.25;">Invoice ${escapeHtml(templateData.invoiceNumber)}</h1>
                    <p style="margin:0 0 20px;color:#475569;">Hi ${escapeHtml(templateData.customer)}, your pool service invoice is ready.</p>
                    <div style="display:block;background:#f1f5f9;border-radius:8px;padding:16px;margin-bottom:20px;">
                        <div style="font-size:13px;color:#64748b;">Amount due</div>
                        <div style="font-size:28px;font-weight:700;margin-top:2px;">${escapeHtml(templateData.amountDue)}</div>
                        ${templateData.dueDate ? `<div style="font-size:13px;color:#64748b;margin-top:6px;">Due ${escapeHtml(templateData.dueDate)}</div>` : ""}
                    </div>
                    ${rows ? `
                        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px;">
                            <thead>
                                <tr>
                                    <th style="padding:0 0 8px;text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;">Item</th>
                                    <th style="padding:0 0 8px;text-align:center;color:#64748b;font-size:12px;text-transform:uppercase;">Qty</th>
                                    <th style="padding:0 0 8px;text-align:right;color:#64748b;font-size:12px;text-transform:uppercase;">Total</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    ` : ""}
                    <a href="${escapeHtml(templateData.invoiceUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;padding:12px 18px;font-weight:700;">Review Invoice</a>
                    ${templateData.claimAccountUrl ? `<p style="margin:16px 0 0;color:#475569;font-size:14px;">Need to link your homeowner account? <a href="${escapeHtml(templateData.claimAccountUrl)}" style="color:#2563eb;font-weight:700;">Connect your account</a>.</p>` : ""}
                    ${templateData.memo ? `<p style="margin:20px 0 0;color:#475569;">${escapeHtml(templateData.memo)}</p>` : ""}
                    <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">This message was sent by ${escapeHtml(templateData.companyName)} through DripDrop.</p>
                </div>
            </div>
        </div>
    `;
};

exports.sendSalesInvoiceEmail = functions.https.onCall(async (data, context) => {
    console.log("Send Sales Invoice Email");

    const callableAuth = await getCallableAuth(
        data,
        context,
        "You must be signed in to send an invoice."
    );

    const payload = getCallableData(data);
    const companyId = payload.companyId;
    const invoiceId = payload.invoiceId;
    const invoiceBaseUrl = payload.invoiceBaseUrl || process.env.SALES_INVOICE_BASE_URL || process.env.APP_BASE_URL || "";
    const templateId = process.env.SEND_GRID_SALES_INVOICE_TEMPLATE_ID || process.env.SENDGRID_SALES_INVOICE_TEMPLATE_ID || "";

    if (!companyId) {
        throw new HttpsError("invalid-argument", "Missing companyId.");
    }

    if (!invoiceId) {
        throw new HttpsError("invalid-argument", "Missing invoiceId.");
    }

    if (!(await userHasCompanyAccess(callableAuth.uid, companyId))) {
        throw new HttpsError("permission-denied", "You do not have access to send email for this company.");
    }

    if (!invoiceBaseUrl) {
        throw new HttpsError("failed-precondition", "Missing invoice review base URL.");
    }

    if (!process.env.SEND_GRID_API_KEY || !process.env.SEND_GRID_API_KEY.startsWith("SG.")) {
        throw new HttpsError("failed-precondition", "SendGrid API key is not configured.");
    }

    const invoiceRef = db.collection("salesInvoices").doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (!invoiceDoc.exists) {
        throw new HttpsError("not-found", "Sales invoice not found.");
    }

    const invoice = {
        id: invoiceDoc.id,
        ...invoiceDoc.data()
    };

    if (invoice.companyId !== companyId) {
        throw new HttpsError("permission-denied", "Invoice does not belong to the selected company.");
    }

    if (!invoice.email) {
        throw new HttpsError("failed-precondition", "Invoice is missing a customer email.");
    }

    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    if (!lineItems.length) {
        throw new HttpsError("failed-precondition", "Invoice needs at least one line item before sending.");
    }

    const companyRef = db.collection("companies").doc(companyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
        throw new HttpsError("not-found", "Company not found.");
    }

    const companyData = companyDoc.data() || {};
    const emailConfigDoc = await companyRef.collection("settings").doc("emailConfiguration").get();
    const emailConfig = emailConfigDoc.exists ? emailConfigDoc.data() : {};

    if (emailConfig.emailIsOn === false) {
        throw new HttpsError("failed-precondition", "Company email is turned off.");
    }

    const fromEmail = process.env.SEND_GRID_FROM_EMAIL || emailConfig.fromEmail || "mespineli@dripdrop-poolapp.com";
    const replyToEmail = emailConfig.replyToEmail || companyData.email || companyData.companyEmail || fromEmail;
    const invoiceUrl = `${invoiceBaseUrl.replace(/\/$/, "")}/client/billing/invoices/${invoiceId}`;
    const customerAccess = await buildCustomerAccessTemplateData({
        companyId,
        customerId: invoice.customerId || "",
        email: invoice.email,
        record: invoice,
        actionUrl: invoiceUrl,
        baseUrl: invoiceBaseUrl,
    });
    const emailDelivery = await resolveEmailDeliveryRecipient(invoice.email);
    const dynamicTemplateData = buildSalesInvoiceTemplateData({
        invoice,
        companyData,
        invoiceUrl,
        customerAccess,
    });
    const invoiceTemplateData = addDeliveryModeTemplateData(dynamicTemplateData, emailDelivery);
    const templateMode = templateId ? "sendGridDynamicTemplate" : "fallbackHtml";

    const msg = templateId ? {
        to: emailDelivery.actualTo,
        from: fromEmail,
        replyTo: replyToEmail,
        templateId,
        dynamicTemplateData: invoiceTemplateData
    } : {
        to: emailDelivery.actualTo,
        from: fromEmail,
        replyTo: replyToEmail,
        subject: invoiceTemplateData.subject,
        text: buildSalesInvoiceFallbackText(invoiceTemplateData),
        html: buildSalesInvoiceFallbackHtml(invoiceTemplateData)
    };

    const sendResult = await sgMail.send(msg);
    const messageId = sendResult?.[0]?.headers?.["x-message-id"] || "";

    await invoiceRef.set({
        status: invoice.status === "paid" ? "paid" : "open",
        customerUserId: invoice.customerUserId || customerAccess.customerUserId || null,
        relationshipId: invoice.relationshipId || customerAccess.relationshipId || "",
        customerCompanyRelationshipId: invoice.customerCompanyRelationshipId || customerAccess.customerCompanyRelationshipId || "",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        emailDelivery: {
            provider: "sendGrid",
            templateId: templateId || "fallback-html",
            templateMode,
            to: emailDelivery.actualTo,
            intendedTo: emailDelivery.intendedTo,
            from: fromEmail,
            replyTo: replyToEmail,
            messageId,
            invoiceUrl,
            customerActionUrl: customerAccess.customerActionUrl,
            customerPortalUrl: customerAccess.customerPortalUrl,
            claimAccountUrl: customerAccess.claimAccountUrl,
            hasLinkedCustomerAccount: customerAccess.hasLinkedCustomerAccount,
            testMode: emailDelivery.testMode,
            realEmailsFeatureFlagId: emailDelivery.realEmailsFeatureFlagId,
            realEmailsEnabled: emailDelivery.realEmailsEnabled,
            lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
        }
    }, { merge: true });

    return {
        status: 200,
        message: "Sales invoice email sent.",
        messageId,
        invoiceUrl,
        to: emailDelivery.actualTo,
        intendedTo: emailDelivery.intendedTo,
        testMode: emailDelivery.testMode,
        templateMode
    };
});

exports.sendServiceReportOnFinish = functions.https.onCall(async (data, context) => {
    console.log("Send Service Report On Finish");

    try {
        const companyId = data?.data?.companyId || data?.companyId;
        const serviceStopId = data?.data?.serviceStopId || data?.serviceStopId;

        if (!companyId) {
            throw new Error("Missing companyId");
        }

        if (!serviceStopId) {
            throw new Error("Missing serviceStopId");
        }

        console.log("Company Id:", companyId);
        console.log("Service Stop Id:", serviceStopId);

        // 1. Get Service Stop
        const serviceStopRef = db
            .collection("companies")
            .doc(companyId)
            .collection("serviceStops")
            .doc(serviceStopId);

        const serviceStopDoc = await serviceStopRef.get();

        if (!serviceStopDoc.exists) {
            console.log("Did not Find Service Stop");
            return {
                status: 404,
                error: "Service stop not found"
            };
        }

        const serviceStopData = serviceStopDoc.data();
        console.log("Service Stop data:", serviceStopData);

        // If this service stop belongs to a main company, use that for stopData.
        // Otherwise fall back to companyId.
        const mainCompanyId = serviceStopData.mainCompanyId || companyId;

        console.log("Main Company Id:", mainCompanyId);

        // 2. Get StopData from companies/{mainCompanyId}/stopData
        // where stopData.serviceStopId == serviceStopId

        const stopDataSnapshot = await db
            .collection("companies")
            .doc(mainCompanyId)
            .collection("stopData")
            .where("serviceStopId", "==", serviceStopId)
            .limit(1)
            .get();

        let stopDataDoc = null;
        let stopData = {};

        if (stopDataSnapshot.empty) {
            console.log("Did not Find Stop Data. Continuing with service stop details only.");
        } else {
            stopDataDoc = stopDataSnapshot.docs[0];
            stopData = stopDataDoc.data();

            console.log("Stop Data Doc Id:", stopDataDoc.id);
            console.log("Stop Data:", stopData);
        }

        // 3. Get Company
        const companyRef = db.collection("companies").doc(companyId);
        const companyDoc = await companyRef.get();

        if (!companyDoc.exists) {
            console.log("Company Doc DNE");
            return {
                status: 404,
                error: "Company not found"
            };
        }

        const companyData = companyDoc.data();
        const companyName = companyData.name || serviceStopData.companyName || "Your Pool Company";
        const companyContactEmail = getCompanyContactEmail(companyData);

        console.log("Company data:", companyData);

        // 4. Check company email config
        const emailConfigRef = db
            .collection("companies")
            .doc(companyId)
            .collection("settings")
            .doc("emailConfiguration");

        const emailConfigDoc = await emailConfigRef.get();

        if (!emailConfigDoc.exists) {
            console.log("Company Email Config DNE");
            return {
                status: 404,
                error: "Company email configuration not found"
            };
        }

        const emailConfigData = emailConfigDoc.data();
        const categoryEmailSetting = resolveServiceStopCategoryEmailSetting({
            emailConfigData,
            serviceStopData,
            companyName,
        });

        if (!categoryEmailSetting.sendEmailOnFinish) {
            console.log("Email Not Turned on for Service Stop Category", categoryEmailSetting.category);
            return {
                status: 200,
                account: "Category email is turned off",
                category: categoryEmailSetting.category
            };
        }

        // 5. Check customer email config
        const customerEmailConfigSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("settings")
            .doc("emailConfiguration")
            .collection("customerConfiguration")
            .where("customerId", "==", serviceStopData.customerId)
            .limit(1)
            .get();

        if (customerEmailConfigSnapshot.empty) {
            console.log("Customer Email Config Doc DNE");
            return {
                status: 404,
                error: "Customer email configuration not found"
            };
        }

        const customerEmailConfigDoc = customerEmailConfigSnapshot.docs[0];
        const customerEmailConfigData = customerEmailConfigDoc.data();

        if (!customerEmailConfigData.emailIsOn) {
            console.log("Email Not Turned on for Customer");
            return {
                status: 200,
                account: "Customer email is turned off"
            };
        }

        const customerEmail = (
            serviceStopData.email ||
            serviceStopData.customerEmail ||
            stopData.email ||
            stopData.customerEmail ||
            customerEmailConfigData.email ||
            await getCompanyCustomerEmail({
                companyId,
                customerId: serviceStopData.customerId || stopData.customerId || "",
            })
        );
        const serviceReportBaseUrl = data?.data?.serviceReportBaseUrl || data?.serviceReportBaseUrl || process.env.SERVICE_REPORT_BASE_URL || process.env.APP_BASE_URL || "";
        const serviceReportUrl = buildUrl(serviceReportBaseUrl, `/serviceStop/detail/${serviceStopId}`);
        const customerAccess = await buildCustomerAccessTemplateData({
            companyId,
            customerId: serviceStopData.customerId || stopData.customerId || "",
            email: customerEmail,
            record: {
                ...serviceStopData,
                ...stopData,
                customerId: serviceStopData.customerId || stopData.customerId || "",
            },
            actionUrl: serviceReportUrl,
            baseUrl: serviceReportBaseUrl,
        });
        const emailDelivery = await resolveEmailDeliveryRecipient(customerEmail);

        // Helpers
        const formatDate = (value) => {
            if (!value) return "";

            const date =
                typeof value.toDate === "function"
                    ? value.toDate()
                    : new Date(value);

            return date.toLocaleDateString("en-US", {
                month: "numeric",
                day: "numeric",
                year: "numeric",
                timeZone: "America/Los_Angeles"
            });
        };

        const formatTime = (value) => {
            if (!value) return "";

            const date =
                typeof value.toDate === "function"
                    ? value.toDate()
                    : new Date(value);

            return date.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "America/Los_Angeles"
            });
        };

        const normalizePhotoUrls = (photoUrls) => {
            if (!Array.isArray(photoUrls)) return [];

            return photoUrls.map((photo) => ({
                id: photo.id || "",
                description: photo.description || "",
                // Swift model uses imageURL, but your email template used imageUrl.
                imageUrl: photo.imageUrl || photo.imageURL || ""
            }));
        };

        const normalizeReadings = (readings) => {
            if (!Array.isArray(readings)) return [];

            return readings.map((reading) => ({
                id: reading.id || "",
                templateId: reading.templateId || "",
                universalTemplateId: reading.universalTemplateId || "",
                dosageType: reading.dosageType || "",
                name: reading.name || "",
                amount: reading.amount || "",
                UOM: reading.UOM || "",
                bodyOfWaterId: reading.bodyOfWaterId || ""
            }));
        };

        const normalizeDosages = (dosages) => {
            if (!Array.isArray(dosages)) return [];

            return dosages.map((dosage) => ({
                id: dosage.id || "",
                templateId: dosage.templateId || "",
                universalTemplateId: dosage.universalTemplateId || "",
                name: dosage.name || "",
                amount: dosage.amount || "",
                UOM: dosage.UOM || "",
                rate: dosage.rate || "",
                linkedItem: dosage.linkedItem || "",
                bodyOfWaterId: dosage.bodyOfWaterId || ""
            }));
        };

        const normalizeEquipmentMeasurements = (equipmentMeasurements) => {
            if (!Array.isArray(equipmentMeasurements)) return [];

            return equipmentMeasurements.map((measurement) => ({
                id: measurement.id || "",
                equipmentId: measurement.equipmentId || "",
                date: formatDate(measurement.date),
                status: measurement.status || "",
                poundForcePerSquareInch:
                    measurement.poundForcePerSquareInch === undefined || measurement.poundForcePerSquareInch === null
                        ? ""
                        : String(measurement.poundForcePerSquareInch),
                revolutionsPerMinute:
                    measurement.revolutionsPerMinute === undefined || measurement.revolutionsPerMinute === null
                        ? ""
                        : String(measurement.revolutionsPerMinute)
            }));
        };

        const photoUrls = normalizePhotoUrls(serviceStopData.photoUrls);
        if (categoryEmailSetting.requirePhotoOnFinish && photoUrls.length === 0) {
            console.log("Photo Required For Service Stop Category", categoryEmailSetting.category);
            return {
                status: 400,
                error: "A photo is required before this service stop can be finished.",
                category: categoryEmailSetting.category
            };
        }

        const emailStopData = {
            id: stopData.id || serviceStopId,
            date: formatDate(stopData.date),
            serviceStopId: stopData.serviceStopId || serviceStopId,
            readings: normalizeReadings(stopData.readings),
            dosages: normalizeDosages(stopData.dosages),
            observation: Array.isArray(stopData.observation) ? stopData.observation : [],
            bodyOfWaterId: stopData.bodyOfWaterId || "",
            customerId: stopData.customerId || serviceStopData.customerId || "",
            serviceLocationId: stopData.serviceLocationId || serviceStopData.serviceLocationId || "",
            userId: stopData.userId || serviceStopData.techId || "",
            equipmentMeasurements: normalizeEquipmentMeasurements(stopData.equipmentMeasurements)
        };

        // 6. Build SendGrid Message
        let replyToEmail = emailConfigData.replyToEmail || companyContactEmail || "info@dripdrop-poolapp.com"
        const serviceReportTemplateData = addDeliveryModeTemplateData({
            subject: categoryEmailSetting.emailSubject || `${companyName} Service Stop Recap`,
            preHeader: categoryEmailSetting.emailBody || "Your service stop recap is ready.",

            customer: serviceStopData.customerName || "",
            customerId: serviceStopData.customerId || "",

            technician: serviceStopData.tech || "",
            technicianId: serviceStopData.techId || "",

            companyName: companyName,
            serviceStopCategory: categoryEmailSetting.category,
            category: categoryEmailSetting.category,
            emailSubject: categoryEmailSetting.emailSubject || "",
            emailBody: categoryEmailSetting.emailBody || "",
            emailFooter: categoryEmailSetting.emailFooter || "",
            categoryMessage: categoryEmailSetting.emailBody || "",
            ...customerAccess,

            stopData: emailStopData,

            address01: serviceStopData.address?.streetAddress || "",
            address02: serviceStopData.address?.address02 || "",
            city: serviceStopData.address?.city || "",
            state: serviceStopData.address?.state || "",
            zip: serviceStopData.address?.zip || "",

            serviceTime: formatTime(serviceStopData.endTime || serviceStopData.startTime || serviceStopData.serviceDate),
            serviceDate: formatDate(serviceStopData.serviceDate),

            photoUrls: photoUrls
        }, emailDelivery);
        const msg = {

            to: emailDelivery.actualTo,
            from: "info@dripdrop-poolapp.com",
            replyTo: replyToEmail,
            templateId: categoryEmailSetting.sendGridTemplateId || DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
            dynamicTemplateData: serviceReportTemplateData
        };

        console.log("Msg data:", JSON.stringify(msg.dynamicTemplateData, null, 2));

        await sgMail.send(msg);

        console.log("Successfully Sent Service Stop Email");

        return {
            status: 200,
            account: "Successfully Sent",
            category: categoryEmailSetting.category,
            customerActionUrl: customerAccess.customerActionUrl,
            claimAccountUrl: customerAccess.claimAccountUrl,
            to: emailDelivery.actualTo,
            intendedTo: emailDelivery.intendedTo,
            testMode: emailDelivery.testMode
        };
    } catch (error) {
        console.log("Failed To Send Service Stop Email");
        console.error(error);

        return {
            status: error.code || 500,
            error: error.response?.body || error.message
        };
    }
});
exports.sendJobEstimateEmail = functions.https.onCall(async (data, context) => {

    console.log('Send Job Estiamte Email')

    try {
        const payload = getCallableData(data);
        let companyId = payload.companyId;
        const mainCompanyId = payload.mainCompanyId || payload.companyId;
        const serviceStopId = payload.serviceStopId;

        if (!companyId) {
            throw new Error("Missing companyId");
        }

        if (!serviceStopId) {
            throw new Error("Missing serviceStopId");
        }

        //Get Service Stop
        const ssRef = db.collection("companies").doc(mainCompanyId).collection("serviceStops").doc(serviceStopId);
        const ssdoc = await ssRef.get();

        if (!ssdoc.exists) {
            return {
                status: 404,
                error: "Service stop not found"
            };
        }

        const serviceStopData = ssdoc.data();
        if (serviceStopData.otherCompany) {
            companyId = serviceStopData.contractedCompanyId || companyId;
        }

        const companyRef = db.collection("companies").doc(companyId);
        const companyDoc = await companyRef.get();

        if (!companyDoc.exists) {
            return {
                status: 404,
                error: "Company not found"
            };
        }

        const companyData = companyDoc.data();
        const companyName = companyData.name || companyData.companyName || serviceStopData.companyName || "Your Pool Company";
        const customerEmail = (
            serviceStopData.email ||
            serviceStopData.customerEmail ||
            await getCompanyCustomerEmail({
                companyId,
                customerId: serviceStopData.customerId || "",
            })
        );
        const estimateBaseUrl = payload.estimateBaseUrl || process.env.JOB_ESTIMATE_BASE_URL || process.env.APP_BASE_URL || "";
        const estimateUrl = buildUrl(estimateBaseUrl, `/serviceStop/detail/${serviceStopId}`);
        const customerAccess = await buildCustomerAccessTemplateData({
            companyId,
            customerId: serviceStopData.customerId || "",
            email: customerEmail,
            record: serviceStopData,
            actionUrl: estimateUrl,
            baseUrl: estimateBaseUrl,
        });
        const emailDelivery = await resolveEmailDeliveryRecipient(customerEmail);
        const templateData = addDeliveryModeTemplateData({
            subject: companyName + " Job Estiamte",
            preHeader: "Pre-header",
            customer: serviceStopData.customerName,
            customerId: serviceStopData.customerId,
            ...customerAccess,
            technician: serviceStopData.tech,
            technicianId: serviceStopData.techId,
            stopData: {},
            companyName: companyName,
            address01: serviceStopData.address?.streetAddress || "",
            city: serviceStopData.address?.city || "",
            state: serviceStopData.address?.state || "",
            zip: serviceStopData.address?.zip || "",
            serviceTime: "12:35 PM",
            serviceDate: "5/16/2025",
            photoUrls: []
        }, emailDelivery);
        const msg = {
            to: emailDelivery.actualTo,
            from: 'mespineli@dripdrop-poolapp.com ',
            replyTo: getCompanyContactEmail(companyData) || 'info@dripdrop-poolapp.com',
            templateId: 'd-566087cd96864db0a07167e8a080cc12',
            dynamicTemplateData: templateData
        };

        await sgMail.send(msg);

        return {
            status: 200,
            account: "Successfully Sent",
            customerActionUrl: customerAccess.customerActionUrl,
            claimAccountUrl: customerAccess.claimAccountUrl,
            to: emailDelivery.actualTo,
            intendedTo: emailDelivery.intendedTo,
            testMode: emailDelivery.testMode
        };
    } catch (error) {
        console.error(
            "An error occurred when calling the Create New Recurring Service Stop API",
            error
        );
        return {
            status: 500,
            error: error.message
        };
    }
});

exports.sendInvoiceEmail = functions.https.onCall(async (data, context) => {

    console.log('Send Service Report On Finish')

    try {
        const payload = getCallableData(data);
        const invoiceId = payload.invoiceId;

        if (!invoiceId) {
            throw new Error("Missing invoiceId");
        }

        //Get Invoice
        const invoiceRef = db.collection("invoices").doc(invoiceId);
        const invoiceDoc = await invoiceRef.get();

        if (!invoiceDoc.exists) {
            return {
                status: 404,
                error: "Invoice not found"
            };
        }

        const invoiceData = invoiceDoc.data();
        const companyRef = db.collection("companies").doc(invoiceData.receiverId);
        const companyDoc = await companyRef.get();

        if (!companyDoc.exists) {
            return {
                status: 404,
                error: "Receiver company not found"
            };
        }

        const companyData = companyDoc.data();
        const companyName = companyData.name || companyData.companyName || invoiceData.receiverName || "Your Pool Company";
        const intendedEmail = invoiceData.email || invoiceData.receiverEmail || getCompanyContactEmail(companyData);
        const emailDelivery = await resolveEmailDeliveryRecipient(intendedEmail);
        const lineItems = Array.isArray(invoiceData.lineItems) ? invoiceData.lineItems : [];
        const pushLineItems = lineItems.map((lineItem) => ({
            id: lineItem.id,
            description: lineItem.description,
            induvidualCost: ((Number(lineItem.induvidualCost) || 0) / 100).toFixed(2),
            itemId: lineItem.itemId,
            total: ((Number(lineItem.total) || 0) / 100).toFixed(2),
            quantity: Number(lineItem.induvidualCost)
                ? ((Number(lineItem.total) || 0) / Number(lineItem.induvidualCost))
                : 0
        }));
        const templateData = addDeliveryModeTemplateData({
            subject: companyName + " Invoice " + invoiceData.internalIdenifier + " for $" + ((Number(invoiceData.total) || 0) / 100).toFixed(2),
            invoiceId: invoiceData.internalIdenifier,
            preHeader: "Pre-header",
            receiverCompany: invoiceData.receiverName,
            receiverCompanyId: invoiceData.receiverId,
            senderCompany: invoiceData.senderName,
            senderCompanyId: invoiceData.senderId,
            terms: invoiceData.terms,
            total: ((Number(invoiceData.total) || 0) / 100).toFixed(2),
            lineItems: pushLineItems,
        }, emailDelivery);
        const msg = {
            to: emailDelivery.actualTo,
            from: 'mespineli@dripdrop-poolapp.com ',
            replyTo: getCompanyContactEmail(companyData) || 'info@dripdrop-poolapp.com',
            templateId: 'd-16d13e4c5d7e4c6f91667c76a3513c41',
            dynamicTemplateData: templateData
        };

        await sgMail.send(msg);

        return {
            status: 200,
            account: "Successfully Sent",
            to: emailDelivery.actualTo,
            intendedTo: emailDelivery.intendedTo,
            testMode: emailDelivery.testMode
        };
    } catch (error) {
        console.error(
            "An error occurred when calling the Create New Recurring Service Stop API",
            error
        );
        return {
            status: 500,
            error: error.message
        };
    }
});

exports.sendPaymentConfirmationEmail = functions.https.onCall(async (data, context) => {

    console.log('Send Service Report On Finish')

    try {
        const payload = getCallableData(data);
        const invoiceId = payload.invoiceId;

        if (!invoiceId) {
            throw new Error("Missing invoiceId");
        }

        //Get Service Stop
        const invoiceRef = db.collection("invoices").doc(invoiceId);
        const invoiceDoc = await invoiceRef.get();

        if (!invoiceDoc.exists) {
            return {
                status: 404,
                error: "Invoice not found"
            };
        }

        const invoiceData = invoiceDoc.data();
        const receiverCompanyId = invoiceData.receivedData || invoiceData.receiverId;

        if (!receiverCompanyId) {
            throw new Error("Invoice is missing receiver company id");
        }

        const companyRef = db.collection("companies").doc(receiverCompanyId);
        const companyDoc = await companyRef.get();

        if (!companyDoc.exists) {
            return {
                status: 404,
                error: "Receiver company not found"
            };
        }

        const companyData = companyDoc.data();
        const companyName = companyData.name || companyData.companyName || invoiceData.receiverName || "Your Pool Company";
        const intendedEmail = invoiceData.email || invoiceData.receiverEmail || getCompanyContactEmail(companyData);
        const emailDelivery = await resolveEmailDeliveryRecipient(intendedEmail);
        const lineItems = Array.isArray(invoiceData.lineItems) ? invoiceData.lineItems : [];
        const pushLineItems = lineItems.map((lineItem) => ({
            id: lineItem.id,
            description: lineItem.description,
            induvidualCost: ((Number(lineItem.induvidualCost) || 0) / 100).toFixed(2),
            itemId: lineItem.itemId,
            total: ((Number(lineItem.total) || 0) / 100).toFixed(2),
            quantity: Number(lineItem.induvidualCost)
                ? ((Number(lineItem.total) || 0) / Number(lineItem.induvidualCost))
                : 0
        }));
        const templateData = addDeliveryModeTemplateData({
            subject: companyName + " Invoice " + invoiceData.internalIdenifier + " for " + ((Number(invoiceData.total) || 0) / 100).toFixed(2),
            invoiceId: invoiceData.internalIdenifier,
            preHeader: "Pre-header",
            receiverCompany: invoiceData.receiverName,
            receiverCompanyId: invoiceData.receiverId,
            senderCompany: invoiceData.senderName,
            senderCompanyId: invoiceData.senderId,
            terms: invoiceData.terms,
            total: ((Number(invoiceData.total) || 0) / 100).toFixed(2),
            lineItems: pushLineItems,
        }, emailDelivery);
        const msg = {
            to: emailDelivery.actualTo,
            from: 'mespineli@dripdrop-poolapp.com ',
            replyTo: getCompanyContactEmail(companyData) || 'info@dripdrop-poolapp.com',
            templateId: 'd-6f7f138176c747be80aabd671e67577a',
            dynamicTemplateData: templateData
        };

        await sgMail.send(msg);

        return {
            status: 200,
            account: "Successfully Sent",
            to: emailDelivery.actualTo,
            intendedTo: emailDelivery.intendedTo,
            testMode: emailDelivery.testMode
        };
    } catch (error) {
        console.error(
            "An error occurred when calling the Create New Recurring Service Stop API",
            error
        );
        return {
            status: 500,
            error: error.message
        };
    }
});
