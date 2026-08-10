import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import Select from "react-select";
import { db, storage } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import { linkedReferenceText } from "../../../utils/displayReferences";
import { appConfirm } from "../../../utils/appDialog";
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
import {
    deleteShoppingListItemWithLinks,
    getShoppingItemPartApprovalId,
    isShoppingItemFromPartApproval,
} from "../../../utils/shoppingListDelete";
import { compareCompanyUsersByName } from "../../../utils/companyUsers";
import ShareItemButton from "../../components/share/ShareItemButton";

const categoryOptions = ["Personal", "Customer", "Job"];
const subCategoryOptions = ["Data Base", "Chemical", "Part", "Custom"];
const statusOptions = ["Need to Purchase", "Needs Customer Approval", "Ready to Purchase", "Customer Rejected", "Purchased", "Delivered", "Installed", SHOPPING_LIST_INVOICED_STATUS];
const shoppingListCollectionNames = ["shoppingList", "shoppingListItems"];

const selectStyles = {
    control: (provided) => ({
        ...provided,
        backgroundColor: "white",
        border: "1px solid #cbd5e1",
        borderRadius: "0.375rem",
        minHeight: "46px",
        boxShadow: "none",
    }),
    menu: (provided) => ({
        ...provided,
        zIndex: 50,
    }),
};

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

const compactString = (value) => String(value || "").trim();

const companyUserName = (user = {}) => (
    user.userName ||
    user.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.name ||
    user.email ||
    ""
);

const timestampToDate = (value) => {
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    return null;
};

const ShoppingListDetailView = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { shoppingItemId } = useParams();
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [edit, setEdit] = useState(false);
    const [sourceCollection, setSourceCollection] = useState("shoppingList");
    const [jobDetails, setJobDetails] = useState(null);
    const [serviceLocationDetails, setServiceLocationDetails] = useState(null);
    const [loadingJobDetails, setLoadingJobDetails] = useState(false);
    const [loadingSelectors, setLoadingSelectors] = useState(false);
    const [companyUserOptions, setCompanyUserOptions] = useState([]);
    const [purchasedItemOptions, setPurchasedItemOptions] = useState([]);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
    const [photoError, setPhotoError] = useState("");
    const [purchasedItemModalOpen, setPurchasedItemModalOpen] = useState(false);
    const [purchasedItemSearch, setPurchasedItemSearch] = useState("");
    const [connectingPurchasedItemId, setConnectingPurchasedItemId] = useState("");

    const [item, setItem] = useState({
        id: "",
        category: "",
        subCategory: "",
        status: "",
        purchaserId: "",
        purchaserName: "",
        genericItemId: "",
        name: "",
        description: "",
        datePurchased: "",
        quantity: "",
        jobId: "",
        jobName: "",
        customerId: "",
        customerName: "",
        userId: "",
        userName: "",
        dbItemId: "",
        dbItemName: "",
        photoUrl: "",
        imageUrl: "",
        primaryPhotoUrl: "",
        photoUrls: [],
        purchasedItem: "",
        invoiced: false,
        serviceLocationId: "",
        serviceLocationName: "",
        serviceLocationAddress: "",
        plannedUnitCostCents: null,
        plannedUnitPriceCents: null,
        plannedTotalCostCents: null,
        plannedTotalPriceCents: null,
        customerApprovalRequired: false,
        customerApprovalStatus: "",
        partApprovalRequestId: "",
    });

    const [editForm, setEditForm] = useState({
        category: "Personal",
        subCategory: "Custom",
        status: "Need to Purchase",
        purchaserId: "",
        purchaserName: "",
        genericItemId: "",
        name: "",
        description: "",
        datePurchased: "",
        quantity: "",
        jobId: "",
        jobName: "",
        customerId: "",
        customerName: "",
        userId: "",
        userName: "",
        dbItemId: "",
        dbItemName: "",
        photoUrl: "",
        imageUrl: "",
        primaryPhotoUrl: "",
        photoUrls: [],
        purchasedItem: "",
        invoiced: false,
        serviceLocationId: "",
        serviceLocationName: "",
        serviceLocationAddress: "",
        plannedUnitCostCents: null,
        plannedUnitPriceCents: null,
        plannedTotalCostCents: null,
        plannedTotalPriceCents: null,
        customerApprovalRequired: false,
        customerApprovalStatus: "",
        partApprovalRequestId: "",
    });

    useEffect(() => {
        const fetchSelectorData = async () => {
            if (!recentlySelectedCompany) {
                setCompanyUserOptions([]);
                setPurchasedItemOptions([]);
                return;
            }

            try {
                setLoadingSelectors(true);

                const [companyUsersSnap, purchasedItemsSnap] = await Promise.all([
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "purchasedItems")),
                ]);

                const userOptions = companyUsersSnap.docs
                    .map((docSnap) => {
                        const data = docSnap.data();
                        const id = data.userId || data.id || docSnap.id;
                        const name = companyUserName(data) || "Unnamed Technician";

                        return {
                            ...data,
                            id,
                            userId: id,
                            name,
                            label: name,
                            value: id,
                        };
                    })
                    .sort(compareCompanyUsersByName);

                const purchaseOptions = purchasedItemsSnap.docs
                    .map((docSnap) => {
                        const data = docSnap.data();
                        const id = data.id || docSnap.id;
                        const date = timestampToDate(data.date);
                        const dateLabel = date ? format(date, "MM/dd/yyyy") : "";
                        const name = data.name || data.dbItemName || "Purchased Item";
                        const techName = data.techName || data.userName || "";
                        const label = [
                            name,
                            dateLabel,
                            techName,
                            data.invoiceNum ? `Invoice ${data.invoiceNum}` : "",
                        ].filter(Boolean).join(" - ");

                        return {
                            ...data,
                            id,
                            name,
                            date,
                            dateLabel,
                            techName,
                            label,
                            value: id,
                            shoppingListItemId: data.shoppingListItemId || "",
                        };
                    })
                    .sort((left, right) => {
                        const leftTime = left.date?.getTime?.() || 0;
                        const rightTime = right.date?.getTime?.() || 0;
                        if (leftTime !== rightTime) return rightTime - leftTime;
                        return left.label.localeCompare(right.label);
                    });

                setCompanyUserOptions(userOptions);
                setPurchasedItemOptions(purchaseOptions);
            } catch (error) {
                console.log("Error loading shopping list selectors");
                console.log(error);
            } finally {
                setLoadingSelectors(false);
            }
        };

        fetchSelectorData();
    }, [recentlySelectedCompany]);

    useEffect(() => {
        return () => {
            if (photoPreviewUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(photoPreviewUrl);
            }
        };
    }, [photoPreviewUrl]);

    const fetchItem = useCallback(async () => {
        if (!recentlySelectedCompany || !shoppingItemId) {
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);

            let docSnap = null;
            let loadedCollection = "shoppingList";

            for (const collectionName of shoppingListCollectionNames) {
                const docRef = doc(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    collectionName,
                    shoppingItemId
                );
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    docSnap = snap;
                    loadedCollection = collectionName;
                    break;
                }
            }

            if (docSnap?.exists()) {
                const data = docSnap.data();
                setSourceCollection(loadedCollection);

                const formattedDate = data.datePurchased?.toDate
                    ? format(data.datePurchased.toDate(), "yyyy-MM-dd")
                    : "";

                const loadedItem = {
                    id: docSnap.id,
                    category: data.category || "",
                    subCategory: data.subCategory || "",
                    status: data.status || "",
                    purchaserId: data.purchaserId || "",
                    purchaserName: data.purchaserName || "",
                    genericItemId: data.genericItemId || "",
                    name: data.name || "",
                    description: data.description || "",
                    datePurchased: formattedDate,
                    quantity: data.quantity || "",
                    jobId: data.jobId || "",
                    jobName: data.jobName || data.jobInternalId || "",
                    customerId: data.customerId || "",
                    customerName: data.customerName || "",
                    userId: data.userId || "",
                    userName: data.userName || "",
                    dbItemId: data.dbItemId || data.itemId || "",
                    dbItemName: data.dbItemName || data.itemName || "",
                    photoUrl: getItemPhotoUrl(data),
                    imageUrl: data.imageUrl || data.imageURL || "",
                    primaryPhotoUrl: data.primaryPhotoUrl || "",
                    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
                    purchasedItem: data.purchasedItem || "",
                    invoiced: !!data.invoiced,
                    serviceLocationId: data.serviceLocationId || "",
                    serviceLocationName: data.serviceLocationName || "",
                    serviceLocationAddress: data.serviceLocationAddress || "",
                    plannedUnitCostCents: data.plannedUnitCostCents ?? data.cost ?? null,
                    plannedUnitPriceCents: data.plannedUnitPriceCents ?? data.price ?? null,
                    plannedTotalCostCents: data.plannedTotalCostCents ?? null,
                    plannedTotalPriceCents: data.plannedTotalPriceCents ?? null,
                    customerApprovalRequired: !!data.customerApprovalRequired,
                    customerApprovalStatus: data.customerApprovalStatus || "",
                    partApprovalRequestId: data.partApprovalRequestId || data.approvalRequestId || "",
                };

                let databasePhotoFields = {};
                if (!loadedItem.photoUrl && loadedItem.dbItemId) {
                    const dbItemSnap = await getDoc(doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "settings",
                        "dataBase",
                        "dataBase",
                        loadedItem.dbItemId
                    ));

                    if (dbItemSnap.exists()) {
                        databasePhotoFields = itemPhotoFieldsFromSource(
                            dbItemSnap.data(),
                            loadedItem.name || "Shopping item photo"
                        );
                    }
                }

                const itemWithPhoto = {
                    ...loadedItem,
                    photoUrl: loadedItem.photoUrl || databasePhotoFields.photoUrl || "",
                    imageUrl: loadedItem.imageUrl || databasePhotoFields.imageUrl || "",
                    primaryPhotoUrl: loadedItem.primaryPhotoUrl || databasePhotoFields.primaryPhotoUrl || "",
                    photoUrls: loadedItem.photoUrls.length ? loadedItem.photoUrls : databasePhotoFields.photoUrls || [],
                };

                setItem(itemWithPhoto);
                setEditForm(itemWithPhoto);
            } else {
                console.log("No such shopping list item!");
            }
        } catch (error) {
            console.log("Error loading shopping list item");
            console.log(error);
        } finally {
            setIsLoading(false);
        }
    }, [recentlySelectedCompany, shoppingItemId]);

    useEffect(() => {
        fetchItem();
    }, [fetchItem]);

    useEffect(() => {
        const fetchConnectedJobDetails = async () => {
            if (!recentlySelectedCompany || !item.id || (!item.jobId && !item.serviceLocationId)) {
                setJobDetails(null);
                setServiceLocationDetails(null);
                return;
            }

            try {
                setLoadingJobDetails(true);
                let loadedJob = null;

                if (item.jobId) {
                    const jobSnap = await getDoc(doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "workOrders",
                        item.jobId
                    ));

                    if (jobSnap.exists()) {
                        loadedJob = {
                            id: jobSnap.id,
                            ...jobSnap.data(),
                        };
                    }
                }

                const serviceLocationId = item.serviceLocationId || loadedJob?.serviceLocationId || "";
                let loadedServiceLocation = null;

                if (serviceLocationId) {
                    const locationSnap = await getDoc(doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "serviceLocations",
                        serviceLocationId
                    ));

                    if (locationSnap.exists()) {
                        loadedServiceLocation = {
                            id: locationSnap.id,
                            ...locationSnap.data(),
                        };
                    }
                }

                setJobDetails(loadedJob);
                setServiceLocationDetails(loadedServiceLocation);
            } catch (error) {
                console.log("Error loading connected job details");
                console.log(error);
                setJobDetails(null);
                setServiceLocationDetails(null);
            } finally {
                setLoadingJobDetails(false);
            }
        };

        fetchConnectedJobDetails();
    }, [recentlySelectedCompany, item.id, item.jobId, item.serviceLocationId]);

    const handleEditFieldChange = (field, value) => {
        setEditForm((prev) => ({
            ...prev,
            [field]: value,
            ...(field === "invoiced"
                ? {
                    status: value
                        ? SHOPPING_LIST_INVOICED_STATUS
                        : prev.status === SHOPPING_LIST_INVOICED_STATUS
                            ? "Purchased"
                            : prev.status,
                }
                : {}),
            ...(field === "status"
                ? {
                    invoiced: value === SHOPPING_LIST_INVOICED_STATUS
                        ? true
                        : prev.status === SHOPPING_LIST_INVOICED_STATUS
                            ? false
                            : prev.invoiced,
                }
                : {}),
        }));
    };

    const handlePhotoFileChange = (event) => {
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

    const selectedPurchaserOption = useMemo(() => {
        const purchaserId = compactString(editForm.purchaserId);
        const purchaserName = compactString(editForm.purchaserName);
        const matchedOption = companyUserOptions.find((option) => (
            option.value === purchaserId ||
            option.id === purchaserId ||
            option.userId === purchaserId ||
            (purchaserName && option.label === purchaserName)
        ));

        if (matchedOption) return matchedOption;
        if (!purchaserId && !purchaserName) return null;

        return {
            id: purchaserId,
            userId: purchaserId,
            value: purchaserId,
            name: purchaserName,
            label: purchaserName || purchaserId,
        };
    }, [companyUserOptions, editForm.purchaserId, editForm.purchaserName]);

    const availablePurchasedItemOptions = useMemo(() => {
        const selectedPurchasedItemId = compactString(editForm.purchasedItem);

        return purchasedItemOptions.filter((option) => {
            const linkedShoppingListItemId = compactString(option.shoppingListItemId);
            return (
                !linkedShoppingListItemId ||
                linkedShoppingListItemId === shoppingItemId ||
                option.id === selectedPurchasedItemId
            );
        });
    }, [editForm.purchasedItem, purchasedItemOptions, shoppingItemId]);

    const selectedPurchasedItemOption = useMemo(() => {
        const purchasedItemId = compactString(editForm.purchasedItem);
        const matchedOption = availablePurchasedItemOptions.find((option) => option.id === purchasedItemId);

        if (matchedOption) return matchedOption;
        if (!purchasedItemId) return null;

        return {
            id: purchasedItemId,
            value: purchasedItemId,
            label: purchasedItemId,
        };
    }, [availablePurchasedItemOptions, editForm.purchasedItem]);

    const filteredPurchasedItemOptions = useMemo(() => {
        const searchText = purchasedItemSearch.toLowerCase().trim();
        if (!searchText) return availablePurchasedItemOptions;

        return availablePurchasedItemOptions.filter((option) => (
            [
                option.name,
                option.label,
                option.dateLabel,
                option.techName,
                option.invoiceNum,
                option.customerName,
                option.venderName,
                option.vendorName,
                option.quantityString,
            ].filter(Boolean).join(" ").toLowerCase().includes(searchText)
        ));
    }, [availablePurchasedItemOptions, purchasedItemSearch]);

    const handlePurchaserChange = (option) => {
        setEditForm((prev) => ({
            ...prev,
            purchaserId: option?.userId || option?.id || option?.value || "",
            purchaserName: option?.name || option?.label || "",
        }));
    };

    const handlePurchasedItemChange = (option) => {
        setEditForm((prev) => ({
            ...prev,
            purchasedItem: option?.id || option?.value || "",
        }));
    };

    const updatePurchasedItemOptionLinks = (previousPurchasedItemId, nextPurchasedItemId) => {
        setPurchasedItemOptions((prev) => prev.map((option) => {
            if (option.id === previousPurchasedItemId && previousPurchasedItemId !== nextPurchasedItemId) {
                return { ...option, shoppingListItemId: "" };
            }

            if (option.id === nextPurchasedItemId) {
                return { ...option, shoppingListItemId: shoppingItemId };
            }

            return option;
        }));
    };

    const syncPurchasedItemConnection = async (previousPurchasedItemId, nextPurchasedItemId) => {
        const nextId = compactString(nextPurchasedItemId);

        return syncLinkedShoppingPurchase({
            db,
            companyId: recentlySelectedCompany,
            shoppingItemId: nextId ? shoppingItemId : "",
            purchasedItemId: nextId,
            shoppingCollectionName: sourceCollection,
            shoppingItemData: {
                ...item,
                ...editForm,
                status: editForm.status,
                invoiced: editForm.status === SHOPPING_LIST_INVOICED_STATUS || !!editForm.invoiced,
            },
            purchasedItemData: purchasedItemOptions.find((option) => option.id === nextId) || null,
            previousPurchasedItemId,
            invoiced: editForm.status === SHOPPING_LIST_INVOICED_STATUS || !!editForm.invoiced,
        });
    };

    const editJob = () => {
        setEditForm(item);
        setPhotoFile(null);
        setPhotoPreviewUrl("");
        setPhotoError("");
        setEdit(true);
    };

    const cancelEditJob = () => {
        setEditForm(item);
        setPhotoFile(null);
        setPhotoPreviewUrl("");
        setPhotoError("");
        setEdit(false);
    };

    const saveEditChanges = async () => {
        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                sourceCollection,
                shoppingItemId
            );

            const isJobItem = editForm.category === "Job";
            const isPersonalItem = editForm.category === "Personal";
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
                    itemId: shoppingItemId,
                });
            }

            const photoFields = photoFile
                ? itemPhotoFieldsFromUrl(uploadedPhoto.photoUrl, editForm.name || item.name || "Shopping item photo", uploadedPhoto.storagePath)
                : itemPhotoFieldsFromUrl(editForm.photoUrl, editForm.name || item.name || "Shopping item photo");
            const nextInvoiced = editForm.status === SHOPPING_LIST_INVOICED_STATUS || !!editForm.invoiced;
            const nextStatus = nextInvoiced ? SHOPPING_LIST_INVOICED_STATUS : editForm.status || "";
            const payload = {
                category: editForm.category || "",
                subCategory: editForm.subCategory || "",
                status: nextStatus,
                purchaserId: editForm.purchaserId || "",
                purchaserName: editForm.purchaserName || "",
                genericItemId: editForm.genericItemId || "",
                name: editForm.name || "",
                description: editForm.description || "",
                datePurchased: editForm.datePurchased
                    ? Timestamp.fromDate(new Date(editForm.datePurchased))
                    : null,
                quantity: editForm.quantity || "",
                jobId: isJobItem ? item.jobId || "" : "",
                jobName: isJobItem ? item.jobName || "" : "",
                customerId: isPersonalItem ? "" : isJobItem ? item.customerId || "" : editForm.customerId || "",
                customerName: isPersonalItem ? "" : isJobItem ? item.customerName || "" : editForm.customerName || "",
                userId: isPersonalItem ? editForm.userId || "" : "",
                userName:
                    isPersonalItem ? editForm.userName || "" : "",
                dbItemId: editForm.dbItemId || "",
                dbItemName: editForm.dbItemName || "",
                ...photoFields,
                purchasedItem: editForm.purchasedItem || "",
                invoiced: nextInvoiced,
                invoiceStatus: nextInvoiced ? "Invoiced" : "",
                serviceLocationId: isJobItem ? item.serviceLocationId || "" : editForm.serviceLocationId || "",
                serviceLocationName: isJobItem ? item.serviceLocationName || "" : editForm.serviceLocationName || "",
                plannedUnitCostCents: editForm.plannedUnitCostCents ?? null,
                plannedUnitPriceCents: editForm.plannedUnitPriceCents ?? null,
                plannedTotalCostCents: editForm.plannedTotalCostCents ?? null,
                plannedTotalPriceCents: editForm.plannedTotalPriceCents ?? null,
                customerApprovalRequired: !!editForm.customerApprovalRequired,
                customerApprovalStatus: editForm.customerApprovalStatus || "",
                partApprovalRequestId: editForm.partApprovalRequestId || "",
                needsAction: shoppingItemNeedsAction(nextStatus),
            };

            await updateDoc(docRef, payload);

            const previousPurchasedItemId = compactString(item.purchasedItem);
            const nextPurchasedItemId = compactString(editForm.purchasedItem);

            const { shoppingPayload } = await syncPurchasedItemConnection(previousPurchasedItemId, nextPurchasedItemId);
            const syncedPayload = {
                ...payload,
                ...shoppingPayload,
            };

            setItem({
                ...editForm,
                ...syncedPayload,
                jobId: syncedPayload.jobId,
                jobName: syncedPayload.jobName,
                customerId: syncedPayload.customerId,
                customerName: syncedPayload.customerName,
                userId: syncedPayload.userId,
                userName: syncedPayload.userName,
                serviceLocationId: syncedPayload.serviceLocationId,
                serviceLocationName: syncedPayload.serviceLocationName,
                ...photoFields,
                status: syncedPayload.status,
                invoiced: !!syncedPayload.invoiced,
                invoiceStatus: syncedPayload.invoiceStatus,
            });
            setPhotoFile(null);
            setPhotoPreviewUrl("");
            setPhotoError("");
            updatePurchasedItemOptionLinks(previousPurchasedItemId, nextPurchasedItemId);
            setEdit(false);
        } catch (error) {
            console.log("Error saving shopping list item");
            console.log(error);
        } finally {
            setUpdating(false);
        }
    };

    const openPurchasedItemModal = () => {
        setPurchasedItemSearch("");
        setPurchasedItemModalOpen(true);
    };

    const connectPurchasedItemFromModal = async (option) => {
        const nextPurchasedItemId = compactString(option?.id || option?.value);
        if (!recentlySelectedCompany || !shoppingItemId || !nextPurchasedItemId) return;

        try {
            setUpdating(true);
            setConnectingPurchasedItemId(nextPurchasedItemId);

            const previousPurchasedItemId = compactString(item.purchasedItem);
            const { shoppingPayload } = await syncPurchasedItemConnection(previousPurchasedItemId, nextPurchasedItemId);

            setItem((prev) => ({
                ...prev,
                purchasedItem: nextPurchasedItemId,
                ...shoppingPayload,
            }));
            setEditForm((prev) => ({
                ...prev,
                purchasedItem: nextPurchasedItemId,
                ...shoppingPayload,
            }));
            updatePurchasedItemOptionLinks(previousPurchasedItemId, nextPurchasedItemId);
            setPurchasedItemModalOpen(false);
        } catch (error) {
            console.log("Error connecting purchased item");
            console.log(error);
        } finally {
            setConnectingPurchasedItemId("");
            setUpdating(false);
        }
    };

    const clearPurchasedItemConnectionFromDetail = async () => {
        const previousPurchasedItemId = compactString(item.purchasedItem);
        if (!recentlySelectedCompany || !shoppingItemId || !previousPurchasedItemId) return;

        try {
            setUpdating(true);
            setConnectingPurchasedItemId(previousPurchasedItemId);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                sourceCollection,
                shoppingItemId
            );

            await updateDoc(docRef, {
                purchasedItem: "",
                updatedAt: Timestamp.now(),
            });
            await syncPurchasedItemConnection(previousPurchasedItemId, "");

            setItem((prev) => ({
                ...prev,
                purchasedItem: "",
            }));
            setEditForm((prev) => ({
                ...prev,
                purchasedItem: "",
            }));
            updatePurchasedItemOptionLinks(previousPurchasedItemId, "");
            setPurchasedItemModalOpen(false);
        } catch (error) {
            console.log("Error clearing purchased item connection");
            console.log(error);
        } finally {
            setConnectingPurchasedItemId("");
            setUpdating(false);
        }
    };

    const deleteJob = async () => {
        const linkedApprovalId = getShoppingItemPartApprovalId(item);
        const confirmed = await appConfirm({
            title: "Delete Item",
            message: linkedApprovalId
                ? "Delete this shopping list item and its connected part approval request? This cannot be undone."
                : "Are you sure you want to delete this item?",
            confirmLabel: "Delete Item",
            variant: "danger",
        });
        if (!confirmed) return;

        try {
            setUpdating(true);

            await deleteShoppingListItemWithLinks({
                db,
                companyId: recentlySelectedCompany,
                itemId: shoppingItemId,
                item,
                collectionName: sourceCollection,
            });
            navigate("/company/shopping-list");
        } catch (error) {
            console.log("Error deleting shopping list item");
            console.log(error);
        } finally {
            setUpdating(false);
        }
    };

    const displayDate = item.datePurchased
        ? format(new Date(item.datePurchased), "MM / d / yyyy")
        : "—";
    const displayName = item.name || item.dbItemName || "—";
    const partApprovalRequestId = getShoppingItemPartApprovalId(item);
    const displayPhotoUrl = edit ? photoPreviewUrl || editForm.photoUrl : item.photoUrl;
    const connectedPurchasedItemOption = purchasedItemOptions.find((option) => option.id === item.purchasedItem);
    const purchasedItemDisplayName = connectedPurchasedItemOption?.label || item.purchasedItem;
    const jobCustomerId = item.customerId || jobDetails?.customerId || "";
    const jobCustomerName = item.customerName || jobDetails?.customerName || "—";
    const jobServiceLocationId = item.serviceLocationId || jobDetails?.serviceLocationId || "";
    const jobServiceLocationName = item.serviceLocationName || jobDetails?.serviceLocationName || serviceLocationDetails?.nickName || serviceLocationDetails?.name || "";
    const jobServiceLocationAddress = formatAddress(serviceLocationDetails) || formatAddress(item.serviceLocationAddress) || formatAddress(jobDetails?.serviceLocationAddress) || formatAddress(jobDetails) || "—";
    const jobDetailLink = item.jobId ? `/company/jobs/detail/${item.jobId}` : "";
    const dbItemDetailLink = item.dbItemId ? `/company/items/detail/${item.dbItemId}` : "";
    const moneyFromCents = (value) => {
        if (value === null || value === undefined || value === "") return "—";
        const amount = Number(value);
        if (!Number.isFinite(amount)) return "—";
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format(amount / 100);
    };

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <Link
                            to="/company/shopping-list"
                            className="app-back-link"
                        >
                            &larr; Back to Shopping List
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">Shopping Item Detail</h2>
                        <p className="text-sm text-gray-500">{item.status || "Shopping item"}</p>
                    </div>

                    {!edit ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <ShareItemButton
                                type="shoppingListItem"
                                recordId={shoppingItemId}
                                title={item.name || item.itemName || item.description || "Shopping Item"}
                                subtitle={[item.customerName, item.jobName, item.status].filter(Boolean).join(" - ")}
                                companyId={recentlySelectedCompany}
                                customerId={item.customerId}
                                collectionPath={`companies/${recentlySelectedCompany}/${sourceCollection}`}
                                webPath={`/company/shopping-list/detail/${shoppingItemId}`}
                            />
                            <button
                                onClick={editJob}
                                className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700"
                            >
                                Edit
                            </button>
                            <button
                                onClick={deleteJob}
                                className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                            >
                                Delete
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={saveEditChanges}
                                className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700"
                            >
                                Save
                            </button>
                            <button
                                onClick={cancelEditJob}
                                className="rounded-md bg-gray-200 px-4 py-2 font-semibold text-gray-800 transition hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deleteJob}
                                className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Item Information</h3>

                            {isShoppingItemFromPartApproval(item) ? (
                                <div className="mb-4 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800">
                                    Created from Part Approval{" "}
                                    <Link to="/company/part-approvals" className="text-indigo-700 underline underline-offset-2">
                                        {partApprovalRequestId}
                                    </Link>
                                </div>
                            ) : null}

                            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                                        {displayPhotoUrl ? (
                                            <img src={displayPhotoUrl} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-400">
                                                Photo
                                            </div>
                                        )}
                                    </div>

                                    {edit ? (
                                        <div className="min-w-0 flex-1 space-y-3">
                                            <div>
                                                <p className="text-sm font-semibold text-gray-500 mb-1">Shopping Item Photo</p>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={handlePhotoFileChange}
                                                    className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                                                />
                                                {photoFile ? (
                                                    <p className="mt-1 text-xs text-slate-500">{photoFile.name} will upload when you save.</p>
                                                ) : null}
                                                {photoError ? (
                                                    <p className="mt-1 text-xs font-semibold text-red-600">{photoError}</p>
                                                ) : null}
                                            </div>

                                            <div>
                                                <p className="text-sm font-semibold text-gray-500 mb-1">Photo URL</p>
                                                <input
                                                    type="url"
                                                    value={editForm.photoUrl}
                                                    onChange={(e) => handleEditFieldChange("photoUrl", e.target.value)}
                                                    className="w-full rounded-md border border-slate-300 p-3"
                                                    placeholder="https://..."
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-gray-500">Photo</p>
                                            <p className="mt-1 break-all text-sm text-slate-600">
                                                {item.photoUrl || "No photo attached"}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Name</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.name}
                                            onChange={(e) => handleEditFieldChange("name", e.target.value)}
                                            className="w-full rounded-md border border-slate-300 p-3"
                                        />
                                    ) : (
                                        <p>{displayName}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Quantity</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.quantity}
                                            onChange={(e) => handleEditFieldChange("quantity", e.target.value)}
                                            className="w-full rounded-md border border-slate-300 p-3"
                                        />
                                    ) : (
                                        <p>{item.quantity || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Category</p>
                                    {edit ? (
                                        <select
                                            value={editForm.category}
                                            onChange={(e) => handleEditFieldChange("category", e.target.value)}
                                            className="w-full rounded-md border border-slate-300 bg-white p-3"
                                        >
                                            {categoryOptions.map((value) => (
                                                <option key={value} value={value}>
                                                    {value}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <p>{item.category || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Sub Category</p>
                                    {edit ? (
                                        <select
                                            value={editForm.subCategory}
                                            onChange={(e) => handleEditFieldChange("subCategory", e.target.value)}
                                            className="w-full rounded-md border border-slate-300 bg-white p-3"
                                        >
                                            {subCategoryOptions.map((value) => (
                                                <option key={value} value={value}>
                                                    {value}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <p>{item.subCategory || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Status</p>
                                    {edit ? (
                                        <select
                                            value={editForm.status}
                                            onChange={(e) => handleEditFieldChange("status", e.target.value)}
                                            className="w-full rounded-md border border-slate-300 bg-white p-3"
                                        >
                                            {statusOptions.map((value) => (
                                                <option key={value} value={value}>
                                                    {value}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <p>{item.status || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Customer Approval</p>
                                    {edit ? (
                                        <label className="flex items-center gap-2 text-gray-700 mt-3">
                                            <input
                                                type="checkbox"
                                                checked={!!editForm.customerApprovalRequired}
                                                onChange={(e) => handleEditFieldChange("customerApprovalRequired", e.target.checked)}
                                            />
                                            <span>Required</span>
                                        </label>
                                    ) : (
                                        <p>{item.customerApprovalRequired ? item.customerApprovalStatus || "pending" : "Not required"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Created From Part Approval</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.partApprovalRequestId}
                                            onChange={(e) => handleEditFieldChange("partApprovalRequestId", e.target.value)}
                                            className="w-full rounded-md border border-slate-300 p-3"
                                        />
                                    ) : partApprovalRequestId ? (
                                        <Link to="/company/part-approvals" className="font-semibold text-blue-600 hover:underline">
                                            {partApprovalRequestId}
                                        </Link>
                                    ) : (
                                        <p>—</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Date Purchased</p>
                                    {edit ? (
                                        <input
                                            type="date"
                                            value={editForm.datePurchased}
                                            onChange={(e) =>
                                                handleEditFieldChange("datePurchased", e.target.value)
                                            }
                                            className="w-full rounded-md border border-slate-300 p-3"
                                        />
                                    ) : (
                                        <p>{displayDate}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Generic Item ID</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.genericItemId}
                                            onChange={(e) =>
                                                handleEditFieldChange("genericItemId", e.target.value)
                                            }
                                            className="w-full rounded-md border border-slate-300 p-3"
                                        />
                                    ) : (
                                        <p>{item.genericItemId || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">DB Item Name</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.dbItemName}
                                            onChange={(e) => handleEditFieldChange("dbItemName", e.target.value)}
                                            className="w-full rounded-md border border-slate-300 p-3"
                                        />
                                    ) : dbItemDetailLink ? (
                                        <Link to={dbItemDetailLink} className="font-semibold text-blue-600 hover:underline">
                                            {item.dbItemName || "Open database item"}
                                        </Link>
                                    ) : (
                                        <p>{item.dbItemName || "—"}</p>
                                    )}
                                </div>
                            </div>

                            <div className="mt-4">
                                <p className="text-sm font-semibold text-gray-500 mb-1">Description</p>
                                {edit ? (
                                    <textarea
                                        value={editForm.description}
                                        onChange={(e) => handleEditFieldChange("description", e.target.value)}
                                        className="w-full min-h-[120px] rounded-md border border-slate-300 p-3"
                                    />
                                ) : (
                                    <p>{item.description || "—"}</p>
                                )}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Purchaser</h3>

                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Technician</p>
                                    {edit ? (
                                        <Select
                                            value={selectedPurchaserOption}
                                            options={companyUserOptions}
                                            onChange={handlePurchaserChange}
                                            isSearchable
                                            isClearable
                                            isLoading={loadingSelectors}
                                            placeholder="Select a technician"
                                            styles={selectStyles}
                                        />
                                    ) : (
                                        <p>{item.purchaserName || (item.purchaserId ? "Assigned technician" : "—")}</p>
                                    )}
                                </div>

                                {(edit ? editForm.purchaserId : item.purchaserId) ? (
                                    <p className="text-xs text-gray-500">
                                        ID: {edit ? editForm.purchaserId : item.purchaserId}
                                    </p>
                                ) : null}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Purchased Item Connection</h3>

                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Purchased Item</p>
                                    {edit ? (
                                        <Select
                                            value={selectedPurchasedItemOption}
                                            options={availablePurchasedItemOptions}
                                            onChange={handlePurchasedItemChange}
                                            isSearchable
                                            isClearable
                                            isLoading={loadingSelectors}
                                            placeholder="Select a purchased item"
                                            styles={selectStyles}
                                            noOptionsMessage={() => "No unconnected purchased items found"}
                                        />
                                    ) : item.purchasedItem ? (
                                        <Link
                                            to={`/company/purchased-items/detail/${item.purchasedItem}`}
                                            className="text-blue-600 hover:text-blue-800 font-medium break-all"
                                        >
                                            {purchasedItemDisplayName}
                                        </Link>
                                    ) : (
                                        <p>—</p>
                                    )}

                                    {!edit ? (
                                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                            <button
                                                type="button"
                                                onClick={openPurchasedItemModal}
                                                className="rounded-md bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-200"
                                            >
                                                {item.purchasedItem ? "Change Purchased Item" : "Connect Purchased Item"}
                                            </button>
                                            {item.purchasedItem ? (
                                                <button
                                                    type="button"
                                                    onClick={clearPurchasedItemConnectionFromDetail}
                                                    disabled={updating}
                                                    className="rounded-md bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                                                >
                                                    Clear Connection
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>

                                {(edit ? editForm.purchasedItem : item.purchasedItem) ? (
                                    <p className="text-xs text-gray-500">
                                        ID: {edit ? editForm.purchasedItem : item.purchasedItem}
                                    </p>
                                ) : null}

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Invoiced</p>
                                    {edit ? (
                                        <label className="flex items-center gap-2 text-gray-700 mt-3">
                                            <input
                                                type="checkbox"
                                                checked={!!editForm.invoiced}
                                                onChange={(e) =>
                                                    handleEditFieldChange("invoiced", e.target.checked)
                                                }
                                            />
                                            <span>Marked as invoiced</span>
                                        </label>
                                    ) : (
                                        <p>{item.invoiced ? "Yes" : "No"}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {editForm.category === "Job" || item.category === "Job" ? (
                            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Job</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Job</p>
                                        {item.jobId ? (
                                            <Link to={jobDetailLink} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Job", item.jobId, item.jobName)}
                                            </Link>
                                        ) : (
                                            <p>Not connected</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Job Name</p>
                                        {item.jobId ? (
                                            <Link to={jobDetailLink} className="font-semibold text-blue-600 hover:underline">
                                                {item.jobName || linkedReferenceText("Job", item.jobId)}
                                            </Link>
                                        ) : (
                                            <p>{item.jobName || "—"}</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Service Location</p>
                                        {jobDetailLink ? (
                                            <Link to={jobDetailLink} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Service Location", jobServiceLocationId, jobServiceLocationName)}
                                            </Link>
                                        ) : jobServiceLocationId ? (
                                            <Link to={`/company/serviceLocations/detail/${jobServiceLocationId}`} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Service Location", jobServiceLocationId, jobServiceLocationName)}
                                            </Link>
                                        ) : (
                                            <p>Not connected</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Service Location Name</p>
                                        {jobDetailLink ? (
                                            <Link to={jobDetailLink} className="font-semibold text-blue-600 hover:underline">
                                                {jobServiceLocationName || linkedReferenceText("Service Location", jobServiceLocationId)}
                                            </Link>
                                        ) : jobServiceLocationId ? (
                                            <Link to={`/company/serviceLocations/detail/${jobServiceLocationId}`} className="font-semibold text-blue-600 hover:underline">
                                                {jobServiceLocationName || linkedReferenceText("Service Location", jobServiceLocationId)}
                                            </Link>
                                        ) : (
                                            <p>{jobServiceLocationName || "—"}</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Customer Name</p>
                                        {jobDetailLink ? (
                                            <Link to={jobDetailLink} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Customer", jobCustomerId, jobCustomerName)}
                                            </Link>
                                        ) : jobCustomerId ? (
                                            <Link to={`/company/customers/details/${jobCustomerId}`} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Customer", jobCustomerId, jobCustomerName)}
                                            </Link>
                                        ) : (
                                            <p>{jobCustomerName}</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Service Location Address</p>
                                        {jobDetailLink && !loadingJobDetails ? (
                                            <Link to={jobDetailLink} className="font-semibold text-blue-600 hover:underline">
                                                {jobServiceLocationAddress}
                                            </Link>
                                        ) : (
                                            <p>{loadingJobDetails ? "Loading..." : jobServiceLocationAddress}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Planned Pricing</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Unit Cost</p>
                                    <p>{moneyFromCents(item.plannedUnitCostCents)}</p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Unit Billable</p>
                                    <p>{moneyFromCents(item.plannedUnitPriceCents)}</p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Total Cost</p>
                                    <p>{moneyFromCents(item.plannedTotalCostCents)}</p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Total Billable</p>
                                    <p>{moneyFromCents(item.plannedTotalPriceCents)}</p>
                                </div>
                            </div>
                        </div>

                        {editForm.category === "Customer" || item.category === "Customer" ? (
                            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Customer</h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Customer</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.customerId}
                                                onChange={(e) =>
                                                    handleEditFieldChange("customerId", e.target.value)
                                                }
                                                className="w-full rounded-md border border-slate-300 p-3"
                                            />
                                        ) : item.customerId ? (
                                            <Link to={`/company/customers/details/${item.customerId}`} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Customer", item.customerId, item.customerName)}
                                            </Link>
                                        ) : (
                                            <p>Not connected</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Customer Name</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.customerName}
                                                onChange={(e) =>
                                                    handleEditFieldChange("customerName", e.target.value)
                                                }
                                                className="w-full rounded-md border border-slate-300 p-3"
                                            />
                                        ) : (
                                            <p>{item.customerName || "—"}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {editForm.category === "Personal" || item.category === "Personal" ? (
                            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Personal</h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">User</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.userId}
                                                onChange={(e) => handleEditFieldChange("userId", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 p-3"
                                            />
                                        ) : (
                                            <p>{item.userName || (item.userId ? "Assigned user" : "—")}</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">User Name</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.userName}
                                                onChange={(e) => handleEditFieldChange("userName", e.target.value)}
                                                className="w-full rounded-md border border-slate-300 p-3"
                                            />
                                        ) : (
                                            <p>{item.userName || "—"}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Summary</h3>
                            <div className="space-y-3 text-gray-700">
                                <div className="flex justify-between">
                                    <span>Name:</span>
                                    <span>{displayName}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Category:</span>
                                    <span>{item.category || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Status:</span>
                                    <span>{item.status || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Purchaser:</span>
                                    <span>{item.purchaserName || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Quantity:</span>
                                    <span>{item.quantity || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Purchased Item:</span>
                                    {item.purchasedItem ? (
                                        <Link
                                            to={`/company/purchased-items/detail/${item.purchasedItem}`}
                                            className="text-blue-600 hover:text-blue-800 font-medium text-right break-all"
                                        >
                                            {purchasedItemDisplayName}
                                        </Link>
                                    ) : (
                                        <span>—</span>
                                    )}
                                </div>
                                <div className="flex justify-between">
                                    <span>Invoiced:</span>
                                    <span>{item.invoiced ? "Yes" : "No"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {purchasedItemModalOpen && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
                    <div className="mx-auto my-8 w-full max-w-3xl rounded-xl bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">Select Purchased Item</h3>
                                <p className="mt-1 text-sm text-gray-500">Search and connect a purchased item to this shopping list item.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPurchasedItemModalOpen(false)}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            {item.purchasedItem ? (
                                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Current connection</p>
                                    <p className="mt-1 text-sm font-semibold text-blue-900">
                                        {purchasedItemDisplayName || item.purchasedItem}
                                    </p>
                                </div>
                            ) : null}

                            <input
                                type="text"
                                value={purchasedItemSearch}
                                onChange={(event) => setPurchasedItemSearch(event.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-3 text-sm"
                                placeholder="Search purchased items..."
                            />

                            {loadingSelectors ? (
                                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                                    Loading purchased items...
                                </div>
                            ) : filteredPurchasedItemOptions.length ? (
                                <div className="max-h-[520px] space-y-2 overflow-y-auto">
                                    {filteredPurchasedItemOptions.map((option) => (
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
                                                onClick={() => connectPurchasedItemFromModal(option)}
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

            {(isLoading || updating) && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        {isLoading ? "Loading item..." : "Saving changes..."}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShoppingListDetailView;
