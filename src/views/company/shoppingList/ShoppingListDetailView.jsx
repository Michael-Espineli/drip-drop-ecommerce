import React, { useContext, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteDoc, doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import { linkedReferenceText } from "../../../utils/displayReferences";

const categoryOptions = ["Personal", "Customer", "Job"];
const subCategoryOptions = ["Data Base", "Chemical", "Part", "Custom"];
const statusOptions = ["Need to Purchase", "Needs Customer Approval", "Ready to Purchase", "Customer Rejected", "Purchased", "Installed"];
const shoppingListCollectionNames = ["shoppingList", "shoppingListItems"];

const ShoppingListDetailView = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { shoppingItemId } = useParams();
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [edit, setEdit] = useState(false);
    const [sourceCollection, setSourceCollection] = useState("shoppingList");

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
        purchasedItem: "",
        invoiced: false,
        serviceLocationId: "",
        serviceLocationName: "",
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
        purchasedItem: "",
        invoiced: false,
        serviceLocationId: "",
        serviceLocationName: "",
        plannedUnitCostCents: null,
        plannedUnitPriceCents: null,
        plannedTotalCostCents: null,
        plannedTotalPriceCents: null,
        customerApprovalRequired: false,
        customerApprovalStatus: "",
        partApprovalRequestId: "",
    });

    useEffect(() => {
        fetchItem();
    }, [recentlySelectedCompany, shoppingItemId]);

    const fetchItem = async () => {
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
                    purchasedItem: data.purchasedItem || "",
                    invoiced: !!data.invoiced,
                    serviceLocationId: data.serviceLocationId || "",
                    serviceLocationName: data.serviceLocationName || "",
                    plannedUnitCostCents: data.plannedUnitCostCents ?? data.cost ?? null,
                    plannedUnitPriceCents: data.plannedUnitPriceCents ?? data.price ?? null,
                    plannedTotalCostCents: data.plannedTotalCostCents ?? null,
                    plannedTotalPriceCents: data.plannedTotalPriceCents ?? null,
                    customerApprovalRequired: !!data.customerApprovalRequired,
                    customerApprovalStatus: data.customerApprovalStatus || "",
                    partApprovalRequestId: data.partApprovalRequestId || data.approvalRequestId || "",
                };

                setItem(loadedItem);
                setEditForm(loadedItem);
            } else {
                console.log("No such shopping list item!");
            }
        } catch (error) {
            console.log("Error loading shopping list item");
            console.log(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditFieldChange = (field, value) => {
        setEditForm((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const editJob = () => {
        setEditForm(item);
        setEdit(true);
    };

    const cancelEditJob = () => {
        setEditForm(item);
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

            const payload = {
                category: editForm.category || "",
                subCategory: editForm.subCategory || "",
                status: editForm.status || "",
                purchaserId: editForm.purchaserId || "",
                purchaserName: editForm.purchaserName || "",
                genericItemId: editForm.genericItemId || "",
                name: editForm.name || "",
                description: editForm.description || "",
                datePurchased: editForm.datePurchased
                    ? Timestamp.fromDate(new Date(editForm.datePurchased))
                    : null,
                quantity: editForm.quantity || "",
                jobId: editForm.category === "Job" ? editForm.jobId || "" : "",
                jobName: editForm.category === "Job" ? editForm.jobName || "" : "",
                customerId: editForm.category === "Personal" ? "" : editForm.customerId || "",
                customerName: editForm.category === "Personal" ? "" : editForm.customerName || "",
                userId: editForm.category === "Personal" ? editForm.userId || "" : "",
                userName:
                    editForm.category === "Personal" ? editForm.userName || "" : "",
                dbItemId: editForm.dbItemId || "",
                dbItemName: editForm.dbItemName || "",
                purchasedItem: editForm.purchasedItem || "",
                invoiced: !!editForm.invoiced,
                serviceLocationId: editForm.serviceLocationId || "",
                serviceLocationName: editForm.serviceLocationName || "",
                plannedUnitCostCents: editForm.plannedUnitCostCents ?? null,
                plannedUnitPriceCents: editForm.plannedUnitPriceCents ?? null,
                plannedTotalCostCents: editForm.plannedTotalCostCents ?? null,
                plannedTotalPriceCents: editForm.plannedTotalPriceCents ?? null,
                customerApprovalRequired: !!editForm.customerApprovalRequired,
                customerApprovalStatus: editForm.customerApprovalStatus || "",
                partApprovalRequestId: editForm.partApprovalRequestId || "",
            };

            await updateDoc(docRef, payload);

            setItem({
                ...editForm,
                invoiced: !!editForm.invoiced,
            });
            setEdit(false);
        } catch (error) {
            console.log("Error saving shopping list item");
            console.log(error);
        } finally {
            setUpdating(false);
        }
    };

    const deleteJob = async () => {
        const confirmed = window.confirm("Are you sure you want to delete this item?");
        if (!confirmed) return;

        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                sourceCollection,
                shoppingItemId
            );

            await deleteDoc(docRef);
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
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <Link
                            to="/company/shopping-list"
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back to Shopping List
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">Shopping Item Detail</h2>
                    </div>

                    {!edit ? (
                        <button
                            onClick={editJob}
                            className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                        >
                            Edit
                        </button>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={saveEditChanges}
                                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                            >
                                Save
                            </button>
                            <button
                                onClick={cancelEditJob}
                                className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deleteJob}
                                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Item Information</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Name</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.name}
                                            onChange={(e) => handleEditFieldChange("name", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
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
                                            className="w-full p-3 border border-gray-300 rounded-lg"
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
                                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
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
                                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
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
                                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
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
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Approval Request</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.partApprovalRequestId}
                                            onChange={(e) => handleEditFieldChange("partApprovalRequestId", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    ) : item.partApprovalRequestId ? (
                                        <Link to="/company/part-approvals" className="font-semibold text-blue-600 hover:underline">
                                            {item.partApprovalRequestId}
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
                                            className="w-full p-3 border border-gray-300 rounded-lg"
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
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{item.genericItemId || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">DB Item ID</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.dbItemId}
                                            onChange={(e) => handleEditFieldChange("dbItemId", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{item.dbItemId || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">DB Item Name</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.dbItemName}
                                            onChange={(e) => handleEditFieldChange("dbItemName", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
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
                                        className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg"
                                    />
                                ) : (
                                    <p>{item.description || "—"}</p>
                                )}
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Purchaser</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Purchaser ID</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.purchaserId}
                                            onChange={(e) => handleEditFieldChange("purchaserId", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{item.purchaserId || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Purchaser Name</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.purchaserName}
                                            onChange={(e) => handleEditFieldChange("purchaserName", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{item.purchaserName || "—"}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Purchased Item Connection</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Purchased Item ID</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.purchasedItem}
                                            onChange={(e) => handleEditFieldChange("purchasedItem", e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                            placeholder="Purchased item document id"
                                        />
                                    ) : item.purchasedItem ? (
                                        <Link
                                            to={`/company/purchased-items/detail/${item.purchasedItem}`}
                                            className="text-blue-600 hover:text-blue-800 font-medium break-all"
                                        >
                                            {item.purchasedItem}
                                        </Link>
                                    ) : (
                                        <p>—</p>
                                    )}
                                </div>

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
                            <div className="bg-white p-6 rounded-xl shadow-lg">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Job</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Job</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.jobId}
                                                onChange={(e) => handleEditFieldChange("jobId", e.target.value)}
                                                className="w-full p-3 border border-gray-300 rounded-lg"
                                            />
                                        ) : item.jobId ? (
                                            <Link to={`/company/jobs/detail/${item.jobId}`} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Job", item.jobId, item.jobName)}
                                            </Link>
                                        ) : (
                                            <p>Not connected</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Job Name</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.jobName}
                                                onChange={(e) => handleEditFieldChange("jobName", e.target.value)}
                                                className="w-full p-3 border border-gray-300 rounded-lg"
                                            />
                                        ) : (
                                            <p>{item.jobName || "—"}</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Service Location</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.serviceLocationId}
                                                onChange={(e) => handleEditFieldChange("serviceLocationId", e.target.value)}
                                                className="w-full p-3 border border-gray-300 rounded-lg"
                                            />
                                        ) : item.serviceLocationId ? (
                                            <Link to={`/company/serviceLocations/detail/${item.serviceLocationId}`} className="font-semibold text-blue-600 hover:underline">
                                                {linkedReferenceText("Service Location", item.serviceLocationId, item.serviceLocationName)}
                                            </Link>
                                        ) : (
                                            <p>Not connected</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">Service Location</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.serviceLocationName}
                                                onChange={(e) => handleEditFieldChange("serviceLocationName", e.target.value)}
                                                className="w-full p-3 border border-gray-300 rounded-lg"
                                            />
                                        ) : (
                                            <p>{item.serviceLocationName || "—"}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="bg-white p-6 rounded-xl shadow-lg">
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
                            <div className="bg-white p-6 rounded-xl shadow-lg">
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
                                                className="w-full p-3 border border-gray-300 rounded-lg"
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
                                                className="w-full p-3 border border-gray-300 rounded-lg"
                                            />
                                        ) : (
                                            <p>{item.customerName || "—"}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {editForm.category === "Personal" || item.category === "Personal" ? (
                            <div className="bg-white p-6 rounded-xl shadow-lg">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Personal</h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">User</p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.userId}
                                                onChange={(e) => handleEditFieldChange("userId", e.target.value)}
                                                className="w-full p-3 border border-gray-300 rounded-lg"
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
                                                className="w-full p-3 border border-gray-300 rounded-lg"
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
                        <div className="bg-white p-6 rounded-xl shadow-lg">
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
                                            {item.purchasedItem}
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
