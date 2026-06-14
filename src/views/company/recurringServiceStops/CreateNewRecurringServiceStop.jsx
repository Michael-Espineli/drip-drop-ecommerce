
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { collection, query, getDocs, where, doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../utils/config';
import { Context } from "../../../context/AuthContext";
import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import { salesCollectionNames } from '../../../utils/models/Sales';
import { recurringFrequencyToAgreementService } from '../../../utils/sales/agreementCadence';
import Select from 'react-select';
import DatePicker from "react-datepicker";
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import 'react-datepicker/dist/react-datepicker.css';
import {
    debugServiceStopTypeWrite,
    resolveServiceStopTypeFields,
    SERVICE_STOP_TYPE_USE_CASES,
    serviceStopTypeMatchesUseCase,
    suggestCompanyServiceStopType,
} from '../../../utils/serviceStopTypes/serviceStopTypeResolver';
import { addRecurringServiceStopToPlannedRoute } from '../../../utils/recurringRouteSync';

const functions = getFunctions();

const firestoreValueToDate = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const cadenceToFrequencyOption = (cadence = "") => {
    const normalized = String(cadence).toLowerCase();
    if (normalized.includes("day")) return { value: "Daily", label: "Daily" };
    if (normalized.includes("twice")) return { value: "Twice Weekly", label: "Twice Weekly" };
    if (normalized.includes("three") || normalized.includes("triple")) return { value: "Three Times Weekly", label: "Three Times Weekly" };
    if (normalized.includes("bi") || normalized.includes("2 week")) return { value: "Bi-Weekly", label: "Bi-Weekly" };
    if (normalized.includes("month")) return { value: "Monthly", label: "Monthly" };
    return { value: "Weekly", label: "Weekly" };
};

const CreateNewRecurringServiceStop = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { customerId } = useParams(); // Capture customerId from URL
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const agreementId = searchParams.get("agreementId") || "";
    const billingSubscriptionId = searchParams.get("billingSubscriptionId") || "";
    const requestedServiceLocationId = searchParams.get("serviceLocationId") || "";
    const returnTo = searchParams.get("returnTo") || "";

    // Form State
    const [customer, setCustomer] = useState(null);
    const [serviceLocation, setServiceLocation] = useState(null);
    const [tech, setTech] = useState(null);
    const [dayOfWeek, setDayOfWeek] = useState({ value: "Monday", label: "Monday" });
    const [frequency, setFrequency] = useState({ value: "Weekly", label: "Weekly" });
    const [startDate, setStartDate] = useState(new Date());
    const [endDate, setEndDate] = useState(null);
    const [noEndDate, setNoEndDate] = useState(true);
    const [description, setDescription] = useState("");
    const [selectedServiceStopType, setSelectedServiceStopType] = useState(null);

    // Select List Options
    const [customerList, setCustomerList] = useState([]);
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [techList, setTechList] = useState([]);
    const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const dayOptions = [
        { value: "Sunday", label: "Sunday" },
        { value: "Monday", label: "Monday" },
        { value: "Tuesday", label: "Tuesday" },
        { value: "Wednesday", label: "Wednesday" },
        { value: "Thursday", label: "Thursday" },
        { value: "Friday", label: "Friday" },
        { value: "Saturday", label: "Saturday" },
    ];

    const frequencyOptions = [
        { value: "Daily", label: "Daily" },
        { value: "Weekly", label: "Weekly" },
        { value: "Twice Weekly", label: "Twice Weekly" },
        { value: "Three Times Weekly", label: "Three Times Weekly" },
        { value: "Bi-Weekly", label: "Bi-Weekly" },
        { value: "Monthly", label: "Monthly" },
    ];

    const serviceStopTypeOptions = useMemo(
        () =>
            companyServiceStopTypes
                .filter((type) => type.isActive !== false && type.active !== false && type.status !== "Inactive")
                .filter((type) => serviceStopTypeMatchesUseCase(type, SERVICE_STOP_TYPE_USE_CASES.recurringRoute))
                .map((type) => ({
                    ...type,
                    value: type.id,
                    label: type.name || "Unnamed Service Stop Type",
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [companyServiceStopTypes]
    );

    // =============================
    // iOS helper -> React helper
    // =============================
    const ms = (d) => (d ? Math.floor(new Date(d).getTime()) : null);

    const createFirstRecurringServiceStop = async (companyId, recurringServiceStop) => {
        const functions = getFunctions();
        const callable = httpsCallable(functions, "createFirstRecurringServiceStop2");

        const payload = {
            companyId,
            recurringServiceStop: {
                id: recurringServiceStop.id,
                internalId: recurringServiceStop.internalId ?? null,

                type: recurringServiceStop.type,
                typeId: recurringServiceStop.typeId,
                typeImage: recurringServiceStop.typeImage ?? null,

                customerName: recurringServiceStop.customerName,
                customerId: recurringServiceStop.customerId,

                address: {
                    streetAddress: recurringServiceStop.address?.streetAddress ?? "",
                    city: recurringServiceStop.address?.city ?? "",
                    state: recurringServiceStop.address?.state ?? "",
                    zip: recurringServiceStop.address?.zip ?? "",
                    latitude: recurringServiceStop.address?.latitude ?? null,
                    longitude: recurringServiceStop.address?.longitude ?? null,
                },

                tech: recurringServiceStop.tech,
                techId: recurringServiceStop.techId,

                dateCreated: ms(recurringServiceStop.dateCreated ?? new Date()),
                startDate: ms(recurringServiceStop.startDate),
                endDate: ms(recurringServiceStop.endDate ?? null),
                noEndDate: !!recurringServiceStop.noEndDate,

                // raw strings (like Swift .rawValue)
                frequency: recurringServiceStop.frequency,
                day: recurringServiceStop.day,
                daysOfWeek: recurringServiceStop.daysOfWeek ?? recurringServiceStop.day ?? "",

                description: recurringServiceStop.description ?? "",
                lastCreated: ms(recurringServiceStop.lastCreated ?? new Date()),

                serviceLocationId: recurringServiceStop.serviceLocationId,
                estimatedTime: recurringServiceStop.estimatedTime ?? null,

                otherCompany: recurringServiceStop.otherCompany ?? false,
                laborContractId: recurringServiceStop.laborContractId ?? "",
                contractedCompanyId: recurringServiceStop.contractedCompanyId ?? "",
                mainCompanyId: recurringServiceStop.mainCompanyId ?? "",
                salesAgreementId: recurringServiceStop.salesAgreementId ?? "",
                salesBillingSubscriptionId: recurringServiceStop.salesBillingSubscriptionId ?? "",
            },
        };

        const result = await callable(payload);

        // mimic Swift "guard let json = result.data as? [String: Any]"
        if (result.data === null || typeof result.data !== "object") {
            throw new Error("unable_to_read_function_response");
        }

        // Swift returns recurringServiceStop.id
        return recurringServiceStop.id;
    };

    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                // Fetch Customers
                const custQuery = query(collection(db, 'companies', recentlySelectedCompany, 'customers'));
                const custSnapshot = await getDocs(custQuery);
                const customers = custSnapshot.docs.map(doc => ({ ...doc.data(), value: doc.id, label: `${doc.data().firstName} ${doc.data().lastName}` }));
                setCustomerList(customers);

                // Fetch Technicians
                const techQuery = query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'));
                const techSnapshot = await getDocs(techQuery);
                const techs = techSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        ...data,
                        id: data.userId || data.id || doc.id,
                        value: data.userId || data.id || doc.id,
                        label: data.userName || data.name || "Technician",
                    };
                });
                setTechList(techs);

                const serviceStopTypesSnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'companyServiceStopTypes'));
                setCompanyServiceStopTypes(serviceStopTypesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                let preselectedCustomerId = customerId && customerId !== 'NA' ? customerId : '';
                const descriptionParts = [];

                if (agreementId) {
                    const agreementSnap = await getDoc(doc(db, salesCollectionNames.agreements, agreementId));
                    if (agreementSnap.exists()) {
                        const agreement = { id: agreementSnap.id, ...agreementSnap.data() };
                        if (agreement.companyId === recentlySelectedCompany) {
                            preselectedCustomerId = preselectedCustomerId || agreement.customerId || '';
                            descriptionParts.push(`Service agreement: ${agreement.title || "linked agreement"}`);
                            if (agreement.serviceCadence) {
                                setFrequency(cadenceToFrequencyOption(agreement.serviceCadence));
                            }
                            const agreementStartDate = firestoreValueToDate(agreement.startDate);
                            if (agreementStartDate) setStartDate(agreementStartDate);
                        }
                    }
                }

                if (billingSubscriptionId) {
                    const subscriptionSnap = await getDoc(doc(db, salesCollectionNames.billingSubscriptions, billingSubscriptionId));
                    if (subscriptionSnap.exists()) {
                        const subscription = { id: subscriptionSnap.id, ...subscriptionSnap.data() };
                        if (subscription.companyId === recentlySelectedCompany) {
                            preselectedCustomerId = preselectedCustomerId || subscription.customerId || '';
                            if (!descriptionParts.length) {
                                descriptionParts.push("Billing subscription: linked subscription");
                            }
                            if (subscription.serviceCadence) {
                                setFrequency(cadenceToFrequencyOption(subscription.serviceCadence));
                            }
                            const subscriptionStartDate = firestoreValueToDate(subscription.currentPeriodStart);
                            if (subscriptionStartDate) setStartDate(subscriptionStartDate);
                        }
                    }
                }

                if (descriptionParts.length) {
                    setDescription((current) => current || descriptionParts.join("\n"));
                }

                // If customerId is provided in URL or sales context, pre-select customer and load their service locations
                if (preselectedCustomerId) {
                    const selectedCustomer = customers.find(c => c.id === preselectedCustomerId);
                    if (selectedCustomer) {
                        setCustomer(selectedCustomer);
                        const locQuery = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where('customerId', '==', preselectedCustomerId));
                        const locSnapshot = await getDocs(locQuery);
                        const locations = locSnapshot.docs.map(doc => ServiceLocation.fromFirestore(doc));
                        const locationOptions = locations.map(loc => ({ ...loc, value: loc.id, label: loc.address.streetAddress }));
                        setServiceLocationList(locationOptions);
                        setServiceLocation(
                            locationOptions.find((loc) => loc.id === requestedServiceLocationId) ||
                            locationOptions[0] ||
                            null
                        );
                    }
                }
            } catch (error) {
                console.error("Error fetching initial data: ", error);
                toast.error("Failed to load necessary data.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [recentlySelectedCompany, customerId, agreementId, billingSubscriptionId, requestedServiceLocationId]);

    useEffect(() => {
        if (selectedServiceStopType || !serviceStopTypeOptions.length) return;

        const suggestedType = suggestCompanyServiceStopType(
            serviceStopTypeOptions,
            SERVICE_STOP_TYPE_USE_CASES.recurringRoute
        );

        if (suggestedType) {
            setSelectedServiceStopType(suggestedType);
        }
    }, [selectedServiceStopType, serviceStopTypeOptions]);

    const handleCustomerChange = async (selectedCustomer) => {
        setCustomer(selectedCustomer);
        setServiceLocation(null); // Reset location on customer change

        if (selectedCustomer) {
            const locQuery = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where('customerId', '==', selectedCustomer.id));
            const locSnapshot = await getDocs(locQuery);
            const locations = locSnapshot.docs.map(doc => ServiceLocation.fromFirestore(doc));
            const locationOptions = locations.map(loc => ({ ...loc, value: loc.id, label: loc.address.streetAddress }));
            setServiceLocationList(locationOptions);
            if (locationOptions.length > 0) {
                setServiceLocation(locationOptions[0])
            }
        }
    };

    const createNewStop = async (e) => {
        e.preventDefault();
        if (!customer || !serviceLocation || !tech || !dayOfWeek || !frequency) {
            toast.error("Please complete all required fields.");
            return;
        }
        let recurringServiceStopCount = 0;

        const ref = doc(db, "companies", recentlySelectedCompany, "settings", "recurringServiceStops");
        const snap = await getDoc(ref);

        if (snap.exists()) {
            const data = snap.data();
            recurringServiceStopCount = typeof data.increment === "number" ? data.increment : 0;
        }
        console.log("");
        console.log(
            `[ProductionDataService][getRecurringServiceStopCount] recurringServiceStopCount: ${recurringServiceStopCount}`
        );

        const updatedRecurringServiceStopCount = recurringServiceStopCount + 1;
        await updateDoc(ref, { increment: updatedRecurringServiceStopCount });

        console.log("");
        console.log(
            `[ProductionDataService][getRecurringServiceStopCount] RSS Count: ${String(updatedRecurringServiceStopCount)}`
        );
        const stopId = `com_rss_${uuidv4()}`;
        const internalId = "RSS" + String(recurringServiceStopCount)
        const resolvedTypeFields = resolveServiceStopTypeFields({
            companyServiceStopTypes,
            selectedType: selectedServiceStopType,
            fallbackName: "Recurring Service Stop",
            useCase: SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
            context: "CreateNewRecurringServiceStop.createNewStop",
        });
        const newRSSData = {
            id: stopId,
            internalId: internalId,
            type: resolvedTypeFields.type,
            typeId: resolvedTypeFields.typeId,
            typeImage: resolvedTypeFields.typeImage,
            category: resolvedTypeFields.category,
            serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
            customerName: `${customer.firstName} ${customer.lastName}`,
            customerId: customer.id,
            address: serviceLocation.address,
            tech: tech.userName || tech.label,
            techId: tech.userId || tech.value || tech.id,
            dateCreated: new Date(),
            startDate,
            endDate: noEndDate ? null : endDate,
            noEndDate,

            frequency: frequency.value ?? "Weekly",
            day: dayOfWeek.value,
            daysOfWeek: dayOfWeek.value,
            description,
            lastCreated: new Date(),
            serviceLocationId: serviceLocation.id,
            estimatedTime: 15,
            otherCompany: false,
            laborContractId: "",
            contractedCompanyId: "",
            mainCompanyId: "",
            salesAgreementId: agreementId,
            salesBillingSubscriptionId: billingSubscriptionId,
        };


        let toastId;

        try {
            toastId = toast.loading('Creating new recurring service stop...');
            debugServiceStopTypeWrite({
                context: "CreateNewRecurringServiceStop.createNewStop",
                payload: newRSSData,
            });
            const rssId = await createFirstRecurringServiceStop(recentlySelectedCompany, newRSSData);
            const setupUpdate = {
                operationsSetupStatus: "recurringServiceStopCreated",
                recurringServiceStopId: rssId,
                recurringServiceStopCreatedAt: serverTimestamp(),
                operationsSetupUpdatedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            const serviceScheduleUpdate = recurringFrequencyToAgreementService({
                frequency: newRSSData.frequency,
                daysOfWeek: newRSSData.daysOfWeek,
                day: newRSSData.day,
            });
            const setupWrites = [];

            if (agreementId || billingSubscriptionId) {
                setupWrites.push(updateDoc(doc(db, "companies", recentlySelectedCompany, "recurringServiceStop", rssId), {
                    salesAgreementId: agreementId,
                    salesBillingSubscriptionId: billingSubscriptionId,
                    updatedAt: serverTimestamp(),
                }));
            }

            if (agreementId) {
                setupWrites.push(updateDoc(doc(db, salesCollectionNames.agreements, agreementId), {
                    ...setupUpdate,
                    ...serviceScheduleUpdate,
                    billingFlowNextAction: "monitorBilling",
                    billingFlowUpdatedAt: serverTimestamp(),
                }));
            }

            if (billingSubscriptionId) {
                setupWrites.push(updateDoc(doc(db, salesCollectionNames.billingSubscriptions, billingSubscriptionId), {
                    ...setupUpdate,
                    ...serviceScheduleUpdate,
                    nextAction: "monitorBilling",
                }));
            }

            if (setupWrites.length) {
                await Promise.all(setupWrites);
            }

            await addRecurringServiceStopToPlannedRoute({
                db,
                companyId: recentlySelectedCompany,
                recurringServiceStop: {
                    ...newRSSData,
                    id: rssId,
                },
            });

            console.log(rssId)
            toast.success('Successfully created recurring stop!', { id: toastId });
            const destination = returnTo && returnTo.startsWith("/company/")
                ? returnTo
                : `/company/recurringServiceStop/details/${rssId}`;
            navigate(destination);

        } catch (error) {
            console.error("Error creating new stop: ", error);
            toast.error('Failed to create stop. Please try again.', { id: toastId || internalId });
        }
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto bg-white p-8 rounded-2xl shadow-lg">
                <div>
                    <h1 className='text-3xl font-bold text-gray-800 mb-6'>Add New Recurring Service Stop</h1>
                    <p className="text-gray-600 mt-1">Assign the customer, route schedule, technician, and service stop type.</p>
                </div>

                <form onSubmit={createNewStop} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <SelectField label="Customer" value={customer} options={customerList} onChange={handleCustomerChange} placeholder="Select a Customer" isDisabled={!!customerId && customerId !== 'NA'} isLoading={isLoading} />
                        <SelectField label="Service Location" value={serviceLocation} options={serviceLocationList} onChange={setServiceLocation} placeholder="Select a Service Location" isDisabled={!customer} />
                        <SelectField label="Assigned Technician" value={tech} options={techList} onChange={setTech} placeholder="Assign a Technician" />
                        <SelectField label="Service Stop Type" value={selectedServiceStopType} options={serviceStopTypeOptions} onChange={setSelectedServiceStopType} placeholder="Select a Service Stop Type" />
                        <SelectField label="Day of Week" value={dayOfWeek} options={dayOptions} onChange={setDayOfWeek} placeholder="Select a Day" />
                        <SelectField label="Frequency" value={frequency} options={frequencyOptions} onChange={setFrequency} placeholder="Select Frequency" />

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                            <DatePicker selected={startDate} onChange={setStartDate} className="w-full p-2 border border-gray-300 rounded-md shadow-sm" />
                        </div>
                    </div>

                    <div className="flex items-center space-x-4">
                        <input type="checkbox" id="no-end-date" checked={noEndDate} onChange={(e) => setNoEndDate(e.target.checked)} className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                        <label htmlFor="no-end-date" className="text-sm font-medium text-gray-700">No End Date</label>
                    </div>

                    {!noEndDate && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                            <DatePicker selected={endDate} onChange={setEndDate} minDate={startDate} className="w-full p-2 border border-gray-300 rounded-md shadow-sm" />
                        </div>
                    )}

                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
                        <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm"></textarea>
                    </div>

                    <div className="flex justify-end pt-4 space-x-4">
                        <button type="button" onClick={() => navigate('/company/recurringServiceStop')} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Cancel</button>
                        <button type="submit" className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition'>Add Stop</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// A reusable Select component for cleaner code
const SelectField = ({ label, ...props }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
        <Select classNamePrefix="react-select" {...props} />
    </div>
);

export default CreateNewRecurringServiceStop;
