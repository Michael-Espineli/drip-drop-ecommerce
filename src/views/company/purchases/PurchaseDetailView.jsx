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
    setDoc,
    arrayUnion,
    arrayRemove,
    serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from "react-select";
import { format } from "date-fns";
import { displayRecordReference, linkedReferenceText } from "../../../utils/displayReferences";
import { appAlert, appConfirm } from "../../../utils/appDialog";
import { syncLinkedShoppingPurchase } from "../../../utils/shoppingPurchaseSync";
import ShareItemButton from "../../components/share/ShareItemButton";

const purchaseCategoryOptions = ["PVC", "Galvanized", "Chemicals", "Useables", "Equipment", "Parts", "Electrical", "Tools", "Misc", "Uncategorized"];
const normalizePurchaseCategory = (value) => String(value || "").trim() || "Uncategorized";
const shoppingListStatusOptions = ["Need to Purchase", "Needs Customer Approval", "Ready to Purchase", "Customer Rejected", "Purchased", "Delivered", "Installed", "Invoiced"];
const defaultShoppingListStatusFilters = ["Purchased", "Installed", "Invoiced"];
const jobBillingIsInvoiced = (status = "") =>
    ["invoiced", "paid"].includes(String(status || "").trim().toLowerCase());
const purchaseConnectedStatus = (invoiced) => invoiced ? "Invoiced" : "Connected to Job";
const purchaseStandaloneStatus = ({ billable, invoiced, returned } = {}) => {
    if (returned) return "Returned";
    if (billable) return invoiced ? "Invoiced" : "Needs invoice";
    return "Non-billable";
};
const invoicedPurchaseFieldsForJob = (job = {}) => {
    const invoiceId = job.salesInvoiceId || job.invoiceRef || job.invoiceId || "";

    return {
        invoiced: true,
        invoiceStatus: "Invoiced",
        jobBillingStatus: "invoiced",
        invoiceId,
        invoiceRef: invoiceId,
        invoiceType: job.invoiceType || (job.salesInvoiceId ? "salesInvoice" : "job"),
        invoicedAt: serverTimestamp(),
        jobInvoicedAt: serverTimestamp(),
        status: "Invoiced",
    };
};
const invoicedPurchaseStateForJob = (job = {}) => {
    const invoiceId = job.salesInvoiceId || job.invoiceRef || job.invoiceId || "";

    return {
        invoiced: true,
        invoiceStatus: "Invoiced",
        jobBillingStatus: "invoiced",
        invoiceId,
        invoiceRef: invoiceId,
        invoiceType: job.invoiceType || (job.salesInvoiceId ? "salesInvoice" : "job"),
        invoicedAt: new Date(),
        jobInvoicedAt: new Date(),
        status: "Invoiced",
    };
};

const PurchaseDetailView = () => {
    const { recentlySelectedCompany, user, dataBaseUser, name } = useContext(Context);
    const { purchaseId } = useParams();
    const navigate = useNavigate();

    const [purchase, setPurchase] = useState({});
    const [notes, setNotes] = useState("");
    const [updating, setUpdating] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [purchaseHistory, setPurchaseHistory] = useState([]);
    const [purchaseHistoryLoading, setPurchaseHistoryLoading] = useState(false);
    const [purchaseHistoryModalOpen, setPurchaseHistoryModalOpen] = useState(false);

    const [customerList, setCustomerList] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);

    const [edit, setEdit] = useState(false);
    const [editForm, setEditForm] = useState({
        name: "",
        invoiceNum: "",
        quantityString: "",
        description: "",
        category: "Uncategorized",
        subCategory: "",
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
    const [shoppingListStatusFilters, setShoppingListStatusFilters] = useState(defaultShoppingListStatusFilters);
    const [jobModalOpen, setJobModalOpen] = useState(false);
    const [jobsLoading, setJobsLoading] = useState(false);
    const [jobs, setJobs] = useState([]);
    const [jobSearch, setJobSearch] = useState("");
    const [jobStartDate, setJobStartDate] = useState(() => {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        return format(date, "yyyy-MM-dd");
    });
    const [jobEndDate, setJobEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

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

    const currentActor = () => {
        const databaseName = [dataBaseUser?.firstName, dataBaseUser?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim();

        return {
            id: user?.uid || dataBaseUser?.id || "",
            name: databaseName || name || user?.displayName || user?.email || "Unknown user",
            email: user?.email || dataBaseUser?.email || "",
        };
    };

    const historyDateValue = (value) => {
        if (!value) return null;
        if (value?.toDate) return value.toDate();
        if (value instanceof Date) return value;

        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatHistoryDate = (value) => {
        const date = historyDateValue(value);
        return date ? format(date, "MMM d, yyyy h:mm a") : "Unknown date";
    };

    const compactHistoryValue = (value) => {
        if (value === true) return "Yes";
        if (value === false) return "No";
        if (value == null) return "Blank";

        const cleanValue = String(value).trim();
        if (!cleanValue) return "Blank";
        return cleanValue.length > 140 ? `${cleanValue.slice(0, 137)}...` : cleanValue;
    };

    const historyChange = (label, previousValue, nextValue) => {
        const previous = compactHistoryValue(previousValue);
        const next = compactHistoryValue(nextValue);
        if (previous === next) return null;
        return `${label}: ${previous} -> ${next}`;
    };

    const historyMoneyChange = (label, previousCents, nextCents) =>
        historyChange(
            label,
            formatCurrency((Number(previousCents) || 0) / 100),
            formatCurrency((Number(nextCents) || 0) / 100)
        );

    const loadPurchaseHistory = async () => {
        if (!recentlySelectedCompany || !purchaseId) return;

        try {
            setPurchaseHistoryLoading(true);
            const historyQuery = query(
                collection(db, "companies", recentlySelectedCompany, "purchasedItems", purchaseId, "history"),
                orderBy("date", "desc")
            );
            const historySnap = await getDocs(historyQuery);
            setPurchaseHistory(
                historySnap.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...docSnap.data(),
                }))
            );
        } catch (error) {
            console.log(error);
            console.log("Load Purchase History");
            setPurchaseHistory([]);
        } finally {
            setPurchaseHistoryLoading(false);
        }
    };

    const recordPurchaseHistory = async ({ title, eventType, changes }) => {
        const filteredChanges = (changes || []).filter(Boolean);
        if (!recentlySelectedCompany || !purchaseId || filteredChanges.length === 0) return;

        const actor = currentActor();
        const now = new Date();
        const historyRef = doc(
            collection(db, "companies", recentlySelectedCompany, "purchasedItems", purchaseId, "history")
        );
        const payload = {
            id: historyRef.id,
            date: now,
            tech: actor.name,
            actorId: actor.id,
            actorName: actor.name,
            actorEmail: actor.email,
            source: "web",
            eventType,
            title,
            changes: filteredChanges,
            createdAt: serverTimestamp(),
        };

        await setDoc(historyRef, payload);
        await updateDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchaseId), {
            lastHistoryEventId: historyRef.id,
            lastHistoryEventTitle: title,
            lastHistoryEventType: eventType,
            lastHistoryEventAt: now,
            updatedAt: serverTimestamp(),
        });

        setPurchaseHistory((prev) => [
            payload,
            ...prev.filter((entry) => entry.id !== payload.id),
        ]);
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
                    let databaseItemData = {};
                    if (purchaseData.itemId) {
                        const databaseItemSnap = await getDoc(
                            doc(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "settings",
                                "dataBase",
                                "dataBase",
                                purchaseData.itemId
                            )
                        );
                        databaseItemData = databaseItemSnap.exists()
                            ? databaseItemSnap.data()
                            : {};
                    }
                    const resolvedCategory = normalizePurchaseCategory(
                        purchaseData.category || databaseItemData.category
                    );
                    const resolvedSubCategory =
                        purchaseData.subCategory || databaseItemData.subCategory || "";

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
                        category: resolvedCategory,
                        subCategory: resolvedSubCategory,
                        notes: purchaseData.notes || "",
                        description: purchaseData.description || "",
                        invoiced: !!purchaseData.invoiced,
                        returned: !!purchaseData.returned,
                        customerId: purchaseData.customerId || "",
                        customerName: purchaseData.customerName || "",
                        priceRaw: purchaseData.price || 0,
                        shoppingListItemId: purchaseData.shoppingListItemId || "",
                        jobId: purchaseData.jobId || purchaseData.workOrderId || "",
                        workOrderId: purchaseData.workOrderId || purchaseData.jobId || "",
                        assignedJobId: purchaseData.assignedJobId || purchaseData.jobId || purchaseData.workOrderId || "",
                        assignedToJob: Boolean(purchaseData.assignedToJob || purchaseData.jobId || purchaseData.workOrderId),
                        assignmentStatus: purchaseData.assignmentStatus || (purchaseData.jobId || purchaseData.workOrderId ? "assignedToJob" : "unassigned"),
                        billingOwner: purchaseData.billingOwner || (purchaseData.jobId || purchaseData.workOrderId ? "job" : "purchasedItem"),
                        jobBillingStatus: purchaseData.jobBillingStatus || (purchaseData.jobId || purchaseData.workOrderId ? "handledByJob" : ""),
                        jobBillable: Boolean(purchaseData.jobBillable ?? purchaseData.billable),
                        jobBillingRate: purchaseData.jobBillingRate || purchaseData.billingRate || purchaseData.price || 0,
                        status: purchaseData.status || (purchaseData.jobId || purchaseData.workOrderId || purchaseData.assignedToJob
                            ? purchaseConnectedStatus(!!purchaseData.invoiced)
                            : purchaseStandaloneStatus({
                                billable: !!purchaseData.billable,
                                invoiced: !!purchaseData.invoiced,
                                returned: !!purchaseData.returned,
                            })),
                    };

                    setPurchase(purchaseObj);
                    setNotes(purchaseData.notes || "");

                    setEditForm({
                        name: purchaseData.name || "",
                        invoiceNum: purchaseData.invoiceNum || "",
                        quantityString: purchaseData.quantityString || "",
                        description: purchaseData.description || "",
                        category: resolvedCategory,
                        subCategory: resolvedSubCategory,
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

                await loadPurchaseHistory();
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
            category: normalizePurchaseCategory(purchase.category),
            subCategory: purchase.subCategory || "",
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

            const assignedToJob = Boolean(
                purchase.jobId ||
                purchase.workOrderId ||
                purchase.assignedToJob ||
                purchase.assignmentStatus === "assignedToJob"
            );

            const updatePayload = {
                name: editForm.name || "",
                invoiceNum: editForm.invoiceNum || "",
                quantityString: editForm.quantityString || "",
                description: editForm.description || "",
                category: normalizePurchaseCategory(editForm.category),
                subCategory: editForm.subCategory || "",
                notes: editForm.notes || "",
                returned: !!editForm.returned,
                status: assignedToJob
                    ? purchaseConnectedStatus(purchase.invoiced)
                    : purchaseStandaloneStatus({
                        billable: !!editForm.billable,
                        invoiced: !!editForm.billable ? !!editForm.invoiced : false,
                        returned: !!editForm.returned,
                    }),
                ...(assignedToJob
                    ? {
                        jobBillable: !!editForm.billable,
                        jobBillingRate: !!editForm.billable ? billingRateInCents : 0,
                    }
                    : {
                        billable: !!editForm.billable,
                        invoiced: !!editForm.billable ? !!editForm.invoiced : false,
                        billingRate: !!editForm.billable ? billingRateInCents : 0,
                        customerId: !!editForm.billable ? editForm.customerId || "" : "",
                        customerName:
                            !!editForm.billable ? editForm.customerName || "" : "",
                    }),
            };
            const editHistoryChanges = [
                historyChange("Item", purchase.name, updatePayload.name),
                historyChange("Invoice Number", purchase.invoiceNum, updatePayload.invoiceNum),
                historyChange("Quantity", purchase.quantityString, updatePayload.quantityString),
                historyChange("Description", purchase.description, updatePayload.description),
                historyChange("Category", purchase.category, updatePayload.category),
                historyChange("Subcategory", purchase.subCategory, updatePayload.subCategory),
                historyChange("Notes", purchase.notes, updatePayload.notes),
                historyChange("Returned", !!purchase.returned, updatePayload.returned),
                historyChange("Status", purchase.status, updatePayload.status),
                assignedToJob
                    ? historyChange("Job Billable", Boolean(purchase.jobBillable ?? purchase.billable), updatePayload.jobBillable)
                    : historyChange("Billable", !!purchase.billable, updatePayload.billable),
                assignedToJob
                    ? historyMoneyChange("Job Billing Rate", purchase.jobBillingRate || purchase.billingRateRaw || 0, updatePayload.jobBillingRate || 0)
                    : historyMoneyChange("Billing Rate", purchase.billingRateRaw || 0, updatePayload.billingRate || 0),
                !assignedToJob ? historyChange("Invoiced", !!purchase.invoiced, updatePayload.invoiced) : null,
                !assignedToJob ? historyChange("Customer", purchase.customerName, updatePayload.customerName) : null,
            ].filter(Boolean);

            await updateDoc(docRef, updatePayload);
            if (purchase.shoppingListItemId) {
                await syncLinkedShoppingPurchase({
                    db,
                    companyId: recentlySelectedCompany,
                    purchasedItemId: purchaseId,
                    shoppingItemId: purchase.shoppingListItemId,
                    purchasedItemData: {
                        ...purchase,
                        ...updatePayload,
                        id: purchaseId,
                    },
                    invoiced: updatePayload.invoiced,
                    preferPurchasedContext: true,
                });
            }
            await recordPurchaseHistory({
                title: "Purchase edited",
                eventType: "purchase_edited",
                changes: editHistoryChanges,
            });

            setPurchase((prev) => ({
                ...prev,
                ...updatePayload,
                billingRate: formatCurrency((updatePayload.billingRate ?? prev.billingRateRaw ?? 0) / 100),
                billingRateRaw: updatePayload.billingRate ?? prev.billingRateRaw ?? 0,
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
        if (purchase.receiptId) {
            await appAlert("This purchased item is attached to a receipt. Delete the whole receipt or mark the item as returned.");
            return;
        }

        const confirmed = await appConfirm({
            title: "Delete Purchased Item",
            message: "Are you sure you want to delete this purchased item?",
            confirmLabel: "Delete Item",
            variant: "danger",
        });
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
            navigate("/company/purchased-items");
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
                const updates = {
                    customerId: "",
                    customerName: "",
                };
                const historyChanges = [
                    historyChange("Customer", purchase.customerName, ""),
                ];
                await updateDoc(docRef, updates);
                if (purchase.shoppingListItemId) {
                    await syncLinkedShoppingPurchase({
                        db,
                        companyId: recentlySelectedCompany,
                        purchasedItemId: purchaseId,
                        shoppingItemId: purchase.shoppingListItemId,
                        purchasedItemData: { ...purchase, ...updates, id: purchaseId },
                        preferPurchasedContext: true,
                    });
                }
                await recordPurchaseHistory({
                    title: "Purchase customer cleared",
                    eventType: "customer_updated",
                    changes: historyChanges,
                });

                setPurchase((prev) => ({
                    ...prev,
                    customerId: "",
                    customerName: "",
                }));
            } else {
                const updates = {
                    customerId: option.id,
                    customerName: option.name,
                };
                const historyChanges = [
                    historyChange("Customer", purchase.customerName, option.name),
                ];
                await updateDoc(docRef, updates);
                if (purchase.shoppingListItemId) {
                    await syncLinkedShoppingPurchase({
                        db,
                        companyId: recentlySelectedCompany,
                        purchasedItemId: purchaseId,
                        shoppingItemId: purchase.shoppingListItemId,
                        purchasedItemData: { ...purchase, ...updates, id: purchaseId },
                        preferPurchasedContext: true,
                    });
                }
                await recordPurchaseHistory({
                    title: "Purchase customer updated",
                    eventType: "customer_updated",
                    changes: historyChanges,
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
            await recordPurchaseHistory({
                title: "Purchase notes updated",
                eventType: "notes_updated",
                changes: [
                    historyChange("Notes", purchase.notes, notes),
                ],
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

            const { purchasePayload } = await syncLinkedShoppingPurchase({
                db,
                companyId: recentlySelectedCompany,
                purchasedItemId: purchaseId,
                shoppingItemId: purchase.shoppingListItemId || "",
                purchasedItemData: {
                    ...purchase,
                    id: purchaseId,
                    invoiced: value,
                },
                invoiced: value,
                preferPurchasedContext: true,
            });
            await recordPurchaseHistory({
                title: value ? "Purchase marked invoiced" : "Purchase marked not invoiced",
                eventType: "invoiced_updated",
                changes: [
                    historyChange("Invoiced", !!purchase.invoiced, value),
                    historyChange("Status", purchase.status, purchasePayload.status),
                ],
            });

            setPurchase((prev) => ({
                ...prev,
                invoiced: value,
                ...purchasePayload,
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
            const assignedToJob = Boolean(
                purchase.jobId ||
                purchase.workOrderId ||
                purchase.assignedToJob ||
                purchase.assignmentStatus === "assignedToJob"
            );
            const nextStatus = value
                ? "Returned"
                : assignedToJob
                    ? purchaseConnectedStatus(purchase.invoiced)
                    : purchaseStandaloneStatus({
                        billable: purchase.billable,
                        invoiced: purchase.invoiced,
                        returned: false,
                    });

            await updateDoc(docRef, {
                returned: value,
                status: nextStatus,
            });
            await recordPurchaseHistory({
                title: value ? "Purchase marked returned" : "Purchase return cleared",
                eventType: "returned_updated",
                changes: [
                    historyChange("Returned", !!purchase.returned, value),
                    historyChange("Status", purchase.status, nextStatus),
                ],
            });

            setPurchase((prev) => ({
                ...prev,
                returned: value,
                status: nextStatus,
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
            setShoppingListStatusFilters(defaultShoppingListStatusFilters);

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

            const { purchasePayload } = await syncLinkedShoppingPurchase({
                db,
                companyId: recentlySelectedCompany,
                purchasedItemId: purchaseId,
                shoppingItemId: shoppingListItem.id,
                purchasedItemData: { ...purchase, id: purchaseId },
                shoppingItemData: shoppingListItem,
                previousShoppingItemId: purchase.shoppingListItemId || "",
                preferPurchasedContext: true,
            });
            await recordPurchaseHistory({
                title: "Shopping list item connected",
                eventType: "shopping_item_connected",
                changes: [
                    historyChange("Shopping Item", connectedShoppingListItem?.name || "", shoppingListItem.name || "Unnamed item"),
                    historyChange("Customer", purchase.customerName, purchasePayload.customerName || purchase.customerName),
                    historyChange("Job", purchase.jobInternalId || purchase.jobName || (purchase.jobId ? "Job connected" : ""), purchasePayload.jobInternalId || purchasePayload.jobName || (purchasePayload.jobId ? "Job connected" : "")),
                    historyChange("Status", purchase.status, purchasePayload.status),
                ],
            });

            setPurchase((prev) => ({
                ...prev,
                shoppingListItemId: shoppingListItem.id,
                ...purchasePayload,
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
            if (purchase.shoppingListItemId) {
                await syncLinkedShoppingPurchase({
                    db,
                    companyId: recentlySelectedCompany,
                    previousShoppingItemId: purchase.shoppingListItemId,
                });
            }
            await recordPurchaseHistory({
                title: "Shopping list item disconnected",
                eventType: "shopping_item_disconnected",
                changes: [
                    historyChange("Shopping Item", connectedShoppingListItem?.name || "Connected shopping item", ""),
                ],
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

    const dateRangeBounds = (startValue, endValue) => {
        const start = new Date(`${startValue}T00:00:00`);
        const end = new Date(`${endValue}T23:59:59.999`);
        return { start, end };
    };

    const openJobModal = async () => {
        setJobModalOpen(true);
        if (!jobs.length) {
            await loadJobs();
        }
    };

    const loadJobs = async () => {
        if (!recentlySelectedCompany) return;

        try {
            setJobsLoading(true);
            const { start, end } = dateRangeBounds(jobStartDate, jobEndDate);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
                await appAlert("Select a valid job date range.");
                return;
            }

            const jobsQuery = query(
                collection(db, "companies", recentlySelectedCompany, "workOrders"),
                where("dateCreated", ">=", start),
                where("dateCreated", "<=", end),
                orderBy("dateCreated", "desc")
            );

            const snap = await getDocs(jobsQuery);
            setJobs(
                snap.docs.map((docSnap) => ({
                    ...docSnap.data(),
                    id: docSnap.data().id || docSnap.id,
                }))
            );
        } catch (error) {
            console.log(error);
            console.log("Load Jobs For Purchase");
            appAlert("Could not load jobs for that date range.");
        } finally {
            setJobsLoading(false);
        }
    };

    const connectJob = async (job) => {
        if (!job?.id) return;

        try {
            setUpdating(true);
            const previousJobId = purchase.jobId || purchase.workOrderId || "";
            const purchaseRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "purchasedItems",
                purchaseId
            );

            const shouldMarkInvoiced = jobBillingIsInvoiced(job.billingStatus);
            const updates = {
                ...(shouldMarkInvoiced ? invoicedPurchaseFieldsForJob(job) : {}),
                jobId: job.id,
                workOrderId: job.id,
                assignedJobId: job.id,
                assignedToJob: true,
                assignmentStatus: "assignedToJob",
                billingOwner: "job",
                jobBillingStatus: shouldMarkInvoiced ? "invoiced" : "handledByJob",
                jobBillable: Boolean(purchase.jobBillable ?? purchase.billable),
                jobBillingRate: purchase.jobBillingRate || purchase.billingRateRaw || purchase.priceRaw || 0,
                jobInternalId: job.internalId || "",
                jobName: job.type || job.jobName || "",
                status: shouldMarkInvoiced ? "Invoiced" : "Connected to Job",
            };

            await updateDoc(purchaseRef, updates);

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", job.id), {
                purchasedItemsIds: arrayUnion(purchaseId),
            });

            if (previousJobId && previousJobId !== job.id) {
                await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", previousJobId), {
                    purchasedItemsIds: arrayRemove(purchaseId),
                });
            }

            if (purchase.shoppingListItemId) {
                await syncLinkedShoppingPurchase({
                    db,
                    companyId: recentlySelectedCompany,
                    purchasedItemId: purchaseId,
                    shoppingItemId: purchase.shoppingListItemId,
                    purchasedItemData: { ...purchase, ...updates, id: purchaseId },
                    preferPurchasedContext: true,
                });
            }
            await recordPurchaseHistory({
                title: "Purchase job updated",
                eventType: "job_updated",
                changes: [
                    historyChange("Job", purchase.jobInternalId || purchase.jobName || (previousJobId ? "Job connected" : ""), job.internalId || job.type || "Job connected"),
                    historyChange("Customer", purchase.customerName, updates.customerName),
                    historyChange("Status", purchase.status, updates.status),
                    shouldMarkInvoiced ? historyChange("Invoiced", !!purchase.invoiced, true) : null,
                ],
            });

            setPurchase((prev) => ({
                ...prev,
                ...updates,
                ...(shouldMarkInvoiced ? invoicedPurchaseStateForJob(job) : {}),
            }));
            setJobModalOpen(false);
        } catch (error) {
            console.log(error);
            console.log("Connect Job");
            appAlert("Could not connect this purchased item to the selected job.");
        } finally {
            setUpdating(false);
        }
    };

    const clearJobConnection = async () => {
        const currentJobId = purchase.jobId || purchase.workOrderId || "";
        if (!currentJobId) return;

        try {
            setUpdating(true);
            await updateDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchaseId), {
                jobId: "",
                workOrderId: "",
                assignedJobId: "",
                assignedToJob: false,
                assignmentStatus: "unassigned",
                billingOwner: "purchasedItem",
                jobBillingStatus: "",
                jobBillable: false,
                jobBillingRate: 0,
                status: purchaseStandaloneStatus({
                    billable: purchase.billable,
                    invoiced: purchase.invoiced,
                    returned: purchase.returned,
                }),
            });

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", currentJobId), {
                purchasedItemsIds: arrayRemove(purchaseId),
            });
            const nextStatus = purchaseStandaloneStatus({
                billable: purchase.billable,
                invoiced: purchase.invoiced,
                returned: purchase.returned,
            });
            await recordPurchaseHistory({
                title: "Purchase job cleared",
                eventType: "job_cleared",
                changes: [
                    historyChange("Job", purchase.jobInternalId || purchase.jobName || "Job connected", ""),
                    historyChange("Status", purchase.status, nextStatus),
                ],
            });

            setPurchase((prev) => ({
                ...prev,
                jobId: "",
                workOrderId: "",
                assignedJobId: "",
                assignedToJob: false,
                assignmentStatus: "unassigned",
                billingOwner: "purchasedItem",
                jobBillingStatus: "",
                jobBillable: false,
                jobBillingRate: 0,
                status: nextStatus,
            }));
        } catch (error) {
            console.log(error);
            console.log("Clear Job Connection");
            appAlert("Could not clear this job connection.");
        } finally {
            setUpdating(false);
        }
    };

    const toggleShoppingListStatusFilter = (status) => {
        setShoppingListStatusFilters((current) => {
            if (current.includes(status)) {
                return current.filter((value) => value !== status);
            }

            return [...current, status];
        });
    };

    const filteredShoppingListItems = shoppingListItems.filter((item) => {
        const search = shoppingListSearch.toLowerCase().trim();
        const activeStatusFilters = shoppingListStatusFilters.filter(Boolean);
        const matchesStatus =
            activeStatusFilters.length === 0 ||
            activeStatusFilters.includes(item.status || "");
        if (!matchesStatus) return false;
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
    const connectedJobId = purchase.jobId || purchase.workOrderId || "";
    const connectedJob = jobs.find((job) => job.id === connectedJobId) || null;

    const filteredJobs = jobs.filter((job) => {
        const search = jobSearch.toLowerCase().trim();
        if (!search) return true;

        return (
            (job.internalId || "").toLowerCase().includes(search) ||
            (job.customerName || "").toLowerCase().includes(search) ||
            (job.description || "").toLowerCase().includes(search) ||
            (job.operationStatus || "").toLowerCase().includes(search) ||
            (job.billingStatus || "").toLowerCase().includes(search)
        );
    });

    const currentCustomer = edit
        ? customerList.find((c) => c.id === editForm.customerId) || null
        : selectedCustomer;

    const isAssignedToJob = Boolean(
        purchase.jobId ||
        purchase.workOrderId ||
        purchase.assignedToJob ||
        purchase.assignmentStatus === "assignedToJob"
    );
    const editCategoryOptions = purchaseCategoryOptions.includes(editForm.category)
        ? purchaseCategoryOptions
        : [editForm.category, ...purchaseCategoryOptions].filter(Boolean);
    const historyChangeText = (change) => {
        if (typeof change === "string") return change;
        if (!change || typeof change !== "object") return "";

        const label = change.label || change.field || "Change";
        return `${label}: ${compactHistoryValue(change.previous ?? change.before)} -> ${compactHistoryValue(change.next ?? change.after)}`;
    };
    const recentPurchaseHistory = purchaseHistory.slice(0, 5);
    const olderPurchaseHistory = purchaseHistory.slice(5);
    const renderHistoryEntry = (entry) => {
        const changes = Array.isArray(entry.changes)
            ? entry.changes.map(historyChangeText).filter(Boolean)
            : [];

        return (
            <div key={entry.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="font-semibold text-gray-800">
                            {entry.title || entry.eventType || "Purchase updated"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                            {entry.actorName || entry.tech || "Unknown user"} | {formatHistoryDate(entry.date || entry.createdAt)}
                        </p>
                    </div>
                    {entry.source && (
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold uppercase text-gray-500">
                            {entry.source}
                        </span>
                    )}
                </div>

                {changes.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm text-gray-700">
                        {changes.map((change, index) => (
                            <li key={`${entry.id}-${index}`} className="leading-snug">
                                {change}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };
    const renderPurchaseHistoryCard = () => (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-xl font-bold text-gray-800">
                        Purchase History
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Most recent 5 changes
                    </p>
                </div>
                <button
                    type="button"
                    onClick={loadPurchaseHistory}
                    disabled={purchaseHistoryLoading}
                    className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                >
                    Refresh
                </button>
            </div>

            {purchaseHistoryLoading ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                    Loading history...
                </div>
            ) : purchaseHistory.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                    No purchase history recorded yet.
                </div>
            ) : (
                <>
                    <div className="space-y-3">
                        {recentPurchaseHistory.map(renderHistoryEntry)}
                    </div>
                    {olderPurchaseHistory.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setPurchaseHistoryModalOpen(true)}
                            className="mt-4 w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                        >
                            View {olderPurchaseHistory.length} older history {olderPurchaseHistory.length === 1 ? "entry" : "entries"}
                        </button>
                    )}
                </>
            )}
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <Link
                            to="/company/purchased-items"
                            className="app-back-link"
                        >
                            &larr; Back to Purchased Items
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">
                            Purchase Detail View
                        </h2>
                    </div>

                    {!edit ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <ShareItemButton
                                type="purchase"
                                recordId={purchaseId}
                                title={purchase.name || purchase.itemName || purchase.description || "Purchased Item"}
                                subtitle={[purchase.customerName, purchase.vendorName || purchase.venderName, purchase.status].filter(Boolean).join(" - ")}
                                companyId={recentlySelectedCompany}
                                customerId={purchase.customerId}
                                collectionPath={`companies/${recentlySelectedCompany}/purchasedItems`}
                                webPath={`/company/purchased-items/detail/${purchaseId}`}
                            />
                            <button
                                onClick={editJob}
                                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                            >
                                Edit
                            </button>
                        </div>
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
                                disabled={updating || Boolean(purchase.receiptId)}
                                title={purchase.receiptId ? "Receipt-backed purchased items can only be deleted by deleting the whole receipt." : "Delete purchased item"}
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

                                    {purchase.itemId ? (
                                        <Link
                                            to={`/company/items/detail/${purchase.itemId}`}
                                            className="inline-flex items-center py-2 px-4 bg-gray-100 text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition"
                                        >
                                            View Database Item
                                        </Link>
                                    ) : (
                                        <span className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-500">
                                            No Database Item
                                        </span>
                                    )}
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
                                            Category
                                        </p>
                                        {edit ? (
                                            <select
                                                value={editForm.category}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "category",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full p-2 border border-gray-300 rounded-lg"
                                            >
                                                {editCategoryOptions.map((option) => (
                                                    <option key={option} value={option}>
                                                        {option}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <p>{purchase.category || "Uncategorized"}</p>
                                        )}
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
                                            Subcategory
                                        </p>
                                        {edit ? (
                                            <input
                                                type="text"
                                                value={editForm.subCategory}
                                                onChange={(e) =>
                                                    handleEditFieldChange(
                                                        "subCategory",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full p-2 border border-gray-300 rounded-lg"
                                            />
                                        ) : (
                                            <p>{purchase.subCategory || "—"}</p>
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

                        {renderPurchaseHistoryCard()}
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
                                    <p>
                                        {connectedShoppingListItem?.name || (purchase.shoppingListItemId ? "Connected" : "Not connected")}
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
                                Job Link
                            </h3>

                            <div className="space-y-4 text-gray-700">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">
                                        Connected Job
                                    </p>
                                    {connectedJobId ? (
                                        <Link to={`/company/jobs/detail/${connectedJobId}`} className="font-semibold text-blue-600 hover:underline">
                                            {linkedReferenceText("Job", connectedJobId, displayRecordReference(connectedJob, ""))}
                                        </Link>
                                    ) : (
                                        <p>Not connected</p>
                                    )}
                                </div>

                                <div className="flex flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={openJobModal}
                                        className="w-full py-3 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                                    >
                                        {purchase.jobId || purchase.workOrderId
                                            ? "Change Job"
                                            : "Connect Job"}
                                    </button>

                                    {(purchase.jobId || purchase.workOrderId) && (
                                        <button
                                            type="button"
                                            onClick={clearJobConnection}
                                            disabled={updating}
                                            className="w-full py-3 px-4 bg-red-50 text-red-700 font-semibold rounded-lg hover:bg-red-100 transition"
                                        >
                                            Clear Job Connection
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                Billing
                            </h3>

                            {isAssignedToJob ? (
                                <div className="space-y-4 text-gray-700">
                                    <div className="inline-flex px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-sm">
                                        Billing Managed By Job
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500 mb-1">
                                            Job Billing Rate
                                        </p>
                                        <p>{formatCurrency((purchase.jobBillingRate || purchase.billingRateRaw || purchase.priceRaw || 0) / 100)}</p>
                                    </div>
                                    <p className="text-sm text-gray-500">
                                        Standalone billable and invoiced flags are ignored while this material is assigned to a job.
                                    </p>
                                </div>
                            ) : !(edit ? editForm.billable : purchase.billable) ? (
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
                                    <span>Database Item:</span>
                                    {purchase.itemId ? (
                                        <Link to={`/company/items/detail/${purchase.itemId}`} className="text-right font-semibold text-blue-600 hover:underline">
                                            Open
                                        </Link>
                                    ) : (
                                        <span>—</span>
                                    )}
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
                                    <span className="text-right">
                                        {connectedShoppingListItem?.name || (purchase.shoppingListItemId ? "Connected" : "—")}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Job:</span>
                                    {connectedJobId ? (
                                        <Link to={`/company/jobs/detail/${connectedJobId}`} className="text-right font-semibold text-blue-600 hover:underline">
                                            {linkedReferenceText("Job", connectedJobId, displayRecordReference(connectedJob, ""))}
                                        </Link>
                                    ) : (
                                        <span>—</span>
                                    )}
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
                                <div className="flex justify-between">
                                    <span>Category:</span>
                                    <span>{purchase.category || "Uncategorized"}</span>
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

            {purchaseHistoryModalOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-4xl max-h-[86vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-200">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">
                                    Older Purchase History
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    {olderPurchaseHistory.length} older {olderPurchaseHistory.length === 1 ? "entry" : "entries"}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPurchaseHistoryModalOpen(false)}
                                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                            >
                                Close
                            </button>
                        </div>

                        <div className="p-5 overflow-y-auto">
                            {olderPurchaseHistory.length === 0 ? (
                                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                                    No older purchase history to show.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {olderPurchaseHistory.map(renderHistoryEntry)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

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

                        <div className="p-4">
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShoppingListStatusFilters([])}
                                    className={[
                                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                                        shoppingListStatusFilters.length === 0
                                            ? "border-slate-700 bg-slate-800 text-white"
                                            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                                    ].join(" ")}
                                >
                                    All
                                </button>
                                {shoppingListStatusOptions.map((status) => {
                                    const selected = shoppingListStatusFilters.includes(status);

                                    return (
                                        <button
                                            key={status}
                                            type="button"
                                            onClick={() => toggleShoppingListStatusFilter(status)}
                                            className={[
                                                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                                                selected
                                                    ? "border-blue-600 bg-blue-50 text-blue-700"
                                                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                                            ].join(" ")}
                                        >
                                            {status}
                                        </button>
                                    );
                                })}
                            </div>

                            <input
                                type="text"
                                value={shoppingListSearch}
                                onChange={(e) => setShoppingListSearch(e.target.value)}
                                placeholder="Search shopping list items..."
                                className="mb-3 w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                            />

                            {shoppingListItemsLoading ? (
                                <div className="text-center py-10 text-gray-500">
                                    Loading shopping list items...
                                </div>
                            ) : filteredShoppingListItems.length > 0 ? (
                                <div className="max-h-[520px] overflow-y-auto space-y-2">
                                    {filteredShoppingListItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 md:flex-row md:items-center md:justify-between"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="truncate text-sm font-semibold text-gray-800">
                                                        {item.name || "Unnamed Item"}
                                                    </p>
                                                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                                                        {item.status || "No status"}
                                                    </span>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs text-gray-500">
                                                    {item.description || "No description"}
                                                </p>
                                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                                                    <span>{item.category || "Uncategorized"}</span>
                                                    <span>Qty {item.quantity || "—"}</span>
                                                    <span>{item.purchaserName || "No purchaser"}</span>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => connectShoppingListItem(item)}
                                                className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
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

            {jobModalOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">
                                    Select Job
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    Load jobs inside a date range, then connect this purchase
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setJobModalOpen(false)}
                                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                            >
                                Close
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">
                                        Start Date
                                    </label>
                                    <input
                                        type="date"
                                        value={jobStartDate}
                                        onChange={(e) => setJobStartDate(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">
                                        End Date
                                    </label>
                                    <input
                                        type="date"
                                        value={jobEndDate}
                                        onChange={(e) => setJobEndDate(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-gray-600 mb-1">
                                        Search
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={jobSearch}
                                            onChange={(e) => setJobSearch(e.target.value)}
                                            placeholder="Search jobs..."
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                        <button
                                            type="button"
                                            onClick={loadJobs}
                                            disabled={jobsLoading}
                                            className="shrink-0 px-4 py-2 text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition disabled:opacity-60"
                                        >
                                            {jobsLoading ? "Loading" : "Load"}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {jobsLoading ? (
                                <div className="text-center py-10 text-gray-500">
                                    Loading jobs...
                                </div>
                            ) : filteredJobs.length > 0 ? (
                                <div className="max-h-[460px] overflow-y-auto space-y-3">
                                    {filteredJobs.map((job) => {
                                        const jobDate = job.dateCreated?.toDate ? job.dateCreated.toDate() : job.dateCreated;
                                        const dateLabel = jobDate ? format(new Date(jobDate), "MMM d, yyyy") : "No date";
                                        const isSelected = (purchase.jobId || purchase.workOrderId) === job.id;

                                        return (
                                            <div
                                                key={job.id}
                                                className={[
                                                    "p-4 rounded-xl border flex flex-col md:flex-row md:items-center md:justify-between gap-4",
                                                    isSelected
                                                        ? "border-blue-300 bg-blue-50"
                                                        : "border-gray-200 bg-gray-50",
                                                ].join(" ")}
                                            >
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="font-semibold text-gray-800">
                                                            {job.internalId || "Job"}
                                                        </p>
                                                        <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                                                            {job.operationStatus || "Status"}
                                                        </span>
                                                        <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                                                            {job.billingStatus || "Billing"}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-gray-500 mt-1">
                                                        {job.customerName || "No customer"} • {dateLabel}
                                                    </p>
                                                    <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                                                        {job.description || "No description"}
                                                    </p>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => connectJob(job)}
                                                    disabled={isSelected}
                                                    className="shrink-0 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition disabled:opacity-60"
                                                >
                                                    {isSelected ? "Selected" : "Select"}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-10 text-gray-500">
                                    No jobs found for this date range.
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
