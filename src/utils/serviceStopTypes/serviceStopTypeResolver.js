export const SERVICE_STOP_TYPE_USE_CASES = {
    jobVisit: "jobVisit",
    jobEstimate: "jobEstimate",
    serviceAgreementEstimate: "serviceAgreementEstimate",
    customerRelationship: "customerRelationship",
    recurringRoute: "recurringRoute",
    estimate: "jobEstimate",
    serviceEstimate: "serviceAgreementEstimate",
    startup: "serviceAgreementEstimate",
    unknown: "unknown",
};

const FALLBACKS = {
    jobVisit: {
        typeId: "system_job_service_stop",
        type: "Job Visit",
        typeImage: "briefcase",
        category: "Job",
    },
    jobEstimate: {
        typeId: "system_job_estimate_service_stop",
        type: "Job Estimate",
        typeImage: "doc.text.magnifyingglass",
        category: "Job Estimate",
    },
    serviceAgreementEstimate: {
        typeId: "system_service_agreement_estimate_service_stop",
        type: "Service Agreement Estimate",
        typeImage: "list.clipboard",
        category: "Service Agreement Estimate",
    },
    customerRelationship: {
        typeId: "system_customer_relationship_service_stop",
        type: "Customer Relationship",
        typeImage: "person.wave.2",
        category: "Customer Relationship",
    },
    recurringRoute: {
        typeId: "system_recurring_service_stop",
        type: "Recurring Service Stop",
        typeImage: "figure.pool.swim",
        category: "Route",
    },
    unknown: {
        typeId: "system_unknown_service_stop",
        type: "Unknown Service Stop",
        typeImage: "questionmark.circle",
        category: "Customer Relationship",
    },
};

const CANDIDATE_NAMES = {
    jobVisit: ["Job Visit", "Service Call", "Job"],
    jobEstimate: ["Job Estimate", "Estimate For Job", "Estimate", "Bid Visit"],
    serviceAgreementEstimate: ["Service Agreement Estimate", "Recurring Service Estimate", "New Service Estimate", "Service Estimate", "Startup", "Start Up", "New Pool"],
    customerRelationship: ["Customer Relationship", "Customer Visit", "Follow Up", "Courtesy Visit", "Mistake Fix"],
    recurringRoute: ["Weekly Route", "Residential Route", "Recurring Service Stop", "Standard Route", "Pool Route", "Route", "Routes"],
    unknown: [],
};

const normalize = (value) =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[/_-]/g, "")
        .replace(/&/g, "and");

export const normalizeServiceStopTypeBucket = normalize;

const isActiveType = (type) =>
    type &&
    type.isActive !== false &&
    type.active !== false &&
    type.status !== "Inactive";

const imageNameForType = (type) =>
    type?.imageName || type?.typeImage || type?.image || "";

const isCommercialTypeName = (value) => normalize(value).includes("commercial");

export const serviceStopTypeMatchesUseCase = (type = {}, useCase = SERVICE_STOP_TYPE_USE_CASES.unknown) => {
    const normalizedUseCase = FALLBACKS[useCase] ? useCase : SERVICE_STOP_TYPE_USE_CASES.unknown;
    const fallback = FALLBACKS[normalizedUseCase];
    if (!fallback || normalizedUseCase === SERVICE_STOP_TYPE_USE_CASES.unknown) return true;

    const acceptedValues = new Set([
        normalizedUseCase,
        fallback.category,
        fallback.typeId,
        ...(CANDIDATE_NAMES[normalizedUseCase] || []),
    ].map(normalize).filter(Boolean));

    if (normalizedUseCase === SERVICE_STOP_TYPE_USE_CASES.recurringRoute) {
        [
            "route",
            "routes",
            "recurringroute",
            "recurringroutes",
            "routebucket",
            "weeklyroute",
            "standardroute",
            "poolroute",
            "recurringservicestop",
        ].forEach((value) => acceptedValues.add(normalize(value)));
    }

    const typeValues = [
        type.category,
        type.serviceStopCategory,
        type.serviceStopTypeCategory,
        type.useCase,
        type.serviceStopTypeUseCase,
        type.serviceStopTypeUseCaseRawValue,
        type.typeUseCase,
        type.stopPayBucketId,
        type.serviceStopBucketId,
        type.stopPayBucketLabel,
        type.serviceStopBucketLabel,
        type.stopPayCategory,
        type.serviceStopBucket,
        type.bucketId,
        type.bucketLabel,
        type.sourceId,
        type.id,
        type.name,
    ].map(normalize).filter(Boolean);

    return typeValues.some((value) => acceptedValues.has(value));
};

const shouldSkipCandidateMatch = ({ type, candidateValue, useCase }) => {
    if (useCase !== SERVICE_STOP_TYPE_USE_CASES.recurringRoute) return false;
    if (candidateValue !== "route" && candidateValue !== "routes") return false;

    return isCommercialTypeName(type?.name);
};

export const suggestCompanyServiceStopType = (companyServiceStopTypes = [], useCase = SERVICE_STOP_TYPE_USE_CASES.unknown) => {
    const activeTypes = companyServiceStopTypes
        .filter(isActiveType)
        .sort((a, b) => {
            const aSort = Number(a.sortOrder || 0);
            const bSort = Number(b.sortOrder || 0);
            if (aSort !== bSort) return aSort - bSort;
            return String(a.name || "").localeCompare(String(b.name || ""));
        });

    const candidates = CANDIDATE_NAMES[useCase] || [];

    for (const candidate of candidates) {
        const match = activeTypes.find((type) => normalize(type.name) === normalize(candidate));
        if (match) return match;
    }

    for (const candidate of candidates) {
        const candidateValue = normalize(candidate);
        const match = activeTypes.find((type) => {
            const typeValue = normalize(type.name);
            if (shouldSkipCandidateMatch({ type, candidateValue, useCase })) return false;
            return typeValue.includes(candidateValue) || candidateValue.includes(typeValue);
        });
        if (match) return match;
    }

    return null;
};

export const resolveServiceStopTypeFields = ({
    companyServiceStopTypes = [],
    selectedType = null,
    selectedTypeId = "",
    fallbackName = "",
    fallbackImage = "",
    useCase = SERVICE_STOP_TYPE_USE_CASES.unknown,
    context = "unknown",
} = {}) => {
    const normalizedUseCase = FALLBACKS[useCase] ? useCase : SERVICE_STOP_TYPE_USE_CASES.unknown;
    const fallback = FALLBACKS[normalizedUseCase];
    const selectedId = selectedType?.id || selectedTypeId || "";
    const matchedType =
        (selectedId && companyServiceStopTypes.find((type) => type.id === selectedId)) ||
        selectedType ||
        suggestCompanyServiceStopType(companyServiceStopTypes, normalizedUseCase);

    if (matchedType?.id) {
        const fields = {
            typeId: matchedType.id,
            type: matchedType.name || fallbackName || fallback.type,
            typeImage: imageNameForType(matchedType) || fallbackImage || fallback.typeImage,
            serviceStopTypeUseCaseRawValue: normalizedUseCase,
            category: matchedType.category || fallback.category,
            defaultWorkTypeIds: Array.isArray(matchedType.defaultWorkTypeIds) ? matchedType.defaultWorkTypeIds : [],
            source: "companyServiceStopType",
        };

        if (!fields.defaultWorkTypeIds.length) {
            console.warn("[ServiceStopTypeResolver][noDefaultWorkTypes]", {
                context,
                useCase: normalizedUseCase,
                typeId: fields.typeId,
                type: fields.type,
            });
        }

        return fields;
    }

    const fields = {
        typeId: selectedId || fallback.typeId,
        type: fallbackName || selectedType?.name || fallback.type,
        typeImage: fallbackImage || imageNameForType(selectedType) || fallback.typeImage,
        serviceStopTypeUseCaseRawValue: normalizedUseCase,
        category: selectedType?.category || fallback.category,
        defaultWorkTypeIds: [],
        source: "systemFallback",
    };

    console.warn("[ServiceStopTypeResolver][fallback]", {
        context,
        useCase: normalizedUseCase,
        typeId: fields.typeId,
        type: fields.type,
    });

    return fields;
};

export const debugServiceStopTypeWrite = ({ context, payload }) => {
    console.log("[ServiceStopTypeWrite]", {
        context,
        id: payload?.id || "",
        typeId: payload?.typeId || "",
        type: payload?.type || "",
        typeImage: payload?.typeImage || "",
        serviceStopTypeUseCaseRawValue: payload?.serviceStopTypeUseCaseRawValue || "",
        jobId: payload?.jobId || "",
        recurringServiceStopId: payload?.recurringServiceStopId || "",
        serviceLocationId: payload?.serviceLocationId || "",
        techId: payload?.techId || "",
    });
};
