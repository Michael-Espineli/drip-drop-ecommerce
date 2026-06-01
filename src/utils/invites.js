import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./config";

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
    const result = await acceptTechInvite({
        inviteId: invite.id,
        userId,
        profile: {
            firstName: firstName || invite.firstName || "",
            lastName: lastName || invite.lastName || "",
            email: email || invite.email || "",
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
    await updateDoc(inviteRef, { status: 'Declined' });
};
