import React, { useState, useEffect, useContext, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { collection, getDocs, query, where, writeBatch, doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { MultiLocationMap } from '../../components/MultiLocationMap';
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';
import { TrashIcon } from '@heroicons/react/24/outline';
import {
  debugServiceStopTypeWrite,
  resolveServiceStopTypeFields,
  SERVICE_STOP_TYPE_USE_CASES,
  serviceStopTypeMatchesUseCase,
  suggestCompanyServiceStopType,
} from '../../../utils/serviceStopTypes/serviceStopTypeResolver';

const functions = getFunctions();
// Reusable form components
const Input = ({ className = "", ...props }) => (
  <input
    {...props}
    className={`block w-full rounded-md border border-slate-300 bg-white p-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${className}`}
  />
);
const Button = ({ children, className = "", ...props }) => (
  <button
    {...props}
    className={`rounded-md px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
  >
    {children}
  </button>
);
const SelectInput = (props) => (
  <Select
    {...props}
    styles={{
      control: (base, state) => ({
        ...base,
        minHeight: "42px",
        borderColor: state.isFocused ? "#3b82f6" : "#cbd5e1",
        borderRadius: "0.375rem",
        boxShadow: state.isFocused ? "0 0 0 2px rgba(219, 234, 254, 1)" : "none",
        "&:hover": {
          borderColor: state.isFocused ? "#3b82f6" : "#94a3b8",
        },
      }),
      menu: (base) => ({ ...base, zIndex: 30 }),
    }}
  />
);
const Field = ({ label, children, className = "" }) => (
  <div className={`block ${className}`}>
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </div>
);

const RouteBuilder = () => {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);

  // Core state
  const [editingTemplate, setEditingTemplate] = useState(state?.templateToEdit || null);
  const [description, setDescription] = useState(editingTemplate?.description || '');
  const [selectedDay, setSelectedDay] = useState(
    editingTemplate
      ? { value: editingTemplate.day, label: editingTemplate.day }
      : state?.defaultDay
        ? { value: state.defaultDay, label: state.defaultDay }
        : null
  );
  const [selectedTechnician, setSelectedTechnician] = useState(null);
  const [routeStops, setRouteStops] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [routeSaveProgress, setRouteSaveProgress] = useState(null);
  const [isDeletingRoute, setIsDeletingRoute] = useState(false);

  // Data state
  const [technicians, setTechnicians] = useState([]);
  const [allStops, setAllStops] = useState([]);
  const [allRecurringStops, setAllRecurringStops] = useState([]);
  const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
  const [selectedServiceStopType, setSelectedServiceStopType] = useState(null);
  const [availableStopTypeSelections, setAvailableStopTypeSelections] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => ({
    value: day,
    label: day
  }));

  const dayNameToIndex = (dayName) => daysOfWeek.findIndex((day) => day.value === dayName);

  const nextDateForDay = (dayName, fromDate = new Date()) => {
    const targetDow = dayNameToIndex(dayName);
    const start = new Date(fromDate);
    start.setHours(12, 0, 0, 0);

    if (targetDow < 0) return start;

    const diff = (targetDow - start.getDay() + 7) % 7;
    start.setDate(start.getDate() + diff);
    return start;
  };

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

  const serviceStopTypeById = useMemo(
    () => new Map(serviceStopTypeOptions.map((type) => [type.id, type])),
    [serviceStopTypeOptions]
  );

  const serviceStopTypeForStop = (stop) =>
    serviceStopTypeById.get(stop?.typeId) || selectedServiceStopType || null;

  const routeStopKey = (stop) =>
    String(stop?.routeStopKey || stop?.recurringServiceStopId || stop?.id || "");

  const technicianNameById = useMemo(() => {
    const nextNames = new Map();
    technicians.forEach((tech) => {
      nextNames.set(String(tech.value || tech.userId || tech.id || ""), tech.label || tech.userName || tech.name || "");
    });
    return nextNames;
  }, [technicians]);

  const getRouteStopScheduleLabel = (stop = {}) => {
    const day = stop.day || "No day";
    const tech = stop.tech || technicianNameById.get(String(stop.techId || "")) || "Unassigned";
    return `${day} - ${tech}`;
  };

  const resolveStopTypeFields = (stop = {}, selectedType = null) =>
    resolveServiceStopTypeFields({
      companyServiceStopTypes,
      selectedType,
      selectedTypeId: selectedType?.id || stop.typeId || "",
      fallbackName: stop.type || "Recurring Service Stop",
      fallbackImage: stop.typeImage || "",
      useCase: SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
      context: "RouteBuilder.resolveStopTypeFields",
    });

  const stopWithServiceStopType = (stop, selectedType = null) => {
    const resolvedTypeFields = resolveStopTypeFields(stop, selectedType);

    return {
      ...stop,
      type: resolvedTypeFields.type,
      typeId: resolvedTypeFields.typeId,
      typeImage: resolvedTypeFields.typeImage,
      category: resolvedTypeFields.category,
      serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
    };
  };

  const buildRouteStopsFromRouteOrder = async (route, stopList) => {
    const orderedStops = Array.isArray(route?.order)
      ? [...route.order].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      : [];

    const recurringStopEntries = await Promise.all(
      orderedStops
        .filter((orderedStop) => orderedStop.recurringServiceStopId)
        .map(async (orderedStop) => {
          try {
            const snap = await getDoc(doc(
              db,
              "companies",
              recentlySelectedCompany,
              "recurringServiceStop",
              orderedStop.recurringServiceStopId
            ));
            return [orderedStop.recurringServiceStopId, snap.exists() ? snap.data() : null];
          } catch (error) {
            console.warn("Unable to load recurring service stop for route stop.", {
              recurringServiceStopId: orderedStop.recurringServiceStopId,
              error,
            });
            return [orderedStop.recurringServiceStopId, null];
          }
        })
    );
    const recurringStopsById = new Map(recurringStopEntries);

    return orderedStops
      .map((orderedStop) => {
        const recurringStop = recurringStopsById.get(orderedStop.recurringServiceStopId) || {};
        const serviceLocation = stopList.find((location) =>
          location.id === orderedStop.locationId ||
          location.id === recurringStop.serviceLocationId
        );

        if (!serviceLocation && !recurringStop.serviceLocationId) return null;

        return {
          ...(serviceLocation || {}),
          id: serviceLocation?.id || recurringStop.serviceLocationId || orderedStop.locationId || orderedStop.recurringServiceStopId,
          routeStopKey: orderedStop.recurringServiceStopId || orderedStop.id || serviceLocation?.id || recurringStop.serviceLocationId || orderedStop.locationId,
          routeOrderId: orderedStop.id,
          recurringServiceStopId: orderedStop.recurringServiceStopId,
          internalId: recurringStop.internalId || orderedStop.internalId || "",
          customerId: orderedStop.customerId || recurringStop.customerId || serviceLocation?.customerId || "",
          customerName: orderedStop.customerName || recurringStop.customerName || serviceLocation?.customerName || "",
          address: serviceLocation?.address || recurringStop.address || {},
          type: orderedStop.type || recurringStop.type || serviceLocation?.type || "",
          typeId: orderedStop.typeId || recurringStop.typeId || serviceLocation?.typeId || "",
          typeImage: orderedStop.typeImage || recurringStop.typeImage || serviceLocation?.typeImage || "",
          serviceStopTypeUseCaseRawValue:
            orderedStop.serviceStopTypeUseCaseRawValue ||
            recurringStop.serviceStopTypeUseCaseRawValue ||
            SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
          day: recurringStop.day || orderedStop.day || route.day || "",
          tech: recurringStop.tech || orderedStop.tech || route.tech || "",
          techId: recurringStop.techId || orderedStop.techId || route.techId || "",
          frequency: recurringStop.frequency || "Weekly",
          dateCreated: recurringStop.dateCreated || null,
          startDate: recurringStop.startDate || null,
          endDate: recurringStop.endDate || null,
          noEndDate: recurringStop.noEndDate ?? true,
          description: recurringStop.description || route.description || "",
          lastCreated: recurringStop.lastCreated || null,
          estimatedTime: recurringStop.estimatedTime ?? serviceLocation?.estimatedTime ?? null,
          otherCompany: recurringStop.otherCompany ?? serviceLocation?.otherCompany ?? null,
          laborContractId: recurringStop.laborContractId ?? serviceLocation?.laborContractId ?? null,
          contractedCompanyId: recurringStop.contractedCompanyId ?? serviceLocation?.contractedCompanyId ?? null,
          mainCompanyId: recurringStop.mainCompanyId ?? serviceLocation?.mainCompanyId ?? null,
        };
      })
      .filter(Boolean);
  };

  const buildRouteStopFromRecurringStop = (recurringStop, stopList = allStops) => {
    if (!recurringStop?.id) return null;

    const serviceLocation = stopList.find((location) => location.id === recurringStop.serviceLocationId);

    return {
      ...(serviceLocation || {}),
      id: serviceLocation?.id || recurringStop.serviceLocationId || recurringStop.id,
      routeStopKey: recurringStop.id,
      recurringServiceStopId: recurringStop.id,
      internalId: recurringStop.internalId || "",
      customerId: recurringStop.customerId || serviceLocation?.customerId || "",
      customerName: recurringStop.customerName || serviceLocation?.customerName || "",
      address: serviceLocation?.address || recurringStop.address || {},
      type: recurringStop.type || serviceLocation?.type || "",
      typeId: recurringStop.typeId || serviceLocation?.typeId || "",
      typeImage: recurringStop.typeImage || serviceLocation?.typeImage || "",
      category: recurringStop.category || serviceLocation?.category || "",
      serviceStopTypeUseCaseRawValue: recurringStop.serviceStopTypeUseCaseRawValue || SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
      day: recurringStop.day || "",
      tech: recurringStop.tech || "",
      techId: recurringStop.techId || "",
      frequency: recurringStop.frequency || "Weekly",
      dateCreated: recurringStop.dateCreated || null,
      startDate: recurringStop.startDate || null,
      endDate: recurringStop.endDate || null,
      noEndDate: recurringStop.noEndDate ?? true,
      description: recurringStop.description || "",
      lastCreated: recurringStop.lastCreated || null,
      serviceLocationId: recurringStop.serviceLocationId || serviceLocation?.id || "",
      estimatedTime: recurringStop.estimatedTime ?? serviceLocation?.estimatedTime ?? null,
      otherCompany: recurringStop.otherCompany ?? serviceLocation?.otherCompany ?? null,
      laborContractId: recurringStop.laborContractId ?? serviceLocation?.laborContractId ?? null,
      contractedCompanyId: recurringStop.contractedCompanyId ?? serviceLocation?.contractedCompanyId ?? null,
      mainCompanyId: recurringStop.mainCompanyId ?? serviceLocation?.mainCompanyId ?? null,
    };
  };

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

        description: recurringServiceStop.description ?? "",
        lastCreated: ms(recurringServiceStop.lastCreated ?? new Date()),

        serviceLocationId: recurringServiceStop.serviceLocationId,
        estimatedTime: recurringServiceStop.estimatedTime ?? null,

        otherCompany: recurringServiceStop.otherCompany ?? false,
        laborContractId: recurringServiceStop.laborContractId ?? "",
        contractedCompanyId: recurringServiceStop.contractedCompanyId ?? "",
        mainCompanyId: recurringServiceStop.mainCompanyId ?? "",
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

  const getNextRecurringServiceStopInternalId = async () => {
    const ref = doc(db, "companies", recentlySelectedCompany, "settings", "recurringServiceStops");
    const snap = await getDoc(ref);
    const currentCount = snap.exists() && typeof snap.data().increment === "number" ? snap.data().increment : 0;
    const nextCount = currentCount + 1;
    if (snap.exists()) {
      await updateDoc(ref, { increment: nextCount });
    } else {
      await setDoc(ref, { category: "recurringServiceStops", increment: nextCount }, { merge: true });
    }
    return `RRS_${nextCount}`;
  };

  const createRecurringServiceStopForRouteStop = async (stop) => {
    const resolvedTypeFields = resolveStopTypeFields(stop, serviceStopTypeForStop(stop));
    const firstServiceDate = nextDateForDay(selectedDay.value);
    const recurringServiceStop = {
      id: `comp_rss_${uuidv4()}`,
      internalId: await getNextRecurringServiceStopInternalId(),
      type: resolvedTypeFields.type,
      typeId: resolvedTypeFields.typeId,
      typeImage: resolvedTypeFields.typeImage,
      category: resolvedTypeFields.category,
      serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
      customerName: stop.customerName,
      customerId: stop.customerId,
      address: stop.address,
      tech: selectedTechnician.label,
      techId: selectedTechnician.value,
      dateCreated: new Date(),
      startDate: firstServiceDate,
      endDate: null,
      noEndDate: true,
      frequency: stop.frequency ?? "Weekly",
      day: selectedDay.value,
      description,
      lastCreated: firstServiceDate,
      serviceLocationId: stop.serviceLocationId || stop.id,
      estimatedTime: stop.estimatedTime ?? null,
      otherCompany: stop.otherCompany ?? null,
      laborContractId: stop.laborContractId ?? null,
      contractedCompanyId: stop.contractedCompanyId ?? null,
      mainCompanyId: stop.mainCompanyId ?? null,
    };

    debugServiceStopTypeWrite({
      context: "RouteBuilder.createRecurringServiceStopForRouteStop",
      payload: recurringServiceStop,
    });
    return createFirstRecurringServiceStop(recentlySelectedCompany, recurringServiceStop);
  };

  const updateRecurringServiceStopForRouteStop = async (stop, resolvedTypeFields) => {
    if (!stop.recurringServiceStopId) return null;

    const callable = httpsCallable(functions, "updateRecurringServiceStop");
    const recurringServiceStop = {
      id: stop.recurringServiceStopId,
      internalId: stop.internalId || null,
      type: resolvedTypeFields.type,
      typeId: resolvedTypeFields.typeId,
      typeImage: resolvedTypeFields.typeImage,
      category: resolvedTypeFields.category,
      serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
      customerName: stop.customerName,
      customerId: stop.customerId,
      address: stop.address || {},
      tech: selectedTechnician.label,
      techId: selectedTechnician.value,
      dateCreated: stop.dateCreated || new Date(),
      startDate: stop.startDate || nextDateForDay(selectedDay.value),
      endDate: stop.endDate || null,
      noEndDate: stop.noEndDate ?? true,
      frequency: stop.frequency || "Weekly",
      day: selectedDay.value,
      description: description || stop.description || "",
      lastCreated: stop.lastCreated || stop.startDate || nextDateForDay(selectedDay.value),
      serviceLocationId: stop.serviceLocationId || stop.id,
      estimatedTime: stop.estimatedTime ?? null,
      otherCompany: stop.otherCompany ?? null,
      laborContractId: stop.laborContractId ?? null,
      contractedCompanyId: stop.contractedCompanyId ?? null,
      mainCompanyId: stop.mainCompanyId ?? null,
    };

    debugServiceStopTypeWrite({
      context: "RouteBuilder.updateRecurringServiceStopForRouteStop",
      payload: recurringServiceStop,
    });

    const result = await callable({
      companyId: recentlySelectedCompany,
      recurringServiceStop,
      syncRoute: false,
    });

    return result.data;
  };

  const buildRouteOrderItem = async (stop, index, options = {}) => {
    const resolvedTypeFields = resolveStopTypeFields(stop, serviceStopTypeForStop(stop));
    const recurringServiceStopId = stop.recurringServiceStopId || await createRecurringServiceStopForRouteStop(stop);

    if (stop.recurringServiceStopId && options.syncExistingRecurringStop) {
      await updateRecurringServiceStopForRouteStop(stop, resolvedTypeFields);
    }

    return {
      id: stop.routeOrderId || uuidv4(),
      order: index + 1,
      recurringServiceStopId,
      customerId: stop.customerId,
      customerName: stop.customerName,
      locationId: stop.serviceLocationId || stop.id,
      type: resolvedTypeFields.type,
      typeId: resolvedTypeFields.typeId,
      typeImage: resolvedTypeFields.typeImage,
      category: resolvedTypeFields.category,
      serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
    };
  };

  const removeRouteStopsFromOtherRoutes = async (recurringServiceStopIds, destinationRouteId) => {
    const idsToMove = new Set(recurringServiceStopIds.filter(Boolean));
    if (!idsToMove.size) return 0;

    const routesSnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes'));
    const batch = writeBatch(db);
    let changedRoutes = 0;

    routesSnapshot.docs.forEach((routeDoc) => {
      if (routeDoc.id === destinationRouteId) return;

      const routeData = routeDoc.data();
      const currentOrder = Array.isArray(routeData.order) ? routeData.order : [];
      const nextOrder = currentOrder
        .filter((item) => !idsToMove.has(item.recurringServiceStopId))
        .map((item, index) => ({
          ...item,
          order: index + 1,
        }));

      if (nextOrder.length === currentOrder.length) return;

      const updates = {
        order: nextOrder,
        updatedAt: serverTimestamp(),
      };

      if (Array.isArray(routeData.rssIds)) {
        updates.rssIds = routeData.rssIds.filter((rssId) => !idsToMove.has(rssId));
      }

      batch.set(routeDoc.ref, updates, { merge: true });
      changedRoutes += 1;
    });

    if (changedRoutes > 0) {
      await batch.commit();
    }

    return changedRoutes;
  };

  // Fetch initial data (technicians and all potential stops)
  useEffect(() => {
    if (!recentlySelectedCompany) return;
    setIsLoading(true);

    Promise.all([
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'))),
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'))),
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'companyServiceStopTypes'))),
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop')))
    ])
      .then(async ([techSnapshot, stopsSnapshot, serviceStopTypesSnapshot, recurringStopsSnapshot]) => {
        const techList = techSnapshot.docs.map(doc => ({ value: doc.data().userId, label: doc.data().userName, ...doc.data() }));
        setTechnicians(techList);

        const stopList = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllStops(stopList);

        const typeList = serviceStopTypesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCompanyServiceStopTypes(typeList);

        const recurringStopList = recurringStopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllRecurringStops(recurringStopList);

        // If editing, set the technician and stops
        if (editingTemplate) {
          const tech = techList.find(t => t.value === editingTemplate.techId);
          setSelectedTechnician(tech || null);
          const orderedStops = await buildRouteStopsFromRouteOrder(editingTemplate, stopList);
          setRouteStops(orderedStops);
        } else if (state?.defaultTechnicianId) {
          const tech = techList.find(t => t.value === state.defaultTechnicianId);
          setSelectedTechnician(tech || null);
        }
      })
      .catch(() => toast.error("Failed to fetch initial data."))
      .finally(() => setIsLoading(false));
  }, [recentlySelectedCompany, editingTemplate]);

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

  // Auto-load existing template when day/tech changes (if not in edit mode)
  useEffect(() => {
    if (editingTemplate || !selectedDay || !selectedTechnician) return;

    const findAndLoadRoute = async () => {
      setIsLoading(true);
      try {
        const routesQuery = query(
          collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes'),
          where("techId", "==", selectedTechnician.value),
          where("day", "==", selectedDay.value)
        );
        const snapshot = await getDocs(routesQuery);

        if (!snapshot.empty) {
          const existing = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
          toast.success(`Loaded existing route for ${existing.tech} on ${existing.day}.`);
          setEditingTemplate(existing);
          setDescription(existing.description);
          const ordered = await buildRouteStopsFromRouteOrder(existing, allStops);
          setRouteStops(ordered);
        } else {
          // Reset if no template found for this combo
          setRouteStops([]);
          setDescription('');
        }
      } catch (error) {
        toast.error("Error checking for existing route.");
      } finally {
        setIsLoading(false);
      }
    };

    findAndLoadRoute();
  }, [selectedDay, selectedTechnician, editingTemplate, recentlySelectedCompany, allStops]);

  // =============================
  // Save logic:
  // - Existing RSS stops are moved through updateRecurringServiceStop so future stops stay aligned.
  // - New route stops create their first RSS/service stops through the iOS-compatible callable.
  // =============================

  const handleSaveTemplate = async () => {
    if (!selectedTechnician || !selectedDay || routeStops.length === 0) {
      toast.error("Select a day and technician, then add at least one stop.");
      return;
    }

    const totalRouteStops = routeStops.length;
    const saveAction = editingTemplate ? "Updating" : "Creating";
    setIsLoading(true);
    setRouteSaveProgress({
      action: saveAction,
      current: 0,
      total: totalRouteStops,
      detail: "Preparing route...",
    });

    try {
      // -------------------------
      // UPDATE EXISTING TEMPLATE
      // -------------------------
      if (editingTemplate) {
        const batch = writeBatch(db);
        const routeId = editingTemplate.id;
        const routeRef = doc(db, 'companies', recentlySelectedCompany, 'recurringRoutes', routeId);

        // RSS ids that were previously on the template
        const previousRssIds = (editingTemplate.order || [])
          .map(item => item.recurringServiceStopId)
          .filter(Boolean);

        // RSS ids that are still present in the edited routeStops
        const currentRssIds = routeStops
          .map(stop => stop.recurringServiceStopId)
          .filter(Boolean);

        // RSS ids removed during edit
        const removedRssIds = previousRssIds.filter(
          rssId => !currentRssIds.includes(rssId)
        );

        // Delete removed recurring service stops
        for (const rssId of removedRssIds) {
          setRouteSaveProgress((progress) => ({
            ...progress,
            detail: "Removing deleted route stops...",
          }));
          const callable = httpsCallable(functions, "deleteRecurringServiceStop");
          await callable({
            stopId: rssId,
            companyId: recentlySelectedCompany,
            includePastServiceStops: true,
          });
        }

        const newRouteOrder = [];
        for (let i = 0; i < routeStops.length; i++) {
          setRouteSaveProgress({
            action: saveAction,
            current: i + 1,
            total: totalRouteStops,
            detail: `${i + 1}/${totalRouteStops} route stops being updated`,
          });
          newRouteOrder.push(await buildRouteOrderItem(routeStops[i], i, {
            syncExistingRecurringStop: true,
          }));
        }

        const routeRecurringServiceStopIds = newRouteOrder
          .map((item) => item.recurringServiceStopId)
          .filter(Boolean);
        await removeRouteStopsFromOtherRoutes(routeRecurringServiceStopIds, routeId);

        const templateData = {
          id: routeId,
          description,
          day: selectedDay.value,
          tech: selectedTechnician.label,
          techId: selectedTechnician.value,
          order: newRouteOrder,
          rssIds: routeRecurringServiceStopIds,
          companyId: recentlySelectedCompany,
          updatedAt: serverTimestamp(),
        };

        batch.set(routeRef, templateData, { merge: true });
        setRouteSaveProgress({
          action: saveAction,
          current: totalRouteStops,
          total: totalRouteStops,
          detail: "Saving route...",
        });
        await batch.commit();

        toast.success("Route successfully updated!");
        navigate('/company/route-management');
        return;
      }

      // -------------------------
      // CREATE NEW TEMPLATE (iOS FLOW)
      // 1) create recurring service stops via callable
      // 2) build binder order[]
      // 3) save recurringRoute doc
      // -------------------------

      const batch = writeBatch(db);
      const routeId = `com_rr_${uuidv4()}`;
      const routeRef = doc(db, 'companies', recentlySelectedCompany, 'recurringRoutes', routeId);

      const binder = [];

      for (let i = 0; i < routeStops.length; i++) {
        const stop = routeStops[i];
        setRouteSaveProgress({
          action: saveAction,
          current: i + 1,
          total: totalRouteStops,
          detail: `${i + 1}/${totalRouteStops} route stops being created`,
        });
        binder.push(await buildRouteOrderItem(stop, i, {
          syncExistingRecurringStop: true,
        }));
      }

      const routeRecurringServiceStopIds = binder
        .map((item) => item.recurringServiceStopId)
        .filter(Boolean);
      await removeRouteStopsFromOtherRoutes(routeRecurringServiceStopIds, routeId);

      const templateData = {
        id: routeId,
        description,
        day: selectedDay.value,
        tech: selectedTechnician.label,
        techId: selectedTechnician.value,
        order: binder,
        rssIds: routeRecurringServiceStopIds,
        companyId: recentlySelectedCompany,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      batch.set(routeRef, templateData, { merge: true });
      setRouteSaveProgress({
        action: saveAction,
        current: totalRouteStops,
        total: totalRouteStops,
        detail: "Saving route...",
      });
      await batch.commit();

      toast.success("Route successfully created!");
      navigate('/company/route-management');

    } catch (error) {
      console.error("Error saving template: ", error);
      toast.error(`Failed to save template: ${error?.message || String(error)}`);
    } finally {
      setIsLoading(false);
      setRouteSaveProgress(null);
    }
  };

  const availableStops = useMemo(() => {
    const currentStopKeys = new Set(routeStops.map(routeStopKey));
    const currentRecurringServiceStopIds = new Set(
      routeStops.map((stop) => stop.recurringServiceStopId).filter(Boolean)
    );
    const recurringStopsByServiceLocationId = allRecurringStops.reduce((map, recurringStop) => {
      if (!recurringStop.serviceLocationId) return map;

      const existing = map.get(recurringStop.serviceLocationId) || [];
      map.set(recurringStop.serviceLocationId, [...existing, recurringStop]);
      return map;
    }, new Map());
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesSearch = (stop = {}) => {
      if (!normalizedSearch) return true;

      return [
        stop.internalId,
        stop.customerName,
        stop.address?.streetAddress,
        stop.address?.city,
        stop.day,
        stop.tech,
        stop.type,
        ...(Array.isArray(stop.existingRecurringStopSchedules) ? stop.existingRecurringStopSchedules : []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    };

    const recurringStopOptions = allRecurringStops
      .map((recurringStop) => buildRouteStopFromRecurringStop(recurringStop, allStops))
      .filter(Boolean)
      .filter((stop) => !currentRecurringServiceStopIds.has(stop.recurringServiceStopId))
      .filter((stop) => matchesSearch(stop));

    const serviceLocationOptions = allStops
      .map((stop) => {
        const existingRecurringStops = recurringStopsByServiceLocationId.get(stop.id) || [];
        const existingRecurringStopSchedules = existingRecurringStops.map((recurringStop) => {
          const day = recurringStop.day || "No day";
          const tech =
            recurringStop.tech ||
            technicianNameById.get(String(recurringStop.techId || "")) ||
            "Unassigned";
          return `${day} - ${tech}`;
        });

        return {
          ...stop,
          routeStopKey: `service-location-${stop.id}`,
          existingRecurringStopCount: existingRecurringStops.length,
          existingRecurringStopSchedules,
        };
      })
      .filter((stop) => !currentStopKeys.has(routeStopKey(stop)))
      .filter((stop) => matchesSearch(stop));

    return [...recurringStopOptions, ...serviceLocationOptions];
  }, [allRecurringStops, allStops, routeStops, searchTerm, technicianNameById]);

  // const mapLocations = useMemo(
  //   () =>
  //     routeStops
  //       .map(stop => ({
  //         ...stop,
  //         lat: parseFloat(stop.address?.latitude),
  //         lng: parseFloat(stop.address?.longitude)
  //       }))
  //       .filter(loc => !isNaN(loc.lat) && !isNaN(loc.lng)),
  //   [routeStops]
  // );
  const mapLocations = useMemo(() => {
    return routeStops.map(stop => {
      const lat = parseFloat(stop.address?.latitude);
      const lng = parseFloat(stop.address?.longitude);

      if (!isNaN(lat) && !isNaN(lng)) {
        return { ...stop.address, id: stop.id, lat, lng };
      }

      return null;
    }).filter(Boolean);
  }, [routeStops]);

  const handleOnDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(routeStops);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setRouteStops(items);
  };

  const handleAvailableStopTypeChange = (stopId, selectedType) => {
    setAvailableStopTypeSelections((current) => ({
      ...current,
      [stopId]: selectedType,
    }));
  };

  const handleAddStop = (stop) => {
    const stopKey = routeStopKey(stop);
    const selectedType = availableStopTypeSelections[stopKey] || selectedServiceStopType;
    setRouteStops([...routeStops, stopWithServiceStopType(stop, selectedType)]);
    setAvailableStopTypeSelections((current) => {
      const next = { ...current };
      delete next[stopKey];
      return next;
    });
  };

  const handleRouteStopTypeChange = (stopKey, selectedType) => {
    setRouteStops((currentStops) =>
      currentStops.map((stop) =>
        routeStopKey(stop) === stopKey ? stopWithServiceStopType(stop, selectedType) : stop
      )
    );
  };

  const handleDeleteRoute = async () => {
    if (!editingTemplate?.id || !recentlySelectedCompany) return;

    const rssIds = [
      ...new Set([
        ...(Array.isArray(editingTemplate.order)
          ? editingTemplate.order.map((item) => item?.recurringServiceStopId)
          : []),
        ...(Array.isArray(editingTemplate.rssIds) ? editingTemplate.rssIds : []),
      ].filter(Boolean)),
    ];
    const ok = window.confirm(
      `Delete this route, ${rssIds.length} RSS record${rssIds.length === 1 ? "" : "s"}, and all linked service stops? This cannot be undone.`
    );

    if (!ok) return;

    setIsDeletingRoute(true);
    try {
      const callable = httpsCallable(functions, "deleteRecurringRoute");
      const result = await callable({
        companyId: recentlySelectedCompany,
        routeId: editingTemplate.id,
        includePastServiceStops: true,
      });
      const deletedServiceStopCount = result?.data?.deletedServiceStopCount || 0;
      toast.success(`Route deleted. ${deletedServiceStopCount} linked service stop${deletedServiceStopCount === 1 ? "" : "s"} removed.`);
      navigate('/company/route-management');
    } catch (error) {
      console.error("Error deleting route:", error);
      toast.error("Failed to delete route.");
    } finally {
      setIsDeletingRoute(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="flex w-full min-h-[calc(100vh-3rem)] flex-col space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Planned routes</p>
              <h1 className="text-3xl font-bold text-slate-950">
                {editingTemplate ? 'Edit Route' : 'New Route'}
              </h1>
              <p className="max-w-3xl text-sm text-slate-600">Build the planned route, assign each stop type, and arrange the stop order.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => navigate('/company/route-management')}
                disabled={isDeletingRoute}
                className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              {editingTemplate && (
                <Button
                  onClick={handleDeleteRoute}
                  disabled={isLoading || isDeletingRoute}
                  className="inline-flex items-center gap-2 border border-red-200 bg-white text-red-700 hover:bg-red-50"
                >
                  <TrashIcon className="h-4 w-4" />
                  {isDeletingRoute ? "Deleting Route" : "Delete Route"}
                </Button>
              )}
              <Button
                onClick={handleSaveTemplate}
                disabled={isLoading || isDeletingRoute}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {isLoading ? 'Saving...' : (editingTemplate ? 'Update Route' : 'Create Route')}
              </Button>
            </div>
          </div>
        </section>

        <DragDropContext onDragEnd={handleOnDragEnd}>
          <div className="grid flex-1 grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_480px]">
            <div className="min-w-0 space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Route Description (Optional)" className="md:col-span-2">
                    <Input
                      placeholder="Optional notes for this route"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </Field>
                  <Field label="Day of Week">
                    <SelectInput
                      options={daysOfWeek}
                      value={selectedDay}
                      onChange={setSelectedDay}
                      placeholder="Select day of week"
                    />
                  </Field>
                  <Field label="Technician">
                    <SelectInput
                      options={technicians}
                      value={selectedTechnician}
                      onChange={setSelectedTechnician}
                      placeholder="Select technician"
                      isLoading={isLoading}
                    />
                  </Field>
                </div>
                {editingTemplate && (
                  <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                    <p className="font-semibold">Whole-route edit</p>
                    <p className="mt-1">
                      Saving this page updates the planned route, every RSS in Route Stops, and each unfinished future service stop tied to those RSS records. Use Edit RSS on an individual stop for single-recurring-stop changes.
                    </p>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <h3 className="text-xl font-bold text-slate-950">Available Stops</h3>
                  <Input
                    placeholder="Search by customer or address..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="md:max-w-md"
                  />
                </div>
                <div className="grid max-h-[34rem] gap-3 overflow-y-auto pr-2 xl:grid-cols-2 2xl:grid-cols-3">
                  {availableStops.map(stop => {
                    const stopKey = routeStopKey(stop);
                    const isExistingRecurringStop = !!stop.recurringServiceStopId;
                    const hasExistingRecurringStops =
                      !isExistingRecurringStop && Number(stop.existingRecurringStopCount || 0) > 0;
                    const existingRecurringStopSummary = Array.isArray(stop.existingRecurringStopSchedules)
                      ? stop.existingRecurringStopSchedules.slice(0, 2).join(", ")
                      : "";

                    return (
                    <div key={stopKey} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{stop.customerName}</p>
                          {isExistingRecurringStop && (
                            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                              {stop.internalId || "RSS"}
                            </span>
                          )}
                          {hasExistingRecurringStops && (
                            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                              New RSS
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500">{stop.address?.streetAddress}</p>
                        {isExistingRecurringStop && (
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            Current: {getRouteStopScheduleLabel(stop)}
                          </p>
                        )}
                        {hasExistingRecurringStops && (
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            Existing RSS: {existingRecurringStopSummary}
                            {stop.existingRecurringStopCount > 2 ? ` +${stop.existingRecurringStopCount - 2} more` : ""}
                          </p>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center xl:grid-cols-1 2xl:grid-cols-[1fr_auto]">
                        <SelectInput
                          options={serviceStopTypeOptions}
                          value={availableStopTypeSelections[stopKey] || serviceStopTypeForStop(stop)}
                          onChange={(selectedType) => handleAvailableStopTypeChange(stopKey, selectedType)}
                          placeholder="Service Stop Type"
                          isLoading={isLoading}
                        />
                        <Button
                          onClick={() => handleAddStop(stop)}
                          className="bg-blue-600 text-white hover:bg-blue-700"
                        >
                          {isExistingRecurringStop ? "Move" : hasExistingRecurringStops ? "Add New RSS" : "Add"}
                        </Button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-xl font-bold text-slate-950">Route Map</h3>
                </div>
                <div className="h-96 w-full md:h-[420px]">
                  <MultiLocationMap locations={mapLocations} />
                </div>
              </section>
            </div>

            <aside className="min-w-0 xl:flex xl:min-h-[calc(100vh-12rem)]">
              <section className="flex w-full flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h3 className="text-xl font-bold text-slate-950">Route Stops</h3>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">{routeStops.length}</span>
                </div>
                <Droppable droppableId="routeStops">
                  {(provided) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="min-h-[420px] flex-1 space-y-3 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 xl:min-h-0"
                    >
                      {routeStops.map((stop, index) => {
                        const stopKey = routeStopKey(stop);
                        const isExistingRecurringStop = !!stop.recurringServiceStopId;

                        return (
                        <Draggable key={stopKey} draggableId={stopKey} index={index}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
                            >
                              <div className="space-y-3">
                                <div className='flex items-start gap-3'>
                                  <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500'>{index + 1}</span>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-semibold text-slate-900">{stop.customerName}</p>
                                      {isExistingRecurringStop && (
                                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                                          {stop.internalId || "RSS"}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-sm text-slate-600">{stop.address?.streetAddress}</p>
                                    {isExistingRecurringStop && (
                                      <p className="mt-1 text-xs font-medium text-slate-500">
                                        Current: {getRouteStopScheduleLabel(stop)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-[1fr_auto] xl:grid-cols-1 2xl:grid-cols-[1fr_auto]">
                                  <SelectInput
                                    options={serviceStopTypeOptions}
                                    value={serviceStopTypeForStop(stop)}
                                    onChange={(selectedType) => handleRouteStopTypeChange(stopKey, selectedType)}
                                    placeholder="Service Stop Type"
                                    isLoading={isLoading}
                                  />
                                  <Button
                                    onClick={() => setRouteStops(routeStops.filter(s => routeStopKey(s) !== stopKey))}
                                    className="bg-red-500 text-white hover:bg-red-600"
                                  >
                                    Remove
                                  </Button>
                                </div>
                                {isExistingRecurringStop && (
                                  <Link
                                    to={`/company/recurringServiceStop/details/${stop.recurringServiceStopId}?edit=1`}
                                    className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Edit RSS
                                  </Link>
                                )}
                              </div>
                            </div>
                          )}
                        </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </section>
            </aside>
          </div>
        </DragDropContext>
      </div>
      {routeSaveProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{routeSaveProgress.action} Route</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {routeSaveProgress.current}/{routeSaveProgress.total}
            </p>
            <p className="mt-1 text-sm text-slate-600">{routeSaveProgress.detail}</p>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.max(5, Math.round((routeSaveProgress.current / routeSaveProgress.total) * 100))}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RouteBuilder;
