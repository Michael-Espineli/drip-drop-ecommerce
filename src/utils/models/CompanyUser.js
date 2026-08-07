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

export const RouteVehicleAccess = {
    personal: "personal",
    company: "company",
    both: "both"
};

export const routeVehicleAccessOptions = [
    {
        value: RouteVehicleAccess.personal,
        label: "Personal only",
        description: "Can use their saved personal vehicle, but not company fleet vehicles."
    },
    {
        value: RouteVehicleAccess.company,
        label: "Company vehicles",
        description: "Can use company fleet vehicles, but not a personal vehicle."
    },
    {
        value: RouteVehicleAccess.both,
        label: "Both",
        description: "Can use either company fleet vehicles or their saved personal vehicle."
    }
];

export const normalizeRouteVehicleAccess = (companyUser = {}) => {
    const rawValue = typeof companyUser === "string" ? companyUser : companyUser?.routeVehicleAccess;
    const normalizedValue = String(rawValue || "").trim().toLowerCase();

    if (Object.values(RouteVehicleAccess).includes(normalizedValue)) {
        return normalizedValue;
    }

    return companyUser?.allowPersonalVehicle ? RouteVehicleAccess.both : RouteVehicleAccess.company;
};

export const canUsePersonalRouteVehicle = (companyUser = {}) => (
    [RouteVehicleAccess.personal, RouteVehicleAccess.both].includes(normalizeRouteVehicleAccess(companyUser))
);

export const canUseCompanyRouteVehicle = (companyUser = {}) => (
    [RouteVehicleAccess.company, RouteVehicleAccess.both].includes(normalizeRouteVehicleAccess(companyUser))
);

export const routeVehicleAccessLabel = (companyUser = {}) => (
    routeVehicleAccessOptions.find((option) => option.value === normalizeRouteVehicleAccess(companyUser))?.label || "Company vehicles"
);

export class CompanyUser {
    constructor(
        id,
        userId,
        userName,
        roleId,
        roleName,
        dateCreated,
        status,
        workerType,
        linkedCompanyId = null,
        linkedCompanyName = null,
        allowPersonalVehicle = false,
        personalVehicle = null,
        routeVehicleAccess = null
    ) {
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
        this.routeVehicleAccess = normalizeRouteVehicleAccess({ routeVehicleAccess, allowPersonalVehicle });
        this.allowPersonalVehicle = canUsePersonalRouteVehicle(this.routeVehicleAccess);
        this.personalVehicle = personalVehicle;
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
            data.linkedCompanyName,
            Boolean(data.allowPersonalVehicle),
            data.personalVehicle || null,
            data.routeVehicleAccess
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
            linkedCompanyName: this.linkedCompanyName,
            allowPersonalVehicle: this.allowPersonalVehicle,
            personalVehicle: this.personalVehicle,
            routeVehicleAccess: this.routeVehicleAccess
        };
    }
}
