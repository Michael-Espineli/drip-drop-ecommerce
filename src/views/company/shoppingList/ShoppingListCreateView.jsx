import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    collection,
    doc,
    getDocs,
    orderBy,
    query,
    setDoc,
    Timestamp,
    where,
} from "firebase/firestore";
import Select from "react-select";
import { v4 as uuidv4 } from "uuid";
import { db, storage } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
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
    SHOPPING_LIST_STATUS,
    SHOPPING_LIST_STATUS_OPTIONS,
    canonicalShoppingListStatus,
} from "../../../utils/shoppingListStatus";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";
import {
    getProductDisplayName,
    getProductSellPriceCents,
    productCatalogCollectionRef,
} from "../../../utils/productCatalog";

const categoryOptions = [
    { value: "Personal", label: "Personal" },
    { value: "Customer", label: "Customer" },
    { value: "Job", label: "Job" },
];

const subCategoryOptions = [
    { value: "Product", label: "Product" },
    { value: "Chemical", label: "Chemical" },
    { value: "Part", label: "Part" },
    { value: "Custom", label: "Custom" },
];

const statusOptions = SHOPPING_LIST_STATUS_OPTIONS.map((status) => ({ value: status, label: status }));

const selectStyles = {
    control: (provided) => ({
        ...provided,
        backgroundColor: "white",
        border: "1px solid #d1d5db",
        borderRadius: "0.5rem",
        padding: "0.2rem",
        minHeight: "46px",
        boxShadow: "none",
    }),
    menu: (provided) => ({
        ...provided,
        zIndex: 50,
        borderRadius: "0.75rem",
        overflow: "hidden",
    }),
    valueContainer: (provided) => ({
        ...provided,
        paddingLeft: "0.5rem",
        paddingRight: "0.5rem",
    }),
};

const ShoppingListCreateView = () => {
    const { recentlySelectedCompany, shoppingItemInstallInvoiceAutomationEnabled } = useContext(Context);
    const navigate = useNavigate();

    const [saving, setSaving] = useState(false);
    const [loadingSelectors, setLoadingSelectors] = useState(true);

    const [companyUserList, setCompanyUserList] = useState([]);
    const [customerList, setCustomerList] = useState([]);
    const [jobList, setJobList] = useState([]);
    const [dbItemList, setDbItemList] = useState([]);

    const [selectedPurchaser, setSelectedPurchaser] = useState(null);
    const [selectedCompanyUser, setSelectedCompanyUser] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedJob, setSelectedJob] = useState(null);
    const [selectedDbItem, setSelectedDbItem] = useState(null);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
    const [photoError, setPhotoError] = useState("");

    const [formData, setFormData] = useState({
        category: "Personal",
        subCategory: "Custom",
        status: SHOPPING_LIST_STATUS.needToPurchase,
        purchaserId: "",
        purchaserName: "",
        genericItemId: "",
        productId: "",
        productName: "",
        name: "",
        description: "",
        datePurchased: "",
        quantity: "",

        jobId: "",
        jobName: "",
        serviceLocationId: "",
        serviceLocationName: "",

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
        manualInvoiceNote: "",
        autoInvoiceOnInstall: false,
    });

    useEffect(() => {
        setFormData((prev) => ({
            ...prev,
            autoInvoiceOnInstall: shoppingItemInstallInvoiceAutomationEnabled === true,
        }));
    }, [shoppingItemInstallInvoiceAutomationEnabled]);

    useEffect(() => {
        fetchSelectorData();
    }, [recentlySelectedCompany]);

    useEffect(() => {
        return () => {
            if (photoPreviewUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(photoPreviewUrl);
            }
        };
    }, [photoPreviewUrl]);

    const fetchSelectorData = async () => {
        try {
            setLoadingSelectors(true);

            const companyUsersPromise = getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "companyUsers"),
                    orderBy("userName")
                )
            );

            const customersPromise = getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "customers"),
                    where("active", "==", true),
                    orderBy("firstName")
                )
            );

            const jobsPromise = getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "workOrders"),
                    orderBy("internalId")
                )
            );

            const itemsPromise = getDocs(
                query(
                    productCatalogCollectionRef(db, recentlySelectedCompany),
                    orderBy("commonName")
                )
            );

            const [companyUsersSnap, customersSnap, jobsSnap, itemsSnap] =
                await Promise.all([
                    companyUsersPromise,
                    customersPromise,
                    jobsPromise,
                    itemsPromise,
                ]);

            const companyUsers = sortCompanyUsersByName(companyUsersSnap.docs.map((docSnap) => {
                const data = docSnap.data();
                const name = getCompanyUserDisplayName(data, "Unnamed User");

                return {
                    ...data,
                    id: data.id || docSnap.id,
                    name,
                    customerId: data.customerId || "",
                    customerName: data.customerName || "",
                    serviceLocationId: data.serviceLocationId || "",
                    serviceLocationName: data.serviceLocationName || "",
                    label: name,
                    value: data.id || docSnap.id,
                };
            }));

            const customers = customersSnap.docs.map((docSnap) => {
                const data = docSnap.data();

                let customerName = "";
                if (data.displayAsCompany) {
                    customerName = data.company || data.companyName || "Unnamed Customer";
                } else {
                    customerName =
                        `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
                        "Unnamed Customer";
                }

                return {
                    id: data.id || docSnap.id,
                    name: customerName,
                    label: customerName,
                    value: data.id || docSnap.id,
                };
            });

            const jobs = jobsSnap.docs.map((docSnap) => {
                const data = docSnap.data();
                const name =
                    data.internalId ||
                    data.description ||
                    data.name ||
                    data.jobName ||
                    data.title ||
                    data.invoiceTitle ||
                    "Unnamed Job";

                return {
                    id: data.id || docSnap.id,
                    name,
                    label: name,
                    value: data.id || docSnap.id,
                };
            });

            const items = itemsSnap.docs.map((docSnap) => {
                const data = docSnap.data();
                const productId = data.id || docSnap.id;
                const name = getProductDisplayName({ ...data, id: productId });
                const sellPrice = getProductSellPriceCents(data);

                return {
                    ...data,
                    id: productId,
                    name,
                    description: data.description || "",
                    genericItemId: productId,
                    productId,
                    productName: name,
                    dbItemId: "",
                    rate: Number(data.rate || 0),
                    sellPrice,
                    cost: Number(data.cost || data.rate || 0),
                    photoUrl: getItemPhotoUrl(data),
                    imageUrl: data.imageUrl || data.imageURL || "",
                    primaryPhotoUrl: data.primaryPhotoUrl || "",
                    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
                    label: name,
                    value: productId,
                };
            });

            setCompanyUserList(companyUsers);
            setCustomerList(customers);
            setJobList(jobs);
            setDbItemList(items);
        } catch (error) {
            console.log("Error loading selector data");
            console.log(error);
        } finally {
            setLoadingSelectors(false);
        }
    };

    const handleChange = (field, value) => {
        setFormData((prev) => ({
            ...prev,
            [field]: value,
            ...(field === "invoiced"
                ? {
                    status: value
                        ? SHOPPING_LIST_INVOICED_STATUS
                        : prev.status === SHOPPING_LIST_INVOICED_STATUS
                            ? SHOPPING_LIST_STATUS.purchased
                            : prev.status,
                }
                : {}),
            ...(field === "status"
                ? {
                    status: canonicalShoppingListStatus(value),
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

    const handleCategoryChange = (value) => {
        setFormData((prev) => ({
            ...prev,
            category: value,
            jobId: "",
            jobName: "",
            serviceLocationId: "",
            serviceLocationName: "",
            customerId: "",
            customerName: "",
            userId: "",
            userName: "",
        }));

        setSelectedCompanyUser(null);
        setSelectedCustomer(null);
        setSelectedJob(null);
    };

    const handleSubCategoryChange = (value) => {
        const nextData = {
            ...formData,
            subCategory: value,
        };

        if (value === "Product" || value === "Data Base") {
            nextData.name = "";
            nextData.description = "";
        } else {
            nextData.dbItemId = "";
            nextData.dbItemName = "";
            nextData.genericItemId = "";
            nextData.productId = "";
            nextData.productName = "";
            nextData.photoUrl = "";
            nextData.imageUrl = "";
            nextData.primaryPhotoUrl = "";
            nextData.photoUrls = [];
            setSelectedDbItem(null);
        }

        setFormData(nextData);
    };

    const handlePurchaserChange = (option) => {
        setSelectedPurchaser(option);
        setFormData((prev) => ({
            ...prev,
            purchaserId: option?.id || "",
            purchaserName: option?.name || "",
        }));
    };

    const handleCompanyUserChange = (option) => {
        setSelectedCompanyUser(option);
        setFormData((prev) => ({
            ...prev,
            userId: option?.id || "",
            userName: option?.name || "",
        }));
    };

    const handleCustomerChange = (option) => {
        setSelectedCustomer(option);
        setFormData((prev) => ({
            ...prev,
            customerId: option?.id || "",
            customerName: option?.name || "",
        }));
    };

    const handleJobChange = (option) => {
        setSelectedJob(option);
        setFormData((prev) => ({
            ...prev,
            jobId: option?.id || "",
            jobName: option?.name || "",
            customerId: option?.customerId || "",
            customerName: option?.customerName || "",
            serviceLocationId: option?.serviceLocationId || "",
            serviceLocationName: option?.serviceLocationName || "",
        }));
    };

    const handleDbItemChange = (option) => {
        setSelectedDbItem(option);
        const photoFields = option ? itemPhotoFieldsFromSource(option, option.name || "Shopping item photo") : itemPhotoFieldsFromUrl("");
        setFormData((prev) => ({
            ...prev,
            dbItemId: "",
            dbItemName: "",
            genericItemId: option?.productId || option?.genericItemId || option?.id || "",
            productId: option?.productId || option?.id || "",
            productName: option?.name || "",
            name: option?.name || "",
            description: option?.description || "",
            ...photoFields,
        }));
        setPhotoFile(null);
        setPhotoPreviewUrl("");
        setPhotoError("");
    };

    const requiresDbItem = formData.subCategory === "Product" || formData.subCategory === "Data Base";
    const requiresManualDetails = !requiresDbItem;

    const canSave = useMemo(() => {
        const hasPurchaser = formData.purchaserName.trim() !== "";
        const hasName = requiresDbItem
            ? (formData.productId || formData.genericItemId).trim() !== ""
            : formData.name.trim() !== "";

        const hasCategoryTarget =
            (formData.category === "Personal" && formData.userId.trim() !== "") ||
            (formData.category === "Customer" && formData.customerId.trim() !== "") ||
            (formData.category === "Job" && formData.jobId.trim() !== "");

        return hasPurchaser && hasName && hasCategoryTarget;
    }, [formData, requiresDbItem]);

    const handleCreate = async (e) => {
        e.preventDefault();

        if (!canSave) return;

        try {
            setSaving(true);
            const id = "comp_shop_" + uuidv4();
            const qty = Number(formData.quantity || 0);
            const plannedUnitCostCents = requiresDbItem
                ? Number(selectedDbItem?.rate || selectedDbItem?.cost || 0)
                : 0;
            const plannedUnitPriceCents = requiresDbItem
                ? Number(selectedDbItem?.sellPrice || selectedDbItem?.rate || selectedDbItem?.cost || 0)
                : 0;
            const plannedTotalCostCents = Math.round(plannedUnitCostCents * qty);
            const plannedTotalPriceCents = Math.round(plannedUnitPriceCents * qty);
            let uploadedPhoto = {
                photoUrl: formData.photoUrl || "",
                storagePath: "",
            };

            if (photoFile) {
                uploadedPhoto = await uploadItemPhoto({
                    storage,
                    companyId: recentlySelectedCompany,
                    file: photoFile,
                    itemType: "shoppingItems",
                    itemId: id,
                });
            }

            const photoFields = photoFile
                ? itemPhotoFieldsFromUrl(uploadedPhoto.photoUrl, formData.name || "Shopping item photo", uploadedPhoto.storagePath)
                : itemPhotoFieldsFromUrl(formData.photoUrl, formData.name || "Shopping item photo");
            const nextInvoiced = formData.status === SHOPPING_LIST_INVOICED_STATUS || !!formData.invoiced;
            const nextStatus = nextInvoiced ? SHOPPING_LIST_INVOICED_STATUS : canonicalShoppingListStatus(formData.status);
            const prepKeys = Array.from(
                new Set(
                    [
                        formData.userId ? `user:${formData.userId}` : "",
                        formData.jobId ? `job:${formData.jobId}` : "",
                        formData.customerId ? `customer:${formData.customerId}` : "",
                        formData.serviceLocationId ? `serviceLocation:${formData.serviceLocationId}` : "",
                    ].filter(Boolean)
                )
            );

            const payload = {
                id,
                category: formData.category,
                subCategory: formData.subCategory,
                status: nextStatus,
                purchaserId: formData.purchaserId || "",
                purchaserName: formData.purchaserName || "",
                genericItemId: requiresDbItem ? formData.productId || formData.genericItemId || "" : formData.genericItemId || "",
                productId: requiresDbItem ? formData.productId || formData.genericItemId || "" : "",
                productName: requiresDbItem ? selectedDbItem?.name || formData.productName || formData.name || "" : "",
                name: requiresDbItem ? selectedDbItem?.name || formData.name || "" : formData.name || "",
                description: formData.description || "",
                datePurchased: formData.datePurchased
                    ? Timestamp.fromDate(new Date(formData.datePurchased))
                    : null,
                quantity: formData.quantity || "",
                jobId: formData.category === "Job" ? formData.jobId || "" : "",
                jobName: formData.category === "Job" ? formData.jobName || "" : "",
                customerId: formData.category === "Personal" ? "" : formData.customerId || "",
                customerName: formData.category === "Personal" ? "" : formData.customerName || "",
                userId: formData.category === "Personal" ? formData.userId || "" : "",
                userName:
                    formData.category === "Personal" ? formData.userName || "" : "",
                dbItemId: "",
                dbItemName: "",
                purchasedItem: formData.purchasedItem || "",
                invoiced: nextInvoiced,
                invoiceStatus: nextInvoiced ? "Invoiced" : "",
                manualInvoiceNote: nextInvoiced ? formData.manualInvoiceNote || "" : "",
                serviceLocationId: formData.serviceLocationId || "",
                serviceLocationName: formData.serviceLocationName || "",
                prepKeys,
                needsAction: shoppingItemNeedsAction(nextStatus),
                autoInvoiceOnInstall: nextInvoiced ? false : formData.autoInvoiceOnInstall === true,
                autoInvoiceOnInstallDefaultedFromCompany: shoppingItemInstallInvoiceAutomationEnabled === true,
                actionDate: Timestamp.now(),
                assignedTechIds: [],
                plannedUnitCostCents,
                plannedUnitPriceCents,
                plannedTotalCostCents,
                plannedTotalPriceCents,
                itemId: requiresDbItem ? formData.productId || formData.genericItemId || "" : "",
                itemType: formData.subCategory,
                cost: plannedUnitCostCents,
                price: plannedUnitPriceCents,
                ...photoFields,
                createdAt: Timestamp.now(),
            };

            await setDoc(
                doc(db, "companies", recentlySelectedCompany, "shoppingList", id),
                payload
            );

            if (payload.purchasedItem) {
                await syncLinkedShoppingPurchase({
                    db,
                    companyId: recentlySelectedCompany,
                    shoppingItemId: id,
                    purchasedItemId: payload.purchasedItem,
                    shoppingItemData: payload,
                    invoiced: payload.invoiced,
                });
            }

            navigate(`/company/shopping-list/detail/${id}`);
        } catch (error) {
            console.log("Error creating shopping list item");
            console.log(error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <Link
                            to="/company/shopping-list"
                            className="app-back-link"
                        >
                            &larr; Back to Shopping List
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">
                            New Shopping List Item
                        </h2>
                    </div>
                </div>

                <form onSubmit={handleCreate} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                Item Information
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Category
                                    </label>
                                    <select
                                        value={formData.category}
                                        onChange={(e) => handleCategoryChange(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                                    >
                                        {categoryOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Sub Category
                                    </label>
                                    <select
                                        value={formData.subCategory}
                                        onChange={(e) => handleSubCategoryChange(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                                    >
                                        {subCategoryOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Status
                                    </label>
                                    <select
                                        value={formData.status}
                                        onChange={(e) => handleChange("status", e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                                    >
                                        {statusOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Quantity
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.quantity}
                                        onChange={(e) => handleChange("quantity", e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg"
                                        placeholder="Quantity"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Date Purchased
                                    </label>
                                    <input
                                        type="date"
                                        value={formData.datePurchased}
                                        onChange={(e) => handleChange("datePurchased", e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Product ID
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.genericItemId}
                                        onChange={(e) => handleChange("genericItemId", e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg"
                                        placeholder="Product id"
                                        disabled={requiresDbItem}
                                    />
                                </div>
                            </div>

                            {requiresDbItem && (
                                <div className="mt-4">
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Product
                                    </label>
                                    <Select
                                        value={selectedDbItem}
                                        options={dbItemList}
                                        onChange={handleDbItemChange}
                                        isSearchable
                                        isClearable
                                        placeholder="Select a Product"
                                        styles={selectStyles}
                                    />
                                </div>
                            )}

                            {requiresManualDetails && (
                                <div className="mt-4 grid grid-cols-1 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Name
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={(e) => handleChange("name", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                            placeholder="Enter custom item name"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Description
                                        </label>
                                        <textarea
                                            value={formData.description}
                                            onChange={(e) => handleChange("description", e.target.value)}
                                            className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg"
                                            placeholder="Enter custom item description"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white">
                                        {photoPreviewUrl || formData.photoUrl ? (
                                            <img
                                                src={photoPreviewUrl || formData.photoUrl}
                                                alt=""
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-gray-400">
                                                Photo
                                            </div>
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-500 mb-2">
                                                Shopping Item Photo
                                            </label>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={handlePhotoFileChange}
                                                className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                                            />
                                            {photoFile ? (
                                                <p className="mt-1 text-xs text-gray-500">{photoFile.name} will upload when you create.</p>
                                            ) : null}
                                            {photoError ? (
                                                <p className="mt-1 text-xs font-semibold text-red-600">{photoError}</p>
                                            ) : null}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-500 mb-2">
                                                Photo URL
                                            </label>
                                            <input
                                                type="url"
                                                value={formData.photoUrl}
                                                onChange={(e) => handleChange("photoUrl", e.target.value)}
                                                className="w-full p-3 border border-gray-300 rounded-lg"
                                                placeholder="https://..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {formData.category === "Job" && (
                            <div className="bg-white p-6 rounded-xl shadow-lg">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Job</h3>

                                <label className="block text-sm font-semibold text-gray-500 mb-2">
                                    Select Job
                                </label>
                                <Select
                                    value={selectedJob}
                                    options={jobList}
                                    onChange={handleJobChange}
                                    isSearchable
                                    isClearable
                                    placeholder="Select a job"
                                    styles={selectStyles}
                                />
                            </div>
                        )}

                        {formData.category === "Customer" && (
                            <div className="bg-white p-6 rounded-xl shadow-lg">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Customer</h3>

                                <label className="block text-sm font-semibold text-gray-500 mb-2">
                                    Select Customer
                                </label>
                                <Select
                                    value={selectedCustomer}
                                    options={customerList}
                                    onChange={handleCustomerChange}
                                    isSearchable
                                    isClearable
                                    placeholder="Select a customer"
                                    styles={selectStyles}
                                />
                            </div>
                        )}

                        {formData.category === "Personal" && (
                            <div className="bg-white p-6 rounded-xl shadow-lg">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Personal</h3>

                                <label className="block text-sm font-semibold text-gray-500 mb-2">
                                    Select Company User
                                </label>
                                <Select
                                    value={selectedCompanyUser}
                                    options={companyUserList}
                                    onChange={handleCompanyUserChange}
                                    isSearchable
                                    isClearable
                                    placeholder="Select a company user"
                                    styles={selectStyles}
                                />
                            </div>
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Purchaser</h3>

                            <label className="block text-sm font-semibold text-gray-500 mb-2">
                                Select Purchaser
                            </label>
                            <Select
                                value={selectedPurchaser}
                                options={companyUserList}
                                onChange={handlePurchaserChange}
                                isSearchable
                                isClearable
                                placeholder="Select a company user"
                                styles={selectStyles}
                            />
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                Purchased Item Connection
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Purchased Item ID
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.purchasedItem}
                                        onChange={(e) => handleChange("purchasedItem", e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg"
                                        placeholder="Purchased item document id"
                                    />
                                </div>

                                <div>
                                    <label className="flex items-center gap-2 text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={!!formData.invoiced}
                                            onChange={(e) => handleChange("invoiced", e.target.checked)}
                                        />
                                        <span>Marked as invoiced</span>
                                    </label>
                                </div>

                                {formData.invoiced || formData.status === SHOPPING_LIST_INVOICED_STATUS ? (
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Invoice Note
                                        </label>
                                        <textarea
                                            value={formData.manualInvoiceNote}
                                            onChange={(e) => handleChange("manualInvoiceNote", e.target.value)}
                                            className="min-h-[88px] w-full rounded-lg border border-gray-300 p-3"
                                            placeholder="Optional note for manually marked invoices"
                                        />
                                    </div>
                                ) : null}

                                <div>
                                    <label className="flex items-start gap-2 text-gray-700">
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={!!formData.autoInvoiceOnInstall}
                                            onChange={(e) => handleChange("autoInvoiceOnInstall", e.target.checked)}
                                            disabled={formData.invoiced || formData.status === SHOPPING_LIST_INVOICED_STATUS}
                                        />
                                        <span>
                                            <span className="block font-semibold">Auto invoice when installed</span>
                                            <span className="block text-xs text-gray-500">Creates and sends a sales invoice when this item is marked installed.</span>
                                        </span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Actions</h3>
                            <div className="space-y-3">
                                <button
                                    type="submit"
                                    disabled={!canSave || saving}
                                    className="block w-full text-center py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                                >
                                    {saving ? "Creating..." : "Create Item"}
                                </button>

                                <Link
                                    to="/company/shopping-list"
                                    className="block w-full text-center py-3 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                                >
                                    Cancel
                                </Link>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Summary</h3>
                            <div className="space-y-3 text-gray-700 text-sm">
                                <div className="flex justify-between">
                                    <span>Category:</span>
                                    <span>{formData.category || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Sub Category:</span>
                                    <span>{formData.subCategory || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Status:</span>
                                    <span>{formData.status || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Name:</span>
                                    <span className="text-right">{formData.name || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Quantity:</span>
                                    <span>{formData.quantity || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Purchaser:</span>
                                    <span className="text-right">{formData.purchaserName || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Purchased Item:</span>
                                    <span className="text-right">{formData.purchasedItem || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Invoiced:</span>
                                    <span>{formData.invoiced ? "Yes" : "No"}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <span>Auto invoice:</span>
                                    <span className="text-right">{formData.autoInvoiceOnInstall ? "When installed" : "Off"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            {(saving || loadingSelectors) && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        {saving ? "Creating item..." : "Loading form..."}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShoppingListCreateView;
