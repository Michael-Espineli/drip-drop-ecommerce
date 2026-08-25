
import React, { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { collection, query, getDocs, where, doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../utils/config';
import { Context } from "../../../context/AuthContext";
import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import { salesCollectionNames } from '../../../utils/models/Sales';
import { recurringFrequencyToAgreementService } from '../../../utils/sales/agreementCadence';
import { reportAppError } from '../../../utils/errorReporting';
import Select from 'react-select';
import DatePicker from "react-datepicker";
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { FaMapMarkerAlt } from 'react-icons/fa';
import 'react-datepicker/dist/react-datepicker.css';
import {
    debugServiceStopTypeWrite,
    resolveServiceStopTypeFields,
    SERVICE_STOP_TYPE_USE_CASES,
    serviceStopTypeMatchesUseCase,
    suggestCompanyServiceStopType,
} from '../../../utils/serviceStopTypes/serviceStopTypeResolver';
import { addRecurringServiceStopToPlannedRoute } from '../../../utils/recurringRouteSync';
import MapComponent from '../../components/MapComponent';
import { getCompanyUserDisplayName, sortCompanyUsersByName } from '../../../utils/companyUsers';

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

const formatServiceLocationAddress = (address = {}) => [
    address.streetAddress,
    [address.city, address.state, address.zip || address.zipCode].filter(Boolean).join(' '),
].filter(Boolean).join(', ');

const getMapCoordinate = (value) => {
    if (value === undefined || value === null || value === '') return null;

    const coordinate = Number(value);
    return Number.isFinite(coordinate) ? coordinate : null;
};

const hasGoogleMaps = () => typeof window !== 'undefined' && Boolean(window.google?.maps);

const routeOrderValue = (item) => Number(item?.order || 0);

const sortedRouteOrder = (order = []) => (
    Array.isArray(order)
        ? [...order].sort((left, right) => routeOrderValue(left) - routeOrderValue(right))
        : []
);

const getTechnicianId = (technician) => (
    technician?.userId || technician?.value || technician?.id || ""
);

const escapeMapHtml = (value = "") => (
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
);

const chunkRoutePoints = (points = [], maxPoints = 25) => {
    if (points.length <= maxPoints) return [points];

    const chunks = [];
    for (let startIndex = 0; startIndex < points.length - 1; startIndex += maxPoints - 1) {
        chunks.push(points.slice(startIndex, startIndex + maxPoints));
    }
    return chunks.filter((chunk) => chunk.length > 1);
};

const routePreviewStopCoordinate = (stop) => {
    const lat = getMapCoordinate(stop?.address?.latitude ?? stop?.latitude);
    const lng = getMapCoordinate(stop?.address?.longitude ?? stop?.longitude);

    if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;

    return { lat, lng };
};

const PlannedRoutePreviewMap = ({ stops = [], height = "260px" }) => {
    const mapRef = React.useRef(null);
    const [mapsReady, setMapsReady] = useState(hasGoogleMaps);

    const routePoints = useMemo(() => (
        stops
            .map((stop, index) => ({
                stop,
                index,
                position: routePreviewStopCoordinate(stop),
            }))
            .filter((point) => point.position)
    ), [stops]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (mapsReady) return undefined;

        const timer = window.setInterval(() => {
            if (hasGoogleMaps()) {
                setMapsReady(true);
                window.clearInterval(timer);
            }
        }, 250);

        return () => window.clearInterval(timer);
    }, [mapsReady]);

    useEffect(() => {
        if (!mapsReady || !mapRef.current || !hasGoogleMaps() || routePoints.length === 0) return undefined;

        const googleMaps = window.google.maps;
        const map = new googleMaps.Map(mapRef.current, {
            zoom: 11,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
        });
        const bounds = new googleMaps.LatLngBounds();
        const infoWindow = new googleMaps.InfoWindow();
        const overlays = [];
        const directionsService = googleMaps.DirectionsService ? new googleMaps.DirectionsService() : null;
        let disposed = false;

        const drawFallbackPath = (positions) => {
            const path = new googleMaps.Polyline({
                path: positions,
                geodesic: true,
                strokeColor: '#2563eb',
                strokeOpacity: 0.72,
                strokeWeight: 4,
                map,
            });
            overlays.push(path);
        };

        routePoints.forEach(({ stop, index, position }) => {
            bounds.extend(position);

            const marker = new googleMaps.Marker({
                position,
                map,
                title: stop.customerName || `Stop ${index + 1}`,
                label: {
                    text: String(index + 1),
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: '700',
                },
                icon: {
                    path: googleMaps.SymbolPath.CIRCLE,
                    fillColor: '#2563eb',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 3,
                    scale: 13,
                },
            });

            marker.addListener('click', () => {
                infoWindow.setContent(`
                    <div style="font-family: Arial, sans-serif; padding: 6px;">
                        <p style="font-weight: 700; margin: 0 0 4px 0;">Stop ${index + 1}: ${escapeMapHtml(stop.customerName || 'Recurring Service Stop')}</p>
                        <p style="margin: 0;">${escapeMapHtml(formatServiceLocationAddress(stop.address) || 'No address')}</p>
                    </div>
                `);
                infoWindow.open(map, marker);
            });

            overlays.push(marker);
        });

        const positions = routePoints.map((point) => point.position);
        if (positions.length > 1) {
            if (directionsService && googleMaps.DirectionsRenderer && googleMaps.TravelMode?.DRIVING) {
                chunkRoutePoints(positions).forEach((chunk) => {
                    directionsService.route({
                        origin: chunk[0],
                        destination: chunk[chunk.length - 1],
                        waypoints: chunk.slice(1, -1).map((position) => ({
                            location: position,
                            stopover: true,
                        })),
                        optimizeWaypoints: false,
                        travelMode: googleMaps.TravelMode.DRIVING,
                    }, (result, status) => {
                        if (disposed) return;

                        if (status === 'OK' && result) {
                            const renderer = new googleMaps.DirectionsRenderer({
                                directions: result,
                                map,
                                preserveViewport: true,
                                suppressMarkers: true,
                                polylineOptions: {
                                    strokeColor: '#2563eb',
                                    strokeOpacity: 0.84,
                                    strokeWeight: 5,
                                },
                            });
                            overlays.push(renderer);
                        } else {
                            drawFallbackPath(chunk);
                        }
                    });
                });
            } else {
                drawFallbackPath(positions);
            }
        }

        if (!bounds.isEmpty()) {
            map.fitBounds(bounds);
            if (positions.length === 1) {
                map.setZoom(15);
            }
        }

        return () => {
            disposed = true;
            overlays.forEach((overlay) => overlay.setMap(null));
            infoWindow.close();
        };
    }, [mapsReady, routePoints]);

    return <div ref={mapRef} style={{ width: '100%', height }} />;
};

const CreateNewRecurringServiceStop = () => {
    const {
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        user,
        dataBaseUser,
        accountType,
    } = useContext(Context);
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
    const [routePreview, setRoutePreview] = useState({ route: null, stops: [] });
    const [isRoutePreviewLoading, setIsRoutePreviewLoading] = useState(false);
    const [routePreviewError, setRoutePreviewError] = useState("");

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
                    label: type.name || "Unnamed Pay Type",
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [companyServiceStopTypes]
    );
    const selectedLocationAddress = serviceLocation?.address || {};
    const selectedLocationAddressLine = formatServiceLocationAddress(selectedLocationAddress);
    const selectedLocationLatitude = getMapCoordinate(selectedLocationAddress.latitude);
    const selectedLocationLongitude = getMapCoordinate(selectedLocationAddress.longitude);
    const hasSelectedLocationMap = selectedLocationLatitude !== null
        && selectedLocationLongitude !== null
        && (selectedLocationLatitude !== 0 || selectedLocationLongitude !== 0);
    const selectedTechnicianId = getTechnicianId(tech);
    const selectedTechnicianLabel = tech?.label || tech?.userName || tech?.firstName || "Technician";
    const routePreviewStops = routePreview.stops || [];
    const routePreviewMappedStopCount = routePreviewStops.filter(routePreviewStopCoordinate).length;
    const routePreviewTitle = routePreview.route
        ? routePreview.route.description || routePreview.route.name || `${selectedTechnicianLabel} ${dayOfWeek?.label || dayOfWeek?.value || ""} Route`
        : `${selectedTechnicianLabel} ${dayOfWeek?.label || dayOfWeek?.value || ""} Route`;
    const errorContext = useMemo(() => ({
        userId: user?.uid || dataBaseUser?.id || dataBaseUser?.uid || '',
        userEmail: user?.email || dataBaseUser?.email || '',
        accountType: accountType || dataBaseUser?.accountType || '',
        companyId: recentlySelectedCompany || '',
        companyName: recentlySelectedCompanyName || '',
    }), [accountType, dataBaseUser, recentlySelectedCompany, recentlySelectedCompanyName, user]);

    const reportRecurringPageError = useCallback((error, options = {}) => (
        reportAppError(error, {
            context: errorContext,
            source: 'recurring-service-stop-page',
            where: options.where || 'CreateNewRecurringServiceStop',
            title: options.title,
            description: options.description,
            severity: options.severity || 'error',
            data: {
                customerRouteParam: customerId || '',
                selectedCustomerId: customer?.id || customer?.value || '',
                selectedServiceLocationId: serviceLocation?.id || serviceLocation?.value || requestedServiceLocationId || '',
                selectedTechnicianId: tech?.userId || tech?.value || tech?.id || '',
                agreementId,
                billingSubscriptionId,
                returnTo,
                ...options.data,
            },
        })
    ), [
        agreementId,
        billingSubscriptionId,
        customer,
        customerId,
        errorContext,
        requestedServiceLocationId,
        returnTo,
        serviceLocation,
        tech,
    ]);

    // =============================
    // iOS helper -> React helper
    // =============================
    const ms = (d) => (d ? Math.floor(new Date(d).getTime()) : null);

    const createFirstRecurringServiceStop = async (companyId, recurringServiceStop) => {
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

        if (result.data.status && Number(result.data.status) >= 400) {
            throw new Error(result.data.error || "createFirstRecurringServiceStop2 failed");
        }

        if (result.data.success === false) {
            throw new Error(result.data.error || "createFirstRecurringServiceStop2 returned success false");
        }

        // Swift returns recurringServiceStop.id
        return result.data.rssId || recurringServiceStop.id;
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
                const techs = sortCompanyUsersByName(techSnapshot.docs.map(doc => {
                    const data = doc.data();
                    const label = getCompanyUserDisplayName(data, "Technician");
                    return {
                        ...data,
                        id: data.userId || data.id || doc.id,
                        value: data.userId || data.id || doc.id,
                        label,
                    };
                }));
                setTechList(techs);

                const payTypesSnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'companyPayTypes'));
                setCompanyServiceStopTypes(payTypesSnapshot.docs.map(doc => {
                    const data = { id: doc.id, ...doc.data() };
                    return {
                        ...data,
                        imageName: data.imageName || data.iconName || "",
                        iconName: data.iconName || data.imageName || "",
                        stopPayBucketId: data.stopPayBucketId || data.bucketId || "",
                        stopPayBucketLabel: data.stopPayBucketLabel || data.bucketLabel || "",
                        defaultWorkTypeIds: [doc.id],
                    };
                }));

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
                await reportAppError(error, {
                    context: errorContext,
                    source: "recurring-service-stop-page",
                    where: "CreateNewRecurringServiceStop.fetchData",
                    title: "Recurring service stop create page failed to load",
                    description: "The Add New Recurring Service Stop page could not load its customers, technicians, service types, or linked sales context.",
                    data: {
                        customerRouteParam: customerId || "",
                        companyId: recentlySelectedCompany || "",
                        routeCustomerId: customerId || "",
                        agreementId,
                        billingSubscriptionId,
                        requestedServiceLocationId,
                    },
                });
                toast.error("Failed to load necessary data.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [recentlySelectedCompany, customerId, agreementId, billingSubscriptionId, requestedServiceLocationId, errorContext]);

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

    useEffect(() => {
        if (!recentlySelectedCompany || !selectedTechnicianId || !dayOfWeek?.value) {
            setRoutePreview({ route: null, stops: [] });
            setRoutePreviewError("");
            setIsRoutePreviewLoading(false);
            return undefined;
        }

        let isMounted = true;

        const loadRoutePreview = async () => {
            setIsRoutePreviewLoading(true);
            setRoutePreviewError("");

            try {
                const routesQuery = query(
                    collection(db, "companies", recentlySelectedCompany, "recurringRoutes"),
                    where("day", "==", dayOfWeek.value),
                    where("techId", "==", selectedTechnicianId)
                );
                const routesSnapshot = await getDocs(routesQuery);
                const matchingRoutes = routesSnapshot.docs
                    .map((routeDoc) => ({ id: routeDoc.id, ...routeDoc.data() }))
                    .sort((left, right) => sortedRouteOrder(right.order).length - sortedRouteOrder(left.order).length);
                const route = matchingRoutes[0] || null;

                if (!route) {
                    if (isMounted) setRoutePreview({ route: null, stops: [] });
                    return;
                }

                const orderedStops = sortedRouteOrder(route.order);
                const stops = await Promise.all(orderedStops.map(async (orderedStop, index) => {
                    let recurringStop = {};

                    if (orderedStop.recurringServiceStopId) {
                        try {
                            const recurringStopSnapshot = await getDoc(doc(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "recurringServiceStop",
                                orderedStop.recurringServiceStopId
                            ));
                            recurringStop = recurringStopSnapshot.exists()
                                ? { id: recurringStopSnapshot.id, ...recurringStopSnapshot.data() }
                                : {};
                        } catch (error) {
                            console.warn("Unable to load recurring stop for route preview.", {
                                recurringServiceStopId: orderedStop.recurringServiceStopId,
                                error,
                            });
                        }
                    }

                    const serviceLocationId = orderedStop.locationId || recurringStop.serviceLocationId || "";
                    let routeServiceLocation = {};

                    if (serviceLocationId) {
                        try {
                            const serviceLocationSnapshot = await getDoc(doc(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "serviceLocations",
                                serviceLocationId
                            ));
                            routeServiceLocation = serviceLocationSnapshot.exists()
                                ? { id: serviceLocationSnapshot.id, ...serviceLocationSnapshot.data() }
                                : {};
                        } catch (error) {
                            console.warn("Unable to load service location for route preview.", {
                                serviceLocationId,
                                error,
                            });
                        }
                    }

                    return {
                        id: orderedStop.id || orderedStop.recurringServiceStopId || serviceLocationId || `route-preview-stop-${index}`,
                        order: index + 1,
                        recurringServiceStopId: orderedStop.recurringServiceStopId || recurringStop.id || "",
                        serviceLocationId,
                        customerId: orderedStop.customerId || recurringStop.customerId || routeServiceLocation.customerId || "",
                        customerName: orderedStop.customerName || recurringStop.customerName || routeServiceLocation.customerName || "Recurring Service Stop",
                        address: routeServiceLocation.address || recurringStop.address || {},
                    };
                }));

                if (isMounted) {
                    setRoutePreview({
                        route,
                        stops,
                    });
                }
            } catch (error) {
                console.error("Error loading route preview:", error);
                if (isMounted) {
                    setRoutePreview({ route: null, stops: [] });
                    setRoutePreviewError("Route preview could not be loaded.");
                }
            } finally {
                if (isMounted) setIsRoutePreviewLoading(false);
            }
        };

        loadRoutePreview();

        return () => {
            isMounted = false;
        };
    }, [dayOfWeek?.value, recentlySelectedCompany, selectedTechnicianId]);

    const handleCustomerChange = async (selectedCustomer) => {
        setCustomer(selectedCustomer);
        setServiceLocation(null); // Reset location on customer change
        setServiceLocationList([]);

        if (selectedCustomer) {
            try {
                const locQuery = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where('customerId', '==', selectedCustomer.id));
                const locSnapshot = await getDocs(locQuery);
                const locations = locSnapshot.docs.map(doc => ServiceLocation.fromFirestore(doc));
                const locationOptions = locations.map(loc => ({ ...loc, value: loc.id, label: loc.address.streetAddress }));
                setServiceLocationList(locationOptions);
                if (locationOptions.length > 0) {
                    setServiceLocation(locationOptions[0])
                }
            } catch (error) {
                console.error("Error loading customer service locations:", error);
                await reportRecurringPageError(error, {
                    where: "CreateNewRecurringServiceStop.handleCustomerChange",
                    title: "Recurring service stop customer location load failed",
                    description: "The recurring service stop create page failed while loading service locations for the selected customer.",
                    data: {
                        selectedCustomerId: selectedCustomer.id || selectedCustomer.value || "",
                    },
                });
                toast.error("Failed to load service locations.");
            }
        }
    };

    const createNewStop = async (e) => {
        e.preventDefault();
        if (!customer || !serviceLocation || !tech || !dayOfWeek || !frequency) {
            toast.error("Please complete all required fields.");
            return;
        }
        let toastId;
        let stopId = "";
        let internalId = "";
        let newRSSData = null;

        try {
            toastId = toast.loading('Creating new recurring service stop...');
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
            stopId = `com_rss_${uuidv4()}`;
            internalId = "RSS" + String(recurringServiceStopCount)
            const resolvedTypeFields = resolveServiceStopTypeFields({
                companyServiceStopTypes,
                selectedType: selectedServiceStopType,
                fallbackName: "Recurring Service Stop",
                useCase: SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
                context: "CreateNewRecurringServiceStop.createNewStop",
            });
            const payTypeId = selectedServiceStopType?.id || resolvedTypeFields.typeId || "";
            const payTypeName = selectedServiceStopType?.name || selectedServiceStopType?.label || resolvedTypeFields.type || "";
            newRSSData = {
                id: stopId,
                internalId: internalId,
                type: resolvedTypeFields.type,
                typeId: resolvedTypeFields.typeId,
                typeImage: resolvedTypeFields.typeImage,
                payTypeId,
                payTypeName,
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

            debugServiceStopTypeWrite({
                context: "CreateNewRecurringServiceStop.createNewStop",
                payload: newRSSData,
            });
            const rssId = await createFirstRecurringServiceStop(recentlySelectedCompany, newRSSData);
            const routeSyncResult = await addRecurringServiceStopToPlannedRoute({
                db,
                companyId: recentlySelectedCompany,
                recurringServiceStop: {
                    ...newRSSData,
                    id: rssId,
                },
            });
            const recurringRouteId = routeSyncResult?.routeId || "";
            const setupUpdate = {
                operationsSetupStatus: recurringRouteId
                    ? "recurringServiceStopAndRouteCreated"
                    : "recurringServiceStopCreated",
                recurringServiceStopId: rssId,
                ...(recurringRouteId
                    ? {
                        recurringRouteId,
                        recurringRouteLinkedAt: serverTimestamp(),
                    }
                    : {}),
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

            if (agreementId || billingSubscriptionId || recurringRouteId) {
                setupWrites.push(updateDoc(doc(db, "companies", recentlySelectedCompany, "recurringServiceStop", rssId), {
                    salesAgreementId: agreementId,
                    salesBillingSubscriptionId: billingSubscriptionId,
                    ...(recurringRouteId ? { recurringRouteId } : {}),
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

            console.log(rssId)
            toast.success('Successfully created recurring stop!', { id: toastId });
            const destination = returnTo && returnTo.startsWith("/company/")
                ? returnTo
                : `/company/recurringServiceStop/details/${rssId}`;
            navigate(destination);

        } catch (error) {
            console.error("Error creating new stop: ", error);
            await reportRecurringPageError(error, {
                where: "CreateNewRecurringServiceStop.createNewStop",
                title: "Recurring service stop creation failed",
                description: "The recurring service stop create workflow failed before it could finish the recurring template, first service stops, sales links, or planned route sync.",
                severity: "critical",
                data: {
                    recurringServiceStopId: stopId,
                    internalId,
                    newRSSData,
                },
            });
            toast.error('Failed to create stop. Please try again.', { id: toastId || internalId });
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-5">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <h1 className="text-3xl font-bold text-slate-950">Add New Recurring Service Stop</h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                Assign the customer, route schedule, technician, and pay type.
                            </p>
                        </div>
                        <button
                            type="submit"
                            form="create-recurring-service-stop-form"
                            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:mt-1"
                        >
                            Add Stop
                        </button>
                    </div>
                </section>

                <form id="create-recurring-service-stop-form" onSubmit={createNewStop} className="space-y-5">
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <SelectField label="Customer" value={customer} options={customerList} onChange={handleCustomerChange} placeholder="Select a Customer" isDisabled={!!customerId && customerId !== 'NA'} isLoading={isLoading} />
                            <SelectField label="Service Location" value={serviceLocation} options={serviceLocationList} onChange={setServiceLocation} placeholder="Select a Service Location" isDisabled={!customer} />
                            <SelectField label="Assigned Technician" value={tech} options={techList} onChange={setTech} placeholder="Assign a Technician" />
                            <SelectField label="Pay Type" value={selectedServiceStopType} options={serviceStopTypeOptions} onChange={setSelectedServiceStopType} placeholder="Select a Pay Type" />
                            <SelectField label="Day of Week" value={dayOfWeek} options={dayOptions} onChange={setDayOfWeek} placeholder="Select a Day" />
                            <SelectField label="Frequency" value={frequency} options={frequencyOptions} onChange={setFrequency} placeholder="Select Frequency" />

                            <div>
                                <label className="mb-2 block text-sm font-semibold text-slate-700">Start Date</label>
                                <DatePicker
                                    selected={startDate}
                                    onChange={setStartDate}
                                    wrapperClassName="w-full"
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            </div>

                            {!noEndDate && (
                                <div>
                                    <label className="mb-2 block text-sm font-semibold text-slate-700">End Date</label>
                                    <DatePicker
                                        selected={endDate}
                                        onChange={setEndDate}
                                        minDate={startDate}
                                        wrapperClassName="w-full"
                                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </div>
                            )}
                        </div>

                        <label className="mt-4 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                            <input
                                type="checkbox"
                                id="no-end-date"
                                checked={noEndDate}
                                onChange={(e) => setNoEndDate(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            No End Date
                        </label>

                        <div className="mt-4">
                            <label htmlFor="description" className="block text-sm font-semibold text-slate-700">Description</label>
                            <textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                    </section>

                    {serviceLocation && (
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                                <div className="min-w-0">
                                    <div className="flex items-start gap-3">
                                        <span className="rounded-md bg-blue-50 p-2 text-blue-700">
                                            <FaMapMarkerAlt className="text-sm" />
                                        </span>
                                        <div className="min-w-0">
                                            <h2 className="text-lg font-bold text-slate-950">Location Preview</h2>
                                            <p className="mt-1 text-sm font-semibold text-slate-900">
                                                {serviceLocation.nickName || serviceLocation.label || 'Selected Service Location'}
                                            </p>
                                            <p className="mt-1 text-sm text-slate-600">
                                                {selectedLocationAddressLine || 'No address saved for this location.'}
                                            </p>
                                        </div>
                                    </div>

                                    {hasSelectedLocationMap ? (
                                        <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
                                            <MapComponent
                                                latitude={selectedLocationLatitude}
                                                longitude={selectedLocationLongitude}
                                                zoom={15}
                                                height="260px"
                                            />
                                        </div>
                                    ) : (
                                        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            No map coordinates are saved for this service location yet.
                                        </div>
                                    )}
                                </div>

                                <div className="min-w-0">
                                    <div className="flex items-start gap-3">
                                        <span className="rounded-md bg-emerald-50 p-2 text-emerald-700">
                                            <FaMapMarkerAlt className="text-sm" />
                                        </span>
                                        <div className="min-w-0">
                                            <h2 className="text-lg font-bold text-slate-950">Technician Route Preview</h2>
                                            <p className="mt-1 text-sm font-semibold text-slate-900">
                                                {selectedTechnicianId ? routePreviewTitle : "Select a technician"}
                                            </p>
                                            <p className="mt-1 text-sm text-slate-600">
                                                {selectedTechnicianId
                                                    ? `${dayOfWeek?.label || dayOfWeek?.value || "Selected day"} - ${routePreviewStops.length} stop${routePreviewStops.length === 1 ? "" : "s"}`
                                                    : "Choose a technician to preview their route for this day."}
                                            </p>
                                        </div>
                                    </div>

                                    {!selectedTechnicianId ? (
                                        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            Select an assigned technician to load their current planned route.
                                        </div>
                                    ) : isRoutePreviewLoading ? (
                                        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                                            Loading route preview...
                                        </div>
                                    ) : routePreviewError ? (
                                        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                            {routePreviewError}
                                        </div>
                                    ) : !routePreview.route ? (
                                        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            No planned route exists for this technician on {dayOfWeek?.label || dayOfWeek?.value || "this day"} yet.
                                        </div>
                                    ) : routePreviewStops.length === 0 ? (
                                        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            This planned route does not have ordered stops yet.
                                        </div>
                                    ) : routePreviewMappedStopCount === 0 ? (
                                        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                            No map coordinates are saved for the stops on this route yet.
                                        </div>
                                    ) : (
                                        <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
                                            <PlannedRoutePreviewMap stops={routePreviewStops} height="260px" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>
                    )}

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={() => navigate('/company/recurringServiceStop')}
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                        >
                            Add Stop
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// A reusable Select component for cleaner code
const SelectField = ({ label, ...props }) => (
    <div className="min-w-0">
        <label className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
        <Select classNamePrefix="react-select" {...props} />
    </div>
);

export default CreateNewRecurringServiceStop;
