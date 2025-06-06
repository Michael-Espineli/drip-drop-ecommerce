// src/utils/models/CompanyUser.js

export const CompanyUserStatus = {
    active: "Active",
    pending: "Pending",
    past: "Past"
};

export const WorkerTypeEnum = {
    contractor: "Independent Contractor",
    employee: "Employee",
    notAssigned: ""
};

export class CompanyUser {
    constructor(id, userId, userName, roleId, roleName, dateCreated, status, workerType, linkedCompanyId = null, linkedCompanyName = null) {
        this.id = id;
        this.userId = userId;
        this.userName = userName;
        this.roleId = roleId;
        this.roleName = roleName;
        this.dateCreated = dateCreated instanceof Date ? dateCreated : new Date(dateCreated);
        this.status = status;
        this.workerType = workerType;
        this.linkedCompanyId = linkedCompanyId;
        this.linkedCompanyName = linkedCompanyName;
    }

    // Optional: Add a static method to create a CompanyUser from a Firebase document
    static fromFirestore(doc) {
        const data = doc.data();
        return new CompanyUser(
            doc.id,
            data.userId,
            data.userName,
            data.roleId,
            data.roleName,
            data.dateCreated ? data.dateCreated.toDate() : new Date(), // Convert Firebase Timestamp to Date
            data.status,
            data.workerType,
            data.linkedCompanyId,
            data.linkedCompanyName
        );
    }

    // Optional: Add a method to convert a CompanyUser to a plain object for Firestore
    toFirestore() {
        return {
            userId: this.userId,
            userName: this.userName,
            roleId: this.roleId,
            roleName: this.roleName,
            dateCreated: this.dateCreated,
            status: this.status,
            workerType: this.workerType,
            linkedCompanyId: this.linkedCompanyId,
            linkedCompanyName: this.linkedCompanyName
        };
    }
}