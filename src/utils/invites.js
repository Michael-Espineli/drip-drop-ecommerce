import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./config";
import { getCallableAuthPayload } from "./callableAuth";
import { normalizeEmail } from "./email";

const normalizeInviteStatus = (value) => String(value || "").trim().toLowerCase();

const decodeSafely = (value) => {
    const text = String(value || "").trim();
    if (!text) return "";

    try {
        return decodeURIComponent(text).trim();
    } catch (error) {
        return text;
    }
};

const cleanInviteId = (value) => {
    const text = decodeSafely(value).replace(/^\/+|\/+$/g, "");
    if (!text || /[/?#]/.test(text)) return "";
    return text;
};

export const extractCompanyInviteId = (value) => {
    const text = decodeSafely(value);
    if (!text) return "";

    const baseUrl = typeof window === "undefined" ? "https://dripdrop-poolapp.com" : window.location.origin;

    try {
        const parsedUrl = new URL(text, baseUrl);
        const queryInviteId = parsedUrl.searchParams.get("inviteId") || parsedUrl.searchParams.get("id");
        if (queryInviteId) {
            return extractCompanyInviteId(queryInviteId);
        }

        const companyInviteMatch = parsedUrl.pathname.match(/\/company\/invite\/([^/?#]+)/i);
        if (companyInviteMatch?.[1]) {
            return cleanInviteId(companyInviteMatch[1]);
        }
    } catch (error) {
        // Fall through to path and raw-code parsing.
    }

    const pathMatch = text.match(/(?:^|\/)company\/invite\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
        return cleanInviteId(pathMatch[1]);
    }

    return cleanInviteId(text);
};

export const buildCompanyInvitePath = (inviteId) => {
    const cleanId = extractCompanyInviteId(inviteId);
    return cleanId ? `/company/invite/${encodeURIComponent(cleanId)}` : "";
};

export const buildCompanyInviteUrl = (baseUrl, inviteId) => {
    const cleanBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
    const cleanInviteId = extractCompanyInviteId(inviteId);

    if (!cleanBaseUrl || !cleanInviteId) return "";
    return `${cleanBaseUrl}${buildCompanyInvitePath(cleanInviteId)}`;
};

export const isCompanyAccessInactive = (invite = {}) => {
    const accessStatus = normalizeInviteStatus(invite.companyUserStatus || invite.userAccessStatus || invite.accessStatus || invite.status);
    if (invite.accessActive === false) return true;
    return ["inactive", "past", "revoked"].includes(accessStatus);
};

/**
 * Accepts a company invitation and performs all necessary database operations in a single batch.
 * @param {object} invite The invitation object from Firestore.
 * @param {string} userId The ID of the user accepting the invite.
 * @param {string} userName The display name of the user.
 */
export const acceptInvite = async (invite, userId, firstName, lastName, email) => {
    if (!invite || !userId) {
        throw new Error("Invite and user information must be provided.");
    }

    const acceptTechInvite = httpsCallable(functions, "acceptTechInvite");
    const authPayload = await getCallableAuthPayload();
    const result = await acceptTechInvite({
        inviteId: invite.id,
        userId,
        ...authPayload,
        profile: {
            firstName: firstName || invite.firstName || "",
            lastName: lastName || invite.lastName || "",
            email: normalizeEmail(email || invite.email),
            accountType: "Company",
            photoUrl: null,
            profileImagePath: null,
            color: null,
            bio: "",
            exp: 0,
        },
    });

    const response = result.data;

    if (!response || response.status !== 200) {
        throw new Error(response?.error || "Invite could not be accepted.");
    }
};

/**
 * Declines a company invitation.
 * @param {object} invite The invitation object from Firestore.
 */
export const declineInvite = async (invite) => {
    if (!invite) {
        throw new Error("Invite must be provided.");
    }
    const inviteRef = doc(db, "invites", invite.id);
    await updateDoc(inviteRef, { status: 'rejected' });
};

export const createCompanyUserInvite = async (payload) => {
    const authPayload = await getCallableAuthPayload();
    const callable = httpsCallable(functions, "createCompanyUserInvite");
    const result = await callable({
        ...payload,
        ...authPayload,
        auth: authPayload,
    });
    return result.data || {};
};

export const manageCompanyUserInvite = async (payload) => {
    const authPayload = await getCallableAuthPayload();
    const callable = httpsCallable(functions, "manageCompanyUserInvite");
    const result = await callable({
        ...payload,
        ...authPayload,
        auth: authPayload,
    });
    return result.data || {};
};
