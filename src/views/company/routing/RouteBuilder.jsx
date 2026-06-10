import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { collection, getDocs, query, where, writeBatch, doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { MultiLocationMap } from '../../components/MultiLocationMap';
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';
import {
  debugServiceStopTypeWrite,
  resolveServiceStopTypeFields,
  SERVICE_STOP_TYPE_USE_CASES,
  suggestCompanyServiceStopType,
} from '../../../utils/serviceStopTypes/serviceStopTypeResolver';

const functions = getFunctions();
// Reusable form components
const Input = ({ className = "", ...props }) => (
  <input
    {...props}
    className={`bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 ${className}`}
  />
);
const Button = ({ children, className = "", ...props }) => (
  <button
    {...props}
    className={`py-2 px-4 rounded-lg font-semibold shadow-md transition-all ${className}`}
  >
    {children}
  </button>
);
const SelectInput = (props) => (
  <Select
    {...props}
    styles={{ control: (base) => ({ ...base, borderColor: '#D1D5DB', borderRadius: '0.5rem' }) }}
  />
);
const Field = ({ label, children, className = "" }) => (
  <div className={`block ${className}`}>
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
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

  // Data state
  const [technicians, setTechnicians] = useState([]);
  const [allStops, setAllStops] = useState([]);
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
          routeOrderId: orderedStop.id,
          recurringServiceStopId: orderedStop.recurringServiceStopId,
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
          estimatedTime: recurringStop.estimatedTime ?? serviceLocation?.estimatedTime ?? null,
        };
      })
      .filter(Boolean);
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

  const buildRouteOrderItem = async (stop, index) => {
    const resolvedTypeFields = resolveStopTypeFields(stop, serviceStopTypeForStop(stop));
    const recurringServiceStopId = stop.recurringServiceStopId || await createRecurringServiceStopForRouteStop(stop);

    if (stop.recurringServiceStopId) {
      try {
        await updateDoc(
          doc(db, "companies", recentlySelectedCompany, "recurringServiceStop", stop.recurringServiceStopId),
          {
            type: resolvedTypeFields.type,
            typeId: resolvedTypeFields.typeId,
            typeImage: resolvedTypeFields.typeImage,
            category: resolvedTypeFields.category,
            serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
            day: selectedDay.value,
            tech: selectedTechnician.label,
            techId: selectedTechnician.value,
          }
        );
      } catch (error) {
        console.warn("Unable to sync route stop service stop type.", {
          recurringServiceStopId: stop.recurringServiceStopId,
          error,
        });
      }
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

  // Fetch initial data (technicians and all potential stops)
  useEffect(() => {
    if (!recentlySelectedCompany) return;
    setIsLoading(true);

    Promise.all([
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'))),
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'))),
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'companyServiceStopTypes')))
    ])
      .then(async ([techSnapshot, stopsSnapshot, serviceStopTypesSnapshot]) => {
        const techList = techSnapshot.docs.map(doc => ({ value: doc.data().userId, label: doc.data().userName, ...doc.data() }));
        setTechnicians(techList);

        const stopList = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllStops(stopList);

        const typeList = serviceStopTypesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCompanyServiceStopTypes(typeList);

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
  // Updated save logic:
  // - If editingTemplate: update route doc only (your old behavior)
  // - Else: create RSS via callable for each stop, then create route doc (iOS behavior)
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
          newRouteOrder.push(await buildRouteOrderItem(routeStops[i], i));
        }

        const templateData = {
          id: routeId,
          description,
          day: selectedDay.value,
          tech: selectedTechnician.label,
          techId: selectedTechnician.value,
          order: newRouteOrder,
          companyId: recentlySelectedCompany,
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
        binder.push(await buildRouteOrderItem(stop, i));
      }

      const templateData = {
        id: routeId,
        description,
        day: selectedDay.value,
        tech: selectedTechnician.label,
        techId: selectedTechnician.value,
        order: binder,
        companyId: recentlySelectedCompany,
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
    const currentStopIds = new Set(routeStops.map(stop => stop.id));
    return allStops
      .filter(stop => !currentStopIds.has(stop.id))
      .filter(stop =>
        stop.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        stop.address?.streetAddress?.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [allStops, routeStops, searchTerm]);

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
    const selectedType = availableStopTypeSelections[stop.id] || selectedServiceStopType;
    setRouteStops([...routeStops, stopWithServiceStopType(stop, selectedType)]);
    setAvailableStopTypeSelections((current) => {
      const next = { ...current };
      delete next[stop.id];
      return next;
    });
  };

  const handleRouteStopTypeChange = (stopId, selectedType) => {
    setRouteStops((currentStops) =>
      currentStops.map((stop) =>
        stop.id === stopId ? stopWithServiceStopType(stop, selectedType) : stop
      )
    );
  };

  return (
    <div className='min-h-screen bg-gray-50 px-3 py-4 sm:px-5 lg:px-6'>
      <div className="mx-auto w-full max-w-[1800px]">
        <header className="mb-6">
          <h1 className='text-3xl font-bold text-gray-800'>
            {editingTemplate ? 'Edit Route' : 'New Route'}
          </h1>
          <p className='text-gray-600 mt-1'>Build the planned route, assign each stop type, and arrange the stop order.</p>
        </header>

        <DragDropContext onDragEnd={handleOnDragEnd}>
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_480px]">
            <div className="min-w-0 space-y-6">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
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
                      isDisabled={!!editingTemplate}
                    />
                  </Field>
                  <Field label="Technician">
                    <SelectInput
                      options={technicians}
                      value={selectedTechnician}
                      onChange={setSelectedTechnician}
                      placeholder="Select technician"
                      isDisabled={!!editingTemplate}
                      isLoading={isLoading}
                    />
                  </Field>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <h3 className="text-xl font-bold text-gray-800">Available Stops</h3>
                  <Input
                    placeholder="Search by customer or address..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="md:max-w-md"
                  />
                </div>
                <div className="grid max-h-[34rem] gap-3 overflow-y-auto pr-2 xl:grid-cols-2 2xl:grid-cols-3">
                  {availableStops.map(stop => (
                    <div key={stop.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-3">
                        <p className="font-semibold text-gray-800">{stop.customerName}</p>
                        <p className="text-sm text-gray-500">{stop.address?.streetAddress}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center xl:grid-cols-1 2xl:grid-cols-[1fr_auto]">
                        <SelectInput
                          options={serviceStopTypeOptions}
                          value={availableStopTypeSelections[stop.id] || selectedServiceStopType}
                          onChange={(selectedType) => handleAvailableStopTypeChange(stop.id, selectedType)}
                          placeholder="Service Stop Type"
                          isLoading={isLoading}
                        />
                        <Button
                          onClick={() => handleAddStop(stop)}
                          className="bg-blue-600 text-white hover:bg-blue-700"
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-5 py-4 sm:px-6">
                  <h3 className="text-xl font-bold text-gray-800">Route Map</h3>
                </div>
                <div className="h-96 w-full md:h-[420px]">
                  <MultiLocationMap locations={mapLocations} />
                </div>
              </div>
            </div>

            <div className="min-w-0 xl:sticky xl:top-6">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6 xl:flex xl:max-h-[calc(100vh-3rem)] xl:flex-col">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h3 className="text-xl font-bold text-gray-800">Route Stops</h3>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">{routeStops.length}</span>
                </div>
                <Droppable droppableId="routeStops">
                  {(provided) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="min-h-[280px] space-y-3 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4 xl:flex-1"
                    >
                      {routeStops.map((stop, index) => (
                        <Draggable key={stop.id} draggableId={stop.id} index={index}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className="rounded-lg border border-gray-200 bg-white p-4 shadow"
                            >
                              <div className="space-y-3">
                                <div className='flex items-start gap-3'>
                                  <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-500'>{index + 1}</span>
                                  <div>
                                    <p className="font-semibold text-gray-900">{stop.customerName}</p>
                                    <p className="text-sm text-gray-600">{stop.address?.streetAddress}</p>
                                  </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-[1fr_auto] xl:grid-cols-1 2xl:grid-cols-[1fr_auto]">
                                  <SelectInput
                                    options={serviceStopTypeOptions}
                                    value={serviceStopTypeForStop(stop)}
                                    onChange={(selectedType) => handleRouteStopTypeChange(stop.id, selectedType)}
                                    placeholder="Service Stop Type"
                                    isLoading={isLoading}
                                  />
                                  <Button
                                    onClick={() => setRouteStops(routeStops.filter(s => s.id !== stop.id))}
                                    className="bg-red-500 text-white hover:bg-red-600"
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            </div>
          </div>
        </DragDropContext>

        <div className="mt-8 flex justify-end space-x-4">
          <Button onClick={() => navigate('/company/route-management')} className='bg-gray-200 text-gray-800 hover:bg-gray-300'>
            Cancel
          </Button>
          <Button onClick={handleSaveTemplate} disabled={isLoading} className='bg-green-600 text-white disabled:bg-gray-400 hover:bg-green-700'>
            {isLoading ? 'Saving...' : (editingTemplate ? 'Update Route' : 'Create Route')}
          </Button>
        </div>
      </div>
      {routeSaveProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{routeSaveProgress.action} Route</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {routeSaveProgress.current}/{routeSaveProgress.total}
            </p>
            <p className="mt-1 text-sm text-gray-600">{routeSaveProgress.detail}</p>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-gray-100">
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
