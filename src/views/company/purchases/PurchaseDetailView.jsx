import React, { useState, useEffect, useContext } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
    query,
    collection,
    getDocs,
    updateDoc,
    doc,
    getDoc,
    where,
    orderBy,
    deleteDoc,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from "react-select";
import { format } from "date-fns";

const PurchaseDetailView = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { purchaseId } = useParams();
    const navigate = useNavigate();

    const [purchase, setPurchase] = useState({});
    const [notes, setNotes] = useState("");
    const [updating, setUpdating] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const [customerList, setCustomerList] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);

    const [edit, setEdit] = useState(false);
    const [editForm, setEditForm] = useState({
        name: "",
        invoiceNum: "",
        quantityString: "",
        description: "",
        notes: "",
        billable: false,
        invoiced: false,
        returned: false,
        billingRate: "",
        customerId: "",
        customerName: "",
    });

    // Shopping List Item modal state
    const [shoppingListModalOpen, setShoppingListModalOpen] = useState(false);
    const [shoppingListItemsLoading, setShoppingListItemsLoading] = useState(false);
    const [shoppingListItems, setShoppingListItems] = useState([]);
    const [shoppingListSearch, setShoppingListSearch] = useState("");

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

    useEffect(() => {
        (async () => {
            try {
                setIsLoading(true);

                const docRef = doc(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "purchasedItems",
                    purchaseId
                );
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const purchaseData = docSnap.data();
                    const formattedDate = purchaseData.date?.toDate
                        ? format(purchaseData.date.toDate(), "MM / d / yyyy")
                        : "";

                    const purchaseObj = {
                        id: purchaseData.id,
                        name: purchaseData.name || "",
                        receiptId: purchaseData.receiptId || "",
                        invoiceNum: purchaseData.invoiceNum || "",
                        price: formatCurrency((purchaseData.price || 0) / 100),
                        total: formatCurrency(
                            ((purchaseData.price || 0) / 100) *
                            parseFloat(purchaseData.quantityString || 0)
                        ),
                        billingRate: formatCurrency(
                            (purchaseData.billingRate || 0) / 100
                        ),
                        billingRateRaw: purchaseData.billingRate || 0,
                        billable: !!purchaseData.billable,
                        quantityString: purchaseData.quantityString || "",
                        techName: purchaseData.techName || "",
                        venderName: purchaseData.venderName || "",
                        date: formattedDate,
                        itemId: purchaseData.itemId || "",
                        notes: purchaseData.notes || "",
                        description: purchaseData.description || "",
                        invoiced: !!purchaseData.invoiced,
                        returned: !!purchaseData.returned,
                        customerId: purchaseData.customerId || "",
                        customerName: purchaseData.customerName || "",
                        priceRaw: purchaseData.price || 0,
                        shoppingListItemId: purchaseData.shoppingListItemId || "",
                    };

                    setPurchase(purchaseObj);
                    setNotes(purchaseData.notes || "");

                    setEditForm({
                        name: purchaseData.name || "",
                        invoiceNum: purchaseData.invoiceNum || "",
                        quantityString: purchaseData.quantityString || "",
                        description: purchaseData.description || "",
                        notes: purchaseData.notes || "",
                        billable: !!purchaseData.billable,
                        invoiced: !!purchaseData.invoiced,
                        returned: !!purchaseData.returned,
                        billingRate:
                            purchaseData.billingRate != null
                                ? String((purchaseData.billingRate || 0) / 100)
                                : "",
                        customerId: purchaseData.customerId || "",
                        customerName: purchaseData.customerName || "",
                    });

                    const q = query(
                        collection(
                            db,
                            "companies",
                            recentlySelectedCompany,
                            "customers"
                        ),
                        where("active", "==", true),
                        orderBy("firstName")
                    );

                    const querySnapshot = await getDocs(q);
                    const list = [];

                    querySnapshot.forEach((docSnap) => {
                        const customerDoc = docSnap.data();

                        let customerName = "";
                        if (customerDoc.displayAsCompany) {
                            customerName =
                                customerDoc.company ||
                                customerDoc.companyName ||
                                "";
                        } else {
                            customerName = `${customerDoc.firstName || ""} ${customerDoc.lastName || ""
                                }`.trim();
                        }

                        list.push({
                            id: customerDoc.id,
                            name: customerName,
                            streetAddress:
                                customerDoc.billingAddress?.streetAddress || "",
                            phoneNumber: customerDoc.phoneNumber || "",
                            email: customerDoc.email || "",
                            label: customerName,
                        });
                    });

                    setCustomerList(list);

                    if (purchaseData.customerId) {
                        const matched = list.find(
                            (obj) => obj.id === purchaseData.customerId
                        );
                        if (matched) {
                            setSelectedCustomer(matched);
                        }
                    }
                } else {
                    console.log("No such document!");
                }
            } catch (error) {
                console.log("Error");
                console.log(error);
            } finally {
                setIsLoading(false);
            }
        })();
    }, [recentlySelectedCompany, purchaseId]);

    function formatCurrency(number, locale = "en-US", currency = "USD") {
        return new Intl.NumberFormat(locale, {
            style: "currency",
            currency,
        }).format(number || 0);
    }

    const handleEditFieldChange = (field, value) => {
        setEditForm((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const editJob = () => {
        setEditForm({
            name: purchase.name || "",
            invoiceNum: purchase.invoiceNum || "",
            quantityString: purchase.quantityString || "",
            description: purchase.description || "",
            notes: purchase.notes || "",
            billable: !!purchase.billable,
            invoiced: !!purchase.invoiced,
            returned: !!purchase.returned,
            billingRate:
                purchase.billingRateRaw != null
                    ? String((purchase.billingRateRaw || 0) / 100)
                    : "",
            customerId: purchase.customerId || "",
            customerName: purchase.customerName || "",
        });
        setEdit(true);
    };

    const cancelEditJob = () => {
        setEdit(false);
        setNotes(purchase.notes || "");

        const matched = customerList.find(
            (customer) => customer.id === purchase.customerId
        );
        setSelectedCustomer(matched || null);
    };

    const saveEditChanges = async () => {
        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            const billingRateInCents = Math.round(
                (parseFloat(editForm.billingRate || 0) || 0) * 100
            );

            const updatePayload = {
                name: editForm.name || "",
                invoiceNum: editForm.invoiceNum || "",
                quantityString: editForm.quantityString || "",
                description: editForm.description || "",
                notes: editForm.notes || "",
                billable: !!editForm.billable,
                invoiced: !!editForm.billable ? !!editForm.invoiced : false,
                returned: !!editForm.returned,
                billingRate: !!editForm.billable ? billingRateInCents : 0,
                customerId: !!editForm.billable ? editForm.customerId || "" : "",
                customerName:
                    !!editForm.billable ? editForm.customerName || "" : "",
            };

            await updateDoc(docRef, updatePayload);

            setPurchase((prev) => ({
                ...prev,
                ...updatePayload,
                billingRate: formatCurrency(updatePayload.billingRate / 100),
                billingRateRaw: updatePayload.billingRate,
                total: formatCurrency(
                    ((prev.priceRaw || 0) / 100) *
                    parseFloat(updatePayload.quantityString || 0)
                ),
            }));

            setNotes(updatePayload.notes || "");
            setEdit(false);
        } catch (error) {
            console.log(error);
            console.log("Purchase Detail View Save");
        } finally {
            setUpdating(false);
        }
    };

    const deleteJob = async () => {
        const confirmed = window.confirm(
            "Are you sure you want to delete this purchased item?"
        );
        if (!confirmed) return;

        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            await deleteDoc(docRef);
            navigate("/company/purchasedItems");
        } catch (error) {
            console.log(error);
            console.log("Purchase Detail View Delete");
        } finally {
            setUpdating(false);
        }
    };

    const handleCustomerChange = async (option) => {
        setSelectedCustomer(option);

        if (edit) {
            setEditForm((prev) => ({
                ...prev,
                customerId: option?.id || "",
                customerName: option?.name || "",
            }));
            return;
        }

        try {
            setUpdating(true);
            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            if (option == null) {
                await updateDoc(docRef, {
                    customerId: "",
                    customerName: "",
                });

                setPurchase((prev) => ({
                    ...prev,
                    customerId: "",
                    customerName: "",
                }));
            } else {
                await updateDoc(docRef, {
                    customerId: option.id,
                    customerName: option.name,
                });

                setPurchase((prev) => ({
                    ...prev,
                    customerId: option.id,
                    customerName: option.name,
                }));
            }
        } catch (error) {
            console.log(error);
            console.log("Purchase Detail View Customer");
        } finally {
            setUpdating(false);
        }
    };

    const updateNotes = async () => {
        try {
            setUpdating(true);
            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            await updateDoc(docRef, {
                notes,
            });

            setPurchase((prev) => ({
                ...prev,
                notes,
            }));
        } catch (error) {
            console.log(error);
            console.log("Purchase Detail View Notes");
        } finally {
            setUpdating(false);
        }
    };

    const updateInvoiced = async (value) => {
        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            await updateDoc(docRef, {
                invoiced: value,
            });

            setPurchase((prev) => ({
                ...prev,
                invoiced: value,
            }));

            if (edit) {
                setEditForm((prev) => ({
                    ...prev,
                    invoiced: value,
                }));
            }
        } catch (error) {
            console.log(error);
            console.log("Purchase Detail View Invoiced");
        } finally {
            setUpdating(false);
        }
    };

    const updateReturned = async (value) => {
        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            await updateDoc(docRef, {
                returned: value,
            });

            setPurchase((prev) => ({
                ...prev,
                returned: value,
            }));

            if (edit) {
                setEditForm((prev) => ({
                    ...prev,
                    returned: value,
                }));
            }
        } catch (error) {
            console.log(error);
            console.log("Purchase Detail View Returned");
        } finally {
            setUpdating(false);
        }
    };

    const openShoppingListModal = async () => {
        try {
            setShoppingListModalOpen(true);

            if (shoppingListItems.length > 0) return;

            setShoppingListItemsLoading(true);

            const q = query(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "shoppingList"
                ),
                orderBy("name"),
                where("purchasedItem", "==", "")
                // Developer TODO: Maybe an option to filter by technician Id
            );

            const querySnapshot = await getDocs(q);

            const list = querySnapshot.docs.map((docSnap) => {
                const data = docSnap.data();

                return {
                    id: data.id || docSnap.id,
                    name: data.name || "",
                    description: data.description || "",
                    category: data.category || "",
                    status: data.status || "",
                    purchaserName: data.purchaserName || "",
                    quantity: data.quantity || "",
                    label: data.name || "Unnamed Item",
                };
            });

            setShoppingListItems(list);
        } catch (error) {
            console.log(error);
            console.log("Load Shopping List Items");
        } finally {
            setShoppingListItemsLoading(false);
        }
    };

    const connectShoppingListItem = async (shoppingListItem) => {
        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            await updateDoc(docRef, {
                shoppingListItemId: shoppingListItem.id,
            });

            setPurchase((prev) => ({
                ...prev,
                shoppingListItemId: shoppingListItem.id,
            }));

            setShoppingListModalOpen(false);
        } catch (error) {
            console.log(error);
            console.log("Connect Shopping List Item");
        } finally {
            setUpdating(false);
        }
    };

    const clearShoppingListItemConnection = async () => {
        try {
            setUpdating(true);

            const docRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            await updateDoc(docRef, {
                shoppingListItemId: "",
            });

            setPurchase((prev) => ({
                ...prev,
                shoppingListItemId: "",
            }));
        } catch (error) {
            console.log(error);
            console.log("Clear Shopping List Item Connection");
        } finally {
            setUpdating(false);
        }
    };

    const filteredShoppingListItems = shoppingListItems.filter((item) => {
        const search = shoppingListSearch.toLowerCase().trim();
        if (!search) return true;

        return (
            item.name.toLowerCase().includes(search) ||
            item.description.toLowerCase().includes(search) ||
            item.category.toLowerCase().includes(search) ||
            item.status.toLowerCase().includes(search) ||
            item.purchaserName.toLowerCase().includes(search)
        );
    });

    const connectedShoppingListItem =
        shoppingListItems.find(
            (item) => item.id === purchase.shoppingListItemId
        ) || null;

    const currentCustomer = edit
        ? customerList.find((c) => c.id === editForm.customerId) || null
        : selectedCustomer;

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <Link
                            to="/company/purchased-items"
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back to Purchased Items
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">
                            Purchase Detail View
                        </h2>
                    </div>

                    {!edit ? (
                        <button
                            onClick={editJob}
                            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                        >
                            Edit
                        </button>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={saveEditChanges}
                                disabled={updating}
                                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                            >
                                Save
                            </button>
                            <button
                                onClick={cancelEditJob}
                                disabled={updating}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:bg-gray-100 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deleteJob}
                                disabled={updating}
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
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">
                                        Item Information
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Purchase and receipt details
                                    </p>
                                </div>

                                <Link
                                    to={`/company/receipts/detail/${purchase.receiptId}`}
                                    className="inline-flex items-center py-2 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                                >
                                    Receipt: {purchase.invoiceNum || "View Receipt"}
                                </Link>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">
                                        Vendor
                                    </p>
                                    <p>{purchase.venderName || "—"}</p>
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">
                                        Tech
                                    </p>
                                    <p>{purchase.techName || "—"}</p>
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">
                                        Date
                                    </p>
                                    <p>{purchase.date || "—"}</p>
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">
                                        Invoice Number
                                    </p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.invoiceNum}
                                            onChange={(e) =>
                                                handleEditFieldChange(
                                                    "invoiceNum",
                                                    e.target.value
                                                )
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{purchase.invoiceNum || "—"}</p>
                                    )}
                                </div>
                            </div>

                            <div className="border-t mt-6 pt-6">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                                    <div className="w-full">
                                        <p className="text-sm font-semibold text-gray-500 mb-1">
                                            Item
                                        </p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.name}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "name",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full p-2 border border-gray-300 rounded-lg"
                                            />
                                        ) : (
                                            <p className="text-lg font-bold text-gray-800">
                                                {purchase.name || "—"}
                                            </p>
                                        )}
                                    </div>

                                    <Link
                                        to={`/company/items/detail/${purchase.itemId}`}
                                        className="inline-flex items-center py-2 px-4 bg-gray-100 text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition"
                                    >
                                        View Item
                                    </Link>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">
                                            Rate
                                        </p>
                                        <p>{purchase.price || formatCurrency(0)}</p>
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">
                                            Quantity
                                        </p>
                                        {edit ? (
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editForm.quantityString}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "quantityString",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full p-2 border border-gray-300 rounded-lg"
                                            />
                                        ) : (
                                            <p>{purchase.quantityString || "0"}</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">
                                            Total
                                        </p>
                                        <p className="font-bold text-gray-800">
                                            {edit
                                                ? formatCurrency(
                                                    ((purchase.priceRaw || 0) / 100) *
                                                    parseFloat(
                                                        editForm.quantityString || 0
                                                    )
                                                )
                                                : purchase.total || formatCurrency(0)}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">
                                            Description
                                        </p>
                                        {edit ? (
                                            <textarea
                                                value={editForm.description}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "description",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full p-2 border border-gray-300 rounded-lg min-h-[90px]"
                                            />
                                        ) : (
                                            <p>{purchase.description || "—"}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Notes
                                </p>

                                {!edit && (
                                    <button
                                        type="button"
                                        onClick={updateNotes}
                                        disabled={updating || notes === (purchase.notes || "")}
                                        className={[
                                            "px-3 py-1 rounded-lg text-sm font-semibold transition border",
                                            updating || notes === (purchase.notes || "")
                                                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100",
                                        ].join(" ")}
                                    >
                                        {updating ? "Saving..." : "Save"}
                                    </button>
                                )}
                            </div>

                            {edit ? (
                                <textarea
                                    className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                    placeholder="Add notes..."
                                    value={editForm.notes}
                                    onChange={(e) =>
                                        handleEditFieldChange("notes", e.target.value)
                                    }
                                />
                            ) : (
                                <textarea
                                    className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                    placeholder="Add notes..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            )}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                Shopping List Link
                            </h3>

                            <div className="space-y-4 text-gray-700">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">
                                        Connected Shopping List Item
                                    </p>
                                    <p className="break-all">
                                        {purchase.shoppingListItemId || "Not connected"}
                                    </p>
                                </div>

                                {connectedShoppingListItem && (
                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                        <p className="font-semibold text-gray-800">
                                            {connectedShoppingListItem.name || "Unnamed Item"}
                                        </p>
                                        <p className="text-sm text-gray-500 mt-1">
                                            {connectedShoppingListItem.description || "No description"}
                                        </p>
                                        <div className="mt-2 text-xs text-gray-500 space-y-1">
                                            <p>Category: {connectedShoppingListItem.category || "—"}</p>
                                            <p>Status: {connectedShoppingListItem.status || "—"}</p>
                                            <p>Purchaser: {connectedShoppingListItem.purchaserName || "—"}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="flex flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={openShoppingListModal}
                                        className="w-full py-3 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                                    >
                                        {purchase.shoppingListItemId
                                            ? "Change Shopping List Item"
                                            : "Connect Shopping List Item"}
                                    </button>

                                    {purchase.shoppingListItemId && (
                                        <button
                                            type="button"
                                            onClick={clearShoppingListItemConnection}
                                            disabled={updating}
                                            className="w-full py-3 px-4 bg-red-50 text-red-700 font-semibold rounded-lg hover:bg-red-100 transition"
                                        >
                                            Clear Connection
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                Billing
                            </h3>

                            {!(edit ? editForm.billable : purchase.billable) ? (
                                <div className="space-y-4 text-gray-700">
                                    <div className="inline-flex px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold text-sm">
                                        Not Billable
                                    </div>

                                    {edit && (
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={editForm.billable}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "billable",
                                                        e.target.checked
                                                    )
                                                }
                                            />
                                            <span>Mark as billable</span>
                                        </label>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-4 text-gray-700">
                                    <div className="inline-flex px-3 py-1 rounded-full bg-green-100 text-green-800 font-semibold text-sm">
                                        Billable
                                    </div>

                                    {edit && (
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={editForm.billable}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "billable",
                                                        e.target.checked
                                                    )
                                                }
                                            />
                                            <span>Billable</span>
                                        </label>
                                    )}

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">
                                            Billing Rate
                                        </p>
                                        {edit ? (
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editForm.billingRate}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "billingRate",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full p-2 border border-gray-300 rounded-lg"
                                            />
                                        ) : (
                                            <p>{purchase.billingRate || formatCurrency(0)}</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-2">
                                            Customer
                                        </p>
                                        <Select
                                            value={currentCustomer}
                                            options={customerList}
                                            onChange={handleCustomerChange}
                                            isSearchable
                                            isClearable
                                            placeholder="Select A Customer"
                                            styles={selectStyles}
                                        />
                                    </div>

                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-2">
                                            Invoice Status
                                        </p>

                                        {edit ? (
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={editForm.invoiced}
                                                    onChange={(e) =>
                                                        handleEditFieldChange(
                                                            "invoiced",
                                                            e.target.checked
                                                        )
                                                    }
                                                />
                                                <span>Marked as invoiced</span>
                                            </label>
                                        ) : purchase.invoiced ? (
                                            <button
                                                onClick={() => updateInvoiced(false)}
                                                className="w-full py-3 px-4 bg-green-100 text-green-800 font-semibold rounded-lg hover:bg-green-200 transition"
                                            >
                                                Invoiced
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => updateInvoiced(true)}
                                                className="w-full py-3 px-4 bg-red-100 text-red-800 font-semibold rounded-lg hover:bg-red-200 transition"
                                            >
                                                Not Invoiced
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                Returns
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-2">
                                        Return Status
                                    </p>

                                    {edit ? (
                                        <label className="flex items-center gap-2 text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={editForm.returned}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "returned",
                                                        e.target.checked
                                                    )
                                                }
                                            />
                                            <span>Marked as returned</span>
                                        </label>
                                    ) : purchase.returned ? (
                                        <button
                                            onClick={() => updateReturned(false)}
                                            className="w-full py-3 px-4 bg-yellow-100 text-yellow-800 font-semibold rounded-lg hover:bg-yellow-200 transition"
                                        >
                                            Returned
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => updateReturned(true)}
                                            className="w-full py-3 px-4 bg-gray-100 text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition"
                                        >
                                            Not Returned
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                Summary
                            </h3>
                            <div className="space-y-3 text-gray-700">
                                <div className="flex justify-between">
                                    <span>Item:</span>
                                    <span className="text-right">
                                        {purchase.name || "—"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Vendor:</span>
                                    <span className="text-right">
                                        {purchase.venderName || "—"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Tech:</span>
                                    <span className="text-right">
                                        {purchase.techName || "—"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Quantity:</span>
                                    <span>{purchase.quantityString || "0"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Customer:</span>
                                    <span>{purchase.customerName || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Shopping List Item:</span>
                                    <span className="text-right break-all">
                                        {purchase.shoppingListItemId || "—"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Invoiced:</span>
                                    <span>{purchase.invoiced ? "Yes" : "No"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Returned:</span>
                                    <span>{purchase.returned ? "Yes" : "No"}</span>
                                </div>
                                <div className="flex justify-between border-t pt-3">
                                    <span>Rate:</span>
                                    <span>{purchase.price || formatCurrency(0)}</span>
                                </div>
                                <div className="flex justify-between font-bold text-lg text-gray-800 border-t pt-3">
                                    <span>Total:</span>
                                    <span>{purchase.total || formatCurrency(0)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {shoppingListModalOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">
                                    Select Shopping List Item
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    Search and connect a shopping list item to this purchased item
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShoppingListModalOpen(false)}
                                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                            >
                                Close
                            </button>
                        </div>

                        <div className="p-6">
                            <input
                                type="text"
                                value={shoppingListSearch}
                                onChange={(e) => setShoppingListSearch(e.target.value)}
                                placeholder="Search shopping list items..."
                                className="w-full p-3 border border-gray-300 rounded-lg mb-4"
                            />

                            {shoppingListItemsLoading ? (
                                <div className="text-center py-10 text-gray-500">
                                    Loading shopping list items...
                                </div>
                            ) : filteredShoppingListItems.length > 0 ? (
                                <div className="max-h-[420px] overflow-y-auto space-y-3">
                                    {filteredShoppingListItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                                        >
                                            <div className="min-w-0">
                                                <p className="font-semibold text-gray-800">
                                                    {item.name || "Unnamed Item"}
                                                </p>
                                                <p className="text-sm text-gray-500 mt-1">
                                                    {item.description || "No description"}
                                                </p>
                                                <div className="mt-2 text-xs text-gray-500 space-y-1">
                                                    <p>ID: {item.id}</p>
                                                    <p>Category: {item.category || "—"}</p>
                                                    <p>Status: {item.status || "—"}</p>
                                                    <p>Purchaser: {item.purchaserName || "—"}</p>
                                                    <p>Quantity: {item.quantity || "—"}</p>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => connectShoppingListItem(item)}
                                                className="shrink-0 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                                            >
                                                Select
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-10 text-gray-500">
                                    No shopping list items found.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {(isLoading || updating) && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        {isLoading ? "Loading purchase..." : "Saving changes..."}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PurchaseDetailView;