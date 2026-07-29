import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query, Timestamp, updateDoc } from "firebase/firestore";
import {
    ArrowsRightLeftIcon,
    EllipsisVerticalIcon,
    FunnelIcon,
    PencilSquareIcon,
    ShoppingCartIcon,
} from "@heroicons/react/24/outline";
import { db, storage } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import {
    getItemPhotoUrl,
    itemPhotoFieldsFromSource,
    itemPhotoFieldsFromUrl,
    uploadItemPhoto,
    validateItemPhotoFile,
} from "../../../utils/itemPhotos";
import {
    SHOPPING_LIST_INVOICED_STATUS,
    shoppingItemNeedsAction,
    syncLinkedShoppingPurchase,
} from "../../../utils/shoppingPurchaseSync";

const statusOptions = ["Need to Purchase", "Needs Customer Approval", "Ready to Purchase", "Customer Rejected", "Purchased", "Delivered", "Installed", SHOPPING_LIST_INVOICED_STATUS];
const recentActiveStatuses = ["Need to Purchase", "Needs Customer Approval", "Ready to Purchase", "Purchased"];
const defaultVisibleStatuses = recentActiveStatuses;
const recentShoppingItemLimit = 60;
const statusQuickFilters = [
    { label: "Pending Approval", statuses: ["Needs Customer Approval"], presetValue: "pendingApproval" },
    { label: "Approved", statuses: ["Ready to Purchase"], presetValue: "approved" },
    { label: "Purchased", statuses: ["Purchased"], presetValue: "purchased" },
    { label: "Delivered / Installed", statuses: ["Delivered", "Installed"], presetValue: "deliveredInstalled" },
    { label: "Invoiced", statuses: [SHOPPING_LIST_INVOICED_STATUS], presetValue: "invoiced" },
];
const categoryOptions = ["All", "Personal", "Customer", "Job"];
const sortOptions = [
    { value: "recentActivityDesc", label: "Recent Activity" },
    { value: "nameAsc", label: "Name A-Z" },
    { value: "nameDesc", label: "Name Z-A" },
    { value: "status", label: "Status" },
    { value: "category", label: "Category" },
    { value: "purchaser", label: "Purchaser" },
    { value: "datePurchasedDesc", label: "Purchased Date" },
];
const viewPresetOptions = [
    { value: "recentActive", label: "Recent Active", statuses: recentActiveStatuses, limit: recentShoppingItemLimit },
    { value: "allActive", label: "All Active", statuses: recentActiveStatuses },
    { value: "pendingApproval", label: "Pending Approval", statuses: ["Needs Customer Approval"] },
    { value: "approved", label: "Approved", statuses: ["Ready to Purchase"] },
    { value: "purchased", label: "Purchased", statuses: ["Purchased"] },
    { value: "deliveredInstalled", label: "Delivered / Installed", statuses: ["Delivered", "Installed"] },
    { value: "invoiced", label: "Invoiced", statuses: [SHOPPING_LIST_INVOICED_STATUS] },
    { value: "allStatuses", label: "All Statuses", statuses: statusOptions },
    { value: "custom", label: "Custom Filters", statuses: null },
];

const areStatusSetsEqual = (left = [], right = []) => (
    left.length === right.length && left.every((status) => right.includes(status))
);

const compactString = (value) => String(value || "").trim();

const timestampToDate = (value) => {
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    return null;
};

const dateToMillis = (value) => {
    const date = timestampToDate(value);
    if (date) return date.getTime();
    if (typeof value === "number") return value;
    return 0;
};

const buildPurchasedItemOption = (docSnap) => {
    const data = docSnap.data();
    const id = data.id || docSnap.id;
    const date = timestampToDate(data.date || data.datePurchased || data.createdAt);
    const dateLabel = date ? format(date, "MM/dd/yyyy") : "";
    const name = data.name || data.dbItemName || data.itemName || "Purchased Item";
    const techName = data.techName || data.userName || data.purchaserName || "";
    const label = [
        name,
        dateLabel,
        techName,
        data.invoiceNum ? `Invoice ${data.invoiceNum}` : "",
    ].filter(Boolean).join(" - ");

    return {
        ...data,
        id,
        value: id,
        name,
        date,
        dateLabel,
        techName,
        label,
        shoppingListItemId: data.shoppingListItemId || "",
    };
};

const customerDisplayName = (customer = {}) => {
    if (customer.displayAsCompany) {
        return (
            customer.company ||
            customer.companyName ||
            customer.businessName ||
            customer.displayName ||
            customer.customerName ||
            ""
        );
    }

    return (
        customer.customerName ||
        customer.displayName ||
        customer.name ||
        [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
        customer.company ||
        customer.companyName ||
        customer.email ||
        ""
    );
};

const userDisplayName = (user = {}) => (
    user.displayName ||
    user.userName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.name ||
    user.email ||
    ""
);

const jobDisplayName = (job = {}) => (
    job.internalId ||
    job.jobInternalId ||
    job.jobName ||
    job.title ||
    job.type ||
    job.description ||
    job.name ||
    ""
);

const formatAddress = (source = {}) => {
    if (!source) return "";
    if (typeof source === "string") return source;

    const address = source.address || source.serviceLocationAddress || source;
    if (typeof address === "string") return address;

    return [
        address.streetAddress || address.addressLine1 || source.streetAddress,
        [address.city || source.city, address.state || source.state].filter(Boolean).join(", "),
        address.zip || address.zipCode || source.zip || source.zipCode,
    ].filter(Boolean).join(" ");
};

const serviceLocationDisplayName = (location = {}) => (
    location.nickName ||
    location.nickname ||
    location.name ||
    location.displayName ||
    location.serviceLocationName ||
    formatAddress(location) ||
    ""
);

const compactIdFallback = (label, id) => (id ? `${label} ${String(id).slice(-6)}` : "");

const buildForPrimary = (item) => {
    if (item.category === "Personal") {
        return item.userName || item.purchaserName || compactIdFallback("User", item.userId);
    }

    if (item.customerName) return item.customerName;
    if (item.jobName) return item.jobName;
    if (item.customerId) return compactIdFallback("Customer", item.customerId);
    if (item.jobId) return compactIdFallback("Job", item.jobId);

    return "";
};

const buildContextLines = (item) => {
    const lines = [];

    if (item.jobName || item.jobId) {
        lines.push({
            label: "Job",
            value: item.jobName || compactIdFallback("Job", item.jobId),
        });
    }

    if (item.linkedTaskName || item.linkedTaskType) {
        lines.push({
            label: "Task",
            value: [item.linkedTaskName, item.linkedTaskType].filter(Boolean).join(" - "),
        });
    }

    if (item.serviceLocationName || item.serviceLocationAddress) {
        lines.push({
            label: "Location",
            value: item.serviceLocationName || item.serviceLocationAddress,
        });
    }

    if (item.category === "Customer" && item.customerId && !item.customerName) {
        lines.push({
            label: "Customer ID",
            value: item.customerId,
        });
    }

    if (item.category === "Personal" && item.userId && !item.userName) {
        lines.push({
            label: "User ID",
            value: item.userId,
        });
    }

    return lines;
};

const ShoppingListListView = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();
    const [shoppingList, setShoppingList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [companyUserOptions, setCompanyUserOptions] = useState([]);
    const [purchasedItemOptions, setPurchasedItemOptions] = useState([]);
    const [purchasedItemsLoading, setPurchasedItemsLoading] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
    const [photoError, setPhotoError] = useState("");
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [openActionMenuId, setOpenActionMenuId] = useState("");
    const [actionMenuPosition, setActionMenuPosition] = useState(null);
    const [purchaseConnectionItem, setPurchaseConnectionItem] = useState(null);
    const [purchasedItemSearch, setPurchasedItemSearch] = useState("");
    const [connectingPurchasedItemId, setConnectingPurchasedItemId] = useState("");

    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("All");
    const [viewPreset, setViewPreset] = useState("recentActive");
    const [selectedStatuses, setSelectedStatuses] = useState(defaultVisibleStatuses);
    const [sortOption, setSortOption] = useState("recentActivityDesc");

    useEffect(() => {
        return () => {
            if (photoPreviewUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(photoPreviewUrl);
            }
        };
    }, [photoPreviewUrl]);

    const fetchShoppingItems = useCallback(async () => {
        try {
            setIsLoading(true);

            if (!recentlySelectedCompany) {
                setShoppingList([]);
                return;
            }

            const q = query(
                collection(db, "companies", recentlySelectedCompany, "shoppingList"),
                orderBy("name")
            );

            const [querySnapshot, companyUsersSnap] = await Promise.all([
                getDocs(q),
                getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
            ]);

            const allCompanyUsers = companyUsersSnap.docs
                .map((docSnap) => {
                    const data = docSnap.data();
                    const label =
                        userDisplayName(data) ||
                        data.email ||
                        "Unnamed Technician";
                    const id = data.userId || data.id || docSnap.id;

                    return {
                        ...data,
                        id,
                        userId: id,
                        userName: data.userName || label,
                        label,
                        value: id,
                    };
                })
                .sort((left, right) => left.label.localeCompare(right.label));

            setCompanyUserOptions(allCompanyUsers);

            const list = querySnapshot.docs.map((docSnap) => {
                const data = docSnap.data();
                const purchasedDate = data.datePurchased?.toDate
                    ? data.datePurchased.toDate()
                    : null;
                const activityDateMillis =
                    dateToMillis(data.updatedAt) ||
                    dateToMillis(data.purchasedAt) ||
                    dateToMillis(data.datePurchased) ||
                    dateToMillis(data.createdAt);

                return {
                    id: docSnap.id,
                    category: data.category || "",
                    subCategory: data.subCategory || "",
                    status: data.status || "",
                    purchaserId: data.purchaserId || "",
                    purchaserName: data.purchaserName || "",
                    genericItemId: data.genericItemId || "",
                    name: data.name || "",
                    description: data.description || "",
                    datePurchased: purchasedDate ? format(purchasedDate, "MM / d / yyyy") : "",
                    datePurchasedInput: purchasedDate ? format(purchasedDate, "yyyy-MM-dd") : "",
                    quantity: data.quantity || "",
                    jobId: data.jobId || "",
                    jobName: data.jobName || data.jobInternalId || "",
                    linkedTaskId: data.linkedTaskId || "",
                    linkedTaskName: data.linkedTaskName || "",
                    linkedTaskType: data.linkedTaskType || "",
                    customerId: data.customerId || data.customerID || "",
                    customerName: data.customerName || "",
                    userId: data.userId || "",
                    userName: data.userName || "",
                    serviceLocationId: data.serviceLocationId || "",
                    serviceLocationName: data.serviceLocationName || "",
                    serviceLocationAddress: data.serviceLocationAddress || "",
                    dbItemId: data.dbItemId || data.itemId || "",
                    dbItemName: data.dbItemName || data.itemName || "",
                    photoUrl: getItemPhotoUrl(data),
                    imageUrl: data.imageUrl || data.imageURL || "",
                    primaryPhotoUrl: data.primaryPhotoUrl || "",
                    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
                    purchasedItem: data.purchasedItem || "",
                    invoiced: !!data.invoiced,
                    customerApprovalRequired: !!data.customerApprovalRequired,
                    customerApprovalStatus: data.customerApprovalStatus || "",
                    partApprovalRequestId: data.partApprovalRequestId || data.approvalRequestId || "",
                    activityDateMillis,
                };
            });

            const fetchCompanyDocsById = async (collectionName, ids) => {
                const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
                if (!uniqueIds.length) return {};
                const collectionSegments = Array.isArray(collectionName) ? collectionName : [collectionName];

                const entries = await Promise.all(
                    uniqueIds.map(async (id) => {
                        try {
                            const snap = await getDoc(doc(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                ...collectionSegments,
                                id
                            ));

                            return snap.exists()
                                ? [id, { id: snap.id, ...snap.data() }]
                                : [id, null];
                        } catch (error) {
                            console.log(`Error loading ${collectionName} reference`);
                            console.log(error);
                            return [id, null];
                        }
                    })
                );

                return entries.reduce((acc, [id, record]) => {
                    if (record) acc[id] = record;
                    return acc;
                }, {});
            };

            const usersById = allCompanyUsers.reduce((acc, user) => {
                [user.id, user.userId, user.value].filter(Boolean).forEach((id) => {
                    acc[id] = user;
                });
                return acc;
            }, {});

            const [jobsById, dbItemsById] = await Promise.all([
                fetchCompanyDocsById("workOrders", list.map((item) => item.jobId)),
                fetchCompanyDocsById(["settings", "dataBase", "dataBase"], list.map((item) => item.dbItemId || item.genericItemId)),
            ]);

            const customerIds = list.flatMap((item) => {
                const job = jobsById[item.jobId] || {};
                return [item.customerId, job.customerId, job.customerID];
            });
            const serviceLocationIds = list.flatMap((item) => {
                const job = jobsById[item.jobId] || {};
                return [item.serviceLocationId, job.serviceLocationId, job.serviceLocationID];
            });

            const [customersById, serviceLocationsById] = await Promise.all([
                fetchCompanyDocsById("customers", customerIds),
                fetchCompanyDocsById("serviceLocations", serviceLocationIds),
            ]);

            const enrichedList = list.map((item) => {
                const job = jobsById[item.jobId] || {};
                const customerId = item.customerId || job.customerId || job.customerID || "";
                const serviceLocationId = item.serviceLocationId || job.serviceLocationId || job.serviceLocationID || "";
                const customer = customersById[customerId] || {};
                const serviceLocation = serviceLocationsById[serviceLocationId] || {};
                const user = usersById[item.userId] || {};
                const dbItem = dbItemsById[item.dbItemId || item.genericItemId] || {};
                const dbItemPhotoFields = itemPhotoFieldsFromSource(dbItem, dbItem.name || item.name || "Shopping item photo");
                const photoUrl = item.photoUrl || dbItemPhotoFields.photoUrl || "";

                const enrichedItem = {
                    ...item,
                    jobName: item.jobName || jobDisplayName(job),
                    customerId,
                    customerName:
                        item.customerName ||
                        job.customerName ||
                        customerDisplayName(customer),
                    userName: item.userName || userDisplayName(user),
                    serviceLocationId,
                    serviceLocationName:
                        item.serviceLocationName ||
                        job.serviceLocationName ||
                        serviceLocationDisplayName(serviceLocation),
                    serviceLocationAddress:
                        item.serviceLocationAddress ||
                        formatAddress(serviceLocation) ||
                        formatAddress(job.serviceLocationAddress) ||
                        formatAddress(job),
                    photoUrl,
                    imageUrl: item.imageUrl || dbItemPhotoFields.imageUrl || photoUrl,
                    primaryPhotoUrl: item.primaryPhotoUrl || dbItemPhotoFields.primaryPhotoUrl || photoUrl,
                    photoUrls: item.photoUrls.length ? item.photoUrls : dbItemPhotoFields.photoUrls,
                };

                return {
                    ...enrichedItem,
                    forPrimary: buildForPrimary(enrichedItem),
                    contextLines: buildContextLines(enrichedItem),
                };
            });

            setShoppingList(enrichedList);
        } catch (error) {
            console.log("Error loading shopping list");
            console.log(error);
        } finally {
            setIsLoading(false);
        }
    }, [recentlySelectedCompany]);

    useEffect(() => {
        fetchShoppingItems();
    }, [fetchShoppingItems]);

    const resetEditState = () => {
        setEditingItem(null);
        setEditForm(null);
        setPhotoFile(null);
        setPhotoPreviewUrl("");
        setPhotoError("");
    };

    const openEditItem = (item) => {
        setEditingItem(item);
        setEditForm({
            id: item.id,
            name: item.name || "",
            description: item.description || "",
            status: item.status || "Need to Purchase",
            quantity: item.quantity || "",
            datePurchasedInput: item.datePurchasedInput || "",
            purchaserId: item.purchaserId || "",
            purchaserName: item.purchaserName || "",
            photoUrl: item.photoUrl || "",
        });
        setPhotoFile(null);
        setPhotoPreviewUrl("");
        setPhotoError("");
    };

    const handleEditFormChange = (field, value) => {
        setEditForm((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleEditPurchaserChange = (userId) => {
        const selectedUser = companyUserOptions.find((user) => user.value === userId || user.id === userId || user.userId === userId);
        setEditForm((prev) => ({
            ...prev,
            purchaserId: selectedUser?.userId || selectedUser?.id || "",
            purchaserName: selectedUser?.userName || selectedUser?.label || "",
        }));
    };

    const applyViewPreset = (presetValue) => {
        const preset = viewPresetOptions.find((option) => option.value === presetValue);
        if (!preset) return;

        setViewPreset(preset.value);
        if (preset.statuses) {
            setSelectedStatuses(preset.statuses);
        }
        if (preset.value === "recentActive") {
            setSortOption("recentActivityDesc");
        }
    };

    const toggleStatusFilter = (status) => {
        setViewPreset("custom");
        setSelectedStatuses((prev) => (
            prev.includes(status)
                ? prev.filter((selectedStatus) => selectedStatus !== status)
                : [...prev, status]
        ));
    };

    const closeActionMenu = () => {
        setOpenActionMenuId("");
        setActionMenuPosition(null);
    };

    const toggleActionMenu = (itemId, event) => {
        event.stopPropagation();

        if (openActionMenuId === itemId) {
            closeActionMenu();
            return;
        }

        const buttonRect = event.currentTarget.getBoundingClientRect();
        const menuWidth = 232;
        const left = Math.min(
            Math.max(8, buttonRect.right - menuWidth),
            window.innerWidth - menuWidth - 8
        );

        setOpenActionMenuId(itemId);
        setActionMenuPosition({
            top: buttonRect.bottom + 8,
            left,
        });
    };

    const openItemDetail = (itemId) => {
        if (!itemId) return;
        navigate(`/company/shopping-list/detail/${itemId}`);
    };

    const handleRowKeyDown = (event, itemId) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openItemDetail(itemId);
    };

    const loadPurchasedItemOptions = useCallback(async (force = false) => {
        if (!recentlySelectedCompany) return [];
        if (!force && purchasedItemOptions.length > 0) return purchasedItemOptions;

        try {
            setPurchasedItemsLoading(true);
            const purchasedItemsSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "purchasedItems"));
            const options = purchasedItemsSnap.docs
                .map(buildPurchasedItemOption)
                .sort((left, right) => {
                    const leftTime = left.date?.getTime?.() || 0;
                    const rightTime = right.date?.getTime?.() || 0;
                    if (leftTime !== rightTime) return rightTime - leftTime;
                    return left.label.localeCompare(right.label);
                });

            setPurchasedItemOptions(options);
            return options;
        } catch (error) {
            console.log("Error loading purchased items");
            console.log(error);
            return [];
        } finally {
            setPurchasedItemsLoading(false);
        }
    }, [purchasedItemOptions, recentlySelectedCompany]);

    const openPurchasedItemConnection = async (item) => {
        closeActionMenu();
        setPurchaseConnectionItem(item);
        setPurchasedItemSearch("");
        await loadPurchasedItemOptions();
    };

    const selectedPurchasedItemOption = useMemo(() => {
        const purchasedItemId = compactString(purchaseConnectionItem?.purchasedItem);
        if (!purchasedItemId) return null;
        return purchasedItemOptions.find((option) => option.id === purchasedItemId) || {
            id: purchasedItemId,
            value: purchasedItemId,
            label: purchasedItemId,
        };
    }, [purchaseConnectionItem?.purchasedItem, purchasedItemOptions]);

    const availablePurchasedItemOptions = useMemo(() => {
        const currentShoppingItemId = compactString(purchaseConnectionItem?.id);
        const currentPurchasedItemId = compactString(purchaseConnectionItem?.purchasedItem);
        const searchText = purchasedItemSearch.toLowerCase().trim();

        return purchasedItemOptions.filter((option) => {
            const linkedShoppingListItemId = compactString(option.shoppingListItemId);
            const canConnect =
                !linkedShoppingListItemId ||
                linkedShoppingListItemId === currentShoppingItemId ||
                option.id === currentPurchasedItemId;

            if (!canConnect) return false;
            if (!searchText) return true;

            return [
                option.name,
                option.label,
                option.techName,
                option.dateLabel,
                option.invoiceNum,
                option.customerName,
                option.venderName,
                option.vendorName,
                option.quantityString,
            ].filter(Boolean).join(" ").toLowerCase().includes(searchText);
        });
    }, [purchaseConnectionItem?.id, purchaseConnectionItem?.purchasedItem, purchasedItemOptions, purchasedItemSearch]);

    const updatePurchasedItemOptionLinks = (previousPurchasedItemId, nextPurchasedItemId, shoppingListItemId) => {
        setPurchasedItemOptions((prev) => prev.map((option) => {
            if (option.id === previousPurchasedItemId && previousPurchasedItemId !== nextPurchasedItemId) {
                return { ...option, shoppingListItemId: "" };
            }

            if (option.id === nextPurchasedItemId) {
                return { ...option, shoppingListItemId };
            }

            return option;
        }));
    };

    const updateShoppingItemPurchasedConnection = (shoppingItemId, purchasedItemId, updates = {}) => {
        setShoppingList((prev) => prev.map((item) => {
            if (item.id !== shoppingItemId) return item;
            const nextItem = { ...item, purchasedItem: purchasedItemId, ...updates };
            return {
                ...nextItem,
                forPrimary: buildForPrimary(nextItem),
                contextLines: buildContextLines(nextItem),
            };
        }));
    };

    const connectPurchasedItem = async (purchasedItemOption) => {
        const shoppingItem = purchaseConnectionItem;
        const nextPurchasedItemId = compactString(purchasedItemOption?.id || purchasedItemOption?.value);
        if (!recentlySelectedCompany || !shoppingItem?.id || !nextPurchasedItemId) return;

        try {
            setConnectingPurchasedItemId(nextPurchasedItemId);
            const previousPurchasedItemId = compactString(shoppingItem.purchasedItem);
            const previousShoppingListItemId = compactString(purchasedItemOption.shoppingListItemId);

            const { shoppingPayload } = await syncLinkedShoppingPurchase({
                db,
                companyId: recentlySelectedCompany,
                shoppingItemId: shoppingItem.id,
                purchasedItemId: nextPurchasedItemId,
                shoppingItemData: shoppingItem,
                purchasedItemData: purchasedItemOption,
                previousShoppingItemId: previousShoppingListItemId,
                previousPurchasedItemId,
            });

            updateShoppingItemPurchasedConnection(shoppingItem.id, nextPurchasedItemId, shoppingPayload);
            if (previousShoppingListItemId && previousShoppingListItemId !== shoppingItem.id) {
                updateShoppingItemPurchasedConnection(previousShoppingListItemId, "");
            }
            updatePurchasedItemOptionLinks(previousPurchasedItemId, nextPurchasedItemId, shoppingItem.id);
            setPurchaseConnectionItem(null);
        } catch (error) {
            console.log("Error connecting purchased item");
            console.log(error);
        } finally {
            setConnectingPurchasedItemId("");
        }
    };

    const clearPurchasedItemConnection = async () => {
        const shoppingItem = purchaseConnectionItem;
        const previousPurchasedItemId = compactString(shoppingItem?.purchasedItem);
        if (!recentlySelectedCompany || !shoppingItem?.id || !previousPurchasedItemId) return;

        try {
            setConnectingPurchasedItemId(previousPurchasedItemId);

            await updateDoc(
                doc(db, "companies", recentlySelectedCompany, "shoppingList", shoppingItem.id),
                {
                    purchasedItem: "",
                    updatedAt: Timestamp.now(),
                }
            );

            await syncLinkedShoppingPurchase({
                db,
                companyId: recentlySelectedCompany,
                previousPurchasedItemId,
            });

            updateShoppingItemPurchasedConnection(shoppingItem.id, "");
            updatePurchasedItemOptionLinks(previousPurchasedItemId, "", shoppingItem.id);
            setPurchaseConnectionItem(null);
        } catch (error) {
            console.log("Error clearing purchased item connection");
            console.log(error);
        } finally {
            setConnectingPurchasedItemId("");
        }
    };

    const handleEditPhotoFileChange = (event) => {
        const file = event.target.files?.[0] || null;
        const validationMessage = validateItemPhotoFile(file);

        if (validationMessage) {
            setPhotoError(validationMessage);
            setPhotoFile(null);
            setPhotoPreviewUrl("");
            return;
        }

        setPhotoError("");
        setPhotoFile(file);
        setPhotoPreviewUrl(file ? URL.createObjectURL(file) : "");
    };

    const saveInlineEdit = async () => {
        if (!recentlySelectedCompany || !editingItem?.id || !editForm) return;

        try {
            setSavingEdit(true);
            let uploadedPhoto = {
                photoUrl: editForm.photoUrl || "",
                storagePath: "",
            };

            if (photoFile) {
                uploadedPhoto = await uploadItemPhoto({
                    storage,
                    companyId: recentlySelectedCompany,
                    file: photoFile,
                    itemType: "shoppingItems",
                    itemId: editingItem.id,
                });
            }

            const photoFields = itemPhotoFieldsFromUrl(
                uploadedPhoto.photoUrl,
                editForm.name || editingItem.name || "Shopping item photo",
                uploadedPhoto.storagePath
            );
            const nextInvoiced = editForm.status === SHOPPING_LIST_INVOICED_STATUS || !!editingItem.invoiced;
            const nextStatus = nextInvoiced ? SHOPPING_LIST_INVOICED_STATUS : editForm.status || "";
            const purchasedDate = editForm.datePurchasedInput
                ? new Date(`${editForm.datePurchasedInput}T00:00:00`)
                : null;
            const payload = {
                name: editForm.name || "",
                description: editForm.description || "",
                status: nextStatus,
                quantity: editForm.quantity || "",
                datePurchased: purchasedDate ? Timestamp.fromDate(purchasedDate) : null,
                purchaserId: editForm.purchaserId || "",
                purchaserName: editForm.purchaserName || "",
                invoiced: nextInvoiced,
                invoiceStatus: nextInvoiced ? "Invoiced" : "",
                needsAction: shoppingItemNeedsAction(nextStatus),
                updatedAt: Timestamp.now(),
                ...photoFields,
            };

            await updateDoc(
                doc(db, "companies", recentlySelectedCompany, "shoppingList", editingItem.id),
                payload
            );

            let syncedShoppingPayload = {};
            if (editingItem.purchasedItem) {
                const { shoppingPayload } = await syncLinkedShoppingPurchase({
                    db,
                    companyId: recentlySelectedCompany,
                    shoppingItemId: editingItem.id,
                    purchasedItemId: editingItem.purchasedItem,
                    shoppingItemData: {
                        ...editingItem,
                        ...payload,
                    },
                    invoiced: nextInvoiced,
                });
                syncedShoppingPayload = shoppingPayload || {};
            }

            setShoppingList((prev) => prev.map((item) => {
                if (item.id !== editingItem.id) return item;

                const nextItem = {
                    ...item,
                    ...payload,
                    ...syncedShoppingPayload,
                    datePurchased: purchasedDate ? format(purchasedDate, "MM / d / yyyy") : "",
                    datePurchasedInput: editForm.datePurchasedInput || "",
                };

                return {
                    ...nextItem,
                    forPrimary: buildForPrimary(nextItem),
                    contextLines: buildContextLines(nextItem),
                };
            }));

            resetEditState();
        } catch (error) {
            console.log("Error saving shopping item from list");
            console.log(error);
        } finally {
            setSavingEdit(false);
        }
    };

    const activeViewPreset = useMemo(
        () => viewPresetOptions.find((option) => option.value === viewPreset) || viewPresetOptions[0],
        [viewPreset]
    );

    const filteredMatches = useMemo(() => {
        const searchText = search.toLowerCase().trim();
        const valueForSort = (item, key) => {
            switch (key) {
                case "recentActivityDesc":
                    return item.activityDateMillis || 0;
                case "status":
                    return item.status || "";
                case "category":
                    return [item.category, item.subCategory].filter(Boolean).join(" ");
                case "purchaser":
                    return item.purchaserName || "";
                case "datePurchasedDesc":
                    return item.datePurchasedInput || "";
                default:
                    return item.name || "";
            }
        };

        const matches = shoppingList.filter((item) => {
            const matchesSearch =
                searchText === "" ||
                item.name.toLowerCase().includes(searchText) ||
                item.description.toLowerCase().includes(searchText) ||
                item.purchaserName.toLowerCase().includes(searchText) ||
                item.customerName.toLowerCase().includes(searchText) ||
                item.userName.toLowerCase().includes(searchText) ||
                item.jobName.toLowerCase().includes(searchText) ||
                item.linkedTaskName.toLowerCase().includes(searchText) ||
                item.serviceLocationName.toLowerCase().includes(searchText) ||
                item.serviceLocationAddress.toLowerCase().includes(searchText) ||
                item.contextLines.some((line) =>
                    line.value.toLowerCase().includes(searchText)
                );

            const matchesCategory =
                categoryFilter === "All" || item.category === categoryFilter;

            const matchesStatus =
                selectedStatuses.length > 0 && selectedStatuses.includes(item.status);

            return matchesSearch && matchesCategory && matchesStatus;
        });

        return matches.sort((left, right) => {
            const leftValue = valueForSort(left, sortOption);
            const rightValue = valueForSort(right, sortOption);
            const result = typeof leftValue === "number" || typeof rightValue === "number"
                ? Number(leftValue || 0) - Number(rightValue || 0)
                : String(leftValue || "").toLowerCase().localeCompare(String(rightValue || "").toLowerCase());
            if (sortOption === "nameDesc" || sortOption === "datePurchasedDesc" || sortOption === "recentActivityDesc") return -result;
            return result;
        });
    }, [shoppingList, search, categoryFilter, selectedStatuses, sortOption]);

    const filteredList = useMemo(() => {
        if (!activeViewPreset.limit) return filteredMatches;
        return filteredMatches.slice(0, activeViewPreset.limit);
    }, [activeViewPreset.limit, filteredMatches]);

    const hiddenByRecentLimit = Math.max(filteredMatches.length - filteredList.length, 0);

    const openActionItem = useMemo(
        () => shoppingList.find((item) => item.id === openActionMenuId) || null,
        [openActionMenuId, shoppingList]
    );

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company operations</p>
                        <h2 className="mt-1 text-3xl font-bold text-slate-950">Shopping List</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            Manage shopping items by purchaser, customer, job, and status
                        </p>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                        <Link
                            to="/company/purchased-items?filter=all&days=30&sort=recent"
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
                        >
                            <ShoppingCartIcon className="h-4 w-4" />
                            Recently Purchased
                        </Link>
                        <Link
                            to="/company/shopping-purchase-reconciliation"
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-100"
                        >
                            <ArrowsRightLeftIcon className="h-4 w-4" />
                            Reconcile
                        </Link>

                        <Link
                            to="/company/shopping-list/create"
                            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                        >
                            New Item
                        </Link>
                    </div>
                    </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="grid grid-cols-1 gap-3 border-b border-slate-200 p-5 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search items..."
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />

                        <label className="sr-only" htmlFor="shopping-view-preset">View</label>
                        <select
                            id="shopping-view-preset"
                            value={viewPreset}
                            onChange={(event) => applyViewPreset(event.target.value)}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        >
                            {viewPresetOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={() => setShowFilterModal(true)}
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                            <FunnelIcon className="h-4 w-4" />
                            Filter and Sort
                        </button>
                    </div>

                    <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            Showing {filteredList.length} of {filteredMatches.length} matching item{filteredMatches.length === 1 ? "" : "s"}
                            {hiddenByRecentLimit ? ` - ${hiddenByRecentLimit} older matching item${hiddenByRecentLimit === 1 ? "" : "s"} hidden` : ""}
                        </div>
                        <div>{activeViewPreset.label} - {categoryFilter === "All" ? "All categories" : categoryFilter} - {selectedStatuses.length} status{selectedStatuses.length === 1 ? "" : "es"} selected</div>
                    </div>
                </section>

                <section className="max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    {filteredList.length > 0 ? (
                        <div className="divide-y divide-slate-200">
                            {filteredList.map((item) => (
                                <div
                                    key={item.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => openItemDetail(item.id)}
                                    onKeyDown={(event) => handleRowKeyDown(event, item.id)}
                                    className="grid cursor-pointer gap-3 px-5 py-3 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-100 lg:grid-cols-[56px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(220px,0.7fr)_auto] lg:items-center"
                                >
                                    <div className="h-14 w-14 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                                        {item.photoUrl ? (
                                            <img src={item.photoUrl} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-slate-400">
                                                Photo
                                            </div>
                                        )}
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-900">{item.name || "Unnamed Item"}</p>
                                        {item.description ? (
                                            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{item.description}</p>
                                        ) : null}
                                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                                                {item.category || "—"}
                                            </span>
                                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                                                {item.subCategory || "—"}
                                            </span>
                                            {item.customerApprovalRequired ? (
                                                <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                                                    Approval: {item.customerApprovalStatus || "pending"}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-900">{item.forPrimary || "—"}</p>
                                        {item.contextLines.length ? (
                                            <div className="mt-0.5 space-y-0">
                                                {item.contextLines.map((line) => (
                                                    <p key={`${item.id}-${line.label}`} className="truncate text-xs text-slate-500">
                                                        <span className="font-semibold text-slate-600">{line.label}:</span>{" "}
                                                        {line.value}
                                                    </p>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-700">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
                                            <p className="truncate font-semibold text-slate-800">{item.status || "—"}</p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Qty</p>
                                            <p className="truncate">{item.quantity || "—"}</p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Purchaser</p>
                                            <p className="truncate">{item.purchaserName || "—"}</p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Purchased</p>
                                            <p className="truncate">{item.datePurchased || "—"}</p>
                                        </div>
                                    </div>

                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={(event) => toggleActionMenu(item.id, event)}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
                                            aria-label={`Actions for ${item.name || "shopping item"}`}
                                            aria-expanded={openActionMenuId === item.id}
                                        >
                                            <EllipsisVerticalIcon className="h-5 w-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                            No shopping list items found.
                        </div>
                    )}
                </section>
            </div>

            {showFilterModal && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
                    <div className="mx-auto my-8 w-full max-w-3xl rounded-xl bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">Filter and Sort</h3>
                                <p className="mt-1 text-sm text-gray-500">Choose the categories, statuses, and row order for this view.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowFilterModal(false)}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-6 p-5">
                            <div>
                                <p className="mb-2 text-sm font-semibold text-gray-700">Quick Status</p>
                                <div className="flex flex-wrap gap-2">
                                    {statusQuickFilters.map((quickFilter) => {
                                        const isActive =
                                            viewPreset === quickFilter.presetValue ||
                                            areStatusSetsEqual(selectedStatuses, quickFilter.statuses);

                                        return (
                                            <button
                                                key={quickFilter.label}
                                                type="button"
                                                onClick={() => applyViewPreset(quickFilter.presetValue)}
                                                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                                                    isActive
                                                        ? "bg-blue-600 text-white shadow-sm"
                                                        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                                }`}
                                            >
                                                {quickFilter.label}
                                            </button>
                                        );
                                    })}
                                    <button
                                        type="button"
                                        onClick={() => applyViewPreset("recentActive")}
                                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                                    >
                                        Recent Active
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => applyViewPreset("allActive")}
                                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                                    >
                                        All Active
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => applyViewPreset("allStatuses")}
                                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                                    >
                                        All Statuses
                                    </button>
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-sm font-semibold text-gray-700">Status</p>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                    {statusOptions.map((status) => {
                                        const isSelected = selectedStatuses.includes(status);

                                        return (
                                            <label
                                                key={status}
                                                className={`flex min-h-[40px] cursor-pointer items-center justify-center rounded-md border px-2 text-center text-xs font-semibold transition ${
                                                    isSelected
                                                        ? "border-blue-600 bg-blue-50 text-blue-700"
                                                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleStatusFilter(status)}
                                                    className="sr-only"
                                                />
                                                {status}
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700">Category</label>
                                    <select
                                        value={categoryFilter}
                                        onChange={(e) => setCategoryFilter(e.target.value)}
                                        className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3"
                                    >
                                        {categoryOptions.map((category) => (
                                            <option key={category} value={category}>
                                                {category === "All" ? "All Categories" : category}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700">Sort</label>
                                    <select
                                        value={sortOption}
                                        onChange={(e) => setSortOption(e.target.value)}
                                        className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3"
                                    >
                                        {sortOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end border-t border-gray-200 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setShowFilterModal(false)}
                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {openActionItem && actionMenuPosition && (
                <>
                    <button
                        type="button"
                        aria-label="Close actions"
                        className="fixed inset-0 z-40 cursor-default bg-transparent"
                        onClick={closeActionMenu}
                    />
                    <div
                        className="fixed z-50 w-[232px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
                        style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
                    >
                        <button
                            type="button"
                            onClick={() => {
                                closeActionMenu();
                                openEditItem(openActionItem);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                        >
                            <PencilSquareIcon className="h-4 w-4" />
                            Edit
                        </button>
                        <button
                            type="button"
                            onClick={() => openPurchasedItemConnection(openActionItem)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                        >
                            <ShoppingCartIcon className="h-4 w-4" />
                            {openActionItem.purchasedItem ? "Change Purchased Item" : "Connect Purchased Item"}
                        </button>
                    </div>
                </>
            )}

            {purchaseConnectionItem && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
                    <div className="mx-auto my-8 w-full max-w-3xl rounded-xl bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">Connect Purchased Item</h3>
                                <p className="mt-1 text-sm text-gray-500">{purchaseConnectionItem.name || "Shopping item"}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPurchaseConnectionItem(null)}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            {purchaseConnectionItem.purchasedItem ? (
                                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Current connection</p>
                                    <p className="mt-1 text-sm font-semibold text-blue-900">
                                        {selectedPurchasedItemOption?.label || purchaseConnectionItem.purchasedItem}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={clearPurchasedItemConnection}
                                        disabled={!!connectingPurchasedItemId}
                                        className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                                    >
                                        Clear Connection
                                    </button>
                                </div>
                            ) : null}

                            <input
                                type="text"
                                value={purchasedItemSearch}
                                onChange={(event) => setPurchasedItemSearch(event.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-3 text-sm"
                                placeholder="Search purchased items..."
                            />

                            {purchasedItemsLoading ? (
                                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                                    Loading purchased items...
                                </div>
                            ) : availablePurchasedItemOptions.length ? (
                                <div className="max-h-[480px] space-y-2 overflow-y-auto">
                                    {availablePurchasedItemOptions.map((option) => (
                                        <div
                                            key={option.id}
                                            className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 md:flex-row md:items-center md:justify-between"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-semibold text-gray-800">
                                                    {option.name || "Purchased Item"}
                                                </p>
                                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                                                    <span>{option.dateLabel || "No date"}</span>
                                                    <span>{option.techName || "No technician"}</span>
                                                    {option.invoiceNum ? <span>Invoice {option.invoiceNum}</span> : null}
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => connectPurchasedItem(option)}
                                                disabled={!!connectingPurchasedItemId}
                                                className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                                            >
                                                {connectingPurchasedItemId === option.id ? "Connecting..." : "Select"}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                                    No unconnected purchased items found.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {editingItem && editForm && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
                    <div className="mx-auto my-8 w-full max-w-3xl rounded-xl bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">Edit Shopping Item</h3>
                                <p className="mt-1 text-sm text-gray-500">{editingItem.category || "Shopping item"}</p>
                            </div>
                            <button
                                type="button"
                                onClick={resetEditState}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="grid gap-4 p-5 md:grid-cols-2">
                            <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white">
                                        {photoPreviewUrl || editForm.photoUrl ? (
                                            <img src={photoPreviewUrl || editForm.photoUrl} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-gray-400">
                                                Photo
                                            </div>
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600">Photo</label>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={handleEditPhotoFileChange}
                                                className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                                            />
                                            {photoFile ? (
                                                <p className="mt-1 text-xs text-gray-500">{photoFile.name} will upload when you save.</p>
                                            ) : null}
                                            {photoError ? (
                                                <p className="mt-1 text-xs font-semibold text-red-600">{photoError}</p>
                                            ) : null}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600">Photo URL</label>
                                            <input
                                                type="url"
                                                value={editForm.photoUrl}
                                                onChange={(e) => handleEditFormChange("photoUrl", e.target.value)}
                                                className="mt-2 w-full rounded-md border border-gray-300 p-3"
                                                placeholder="https://..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-600">Name</label>
                                <input
                                    type="text"
                                    value={editForm.name}
                                    onChange={(e) => handleEditFormChange("name", e.target.value)}
                                    className="mt-2 w-full rounded-md border border-gray-300 p-3"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-600">Status</label>
                                <select
                                    value={editForm.status}
                                    onChange={(e) => handleEditFormChange("status", e.target.value)}
                                    className="mt-2 w-full rounded-md border border-gray-300 bg-white p-3"
                                >
                                    {statusOptions.map((status) => (
                                        <option key={status} value={status}>{status}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-600">Quantity</label>
                                <input
                                    type="text"
                                    value={editForm.quantity}
                                    onChange={(e) => handleEditFormChange("quantity", e.target.value)}
                                    className="mt-2 w-full rounded-md border border-gray-300 p-3"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-600">Date Purchased</label>
                                <input
                                    type="date"
                                    value={editForm.datePurchasedInput}
                                    onChange={(e) => handleEditFormChange("datePurchasedInput", e.target.value)}
                                    className="mt-2 w-full rounded-md border border-gray-300 p-3"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-600">Purchaser</label>
                                <select
                                    value={editForm.purchaserId}
                                    onChange={(e) => handleEditPurchaserChange(e.target.value)}
                                    className="mt-2 w-full rounded-md border border-gray-300 bg-white p-3"
                                >
                                    <option value="">Unassigned</option>
                                    {companyUserOptions.map((user) => (
                                        <option key={user.value} value={user.value}>{user.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-600">Category</label>
                                <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-700">
                                    {editingItem.category || "—"} / {editingItem.subCategory || "—"}
                                </div>
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-sm font-semibold text-gray-600">Description</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) => handleEditFormChange("description", e.target.value)}
                                    className="mt-2 min-h-[120px] w-full rounded-md border border-gray-300 p-3"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-4">
                            <button
                                type="button"
                                onClick={resetEditState}
                                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                disabled={savingEdit}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveInlineEdit}
                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                                disabled={savingEdit}
                            >
                                {savingEdit ? "Saving..." : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isLoading && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        Loading shopping list...
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShoppingListListView;
