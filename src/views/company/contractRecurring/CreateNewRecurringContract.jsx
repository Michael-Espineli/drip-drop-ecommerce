import React, { useState, useEffect, useContext, useMemo } from "react";
import Select from "react-select";
import {
    query,
    collection,
    getDocs,
    where,
    setDoc,
    doc,
    Timestamp,
    orderBy,
    serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import { Link, useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ServiceLocation } from "../../../utils/models/ServiceLocation";

const functions = getFunctions();

const CreateNewRecurringContract = () => {
    const { customerId } = useParams();
    const navigate = useNavigate();

    const {
        stripeConnectedAccountId,
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        dataBaseUser,
        currentUser,
        user,
        currentuser,
    } = useContext(Context);

    const activeUser = currentUser || user || currentuser || {};
    const getUserId = () => activeUser?.uid || activeUser?.id || "";
    const getUserName = () =>
        activeUser?.displayName ||
        activeUser?.userName ||
        activeUser?.name ||
        `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
        "Unknown";

    const [loading, setLoading] = useState(true);
    const [creatingContract, setCreatingContract] = useState(false);

    const [customerList, setCustomerList] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);

    const [productList, setProductList] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState(null);

    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [serviceLocation, setServiceLocation] = useState([]);

    const [chemType, setChemType] = useState("");
    const [notes, setNotes] = useState("");
    const [terms, setTerms] = useState("");
    const [laborType, setLaborType] = useState("");
    const [email, setEmail] = useState("");
    const [rate, setRate] = useState("180");
    const [rateInterval, setRateInterval] = useState("");
    const [rateIntervalAmount, setRateIntervalAmount] = useState("");

    const [laborRate, setLaborRate] = useState("11");
    const [defaultPrice, setDefaultPrice] = useState(null);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [draftContractData, setDraftContractData] = useState({
        id: "",
        senderName: "",
        senderId: "",
        senderUserId: "",
        senderAcceptance: true,
        receiverName: "",
        receiverId: "",
        customerId: "",
        customerName: "",
        email: "",
        companyId: "",
        companyName: "",
        connectedAccountId: "",
        stripeCustomerId: "",
        productId: "",
        priceId: "",
        productName: "",
        chemType: "",
        laborRate: 0,
        laborType: "",
        notes: "",
        terms: [],
        rate: 0,
        rateInterval: "",
        rateIntervalAmount: "",
        serviceLocationIds: [],
        locations: 0,
        status: "Draft",
        dateSent: null,
        startDate: "",
        dateToAccept: "",
        createdAt: null,
        updatedAt: null,
        clientId: "",
    });

    const chemTypeOptions = [
        { value: "", label: "Select Chem Type" },
        { value: "5", label: "All Inclusive" },
        { value: "10", label: "Without Chems" },
        { value: "25", label: "Includes Specific Chems" },
        { value: "50", label: "Excludes Specific Chems" },
    ];

    const laborTypeOptions = [
        { value: "", label: "Select Labor Type" },
        { value: "5", label: "per Stop" },
        { value: "10", label: "per Week" },
        { value: "25", label: "per Month" },
    ];

    const contractStatusOptions = useMemo(
        () => ["Draft", "Pending", "Sent", "Accepted", "Rejected", "Paused", "Canceled"],
        []
    );

    const selectTheme = (theme) => ({
        ...theme,
        borderRadius: 12,
        colors: {
            ...theme.colors,
            primary25: "#EFF6FF",
            primary: "#2563EB",
            neutral0: "#FFFFFF",
            neutral20: "#D1D5DB",
            neutral30: "#9CA3AF",
        },
    });

    const selectStyles = {
        control: (base, state) => ({
            ...base,
            minHeight: 44,
            borderRadius: 12,
            borderColor: state.isFocused ? "#2563EB" : "#D1D5DB",
            boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.25)" : "none",
            "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#9CA3AF" },
        }),
        menu: (base) => ({ ...base, borderRadius: 12, overflow: "hidden", zIndex: 30 }),
    };

    const toInputDateValue = (value) => {
        if (!value) return "";
        const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
        if (Number.isNaN(date?.getTime?.())) return "";
        return date.toISOString().split("T")[0];
    };

    const normalizeTerms = (value) => {
        if (!Array.isArray(value)) return [];
        return value.map((term, index) => {
            if (typeof term === "string") {
                return {
                    id: `term_${index}`,
                    title: term,
                    description: "",
                    value: "",
                };
            }

            return {
                id: term?.id || `term_${index}`,
                title: term?.title || `Term ${index + 1}`,
                description: term?.description || "",
                value: term?.value ?? "",
            };
        });
    };

    const formatCurrency = (number, locale = "en-US", currency = "USD") =>
        new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(number || 0));

    const summaryBillingText = rateInterval
        ? `${rateIntervalAmount || 1} ${rateInterval}`
        : "Not selected";

    const buildDefaultTerms = () => {
        const normalizedRateCents = Math.round(Number(rate || 0) * 100);

        return [
            {
                id: uuidv4(),
                title: "Scope of Work",
                description:
                    terms?.trim() ||
                    notes?.trim() ||
                    "Provide recurring service as agreed for the selected locations.",
                value: "",
            },
            {
                id: uuidv4(),
                title: "Billing Interval",
                description: summaryBillingText,
                value: summaryBillingText,
            },
            {
                id: uuidv4(),
                title: "Billing Amount",
                description: "Estimated recurring total for this contract",
                value: normalizedRateCents,
            },
        ];
    };

    const canOpenCreateModal = useMemo(() => {
        return (
            !!selectedCustomer?.id &&
            !!email &&
            Array.isArray(serviceLocation) &&
            serviceLocation.length > 0 &&
            !!rate
        );
    }, [selectedCustomer, email, serviceLocation, rate]);

    const handleDraftContractDataChange = (field, value) => {
        setDraftContractData((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleDraftTermChange = (index, field, value) => {
        setDraftContractData((prev) => {
            const nextTerms = normalizeTerms(prev.terms);
            nextTerms[index] = {
                ...nextTerms[index],
                [field]: value,
            };
            return {
                ...prev,
                terms: nextTerms,
            };
        });
    };

    const addDraftTerm = () => {
        setDraftContractData((prev) => ({
            ...prev,
            terms: [
                ...normalizeTerms(prev.terms),
                {
                    id: uuidv4(),
                    title: "",
                    description: "",
                    value: "",
                },
            ],
        }));
    };

    const removeDraftTerm = (index) => {
        setDraftContractData((prev) => ({
            ...prev,
            terms: normalizeTerms(prev.terms).filter((_, i) => i !== index),
        }));
    };

    useEffect(() => {
        if (!recentlySelectedCompany || !stripeConnectedAccountId) return;

        (async () => {
            try {
                setLoading(true);

                const q = query(
                    collection(db, "companies", recentlySelectedCompany, "customers"),
                    orderBy("firstName"),
                    where("active", "==", true)
                );

                const querySnapshot = await getDocs(q);
                const customers = querySnapshot.docs.map((docSnap) => {
                    const customerDoc = docSnap.data();
                    return {
                        id: customerDoc.id,
                        name: `${customerDoc.firstName || ""} ${customerDoc.lastName || ""}`.trim(),
                        streetAddress: customerDoc.billingAddress?.streetAddress || "",
                        phoneNumber: customerDoc.phoneNumber || "",
                        email: customerDoc.email || "",
                        label: `${customerDoc.firstName || ""} ${customerDoc.lastName || ""}`.trim(),
                    };
                });

                setCustomerList(customers);

                if (customerId && customerId !== "NA") {
                    const existingCustomer = customers.find((c) => c.id === customerId);
                    if (existingCustomer) {
                        setSelectedCustomer(existingCustomer);
                        setEmail(existingCustomer.email || "");

                        try {
                            const serviceLocationQuery = query(
                                collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
                                where("customerId", "==", customerId)
                            );

                            const serviceLocationSnapshot = await getDocs(serviceLocationQuery);
                            const locations = serviceLocationSnapshot.docs.map((docSnap) => {
                                const serviceLocationData = docSnap.data();
                                return {
                                    id: serviceLocationData.id,
                                    bodiesOfWaterId: serviceLocationData.bodiesOfWaterId || [],
                                    streetAddress: serviceLocationData.address?.streetAddress || "",
                                    city: serviceLocationData.address?.city || "",
                                    state: serviceLocationData.address?.state || "",
                                    zip: serviceLocationData.address?.zip || "",
                                    nickName: serviceLocationData.nickName || "",
                                    label: [
                                        serviceLocationData.address?.streetAddress,
                                        serviceLocationData.address?.city,
                                        serviceLocationData.address?.state,
                                        serviceLocationData.address?.zip,
                                    ]
                                        .filter(Boolean)
                                        .join(" "),
                                };
                            });

                            setServiceLocationList(locations);
                        } catch (error) {
                            console.error(error);
                            toast.error("Error loading service locations");
                        }
                    }
                }

                const getProductList = httpsCallable(functions, "getProductList");
                const result = await getProductList({
                    active: true,
                    connectedAccount: stripeConnectedAccountId,
                    method: "POST",
                });

                const list = result?.data?.productList?.data || [];
                const normalizedProducts = list.map((product) => ({
                    ...product,
                    label: `${product.name} ${product.description || ""}`.trim(),
                    value: product.id,
                }));

                setProductList(normalizedProducts);
            } catch (error) {
                console.error(error);
                toast.error("Failed to load recurring contract form");
            } finally {
                setLoading(false);
            }
        })();
    }, [customerId, recentlySelectedCompany, stripeConnectedAccountId]);

    const handleCustomerChange = (selectedOption) => {
        (async () => {
            try {
                setSelectedCustomer(selectedOption);
                setEmail(selectedOption?.email || "");
                setServiceLocation([]);
                setServiceLocationList([]);

                if (!selectedOption?.id) return;

                const locationQuery = query(
                    collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
                    where("customerId", "==", selectedOption.id)
                );

                const locationSnapShot = await getDocs(locationQuery);
                const serviceLocations = locationSnapShot.docs.map((docSnap) => {
                    const loc = ServiceLocation.fromFirestore(docSnap);
                    return {
                        ...loc,
                        label:
                            loc?.label ||
                            [
                                loc?.address?.streetAddress || loc?.streetAddress,
                                loc?.address?.city || loc?.city,
                                loc?.address?.state || loc?.state,
                                loc?.address?.zip || loc?.zip,
                            ]
                                .filter(Boolean)
                                .join(" "),
                    };
                });

                setServiceLocationList(serviceLocations);

                if (serviceLocations.length > 0) {
                    setServiceLocation([serviceLocations[0]]);
                }
            } catch (error) {
                console.error(error);
                toast.error("Error loading customer service locations");
            }
        })();
    };

    const handleProductChange = (selectedOption) => {
        setSelectedProduct(selectedOption);

        if (!selectedOption?.default_price) {
            setDefaultPrice(null);
            setRate("");
            setRateInterval("");
            setRateIntervalAmount("");
            return;
        }

        const getDefaultPrice = httpsCallable(functions, "getDefaultPrice");
        getDefaultPrice({
            priceId: selectedOption.default_price,
            connectedAccount: stripeConnectedAccountId,
            method: "POST",
        })
            .then((result) => result.data.price)
            .then((price) => {
                setDefaultPrice(price);
                setRate(String((price?.unit_amount || 0) / 100));
                setRateInterval(price?.recurring?.interval || "");
                setRateIntervalAmount(String(price?.recurring?.interval_count || ""));
            })
            .catch((error) => {
                console.error(error);
                toast.error("Failed to load default product pricing");
            });
    };

    const handleServiceLocationChange = (selectedOption) => {
        setServiceLocation(selectedOption || []);
    };

    const openCreateContractModal = () => {
        if (!selectedCustomer?.id) return toast.error("Select a customer");
        if (!email) return toast.error("Add an email");
        if (!serviceLocation?.length) return toast.error("Select at least one service location");
        if (!rate) return toast.error("Add a rate");

        const id = "cont_" + uuidv4();
        const today = new Date();
        const acceptBy = new Date();
        acceptBy.setDate(acceptBy.getDate() + 7);

        const serviceLocationIds = serviceLocation.map((loc) => loc.id).filter(Boolean);
        const defaultTerms = buildDefaultTerms();

        setDraftContractData({
            id,
            senderName: getUserName(),
            senderId: recentlySelectedCompany || "",
            senderUserId: getUserId() || "",
            senderAcceptance: true,
            receiverName: selectedCustomer?.name || "",
            receiverId: selectedCustomer?.id || "",
            customerId: selectedCustomer?.id || "",
            customerName: selectedCustomer?.name || "",
            email: email || "",
            companyId: recentlySelectedCompany || "",
            companyName: recentlySelectedCompanyName || "",
            connectedAccountId: stripeConnectedAccountId || "",
            stripeCustomerId: "",
            productId: selectedProduct?.id || "",
            priceId: selectedProduct?.default_price || "",
            productName: selectedProduct?.name || "",
            chemType: chemType || "",
            laborRate: Number(laborRate || 0),
            laborType: laborType || "",
            notes: notes || "",
            terms: defaultTerms,
            rate: Math.round(Number(rate || 0) * 100),
            rateInterval: rateInterval || "",
            rateIntervalAmount: Number(rateIntervalAmount || 0),
            serviceLocationIds,
            locations: serviceLocationIds.length,
            status: "Draft",
            dateSent: null,
            startDate: toInputDateValue(today),
            dateToAccept: toInputDateValue(acceptBy),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            clientId: "",
        });

        setShowCreateModal(true);
    };

    const closeCreateContractModal = () => {
        setShowCreateModal(false);
    };

    const createRecurringContract = async () => {
        try {
            if (!draftContractData.id) return toast.error("Missing contract id");
            if (!draftContractData.receiverId) return toast.error("Missing customer");
            if (!draftContractData.serviceLocationIds?.length) {
                return toast.error("Missing service locations");
            }

            setCreatingContract(true);

            await setDoc(doc(db, "recurringContracts", draftContractData.id), {
                ...draftContractData,
                terms: normalizeTerms(draftContractData.terms),
                rate: Number(draftContractData.rate || 0),
                laborRate: Number(draftContractData.laborRate || 0),
                rateIntervalAmount: Number(draftContractData.rateIntervalAmount || 0),
                startDate: draftContractData.startDate
                    ? Timestamp.fromDate(new Date(draftContractData.startDate))
                    : null,
                dateToAccept: draftContractData.dateToAccept
                    ? Timestamp.fromDate(new Date(draftContractData.dateToAccept))
                    : null,
                dateSent:
                    draftContractData.status === "Sent" || draftContractData.status === "Pending"
                        ? serverTimestamp()
                        : null,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            });

            toast.success("Recurring contract created");
            setShowCreateModal(false);
            navigate("/company/recurring-contracts");
        } catch (error) {
            console.error(error);
            toast.error("Failed to create recurring contract");
        } finally {
            setCreatingContract(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
                <div className="max-w-screen-xl mx-auto">
                    <div className="bg-white shadow-lg rounded-xl p-6">
                        <div className="animate-pulse space-y-4">
                            <div className="h-6 bg-gray-200 rounded w-1/3" />
                            <div className="h-4 bg-gray-200 rounded w-1/2" />
                            <div className="h-4 bg-gray-200 rounded w-2/3" />
                            <div className="h-40 bg-gray-200 rounded" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-screen-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <Link
                            to="/company/recurring-contracts"
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back to Recurring Contracts
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">
                            Create New Recurring Service Contract
                        </h2>
                        <p className="text-gray-600 mt-1">
                            Build a recurring agreement in the same review-first flow used elsewhere in the app.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={openCreateContractModal}
                            disabled={!canOpenCreateModal}
                            className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl shadow-sm hover:bg-amber-100 transition disabled:opacity-50"
                        >
                            Review & Create Draft
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="xl:col-span-2 space-y-6">
                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">Customer & Locations</h3>
                                    <p className="text-gray-600 mt-1">
                                        Choose who this recurring contract is for and where service will happen.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Customer
                                    </label>
                                    <Select
                                        value={selectedCustomer}
                                        options={customerList}
                                        onChange={handleCustomerChange}
                                        isSearchable
                                        placeholder="Select a customer"
                                        theme={selectTheme}
                                        styles={selectStyles}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                            Email
                                        </label>
                                        <input
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            type="text"
                                            placeholder="Email"
                                        />
                                    </div>

                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                            Selected Customer
                                        </p>
                                        <p className="mt-2 text-gray-800 font-semibold">
                                            {selectedCustomer?.name || "No customer selected"}
                                        </p>
                                        {!!selectedCustomer?.streetAddress && (
                                            <p className="mt-1 text-sm text-gray-600">
                                                {selectedCustomer.streetAddress}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Service Locations
                                    </label>
                                    <Select
                                        value={serviceLocation}
                                        options={serviceLocationList}
                                        onChange={handleServiceLocationChange}
                                        isSearchable
                                        isMulti
                                        placeholder="Select service location(s)"
                                        theme={selectTheme}
                                        styles={selectStyles}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">Service & Pricing</h3>
                                <p className="text-gray-600 mt-1">
                                    Choose the recurring product and billing settings.
                                </p>
                            </div>

                            <div className="mt-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Product
                                    </label>
                                    <Select
                                        value={selectedProduct}
                                        options={productList}
                                        onChange={handleProductChange}
                                        isSearchable
                                        placeholder="Select a product"
                                        theme={selectTheme}
                                        styles={selectStyles}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                            Rate (USD)
                                        </label>
                                        <input
                                            value={rate}
                                            onChange={(e) => setRate(e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                            type="text"
                                            placeholder="Rate"
                                        />
                                    </div>

                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                            Chem Type
                                        </label>
                                        <select
                                            value={chemType}
                                            onChange={(e) => setChemType(e.target.value)}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        >
                                            {chemTypeOptions.map((option) => (
                                                <option key={option.value || "blank"} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                            Rate Interval
                                        </p>
                                        <p className="mt-2 text-lg font-bold text-gray-800 capitalize">
                                            {rateInterval || "Not selected"}
                                        </p>
                                    </div>

                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                            Interval Count
                                        </p>
                                        <p className="mt-2 text-lg font-bold text-gray-800">
                                            {rateIntervalAmount || "—"}
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                        Scope / Terms Notes
                                    </label>
                                    <textarea
                                        value={terms}
                                        onChange={(e) => setTerms(e.target.value)}
                                        className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        placeholder="Describe the recurring scope of work or contract terms..."
                                    />
                                    <p className="mt-2 text-xs text-gray-500">
                                        This text seeds the default “Scope of Work” contract term when you create the draft.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">Internal Settings</h3>
                                <p className="text-gray-600 mt-1">
                                    Internal labor and note fields used for setup and tracking.
                                </p>
                            </div>

                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                        Labor Rate
                                    </label>
                                    <input
                                        value={laborRate}
                                        onChange={(e) => setLaborRate(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        type="text"
                                        placeholder="Labor Rate"
                                    />
                                </div>

                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                        Labor Type
                                    </label>
                                    <select
                                        value={laborType}
                                        onChange={(e) => setLaborType(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                    >
                                        {laborTypeOptions.map((option) => (
                                            <option key={option.value || "blank"} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="md:col-span-2 p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <div className="flex items-center justify-between gap-3">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                            Internal Notes
                                        </label>
                                        <span className="text-xs text-gray-500">
                                            Customer will not see these notes
                                        </span>
                                    </div>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        className="mt-2 w-full min-h-[140px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        placeholder="Internal notes"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <h4 className="text-lg font-bold text-gray-800">Lifecycle Guidance</h4>
                            <p className="text-gray-600 mt-1 text-sm">
                                Similar to the job estimate flow, this screen now reviews the draft before creation.
                            </p>

                            <div className="mt-4 flex flex-wrap gap-3">
                                {contractStatusOptions.map((status) => (
                                    <span
                                        key={status}
                                        className="px-3 py-2 rounded-full text-xs font-bold bg-gray-100 text-gray-800"
                                    >
                                        {status}
                                    </span>
                                ))}
                            </div>

                            <div className="mt-6 grid grid-cols-1 gap-4">
                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <p className="font-semibold text-gray-800">1. Build Draft</p>
                                    <p className="mt-1 text-sm text-gray-600">
                                        Select customer, locations, product, recurring rate, and internal settings.
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <p className="font-semibold text-gray-800">2. Review Details</p>
                                    <p className="mt-1 text-sm text-gray-600">
                                        Confirm start date and acceptance deadline in the modal before creating.
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <p className="font-semibold text-gray-800">3. Send Later</p>
                                    <p className="mt-1 text-sm text-gray-600">
                                        The contract can be created as a draft first, then sent in a later lifecycle step.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <h4 className="text-lg font-bold text-gray-800">Summary</h4>
                            <div className="mt-4 grid grid-cols-1 gap-4">
                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Customer
                                    </p>
                                    <p className="mt-1 text-gray-800 font-semibold">
                                        {selectedCustomer?.name || "Not selected"}
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Product
                                    </p>
                                    <p className="mt-1 text-gray-800 font-semibold">
                                        {selectedProduct?.name || "Not selected"}
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Billing
                                    </p>
                                    <p className="mt-1 text-gray-800 font-semibold">
                                        {summaryBillingText}
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Rate
                                    </p>
                                    <p className="mt-1 text-gray-800 font-semibold">
                                        {formatCurrency(rate || 0)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {showCreateModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                        <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
                            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">Recurring Contract Details</h3>
                                    <p className="mt-1 text-sm text-gray-600">
                                        Review and edit this recurring contract before creating the draft.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={closeCreateContractModal}
                                    className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Receiver Name
                                        </label>
                                        <div className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-800">
                                            {draftContractData.receiverName || "—"}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Status
                                        </label>
                                        <select
                                            value={draftContractData.status}
                                            onChange={(e) =>
                                                handleDraftContractDataChange("status", e.target.value)
                                            }
                                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                                        >
                                            {contractStatusOptions.map((status) => (
                                                <option key={status} value={status}>
                                                    {status}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Rate (USD)
                                        </label>
                                        <input
                                            type="text"
                                            value={Number(draftContractData.rate || 0) / 100}
                                            onChange={(e) =>
                                                handleDraftContractDataChange(
                                                    "rate",
                                                    Math.round(Number(e.target.value || 0) * 100)
                                                )
                                            }
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Start Date
                                        </label>
                                        <input
                                            type="date"
                                            value={draftContractData.startDate}
                                            onChange={(e) =>
                                                handleDraftContractDataChange("startDate", e.target.value)
                                            }
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Date To Accept
                                        </label>
                                        <input
                                            type="date"
                                            value={draftContractData.dateToAccept}
                                            onChange={(e) =>
                                                handleDraftContractDataChange("dateToAccept", e.target.value)
                                            }
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                                            Billing Interval
                                        </label>
                                        <div className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-800 capitalize">
                                            {draftContractData.rateInterval
                                                ? `${draftContractData.rateIntervalAmount || 1} ${draftContractData.rateInterval}`
                                                : "—"}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                        <label className="block text-sm font-semibold text-gray-500">
                                            Terms
                                        </label>
                                        <button
                                            type="button"
                                            onClick={addDraftTerm}
                                            className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition"
                                        >
                                            Add Term
                                        </button>
                                    </div>

                                    {!normalizeTerms(draftContractData.terms).length ? (
                                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                                            No terms found.
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {normalizeTerms(draftContractData.terms).map((term, index) => (
                                                <div
                                                    key={term.id || index}
                                                    className="p-4 rounded-xl bg-gray-50 border border-gray-200"
                                                >
                                                    <div className="flex items-center justify-between gap-3 mb-3">
                                                        <p className="text-sm font-bold text-gray-800">
                                                            Term {index + 1}
                                                        </p>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeDraftTerm(index)}
                                                            className="px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 transition"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>

                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div className="md:col-span-2">
                                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                                                Title
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={term.title || ""}
                                                                onChange={(e) =>
                                                                    handleDraftTermChange(index, "title", e.target.value)
                                                                }
                                                                className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                                                            />
                                                        </div>

                                                        <div className="md:col-span-2">
                                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                                                Description
                                                            </label>
                                                            <textarea
                                                                value={term.description || ""}
                                                                onChange={(e) =>
                                                                    handleDraftTermChange(index, "description", e.target.value)
                                                                }
                                                                className="w-full min-h-[100px] p-3 border border-gray-300 rounded-lg bg-white"
                                                            />
                                                        </div>

                                                        <div>
                                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                                                Value
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={term.value ?? ""}
                                                                onChange={(e) =>
                                                                    handleDraftTermChange(index, "value", e.target.value)
                                                                }
                                                                className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                                        Internal Notes
                                    </label>
                                    <textarea
                                        value={draftContractData.notes}
                                        onChange={(e) =>
                                            handleDraftContractDataChange("notes", e.target.value)
                                        }
                                        className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg"
                                    />
                                </div>

                                <div>
                                    <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
                                        Selected Service Locations
                                    </h4>

                                    {!serviceLocation?.length ? (
                                        <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                                            No service locations selected.
                                        </div>
                                    ) : (
                                        <div className="mt-3 space-y-3">
                                            {serviceLocation.map((location, index) => (
                                                <div
                                                    key={location?.id || index}
                                                    className="p-4 rounded-xl bg-gray-50 border border-gray-200"
                                                >
                                                    <p className="font-semibold text-gray-800">
                                                        {location?.nickName || `Location ${index + 1}`}
                                                    </p>
                                                    <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                                                        {location?.label ||
                                                            [
                                                                location?.streetAddress,
                                                                location?.city,
                                                                location?.state,
                                                                location?.zip,
                                                            ]
                                                                .filter(Boolean)
                                                                .join(", ") ||
                                                            "—"}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
                                        Contract Snapshot
                                    </h4>

                                    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
                                        <table className="min-w-full bg-white">
                                            <thead className="bg-gray-100">
                                                <tr>
                                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                                                        Field
                                                    </th>
                                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                                                        Value
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200">
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Customer</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.customerName || "—"}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Email</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.email || "—"}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Product</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.productName || "—"}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Rate</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {formatCurrency((Number(draftContractData.rate || 0) / 100) || 0)}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Chem Type</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.chemType || "—"}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Labor Rate</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.laborRate || 0}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Labor Type</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.laborType || "—"}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Locations</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.locations || 0}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td className="p-4 text-sm text-gray-700">Price</td>
                                                    <td className="p-4 text-sm font-medium text-gray-800">
                                                        {draftContractData.priceId || "—"}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6 border-t border-gray-200 flex flex-col sm:flex-row gap-3 sm:justify-end">
                                <button
                                    type="button"
                                    onClick={closeCreateContractModal}
                                    className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-100 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={createRecurringContract}
                                    disabled={creatingContract}
                                    className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 font-semibold hover:bg-amber-100 transition disabled:opacity-50"
                                >
                                    {creatingContract ? "Creating..." : "Confirm & Create Draft"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CreateNewRecurringContract;
