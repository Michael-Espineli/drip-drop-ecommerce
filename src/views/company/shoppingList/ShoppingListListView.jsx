import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query, Timestamp, updateDoc } from "firebase/firestore";
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

const statusOptions = ["Need to Purchase", "Needs Customer Approval", "Ready to Purchase", "Customer Rejected", "Purchased", "Delivered", "Installed"];

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
    const [shoppingList, setShoppingList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [companyUserOptions, setCompanyUserOptions] = useState([]);
    const [editingItem, setEditingItem] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
    const [photoError, setPhotoError] = useState("");

    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("All");
    const [statusFilter, setStatusFilter] = useState("All");

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
            const purchasedDate = editForm.datePurchasedInput
                ? new Date(`${editForm.datePurchasedInput}T00:00:00`)
                : null;
            const payload = {
                name: editForm.name || "",
                description: editForm.description || "",
                status: editForm.status || "",
                quantity: editForm.quantity || "",
                datePurchased: purchasedDate ? Timestamp.fromDate(purchasedDate) : null,
                purchaserId: editForm.purchaserId || "",
                purchaserName: editForm.purchaserName || "",
                needsAction: !["Delivered", "Installed"].includes(editForm.status),
                updatedAt: Timestamp.now(),
                ...photoFields,
            };

            await updateDoc(
                doc(db, "companies", recentlySelectedCompany, "shoppingList", editingItem.id),
                payload
            );

            setShoppingList((prev) => prev.map((item) => {
                if (item.id !== editingItem.id) return item;

                const nextItem = {
                    ...item,
                    ...payload,
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

    const filteredList = useMemo(() => {
        return shoppingList.filter((item) => {
            const matchesSearch =
                search.trim() === "" ||
                item.name.toLowerCase().includes(search.toLowerCase()) ||
                item.description.toLowerCase().includes(search.toLowerCase()) ||
                item.purchaserName.toLowerCase().includes(search.toLowerCase()) ||
                item.customerName.toLowerCase().includes(search.toLowerCase()) ||
                item.userName.toLowerCase().includes(search.toLowerCase()) ||
                item.jobName.toLowerCase().includes(search.toLowerCase()) ||
                item.linkedTaskName.toLowerCase().includes(search.toLowerCase()) ||
                item.serviceLocationName.toLowerCase().includes(search.toLowerCase()) ||
                item.serviceLocationAddress.toLowerCase().includes(search.toLowerCase()) ||
                item.contextLines.some((line) =>
                    line.value.toLowerCase().includes(search.toLowerCase())
                );

            const matchesCategory =
                categoryFilter === "All" || item.category === categoryFilter;

            const matchesStatus =
                statusFilter === "All" || item.status === statusFilter;

            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [shoppingList, search, categoryFilter, statusFilter]);

    return (
        <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
            <div className="w-full">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-800">Shopping List</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Manage shopping items by purchaser, customer, job, and status
                        </p>
                    </div>

                    <Link
                        to="/company/shopping-list/create"
                        className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                    >
                        New Item
                    </Link>
                </div>

                <div className="mb-6 rounded-lg bg-white p-4 shadow-lg">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search items..."
                            className="w-full p-3 border border-gray-300 rounded-lg"
                        />

                        <select
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                        >
                            <option value="All">All Categories</option>
                            <option value="Personal">Personal</option>
                            <option value="Customer">Customer</option>
                            <option value="Job">Job</option>
                        </select>

                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                        >
                            <option value="All">All Statuses</option>
                            <option value="Need to Purchase">Need to Purchase</option>
                            <option value="Needs Customer Approval">Needs Customer Approval</option>
                            <option value="Ready to Purchase">Ready to Purchase</option>
                            <option value="Customer Rejected">Customer Rejected</option>
                            <option value="Purchased">Purchased</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Installed">Installed</option>
                        </select>
                    </div>
                </div>

                <div className="max-w-full overflow-hidden rounded-lg bg-white shadow-lg">
                    {filteredList.length > 0 ? (
                        <div className="divide-y divide-gray-100">
                            {filteredList.map((item) => (
                                <div key={item.id} className="grid gap-4 p-4 transition hover:bg-blue-50/40 lg:grid-cols-[72px_minmax(0,1.35fr)_minmax(0,1fr)_minmax(140px,0.55fr)_auto] lg:items-center">
                                    <div className="h-16 w-16 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                                        {item.photoUrl ? (
                                            <img src={item.photoUrl} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-gray-400">
                                                Photo
                                            </div>
                                        )}
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-gray-900">{item.name || "Unnamed Item"}</p>
                                        {item.description ? (
                                            <p className="mt-1 line-clamp-2 text-sm text-gray-500">{item.description}</p>
                                        ) : null}
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                            <span className="rounded-md bg-gray-100 px-2 py-1 font-semibold text-gray-600">
                                                {item.category || "—"}
                                            </span>
                                            <span className="rounded-md bg-gray-100 px-2 py-1 font-semibold text-gray-600">
                                                {item.subCategory || "—"}
                                            </span>
                                            {item.customerApprovalRequired ? (
                                                <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                                                    Approval: {item.customerApprovalStatus || "pending"}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-gray-900">{item.forPrimary || "—"}</p>
                                        {item.contextLines.length ? (
                                            <div className="mt-1 space-y-0.5">
                                                {item.contextLines.map((line) => (
                                                    <p key={`${item.id}-${line.label}`} className="truncate text-xs text-gray-500">
                                                        <span className="font-semibold text-gray-600">{line.label}:</span>{" "}
                                                        {line.value}
                                                    </p>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 text-sm text-gray-700 lg:block lg:space-y-1">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Status</p>
                                            <p className="font-semibold text-gray-800">{item.status || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Qty</p>
                                            <p>{item.quantity || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Purchaser</p>
                                            <p>{item.purchaserName || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Purchased</p>
                                            <p>{item.datePurchased || "—"}</p>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2 lg:justify-end">
                                        <button
                                            type="button"
                                            onClick={() => openEditItem(item)}
                                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                                        >
                                            Edit
                                        </button>
                                        <Link
                                            to={`/company/shopping-list/detail/${item.id}`}
                                            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                                        >
                                            Details
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg m-6 p-6 text-center">
                            No shopping list items found.
                        </div>
                    )}
                </div>
            </div>

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
