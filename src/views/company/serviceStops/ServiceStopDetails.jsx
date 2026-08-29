import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    where,
    addDoc,
    setDoc,
    updateDoc,
    arrayUnion,
    writeBatch,
    Timestamp,
    orderBy,
    serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { ServiceStop } from "../../../utils/models/ServiceStop";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { runWorkCompletionEffects } from "../../../utils/workCompletionEffects";
import { getCallableAuthPayload } from "../../../utils/callableAuth";
import {
    buildStopDataRecord,
    fetchStopDataForServiceStop,
    normalizeDosageForStopData,
    normalizeReadingForStopData,
    saveStopDataRecord,
} from "../../../utils/stopData";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
    CREATE_SERVICE_AGREEMENTS_PERMISSION_ID,
    FIELD_JOB_ESTIMATE_PLAN_PERMISSION_ID,
    FIELD_JOB_ESTIMATE_SEND_PERMISSION_ID,
    FIELD_SERVICE_AGREEMENT_WORKFLOW_PERMISSION_ID,
    SEND_SERVICE_AGREEMENTS_PERMISSION_ID,
} from "../../../utils/companyPermissions";
import {
    SERVICE_STOP_TYPE_USE_CASES,
    normalizeServiceStopTypeBucket,
} from "../../../utils/serviceStopTypes/serviceStopTypeResolver";
import {
    DEFAULT_JOB_PLAN_TIER,
    JOB_PLAN_STATUS,
    JOB_PLAN_TIER_OPTIONS,
    getJobPlanRecommendationDisplay,
    getJobPlanRecommendationLabel,
    jobPlanId,
    normalizeJobPlanTier,
} from "../../../utils/models/JobPlan";
import { salesCollectionNames } from "../../../utils/models/Sales";
import {
    agreementDisplayTitle,
    agreementLinksInitialEstimate,
    connectServiceAgreementToInitialEstimate,
} from "../../../utils/sales/initialEstimateAgreementLinks";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";
import PartApprovalCreateModal from "../partApprovals/PartApprovalCreateModal";
import { getItemPhotoUrl } from "../../../utils/itemPhotos";
import {
    buildPartApprovalShoppingItemPayload,
    isPartApprovalPending,
    isShoppingItemDelivered,
    partApprovalTotalPriceCents,
} from "../../../utils/partApprovalShopping";
import { SHOPPING_LIST_STATUS } from "../../../utils/shoppingListStatus";
import { createAndSendShoppingItemInstallInvoice } from "../../../utils/sales/shoppingItemInvoiceAutomation";
import { isFilterEquipment } from "../../../utils/models/Equipment";
import { PaperAirplaneIcon, PrinterIcon, XMarkIcon } from "@heroicons/react/24/outline";
import ShareItemButton from "../../components/share/ShareItemButton";
import ConnectAgreementModal from "../marketing/ConnectAgreementModal";
import {
    canonicalJobTaskType,
    isRetiredFilterMaintenanceTaskType,
    isInstallOrReplaceTaskType,
    taskTypeRequiresBodyOfWater,
    taskTypeRequiresEquipment,
    taskTypeRequiresInstallItem,
} from "../../../utils/jobTaskTypes";
import EquipmentCatalogPicker from "../../components/equipment/EquipmentCatalogPicker";
import {
    EQUIPMENT_DATABASE_CATEGORY,
    databaseEquipmentMappingFromItem,
    databaseEquipmentMappingPatch,
    emptyDatabaseEquipmentMapping,
    equipmentDatabaseItemLabel,
    hasDatabaseEquipmentMapping,
    isEquipmentDatabaseItem,
} from "../../../utils/databaseEquipmentItems";

const jobTaskTypeOptions = [
    "Basic",
    "Clean",
    "Maintenance",
    "Repair",
    "Drain Water",
    "Fill Water",
    "Inspection",
    "Install",
    "Remove",
    "Replace",
];

const taskNeedsEquipment = (type) =>
    taskTypeRequiresEquipment(type) || isRetiredFilterMaintenanceTaskType(type);

const buildEquipmentDatabaseItemOption = (data = {}, docId = "") => {
    const id = data.id || docId;
    return {
        id,
        value: id,
        label: equipmentDatabaseItemLabel({ ...data, id }),
        name: data.name || "Equipment item",
        description: data.description || "",
        category: data.category || "",
        subCategory: data.subCategory || "",
        rate: Number(data.rate || 0),
        cost: Number(data.cost || data.rate || 0),
        sellPrice: Number(data.sellPrice ?? data.billingRate ?? data.rate ?? 0),
        billingRate: Number(data.billingRate ?? data.sellPrice ?? data.rate ?? 0),
        dbItemId: id,
        itemId: id,
        ...databaseEquipmentMappingPatch(databaseEquipmentMappingFromItem(data)),
    };
};

const taskDataBaseItemIdFor = (task = {}) => (
    task.dataBaseItemId ||
    task.dbItemId ||
    task.itemId ||
    task.installedDataBaseItemId ||
    ""
);

const getDateValue = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (value instanceof Date) return value;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const startOfDay = (value) => {
    const date = getDateValue(value);
    if (!date) return null;

    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
};

const endOfDay = (value) => {
    const date = getDateValue(value);
    if (!date) return null;

    const next = new Date(date);
    next.setHours(23, 59, 59, 999);
    return next;
};

const formatDateInput = (value) => {
    const date = getDateValue(value);
    return date ? format(date, "yyyy-MM-dd") : "";
};

const parseDateInput = (value) => {
    if (!value) return null;

    const [year, month, day] = value.split("-").map((part) => Number(part));
    if (!year || !month || !day) return null;

    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
};

const sameDay = (left, right) => {
    const leftDate = startOfDay(left);
    const rightDate = startOfDay(right);
    return !!leftDate && !!rightDate && leftDate.getTime() === rightDate.getTime();
};

const isFinishedStatus = (status) => {
    const normalized = String(status || "").trim().toLowerCase();
    return ["finished", "completed", "done", "complete"].includes(normalized);
};

const isServiceStopFinished = (stop) => (
    isFinishedStatus(stop?.operationStatus) ||
    Boolean(getDateValue(stop?.endTime) || getDateValue(stop?.finishedAt) || getDateValue(stop?.completedAt))
);

const minutesBetween = (start, end) => {
    const startDate = getDateValue(start);
    const endDate = getDateValue(end);
    if (!startDate || !endDate) return 0;

    return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
};

const normalizeCompanyUser = (docSnap) => {
    const data = docSnap.data();
    const label = getCompanyUserDisplayName(data, "Unnamed User");
    const userId = data.userId || data.id || docSnap.id;

    return {
        ...data,
        id: data.id || docSnap.id,
        userId,
        userName: data.userName || label,
        value: userId,
        label,
    };
};

const activeRouteDocumentId = (date, techId) => (
    `com_ar_${format(startOfDay(date) || new Date(date), "yyyyMMdd")}_${String(techId || "").replace(/\//g, "_")}`
);

const routeHasWorkActivity = (route) => Boolean(
    getDateValue(route?.startTime) ||
    getDateValue(route?.endTime) ||
    (route?.status && route.status !== "Did Not Start")
);

const pickCanonicalRoute = (routes = []) => (
    [...routes].sort((left, right) => {
        const leftHasWork = routeHasWorkActivity(left);
        const rightHasWork = routeHasWorkActivity(right);

        if (leftHasWork !== rightHasWork) return leftHasWork ? -1 : 1;

        const stopDelta = (right.serviceStopsIds?.length || 0) - (left.serviceStopsIds?.length || 0);
        if (stopDelta !== 0) return stopDelta;

        return String(left.id || "").localeCompare(String(right.id || ""));
    })[0] || null
);

const buildRouteOrder = (stops = [], existingOrder = []) => {
    const stopIds = new Set(stops.map((stop) => stop.id));
    const activeOrder = (Array.isArray(existingOrder) ? existingOrder : [])
        .filter((item) => stopIds.has(item.serviceStopId || item.id))
        .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    const orderedStopIds = new Set(activeOrder.map((item) => item.serviceStopId || item.id));

    stops.forEach((stop) => {
        if (orderedStopIds.has(stop.id)) return;

        activeOrder.push({
            id: `route_order_${crypto.randomUUID()}`,
            order: activeOrder.length + 1,
            serviceStopId: stop.id,
            recurringServiceStopId: stop.recurringServiceStopId || "",
        });
        orderedStopIds.add(stop.id);
    });

    return activeOrder.map((item, index) => ({
        ...item,
        id: item.id || `route_order_${crypto.randomUUID()}`,
        serviceStopId: item.serviceStopId || item.id,
        order: index + 1,
    }));
};

const getRouteStatusFromStops = (stops = [], existingRoute = null) => {
    if (!stops.length) return "Did Not Start";

    const finishedStops = stops.filter(isServiceStopFinished).length;
    const inProgressStops = stops.filter((stop) => getDateValue(stop.startTime) && !isServiceStopFinished(stop)).length;

    if (finishedStops === stops.length) return "Finished";
    if (inProgressStops > 0 || finishedStops > 0) return "In Progress";

    if (["In Progress", "Traveling", "On Break"].includes(existingRoute?.status)) {
        return existingRoute.status;
    }

    return "Did Not Start";
};

const displayText = (value, fallback = "—") => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;

    const text = String(value).trim();
    return text || fallback;
};

const userDisplayName = (user = {}) => (
    user.userName ||
    user.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.name ||
    user.email ||
    ""
);

const centsCurrency = (amountCents = 0) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
}).format((Number(amountCents) || 0) / 100);

const centsToMoneyInput = (amountCents = 0) => {
    const cents = Number(amountCents || 0);
    return cents > 0 ? (cents / 100).toFixed(2) : "";
};

const moneyInputToCents = (value) => Math.round((Number(value) || 0) * 100);

const fieldAgreementRateTypeOptions = [
    { value: "perMonth", label: "Monthly Service" },
    { value: "perVisit", label: "Per Visit" },
    { value: "oneTime", label: "One-Time Startup" },
];

const formatDateText = (value) => {
    const date = getDateValue(value);
    return date ? format(date, "PP") : "—";
};

const getServiceStopBucket = (stop = {}) => {
    const currentStop = stop || {};
    const values = [
        currentStop.serviceStopTypeUseCaseRawValue,
        currentStop.serviceStopTypeUseCase,
        currentStop.typeUseCase,
        currentStop.category,
        currentStop.serviceStopCategory,
        currentStop.serviceStopTypeCategory,
        currentStop.stopPayBucketId,
        currentStop.serviceStopBucketId,
        currentStop.stopPayBucketLabel,
        currentStop.serviceStopBucketLabel,
        currentStop.serviceStopBucket,
        currentStop.bucketId,
        currentStop.bucketLabel,
        currentStop.typeId,
        currentStop.type,
    ]
        .map(normalizeServiceStopTypeBucket)
        .filter(Boolean);

    const hasValue = (...needles) => values.some((value) =>
        needles.some((needle) => value === needle || value.includes(needle))
    );

    if (hasValue(
        "serviceagreementestimate",
        "serviceestimate",
        "newserviceestimate",
        "recurringserviceestimate",
        "startup",
        "startupservice",
        "newpool"
    )) {
        return {
            id: SERVICE_STOP_TYPE_USE_CASES.serviceAgreementEstimate,
            label: "Service Agreement Estimate",
            className: "border-emerald-200 bg-emerald-50 text-emerald-800",
        };
    }

    if (currentStop.recurringServiceStopId || hasValue(
        "recurringroute",
        "recurringservicestop",
        "weeklyroute",
        "standardroute",
        "poolroute",
        "route",
        "routes"
    )) {
        return {
            id: SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
            label: "Route",
            className: "border-sky-200 bg-sky-50 text-sky-800",
        };
    }

    if (hasValue("jobestimate", "estimateforjob", "bidvisit") || (currentStop.jobId && hasValue("estimate"))) {
        return {
            id: SERVICE_STOP_TYPE_USE_CASES.jobEstimate,
            label: "Job Estimate",
            className: "border-amber-200 bg-amber-50 text-amber-800",
        };
    }

    if (currentStop.jobId || hasValue("jobvisit", "servicecall", "job")) {
        return {
            id: SERVICE_STOP_TYPE_USE_CASES.jobVisit,
            label: "Job Visit",
            className: "border-indigo-200 bg-indigo-50 text-indigo-800",
        };
    }

    if (hasValue("customerrelationship", "customervisit", "followup", "courtesyvisit", "mistakefix")) {
        return {
            id: SERVICE_STOP_TYPE_USE_CASES.customerRelationship,
            label: "Customer Relationship",
            className: "border-violet-200 bg-violet-50 text-violet-800",
        };
    }

    return {
        id: SERVICE_STOP_TYPE_USE_CASES.unknown,
        label: "Unknown",
        className: "border-slate-200 bg-slate-50 text-slate-700",
    };
};

const getWorkOrderTypeLabel = (stop = {}) => {
    const currentStop = stop || {};

    return displayText(
        currentStop.workOrderType ||
        currentStop.workOrderTypeName ||
        currentStop.jobType ||
        currentStop.jobTypeName ||
        currentStop.payTypeName ||
        currentStop.payWorkTypeName ||
        currentStop.workTypeName ||
        currentStop.workType ||
        currentStop.jobName,
        currentStop.jobId ? "Job Visit" : "Not linked"
    );
};

const getServiceStopTypeLabel = (stop = {}) => {
    const currentStop = stop || {};

    return displayText(
        currentStop.serviceStopTypeName ||
        currentStop.typeName ||
        currentStop.type ||
        currentStop.typeId,
        "Not set"
    );
};

const splitSurveyNotes = (notes = "") => {
    const text = displayText(notes, "");
    if (!text) return { locationNotes: "", findings: [] };

    const marker = text.match(/\n\s*Survey Findings\s*\n/i);
    if (!marker) return { locationNotes: text, findings: [] };

    const markerIndex = marker.index || 0;
    const locationNotes = text.slice(0, markerIndex).trim();
    const findings = text
        .slice(markerIndex + marker[0].length)
        .split("\n")
        .map((line) => line.trim().replace(/^\d+\.\s*/, ""))
        .filter(Boolean);

    return { locationNotes, findings };
};

const photoUrl = (photo) => {
    if (!photo) return "";
    if (typeof photo === "string") return photo;

    return photo.url ||
        photo.imageURL ||
        photo.imageUrl ||
        photo.downloadURL ||
        photo.photoUrl ||
        photo.scanImageURL ||
        photo.scanImageUrl ||
        photo.scanImagePath ||
        photo.path ||
        "";
};

const photoCaption = (photo, fallback) => {
    if (!photo || typeof photo === "string") return fallback;
    return photo.caption || photo.description || photo.name || fallback;
};

const testerStripScanPhotos = (record = {}) => (
    (Array.isArray(record.testerStripScans) ? record.testerStripScans : [])
        .map((scan, index) => {
            const image = scan.image || scan.photo || scan;
            const url = photoUrl(image) || photoUrl(scan);
            if (!url) return null;

            const createdAt = getDateValue(scan.createdAt);
            return {
                id: scan.id || `${url}-${index}`,
                url,
                caption: photoCaption(image, scan.profileName || `Tester strip ${index + 1}`),
                createdAtLabel: createdAt ? format(createdAt, "MMM d, yyyy h:mm a") : "",
            };
        })
        .filter(Boolean)
);

const isWebUrl = (value) => /^https?:\/\//i.test(String(value || ""));

const getEquipmentTitle = (equipment = {}) => (
    equipment.name ||
    [equipment.make, equipment.model].filter(Boolean).join(" ") ||
    equipment.type ||
    "Unnamed Equipment"
);

const getBodyOfWaterTitle = (body = {}) => (
    body.name ||
    body.type ||
    body.bodyOfWaterType ||
    "Unnamed Body Of Water"
);

const getBodyOfWaterMeta = (body = {}) => {
    const gallons = displayText(body.gallons || body.capacityGallons || body.volume, "");
    const material = displayText(body.material || body.surfaceMaterial, "");
    const type = displayText(body.type || body.bodyOfWaterType || body.waterType, "");

    return [gallons ? `${gallons} gal` : "", material, type].filter(Boolean).join(" • ");
};

const getEquipmentSurveyFindings = (equipmentList = []) => (
    equipmentList
        .map((equipment) => {
            const statusText = displayText(
                equipment.status ||
                equipment.operationStatus ||
                equipment.equipmentStatus,
                ""
            );
            const normalizedStatus = normalizeServiceStopTypeBucket(statusText);
            const needsService = Boolean(
                equipment.needsService ||
                equipment.needsRepair ||
                equipment.serviceRecommended ||
                equipment.repairRecommended
            );
            const flaggedStatus = [
                "needsservice",
                "needsrepair",
                "repair",
                "maintenance",
                "notoperational",
                "nonoperational",
                "offline",
                "failed",
            ].some((value) => normalizedStatus.includes(value));

            if (!needsService && !flaggedStatus) return null;

            return {
                id: equipment.id,
                title: getEquipmentTitle(equipment),
                status: statusText || "Needs attention",
                notes: equipment.notes || equipment.serviceNotes || equipment.recommendationNotes || "",
            };
        })
        .filter(Boolean)
);

const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    }[character]));

const firstPresent = (...values) => values.find((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    return true;
});

const valueWithUnit = (value, unit = "") => [
    displayText(value, ""),
    displayText(unit, ""),
].filter(Boolean).join(" ");

const formatReportMinutes = (minutes) => {
    if (minutes === null || minutes === undefined || minutes === "") return "—";
    return `${minutes} mins`;
};

const reportTextBlock = (value, fallback = "—") => escapeHtml(displayText(value, fallback));

const reportDetailGridHtml = (items = []) => items
    .map((item) => `
        <div class="detail">
            <span>${escapeHtml(item.label)}</span>
            <strong>${reportTextBlock(item.value)}</strong>
        </div>
    `)
    .join("");

const reportTableHtml = (columns = [], rows = [], emptyMessage = "No records.") => `
    <table>
        <thead>
            <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>
            ${rows.length
        ? rows.map((row) => `
            <tr>
                ${columns.map((column) => `<td>${reportTextBlock(row[column.key])}</td>`).join("")}
            </tr>
        `).join("")
        : `<tr><td colspan="${columns.length}">${escapeHtml(emptyMessage)}</td></tr>`}
        </tbody>
    </table>
`;

const reportPhotoGridHtml = (title, photos = []) => {
    const normalizedPhotos = (Array.isArray(photos) ? photos : [])
        .map((photo, index) => ({
            url: photoUrl(photo),
            caption: photoCaption(photo, `${title} ${index + 1}`),
        }))
        .filter((photo) => photo.url);

    if (!normalizedPhotos.length) return "";

    return `
        <div class="photo-section">
            <h3>${escapeHtml(title)}</h3>
            <div class="photo-grid">
                ${normalizedPhotos.map((photo) => (
        isWebUrl(photo.url)
            ? `<figure><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.caption)}" /><figcaption>${escapeHtml(photo.caption)}</figcaption></figure>`
            : `<figure class="photo-note"><figcaption>${escapeHtml(photo.caption)}</figcaption><p>${escapeHtml(photo.url)}</p></figure>`
    )).join("")}
            </div>
        </div>
    `;
};

const reportLineItems = (items = [], formatter) => (
    items.length ? items.map(formatter).filter(Boolean).join("; ") : "—"
);

const stopDataObservationValues = (record = {}) => {
    if (Array.isArray(record.observation)) return record.observation;
    if (Array.isArray(record.observations)) return record.observations;
    if (typeof record.observation === "string") return record.observation.split("\n");
    if (typeof record.observations === "string") return record.observations.split("\n");
    return [];
};

const buildPrintableServiceReportHtml = ({
    serviceStop = {},
    customerRecord = null,
    serviceLocation = null,
    bodiesOfWater = [],
    equipmentList = [],
    taskList = [],
    stopDataRecords = [],
    serviceStopShoppingItems = [],
    partApprovals = [],
    serviceStopBucket = {},
    technicianServiceNotes = "",
    surveyNotes = {},
    equipmentSurveyFindings = [],
}) => {
    const customerName = firstPresent(
        customerRecord?.displayName,
        customerRecord?.customerName,
        customerRecord?.name,
        serviceStop.customerName,
        "Customer"
    );
    const locationName = firstPresent(
        serviceLocation?.nickName,
        serviceLocation?.name,
        serviceStop.serviceLocationName,
        serviceStop.address?.streetAddress,
        customerName
    );
    const address = [
        firstPresent(serviceStop.address?.streetAddress, serviceLocation?.streetAddress),
        [firstPresent(serviceStop.address?.city, serviceLocation?.city), firstPresent(serviceStop.address?.state, serviceLocation?.state)]
            .filter(Boolean)
            .join(", "),
        firstPresent(serviceStop.address?.zip, serviceLocation?.zip),
    ].filter(Boolean).join(" ");
    const bodyOfWaterById = new Map(bodiesOfWater.map((body) => [body.id, body]));
    const equipmentById = new Map(equipmentList.map((equipment) => [equipment.id, equipment]));
    const generatedAt = format(new Date(), "MM/dd/yyyy h:mm a");
    const reportTitle = `${displayText(locationName, "Service")} Service Report`;

    const summaryItems = [
        { label: "Customer", value: customerName },
        { label: "Location", value: locationName },
        { label: "Address", value: address },
        { label: "Service Date", value: formatDateText(serviceStop.serviceDate) },
        { label: "Technician", value: firstPresent(serviceStop.tech, serviceStop.techName) },
        { label: "Status", value: serviceStop.operationStatus },
        { label: "Service Type", value: getServiceStopTypeLabel(serviceStop) },
        { label: "Report Type", value: serviceStopBucket.label },
        { label: "Duration", value: formatReportMinutes(serviceStop.duration) },
    ];

    const taskRows = taskList.map((task) => ({
        name: task.name || "Unnamed Task",
        type: task.type || "—",
        status: task.status || "—",
        worker: task.workerName || serviceStop.tech || "—",
        time: formatReportMinutes(firstPresent(task.actualTime, task.estimatedTime)),
        rate: centsCurrency(task.contractedRate),
    }));

    const stopDataRows = stopDataRecords.map((record) => {
        const body = bodyOfWaterById.get(record.bodyOfWaterId);
        const readings = reportLineItems(record.readings || [], (reading) => {
            const name = reading.name || reading.templateName || reading.readingName || "Reading";
            return `${name}: ${valueWithUnit(firstPresent(reading.amount, reading.value), firstPresent(reading.UOM, reading.uom, reading.unit)) || "—"}`;
        });
        const dosages = reportLineItems(record.dosages || [], (dosage) => {
            const name = dosage.name || dosage.templateName || dosage.dosageName || "Dosage";
            return `${name}: ${valueWithUnit(firstPresent(dosage.amount, dosage.value), firstPresent(dosage.UOM, dosage.uom, dosage.unit)) || "—"}`;
        });
        const observations = stopDataObservationValues(record)
            .map((observation) => displayText(observation, ""))
            .filter(Boolean)
            .join("; ") || "—";
        const equipmentMeasurements = reportLineItems(record.equipmentMeasurements || [], (measurement) => {
            const equipment = equipmentById.get(measurement.equipmentId);
            const pressure = displayText(firstPresent(measurement.poundForcePerSquareInch, measurement.pressure, measurement.currentPressure), "");
            const rpm = displayText(firstPresent(measurement.revolutionsPerMinute, measurement.rpm), "");
            return [
                equipment ? getEquipmentTitle(equipment) : "Equipment",
                pressure ? `${pressure} PSI` : "",
                rpm ? `${rpm} RPM` : "",
                measurement.status || "",
            ].filter(Boolean).join(" - ");
        });

        return {
            body: body ? getBodyOfWaterTitle(body) : "Stop Data",
            readings,
            dosages,
            observations,
            equipmentMeasurements,
        };
    });

    const shoppingRows = serviceStopShoppingItems.map((item) => ({
        item: item.name || item.itemName || item.dbItemName || "Install material",
        qty: item.quantity || "1",
        status: item.status || "Ready",
        assigned: item.assignedTechName || item.assignedToUserName || item.userName || serviceStop.tech || "—",
        price: centsCurrency(partApprovalTotalPriceCents(item)),
    }));

    const approvalRows = partApprovals.map((approval) => ({
        item: approval.itemName || approval.name || approval.dbItemName || "Pool Part",
        qty: approval.quantity || "1",
        status: approval.status || approval.approvalStatus || "Pending",
        price: centsCurrency(partApprovalTotalPriceCents(approval)),
        notes: approval.description || "—",
    }));

    const equipmentRows = equipmentList.map((equipment) => ({
        equipment: getEquipmentTitle(equipment),
        type: equipment.type || equipment.equipmentType || "Equipment",
        make: equipment.make || equipment.manufacturer || "—",
        model: equipment.model || "—",
        status: equipment.status || equipment.operationStatus || equipment.equipmentStatus || "—",
        pressure: valueWithUnit(firstPresent(equipment.currentFilterPressure, equipment.currentPressure), "PSI") || "—",
    }));

    const bodyRows = bodiesOfWater.map((body) => ({
        body: getBodyOfWaterTitle(body),
        type: body.type || body.bodyOfWaterType || body.waterType || "Pool",
        gallons: firstPresent(body.gallons, body.capacityGallons, body.volume, "—"),
        material: body.material || body.surfaceMaterial || "—",
        sanitizer: body.sanitizer || body.sanitizerType || "—",
        status: body.status || body.operationStatus || "—",
    }));

    const findings = [
        ...(surveyNotes.findings || []),
        ...equipmentSurveyFindings.map((finding) => [
            finding.title,
            finding.status ? `Status: ${finding.status}` : "",
            finding.notes,
        ].filter(Boolean).join(" - ")),
    ];

    const serviceStopPhotosHtml = reportPhotoGridHtml("Service Photos", serviceStop.photoUrls || []);
    const locationPhotosHtml = reportPhotoGridHtml(
        "Location Photos",
        serviceLocation?.photoUrls || serviceLocation?.photos || serviceLocation?.serviceLocationPhotos || []
    );

    return `
        <!doctype html>
        <html>
            <head>
                <title>${escapeHtml(reportTitle)}</title>
                <style>
                    body { color: #0f172a; font-family: Arial, sans-serif; margin: 28px; }
                    header { border-bottom: 2px solid #e2e8f0; margin-bottom: 18px; padding-bottom: 14px; }
                    h1 { font-size: 26px; margin: 0 0 4px; }
                    .subtitle { color: #64748b; font-size: 12px; margin: 0; }
                    section { break-inside: avoid; margin-top: 18px; }
                    h2 { font-size: 16px; margin: 0 0 8px; }
                    h3 { color: #475569; font-size: 12px; margin: 12px 0 8px; text-transform: uppercase; }
                    .details { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
                    .detail { border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px; }
                    .detail span { color: #64748b; display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; }
                    .detail strong { display: block; font-size: 12px; line-height: 1.35; margin-top: 4px; word-break: break-word; }
                    .note { border: 1px solid #cbd5e1; border-radius: 6px; line-height: 1.45; padding: 10px; white-space: pre-wrap; }
                    ul { margin: 0; padding-left: 18px; }
                    li { margin-bottom: 5px; }
                    table { border-collapse: collapse; font-size: 11px; width: 100%; }
                    th { background: #f1f5f9; color: #475569; font-size: 10px; text-align: left; text-transform: uppercase; }
                    th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; }
                    .photo-grid { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
                    figure { border: 1px solid #cbd5e1; border-radius: 6px; margin: 0; overflow: hidden; }
                    figure img { display: block; height: 130px; object-fit: cover; width: 100%; }
                    figcaption { color: #475569; font-size: 10px; padding: 6px; }
                    .photo-note { padding: 8px; }
                    .photo-note p { font-size: 10px; margin: 4px 0 0; word-break: break-all; }
                    @media print {
                        body { margin: 18px; }
                        .details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                        .photo-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                    }
                </style>
            </head>
            <body>
                <header>
                    <h1>${escapeHtml(reportTitle)}</h1>
                    <p class="subtitle">Generated ${escapeHtml(generatedAt)}${serviceStop.internalId ? ` | Stop #${escapeHtml(serviceStop.internalId)}` : ""}</p>
                </header>

                <section>
                    <h2>Summary</h2>
                    <div class="details">${reportDetailGridHtml(summaryItems)}</div>
                </section>

                <section>
                    <h2>Technician Notes</h2>
                    <div class="note">${escapeHtml(technicianServiceNotes || "No technician service notes captured.")}</div>
                </section>

                ${surveyNotes.locationNotes ? `
                    <section>
                        <h2>Service Location Notes</h2>
                        <div class="note">${escapeHtml(surveyNotes.locationNotes)}</div>
                    </section>
                ` : ""}

                ${findings.length ? `
                    <section>
                        <h2>Suggested Repairs & Changes</h2>
                        <ul>${findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>
                    </section>
                ` : ""}

                <section>
                    <h2>Tasks</h2>
                    ${reportTableHtml([
        { key: "name", label: "Task" },
        { key: "type", label: "Type" },
        { key: "status", label: "Status" },
        { key: "worker", label: "Worker" },
        { key: "time", label: "Time" },
        { key: "rate", label: "Rate" },
    ], taskRows, "No tasks were captured for this stop.")}
                </section>

                <section>
                    <h2>Captured Readings & Dosages</h2>
                    ${reportTableHtml([
        { key: "body", label: "Body Of Water" },
        { key: "readings", label: "Readings" },
        { key: "dosages", label: "Dosages" },
        { key: "observations", label: "Observations" },
        { key: "equipmentMeasurements", label: "Equipment" },
    ], stopDataRows, "No readings, dosages, or observations were captured for this stop.")}
                </section>

                <section>
                    <h2>Install Materials</h2>
                    ${reportTableHtml([
        { key: "item", label: "Item" },
        { key: "qty", label: "Qty" },
        { key: "status", label: "Status" },
        { key: "assigned", label: "Assigned" },
        { key: "price", label: "Price" },
    ], shoppingRows, "No install materials were linked to this stop.")}
                </section>

                <section>
                    <h2>Part Approvals</h2>
                    ${reportTableHtml([
        { key: "item", label: "Item" },
        { key: "qty", label: "Qty" },
        { key: "status", label: "Status" },
        { key: "price", label: "Price" },
        { key: "notes", label: "Notes" },
    ], approvalRows, "No part approvals were linked to this stop.")}
                </section>

                <section>
                    <h2>Body Of Water Details</h2>
                    ${reportTableHtml([
        { key: "body", label: "Body" },
        { key: "type", label: "Type" },
        { key: "gallons", label: "Gallons" },
        { key: "material", label: "Material" },
        { key: "sanitizer", label: "Sanitizer" },
        { key: "status", label: "Status" },
    ], bodyRows, "No body of water information was captured for this stop.")}
                </section>

                <section>
                    <h2>Equipment</h2>
                    ${reportTableHtml([
        { key: "equipment", label: "Equipment" },
        { key: "type", label: "Type" },
        { key: "make", label: "Make" },
        { key: "model", label: "Model" },
        { key: "status", label: "Status" },
        { key: "pressure", label: "Pressure" },
    ], equipmentRows, "No equipment information was captured for this stop.")}
                </section>

                ${serviceStopPhotosHtml}
                ${locationPhotosHtml}
            </body>
        </html>
    `;
};

const SurveyPhotoGrid = ({ photos = [], title }) => {
    const normalizedPhotos = photos
        .map((photo, index) => ({
            url: photoUrl(photo),
            caption: photoCaption(photo, `${title || "Photo"} ${index + 1}`),
        }))
        .filter((photo) => photo.url);

    if (!normalizedPhotos.length) return null;

    return (
        <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {normalizedPhotos.map((photo, index) => (
                    isWebUrl(photo.url) ? (
                        <img
                            key={`${photo.url}-${index}`}
                            src={photo.url}
                            alt={photo.caption}
                            className="h-28 w-full rounded-md border border-slate-200 object-cover"
                        />
                    ) : (
                        <div
                            key={`${photo.url}-${index}`}
                            className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
                        >
                            <p className="font-semibold text-slate-700">{photo.caption}</p>
                            <p className="mt-1 break-all">{photo.url}</p>
                        </div>
                    )
                ))}
            </div>
        </div>
    );
};

const SurveyRowMetric = ({ label, value }) => {
    const text = displayText(value);

    return (
        <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-800" title={text}>
                {text}
            </p>
        </div>
    );
};

const ServiceStopDetails = () => {
    const {
        recentlySelectedCompany,
        user,
        dataBaseUser,
        companyUserAccess,
        shoppingItemInstallInvoiceAutomationEnabled,
    } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const { serviceStopId } = useParams();
    const navigate = useNavigate();

    const [serviceStop, setServiceStop] = useState(null);
    const [taskList, setTaskList] = useState([]);
    const [companyUsers, setCompanyUsers] = useState([]);
    const [customerRecord, setCustomerRecord] = useState(null);
    const [serviceLocation, setServiceLocation] = useState(null);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    const [equipmentDatabaseItems, setEquipmentDatabaseItems] = useState([]);
    const [readingTemplates, setReadingTemplates] = useState([]);
    const [dosageTemplates, setDosageTemplates] = useState([]);
    const [stopDataRecords, setStopDataRecords] = useState([]);
    const [selectedBodyOfWaterId, setSelectedBodyOfWaterId] = useState("");
    const [readingDrafts, setReadingDrafts] = useState({});
    const [dosageDrafts, setDosageDrafts] = useState({});
    const [observationDraft, setObservationDraft] = useState("");
    const [equipmentMeasurementDrafts, setEquipmentMeasurementDrafts] = useState({});
    const [savingEquipmentObservationId, setSavingEquipmentObservationId] = useState("");
    const [savingStopData, setSavingStopData] = useState(false);
    const [loading, setLoading] = useState(true);
    const [editEnabled, setEditEnabled] = useState(false);
    const [editForm, setEditForm] = useState({
        serviceDate: "",
        techId: "",
        description: "",
    });
    const [savingEdit, setSavingEdit] = useState(false);
    const [showManualStopData, setShowManualStopData] = useState(false);
    const [finishingStop, setFinishingStop] = useState(false);
    const [showFinishConfirm, setShowFinishConfirm] = useState(false);
    const [manualFinishTaskIds, setManualFinishTaskIds] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [partApprovals, setPartApprovals] = useState([]);
    const [serviceStopShoppingItems, setServiceStopShoppingItems] = useState([]);
    const [loadingPartWorkflow, setLoadingPartWorkflow] = useState(false);
    const [showPartApprovalModal, setShowPartApprovalModal] = useState(false);
    const [partWorkflowActionId, setPartWorkflowActionId] = useState("");
    const [sendingServiceReport, setSendingServiceReport] = useState(false);
    const [serviceAgreements, setServiceAgreements] = useState([]);
    const [loadingServiceAgreements, setLoadingServiceAgreements] = useState(false);
    const [showConnectAgreementModal, setShowConnectAgreementModal] = useState(false);
    const [connectingAgreementId, setConnectingAgreementId] = useState("");
    const [serviceAgreementRecommendationForm, setServiceAgreementRecommendationForm] = useState({
        price: "",
        rateType: "perMonth",
        notes: "",
    });
    const [savingServiceAgreementRecommendation, setSavingServiceAgreementRecommendation] = useState(false);
    const [jobPlanForm, setJobPlanForm] = useState({
        price: "",
        title: "",
        planTier: DEFAULT_JOB_PLAN_TIER,
        notes: "",
    });
    const [savingFieldJobPlan, setSavingFieldJobPlan] = useState(false);

    const [showAddTask, setShowAddTask] = useState(false);
    const [savingTask, setSavingTask] = useState(false);

    const [newTask, setNewTask] = useState({
        name: "",
        type: "",
        status: "Not Finished",
        contractedRate: "",
        estimatedTime: "",
        customerApproval: false,
        actualTime: "",
        workerId: "",
        workerType: "",
        workerName: "",
        laborContractId: "",
        equipmentId: "",
        serviceLocationId: "",
        bodyOfWaterId: "",
        dataBaseItemId: "",
        shoppingListItemId: "",
        addToRecurringServiceStop: false,
    });
    const [newTaskEquipmentMapping, setNewTaskEquipmentMapping] = useState(() => emptyDatabaseEquipmentMapping());

    useEffect(() => {
        const fetchServiceStopDetails = async () => {
            if (!recentlySelectedCompany || !serviceStopId) return;

            try {
                setLoading(true);

                const docRef = doc(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId
                );
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const rawStopData = docSnap.data();
                    const mappedStopData = ServiceStop.fromFirestore(docSnap);
                    const stopData = {
                        ...mappedStopData,
                        category: rawStopData.category || "",
                        serviceStopCategory: rawStopData.serviceStopCategory || "",
                        serviceStopTypeCategory: rawStopData.serviceStopTypeCategory || "",
                        serviceStopTypeUseCaseRawValue: rawStopData.serviceStopTypeUseCaseRawValue || "",
                        serviceStopTypeUseCase: rawStopData.serviceStopTypeUseCase || "",
                        typeUseCase: rawStopData.typeUseCase || "",
                        serviceStopBucket: rawStopData.serviceStopBucket || "",
                        serviceStopBucketId: rawStopData.serviceStopBucketId || "",
                        serviceStopBucketLabel: rawStopData.serviceStopBucketLabel || "",
                        bucketId: rawStopData.bucketId || "",
                        bucketLabel: rawStopData.bucketLabel || "",
                        stopPayBucketId: rawStopData.stopPayBucketId || "",
                        stopPayBucketLabel: rawStopData.stopPayBucketLabel || "",
                        workOrderType: rawStopData.workOrderType || "",
                        workOrderTypeName: rawStopData.workOrderTypeName || "",
                        jobType: rawStopData.jobType || "",
                        jobTypeName: rawStopData.jobTypeName || "",
                        payTypeId: rawStopData.payTypeId || "",
                        payTypeName: rawStopData.payTypeName || "",
                        payWorkTypeName: rawStopData.payWorkTypeName || "",
                        workTypeName: rawStopData.workTypeName || rawStopData.payTypeName || "",
                        workType: rawStopData.workType || "",
                        serviceStopTypeName: rawStopData.serviceStopTypeName || "",
                        typeName: rawStopData.typeName || "",
                        defaultWorkTypeIds: Array.isArray(rawStopData.defaultWorkTypeIds)
                            ? rawStopData.defaultWorkTypeIds
                            : [],
                        photoUrls: Array.isArray(rawStopData.photoUrls)
                            ? rawStopData.photoUrls
                            : mappedStopData.photoUrls,
                    };
                    setServiceStop(stopData);
                    setEditForm({
                        serviceDate: formatDateInput(stopData.serviceDate),
                        techId: stopData.techId || "",
                        description: stopData.description || "",
                    });

                    const taskQuery = query(
                        collection(
                            db,
                            "companies",
                            recentlySelectedCompany,
                            "serviceStops",
                            serviceStopId,
                            "tasks"
                        )
                    );
                    const taskQuerySnapshot = await getDocs(taskQuery);
                    const tasks = taskQuerySnapshot.docs.map((doc) => ({
                        id: doc.id,
                        ...doc.data(),
                    }));
                    setTaskList(tasks);

                    const [readingTemplatesSnapshot, dosageTemplatesSnapshot, userSnapshot, loadedStopData] = await Promise.all([
                        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "readings", "readings")),
                        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dosages", "dosages")),
                        getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
                        fetchStopDataForServiceStop({
                            db,
                            companyId: recentlySelectedCompany,
                            serviceStopId,
                        }),
                    ]);

                    setReadingTemplates(
                        readingTemplatesSnapshot.docs.map((readingDoc) => ({
                            id: readingDoc.id,
                            ...readingDoc.data(),
                        }))
                    );
                    setDosageTemplates(
                        dosageTemplatesSnapshot.docs.map((dosageDoc) => ({
                            id: dosageDoc.id,
                            ...dosageDoc.data(),
                        }))
                    );
                    setCompanyUsers(
                        sortCompanyUsersByName(userSnapshot.docs.map(normalizeCompanyUser))
                    );
                    setStopDataRecords(loadedStopData);

                    if (stopData.serviceLocationId) {
                        const bodyOfWaterQuery = query(
                            collection(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "bodiesOfWater"
                            ),
                            where("serviceLocationId", "==", stopData.serviceLocationId)
                        );
                        const equipmentQuery = query(
                            collection(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "equipment"
                            ),
                            where("serviceLocationId", "==", stopData.serviceLocationId)
                        );
                        const serviceLocationRef = doc(
                            db,
                            "companies",
                            recentlySelectedCompany,
                            "serviceLocations",
                            stopData.serviceLocationId
                        );
                        const [bodyOfWaterSnapshot, equipmentSnapshot, serviceLocationSnapshot] = await Promise.all([
                            getDocs(bodyOfWaterQuery),
                            getDocs(equipmentQuery),
                            getDoc(serviceLocationRef),
                        ]);
                        setServiceLocation(
                            serviceLocationSnapshot.exists()
                                ? {
                                    id: serviceLocationSnapshot.id,
                                    ...serviceLocationSnapshot.data(),
                                }
                                : null
                        );
                        setBodiesOfWater(
                            bodyOfWaterSnapshot.docs.map((doc) => ({
                                id: doc.id,
                                ...doc.data(),
                            }))
                        );
                        setEquipmentList(
                            equipmentSnapshot.docs.map((doc) => ({
                                id: doc.id,
                                ...doc.data(),
                            }))
                        );
                    } else {
                        setServiceLocation(null);
                        setBodiesOfWater([]);
                        setEquipmentList([]);
                    }

                    if (stopData.customerId) {
                        const customerSnapshot = await getDoc(
                            doc(db, "companies", recentlySelectedCompany, "customers", stopData.customerId)
                        );
                        setCustomerRecord(
                            customerSnapshot.exists()
                                ? {
                                    id: customerSnapshot.id,
                                    ...customerSnapshot.data(),
                                }
                                : null
                        );
                    } else {
                        setCustomerRecord(null);
                    }

                    setNewTask((prev) => ({
                        ...prev,
                        workerId: stopData.techId || "",
                        workerName: stopData.tech || "",
                        serviceLocationId: stopData.serviceLocationId || "",
                    }));
                } else {
                    setServiceStop(null);
                    setServiceLocation(null);
                    setCustomerRecord(null);
                    setBodiesOfWater([]);
                    setEquipmentList([]);
                    console.log("No such document!");
                }
            } catch (error) {
                console.error("Error fetching service stop details: ", error);
                toast.error("Failed to load service stop details");
            } finally {
                setLoading(false);
            }
        };

        fetchServiceStopDetails();
    }, [recentlySelectedCompany, serviceStopId]);

    useEffect(() => {
        if (!serviceStop) return;

        const workflow = serviceStop.fieldEstimateWorkflow || {};
        const initialSurveyRecommendation = workflow.initialSurveyRecommendation || workflow.serviceAgreementRecommendation || {};
        const recommendedServiceAgreementPriceCents = Number(
            initialSurveyRecommendation.recommendedPriceCents ??
            serviceStop.recommendedServiceAgreementPriceCents ??
            serviceStop.fieldRecommendedServiceAgreementPriceCents ??
            0
        );
        setServiceAgreementRecommendationForm({
            price: centsToMoneyInput(recommendedServiceAgreementPriceCents),
            rateType: initialSurveyRecommendation.rateType || serviceStop.recommendedServiceAgreementRateType || "perMonth",
            notes: initialSurveyRecommendation.notes || serviceStop.recommendedServiceAgreementNotes || "",
        });

        const jobEstimatePlan = workflow.jobEstimatePlan || {};
        const recommendedJobPlanPriceCents = Number(
            jobEstimatePlan.recommendedPriceCents ??
            serviceStop.recommendedJobEstimatePriceCents ??
            serviceStop.fieldJobPlanRecommendedPriceCents ??
            0
        );
        setJobPlanForm({
            price: centsToMoneyInput(recommendedJobPlanPriceCents),
            title: jobEstimatePlan.title || serviceStop.fieldJobPlanTitle || "",
            planTier: normalizeJobPlanTier(jobEstimatePlan.planTier || serviceStop.fieldJobPlanTier || DEFAULT_JOB_PLAN_TIER),
            notes: jobEstimatePlan.notes || serviceStop.fieldJobPlanNotes || "",
        });
    }, [serviceStop, serviceStopId]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setEquipmentDatabaseItems([]);
            return;
        }

        let cancelled = false;

        const loadEquipmentDatabaseItems = async () => {
            try {
                const itemsSnap = await getDocs(
                    query(
                        collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"),
                        orderBy("name")
                    )
                );
                if (cancelled) return;
                setEquipmentDatabaseItems(
                    itemsSnap.docs
                        .map((itemDoc) => buildEquipmentDatabaseItemOption(itemDoc.data(), itemDoc.id))
                        .filter(isEquipmentDatabaseItem)
                );
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to load equipment database items:", error);
                    setEquipmentDatabaseItems([]);
                }
            }
        };

        loadEquipmentDatabaseItems();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany]);

    const loadPartWorkflow = useCallback(async () => {
        if (!recentlySelectedCompany || !serviceStopId) {
            setPartApprovals([]);
            setServiceStopShoppingItems([]);
            return;
        }

        try {
            setLoadingPartWorkflow(true);
            const shoppingCollection = collection(db, "companies", recentlySelectedCompany, "shoppingList");
            const [shoppingByStopSnap, shoppingByScheduledStopSnap, approvalSnap] = await Promise.all([
                getDocs(query(shoppingCollection, where("serviceStopId", "==", serviceStopId))),
                getDocs(query(shoppingCollection, where("scheduledServiceStopId", "==", serviceStopId))),
                getDocs(query(collection(db, "customerPartApprovals"), where("companyId", "==", recentlySelectedCompany))),
            ]);

            const shoppingItemsById = new Map();
            [shoppingByStopSnap, shoppingByScheduledStopSnap].forEach((snapshot) => {
                snapshot.docs.forEach((itemDoc) => {
                    const data = itemDoc.data() || {};
                    shoppingItemsById.set(itemDoc.id, {
                        id: itemDoc.id,
                        ...data,
                        photoUrl: getItemPhotoUrl(data),
                    });
                });
            });

            const shoppingItems = Array.from(shoppingItemsById.values()).sort((left, right) =>
                String(left.name || "").localeCompare(String(right.name || ""))
            );
            const shoppingApprovalIds = new Set(
                shoppingItems
                    .flatMap((item) => [item.partApprovalRequestId, item.approvalRequestId])
                    .filter(Boolean)
            );

            const approvalsForStop = approvalSnap.docs
                .map((approvalDoc) => ({ id: approvalDoc.id, ...(approvalDoc.data() || {}) }))
                .filter((approval) => {
                    const approvalStopIds = [
                        approval.serviceStopId,
                        approval.scheduledServiceStopId,
                    ].filter(Boolean);
                    const linkedByStopId = approvalStopIds.includes(serviceStopId);
                    const linkedByShoppingItem = shoppingApprovalIds.has(approval.id);
                    const linkedBySameVisit =
                        !approvalStopIds.length &&
                        approval.serviceLocationId &&
                        serviceStop?.serviceLocationId &&
                        approval.serviceLocationId === serviceStop.serviceLocationId &&
                        sameDay(approval.scheduledDate || approval.serviceDate || approval.requestedAt, serviceStop?.serviceDate);

                    return linkedByStopId || linkedByShoppingItem || linkedBySameVisit;
                })
                .sort((left, right) => {
                    const leftDate = getDateValue(left.updatedAt || left.requestedAt || left.createdAt);
                    const rightDate = getDateValue(right.updatedAt || right.requestedAt || right.createdAt);
                    return (rightDate?.getTime() || 0) - (leftDate?.getTime() || 0);
                });

            setServiceStopShoppingItems(shoppingItems);
            setPartApprovals(approvalsForStop);
        } catch (error) {
            console.error("Failed to load part approval workflow:", error);
            toast.error("Failed to load part approvals for this stop");
        } finally {
            setLoadingPartWorkflow(false);
        }
    }, [recentlySelectedCompany, serviceStop?.serviceDate, serviceStop?.serviceLocationId, serviceStopId]);

    useEffect(() => {
        if (!serviceStop) return;
        loadPartWorkflow();
    }, [loadPartWorkflow, serviceStop]);

    const loadServiceAgreements = useCallback(async () => {
        if (!recentlySelectedCompany) {
            setServiceAgreements([]);
            return;
        }

        setLoadingServiceAgreements(true);
        try {
            const agreementSnapshot = await getDocs(
                query(
                    collection(db, salesCollectionNames.agreements),
                    where("companyId", "==", recentlySelectedCompany)
                )
            );
            setServiceAgreements(
                agreementSnapshot.docs.map((agreementDoc) => ({
                    id: agreementDoc.id,
                    ...agreementDoc.data(),
                }))
            );
        } catch (error) {
            console.error("Failed to load service agreements:", error);
            toast.error("Failed to load service agreements");
        } finally {
            setLoadingServiceAgreements(false);
        }
    }, [recentlySelectedCompany]);

    const openConnectAgreementModal = () => {
        setShowConnectAgreementModal(true);
        loadServiceAgreements();
    };

    useEffect(() => {
        if (!bodiesOfWater.length) {
            if (selectedBodyOfWaterId) setSelectedBodyOfWaterId("");
            return;
        }

        const selectedBodyExists = bodiesOfWater.some((body) => body.id === selectedBodyOfWaterId);
        if (selectedBodyExists) return;

        setSelectedBodyOfWaterId(bodiesOfWater[0].id || "");
    }, [bodiesOfWater, selectedBodyOfWaterId]);

    useEffect(() => {
        if (!selectedBodyOfWaterId) {
            setReadingDrafts({});
            setDosageDrafts({});
            setObservationDraft("");
            setEquipmentMeasurementDrafts({});
            return;
        }

        const currentStopData = stopDataRecords.find((record) => record.bodyOfWaterId === selectedBodyOfWaterId);
        const readingsByTemplateId = new Map(
            (currentStopData?.readings || []).map((reading) => [reading.templateId || reading.universalTemplateId, reading])
        );
        const dosagesByTemplateId = new Map(
            (currentStopData?.dosages || []).map((dosage) => [dosage.templateId || dosage.universalTemplateId, dosage])
        );

        setReadingDrafts(
            Object.fromEntries(
                readingTemplates.map((template) => {
                    const reading = readingsByTemplateId.get(template.id) || readingsByTemplateId.get(template.readingsTemplateId);
                    return [template.id, reading?.amount || ""];
                })
            )
        );
        setDosageDrafts(
            Object.fromEntries(
                dosageTemplates.map((template) => {
                    const dosage = dosagesByTemplateId.get(template.id) || dosagesByTemplateId.get(template.dosageTemplateId);
                    return [template.id, dosage?.amount || ""];
                })
            )
        );
        setObservationDraft((currentStopData?.observation || []).join("\n"));
        setEquipmentMeasurementDrafts(
            Object.fromEntries(
                (currentStopData?.equipmentMeasurements || []).map((measurement) => [
                    measurement.equipmentId,
                    {
                        pressure: measurement.poundForcePerSquareInch ?? measurement.pressure ?? measurement.currentPressure ?? "",
                        rpm: measurement.revolutionsPerMinute ?? "",
                    },
                ])
            )
        );
    }, [dosageTemplates, readingTemplates, selectedBodyOfWaterId, stopDataRecords]);

    const bodyOfWaterById = useMemo(() => (
        new Map(bodiesOfWater.map((body) => [body.id, body]))
    ), [bodiesOfWater]);
    const equipmentById = useMemo(() => (
        new Map(equipmentList.map((equipment) => [equipment.id, equipment]))
    ), [equipmentList]);
    const equipmentDatabaseItemById = useMemo(() => (
        new Map(equipmentDatabaseItems.map((item) => [item.id, item]))
    ), [equipmentDatabaseItems]);
    const newTaskTypeValue = canonicalJobTaskType(newTask.type || "");
    const newTaskNeedsBodyOfWater = taskTypeRequiresBodyOfWater(newTaskTypeValue);
    const newTaskNeedsEquipment = taskNeedsEquipment(newTaskTypeValue);
    const newTaskNeedsInstallItem = taskTypeRequiresInstallItem(newTaskTypeValue);
    const newTaskNeedsEquipmentDatabaseItem = isInstallOrReplaceTaskType(newTaskTypeValue);
    const selectedNewTaskEquipmentItem = newTask.dataBaseItemId
        ? equipmentDatabaseItemById.get(newTask.dataBaseItemId) || null
        : null;
    const selectedBodyOfWater = selectedBodyOfWaterId ? bodyOfWaterById.get(selectedBodyOfWaterId) : null;
    const stopDataBodyIds = useMemo(() => (
        new Set(stopDataRecords.map((record) => record.bodyOfWaterId).filter(Boolean))
    ), [stopDataRecords]);
    const selectedStopDataRecord = stopDataRecords.find((record) => record.bodyOfWaterId === selectedBodyOfWaterId) || null;
    const selectedBodyEquipment = useMemo(() => (
        equipmentList.filter((equipment) => !selectedBodyOfWaterId || equipment.bodyOfWaterId === selectedBodyOfWaterId)
    ), [equipmentList, selectedBodyOfWaterId]);

    useEffect(() => {
        if (!newTaskNeedsInstallItem) {
            if (newTask.dataBaseItemId) {
                setNewTask((current) => ({ ...current, dataBaseItemId: "" }));
            }
            setNewTaskEquipmentMapping(emptyDatabaseEquipmentMapping());
            return;
        }

        setNewTaskEquipmentMapping(
            selectedNewTaskEquipmentItem
                ? databaseEquipmentMappingFromItem(selectedNewTaskEquipmentItem)
                : emptyDatabaseEquipmentMapping()
        );
    }, [newTask.dataBaseItemId, newTaskNeedsInstallItem, selectedNewTaskEquipmentItem]);

    useEffect(() => {
        if (!newTaskNeedsBodyOfWater || newTask.bodyOfWaterId || !newTask.equipmentId) return;

        const selectedEquipment = equipmentById.get(newTask.equipmentId);
        if (!selectedEquipment?.bodyOfWaterId) return;

        setNewTask((current) => (
            current.bodyOfWaterId
                ? current
                : { ...current, bodyOfWaterId: selectedEquipment.bodyOfWaterId }
        ));
    }, [equipmentById, newTask.bodyOfWaterId, newTask.equipmentId, newTaskNeedsBodyOfWater]);

    const serviceStopAddressText = useMemo(() => [
        serviceStop?.address?.streetAddress,
        [serviceStop?.address?.city, serviceStop?.address?.state].filter(Boolean).join(", "),
        serviceStop?.address?.zip,
    ].filter(Boolean).join(" "), [serviceStop]);
    const serviceStopGoogleMapsUrl = useMemo(() => (
        serviceStopAddressText
            ? `https://www.google.com/maps/place/${encodeURIComponent(serviceStopAddressText)}`
            : ""
    ), [serviceStopAddressText]);
    const serviceAgreementsById = useMemo(() => (
        new Map(serviceAgreements.map((agreement) => [agreement.id, agreement]))
    ), [serviceAgreements]);
    const connectedServiceAgreement = useMemo(() => {
        const linkedAgreementId = serviceStop?.serviceAgreementId || serviceStop?.salesAgreementId || serviceStop?.agreementId || "";
        if (linkedAgreementId) {
            return serviceAgreementsById.get(linkedAgreementId) || {
                id: linkedAgreementId,
                title: serviceStop?.serviceAgreementTitle || "Service Agreement",
                status: serviceStop?.serviceAgreementStatus || "",
            };
        }

        return serviceAgreements.find((agreement) => agreementLinksInitialEstimate(agreement, serviceStopId)) || null;
    }, [serviceAgreements, serviceAgreementsById, serviceStop, serviceStopId]);
    const partApprovalCustomer = useMemo(() => {
        if (customerRecord) return customerRecord;
        if (!serviceStop?.customerId) return null;

        return {
            id: serviceStop.customerId,
            displayName: serviceStop.customerName || "Customer",
            customerName: serviceStop.customerName || "Customer",
            email: serviceStop.customerEmail || serviceStop.email || "",
            billingEmail: serviceStop.billingEmail || "",
            customerUserId: serviceStop.customerUserId || "",
        };
    }, [customerRecord, serviceStop]);
    const partApprovalServiceLocation = useMemo(() => {
        if (serviceLocation) return serviceLocation;
        if (!serviceStop?.serviceLocationId) return null;

        return {
            id: serviceStop.serviceLocationId,
            name: serviceStop.serviceLocationName || serviceStopAddressText || "Service Location",
            nickName: serviceStop.serviceLocationName || "",
            streetAddress: serviceStop?.address?.streetAddress || "",
            city: serviceStop?.address?.city || "",
            state: serviceStop?.address?.state || "",
            zip: serviceStop?.address?.zip || "",
        };
    }, [serviceLocation, serviceStop, serviceStopAddressText]);
    const serviceStopBucket = useMemo(() => getServiceStopBucket(serviceStop), [serviceStop]);
    const serviceStopDeleteLocked = isServiceStopFinished(serviceStop);
    const isServiceAgreementEstimate = serviceStopBucket.id === SERVICE_STOP_TYPE_USE_CASES.serviceAgreementEstimate;
    const isJobEstimateStop = serviceStopBucket.id === SERVICE_STOP_TYPE_USE_CASES.jobEstimate;
    const initialSurveyRecommendation = serviceStop?.fieldEstimateWorkflow?.initialSurveyRecommendation || {};
    const savedServiceAgreementPriceCents = Number(
        initialSurveyRecommendation.recommendedPriceCents ||
        serviceStop?.recommendedServiceAgreementPriceCents ||
        serviceStop?.fieldRecommendedServiceAgreementPriceCents ||
        0
    );
    const jobEstimatePlanRecommendation = serviceStop?.fieldEstimateWorkflow?.jobEstimatePlan || {};
    const savedJobPlanPriceCents = Number(
        jobEstimatePlanRecommendation.recommendedPriceCents ||
        serviceStop?.recommendedJobEstimatePriceCents ||
        serviceStop?.fieldJobPlanRecommendedPriceCents ||
        0
    );
    const serviceAgreementSurveyDraftPath = useMemo(() => {
        const params = new URLSearchParams();
        if (serviceStop?.leadId) params.set("leadId", serviceStop.leadId);
        if (serviceStop?.customerId) params.set("customerId", serviceStop.customerId);
        if (serviceStop?.serviceLocationId) params.set("serviceLocationId", serviceStop.serviceLocationId);
        if (serviceStopId) params.set("serviceStopId", serviceStopId);

        return `/company/sales/agreements/new${params.toString() ? `?${params.toString()}` : ""}`;
    }, [serviceStop, serviceStopId]);
    const connectedServiceAgreementSendPath = connectedServiceAgreement?.id
        ? `/company/sales/agreements/${connectedServiceAgreement.id}?send=1&fromServiceStopId=${encodeURIComponent(serviceStopId)}`
        : "";
    const jobEstimatePlannedPath = serviceStop?.jobId
        ? `/company/jobs/detail/${serviceStop.jobId}/Planned`
        : "";
    const jobEstimateBillingPath = serviceStop?.jobId
        ? `/company/jobs/detail/${serviceStop.jobId}/Billing`
        : "";
    const handleConnectAgreement = async (agreement) => {
        if (!serviceStopId || !agreement?.id) return;

        setConnectingAgreementId(agreement.id);
        try {
            const connection = await connectServiceAgreementToInitialEstimate({
                db,
                companyId: recentlySelectedCompany,
                serviceStopId,
                serviceStop,
                agreement,
            });
            const linkedServiceStopIds = Array.isArray(agreement.serviceStopIds) ? agreement.serviceStopIds : [];
            const nextAgreement = {
                ...agreement,
                serviceAgreementEstimateServiceStopId: serviceStopId,
                inspectionServiceStopId: serviceStopId,
                serviceStopIds: [...new Set([...linkedServiceStopIds, serviceStopId])],
                leadId: agreement.leadId || connection.leadId || "",
            };

            setServiceStop((current) => ({
                ...current,
                serviceAgreementId: agreement.id,
                serviceAgreementTitle: connection.agreementTitle,
                serviceAgreementStatus: agreement.status || "",
                salesAgreementId: agreement.id,
                agreementId: agreement.id,
                leadId: connection.leadId || current?.leadId || "",
            }));
            setServiceAgreements((current) => (
                current.some((item) => item.id === agreement.id)
                    ? current.map((item) => (item.id === agreement.id ? nextAgreement : item))
                    : [nextAgreement, ...current]
            ));
            setShowConnectAgreementModal(false);
            toast.success("Service agreement connected.");
        } catch (error) {
            console.error("Failed to connect service agreement:", error);
            toast.error("Failed to connect service agreement.");
        } finally {
            setConnectingAgreementId("");
        }
    };
    const surveyNotes = useMemo(() => splitSurveyNotes(
        serviceLocation?.notes ||
        serviceLocation?.locationNotes ||
        serviceStop?.serviceLocationNotes ||
        serviceStop?.description ||
        ""
    ), [serviceLocation, serviceStop]);
    const technicianServiceNotes = useMemo(() => displayText(
        serviceStop?.serviceNotes ||
        serviceStop?.technicianServiceNotes ||
        serviceStop?.fieldNotes ||
        serviceStop?.notes ||
        "",
        ""
    ), [serviceStop]);
    const equipmentSurveyFindings = useMemo(() => getEquipmentSurveyFindings(equipmentList), [equipmentList]);

    const printServiceReport = useCallback(() => {
        if (!serviceStop) {
            toast.error("Load a service stop before printing.");
            return;
        }

        const printWindow = window.open("", "_blank");
        if (!printWindow) {
            toast.error("Allow popups to print the service report.");
            return;
        }

        printWindow.document.open();
        printWindow.document.write(buildPrintableServiceReportHtml({
            serviceStop,
            customerRecord,
            serviceLocation,
            bodiesOfWater,
            equipmentList,
            taskList,
            stopDataRecords,
            serviceStopShoppingItems,
            partApprovals,
            serviceStopBucket,
            technicianServiceNotes,
            surveyNotes,
            equipmentSurveyFindings,
        }));
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 250);
    }, [
        bodiesOfWater,
        customerRecord,
        equipmentList,
        equipmentSurveyFindings,
        partApprovals,
        serviceLocation,
        serviceStop,
        serviceStopBucket,
        serviceStopShoppingItems,
        stopDataRecords,
        surveyNotes,
        taskList,
        technicianServiceNotes,
    ]);

    const sendServiceReport = useCallback(async () => {
        if (!requirePermission("244", "send service reports")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) {
            toast.error("Load a service stop before sending the report.");
            return;
        }

        const toastId = toast.loading("Sending service report...");
        try {
            setSendingServiceReport(true);
            const sendServiceReportOnFinish = httpsCallable(functions, "sendServiceReportOnFinish");
            const result = await sendServiceReportOnFinish({
                companyId: recentlySelectedCompany,
                serviceStopId,
                serviceReportBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
            });
            const response = result?.data || {};
            const status = Number(response.status || 0);

            if (status >= 400) {
                const errorMessage = typeof response.error === "string"
                    ? response.error
                    : "Failed to send service report";
                throw new Error(errorMessage);
            }

            if (String(response.account || "").toLowerCase().includes("turned off")) {
                toast("Service report email is turned off in email settings.", { id: toastId });
                return;
            }

            toast.success(response.testMode ? "Service report sent in test mode." : "Service report sent.", { id: toastId });
        } catch (error) {
            console.error("Failed to send service report:", error);
            toast.error(error?.message || "Failed to send service report.", { id: toastId });
        } finally {
            setSendingServiceReport(false);
        }
    }, [recentlySelectedCompany, requirePermission, serviceStop, serviceStopId]);

    const buildEquipmentMeasurementsForStopData = (overrideMeasurement = null) => {
        const existingByEquipmentId = new Map(
            (selectedStopDataRecord?.equipmentMeasurements || []).map((measurement) => [measurement.equipmentId, measurement])
        );

        if (overrideMeasurement?.equipmentId) {
            existingByEquipmentId.set(overrideMeasurement.equipmentId, overrideMeasurement);
        }

        selectedBodyEquipment.forEach((equipment) => {
            const draft = equipmentMeasurementDrafts[equipment.id] || {};
            const pressureNumber = Number(draft.pressure);
            const rpmNumber = Number(draft.rpm);
            const hasPressure = draft.pressure !== "" && Number.isFinite(pressureNumber);
            const hasRpm = draft.rpm !== "" && Number.isFinite(rpmNumber);

            if (!hasPressure && !hasRpm) return;

            existingByEquipmentId.set(equipment.id, {
                ...(existingByEquipmentId.get(equipment.id) || {}),
                id: existingByEquipmentId.get(equipment.id)?.id || `eqm_${equipment.id}_${Date.now()}`,
                equipmentId: equipment.id,
                date: new Date(),
                status: equipment.status || equipment.operationStatus || "Active",
                ...(hasPressure
                    ? {
                        poundForcePerSquareInch: pressureNumber,
                        pressure: pressureNumber,
                        currentPressure: pressureNumber,
                    }
                    : {}),
                ...(hasRpm ? { revolutionsPerMinute: rpmNumber } : {}),
            });
        });

        return Array.from(existingByEquipmentId.values());
    };

    const saveStopData = async () => {
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop || !selectedBodyOfWaterId) return;

        try {
            setSavingStopData(true);
            const readings = readingTemplates.map((template) =>
                normalizeReadingForStopData(template, readingDrafts[template.id] || "", selectedBodyOfWaterId)
            );
            const dosages = dosageTemplates.map((template) =>
                normalizeDosageForStopData(template, dosageDrafts[template.id] || "", selectedBodyOfWaterId)
            );
            const observation = observationDraft
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
            const stopData = buildStopDataRecord({
                existingStopData: selectedStopDataRecord,
                serviceStop,
                serviceStopId,
                bodyOfWaterId: selectedBodyOfWaterId,
                readings,
                dosages,
                observation,
                userId: serviceStop.techId || "",
                date: new Date(),
                equipmentMeasurements: buildEquipmentMeasurementsForStopData(),
            });

            const savedStopData = await saveStopDataRecord({
                db,
                companyId: recentlySelectedCompany,
                stopData,
            });

            setStopDataRecords((current) => {
                const others = current.filter((record) => record.id !== savedStopData.id);
                return [savedStopData, ...others];
            });
            toast.success("Stop data saved");
        } catch (error) {
            console.error("Failed to save stop data:", error);
            toast.error("Failed to save stop data");
        } finally {
            setSavingStopData(false);
        }
    };

    const saveEquipmentObservation = async (equipment) => {
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop || !selectedBodyOfWaterId || !equipment?.id) return;

        const draft = equipmentMeasurementDrafts[equipment.id] || {};
        const pressure = Number(draft.pressure);
        const rpm = Number(draft.rpm);
        const hasPressure = draft.pressure !== "" && Number.isFinite(pressure);
        const hasRpm = draft.rpm !== "" && Number.isFinite(rpm);

        if (!hasPressure && !hasRpm) {
            toast.error("Enter pressure or RPM before saving");
            return;
        }

        try {
            setSavingEquipmentObservationId(equipment.id);

            const measurement = {
                id: `eqm_${equipment.id}_${Date.now()}`,
                equipmentId: equipment.id,
                date: new Date(),
                status: equipment.status || equipment.operationStatus || "Active",
                ...(hasPressure
                    ? {
                        poundForcePerSquareInch: pressure,
                        pressure,
                        currentPressure: pressure,
                    }
                    : {}),
                ...(hasRpm ? { revolutionsPerMinute: rpm } : {}),
            };

            const cleanPressure = Number(equipment.cleanFilterPressure ?? equipment.cleanPressure);
            const pressureNeedsMaintenance =
                hasPressure &&
                Number.isFinite(cleanPressure) &&
                pressure - cleanPressure >= 15;
            const equipmentUpdates = {
                ...(hasPressure ? { currentPressure: pressure } : {}),
                ...(pressureNeedsMaintenance ? { status: "Needs Maintenance", needsService: true } : {}),
            };

            const equipmentRef = doc(db, "companies", recentlySelectedCompany, "equipment", equipment.id);
            const batch = writeBatch(db);
            batch.set(doc(equipmentRef, "equipmentMeasurments", measurement.id), measurement, { merge: true });
            batch.set(doc(equipmentRef, "equipmentMeasurements", measurement.id), measurement, { merge: true });
            if (Object.keys(equipmentUpdates).length) {
                batch.update(equipmentRef, equipmentUpdates);
            }
            await batch.commit();

            const readings = readingTemplates.map((template) =>
                normalizeReadingForStopData(template, readingDrafts[template.id] || "", selectedBodyOfWaterId)
            );
            const dosages = dosageTemplates.map((template) =>
                normalizeDosageForStopData(template, dosageDrafts[template.id] || "", selectedBodyOfWaterId)
            );
            const observation = observationDraft
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
            const stopData = buildStopDataRecord({
                existingStopData: selectedStopDataRecord,
                serviceStop,
                serviceStopId,
                bodyOfWaterId: selectedBodyOfWaterId,
                readings,
                dosages,
                observation,
                userId: serviceStop.techId || "",
                date: new Date(),
                equipmentMeasurements: buildEquipmentMeasurementsForStopData(measurement),
            });

            const savedStopData = await saveStopDataRecord({
                db,
                companyId: recentlySelectedCompany,
                stopData,
            });

            setStopDataRecords((current) => {
                const others = current.filter((record) => record.id !== savedStopData.id);
                return [savedStopData, ...others];
            });
            setEquipmentList((current) =>
                current.map((item) => (
                    item.id === equipment.id
                        ? { ...item, ...equipmentUpdates, ...(hasPressure ? { currentPressure: pressure } : {}) }
                        : item
                ))
            );
            toast.success("Equipment observation saved");
        } catch (error) {
            console.error("Failed to save equipment observation:", error);
            toast.error("Failed to save equipment observation");
        } finally {
            setSavingEquipmentObservationId("");
        }
    };

    const getStatusClass = (status) => {
        const normalized = String(status || "").toLowerCase();

        if (["finished", "completed", "done", "complete", "delivered", "installed"].includes(normalized)) {
            return "bg-green-100 text-green-800";
        }
        if (["not finished", "in progress", "inprogress", "active"].includes(normalized)) {
            return "bg-yellow-100 text-yellow-800";
        }
        if (["skipped", "cancelled", "canceled"].includes(normalized)) {
            return "bg-red-100 text-red-800";
        }

        return "bg-gray-100 text-gray-800";
    };

    const formatCurrencyFromCents = (cents) => {
        const value = Number(cents || 0) / 100;
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format(value);
    };

    const formatMinutes = (minutes) => {
        if (minutes === null || minutes === undefined || minutes === "") return "—";
        return `${minutes} mins`;
    };

    const yesNo = (value) => (value ? "Yes" : "No");

    const Field = ({ label, value, children }) => (
        <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-600">{label}</p>
            {children ? children : <p className="text-slate-800">{value || "—"}</p>}
        </div>
    );

    const findCompanyUser = (userId) => (
        companyUsers.find((user) => user.userId === userId || user.id === userId) || null
    );
    const currentCompanyUserIds = useMemo(() => new Set([
        user?.uid,
        dataBaseUser?.id,
        dataBaseUser?.userId,
        dataBaseUser?.uid,
        companyUserAccess?.id,
        companyUserAccess?.userId,
        companyUserAccess?.uid,
    ].filter(Boolean)), [companyUserAccess, dataBaseUser, user?.uid]);
    const canManagePartWorkflow = can("244") || currentCompanyUserIds.has(serviceStop?.techId || "");
    const activeCompanyUserId = [...currentCompanyUserIds][0] || "";
    const activeCompanyUserName =
        userDisplayName(companyUserAccess) ||
        userDisplayName(dataBaseUser) ||
        user?.displayName ||
        user?.email ||
        "Company user";
    const canCreateFieldServiceAgreement =
        can(CREATE_SERVICE_AGREEMENTS_PERMISSION_ID) ||
        can(FIELD_SERVICE_AGREEMENT_WORKFLOW_PERMISSION_ID) ||
        can("400");
    const canSendFieldServiceAgreement =
        can(SEND_SERVICE_AGREEMENTS_PERMISSION_ID) ||
        can(FIELD_SERVICE_AGREEMENT_WORKFLOW_PERMISSION_ID) ||
        can("400");
    const canBuildFieldJobEstimatePlan =
        can(FIELD_JOB_ESTIMATE_PLAN_PERMISSION_ID) ||
        can("24") ||
        can("400");
    const canSendFieldJobEstimate =
        can(FIELD_JOB_ESTIMATE_SEND_PERMISSION_ID) ||
        can("622") ||
        can("400");
    const canBuildJobEstimateStopScope = Boolean(isJobEstimateStop && canBuildFieldJobEstimatePlan);
    const canEditServiceStopTasks = can("244") || canBuildJobEstimateStopScope;
    const canCreateFieldEstimateParts = canManagePartWorkflow || canBuildJobEstimateStopScope;
    const requireServiceStopTaskEdit = () => {
        if (canEditServiceStopTasks) return true;
        return requirePermission(
            isJobEstimateStop ? FIELD_JOB_ESTIMATE_PLAN_PERMISSION_ID : "244",
            isJobEstimateStop ? "build job estimate plans" : "update service stops"
        );
    };
    const requireFieldEstimatePartCreate = () => {
        if (canCreateFieldEstimateParts) return true;
        return requirePermission(
            isJobEstimateStop ? FIELD_JOB_ESTIMATE_PLAN_PERMISSION_ID : "244",
            isJobEstimateStop ? "add products to this field estimate" : "manage part approvals"
        );
    };

    const updateServiceAgreementRecommendationField = (field, value) => {
        setServiceAgreementRecommendationForm((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const updateJobPlanField = (field, value) => {
        setJobPlanForm((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const saveServiceAgreementRecommendation = async (event) => {
        event?.preventDefault();
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        const recommendedPriceCents = moneyInputToCents(serviceAgreementRecommendationForm.price);
        if (!recommendedPriceCents) {
            toast.error("Enter the recommended price before saving.");
            return;
        }

        const now = new Date();
        const recommendation = {
            recommendedPriceCents,
            rateType: serviceAgreementRecommendationForm.rateType || "perMonth",
            notes: serviceAgreementRecommendationForm.notes.trim(),
            recommendedByUserId: activeCompanyUserId,
            recommendedByUserName: activeCompanyUserName,
        };

        try {
            setSavingServiceAgreementRecommendation(true);
            await updateDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId), {
                "fieldEstimateWorkflow.initialSurveyRecommendation": {
                    ...recommendation,
                    recommendedAt: serverTimestamp(),
                },
                recommendedServiceAgreementPriceCents: recommendedPriceCents,
                recommendedServiceAgreementRateType: recommendation.rateType,
                recommendedServiceAgreementNotes: recommendation.notes,
                recommendedServiceAgreementByUserId: activeCompanyUserId,
                recommendedServiceAgreementByUserName: activeCompanyUserName,
                recommendedServiceAgreementAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            setServiceStop((current) => ({
                ...current,
                fieldEstimateWorkflow: {
                    ...(current?.fieldEstimateWorkflow || {}),
                    initialSurveyRecommendation: {
                        ...recommendation,
                        recommendedAt: now,
                    },
                },
                recommendedServiceAgreementPriceCents: recommendedPriceCents,
                recommendedServiceAgreementRateType: recommendation.rateType,
                recommendedServiceAgreementNotes: recommendation.notes,
            }));
            toast.success("Initial survey price saved.");
        } catch (error) {
            console.error("Failed to save initial survey price:", error);
            toast.error("Failed to save the recommended price.");
        } finally {
            setSavingServiceAgreementRecommendation(false);
        }
    };

    const buildFieldJobPlanSnapshot = ({ planId, jobData, totalAmountCents }) => {
        const planTier = normalizeJobPlanTier(jobPlanForm.planTier || DEFAULT_JOB_PLAN_TIER);
        const planTierLabel = getJobPlanRecommendationLabel(planTier);
        const title = jobPlanForm.title.trim() || `${serviceStop.customerName || "Customer"} Field Estimate Plan`;
        const description = jobPlanForm.notes.trim() || technicianServiceNotes || serviceStop.description || "";
        const nowMillis = Date.now();
        const taskSnapshots = (taskList || []).map((task, index) => ({
            id: task.jobTaskId?.id || task.jobTaskId || task.id || `field_task_${index + 1}`,
            sourceServiceStopTaskId: task.id || "",
            sortOrder: index,
            name: task.name || `Task ${index + 1}`,
            type: canonicalJobTaskType(task.type || ""),
            status: task.status || "",
            estimatedTime: Number(task.estimatedTime || 0),
            estimatedMinutes: Number(task.estimatedTime || 0),
            contractedRate: Number(task.contractedRate || 0),
            plannedLaborCostCents: Number(task.contractedRate || 0),
            customerApproval: Boolean(task.customerApproval),
            bodyOfWaterId: task.bodyOfWaterId || "",
            equipmentId: task.equipmentId || "",
            dataBaseItemId: taskDataBaseItemIdFor(task),
            serviceStopId,
        }));
        const materialSnapshots = (serviceStopShoppingItems || []).map((item, index) => {
            const quantity = Math.max(Number(item.quantity || item.quantityString || 1), 0) || 1;
            const totalPriceCents = partApprovalTotalPriceCents(item) || Number(item.plannedTotalPriceCents || item.totalPriceCents || 0);
            const totalCostCents = Number(item.plannedTotalCostCents || item.totalCostCents || item.cost || 0);

            return {
                id: item.id || `field_material_${index + 1}`,
                sourceServiceStopId: serviceStopId,
                name: item.name || item.itemName || item.dbItemName || `Product ${index + 1}`,
                description: item.description || "",
                quantity,
                plannedTotalCostCents: totalCostCents,
                plannedTotalPriceCents: totalPriceCents,
                customerApprovalRequired: Boolean(item.customerApprovalRequired || item.partApprovalRequestId || item.approvalRequestId),
                customerApprovalStatus: item.customerApprovalStatus || item.approvalStatus || item.status || "",
                shoppingListItemId: item.id || "",
            };
        });
        const materialPriceCents = materialSnapshots.reduce((total, item) => total + Number(item.plannedTotalPriceCents || 0), 0);
        const materialCostCents = materialSnapshots.reduce((total, item) => total + Number(item.plannedTotalCostCents || 0), 0);
        const taskLaborCostCents = taskSnapshots.reduce((total, task) => total + Number(task.plannedLaborCostCents || 0), 0);
        const laborPriceCents = Math.max(totalAmountCents - materialPriceCents, 0);
        const estimatedMinutes = Number(serviceStop.estimatedDuration || serviceStop.duration || 0) ||
            taskSnapshots.reduce((total, task) => total + Number(task.estimatedMinutes || 0), 0);
        const plannedStopSnapshot = {
            id: serviceStopId,
            sourceServiceStopId: serviceStopId,
            name: serviceStop.serviceStopTypeName || serviceStop.type || "Job Estimate Visit",
            serviceStopTypeName: serviceStop.serviceStopTypeName || serviceStop.type || "",
            estimatedMinutes,
            plannedLaborCostCents: taskLaborCostCents,
            taskIds: taskSnapshots.map((task) => task.id).filter(Boolean),
        };
        const laborLineItems = [
            {
                id: `${planId}_field_labor`,
                name: title,
                description,
                quantity: 1,
                unitPriceCents: laborPriceCents,
                totalPriceCents: laborPriceCents,
                internalCostCents: taskLaborCostCents,
                taskIds: taskSnapshots.map((task) => task.id).filter(Boolean),
            },
        ];
        const estimateLineItems = [
            {
                id: `${planId}_field_estimate_total`,
                name: title,
                description: [
                    description,
                    taskSnapshots.length ? `${taskSnapshots.length} task${taskSnapshots.length === 1 ? "" : "s"}` : "",
                    materialSnapshots.length ? `${materialSnapshots.length} product${materialSnapshots.length === 1 ? "" : "s"}` : "",
                ].filter(Boolean).join(" | "),
                quantity: 1,
                unitAmountCents: totalAmountCents,
                totalAmountCents,
                amount: totalAmountCents,
                type: "service",
                sourceType: "fieldServiceStop",
                sourceId: serviceStopId,
                metadata: {
                    serviceStopId,
                    jobId: serviceStop.jobId || "",
                    createdFrom: "serviceStopFieldEstimateWorkspace",
                },
            },
        ];
        const projectedProfitCents = totalAmountCents - taskLaborCostCents - materialCostCents;
        const profitMarginPercent = totalAmountCents > 0
            ? Math.round((projectedProfitCents / totalAmountCents) * 1000) / 10
            : 0;

        return {
            id: planId,
            planId,
            solutionId: planId,
            companyId: recentlySelectedCompany,
            jobId: serviceStop.jobId || "",
            jobInternalId: serviceStop.jobInternalId || jobData.internalId || "",
            customerId: serviceStop.customerId || jobData.customerId || "",
            customerName: serviceStop.customerName || jobData.customerName || "",
            serviceLocationId: serviceStop.serviceLocationId || jobData.serviceLocationId || "",
            serviceLocationName: serviceStop.serviceLocationName || jobData.serviceLocationName || "",
            sourceType: "fieldServiceStop",
            sourceServiceStopId: serviceStopId,
            title,
            name: title,
            planName: title,
            description,
            status: JOB_PLAN_STATUS.DRAFT,
            planTier,
            planTierLabel,
            solutionTier: planTier,
            solutionTierLabel: planTierLabel,
            recommendationRank: planTier,
            recommendationRankLabel: planTierLabel,
            isAccepted: false,
            isActivePlan: true,
            rateAmountCents: totalAmountCents,
            totalAmountCents,
            subtotalAmountCents: totalAmountCents,
            laborCostCents: taskLaborCostCents,
            plannedLaborCostCents: taskLaborCostCents,
            materialCostCents,
            materialPriceCents,
            internalCostCents: taskLaborCostCents + materialCostCents,
            projectedProfitCents,
            profitMarginPercent,
            scopeOfWork: {
                title,
                customerDescription: description,
                issueDescription: jobData.description || serviceStop.description || "",
                taskSummaries: taskSnapshots,
                plannedStopSummaries: [plannedStopSnapshot],
                laborLineSummaries: laborLineItems,
                materialSummaries: materialSnapshots,
                counts: {
                    tasks: taskSnapshots.length,
                    plannedServiceStops: 1,
                    laborLineItems: laborLineItems.length,
                    shoppingItems: materialSnapshots.length,
                    lineItems: estimateLineItems.length,
                },
            },
            costSummary: {
                plannedLaborCostCents: taskLaborCostCents,
                plannedLaborLineCostCents: taskLaborCostCents,
                plannedLaborLinePriceCents: laborPriceCents,
                plannedLaborPriceCents: laborPriceCents,
                plannedTaskLaborCents: taskLaborCostCents,
                plannedMaterialCostCents: materialCostCents,
                plannedMaterialPriceCents: materialPriceCents,
                internalCostCents: taskLaborCostCents + materialCostCents,
            },
            billingSummary: {
                pricingSource: "fieldTechnicianRecommendation",
                lineItemCount: estimateLineItems.length,
                subtotalAmountCents: totalAmountCents,
                totalAmountCents,
                plannedLaborPriceCents: laborPriceCents,
                projectedProfitCents,
                profitMarginPercent,
            },
            tasks: taskSnapshots,
            plannedServiceStops: [plannedStopSnapshot],
            laborLineItems,
            estimateLaborLineItems: laborLineItems,
            shoppingItems: materialSnapshots,
            lineItems: estimateLineItems,
            estimateLineItems,
            taskCount: taskSnapshots.length,
            plannedStopCount: 1,
            laborLineCount: laborLineItems.length,
            materialCount: materialSnapshots.length,
            createdAt: serverTimestamp(),
            createdAtMillis: nowMillis,
            createdByUserId: activeCompanyUserId,
            createdByUserName: activeCompanyUserName,
            updatedAt: serverTimestamp(),
            updatedAtMillis: nowMillis,
            updatedByUserId: activeCompanyUserId,
            updatedByUserName: activeCompanyUserName,
        };
    };

    const saveFieldJobPlan = async (event) => {
        event?.preventDefault();
        if (!canBuildFieldJobEstimatePlan) {
            toast.error("Your role cannot build field job estimate plans.");
            return;
        }
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop?.jobId) {
            toast.error("This service stop is not linked to a job estimate.");
            return;
        }

        const recommendedPriceCents = moneyInputToCents(jobPlanForm.price);
        if (!recommendedPriceCents) {
            toast.error("Enter the recommended job price before saving the plan.");
            return;
        }

        const planId = jobPlanId();
        const planTier = normalizeJobPlanTier(jobPlanForm.planTier || DEFAULT_JOB_PLAN_TIER);
        const planTierLabel = getJobPlanRecommendationLabel(planTier);
        const now = new Date();

        try {
            setSavingFieldJobPlan(true);
            const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", serviceStop.jobId);
            const jobSnap = await getDoc(jobRef);
            const jobData = jobSnap.exists() ? { id: jobSnap.id, ...jobSnap.data() } : {};
            const plan = buildFieldJobPlanSnapshot({
                planId,
                jobData,
                totalAmountCents: recommendedPriceCents,
            });

            const planRef = doc(db, "companies", recentlySelectedCompany, "workOrders", serviceStop.jobId, "plans", planId);
            await setDoc(planRef, plan, { merge: true });

            const jobUpdates = {
                activePlanId: planId,
                activeSolutionId: planId,
                activePlanTier: planTier,
                activePlanTierLabel: planTierLabel,
                activeSolutionTier: planTier,
                activeSolutionTierLabel: planTierLabel,
                activePlanRecommendationRank: planTier,
                activePlanRecommendationRankLabel: planTierLabel,
                planSelectionStatus: JOB_PLAN_STATUS.DRAFT,
                solutionSelectionStatus: JOB_PLAN_STATUS.DRAFT,
                rate: recommendedPriceCents,
                estimateTotalCents: recommendedPriceCents,
                estimateSubtotalCents: recommendedPriceCents,
                estimateLineItems: plan.estimateLineItems,
                estimateLaborLineItems: plan.estimateLaborLineItems,
                fieldEstimatePlanId: planId,
                fieldEstimateServiceStopId: serviceStopId,
                updatedAt: serverTimestamp(),
                updatedAtMillis: Date.now(),
            };
            await updateDoc(jobRef, jobUpdates);

            const serviceStopUpdates = {
                "fieldEstimateWorkflow.jobEstimatePlan": {
                    planId,
                    title: plan.title,
                    notes: plan.description,
                    recommendedPriceCents,
                    planTier,
                    planTierLabel,
                    savedAt: serverTimestamp(),
                    savedByUserId: activeCompanyUserId,
                    savedByUserName: activeCompanyUserName,
                },
                recommendedJobEstimatePriceCents: recommendedPriceCents,
                fieldJobPlanRecommendedPriceCents: recommendedPriceCents,
                fieldJobPlanTitle: plan.title,
                fieldJobPlanNotes: plan.description,
                fieldJobPlanTier: planTier,
                fieldJobPlanId: planId,
                updatedAt: serverTimestamp(),
            };
            await updateDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId), serviceStopUpdates);

            setServiceStop((current) => ({
                ...current,
                fieldEstimateWorkflow: {
                    ...(current?.fieldEstimateWorkflow || {}),
                    jobEstimatePlan: {
                        planId,
                        title: plan.title,
                        notes: plan.description,
                        recommendedPriceCents,
                        planTier,
                        planTierLabel,
                        savedAt: now,
                        savedByUserId: activeCompanyUserId,
                        savedByUserName: activeCompanyUserName,
                    },
                },
                recommendedJobEstimatePriceCents: recommendedPriceCents,
                fieldJobPlanRecommendedPriceCents: recommendedPriceCents,
                fieldJobPlanTitle: plan.title,
                fieldJobPlanNotes: plan.description,
                fieldJobPlanTier: planTier,
                fieldJobPlanId: planId,
            }));
            toast.success("Field job plan saved.");
        } catch (error) {
            console.error("Failed to save field job plan:", error);
            toast.error("Failed to save the field job plan.");
        } finally {
            setSavingFieldJobPlan(false);
        }
    };

    const syncActiveRouteForServiceStops = async ({ date, techId, techName }) => {
        if (!recentlySelectedCompany || !date || !techId) return null;

        const dayStart = startOfDay(date);
        const dayEnd = endOfDay(date);
        if (!dayStart || !dayEnd) return null;

        const [stopsSnapshot, routesSnapshot] = await Promise.all([
            getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "serviceStops"),
                    where("serviceDate", ">=", dayStart),
                    where("serviceDate", "<=", dayEnd)
                )
            ),
            getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "activeRoutes"),
                    where("date", ">=", dayStart),
                    where("date", "<=", dayEnd)
                )
            ),
        ]);

        const stops = stopsSnapshot.docs
            .map((stopDoc) => ({ id: stopDoc.id, ...stopDoc.data() }))
            .filter((stop) => stop.techId === techId || (!stop.techId && stop.tech === techName));
        const existingRoutes = routesSnapshot.docs
            .map((routeDoc) => ({ id: routeDoc.id, ref: routeDoc.ref, ...routeDoc.data() }))
            .filter((route) => !route.duplicateOf && route.techId === techId);
        const routeForTech = pickCanonicalRoute(existingRoutes);

        if (!stops.length && !existingRoutes.length) return null;

        const batch = writeBatch(db);
        const duplicateRoutes = existingRoutes.filter((route) => route.id !== routeForTech?.id);

        if (!stops.length) {
            if (routeForTech?.ref) {
                batch.update(routeForTech.ref, {
                    serviceStopsIds: [],
                    order: [],
                    totalStops: 0,
                    finishedStops: 0,
                    status: "Did Not Start",
                });
            }

            duplicateRoutes.forEach((route) => {
                batch.update(route.ref, {
                    duplicateOf: routeForTech?.id || "",
                    serviceStopsIds: [],
                    order: [],
                    totalStops: 0,
                    finishedStops: 0,
                });
            });

            await batch.commit();
            return null;
        }

        const routeId = routeForTech?.id || activeRouteDocumentId(dayStart, techId);
        const routeRef = doc(db, "companies", recentlySelectedCompany, "activeRoutes", routeId);
        const serviceStopsIds = stops.map((stop) => stop.id);
        const finishedStops = stops.filter(isServiceStopFinished).length;
        const routePayload = {
            id: routeId,
            name: routeForTech?.name || `${techName || "Technician"}'s Route - ${format(dayStart, "MM/dd/yyyy")}`,
            date: Timestamp.fromDate(dayStart),
            techId,
            techName: techName || "",
            serviceStopsIds,
            order: buildRouteOrder(stops, routeForTech?.order || []),
            totalStops: serviceStopsIds.length,
            finishedStops,
            durationSeconds: stops.reduce((total, stop) => total + Number(stop.duration || stop.estimatedDuration || 0), 0) * 60,
            status: getRouteStatusFromStops(stops, routeForTech),
            distanceMiles: Number(routeForTech?.distanceMiles || routeForTech?.distance || 0),
            vehicalId: routeForTech?.vehicalId || "",
            vehicleSource: routeForTech?.vehicleSource || "",
            personalVehicleOwnerId: routeForTech?.personalVehicleOwnerId || "",
            vehicleLabel: routeForTech?.vehicleLabel || "",
            vehiclePlate: routeForTech?.vehiclePlate || "",
            vehicleKind: routeForTech?.vehicleKind || "",
        };

        batch.set(routeRef, routePayload, { merge: true });
        duplicateRoutes.forEach((route) => {
            batch.update(route.ref, {
                duplicateOf: routeId,
                serviceStopsIds: [],
                order: [],
                totalStops: 0,
                finishedStops: 0,
            });
        });

        await batch.commit();
        return routePayload;
    };

    const handleEditFieldChange = (field, value) => {
        setEditForm((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const toggleEditEnabled = (nextValue) => {
        setEditEnabled(nextValue);
        if (!nextValue) {
            setShowDeleteConfirm(false);
            setEditForm({
                serviceDate: formatDateInput(serviceStop?.serviceDate),
                techId: serviceStop?.techId || "",
                description: serviceStop?.description || "",
            });
        }
    };

    const saveServiceStopEdits = async (event) => {
        event.preventDefault();
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        const nextServiceDate = parseDateInput(editForm.serviceDate);
        if (!nextServiceDate) {
            toast.error("Select a valid service date");
            return;
        }

        const selectedTechnician = findCompanyUser(editForm.techId);
        if (!selectedTechnician) {
            toast.error("Select a technician");
            return;
        }

        const techChanged = selectedTechnician.userId !== serviceStop.techId;
        const dateChanged = !sameDay(nextServiceDate, serviceStop.serviceDate);
        const description = editForm.description || "";
        const updatedAt = new Date();

        try {
            setSavingEdit(true);
            const batch = writeBatch(db);
            const serviceStopRef = doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId);

            batch.update(serviceStopRef, {
                serviceDate: Timestamp.fromDate(nextServiceDate),
                techId: selectedTechnician.userId,
                tech: selectedTechnician.userName,
                description,
                updatedAt: Timestamp.fromDate(updatedAt),
            });

            if (techChanged) {
                taskList
                    .filter((task) => task.id && task.status !== "Finished")
                    .forEach((task) => {
                        batch.update(
                            doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId, "tasks", task.id),
                            {
                                workerId: selectedTechnician.userId,
                                workerName: selectedTechnician.userName,
                                workerType: selectedTechnician.workerType || task.workerType || "",
                                updatedAt: Timestamp.fromDate(updatedAt),
                            }
                        );
                    });
            }

            await batch.commit();

            if (dateChanged || techChanged) {
                const syncs = [
                    syncActiveRouteForServiceStops({
                        date: serviceStop.serviceDate,
                        techId: serviceStop.techId,
                        techName: serviceStop.tech,
                    }),
                ];

                if (dateChanged || serviceStop.techId !== selectedTechnician.userId) {
                    syncs.push(
                        syncActiveRouteForServiceStops({
                            date: nextServiceDate,
                            techId: selectedTechnician.userId,
                            techName: selectedTechnician.userName,
                        })
                    );
                }

                await Promise.all(syncs);
            }

            setServiceStop((current) => ({
                ...current,
                serviceDate: nextServiceDate,
                techId: selectedTechnician.userId,
                tech: selectedTechnician.userName,
                description,
            }));
            setNewTask((current) => ({
                ...current,
                workerId: selectedTechnician.userId,
                workerName: selectedTechnician.userName,
            }));

            if (techChanged) {
                setTaskList((current) =>
                    current.map((task) =>
                        task.status === "Finished"
                            ? task
                            : {
                                ...task,
                                workerId: selectedTechnician.userId,
                                workerName: selectedTechnician.userName,
                                workerType: selectedTechnician.workerType || task.workerType || "",
                            }
                    )
                );
            }

            toast.success("Service stop updated");
        } catch (error) {
            console.error("Failed to update service stop:", error);
            toast.error("Failed to update service stop");
        } finally {
            setSavingEdit(false);
        }
    };

    const unfinishedManualFinishTasks = taskList.filter((task) => task.status !== "Finished");
    const selectedManualFinishTaskCount = manualFinishTaskIds.filter((taskId) =>
        unfinishedManualFinishTasks.some((task) => task.id === taskId)
    ).length;

    const openManualFinishConfirm = () => {
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        if (isServiceStopFinished(serviceStop) && isFinishedStatus(serviceStop.operationStatus)) {
            toast.success("Service stop is already finished");
            return;
        }

        setManualFinishTaskIds(unfinishedManualFinishTasks.map((task) => task.id));
        setShowFinishConfirm(true);
    };

    const closeManualFinishConfirm = () => {
        if (finishingStop) return;
        setShowFinishConfirm(false);
        setManualFinishTaskIds([]);
    };

    const toggleManualFinishTask = (taskId) => {
        setManualFinishTaskIds((currentIds) => (
            currentIds.includes(taskId)
                ? currentIds.filter((id) => id !== taskId)
                : [...currentIds, taskId]
        ));
    };

    const setAllManualFinishTasks = (checked) => {
        setManualFinishTaskIds(checked ? unfinishedManualFinishTasks.map((task) => task.id) : []);
    };

    const completionContextForTask = (task = {}) => {
        const taskType = canonicalJobTaskType(task.type || "");
        const equipment = task.equipmentId ? equipmentById.get(task.equipmentId) || null : null;
        const shoppingItem = task.shoppingListItemId
            ? serviceStopShoppingItems.find((item) => item.id === task.shoppingListItemId) || null
            : null;
        const dataBaseItemId =
            taskDataBaseItemIdFor(task) ||
            shoppingItem?.dataBaseItemId ||
            shoppingItem?.dbItemId ||
            shoppingItem?.itemId ||
            "";

        return {
            taskType,
            equipment,
            dataBaseItem: dataBaseItemId ? equipmentDatabaseItemById.get(dataBaseItemId) || null : null,
            dataBaseItemId,
            bodyOfWaterId:
                task.bodyOfWaterId ||
                equipment?.bodyOfWaterId ||
                serviceStop?.bodyOfWaterId ||
                (bodiesOfWater.length === 1 ? bodiesOfWater[0].id : "") ||
                "",
        };
    };

    const validateTaskCompletionPrerequisites = (task = {}) => {
        const context = completionContextForTask(task);

        if (taskTypeRequiresBodyOfWater(context.taskType) && !context.bodyOfWaterId) {
            toast.error("Select a body of water before finishing this task");
            return null;
        }

        if (taskNeedsEquipment(context.taskType) && !task.equipmentId) {
            toast.error("Select equipment before finishing this task");
            return null;
        }

        if (isInstallOrReplaceTaskType(context.taskType)) {
            if (!context.dataBaseItem || !isEquipmentDatabaseItem(context.dataBaseItem)) {
                toast.error("Select an equipment database item before finishing this task");
                return null;
            }

            if (!hasDatabaseEquipmentMapping(context.dataBaseItem)) {
                toast.error("Connect that database item to equipment type, make, and model before finishing");
                return null;
            }
        }

        return context;
    };

    const saveEquipmentMappingForDatabaseItem = async (dbItem, mapping) => {
        if (!dbItem?.id) return null;

        if (!hasDatabaseEquipmentMapping(mapping)) {
            toast.error("Connect this database item to equipment type, make, and model");
            return null;
        }

        const patch = {
            ...databaseEquipmentMappingPatch(mapping),
            category: EQUIPMENT_DATABASE_CATEGORY,
            dateUpdated: Timestamp.fromDate(new Date()),
        };
        const nextItem = {
            ...dbItem,
            ...patch,
            label: equipmentDatabaseItemLabel({ ...dbItem, ...patch }),
        };

        await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", dbItem.id),
            patch
        );
        setEquipmentDatabaseItems((current) =>
            current.map((item) => (item.id === dbItem.id ? nextItem : item))
        );

        return nextItem;
    };

    const finishServiceStopManually = async () => {
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        const selectedTaskIdSet = new Set(manualFinishTaskIds);
        const tasksToFinish = unfinishedManualFinishTasks.filter((task) => selectedTaskIdSet.has(task.id));
        const taskPlans = [];
        for (const task of tasksToFinish) {
            const completionContext = validateTaskCompletionPrerequisites(task);
            if (!completionContext) {
                return;
            }
            taskPlans.push({ task, completionContext });
        }

        try {
            setFinishingStop(true);
            const completedAt = new Date();
            const fallbackDuration = Number(serviceStop.estimatedDuration || serviceStop.duration || 0);
            const startAt = getDateValue(serviceStop.startTime) || new Date(completedAt.getTime() - fallbackDuration * 60000);
            const duration = minutesBetween(startAt, completedAt) || fallbackDuration;
            let nextTasks = [...taskList];

            for (const { task, completionContext } of taskPlans) {
                const taskRef = doc(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "tasks",
                    task.id
                );
                const finishedTask = {
                    ...task,
                    type: completionContext.taskType,
                    bodyOfWaterId: completionContext.bodyOfWaterId,
                    dataBaseItemId: isInstallOrReplaceTaskType(completionContext.taskType)
                        ? completionContext.dataBaseItemId
                        : task.dataBaseItemId || "",
                    status: "Finished",
                    workerId: task.workerId || serviceStop.techId || "",
                    workerName: task.workerName || serviceStop.tech || "",
                };
                const effects = await runWorkCompletionEffects({
                    db,
                    companyId: recentlySelectedCompany,
                    task: finishedTask,
                    serviceStop,
                    currentJobOperationStatus: serviceStop?.operationStatus || "",
                    syncJobStatus: true,
                });
                const taskUpdates = {
                    status: "Finished",
                    workerId: finishedTask.workerId,
                    workerName: finishedTask.workerName,
                    completedAt: Timestamp.fromDate(completedAt),
                    updatedAt: Timestamp.fromDate(completedAt),
                    type: finishedTask.type,
                    bodyOfWaterId: finishedTask.bodyOfWaterId,
                    dataBaseItemId: finishedTask.dataBaseItemId || "",
                    ...(effects.equipmentHistory?.replacementEquipmentId
                        ? { replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId }
                        : {}),
                    ...(effects.equipmentHistory?.installedEquipmentId
                        ? { installedEquipmentId: effects.equipmentHistory.installedEquipmentId }
                        : {}),
                    ...(effects.equipmentHistory?.installedPurchasedItemId
                        ? {
                            purchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                            installedPurchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                        }
                        : {}),
                };

                await updateDoc(taskRef, taskUpdates);
                const syncedTask = { ...finishedTask, ...taskUpdates };
                nextTasks = nextTasks.map((item) => (item.id === task.id ? syncedTask : item));
            }

            const stopUpdates = {
                operationStatus: "Finished",
                startTime: Timestamp.fromDate(startAt),
                endTime: Timestamp.fromDate(completedAt),
                finishedAt: Timestamp.fromDate(completedAt),
                completedAt: Timestamp.fromDate(completedAt),
                duration,
                manuallyFinished: true,
                manualFinishSource: "admin_web",
                updatedAt: Timestamp.fromDate(completedAt),
            };

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId), stopUpdates);

            const nextStop = {
                ...serviceStop,
                operationStatus: "Finished",
                startTime: startAt,
                endTime: completedAt,
                finishedAt: completedAt,
                completedAt,
                duration,
                manuallyFinished: true,
                manualFinishSource: "admin_web",
            };

            setServiceStop(nextStop);
            setTaskList(nextTasks);
            setShowFinishConfirm(false);
            setManualFinishTaskIds([]);
            await syncActiveRouteForServiceStops({
                date: nextStop.serviceDate,
                techId: nextStop.techId,
                techName: nextStop.tech,
            });

            try {
                const sendServiceReportOnFinish = httpsCallable(functions, "sendServiceReportOnFinish");
                await sendServiceReportOnFinish({
                    companyId: recentlySelectedCompany,
                    serviceStopId,
                    serviceReportBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
                });
            } catch (emailError) {
                console.warn("Service stop finished, but the service report callable failed:", emailError);
            }

            toast.success("Service stop finished");
        } catch (error) {
            console.error("Failed to finish service stop:", error);
            toast.error("Failed to finish service stop");
        } finally {
            setFinishingStop(false);
        }
    };

    const resetTaskForm = () => {
        setNewTask({
            name: "",
            type: "",
            status: "Not Finished",
            contractedRate: "",
            estimatedTime: "",
            customerApproval: false,
            actualTime: "",
            workerId: serviceStop?.techId || "",
            workerType: "",
            workerName: serviceStop?.tech || "",
            laborContractId: "",
            equipmentId: "",
            serviceLocationId: serviceStop?.serviceLocationId || "",
            bodyOfWaterId: "",
            dataBaseItemId: "",
            shoppingListItemId: "",
            addToRecurringServiceStop: false,
        });
        setNewTaskEquipmentMapping(emptyDatabaseEquipmentMapping());
    };

    const statusForTasks = (tasks = []) => {
        if (!tasks.length) return serviceStop?.operationStatus || "Not Finished";
        const finishedCount = tasks.filter((task) => task.status === "Finished").length;
        if (finishedCount === tasks.length) return "Finished";
        if (finishedCount > 0) return "In Progress";
        return "Not Finished";
    };

    const updateServiceStopStatusFromTasks = async (tasks = []) => {
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return serviceStop?.operationStatus || "";

        const nextStatus = statusForTasks(tasks);
        if (!nextStatus || nextStatus === serviceStop.operationStatus) return nextStatus;

        await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId),
            { operationStatus: nextStatus }
        );

        setServiceStop((prev) => ({
            ...prev,
            operationStatus: nextStatus,
        }));

        return nextStatus;
    };

    const actorName = () => (
        userDisplayName(dataBaseUser) ||
        user?.displayName ||
        user?.email ||
        ""
    );

    const approvalWithStopContext = (approval = {}) => ({
        ...approval,
        customerId: approval.customerId || serviceStop?.customerId || "",
        customerName: approval.customerName || serviceStop?.customerName || "",
        customerUserId: approval.customerUserId || partApprovalCustomer?.customerUserId || "",
        jobId: approval.jobId || serviceStop?.jobId || "",
        jobName: approval.jobName || serviceStop?.jobInternalId || serviceStop?.jobName || "",
        jobInternalId: approval.jobInternalId || serviceStop?.jobInternalId || "",
        serviceStopId: approval.serviceStopId || serviceStopId || "",
        serviceStopInternalId: approval.serviceStopInternalId || serviceStop?.internalId || "",
        scheduledServiceStopId: approval.scheduledServiceStopId || serviceStopId || "",
        scheduledServiceStopInternalId: approval.scheduledServiceStopInternalId || serviceStop?.internalId || "",
        scheduledDate: approval.scheduledDate || serviceStop?.serviceDate || null,
        serviceLocationId: approval.serviceLocationId || serviceStop?.serviceLocationId || "",
        serviceLocationName: approval.serviceLocationName || partApprovalServiceLocation?.nickName || partApprovalServiceLocation?.name || "",
        serviceLocationAddress: approval.serviceLocationAddress || serviceStopAddressText || "",
        techId: approval.techId || serviceStop?.techId || "",
        techName: approval.techName || serviceStop?.tech || "",
        assignedTechId: approval.assignedTechId || serviceStop?.techId || "",
        assignedTechName: approval.assignedTechName || serviceStop?.tech || "",
        assignedToUserId: approval.assignedToUserId || serviceStop?.techId || "",
        assignedToUserName: approval.assignedToUserName || serviceStop?.tech || "",
        assignedTechIds: Array.from(new Set([
            ...(Array.isArray(approval.assignedTechIds) ? approval.assignedTechIds : []),
            serviceStop?.techId || "",
        ].filter(Boolean))),
        assignedTechNames: Array.from(new Set([
            ...(Array.isArray(approval.assignedTechNames) ? approval.assignedTechNames : []),
            serviceStop?.tech || "",
        ].filter(Boolean))),
        purchaserId: approval.purchaserId || serviceStop?.techId || "",
        purchaserName: approval.purchaserName || serviceStop?.tech || "",
    });

    const markApprovalApprovedInPerson = async (approval) => {
        if (!requireFieldEstimatePartCreate()) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop || !approval?.id) return;

        try {
            setPartWorkflowActionId(`approve-${approval.id}`);
            const now = Timestamp.fromDate(new Date());
            const shoppingListItemId = approval.shoppingListItemId || `comp_shop_${crypto.randomUUID()}`;
            const approverName = actorName();
            const approvalUpdates = {
                status: "approved",
                approvalStatus: "approved",
                response: "approved",
                responseNote: approval.responseNote || "Approved in person",
                fulfillmentStatus: "approvedAwaitingPurchase",
                respondedAt: now,
                respondedByUserId: user?.uid || "",
                respondedByUserName: approverName,
                respondedByEmail: user?.email || "",
                approvedInPerson: true,
                inPersonApprovedByUserId: user?.uid || "",
                shoppingListItemId,
                shoppingListPath: `companies/${recentlySelectedCompany}/shoppingList/${shoppingListItemId}`,
                shoppingListGeneratedAt: approval.shoppingListGeneratedAt || now,
                autoInvoiceOnInstall: approval.autoInvoiceOnInstall === undefined
                    ? shoppingItemInstallInvoiceAutomationEnabled === true
                    : approval.autoInvoiceOnInstall === true,
                updatedAt: now,
            };
            const enrichedApproval = approvalWithStopContext({
                ...approval,
                ...approvalUpdates,
                autoInvoiceOnInstall: approval.autoInvoiceOnInstall === undefined
                    ? shoppingItemInstallInvoiceAutomationEnabled === true
                    : approval.autoInvoiceOnInstall === true,
            });
            const shoppingPayload = buildPartApprovalShoppingItemPayload({
                approval: enrichedApproval,
                shoppingListItemId,
                now,
                generated: !approval.shoppingListItemId,
            });

            const batch = writeBatch(db);
            batch.set(
                doc(db, "customerPartApprovals", approval.id),
                {
                    ...approvalUpdates,
                    serviceStopId: enrichedApproval.serviceStopId,
                    serviceStopInternalId: enrichedApproval.serviceStopInternalId,
                    scheduledServiceStopId: enrichedApproval.scheduledServiceStopId,
                    scheduledServiceStopInternalId: enrichedApproval.scheduledServiceStopInternalId,
                    scheduledDate: enrichedApproval.scheduledDate,
                    serviceLocationId: enrichedApproval.serviceLocationId,
                    serviceLocationName: enrichedApproval.serviceLocationName,
                    serviceLocationAddress: enrichedApproval.serviceLocationAddress,
                    techId: enrichedApproval.techId,
                    techName: enrichedApproval.techName,
                    assignedTechId: enrichedApproval.assignedTechId,
                    assignedTechName: enrichedApproval.assignedTechName,
                    assignedToUserId: enrichedApproval.assignedToUserId,
                    assignedToUserName: enrichedApproval.assignedToUserName,
                    assignedTechIds: enrichedApproval.assignedTechIds,
                    assignedTechNames: enrichedApproval.assignedTechNames,
                    purchaserId: enrichedApproval.purchaserId,
                    purchaserName: enrichedApproval.purchaserName,
                },
                { merge: true }
            );
            batch.set(
                doc(db, "companies", recentlySelectedCompany, "shoppingList", shoppingListItemId),
                shoppingPayload,
                { merge: true }
            );
            await batch.commit();
            toast.success("Part approved and added to this tech's shopping list");
            await loadPartWorkflow();
        } catch (error) {
            console.error("Failed to approve part in person:", error);
            toast.error("Failed to approve part");
        } finally {
            setPartWorkflowActionId("");
        }
    };

    const copyApprovalCustomerLink = async (approval) => {
        if (!approval?.id) return;

        const url = approval.customerApprovalUrl || `${window.location.origin}/customer/part-approvals/${approval.id}`;
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Customer approval link copied");
        } catch (error) {
            console.error("Failed to copy approval link:", error);
            toast.error("Could not copy approval link");
        }
    };

    const markShoppingItemDelivered = async (item) => {
        if (!canManagePartWorkflow) {
            toast.error("Only the assigned technician or an admin can install this part from the stop.");
            return;
        }
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop || !item?.id) return;

        try {
            setPartWorkflowActionId(`deliver-${item.id}`);
            const now = Timestamp.fromDate(new Date());
            const deliveredByName = actorName();
            const updates = {
                status: "Installed",
                deliveryStatus: "installed",
                fulfillmentStatus: "installed",
                needsAction: false,
                deliveredAt: now,
                deliveredByUserId: user?.uid || "",
                deliveredByUserName: deliveredByName,
                installedAt: now,
                installedByUserId: user?.uid || "",
                installedByUserName: deliveredByName,
                serviceStopId: item.serviceStopId || serviceStopId,
                serviceStopInternalId: item.serviceStopInternalId || serviceStop.internalId || "",
                scheduledServiceStopId: item.scheduledServiceStopId || serviceStopId,
                scheduledServiceStopInternalId: item.scheduledServiceStopInternalId || serviceStop.internalId || "",
                updatedAt: now,
            };

            const batch = writeBatch(db);
            batch.update(doc(db, "companies", recentlySelectedCompany, "shoppingList", item.id), updates);

            const approvalId = item.partApprovalRequestId || item.approvalRequestId || "";
            if (approvalId) {
                batch.set(
                    doc(db, "customerPartApprovals", approvalId),
                    {
                        fulfillmentStatus: "installed",
                        deliveredAt: now,
                        deliveredByUserId: user?.uid || "",
                        deliveredByUserName: deliveredByName,
                        installedAt: now,
                        installedByUserId: user?.uid || "",
                        installedByUserName: deliveredByName,
                        updatedAt: now,
                    },
                    { merge: true }
                );
            }

            await batch.commit();
            toast.success("Part marked installed");

            const shouldAutoInvoiceOnInstall = item.autoInvoiceOnInstall === undefined
                ? shoppingItemInstallInvoiceAutomationEnabled === true
                : item.autoInvoiceOnInstall === true;
            if (shouldAutoInvoiceOnInstall && !item.invoiced && !item.invoiceId && !item.salesInvoiceId) {
                const invoiceResult = await createAndSendShoppingItemInstallInvoice({
                    db,
                    functions,
                    companyId: recentlySelectedCompany,
                    shoppingItem: {
                        ...item,
                        ...updates,
                        id: item.id,
                        status: SHOPPING_LIST_STATUS.installed,
                    },
                    user,
                    getCallableAuthPayload,
                });

                if (invoiceResult.status === "sent") {
                    toast.success("Invoice created and sent.");
                } else if (invoiceResult.status === "created_email_failed") {
                    toast.error(`Invoice created, but email was not sent: ${invoiceResult.reason}`);
                } else if (invoiceResult.status === "skipped" && invoiceResult.reason === "missing_billable_amount") {
                    toast.error("Part installed, but no invoice was created because it has no billable amount.");
                } else if (invoiceResult.status === "skipped" && invoiceResult.reason === "missing_customer_email") {
                    toast.error("Part installed, but no invoice was created because the customer is missing an email.");
                }
            }
            await loadPartWorkflow();
        } catch (error) {
            console.error("Failed to mark part installed:", error);
            toast.error("Failed to mark part installed");
        } finally {
            setPartWorkflowActionId("");
        }
    };

    const handleTaskFieldChange = (field, value) => {
        if (field === "type") {
            const canonicalType = canonicalJobTaskType(value);
            const needsBodyOfWater = taskTypeRequiresBodyOfWater(canonicalType);
            const needsExistingEquipment = taskNeedsEquipment(canonicalType);
            const needsInstallItem = taskTypeRequiresInstallItem(canonicalType);

            setNewTask((prev) => {
                const selectedEquipment = prev.equipmentId ? equipmentById.get(prev.equipmentId) : null;
                return {
                    ...prev,
                    type: canonicalType,
                    equipmentId: needsExistingEquipment ? prev.equipmentId : "",
                    bodyOfWaterId: needsBodyOfWater
                        ? prev.bodyOfWaterId ||
                        selectedEquipment?.bodyOfWaterId ||
                        (bodiesOfWater.length === 1 ? bodiesOfWater[0].id : "")
                        : "",
                    dataBaseItemId: needsInstallItem ? prev.dataBaseItemId : "",
                    shoppingListItemId: needsInstallItem ? prev.shoppingListItemId : "",
                };
            });

            if (!needsInstallItem) {
                setNewTaskEquipmentMapping(emptyDatabaseEquipmentMapping());
            }
            return;
        }

        if (field === "equipmentId") {
            const selectedEquipment = equipmentById.get(value);
            setNewTask((prev) => {
                const taskType = canonicalJobTaskType(prev.type);
                return {
                    ...prev,
                    equipmentId: value,
                    serviceLocationId: selectedEquipment?.serviceLocationId || prev.serviceLocationId || serviceStop?.serviceLocationId || "",
                    bodyOfWaterId: taskTypeRequiresBodyOfWater(taskType)
                        ? selectedEquipment?.bodyOfWaterId || prev.bodyOfWaterId || ""
                        : prev.bodyOfWaterId,
                };
            });
            return;
        }

        setNewTask((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const saveNewTask = async (e) => {
        e.preventDefault();
        if (!requireServiceStopTaskEdit()) return;

        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        if (!newTask.name.trim()) {
            toast.error("Task name is required");
            return;
        }

        if (!newTask.type) {
            toast.error("Task type is required");
            return;
        }

        const newTaskType = canonicalJobTaskType(newTask.type);
        if (!can("244") && isFinishedStatus(newTask.status)) {
            toast.error("Your role can add estimate tasks, but cannot finish service-stop work.");
            return;
        }
        if (!can("244") && newTask.addToRecurringServiceStop) {
            toast.error("Your role can add estimate tasks, but cannot update recurring service stops.");
            return;
        }
        const selectedEquipment = newTask.equipmentId ? equipmentById.get(newTask.equipmentId) || null : null;
        const resolvedBodyOfWaterId =
            newTask.bodyOfWaterId ||
            selectedEquipment?.bodyOfWaterId ||
            serviceStop.bodyOfWaterId ||
            (bodiesOfWater.length === 1 ? bodiesOfWater[0].id : "") ||
            "";
        const needsBodyOfWater = taskTypeRequiresBodyOfWater(newTaskType);
        const needsExistingEquipment = taskNeedsEquipment(newTaskType);
        const needsInstallItem = taskTypeRequiresInstallItem(newTaskType);
        const needsEquipmentDatabaseItem = isInstallOrReplaceTaskType(newTaskType);

        if (needsBodyOfWater && !resolvedBodyOfWaterId) {
            toast.error("Select a body of water for this task");
            return;
        }

        if (needsExistingEquipment && !newTask.equipmentId) {
            toast.error("Select equipment for this task");
            return;
        }

        let taskDbItem = selectedNewTaskEquipmentItem;
        let equipmentMapping = newTaskEquipmentMapping;

        if (needsEquipmentDatabaseItem) {
            if (!taskDbItem || !isEquipmentDatabaseItem(taskDbItem)) {
                toast.error("Select an equipment database item for this task");
                return;
            }

            if (!hasDatabaseEquipmentMapping(equipmentMapping)) {
                equipmentMapping = databaseEquipmentMappingFromItem(taskDbItem);
            }

            if (!hasDatabaseEquipmentMapping(equipmentMapping)) {
                toast.error("Connect this database item to equipment type, make, and model");
                return;
            }
        }

        try {
            setSavingTask(true);

            if (needsEquipmentDatabaseItem) {
                taskDbItem = await saveEquipmentMappingForDatabaseItem(taskDbItem, equipmentMapping);
                if (!taskDbItem) {
                    setSavingTask(false);
                    return;
                }
            }

            const serviceStopTaskPayload = {
                name: newTask.name.trim(),
                type: newTaskType,
                status: newTask.status || "Not Finished",
                contractedRate: Number(newTask.contractedRate || 0),
                estimatedTime: Number(newTask.estimatedTime || 0),
                customerApproval: !!newTask.customerApproval,
                actualTime: Number(newTask.actualTime || 0),

                workerId: newTask.workerId || "",
                workerType: newTask.workerType || "",
                workerName: newTask.workerName || "",

                laborContractId: newTask.laborContractId || "",
                serviceStopId: {
                    id: serviceStop.id || serviceStopId,
                    internalId: serviceStop.internalId || "",
                },
                jobId: {
                    id: serviceStop.jobId || "",
                    internalId: serviceStop.jobInternalId || "",
                },
                recurringServiceStopId: {
                    id: serviceStop.recurringServiceStopId || "",
                    internalId: serviceStop.recurringServiceStopInternalId || "",
                },

                jobTaskId: "",
                recurringServiceStopTaskId: "",

                customerId: serviceStop.customerId || "",
                customerName: serviceStop.customerName || "",
                equipmentId: needsExistingEquipment ? newTask.equipmentId || "" : "",
                serviceLocationId: newTask.serviceLocationId || serviceStop.serviceLocationId || "",
                bodyOfWaterId: needsBodyOfWater ? resolvedBodyOfWaterId : "",
                dataBaseItemId: needsInstallItem ? taskDbItem?.id || newTask.dataBaseItemId || "" : "",
                shoppingListItemId: needsInstallItem ? newTask.shoppingListItemId || "" : "",
            };

            const taskRef = await addDoc(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "tasks"
                ),
                serviceStopTaskPayload
            );

            const createdTask = {
                id: taskRef.id,
                ...serviceStopTaskPayload,
            };

            if (createdTask.status === "Finished") {
                const effects = await runWorkCompletionEffects({
                    db,
                    companyId: recentlySelectedCompany,
                    task: createdTask,
                    serviceStop,
                    currentJobOperationStatus: serviceStop?.operationStatus || "",
                    syncJobStatus: true,
                });

                if (effects.equipmentHistory?.replacementEquipmentId || effects.equipmentHistory?.installedEquipmentId) {
                    const replacementUpdates = {
                        ...(effects.equipmentHistory.replacementEquipmentId
                            ? { replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId }
                            : {}),
                        ...(effects.equipmentHistory.installedEquipmentId
                            ? { installedEquipmentId: effects.equipmentHistory.installedEquipmentId }
                            : {}),
                        ...(effects.equipmentHistory.installedPurchasedItemId
                            ? {
                                purchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                                installedPurchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                            }
                            : {}),
                    };
                    await updateDoc(taskRef, replacementUpdates);
                    Object.assign(createdTask, replacementUpdates);
                }
            }

            if (
                newTask.addToRecurringServiceStop &&
                serviceStop.recurringServiceStopId
            ) {
                const recurringTaskPayload = {
                    id: `comp_rss_task_${crypto.randomUUID()}`,
                    name: newTask.name.trim(),
                    type: newTaskType,
                    contractedRate: Number(newTask.contractedRate || 0),
                    estimatedTime: Number(newTask.estimatedTime || 0),
                    status: newTask.status || "Not Finished",
                    bodyOfWaterId: needsBodyOfWater ? resolvedBodyOfWaterId : "",
                    equipmentId: needsExistingEquipment ? newTask.equipmentId || "" : "",
                    dataBaseItemId: needsInstallItem ? taskDbItem?.id || newTask.dataBaseItemId || "" : "",
                };

                const rssRef = doc(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "recurringServiceStop",
                    serviceStop.recurringServiceStopId
                );

                await updateDoc(rssRef, {
                    tasks: arrayUnion(recurringTaskPayload),
                    // recurringServiceStopTasks: arrayUnion(recurringTaskPayload),
                });
            }

            const nextTasks = [createdTask, ...taskList];
            if (can("244")) {
                await updateServiceStopStatusFromTasks(nextTasks);
            }
            setTaskList(nextTasks);
            toast.success("Task added");
            setShowAddTask(false);
            resetTaskForm();
        } catch (error) {
            console.error(error);
            toast.error("Failed to add task");
        } finally {
            setSavingTask(false);
        }
    };

    const markTaskFinished = async (task) => {
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop || !task?.id) return;

        const completionContext = validateTaskCompletionPrerequisites(task);
        if (!completionContext) return;

        try {
            const taskRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "serviceStops",
                serviceStopId,
                "tasks",
                task.id
            );

            const finishedTask = {
                ...task,
                type: completionContext.taskType,
                bodyOfWaterId: completionContext.bodyOfWaterId,
                dataBaseItemId: isInstallOrReplaceTaskType(completionContext.taskType)
                    ? completionContext.dataBaseItemId
                    : task.dataBaseItemId || "",
                status: "Finished",
            };

            const effects = await runWorkCompletionEffects({
                db,
                companyId: recentlySelectedCompany,
                task: finishedTask,
                serviceStop,
                currentJobOperationStatus: serviceStop?.operationStatus || "",
                syncJobStatus: true,
            });

            const taskUpdates = {
                status: "Finished",
                type: finishedTask.type,
                bodyOfWaterId: finishedTask.bodyOfWaterId,
                dataBaseItemId: finishedTask.dataBaseItemId || "",
                ...(effects.equipmentHistory?.replacementEquipmentId
                    ? { replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId }
                    : {}),
                ...(effects.equipmentHistory?.installedEquipmentId
                    ? { installedEquipmentId: effects.equipmentHistory.installedEquipmentId }
                    : {}),
                ...(effects.equipmentHistory?.installedPurchasedItemId
                    ? {
                        purchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                        installedPurchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                    }
                    : {}),
            };

            await updateDoc(taskRef, taskUpdates);

            const syncedFinishedTask = { ...finishedTask, ...taskUpdates };
            const nextTasks = taskList.map((item) =>
                item.id === task.id ? syncedFinishedTask : item
            );
            await updateServiceStopStatusFromTasks(nextTasks);
            setTaskList(nextTasks);

            toast.success("Task marked finished");
        } catch (error) {
            console.error(error);
            toast.error("Failed to finish task");
        }
    };

    const handleDeleteServiceStop = async () => {
        if (!requirePermission("246", "delete service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        const serviceStopRef = doc(
            db,
            "companies",
            recentlySelectedCompany,
            "serviceStops",
            serviceStopId
        );

        try {
            const latestServiceStopSnap = await getDoc(serviceStopRef);
            const latestServiceStop = latestServiceStopSnap.exists()
                ? { id: latestServiceStopSnap.id, ...latestServiceStopSnap.data() }
                : serviceStop;

            if (isServiceStopFinished(latestServiceStop)) {
                toast.error("Finished service stops cannot be deleted.");
                setShowDeleteConfirm(false);
                return;
            }

            setDeleting(true);

            const batch = writeBatch(db);

            const taskSnapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "tasks"
                )
            );
            taskSnapshot.docs.forEach((taskDoc) => batch.delete(taskDoc.ref));

            const storeSnapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "stores"
                )
            );
            storeSnapshot.docs.forEach((storeDoc) => batch.delete(storeDoc.ref));

            const historySnapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "history"
                )
            );
            historySnapshot.docs.forEach((historyDoc) => batch.delete(historyDoc.ref));

            const stopDataSnapshot = await getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "stopData"),
                    where("serviceStopId", "==", serviceStopId)
                )
            );
            stopDataSnapshot.docs.forEach((stopDataDoc) => batch.delete(stopDataDoc.ref));

            const routesSnapshot = await getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "activeRoutes"),
                    where("serviceStopsIds", "array-contains", serviceStopId)
                )
            );
            routesSnapshot.docs.forEach((routeDoc) => {
                const route = routeDoc.data();
                const remainingStopIds = (route.serviceStopsIds || []).filter((id) => id !== serviceStopId);
                const wasFinished = ["finished", "completed", "done", "complete"].includes(
                    String(serviceStop.operationStatus || "").toLowerCase()
                );
                const finishedStops = Math.max(
                    0,
                    Math.min(
                        remainingStopIds.length,
                        Number(route.finishedStops || 0) - (wasFinished ? 1 : 0)
                    )
                );

                batch.update(routeDoc.ref, {
                    serviceStopsIds: remainingStopIds,
                    order: Array.isArray(route.order)
                        ? route.order
                            .filter((item) => (item.serviceStopId || item.id) !== serviceStopId)
                            .map((item, index) => ({ ...item, order: index + 1 }))
                        : [],
                    totalStops: remainingStopIds.length,
                    finishedStops,
                    status: remainingStopIds.length === 0
                        ? "Did Not Start"
                        : finishedStops === remainingStopIds.length
                            ? "Finished"
                            : finishedStops > 0
                                ? "In Progress"
                                : (route.status || "Did Not Start"),
                });
            });

            batch.delete(serviceStopRef);
            await batch.commit();

            toast.success("Service stop deleted");
            navigate("/company/serviceStops");
        } catch (error) {
            console.error("Error deleting service stop:", error);
            toast.error("Failed to delete service stop");
        } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    const shouldShowFieldEstimateWorkspace = isServiceAgreementEstimate || isJobEstimateStop;
    const savedJobPlanTier = normalizeJobPlanTier(
        jobEstimatePlanRecommendation.planTier || serviceStop?.fieldJobPlanTier || jobPlanForm.planTier || DEFAULT_JOB_PLAN_TIER
    );
    const savedAgreementRateTypeLabel = fieldAgreementRateTypeOptions.find((option) =>
        option.value === (initialSurveyRecommendation.rateType || serviceStop?.recommendedServiceAgreementRateType || serviceAgreementRecommendationForm.rateType)
    )?.label || "Service";

    const renderFieldEstimateWorkspace = () => {
        if (!shouldShowFieldEstimateWorkspace) return null;

        return (
            <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm lg:col-span-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Field Estimate Workspace</p>
                        <h3 className="mt-1 text-xl font-bold text-slate-900">
                            {isServiceAgreementEstimate ? "Initial Survey" : "Job Estimate"}
                        </h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {isServiceAgreementEstimate && savedServiceAgreementPriceCents > 0 && (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                {centsCurrency(savedServiceAgreementPriceCents)} {savedAgreementRateTypeLabel}
                            </span>
                        )}
                        {isJobEstimateStop && savedJobPlanPriceCents > 0 && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                                {centsCurrency(savedJobPlanPriceCents)} Plan
                            </span>
                        )}
                    </div>
                </div>

                <div className={`mt-4 grid grid-cols-1 gap-4 ${isServiceAgreementEstimate && isJobEstimateStop ? "xl:grid-cols-2" : ""}`}>
                    {isServiceAgreementEstimate && (
                        <form onSubmit={saveServiceAgreementRecommendation} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h4 className="font-bold text-slate-900">Service Agreement Price</h4>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">
                                        {initialSurveyRecommendation.recommendedByUserName
                                            ? `Recommended by ${initialSurveyRecommendation.recommendedByUserName}`
                                            : "No recommendation saved"}
                                    </p>
                                </div>
                                {connectedServiceAgreement?.id && (
                                    <Link
                                        to={`/company/sales/agreements/${connectedServiceAgreement.id}`}
                                        className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                                    >
                                        Agreement
                                    </Link>
                                )}
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Recommended Price</span>
                                    <div className="mt-1 flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                                        <span className="text-sm font-bold text-slate-500">$</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={serviceAgreementRecommendationForm.price}
                                            onChange={(event) => updateServiceAgreementRecommendationField("price", event.target.value)}
                                            disabled={savingServiceAgreementRecommendation}
                                            className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-sm font-semibold text-slate-900 outline-none disabled:text-slate-400"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </label>

                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Rate</span>
                                    <select
                                        value={serviceAgreementRecommendationForm.rateType}
                                        onChange={(event) => updateServiceAgreementRecommendationField("rateType", event.target.value)}
                                        disabled={savingServiceAgreementRecommendation}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                        {fieldAgreementRateTypeOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <label className="mt-3 block">
                                <span className="text-sm font-semibold text-slate-700">Field Notes</span>
                                <textarea
                                    value={serviceAgreementRecommendationForm.notes}
                                    onChange={(event) => updateServiceAgreementRecommendationField("notes", event.target.value)}
                                    disabled={savingServiceAgreementRecommendation}
                                    rows={3}
                                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                                    placeholder="Included services, startup work, chemistry concerns, access notes"
                                />
                            </label>

                            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                <button
                                    type="submit"
                                    disabled={savingServiceAgreementRecommendation}
                                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {savingServiceAgreementRecommendation ? "Saving..." : "Save Recommendation"}
                                </button>
                                {canCreateFieldServiceAgreement && (
                                    <Link
                                        to={serviceAgreementSurveyDraftPath}
                                        className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                                    >
                                        Create Agreement
                                    </Link>
                                )}
                                {canSendFieldServiceAgreement && connectedServiceAgreementSendPath && (
                                    <Link
                                        to={connectedServiceAgreementSendPath}
                                        className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                    >
                                        Send Agreement
                                    </Link>
                                )}
                            </div>
                        </form>
                    )}

                    {isJobEstimateStop && (
                        <form onSubmit={saveFieldJobPlan} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h4 className="font-bold text-slate-900">Job Estimate Plan</h4>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">
                                        {jobEstimatePlanRecommendation.planId
                                            ? `Saved plan ${jobEstimatePlanRecommendation.planId}`
                                            : `${taskList.length} task${taskList.length === 1 ? "" : "s"} and ${serviceStopShoppingItems.length} part${serviceStopShoppingItems.length === 1 ? "" : "s"}`}
                                    </p>
                                </div>
                                <span className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                                    {getJobPlanRecommendationDisplay(savedJobPlanTier)}
                                </span>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Recommended Job Price</span>
                                    <div className="mt-1 flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                                        <span className="text-sm font-bold text-slate-500">$</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={jobPlanForm.price}
                                            onChange={(event) => updateJobPlanField("price", event.target.value)}
                                            disabled={!canBuildFieldJobEstimatePlan || savingFieldJobPlan}
                                            className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-sm font-semibold text-slate-900 outline-none disabled:text-slate-400"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </label>

                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Recommendation</span>
                                    <select
                                        value={jobPlanForm.planTier}
                                        onChange={(event) => updateJobPlanField("planTier", Number(event.target.value))}
                                        disabled={!canBuildFieldJobEstimatePlan || savingFieldJobPlan}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                        {JOB_PLAN_TIER_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {getJobPlanRecommendationDisplay(option.value)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <label className="mt-3 block">
                                <span className="text-sm font-semibold text-slate-700">Plan Name</span>
                                <input
                                    type="text"
                                    value={jobPlanForm.title}
                                    onChange={(event) => updateJobPlanField("title", event.target.value)}
                                    disabled={!canBuildFieldJobEstimatePlan || savingFieldJobPlan}
                                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                                    placeholder="Repair existing system"
                                />
                            </label>

                            <label className="mt-3 block">
                                <span className="text-sm font-semibold text-slate-700">Plan Notes</span>
                                <textarea
                                    value={jobPlanForm.notes}
                                    onChange={(event) => updateJobPlanField("notes", event.target.value)}
                                    disabled={!canBuildFieldJobEstimatePlan || savingFieldJobPlan}
                                    rows={3}
                                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                                    placeholder="Parts needed, labor scope, customer-facing recommendation"
                                />
                            </label>

                            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tasks</p>
                                    <p className="mt-1 font-bold text-slate-900">{taskList.length}</p>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parts</p>
                                    <p className="mt-1 font-bold text-slate-900">{serviceStopShoppingItems.length}</p>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                {canBuildFieldJobEstimatePlan && (
                                    <button
                                        type="submit"
                                        disabled={savingFieldJobPlan}
                                        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {savingFieldJobPlan ? "Saving..." : "Save Field Plan"}
                                    </button>
                                )}
                                {jobEstimatePlannedPath && (
                                    <Link
                                        to={jobEstimatePlannedPath}
                                        className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                                    >
                                        Review Plan
                                    </Link>
                                )}
                                {canSendFieldJobEstimate && jobEstimateBillingPath && (
                                    <Link
                                        to={jobEstimateBillingPath}
                                        className="inline-flex items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                                    >
                                        Send Estimate
                                    </Link>
                                )}
                            </div>
                        </form>
                    )}
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
                <div className="w-full">
                    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="animate-pulse space-y-4">
                            <div className="h-6 w-1/3 rounded bg-slate-200" />
                            <div className="h-4 w-1/2 rounded bg-slate-200" />
                            <div className="h-40 rounded bg-slate-200" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!serviceStop) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50">
                <p className="text-lg text-slate-600">Service stop not found.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <Link
                            to="/company/serviceStops"
                            className="app-back-link"
                        >
                            &larr; Back to Service Stops
                        </Link>
                        <h2 className="text-3xl font-bold text-slate-800">Service Stop Details</h2>
                        <p className="text-sm text-slate-500">#{serviceStop.internalId || "—"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {(can("244") || can("246")) && (
                            <button
                                type="button"
                                onClick={() => toggleEditEnabled(true)}
                                disabled={editEnabled}
                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-500"
                            >
                                Edit
                            </button>
                        )}
                        <ShareItemButton
                            type="serviceStop"
                            recordId={serviceStopId}
                            title={serviceStop.type || serviceStop.serviceStopType || "Service Stop"}
                            subtitle={[serviceStop.customerName, serviceStop.internalId].filter(Boolean).join(" - ")}
                            companyId={recentlySelectedCompany}
                            customerId={serviceStop.customerId}
                            collectionPath={`companies/${recentlySelectedCompany}/serviceStops`}
                            webPath={`/company/serviceStops/detail/${serviceStopId}`}
                        />
                        <button
                            type="button"
                            onClick={printServiceReport}
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                            <PrinterIcon className="h-4 w-4" />
                            Print Report
                        </button>
                        {can("244") && (
                            <button
                                type="button"
                                onClick={sendServiceReport}
                                disabled={sendingServiceReport}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <PaperAirplaneIcon className="h-4 w-4" />
                                {sendingServiceReport ? "Sending..." : "Send Report"}
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:col-span-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h3 className="text-base font-bold text-slate-800">Stop Information</h3>

                                <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-bold leading-none ${getStatusClass(
                                        serviceStop.operationStatus
                                    )}`}
                                >
                                    {serviceStop.operationStatus || "—"}
                                </span>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-3 border-t border-slate-200 pt-3 md:grid-cols-3 xl:grid-cols-5">
                                <div>
                                    <p className="text-sm font-semibold text-slate-600">Bucket</p>
                                    <span className={`mt-1 inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${serviceStopBucket.className}`}>
                                        {serviceStopBucket.label}
                                    </span>
                                </div>
                                <Field label="Work Order Type" value={getWorkOrderTypeLabel(serviceStop)} />
                                <Field label="Pay Type" value={getServiceStopTypeLabel(serviceStop)} />
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-3 border-t border-slate-200 pt-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                                <Field label="Customer">
                                    {serviceStop.customerId ? (
                                        <Link
                                            to={`/company/customers/details/${serviceStop.customerId}`}
                                            className="text-slate-800 hover:text-blue-700"
                                        >
                                            {serviceStop.customerName || "Customer"}
                                        </Link>
                                    ) : (
                                        <p className="text-slate-800">{serviceStop.customerName || "—"}</p>
                                    )}
                                </Field>
                                <Field label="Technician" value={serviceStop.tech} />

                                <Field label="Recurring Service Stop">
                                    {serviceStop.recurringServiceStopId ? (
                                        <Link
                                            to={`/company/recurringServiceStop/details/${serviceStop.recurringServiceStopId}`}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {serviceStop.recurringServiceStopId}
                                        </Link>
                                    ) : (
                                        <p className="text-slate-800">—</p>
                                    )}
                                </Field>

                                <Field
                                    label="Date"
                                    value={
                                        serviceStop.serviceDate
                                            ? format(serviceStop.serviceDate, "PP")
                                            : "N/A"
                                    }
                                />

                                <Field label="Address">
                                    {serviceStopGoogleMapsUrl ? (
                                        <a
                                            href={serviceStopGoogleMapsUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-slate-800 hover:text-blue-700"
                                        >
                                            {serviceStopAddressText}
                                        </a>
                                    ) : (
                                        <p className="text-slate-800">—</p>
                                    )}
                                </Field>

                                <Field label="Job">
                                    {serviceStop.jobId ? (
                                        <Link
                                            to={`/company/jobs/detail/${serviceStop.jobId}`}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {serviceStop.jobInternalId || "Open Job"}
                                        </Link>
                                    ) : (
                                        <p className="text-slate-800">—</p>
                                    )}
                                </Field>

                                <Field label="Billing Status" value={serviceStop.billingStatus} />
                                <Field label="Duration" value={formatMinutes(serviceStop.duration)} />
                                <Field
                                    label="Estimated Duration"
                                    value={formatMinutes(serviceStop.estimatedDuration)}
                                />
                                <Field label="Description" value={serviceStop.description || "None"} />
                            </div>

                            {!isServiceAgreementEstimate && (
                                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Technician Service Notes</h3>
                                    <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-700">
                                        {technicianServiceNotes || "No technician service notes captured."}
                                    </p>
                                </div>
                            )}
                    </div>

                    {renderFieldEstimateWorkspace()}

                    <div className="lg:col-span-2 space-y-6">
                        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800">Part Approvals & Deliveries</h3>
                                    <p className="text-sm text-slate-600 mt-1">
                                        Request customer approval for replacement parts and deliver approved items for this stop.
                                    </p>
                                </div>
                                {canCreateFieldEstimateParts && (
                                    <button
                                        type="button"
                                        onClick={() => setShowPartApprovalModal(true)}
                                        disabled={!partApprovalCustomer}
                                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        New Part Approval
                                    </button>
                                )}
                            </div>

                            {loadingPartWorkflow ? (
                                <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                    Loading part approvals and shopping items...
                                </div>
                            ) : (
                                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                                    <div>
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Approval Requests</h4>
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                                {partApprovals.length}
                                            </span>
                                        </div>

                                        {partApprovals.length ? (
                                            <div className="space-y-3">
                                                {partApprovals.map((approval) => {
                                                    const pending = isPartApprovalPending(approval);
                                                    const actionId = `approve-${approval.id}`;

                                                    return (
                                                        <div key={approval.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="min-w-0">
                                                                    <p className="font-semibold text-slate-900">
                                                                        {approval.itemName || approval.name || approval.dbItemName || "Pool Part"}
                                                                    </p>
                                                                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                                                                        {approval.description || "Replacement part approval"}
                                                                    </p>
                                                                </div>
                                                                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${pending ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                                                                    {approval.status || approval.approvalStatus || "pending"}
                                                                </span>
                                                            </div>

                                                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                                                <div>
                                                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qty</p>
                                                                    <p className="font-semibold text-slate-800">{approval.quantity || "1"}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Price</p>
                                                                    <p className="font-semibold text-slate-800">{centsCurrency(partApprovalTotalPriceCents(approval))}</p>
                                                                </div>
                                                            </div>

                                                            <div className="mt-4 flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => copyApprovalCustomerLink(approval)}
                                                                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                                                                >
                                                                    Copy Customer Link
                                                                </button>
                                                                {pending && canCreateFieldEstimateParts && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => markApprovalApprovedInPerson(approval)}
                                                                        disabled={partWorkflowActionId === actionId}
                                                                        className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                                    >
                                                                        {partWorkflowActionId === actionId ? "Approving..." : "Mark Approved In Person"}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                                No part approvals are linked to this stop yet.
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Approved Parts For This Stop</h4>
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                                {serviceStopShoppingItems.length}
                                            </span>
                                        </div>

                                        {serviceStopShoppingItems.length ? (
                                            <div className="space-y-3">
                                                {serviceStopShoppingItems.map((item) => {
                                                    const delivered = isShoppingItemDelivered(item);
                                                    const actionId = `deliver-${item.id}`;

                                                    return (
                                                        <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                                            <div className="flex gap-3">
                                                                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                                                                    {item.photoUrl ? (
                                                                        <img src={item.photoUrl} alt="" className="h-full w-full object-cover" />
                                                                    ) : (
                                                                        <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-slate-400">
                                                                            Photo
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <div className="min-w-0">
                                                                            <p className="truncate font-semibold text-slate-900">{item.name || "Shopping item"}</p>
                                                                            <p className="mt-1 text-sm text-slate-600">
                                                                                Qty {item.quantity || "1"} · {centsCurrency(partApprovalTotalPriceCents(item))}
                                                                            </p>
                                                                        </div>
                                                                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${delivered ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>
                                                                            {item.status || "Ready"}
                                                                        </span>
                                                                    </div>
                                                                    <p className="mt-2 text-xs text-slate-500">
                                                                        Assigned to {item.assignedTechName || item.assignedToUserName || item.userName || serviceStop.tech || "technician"}
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            {canManagePartWorkflow && !delivered && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => markShoppingItemDelivered(item)}
                                                                    disabled={partWorkflowActionId === actionId}
                                                                    className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    {partWorkflowActionId === actionId ? "Saving..." : "Mark Installed"}
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                                Approved parts will appear here after customer or in-person approval.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {isServiceAgreementEstimate && (
                            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-800">Service Agreement Survey Report</h3>
                                        <p className="mt-1 text-sm text-slate-600">
                                            Technician-gathered setup, sales, water, and equipment details for the initial report.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {connectedServiceAgreement?.id && (
                                            <Link
                                                to={`/company/sales/agreements/${connectedServiceAgreement.id}`}
                                                className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                            >
                                                Connected: {agreementDisplayTitle(connectedServiceAgreement)}
                                            </Link>
                                        )}
                                        <button
                                            type="button"
                                            onClick={openConnectAgreementModal}
                                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                        >
                                            {connectedServiceAgreement?.id ? "Change Agreement" : "Connect Agreement"}
                                        </button>
                                        {canCreateFieldServiceAgreement && (
                                            <Link
                                                to={serviceAgreementSurveyDraftPath}
                                                className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                                            >
                                                Create Service Agreement
                                            </Link>
                                        )}
                                        {canSendFieldServiceAgreement && connectedServiceAgreementSendPath && (
                                            <Link
                                                to={connectedServiceAgreementSendPath}
                                                className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
                                            >
                                                Send Agreement
                                            </Link>
                                        )}
                                        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                            Agreement Estimate
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-5 grid grid-cols-1 gap-4 border-y border-slate-200 py-4 md:grid-cols-3">
                                    <Field label="Location Name" value={serviceLocation?.nickName || serviceLocation?.name || serviceStop.customerName} />
                                    <Field label="Gate Code" value={serviceLocation?.gateCode || serviceLocation?.accessCode} />
                                    <Field label="Technician" value={serviceStop.tech} />
                                    <Field label="Survey Date" value={formatDateText(serviceStop.serviceDate)} />
                                    <Field label="Customer" value={serviceStop.customerName} />
                                    <Field label="Address" value={`${serviceStop.address?.streetAddress || ""}${serviceStop.address?.city ? `, ${serviceStop.address.city}` : ""}${serviceStop.address?.state ? `, ${serviceStop.address.state}` : ""}`} />
                                </div>

                                <div className="mt-5">
                                    <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Technician Service Notes</h4>
                                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                                        {technicianServiceNotes || "No technician service notes captured."}
                                    </p>
                                </div>

                                <div className="mt-5">
                                    <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Service Location Notes</h4>
                                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                                        {surveyNotes.locationNotes || "No location notes captured."}
                                    </p>
                                    <SurveyPhotoGrid
                                        title="Location Photos"
                                        photos={serviceLocation?.photoUrls || serviceLocation?.photos || serviceLocation?.serviceLocationPhotos || []}
                                    />
                                </div>

                                {(surveyNotes.findings.length > 0 || equipmentSurveyFindings.length > 0) && (
                                    <div className="mt-6 border-t border-slate-200 pt-5">
                                        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Suggested Repairs & Changes</h4>
                                        <div className="mt-3 space-y-3">
                                            {surveyNotes.findings.map((finding, index) => (
                                                <div key={`${finding}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                                    {finding}
                                                </div>
                                            ))}
                                            {equipmentSurveyFindings.map((finding) => (
                                                <div key={finding.id || finding.title} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                                    <p className="font-semibold">{finding.title}</p>
                                                    <p className="mt-1">Status: {finding.status}</p>
                                                    {finding.notes && <p className="mt-1 whitespace-pre-line">{finding.notes}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="mt-6 border-t border-slate-200 pt-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Body Of Water Details</h4>
                                        <span className="text-xs font-semibold text-slate-500">{bodiesOfWater.length}</span>
                                    </div>
                                    {bodiesOfWater.length ? (
                                        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
                                            {bodiesOfWater.map((body) => {
                                                const bodyTitle = getBodyOfWaterTitle(body);
                                                const bodyType = displayText(body.type || body.bodyOfWaterType || body.waterType, "Pool");
                                                const bodyStatus = displayText(body.status || body.operationStatus, "Active");
                                                const bodyNotes = body.notes || body.description;

                                                return (
                                                    <div key={body.id || bodyTitle} className="border-b border-slate-200 px-4 py-4 last:border-b-0">
                                                        <div className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2.4fr)_auto] lg:items-start">
                                                            <div className="min-w-0">
                                                                <p className="truncate font-semibold text-slate-900" title={bodyTitle}>
                                                                    {bodyTitle}
                                                                </p>
                                                                <p className="mt-1 text-sm text-slate-500">{bodyType}</p>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
                                                                <SurveyRowMetric label="Material" value={body.material || body.surfaceMaterial} />
                                                                <SurveyRowMetric label="Shape" value={body.shape} />
                                                                <SurveyRowMetric label="Gallons" value={body.gallons || body.capacityGallons || body.volume} />
                                                                <SurveyRowMetric label="Sanitizer" value={body.sanitizer || body.sanitizerType} />
                                                                <SurveyRowMetric label="Length" value={body.length} />
                                                                <SurveyRowMetric label="Width" value={body.width} />
                                                                <SurveyRowMetric label="Shallow Depth" value={body.shallowEndDepth || body.shallowDepth} />
                                                                <SurveyRowMetric label="Deep Depth" value={body.deepEndDepth || body.deepDepth} />
                                                            </div>
                                                            <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                                                {bodyStatus}
                                                            </span>
                                                        </div>
                                                        {bodyNotes && (
                                                            <p className="mt-3 whitespace-pre-line border-t border-slate-100 pt-3 text-sm leading-6 text-slate-700">
                                                                {bodyNotes}
                                                            </p>
                                                        )}
                                                        <SurveyPhotoGrid title="Water Photos" photos={body.photoUrls || body.photos || body.bodyOfWaterPhotos || []} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            No body of water information was captured for this survey.
                                        </div>
                                    )}
                                </div>

                                <div className="mt-6 border-t border-slate-200 pt-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Equipment Information</h4>
                                        <span className="text-xs font-semibold text-slate-500">{equipmentList.length}</span>
                                    </div>
                                    {equipmentList.length ? (
                                        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
                                            {equipmentList.map((equipment) => {
                                                const equipmentTitle = getEquipmentTitle(equipment);
                                                const equipmentType = displayText(equipment.type || equipment.equipmentType, "Equipment");
                                                const equipmentStatus = displayText(
                                                    equipment.status || equipment.operationStatus || equipment.equipmentStatus,
                                                    "Operational"
                                                );
                                                const equipmentNotes = equipment.notes || equipment.serviceNotes || equipment.recommendationNotes;

                                                return (
                                                    <div key={equipment.id || equipmentTitle} className="border-b border-slate-200 px-4 py-4 last:border-b-0">
                                                        <div className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2.4fr)_auto] lg:items-start">
                                                            <div className="min-w-0">
                                                                <p className="truncate font-semibold text-slate-900" title={equipmentTitle}>
                                                                    {equipmentTitle}
                                                                </p>
                                                                <p className="mt-1 text-sm text-slate-500">{equipmentType}</p>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
                                                                <SurveyRowMetric label="Make" value={equipment.make || equipment.manufacturer} />
                                                                <SurveyRowMetric label="Model" value={equipment.model} />
                                                                <SurveyRowMetric label="Catalog Match" value={equipment.catalogMatchName || equipment.catalogMatch || equipment.catalogModelName} />
                                                                <SurveyRowMetric label="Needs Service" value={firstPresent(equipment.needsService, equipment.needsRepair, false)} />
                                                                <SurveyRowMetric label="Last Service" value={formatDateText(equipment.lastServiceDate || equipment.lastServicedAt)} />
                                                                <SurveyRowMetric label="Next Service" value={formatDateText(equipment.nextServiceDate || equipment.nextScheduledServiceDate)} />
                                                                <SurveyRowMetric label="Clean Pressure" value={firstPresent(equipment.cleanFilterPressure, equipment.cleanPressure)} />
                                                                <SurveyRowMetric label="Current Pressure" value={firstPresent(equipment.currentFilterPressure, equipment.currentPressure)} />
                                                            </div>
                                                            <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                                                {equipmentStatus}
                                                            </span>
                                                        </div>
                                                        {equipmentNotes && (
                                                            <p className="mt-3 whitespace-pre-line border-t border-slate-100 pt-3 text-sm leading-6 text-slate-700">
                                                                {equipmentNotes}
                                                            </p>
                                                        )}
                                                        <SurveyPhotoGrid title="Equipment Photos" photos={equipment.photoUrls || equipment.photos || equipment.equipmentPhotos || []} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            No equipment information was captured for this survey.
                                        </div>
                                    )}
                                </div>

                                <div className="mt-6 border-t border-slate-200 pt-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Captured Readings & Dosages</h4>
                                        <span className="text-xs font-semibold text-slate-500">{stopDataRecords.length}</span>
                                    </div>
                                    {stopDataRecords.length ? (
                                        <div className="mt-3 space-y-3">
                                            {stopDataRecords.map((record) => {
                                                const body = bodyOfWaterById.get(record.bodyOfWaterId);
                                                const observations = Array.isArray(record.observation)
                                                    ? record.observation
                                                    : Array.isArray(record.observations)
                                                        ? record.observations
                                                        : [];
                                                const stripPhotos = testerStripScanPhotos(record);

                                                return (
                                                    <div key={record.id || record.bodyOfWaterId} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                                        <p className="font-semibold text-slate-900">{body ? getBodyOfWaterTitle(body) : "Stop Data"}</p>
                                                        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                                                            <div>
                                                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Readings</p>
                                                                {(record.readings || []).length ? (
                                                                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                                                                        {(record.readings || []).map((reading, index) => (
                                                                            <p key={`${reading.templateId || reading.name || "reading"}-${index}`}>
                                                                                <span className="font-medium">{reading.name || reading.templateName || reading.readingName || "Reading"}:</span>{" "}
                                                                                {displayText(reading.amount || reading.value)}
                                                                                {reading.UOM || reading.uom ? ` ${reading.UOM || reading.uom}` : ""}
                                                                            </p>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <p className="mt-2 text-sm text-slate-500">No readings captured.</p>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dosages</p>
                                                                {(record.dosages || []).length ? (
                                                                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                                                                        {(record.dosages || []).map((dosage, index) => (
                                                                            <p key={`${dosage.templateId || dosage.name || "dosage"}-${index}`}>
                                                                                <span className="font-medium">{dosage.name || dosage.templateName || dosage.dosageName || "Dosage"}:</span>{" "}
                                                                                {displayText(dosage.amount || dosage.value)}
                                                                                {dosage.UOM || dosage.uom ? ` ${dosage.UOM || dosage.uom}` : ""}
                                                                            </p>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <p className="mt-2 text-sm text-slate-500">No dosages captured.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {observations.length > 0 && (
                                                            <div className="mt-4">
                                                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observations</p>
                                                                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                                                                    {observations.map((observation, index) => (
                                                                        <li key={`${observation}-${index}`}>{observation}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {stripPhotos.length > 0 && (
                                                            <div className="mt-4">
                                                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tester Strip Photos</p>
                                                                <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
                                                                    {stripPhotos.map((photo) => (
                                                                        <a
                                                                            key={photo.id}
                                                                            href={photo.url}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="group block overflow-hidden rounded-md border border-slate-200 bg-white"
                                                                        >
                                                                            <img
                                                                                src={photo.url}
                                                                                alt={photo.caption}
                                                                                className="h-32 w-full object-cover transition-transform group-hover:scale-[1.02]"
                                                                            />
                                                                            <div className="px-2 py-1.5 text-xs text-slate-600">
                                                                                <p className="truncate font-medium text-slate-700">{photo.caption}</p>
                                                                                {photo.createdAtLabel && (
                                                                                    <p className="mt-0.5 truncate">{photo.createdAtLabel}</p>
                                                                                )}
                                                                            </div>
                                                                        </a>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            No readings, dosages, or observations have been saved for this survey.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {(serviceStop.includeReadings || serviceStop.includeDosages || readingTemplates.length || dosageTemplates.length) && (
                            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-800">Stop Data</h3>
                                        <p className="text-sm text-slate-600 mt-1">Readings, dosages, and observations for this service stop.</p>
                                    </div>
                                    <div className="flex flex-col items-start gap-2 sm:items-end">
                                        <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                                            {selectedStopDataRecord ? "Saved" : "Not saved"}
                                        </span>
                                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={showManualStopData}
                                                onChange={(event) => setShowManualStopData(event.target.checked)}
                                                className="h-4 w-4 rounded border-slate-300 text-cyan-600"
                                            />
                                            Manually input stop data
                                        </label>
                                    </div>
                                </div>

                                {showManualStopData ? (
                                    bodiesOfWater.length ? (
                                    <div className="mt-5 space-y-5">
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                <div>
                                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                                        Body of Water
                                                    </p>
                                                    <p className="mt-1 text-base font-semibold text-slate-950">
                                                        {selectedBodyOfWater ? getBodyOfWaterTitle(selectedBodyOfWater) : "Select a body of water"}
                                                    </p>
                                                    {selectedBodyOfWater && (
                                                        <p className="mt-1 text-sm text-slate-500">
                                                            {getBodyOfWaterMeta(selectedBodyOfWater) || "No water details saved"}
                                                        </p>
                                                    )}
                                                </div>
                                                <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                                                    {bodiesOfWater.length} water{bodiesOfWater.length === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                                                {bodiesOfWater.map((body) => {
                                                    const selected = body.id === selectedBodyOfWaterId;
                                                    const hasStopData = stopDataBodyIds.has(body.id);

                                                    return (
                                                        <button
                                                            key={body.id}
                                                            type="button"
                                                            onClick={() => setSelectedBodyOfWaterId(body.id)}
                                                            className={[
                                                                "min-w-[13rem] rounded-lg border px-3 py-2 text-left transition",
                                                                selected
                                                                    ? "border-cyan-500 bg-white text-slate-950 shadow-sm ring-2 ring-cyan-100"
                                                                    : "border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50/50",
                                                            ].join(" ")}
                                                        >
                                                            <span className="flex items-start justify-between gap-3">
                                                                <span className="min-w-0">
                                                                    <span className="block truncate text-sm font-semibold">
                                                                        {getBodyOfWaterTitle(body)}
                                                                    </span>
                                                                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                                                                        {getBodyOfWaterMeta(body) || "No water details"}
                                                                    </span>
                                                                </span>
                                                                {hasStopData && (
                                                                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                                                                        Saved
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {serviceStop.includeReadings !== false && readingTemplates.length > 0 && (
                                            <div>
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <h4 className="font-semibold text-slate-800">Readings</h4>
                                                    <span className="text-xs font-semibold text-slate-500">
                                                        {Object.values(readingDrafts).filter(Boolean).length}/{readingTemplates.length}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {readingTemplates.map((template) => (
                                                        <label key={template.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                                            <span className="block text-sm font-semibold text-slate-700">
                                                                {template.name || "Reading"}
                                                            </span>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={readingDrafts[template.id] || ""}
                                                                    onChange={(event) =>
                                                                        setReadingDrafts((current) => ({
                                                                            ...current,
                                                                            [template.id]: event.target.value,
                                                                        }))
                                                                    }
                                                                    className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                                                                    placeholder="Amount"
                                                                />
                                                                {template.UOM && (
                                                                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                                                                        {template.UOM}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {serviceStop.includeDosages !== false && dosageTemplates.length > 0 && (
                                            <div>
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <h4 className="font-semibold text-slate-800">Dosages</h4>
                                                    <span className="text-xs font-semibold text-slate-500">
                                                        {Object.values(dosageDrafts).filter(Boolean).length}/{dosageTemplates.length}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {dosageTemplates.map((template) => (
                                                        <label key={template.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                                            <span className="block text-sm font-semibold text-slate-700">
                                                                {template.name || "Dosage"}
                                                            </span>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={dosageDrafts[template.id] || ""}
                                                                    onChange={(event) =>
                                                                        setDosageDrafts((current) => ({
                                                                            ...current,
                                                                            [template.id]: event.target.value,
                                                                        }))
                                                                    }
                                                                    className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                                                                    placeholder="Amount"
                                                                />
                                                                {template.UOM && (
                                                                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                                                                        {template.UOM}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <label className="block">
                                            <span className="block text-sm font-semibold text-slate-600 mb-1">Observations</span>
                                            <textarea
                                                value={observationDraft}
                                                onChange={(event) => setObservationDraft(event.target.value)}
                                                rows={3}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                                placeholder="One observation per line"
                                            />
                                        </label>

                                        <div>
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <h4 className="font-semibold text-slate-800">Equipment Observations</h4>
                                                <span className="text-xs font-semibold text-slate-500">
                                                    {selectedBodyEquipment.length}
                                                </span>
                                            </div>
                                            {selectedBodyEquipment.length ? (
                                                <div className="grid grid-cols-1 gap-3">
	                                                    {selectedBodyEquipment.map((equipment) => {
	                                                        const draft = equipmentMeasurementDrafts[equipment.id] || {};
	                                                        const savingThisEquipment = savingEquipmentObservationId === equipment.id;
	                                                        const filterEquipment = isFilterEquipment(equipment);
	                                                        return (
	                                                            <div key={equipment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
	                                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
	                                                                    <div>
	                                                                        <p className="font-semibold text-slate-800">{getEquipmentTitle(equipment)}</p>
	                                                                        {filterEquipment && (
	                                                                            <p className="mt-1 text-xs text-slate-500">
	                                                                                Current: {displayText(equipment.currentPressure ?? equipment.currentFilterPressure, "—")} PSI
	                                                                            </p>
	                                                                        )}
	                                                                    </div>
                                                                    {(equipment.needsService || String(equipment.status || "").toLowerCase().includes("repair") || String(equipment.status || "").toLowerCase().includes("maintenance")) && (
                                                                        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                                                                            Needs attention
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
	                                                                    {filterEquipment && (
	                                                                        <label className="block">
	                                                                            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Pressure</span>
	                                                                            <input
	                                                                                type="number"
	                                                                                value={draft.pressure || ""}
	                                                                                onChange={(event) =>
	                                                                                    setEquipmentMeasurementDrafts((current) => ({
	                                                                                        ...current,
	                                                                                        [equipment.id]: {
	                                                                                            ...(current[equipment.id] || {}),
	                                                                                            pressure: event.target.value,
	                                                                                        },
	                                                                                    }))
	                                                                                }
	                                                                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
	                                                                                placeholder="PSI"
	                                                                            />
	                                                                        </label>
	                                                                    )}
                                                                    <label className="block">
                                                                        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">RPM</span>
                                                                        <input
                                                                            type="number"
                                                                            value={draft.rpm || ""}
                                                                            onChange={(event) =>
                                                                                setEquipmentMeasurementDrafts((current) => ({
                                                                                    ...current,
                                                                                    [equipment.id]: {
                                                                                        ...(current[equipment.id] || {}),
                                                                                        rpm: event.target.value,
                                                                                    },
                                                                                }))
                                                                            }
                                                                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                                                                            placeholder="Optional"
                                                                        />
                                                                    </label>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => saveEquipmentObservation(equipment)}
                                                                        disabled={savingThisEquipment}
                                                                        className="self-end rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                                    >
                                                                        {savingThisEquipment ? "Saving..." : "Add Observation"}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                                    No equipment is linked to this body of water.
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex justify-end">
                                            <button
                                                type="button"
                                                onClick={saveStopData}
                                                disabled={savingStopData || !selectedBodyOfWaterId}
                                                className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {savingStopData ? "Saving..." : "Save Stop Data"}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                                        Add a body of water to this service location before recording stop data.
                                    </div>
                                    )
                                ) : (
                                    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                                        <p className="font-semibold text-slate-800">
                                            {stopDataRecords.length
                                                ? `${stopDataRecords.length} stop data record${stopDataRecords.length === 1 ? "" : "s"} saved`
                                                : "No stop data entered"}
                                        </p>
                                        <p className="mt-1">
                                            Manual readings, dosages, and observations are hidden until enabled.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {serviceStop.photoUrls?.length > 0 && (
                            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <h3 className="text-xl font-bold mb-4 text-slate-800">Photos</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {serviceStop.photoUrls.map((photo, index) => (
                                        <img
                                            key={index}
                                            src={photoUrl(photo)}
                                            alt={`Service stop ${index + 1}`}
                                            className="h-40 w-full rounded-md border border-slate-200 object-cover"
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800">Service Stop Tasks</h3>
                                    <p className="text-sm text-slate-600">
                                        Tasks completed or assigned for this stop
                                    </p>
                                </div>

                                {canEditServiceStopTasks && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAddTask(true)}
                                        disabled={showAddTask}
                                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-500"
                                    >
                                        Add Task
                                    </button>
                                )}
                            </div>

                            {showAddTask && canEditServiceStopTasks && (
                                <form
                                    onSubmit={saveNewTask}
                                    className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                                >
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Task Name
                                            </label>
                                            <input
                                                type="text"
                                                value={newTask.name}
                                                onChange={(e) => handleTaskFieldChange("name", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2"
                                                placeholder="Brush walls"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Type
                                            </label>
                                            <select
                                                value={newTask.type}
                                                onChange={(e) => handleTaskFieldChange("type", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                                            >
                                                <option value="">Select task type</option>
                                                {jobTaskTypeOptions.map((type) => (
                                                    <option key={type} value={type}>
                                                        {type}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Status
                                            </label>
                                            <select
                                                value={newTask.status}
                                                onChange={(e) => handleTaskFieldChange("status", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                                            >
                                                <option value="Not Finished">Not Finished</option>
                                                <option value="Finished">Finished</option>
                                                <option value="Skipped">Skipped</option>
                                            </select>
                                        </div>

                                        {newTaskNeedsBodyOfWater && (
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                    Body of Water
                                                </label>
                                                <select
                                                    value={newTask.bodyOfWaterId}
                                                    onChange={(e) => handleTaskFieldChange("bodyOfWaterId", e.target.value)}
                                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                                                >
                                                    <option value="">Select body of water</option>
                                                    {bodiesOfWater.map((body) => (
                                                        <option key={body.id} value={body.id}>
                                                            {body.name || "Unnamed Body Of Water"}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {newTaskNeedsEquipment && (
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                    Equipment
                                                </label>
                                                <select
                                                    value={newTask.equipmentId}
                                                    onChange={(e) => handleTaskFieldChange("equipmentId", e.target.value)}
                                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                                                >
                                                    <option value="">Select equipment</option>
                                                    {equipmentList.map((equipment) => (
                                                        <option key={equipment.id} value={equipment.id}>
                                                            {equipment.name || equipment.model || equipment.type || "Unnamed Equipment"}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {newTaskNeedsInstallItem && (
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                    Equipment Item
                                                </label>
                                                <select
                                                    value={newTask.dataBaseItemId}
                                                    onChange={(e) => handleTaskFieldChange("dataBaseItemId", e.target.value)}
                                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                                                >
                                                    <option value="">Select equipment item</option>
                                                    {equipmentDatabaseItems.map((item) => (
                                                        <option key={item.id} value={item.id}>
                                                            {item.label || item.name || "Equipment item"}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Contracted Rate (cents)
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={newTask.contractedRate}
                                                onChange={(e) =>
                                                    handleTaskFieldChange("contractedRate", e.target.value)
                                                }
                                                className="w-full rounded-md border border-slate-300 px-3 py-2"
                                                placeholder="2500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Estimated Time (mins)
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={newTask.estimatedTime}
                                                onChange={(e) =>
                                                    handleTaskFieldChange("estimatedTime", e.target.value)
                                                }
                                                className="w-full rounded-md border border-slate-300 px-3 py-2"
                                                placeholder="30"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Actual Time (mins)
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={newTask.actualTime}
                                                onChange={(e) => handleTaskFieldChange("actualTime", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2"
                                                placeholder="0"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Worker Name
                                            </label>
                                            <input
                                                type="text"
                                                value={newTask.workerName}
                                                onChange={(e) => handleTaskFieldChange("workerName", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2"
                                                placeholder="Tech name"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-600 mb-1">
                                                Worker Type
                                            </label>
                                            <input
                                                type="text"
                                                value={newTask.workerType}
                                                onChange={(e) => handleTaskFieldChange("workerType", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2"
                                                placeholder="employee"
                                            />
                                        </div>
                                    </div>

                                    {newTaskNeedsEquipmentDatabaseItem && selectedNewTaskEquipmentItem && (
                                        <div className="rounded-md border border-slate-200 bg-white p-3">
                                            <p className="text-sm font-semibold text-slate-700">
                                                Equipment Mapping
                                            </p>
                                            <EquipmentCatalogPicker
                                                value={newTaskEquipmentMapping}
                                                onChange={setNewTaskEquipmentMapping}
                                                className="mt-3"
                                            />
                                        </div>
                                    )}

                                    <label className="flex items-center gap-2 text-sm text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={newTask.customerApproval}
                                            onChange={(e) =>
                                                handleTaskFieldChange("customerApproval", e.target.checked)
                                            }
                                        />
                                        Customer approved
                                    </label>

                                    {!!serviceStop.recurringServiceStopId && can("244") && (
                                        <label className="flex items-center gap-2 text-sm text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={newTask.addToRecurringServiceStop}
                                                onChange={(e) =>
                                                    handleTaskFieldChange(
                                                        "addToRecurringServiceStop",
                                                        e.target.checked
                                                    )
                                                }
                                            />
                                            Also add to recurring service stop
                                        </label>
                                    )}

                                    <div className="flex items-center gap-2 pt-2">
                                        <button
                                            type="submit"
                                            disabled={savingTask}
                                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            {savingTask ? "Saving..." : "Save Task"}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowAddTask(false);
                                                resetTaskForm();
                                            }}
                                            className="rounded-md bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-300"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            )}

                            {taskList.length > 0 ? (
                                <div className="space-y-4">
                                    {taskList.map((task) => (
                                        <div
                                            key={task.id}
                                            className="rounded-lg border border-slate-200 p-4 transition hover:bg-slate-50"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="font-semibold text-slate-900">
                                                        {task.name || "Unnamed Task"}
                                                    </p>
                                                    <p className="text-sm text-slate-500 mt-1">
                                                        {task.type || "—"}
                                                    </p>
                                                </div>

                                                <span
                                                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                                                        task.status
                                                    )}`}
                                                >
                                                    {task.status || "—"}
                                                </span>
                                            </div>

                                            {editEnabled && task.status !== "Finished" && can("244") && (
                                                <div className="mt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => markTaskFinished(task)}
                                                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                                                    >
                                                        Mark Finished
                                                    </button>
                                                </div>
                                            )}

                                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                <div className="rounded-lg bg-slate-50 px-3 py-2">
                                                    <p className="text-slate-500">Contracted Rate</p>
                                                    <p className="font-medium text-slate-800">
                                                        {formatCurrencyFromCents(task.contractedRate)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-slate-50 px-3 py-2">
                                                    <p className="text-slate-500">Estimated Time</p>
                                                    <p className="font-medium text-slate-800">
                                                        {formatMinutes(task.estimatedTime)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-slate-50 px-3 py-2">
                                                    <p className="text-slate-500">Actual Time</p>
                                                    <p className="font-medium text-slate-800">
                                                        {formatMinutes(task.actualTime)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-slate-50 px-3 py-2">
                                                    <p className="text-slate-500">Customer Approval</p>
                                                    <p className="font-medium text-slate-800">
                                                        {yesNo(task.customerApproval)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-slate-50 px-3 py-2">
                                                    <p className="text-slate-500">Worker</p>
                                                    <p className="font-medium text-slate-800">
                                                        {task.workerName || "—"}
                                                    </p>
                                                    {task.workerType && (
                                                        <p className="text-xs text-slate-500 mt-1">{task.workerType}</p>
                                                    )}
                                                </div>

                                                <div className="rounded-lg bg-slate-50 px-3 py-2">
                                                    <p className="text-slate-500">Worker ID</p>
                                                    <p className="font-medium text-slate-800 break-all">
                                                        {task.workerId || "—"}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500">
                                    No tasks for this service stop.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <PartApprovalCreateModal
                open={showPartApprovalModal}
                onClose={() => setShowPartApprovalModal(false)}
                fixedCustomer={partApprovalCustomer}
                fixedServiceLocation={partApprovalServiceLocation}
                workflowContext={{
                    serviceStopId,
                    serviceStopInternalId: serviceStop.internalId || "",
                    serviceDate: serviceStop.serviceDate || null,
                    scheduledDate: serviceStop.serviceDate || null,
                    techId: serviceStop.techId || "",
                    techName: serviceStop.tech || "",
                    jobId: serviceStop.jobId || "",
                    jobName: serviceStop.jobName || serviceStop.jobInternalId || "",
                    jobInternalId: serviceStop.jobInternalId || "",
                    serviceLocationAddress: serviceStopAddressText,
                }}
                hideCost
                allowInPersonApproval
                onCreated={loadPartWorkflow}
            />
            <ConnectAgreementModal
                agreements={serviceAgreements}
                connectedAgreementId={connectedServiceAgreement?.id || ""}
                connectingAgreementId={connectingAgreementId}
                isOpen={showConnectAgreementModal}
                loading={loadingServiceAgreements}
                onClose={() => setShowConnectAgreementModal(false)}
                onConnect={handleConnectAgreement}
                serviceStop={serviceStop}
            />
            {editEnabled && (can("244") || can("246")) && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="service-stop-admin-edit-title"
                        className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <h3 id="service-stop-admin-edit-title" className="text-xl font-bold text-slate-900">
                                    Admin Edit
                                </h3>
                                <p className="mt-1 text-sm text-slate-600">
                                    Scheduling, technician, description, and completion controls
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => toggleEditEnabled(false)}
                                disabled={savingEdit}
                                aria-label="Close admin edit"
                                title="Close admin edit"
                                className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-5 py-5">
                            {can("244") && (
                                <form onSubmit={saveServiceStopEdits} className="space-y-4">
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-sm font-semibold text-slate-600">
                                                Scheduled Date
                                            </label>
                                            <input
                                                type="date"
                                                value={editForm.serviceDate}
                                                onChange={(event) => handleEditFieldChange("serviceDate", event.target.value)}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2"
                                            />
                                        </div>

                                        <div>
                                            <label className="mb-1 block text-sm font-semibold text-slate-600">
                                                Technician
                                            </label>
                                            <select
                                                value={editForm.techId}
                                                onChange={(event) => handleEditFieldChange("techId", event.target.value)}
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                                            >
                                                <option value="">Select technician</option>
                                                {companyUsers.map((user) => (
                                                    <option key={user.id} value={user.userId}>
                                                        {user.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <label className="block">
                                        <span className="mb-1 block text-sm font-semibold text-slate-600">
                                            Description
                                        </span>
                                        <textarea
                                            value={editForm.description}
                                            onChange={(event) => handleEditFieldChange("description", event.target.value)}
                                            rows={4}
                                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                            placeholder="Service stop description"
                                        />
                                    </label>

                                    <div className="flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={savingEdit}
                                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {savingEdit ? "Saving..." : "Save Changes"}
                                        </button>
                                    </div>
                                </form>
                            )}

                            <div className={`${can("244") ? "mt-5 border-t border-slate-200 pt-5" : ""} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
                                {can("244") && (
                                    <button
                                        type="button"
                                        onClick={openManualFinishConfirm}
                                        disabled={finishingStop || (isServiceStopFinished(serviceStop) && isFinishedStatus(serviceStop.operationStatus))}
                                        className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {finishingStop ? "Finishing..." : "Finish Service Stop Manually"}
                                    </button>
                                )}

                                {can("246") && (
                                    <button
                                        type="button"
                                        onClick={() => setShowDeleteConfirm(true)}
                                        disabled={serviceStopDeleteLocked}
                                        title={serviceStopDeleteLocked ? "Finished service stops cannot be deleted." : "Delete service stop"}
                                        className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Delete Service Stop
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showFinishConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-2xl">
                        <h2 className="text-xl font-bold text-slate-950">Finish Service Stop</h2>
                        <p className="mt-2 text-sm text-slate-600">
                            Choose which unfinished tasks should also be marked finished. Any unchecked task will stay unfinished after the stop is finished.
                        </p>

                        {unfinishedManualFinishTasks.length > 0 ? (
                            <div className="mt-4 rounded-lg border border-slate-200">
                                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                                        <input
                                            type="checkbox"
                                            checked={selectedManualFinishTaskCount === unfinishedManualFinishTasks.length}
                                            onChange={(event) => setAllManualFinishTasks(event.target.checked)}
                                            disabled={finishingStop}
                                            className="h-4 w-4 rounded border-slate-300"
                                        />
                                        Mark all unfinished tasks finished
                                    </label>
                                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                                        {selectedManualFinishTaskCount}/{unfinishedManualFinishTasks.length} selected
                                    </span>
                                </div>

                                <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                                    {unfinishedManualFinishTasks.map((task) => {
                                        const checked = manualFinishTaskIds.includes(task.id);

                                        return (
                                            <label
                                                key={task.id}
                                                className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => toggleManualFinishTask(task.id)}
                                                    disabled={finishingStop}
                                                    className="mt-1 h-4 w-4 rounded border-slate-300"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block font-semibold text-slate-900">
                                                        {task.name || "Unnamed Task"}
                                                    </span>
                                                    <span className="mt-1 block text-sm text-slate-500">
                                                        {[task.type, task.status].filter(Boolean).join(" • ") || "Task"}
                                                    </span>
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                                All tasks are already finished. This will only finish the service stop.
                            </div>
                        )}

                        {unfinishedManualFinishTasks.length > selectedManualFinishTaskCount && (
                            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                {unfinishedManualFinishTasks.length - selectedManualFinishTaskCount} task(s) will remain unfinished.
                            </div>
                        )}

                        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={closeManualFinishConfirm}
                                disabled={finishingStop}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={finishServiceStopManually}
                                disabled={finishingStop}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {finishingStop ? "Finishing..." : "Finish Stop"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
                        <h3 className="text-xl font-bold text-slate-900">Delete Service Stop</h3>
                        <p className="mt-3 text-sm text-slate-600">
                            {serviceStopDeleteLocked
                                ? "Finished service stops cannot be deleted."
                                : "This will delete this service stop and its tasks/readings history. This cannot be undone."}
                        </p>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={deleting}
                                className="rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteServiceStop}
                                disabled={deleting || serviceStopDeleteLocked}
                                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                                {deleting ? "Deleting..." : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ServiceStopDetails;
