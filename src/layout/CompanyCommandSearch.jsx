import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import {
    FiArrowUpRight,
    FiBriefcase,
    FiClock,
    FiCreditCard,
    FiDollarSign,
    FiFileText,
    FiLoader,
    FiMapPin,
    FiPackage,
    FiSearch,
    FiShoppingCart,
    FiTool,
    FiUser,
} from "react-icons/fi";
import { Context } from "../context/AuthContext";
import { db } from "../utils/config";
import { allNav } from "../navigation/allNav";
import { salesCollectionNames } from "../utils/models/Sales";

const RESULT_LIMIT = 9;
const RECENT_DOC_LIMIT = 8;
const SEARCH_DOC_LIMIT = 14;
const EXACT_ID_MIN_LENGTH = 5;
const WORK_TREE_SECTIONS = [
    {
        key: "operations",
        title: "Operations",
        helper: "Customers, jobs, repairs, equipment, and routes.",
        categories: ["Operations", "Routing"],
    },
    {
        key: "sales",
        title: "Sales",
        helper: "Leads, estimates, agreements, and the sales board.",
        titles: ["Sales Dashboard", "Estimates", "Service Agreements", "Leads", "Public Page"],
    },
    {
        key: "finance",
        title: "Finance",
        helper: "Invoices, payments, subscriptions, and payroll.",
        titles: ["Invoices", "Payment History", "Billing Subscriptions", "Payroll"],
    },
    {
        key: "management",
        title: "Management",
        helper: "People, work logs, todo items, and migration tools.",
        categories: ["Users", "Migration"],
        titles: ["Todo List", "Messages"],
    },
    {
        key: "settings",
        title: "Company Settings",
        helper: "Company setup, preferences, and configuration.",
        categories: ["Settings"],
        titles: ["Setup Guide"],
    },
];

const compact = (values) => values.map((value) => String(value || "").trim()).filter(Boolean);

const normalize = (value) => String(value || "").toLowerCase().trim();

const searchTermsFor = (value) => normalize(value).split(/\s+/).filter(Boolean);

const fullAddress = (address = {}) => (
    compact([address.streetAddress, address.city, address.state, address.zip]).join(", ")
);

const customerName = (data = {}, fallback = "") => {
    if (data.displayAsCompany) return data.company || data.companyName || fallback;
    return compact([data.firstName, data.lastName]).join(" ") || data.company || data.companyName || fallback;
};

const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.toMillis === "function") return new Date(value.toMillis());
    if (typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
};

const newestDate = (data, fields = []) => {
    const dates = fields.map((field) => toDate(data?.[field])).filter(Boolean);
    if (!dates.length) return null;
    return new Date(Math.max(...dates.map((date) => date.getTime())));
};

const formatDate = (date) => {
    if (!date) return "";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
};

const getPathValues = (value, parts) => {
    if (value == null) return [];
    if (parts.length === 0) return [value];
    if (Array.isArray(value)) {
        return value.flatMap((item) => getPathValues(item, parts));
    }
    if (typeof value !== "object") return [];
    const [nextPart, ...remainingParts] = parts;
    return getPathValues(value[nextPart], remainingParts);
};

const flattenValue = (value, depth = 0) => {
    if (value == null) return [];
    if (typeof value?.toDate === "function" || typeof value?.toMillis === "function") {
        return compact([formatDate(toDate(value))]);
    }
    if (["string", "number", "boolean"].includes(typeof value)) return [String(value)];
    if (Array.isArray(value)) return value.flatMap((item) => flattenValue(item, depth + 1));
    if (typeof value === "object" && depth < 2) {
        return Object.values(value).flatMap((item) => flattenValue(item, depth + 1));
    }
    return [];
};

const textFromFields = (data, fields = []) => (
    fields
        .flatMap((field) => getPathValues(data, field.split(".")))
        .flatMap((value) => flattenValue(value))
        .join(" ")
);

const hasEveryTerm = (text, terms) => {
    const normalizedText = normalize(text);
    return terms.every((term) => normalizedText.includes(term));
};

const featureTextFor = (source) => compact([source.label, ...(source.keywords || [])]).join(" ");

const recordMatchesTerms = (source, record, terms) => {
    if (!terms.length) return true;
    if (hasEveryTerm(featureTextFor(source), terms)) return true;

    const recordText = compact([
        record.id,
        record.title,
        record.subtitle,
        source.label,
        textFromFields(record.data, source.searchFields),
    ]).join(" ");

    return hasEveryTerm(recordText, terms);
};

const resultScore = (result, terms) => {
    if (!terms.length) return result.date ? result.date.getTime() : 0;
    const title = normalize(result.title);
    const id = normalize(result.id);
    const text = normalize(`${result.title} ${result.subtitle} ${result.id}`);
    const exactBoost = terms.some((term) => id === term || title === term) ? 10000000000000 : 0;
    const prefixBoost = terms.some((term) => id.startsWith(term) || title.startsWith(term)) ? 5000000000000 : 0;
    const matchBoost = terms.filter((term) => text.includes(term)).length * 1000000000;
    return exactBoost + prefixBoost + matchBoost + (result.date ? result.date.getTime() : 0);
};

const companyCollection = (collectionName) => ({
    scope: "company",
    collectionName,
});

const rootCollection = (collectionName, companyField = "companyId") => ({
    scope: "root",
    collectionName,
    companyField,
});

const searchSources = [
    {
        key: "customers",
        label: "Customer",
        icon: FiUser,
        ...companyCollection("customers"),
        keywords: ["customers", "client", "homeowner", "account"],
        dateFields: ["updatedAt", "createdAt", "dateCreated", "hireDate"],
        searchFields: ["firstName", "lastName", "company", "companyName", "email", "phoneNumber", "billingNotes", "label", "tags"],
        title: (data, id) => customerName(data, id),
        subtitle: (data) => compact([data.email, data.phoneNumber, data.active === false ? "Inactive" : "Active"]).join(" | "),
        path: (_data, id) => `/company/customers/details/${id}`,
    },
    {
        key: "serviceLocations",
        label: "Service Location",
        icon: FiMapPin,
        ...companyCollection("serviceLocations"),
        keywords: ["location", "locations", "address", "service"],
        dateFields: ["updatedAt", "createdAt", "dateCreated"],
        searchFields: ["nickName", "customerName", "address.streetAddress", "address.city", "address.state", "address.zip", "mainContact.name", "mainContact.email", "mainContact.phoneNumber", "gateCode", "dogName", "notes", "label"],
        title: (data, id) => data.nickName || fullAddress(data.address) || data.customerName || id,
        subtitle: (data) => compact([data.customerName, fullAddress(data.address)]).join(" | "),
        path: (_data, id) => `/company/serviceLocations/detail/${id}`,
    },
    {
        key: "bodiesOfWater",
        label: "Pool",
        icon: FiPackage,
        ...companyCollection("bodiesOfWater"),
        keywords: ["pool", "pools", "body of water", "spa"],
        dateFields: ["updatedAt", "createdAt", "dateCreated", "lastService", "nextService"],
        searchFields: ["name", "bodyOfWaterName", "poolName", "nickName", "customerName", "type", "make", "model", "status", "notes"],
        title: (data, id) => data.name || data.bodyOfWaterName || data.poolName || data.nickName || data.type || id,
        subtitle: (data) => compact([data.customerName, data.type, data.status]).join(" | "),
        path: (_data, id) => `/company/bodiesOfWater/detail/${id}`,
    },
    {
        key: "workOrders",
        label: "Job",
        icon: FiBriefcase,
        ...companyCollection("workOrders"),
        keywords: ["job", "jobs", "work order", "work orders", "estimate"],
        dateFields: ["updatedAt", "dateCreated", "createdAt", "invoiceDate", "completedAt"],
        searchFields: ["internalId", "type", "description", "operationStatus", "billingStatus", "customerName", "adminName", "invoiceType", "invoiceNotes"],
        title: (data, id) => data.internalId || data.type || data.description || id,
        subtitle: (data) => compact([data.customerName, data.operationStatus, data.billingStatus]).join(" | "),
        path: (_data, id) => `/company/jobs/detail/${id}`,
    },
    {
        key: "equipment",
        label: "Equipment",
        icon: FiTool,
        ...companyCollection("equipment"),
        keywords: ["equipment", "asset", "assets", "maintenance", "repair"],
        dateFields: ["updatedAt", "createdAt", "dateCreated", "nextServiceDate"],
        searchFields: ["internalId", "name", "type", "make", "model", "status", "customerName", "serviceLocationName", "serialNumber", "notes"],
        title: (data, id) => compact([data.make, data.model]).join(" ") || data.name || data.type || id,
        subtitle: (data) => compact([data.customerName, data.type, data.status]).join(" | "),
        path: (_data, id) => `/company/equipment/detail/${id}`,
    },
    {
        key: "repairRequests",
        label: "Repair Request",
        icon: FiTool,
        ...companyCollection("repairRequests"),
        keywords: ["repair", "repairs", "request", "requests", "service issue"],
        dateFields: ["updatedAt", "dateCreated", "createdAt", "date"],
        searchFields: ["description", "status", "customerName", "requesterName", "userName", "equipmentName"],
        title: (data, id) => data.description || data.customerName || id,
        subtitle: (data) => compact([data.customerName, data.status, data.requesterName]).join(" | "),
        path: (_data, id) => `/company/repair-requests/detail/${id}`,
    },
    {
        key: "shoppingList",
        label: "Shopping Item",
        icon: FiShoppingCart,
        ...companyCollection("shoppingList"),
        keywords: ["shopping", "shopping list", "parts", "part approval"],
        dateFields: ["updatedAt", "dateCreated", "createdAt", "date"],
        searchFields: ["name", "itemName", "title", "description", "status", "customerName", "dbItemName", "jobId"],
        title: (data, id) => data.name || data.itemName || data.title || data.description || id,
        subtitle: (data) => compact([data.customerName, data.status, data.jobId]).join(" | "),
        path: (_data, id) => `/company/shopping-list/detail/${id}`,
    },
    {
        key: "legacyShoppingList",
        label: "Shopping Item",
        icon: FiShoppingCart,
        ...companyCollection("shoppingListItems"),
        keywords: ["shopping", "shopping list", "parts", "part approval"],
        dateFields: ["updatedAt", "dateCreated", "createdAt", "date"],
        searchFields: ["name", "itemName", "title", "description", "status", "customerName", "dbItemName", "jobId"],
        title: (data, id) => data.name || data.itemName || data.title || data.description || id,
        subtitle: (data) => compact([data.customerName, data.status, data.jobId]).join(" | "),
        path: (_data, id) => `/company/shopping-list/detail/${id}`,
    },
    {
        key: "purchasedItems",
        label: "Purchased Item",
        icon: FiDollarSign,
        ...companyCollection("purchasedItems"),
        keywords: ["purchase", "purchases", "receipt", "receipts", "cost", "expense"],
        dateFields: ["updatedAt", "createdAt", "dateCreated", "date", "datePurchased"],
        searchFields: ["name", "itemName", "description", "vendorName", "customerName", "jobId", "invoiceId", "receiptId"],
        title: (data, id) => data.name || data.itemName || data.description || data.vendorName || id,
        subtitle: (data) => compact([data.vendorName, data.customerName, data.jobId]).join(" | "),
        path: (_data, id) => `/company/purchased-items/detail/${id}`,
    },
    {
        key: "leads",
        label: "Lead",
        icon: FiUser,
        ...rootCollection("homeownerServiceRequests"),
        keywords: ["lead", "leads", "marketing", "estimate"],
        dateFields: ["updatedAt", "createdAt", "dateCreated", "submittedAt"],
        searchFields: ["customerName", "name", "firstName", "lastName", "email", "phoneNumber", "status", "address.streetAddress", "address.city", "description"],
        title: (data, id) => data.customerName || data.name || customerName(data, id),
        subtitle: (data) => compact([data.status, data.email, data.phoneNumber]).join(" | "),
        path: (_data, id) => `/company/leads/${id}`,
    },
    {
        key: "salesInvoices",
        label: "Invoice",
        icon: FiFileText,
        ...rootCollection(salesCollectionNames.invoices),
        keywords: ["invoice", "invoices", "billing", "sales"],
        dateFields: ["updatedAt", "createdAt", "invoiceDate", "dueDate"],
        searchFields: ["invoiceNumber", "customerName", "email", "status", "invoiceType", "description"],
        title: (data, id) => data.invoiceNumber || data.title || id,
        subtitle: (data) => compact([data.customerName, data.status, data.invoiceType]).join(" | "),
        path: (_data, id) => `/company/sales/invoices/${id}`,
    },
    {
        key: "salesAgreements",
        label: "Agreement",
        icon: FiFileText,
        ...rootCollection(salesCollectionNames.agreements),
        keywords: ["agreement", "agreements", "contract", "contracts", "sales"],
        dateFields: ["updatedAt", "createdAt", "sentAt", "acceptedAt"],
        searchFields: ["title", "customerName", "email", "status", "sourceType", "description"],
        title: (data, id) => data.title || data.customerName || id,
        subtitle: (data) => compact([data.customerName, data.status, data.sourceType]).join(" | "),
        path: (_data, id) => `/company/sales/agreements/${id}`,
    },
    {
        key: "salesSubscriptions",
        label: "Billing Subscription",
        icon: FiCreditCard,
        ...rootCollection(salesCollectionNames.billingSubscriptions),
        keywords: ["subscription", "subscriptions", "billing", "recurring"],
        dateFields: ["updatedAt", "createdAt", "currentPeriodStart"],
        searchFields: ["customerName", "email", "status", "interval", "description"],
        title: (data, id) => data.customerName || data.description || id,
        subtitle: (data) => compact([data.status, data.interval]).join(" | "),
        path: (_data, id) => `/company/sales/subscriptions/${id}`,
    },
];

const collectionReferenceFor = (source, companyId) => {
    if (source.scope === "company") {
        return collection(db, "companies", companyId, source.collectionName);
    }

    return collection(db, source.collectionName);
};

const docReferenceFor = (source, companyId, recordId) => {
    if (source.scope === "company") {
        return doc(db, "companies", companyId, source.collectionName, recordId);
    }

    return doc(db, source.collectionName, recordId);
};

const companyConstraintsFor = (source, companyId) => (
    source.scope === "root" && source.companyField
        ? [where(source.companyField, "==", companyId)]
        : []
);

const snapshotToResult = (source, snapshot) => {
    const data = snapshot.data();
    const id = snapshot.id;
    const date = newestDate(data, source.dateFields);
    const title = source.title(data, id);
    const subtitleParts = compact([
        source.subtitle(data, id),
        date ? `Updated ${formatDate(date)}` : "",
    ]);
    const Icon = source.icon;

    return {
        key: `${source.key}-${id}`,
        id,
        kind: "record",
        source,
        icon: <Icon className="h-4 w-4" />,
        eyebrow: source.label,
        title,
        subtitle: subtitleParts.join(" | "),
        path: source.path(data, id),
        data,
        date,
    };
};

const fetchSourceResults = async ({ source, companyId, terms, maxDocs }) => {
    const collectionRef = collectionReferenceFor(source, companyId);
    const baseConstraints = companyConstraintsFor(source, companyId);
    const docsById = new Map();
    const fieldsToTry = source.dateFields?.length ? source.dateFields : [];

    for (const dateField of fieldsToTry) {
        try {
            const snapshot = await getDocs(
                query(collectionRef, ...baseConstraints, orderBy(dateField, "desc"), limit(maxDocs))
            );

            snapshot.docs.forEach((snapshotDoc) => docsById.set(snapshotDoc.id, snapshotDoc));
            if (docsById.size >= maxDocs) break;
        } catch (error) {
            // Some older collections may not have a sortable date field or index yet.
        }
    }

    if (docsById.size === 0) {
        try {
            const snapshot = await getDocs(query(collectionRef, ...baseConstraints, limit(maxDocs)));
            snapshot.docs.forEach((snapshotDoc) => docsById.set(snapshotDoc.id, snapshotDoc));
        } catch (error) {
            return [];
        }
    }

    return Array.from(docsById.values())
        .map((snapshotDoc) => snapshotToResult(source, snapshotDoc))
        .filter((result) => recordMatchesTerms(source, result, terms));
};

const fetchExactIdResults = async ({ companyId, rawTerm }) => {
    const recordId = rawTerm.trim();
    if (recordId.length < EXACT_ID_MIN_LENGTH) return [];

    const exactMatches = await Promise.all(
        searchSources.map(async (source) => {
            try {
                const snapshot = await getDoc(docReferenceFor(source, companyId, recordId));
                if (!snapshot.exists()) return null;

                const data = snapshot.data();
                if (source.scope === "root" && source.companyField && data[source.companyField] !== companyId) {
                    return null;
                }

                return snapshotToResult(source, snapshot);
            } catch (error) {
                return null;
            }
        })
    );

    return exactMatches.filter(Boolean);
};

const canShowNavItem = ({ item, companyRoleLoading, hasCompanyPermission, featureFlagsLoaded, isFeatureEnabled }) => {
    const permissionAllowed = !item.permissionId || companyRoleLoading || hasCompanyPermission(item.permissionId);
    const featureFlagIds = [
        item.featureFlagId,
        ...(Array.isArray(item.featureFlagIds) ? item.featureFlagIds : []),
    ].filter(Boolean);
    const flagsAllowed = featureFlagIds.length === 0 || (featureFlagsLoaded && featureFlagIds.every((id) => isFeatureEnabled(id)));

    return permissionAllowed && flagsAllowed;
};

const navResultForItem = (item) => ({
    key: `nav-${item.path}`,
    id: item.path,
    kind: "page",
    icon: item.icon,
    eyebrow: item.category === "NA" ? "Page" : item.category,
    title: item.title,
    subtitle: "Open page",
    path: item.path,
});

export default function CompanyCommandSearch() {
    const {
        recentlySelectedCompany,
        companyRoleLoading,
        hasCompanyPermission,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const navigate = useNavigate();
    const rootRef = useRef(null);
    const inputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [recordResults, setRecordResults] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const terms = useMemo(() => searchTermsFor(searchTerm), [searchTerm]);

    const companyNavItems = useMemo(() => (
        allNav
            .filter((item) => item.role === "Company")
            .filter((item) => canShowNavItem({
                item,
                companyRoleLoading,
                hasCompanyPermission,
                featureFlagsLoaded,
                isFeatureEnabled,
            }))
    ), [companyRoleLoading, featureFlagsLoaded, hasCompanyPermission, isFeatureEnabled]);

    const workTreeSections = useMemo(() => {
        const usedPaths = new Set();

        return WORK_TREE_SECTIONS.map((section) => {
            const categorySet = new Set(section.categories || []);
            const titleSet = new Set(section.titles || []);
            const items = companyNavItems
                .filter((item) => !usedPaths.has(item.path))
                .filter((item) => categorySet.has(item.category) || titleSet.has(item.title))
                .map((item) => {
                    usedPaths.add(item.path);
                    return navResultForItem(item);
                });

            return {
                ...section,
                items,
            };
        });
    }, [companyNavItems]);

    const navResults = useMemo(() => {
        if (!terms.length) return [];

        return companyNavItems
            .filter((item) => {
                return hasEveryTerm(`${item.title} ${item.category} ${item.path}`, terms);
            })
            .slice(0, 6)
            .map(navResultForItem);
    }, [companyNavItems, terms]);

    useEffect(() => {
        const handleClickAway = (event) => {
            if (!rootRef.current?.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickAway);
        return () => document.removeEventListener("mousedown", handleClickAway);
    }, []);

    useEffect(() => {
        if (!recentlySelectedCompany || !isOpen) {
            setRecordResults([]);
            setIsLoading(false);
            return undefined;
        }

        let isCurrent = true;
        const timeout = setTimeout(async () => {
            setIsLoading(true);

            try {
                const maxDocs = terms.length ? SEARCH_DOC_LIMIT : RECENT_DOC_LIMIT;
                const [sourceResults, exactMatches] = await Promise.all([
                    Promise.all(
                        searchSources.map((source) => fetchSourceResults({
                            source,
                            companyId: recentlySelectedCompany,
                            terms,
                            maxDocs,
                        }))
                    ),
                    fetchExactIdResults({ companyId: recentlySelectedCompany, rawTerm: searchTerm }),
                ]);

                if (!isCurrent) return;

                const merged = new Map();
                [...exactMatches, ...sourceResults.flat()].forEach((result) => {
                    merged.set(result.key, result);
                });

                const sorted = Array.from(merged.values())
                    .sort((a, b) => resultScore(b, terms) - resultScore(a, terms))
                    .slice(0, terms.length ? RESULT_LIMIT : 6);

                setRecordResults(sorted);
            } catch (error) {
                if (isCurrent) setRecordResults([]);
            } finally {
                if (isCurrent) setIsLoading(false);
            }
        }, terms.length ? 250 : 120);

        return () => {
            isCurrent = false;
            clearTimeout(timeout);
        };
    }, [isOpen, recentlySelectedCompany, searchTerm, terms]);

    const results = useMemo(() => (
        [...navResults, ...recordResults].slice(0, RESULT_LIMIT)
    ), [navResults, recordResults]);

    useEffect(() => {
        setActiveIndex(0);
    }, [searchTerm, results.length]);

    const openResult = (result) => {
        if (!result?.path) return;
        navigate(result.path);
        setIsOpen(false);
        setSearchTerm("");
        inputRef.current?.blur();
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (results[activeIndex]) openResult(results[activeIndex]);
    };

    const handleKeyDown = (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => (results.length ? (current + 1) % results.length : 0));
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
        }

        if (event.key === "Escape") {
            setIsOpen(false);
            inputRef.current?.blur();
        }
    };

    if (!recentlySelectedCompany) return null;

    return (
        <div ref={rootRef} className="relative w-full max-w-[520px]">
            <form onSubmit={handleSubmit} className="relative">
                <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                <input
                    ref={inputRef}
                    className="company-command-search-input h-10 w-full rounded-md border py-2 pl-9 pr-10 text-sm outline-none"
                    type="search"
                    value={searchTerm}
                    onChange={(event) => {
                        setSearchTerm(event.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search company..."
                    autoComplete="off"
                />
                {isLoading ? (
                    <FiLoader className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-300" />
                ) : (
                    <FiClock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                )}
            </form>

            {isOpen && (
                <div className="absolute left-0 top-full mt-2 w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
                    {!terms.length && workTreeSections.length > 0 ? (
                        <div className="max-h-[560px] overflow-y-auto">
                            <div className="border-b border-slate-200 px-4 py-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Work Tree</p>
                                <p className="mt-1 text-sm font-semibold text-slate-950">Jump to the rest of the company workspace</p>
                            </div>
                            <div className="space-y-4 p-3">
                                {workTreeSections.map((section) => (
                                    <section key={section.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                        <div className="mb-2">
                                            <p className="text-sm font-bold text-slate-950">{section.title}</p>
                                            <p className="mt-0.5 text-xs text-slate-500">{section.helper}</p>
                                        </div>
                                        {section.items.length > 0 ? (
                                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                                {section.items.map((result) => (
                                                    <button
                                                        key={result.key}
                                                        type="button"
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => openResult(result)}
                                                        className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50"
                                                    >
                                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white [&>svg]:h-4 [&>svg]:w-4">
                                                            {result.icon}
                                                        </span>
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-sm font-semibold text-slate-900">{result.title}</span>
                                                            <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{result.eyebrow}</span>
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                                                No available pages in this section for the current account.
                                            </p>
                                        )}
                                    </section>
                                ))}

                                {(recordResults.length > 0 || isLoading) && (
                                    <section className="rounded-lg border border-slate-200 bg-white">
                                        <div className="border-b border-slate-100 px-3 py-2">
                                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent Records</p>
                                        </div>
                                        {isLoading ? (
                                            <div className="px-3 py-4 text-sm text-slate-500">Loading recent company records...</div>
                                        ) : (
                                            <ul className="divide-y divide-slate-100">
                                                {recordResults.slice(0, 4).map((result) => (
                                                    <li key={result.key}>
                                                        <button
                                                            type="button"
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onClick={() => openResult(result)}
                                                            className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-50"
                                                        >
                                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                                                                {result.icon}
                                                            </span>
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-sm font-semibold text-slate-900">{result.title}</span>
                                                                {result.subtitle && <span className="block truncate text-xs text-slate-500">{result.subtitle}</span>}
                                                            </span>
                                                            <FiArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </section>
                                )}
                            </div>
                        </div>
                    ) : results.length > 0 ? (
                        <ul className="max-h-[420px] overflow-y-auto py-2">
                            {results.map((result, index) => (
                                <li key={result.key}>
                                    <button
                                        type="button"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => openResult(result)}
                                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${index === activeIndex ? "bg-blue-50" : "hover:bg-slate-50"}`}
                                    >
                                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${result.kind === "page" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
                                            {result.icon}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                                {result.eyebrow}
                                            </span>
                                            <span className="block truncate text-sm font-semibold text-slate-900">
                                                {result.title}
                                            </span>
                                            {result.subtitle && (
                                                <span className="block truncate text-xs text-slate-500">
                                                    {result.subtitle}
                                                </span>
                                            )}
                                        </span>
                                        <FiArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="px-4 py-5 text-sm text-slate-500">
                            {isLoading ? "Searching company records..." : "No matching company records yet."}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
