import React, { useState, useEffect, useContext, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, query, where, collection, getDocs, getDoc, limit, updateDoc } from "firebase/firestore";
import Select from "react-select";
import {
    ArrowLeftIcon,
    CheckIcon,
    PencilSquareIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import toast from "react-hot-toast";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { CompanyUserStatus, WorkerTypeEnum } from "../../../utils/models/CompanyUser";

const VEHICLE_TYPES = ["Car", "Truck", "Van"];

const emptyPersonalVehicle = {
    nickName: "",
    vehicalType: "Car",
    year: "",
    make: "",
    model: "",
    color: "",
    plate: "",
    miles: "",
};

const workerTypeOptions = [
    { value: WorkerTypeEnum.employee, label: WorkerTypeEnum.employee },
    { value: WorkerTypeEnum.contractor, label: WorkerTypeEnum.contractor },
];

const statusOptions = [
    { value: CompanyUserStatus.active, label: CompanyUserStatus.active },
    { value: CompanyUserStatus.pending, label: CompanyUserStatus.pending },
    { value: CompanyUserStatus.past, label: CompanyUserStatus.past },
];

const selectStyles = {
    control: (base, state) => ({
        ...base,
        minHeight: "40px",
        borderColor: state.isFocused ? "#2563eb" : "#cbd5e1",
        borderRadius: "0.5rem",
        boxShadow: state.isFocused ? "0 0 0 3px rgba(37, 99, 235, 0.12)" : "none",
        "&:hover": {
            borderColor: state.isFocused ? "#2563eb" : "#94a3b8",
        },
    }),
    menu: (base) => ({ ...base, zIndex: 20 }),
};

const inputBase = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100";

const normalizeStatus = (status) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "active") return CompanyUserStatus.active;
    if (normalized === "pending") return CompanyUserStatus.pending;
    if (normalized === "past" || normalized === "inactive") return CompanyUserStatus.past;
    return status || CompanyUserStatus.active;
};

const normalizeWorkerType = (workerType) => {
    const normalized = String(workerType || "").trim().toLowerCase();
    if (normalized.includes("contractor")) return WorkerTypeEnum.contractor;
    if (normalized.includes("employee")) return WorkerTypeEnum.employee;
    return workerType || WorkerTypeEnum.employee;
};

const getStatusClass = (status) => {
    switch (normalizeStatus(status)) {
        case CompanyUserStatus.active:
            return "bg-emerald-50 text-emerald-700 ring-emerald-200";
        case CompanyUserStatus.pending:
            return "bg-amber-50 text-amber-700 ring-amber-200";
        case CompanyUserStatus.past:
            return "bg-slate-100 text-slate-600 ring-slate-200";
        default:
            return "bg-slate-100 text-slate-700 ring-slate-200";
    }
};

const getDisplayName = (user) => {
    const safeUser = user || {};

    return (
        safeUser.userName ||
        safeUser.displayName ||
        [safeUser.firstName, safeUser.lastName].filter(Boolean).join(" ") ||
        safeUser.email ||
        safeUser.userId ||
        "Company User"
    );
};

const getInitials = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CU";
};

const toDate = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
    const date = toDate(value);
    return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Not set";
};

const buildPersonalVehicleForm = (companyUser) => ({
    ...emptyPersonalVehicle,
    ...(companyUser?.personalVehicle || {}),
    miles: companyUser?.personalVehicle?.miles?.toString() || "",
});

const buildProfileDraft = (companyUser) => ({
    roleId: companyUser?.roleId || "",
    roleName: companyUser?.roleName || "",
    status: normalizeStatus(companyUser?.status),
    workerType: normalizeWorkerType(companyUser?.workerType),
});

const Section = ({ title, description, action, children }) => (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h2 className="text-base font-semibold text-slate-950">{title}</h2>
                {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>
            {action}
        </div>
        <div className="mt-4">
            {children}
        </div>
    </section>
);

const DetailField = ({ label, value }) => (
    <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-sm font-medium text-slate-900">{value || "Not set"}</p>
    </div>
);

const Badge = ({ children, className = "" }) => (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${className}`}>
        {children}
    </span>
);

const CompanyUserDetails = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const { companyUserId } = useParams();
    const navigate = useNavigate();

    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [roleList, setRoleList] = useState([]);
    const [areRolesLoading, setAreRolesLoading] = useState(true);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [profileDraft, setProfileDraft] = useState(buildProfileDraft(null));
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [allowPersonalVehicle, setAllowPersonalVehicle] = useState(false);
    const [personalVehicle, setPersonalVehicle] = useState(emptyPersonalVehicle);
    const [isSavingVehicleAccess, setIsSavingVehicleAccess] = useState(false);

    useEffect(() => {
        if (!recentlySelectedCompany || !companyUserId) return;

        const applyFetchedUser = (userDoc) => {
            const fetchedUser = { ...userDoc.data(), id: userDoc.id };
            setUser(fetchedUser);
            setProfileDraft(buildProfileDraft(fetchedUser));
            setAllowPersonalVehicle(Boolean(fetchedUser.allowPersonalVehicle));
            setPersonalVehicle(buildPersonalVehicleForm(fetchedUser));
        };

        const fetchUser = async () => {
            setIsLoading(true);
            try {
                const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
                const q = query(usersRef, where("userId", "==", companyUserId), limit(1));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    applyFetchedUser(querySnapshot.docs[0]);
                    return;
                }

                const userDoc = await getDoc(doc(db, "companies", recentlySelectedCompany, "companyUsers", companyUserId));
                if (userDoc.exists()) {
                    applyFetchedUser(userDoc);
                } else {
                    toast.error("User not found in this company.");
                    navigate("/company/companyUsers");
                }
            } catch (error) {
                console.error("Error fetching user details: ", error);
                toast.error("Failed to load user details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchUser();
    }, [recentlySelectedCompany, companyUserId, navigate]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setRoleList([]);
            setAreRolesLoading(false);
            return;
        }

        const fetchRoles = async () => {
            setAreRolesLoading(true);
            try {
                const rolesSnapshot = await getDocs(collection(db, "companies", recentlySelectedCompany, "roles"));
                const roles = rolesSnapshot.docs.map((roleDoc) => {
                    const roleData = roleDoc.data();
                    return {
                        ...roleData,
                        id: roleDoc.id,
                        value: roleDoc.id,
                        label: roleData.name || roleData.roleName || "Unnamed Role",
                    };
                });
                setRoleList(roles);
            } catch (error) {
                console.error("Error fetching roles:", error);
                toast.error("Could not load company roles.");
            } finally {
                setAreRolesLoading(false);
            }
        };

        fetchRoles();
    }, [recentlySelectedCompany]);

    const roleOptions = useMemo(() => {
        const options = roleList.map((role) => ({
            ...role,
            value: role.id || role.value,
            label: role.label || role.name || "Unnamed Role",
        }));

        if (user?.roleId && !options.some((option) => option.value === user.roleId)) {
            options.unshift({
                value: user.roleId,
                label: user.roleName || "Current Role",
            });
        }

        return options;
    }, [roleList, user?.roleId, user?.roleName]);

    const selectedRoleOption = useMemo(
        () => roleOptions.find((role) => role.value === profileDraft.roleId) || null,
        [roleOptions, profileDraft.roleId]
    );

    const hasProfileChanges = useMemo(() => {
        if (!user) return false;
        const currentProfile = buildProfileDraft(user);
        return (
            currentProfile.roleId !== profileDraft.roleId ||
            currentProfile.status !== profileDraft.status ||
            currentProfile.workerType !== profileDraft.workerType
        );
    }, [profileDraft, user]);

    const displayName = getDisplayName(user);
    const isContractor = normalizeWorkerType(user?.workerType) === WorkerTypeEnum.contractor;

    const updatePersonalVehicleField = (field, value) => {
        setPersonalVehicle((current) => ({ ...current, [field]: value }));
    };

    const handleCancelProfileEdit = () => {
        setProfileDraft(buildProfileDraft(user));
        setIsEditingProfile(false);
    };

    const handleSaveProfile = async () => {
        if (!requirePermission("264", "update company users")) return;
        if (!recentlySelectedCompany || !user?.id) return;

        const selectedRole = roleOptions.find((role) => role.value === profileDraft.roleId);
        if (!selectedRole) {
            toast.error("Please select a role.");
            return;
        }

        setIsSavingProfile(true);
        try {
            const payload = {
                roleId: selectedRole.value,
                roleName: selectedRole.label,
                status: profileDraft.status,
                workerType: profileDraft.workerType,
            };

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyUsers", user.id), payload);
            setUser((current) => ({ ...current, ...payload }));
            setIsEditingProfile(false);
            toast.success("Company user updated.");
        } catch (error) {
            console.error("Error updating company user:", error);
            toast.error("Failed to update company user.");
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleSaveVehicleAccess = async () => {
        if (!requirePermission("264", "update company users")) return;
        if (!recentlySelectedCompany || !user?.id) return;

        setIsSavingVehicleAccess(true);
        try {
            const payload = {
                allowPersonalVehicle,
                personalVehicle: {
                    nickName: personalVehicle.nickName.trim(),
                    vehicalType: personalVehicle.vehicalType || "Car",
                    year: personalVehicle.year.trim(),
                    make: personalVehicle.make.trim(),
                    model: personalVehicle.model.trim(),
                    color: personalVehicle.color.trim(),
                    plate: personalVehicle.plate.trim().toUpperCase(),
                    miles: Number(personalVehicle.miles || 0),
                },
            };

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyUsers", user.id), payload);
            setUser((current) => ({
                ...current,
                ...payload,
            }));
            toast.success("Vehicle access updated.");
        } catch (error) {
            console.error("Error updating vehicle access:", error);
            toast.error("Failed to update vehicle access.");
        } finally {
            setIsSavingVehicleAccess(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50">
                <p className="text-sm text-slate-500">Loading user details...</p>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:px-4 lg:px-6">
            <div className="w-full space-y-4">
                <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <button
                            type="button"
                            onClick={() => navigate("/company/companyUsers")}
                            className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                        >
                            <ArrowLeftIcon className="h-4 w-4" />
                            Back
                        </button>
                        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{displayName}</h1>
                        <p className="mt-1 text-sm text-slate-500">Company user profile, role, worker type, and route access.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Badge className={getStatusClass(user.status)}>{normalizeStatus(user.status)}</Badge>
                        <Badge className="bg-blue-50 text-blue-700 ring-blue-200">{normalizeWorkerType(user.workerType)}</Badge>
                    </div>
                </header>

                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white">
                                {getInitials(displayName)}
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-lg font-semibold text-slate-950">{displayName}</p>
                                <p className="truncate text-sm text-slate-500">{user.roleName || "No role assigned"}</p>
                            </div>
                        </div>
                        {can("264") && !isEditingProfile && (
                            <button
                                type="button"
                                onClick={() => setIsEditingProfile(true)}
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                            >
                                <PencilSquareIcon className="h-4 w-4" />
                                Edit User
                            </button>
                        )}
                    </div>
                </section>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                    <Section
                        title="User Information"
                        description={isEditingProfile ? "Update the fields that drive assignments, permissions, and payroll grouping." : "Current company relationship details."}
                        action={isEditingProfile && (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleCancelProfileEdit}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveProfile}
                                    disabled={isSavingProfile || areRolesLoading || !hasProfileChanges}
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <CheckIcon className="h-4 w-4" />
                                    {isSavingProfile ? "Saving..." : "Save"}
                                </button>
                            </div>
                        )}
                    >
                        {isEditingProfile ? (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <label className="space-y-1.5">
                                    <span className="text-sm font-semibold text-slate-700">Role</span>
                                    <Select
                                        value={selectedRoleOption}
                                        options={roleOptions}
                                        onChange={(selected) => setProfileDraft((current) => ({
                                            ...current,
                                            roleId: selected?.value || "",
                                            roleName: selected?.label || "",
                                        }))}
                                        isLoading={areRolesLoading}
                                        isDisabled={areRolesLoading}
                                        placeholder="Select role..."
                                        styles={selectStyles}
                                    />
                                </label>

                                <label className="space-y-1.5">
                                    <span className="text-sm font-semibold text-slate-700">Worker Type</span>
                                    <select
                                        value={profileDraft.workerType}
                                        onChange={(event) => setProfileDraft((current) => ({ ...current, workerType: event.target.value }))}
                                        className={inputBase}
                                    >
                                        {workerTypeOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="space-y-1.5">
                                    <span className="text-sm font-semibold text-slate-700">Status</span>
                                    <select
                                        value={profileDraft.status}
                                        onChange={(event) => setProfileDraft((current) => ({ ...current, status: event.target.value }))}
                                        className={inputBase}
                                    >
                                        {statusOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <DetailField label="Full Name" value={displayName} />
                                <DetailField label="Role" value={user.roleName} />
                                <DetailField label="Worker Type" value={normalizeWorkerType(user.workerType)} />
                                <DetailField label="Date Created" value={formatDate(user.dateCreated || user.createdAt)} />
                            </div>
                        )}
                    </Section>

                    <Section title="Access Snapshot" description="High level employment state for this company.">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-slate-700">Status</span>
                                <Badge className={getStatusClass(user.status)}>{normalizeStatus(user.status)}</Badge>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-slate-700">Company User ID</span>
                                <span className="max-w-[190px] truncate text-right text-xs font-medium text-slate-500">{user.id}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-slate-700">Auth User ID</span>
                                <span className="max-w-[190px] truncate text-right text-xs font-medium text-slate-500">{user.userId || "Not linked"}</span>
                            </div>
                        </div>
                    </Section>
                </div>

                {isContractor && (
                    <Section title="Linked Company" description="Contractor relationship information.">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <DetailField label="Company Name" value={user.linkedCompanyName} />
                            <DetailField label="Company Reference" value={user.linkedCompanyId || (user.linkedCompanyName ? "Linked company" : "")} />
                        </div>
                    </Section>
                )}

                <Section
                    title="Route Vehicle Access"
                    description="Permit this technician to use a personal vehicle when starting or managing active routes."
                    action={can("264") && (
                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <input
                                type="checkbox"
                                checked={allowPersonalVehicle}
                                onChange={(event) => setAllowPersonalVehicle(event.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            Allow personal vehicle
                        </label>
                    )}
                >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Nickname</span>
                            <input
                                value={personalVehicle.nickName}
                                onChange={(event) => updatePersonalVehicleField("nickName", event.target.value)}
                                readOnly={!can("264")}
                                className={inputBase}
                                placeholder="Mike's truck"
                            />
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Type</span>
                            <select
                                value={personalVehicle.vehicalType}
                                onChange={(event) => updatePersonalVehicleField("vehicalType", event.target.value)}
                                disabled={!can("264")}
                                className={inputBase}
                            >
                                {VEHICLE_TYPES.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Year</span>
                            <input
                                value={personalVehicle.year}
                                onChange={(event) => updatePersonalVehicleField("year", event.target.value)}
                                readOnly={!can("264")}
                                className={inputBase}
                                placeholder="2021"
                            />
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Make</span>
                            <input
                                value={personalVehicle.make}
                                onChange={(event) => updatePersonalVehicleField("make", event.target.value)}
                                readOnly={!can("264")}
                                className={inputBase}
                                placeholder="Toyota"
                            />
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Model</span>
                            <input
                                value={personalVehicle.model}
                                onChange={(event) => updatePersonalVehicleField("model", event.target.value)}
                                readOnly={!can("264")}
                                className={inputBase}
                                placeholder="Tacoma"
                            />
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Color</span>
                            <input
                                value={personalVehicle.color}
                                onChange={(event) => updatePersonalVehicleField("color", event.target.value)}
                                readOnly={!can("264")}
                                className={inputBase}
                                placeholder="White"
                            />
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Plate</span>
                            <input
                                value={personalVehicle.plate}
                                onChange={(event) => updatePersonalVehicleField("plate", event.target.value)}
                                readOnly={!can("264")}
                                className={`${inputBase} uppercase`}
                                placeholder="ABC123"
                            />
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-sm font-semibold text-slate-700">Current Miles</span>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={personalVehicle.miles}
                                onChange={(event) => updatePersonalVehicleField("miles", event.target.value)}
                                readOnly={!can("264")}
                                className={inputBase}
                                placeholder="0"
                            />
                        </label>
                    </div>

                    {can("264") && (
                        <div className="mt-5 flex justify-end">
                            <button
                                type="button"
                                onClick={handleSaveVehicleAccess}
                                disabled={isSavingVehicleAccess}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSavingVehicleAccess ? "Saving..." : "Save Vehicle Access"}
                            </button>
                        </div>
                    )}
                </Section>
            </div>
        </div>
    );
};

export default CompanyUserDetails;
