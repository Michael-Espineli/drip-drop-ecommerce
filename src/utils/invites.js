import { doc, writeBatch, updateDoc } from "firebase/firestore";
import { db } from "./config";
import { NavLink } from "react-router-dom";

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
    const userName = firstName + " " + lastName
    const batch = writeBatch(db);
    // 1. Create the companyUser document
    const dataBaseUserRef = doc(db, "users", userId);
    batch.set(dataBaseUserRef, {
        id: userId,
        email:email,
        photoUrl: null,
        dateCreated: new Date(),
        firstName: firstName,
        lastName: lastName,
        accountType: "Company",
        profileImagePath: null,
        color: null,
        bio: "",
        exp:0
    });
    // 1. Create the companyUser document
    const companyUserRef = doc(db, "companies", invite.companyId, "companyUsers", userId);
    batch.set(companyUserRef, {
        id: companyUserRef.id,
        userId: userId,
        userName: userName,
        roleId: invite.roleId,
        roleName: invite.roleName,
        dateCreated: new Date(),
        status: 'Active',
        workerType: invite.workerType, 
    });

    // 2. Create the userAccess document
    const userAccessRef = doc(db, "users", userId, "userAccess", invite.companyId);
    batch.set(userAccessRef, {
        id: invite.companyId,
        companyId: invite.companyId,
        companyName: invite.companyName,
        roleId: invite.roleId,
        roleName: invite.roleName,
        dateCreated: new Date(),
    });

    // 3. Update the invite status
    const inviteRef = doc(db, "invites", invite.id);
    batch.update(inviteRef, { status: 'Accepted', acceptedAt: new Date() });

    // Commit the batch
    await batch.commit();
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
