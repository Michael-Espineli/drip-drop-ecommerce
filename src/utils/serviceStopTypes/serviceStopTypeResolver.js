export const SERVICE_STOP_TYPE_USE_CASES = {
    jobVisit: "jobVisit",
    recurringRoute: "recurringRoute",
    estimate: "estimate",
    serviceEstimate: "serviceEstimate",
    unknown: "unknown",
};

const FALLBACKS = {
    jobVisit: {
        typeId: "system_job_service_stop",
        type: "Job Visit",
        typeImage: "briefcase",
    },
    recurringRoute: {
        typeId: "system_recurring_service_stop",
        type: "Recurring Service Stop",
        typeImage: "figure.pool.swim",
    },
    estimate: {
        typeId: "system_unknown_service_stop",
        type: "Estimate",
        typeImage: "doc.text.magnifyingglass",
    },
    serviceEstimate: {
        typeId: "system_service_estimate_stop",
        type: "Service Estimate",
        typeImage: "doc.text.magnifyingglass",
    },
    unknown: {
        typeId: "system_unknown_service_stop",
        type: "Unknown Service Stop",
        typeImage: "questionmark.circle",
    },
};

const CANDIDATE_NAMES = {
    jobVisit: ["Job Visit", "Service Call", "Job"],
    recurringRoute: ["Weekly Route", "Residential Route", "Recurring Service Stop", "Standard Route", "Pool Route", "Route", "Routes"],
    estimate: ["Estimate", "Initial Estimate Visit", "Pre Estimate Visit", "Service Estimate"],
    serviceEstimate: ["Service Estimate", "Estimate Visit", "Initial Estimate Visit", "Pre Estimate Visit", "Estimate"],
    unknown: [],
};

const normalize = (value) =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[/_-]/g, "")
        .replace(/&/g, "and");

const isActiveType = (type) =>
    type &&
    type.isActive !== false &&
    type.active !== false &&
    type.status !== "Inactive";

const imageNameForType = (type) =>
    type?.imageName || type?.typeImage || type?.image || "";

const isCommercialTypeName = (value) => normalize(value).includes("commercial");

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
