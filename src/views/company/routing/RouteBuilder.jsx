import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { collection, getDocs, query, where, writeBatch, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { MultiLocationMap } from '../../components/MultiLocationMap';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';

// Reusable form components
const Input = (props) => (
  <input
    {...props}
    className={`bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 ${props.className}`}
  />
);
const Button = ({ children, ...props }) => (
  <button
    {...props}
    className={`py-2 px-4 rounded-lg font-semibold shadow-md transition-all ${props.className}`}
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

const RouteBuilder = () => {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);

  // Core state
  const [editingTemplate, setEditingTemplate] = useState(state?.templateToEdit || null);
  const [description, setDescription] = useState(editingTemplate?.description || '');
  const [selectedDay, setSelectedDay] = useState(
    editingTemplate ? { value: editingTemplate.day, label: editingTemplate.day } : null
  );
  const [selectedTechnician, setSelectedTechnician] = useState(null);
  const [routeStops, setRouteStops] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Data state
  const [technicians, setTechnicians] = useState([]);
  const [allStops, setAllStops] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => ({
    value: day,
    label: day
  }));

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

        otherCompany: recurringServiceStop.otherCompany ?? null,
        laborContractId: recurringServiceStop.laborContractId ?? null,
        contractedCompanyId: recurringServiceStop.contractedCompanyId ?? null,
        mainCompanyId: recurringServiceStop.mainCompanyId ?? null,
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

  // Fetch initial data (technicians and all potential stops)
  useEffect(() => {
    if (!recentlySelectedCompany) return;
    setIsLoading(true);

    Promise.all([
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'))),
      getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations')))
    ])
      .then(([techSnapshot, stopsSnapshot]) => {
        const techList = techSnapshot.docs.map(doc => ({ value: doc.data().userId, label: doc.data().userName, ...doc.data() }));
        setTechnicians(techList);

        const stopList = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllStops(stopList);

        // If editing, set the technician and stops
        if (editingTemplate) {
          const tech = techList.find(t => t.value === editingTemplate.techId);
          setSelectedTechnician(tech || null);
          const orderedStops = (editingTemplate.order || [])
            .sort((a, b) => a.order - b.order)
            .map(orderedStop => stopList.find(c => c.id === orderedStop.locationId))
            .filter(Boolean);
          setRouteStops(orderedStops);
        }
      })
      .catch(() => toast.error("Failed to fetch initial data."))
      .finally(() => setIsLoading(false));
  }, [recentlySelectedCompany, editingTemplate]);

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
          toast.success(`Loaded existing template for ${existing.tech} on ${existing.day}.`);
          setEditingTemplate(existing);
          setDescription(existing.description);
          const ordered = (existing.order || [])
            .sort((a, b) => a.order - b.order)
            .map(os => allStops.find(c => c.id === os.locationId))
            .filter(Boolean);
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
    if (!description || !selectedTechnician || !selectedDay || routeStops.length === 0) {
      toast.error("Please provide a description, select a day and technician, and add at least one stop.");
      return;
    }

    setIsLoading(true);

    try {
      // -------------------------
      // UPDATE EXISTING TEMPLATE
      // -------------------------
      if (editingTemplate) {
        const batch = writeBatch(db);
        const routeId = editingTemplate.id;
        const routeRef = doc(db, 'companies', recentlySelectedCompany, 'recurringRoutes', routeId);

        const newRouteOrder = routeStops.map((stop, index) => ({
          id: stop.id,
          order: index + 1,
          recurringServiceStopId: stop.recurringServiceStopId ?? null,
          customerId: stop.customerId,
          customerName: stop.customerName,
          locationId: stop.id
        }));

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
        await batch.commit();

        toast.success("Template successfully updated!");
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

        // Build RecurringServiceStop payload expected by your Firebase function.
        // NOTE: startDate/endDate/noEndDate/frequency are set to safe defaults.
        // If you have these in state, swap them in here.

        //Get Internal ID

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
        const internalId = "RRS_" + String(recurringServiceStopCount)
        const recurringServiceStop = {
          id: `comp_rss_${uuidv4()}`,
          internalId: internalId,
          type: stop.type ?? "",
          typeId: stop.typeId ?? "",
          typeImage: stop.typeImage ?? "",
          customerName: stop.customerName,
          customerId: stop.customerId,
          address: stop.address,
          tech: selectedTechnician.label,
          techId: selectedTechnician.value,
          dateCreated: new Date(),
          startDate: new Date(),
          endDate: null,
          noEndDate: true,
          // IMPORTANT: set this to what your backend expects (examples: "weekly", "WEEKLY", etc.)
          frequency: stop.frequency ?? "Weekly",
          day: selectedDay.value,
          description: description,
          lastCreated: new Date(),
          serviceLocationId: stop.id,
          estimatedTime: stop.estimatedTime ?? null,
          otherCompany: stop.otherCompany ?? null,
          laborContractId: stop.laborContractId ?? null,
          contractedCompanyId: stop.contractedCompanyId ?? null,
          mainCompanyId: stop.mainCompanyId ?? null,
        };

        const rssId = await createFirstRecurringServiceStop(recentlySelectedCompany, recurringServiceStop);

        binder.push({
          id: uuidv4(),
          order: i + 1,
          recurringServiceStopId: rssId,
          customerId: stop.customerId,
          customerName: stop.customerName,
          locationId: stop.id
        });
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
      await batch.commit();

      toast.success("Template successfully created!");
      navigate('/company/route-management');

    } catch (error) {
      console.error("Error saving template: ", error);
      toast.error(`Failed to save template: ${error?.message || String(error)}`);
    } finally {
      setIsLoading(false);
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

  const mapLocations = useMemo(
    () =>
      routeStops
        .map(stop => ({
          ...stop,
          lat: parseFloat(stop.address?.latitude),
          lng: parseFloat(stop.address?.longitude)
        }))
        .filter(loc => !isNaN(loc.lat) && !isNaN(loc.lng)),
    [routeStops]
  );

  const handleOnDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(routeStops);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setRouteStops(items);
  };

  return (
    <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className='text-3xl font-bold text-gray-800'>
            {editingTemplate ? 'Edit Route Template' : 'Create Route Template'}
          </h1>
          <p className='text-gray-600 mt-1'>Drag and drop to build and organize your route templates.</p>
        </header>

        <div className="bg-white p-6 rounded-2xl shadow-lg mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Input
              placeholder="Template Description (e.g., 'Monday Pool Route')"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="md:col-span-3"
            />
            <SelectInput
              options={daysOfWeek}
              value={selectedDay}
              onChange={setSelectedDay}
              placeholder="Select Day"
              isDisabled={!!editingTemplate}
            />
            <SelectInput
              options={technicians}
              value={selectedTechnician}
              onChange={setSelectedTechnician}
              placeholder="Select Technician"
              isDisabled={!!editingTemplate}
              isLoading={isLoading}
            />
          </div>
        </div>

        <div className="w-full h-96 md:h-[400px] rounded-2xl overflow-hidden shadow-lg mb-8 border border-gray-200">
          <MultiLocationMap locations={mapLocations} />
        </div>

        <DragDropContext onDragEnd={handleOnDragEnd}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-2xl shadow-lg">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Available Stops</h3>
              <Input
                placeholder="Search by customer or address..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="mb-4"
              />
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {availableStops.map(stop => (
                  <div key={stop.id} className="bg-gray-50 p-3 rounded-lg flex justify-between items-center border border-gray-200">
                    <div>
                      <p className="font-semibold text-gray-800">{stop.customerName}</p>
                      <p className="text-sm text-gray-500">{stop.address?.streetAddress}</p>
                    </div>
                    <Button
                      onClick={() => setRouteStops([...routeStops, stop])}
                      className="bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-lg">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Route Stops ({routeStops.length})</h3>
              <Droppable droppableId="routeStops">
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="bg-gray-50 p-4 rounded-lg space-y-3 min-h-[200px] border border-gray-200"
                  >
                    {routeStops.map((stop, index) => (
                      <Draggable key={stop.id} draggableId={stop.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="bg-white p-4 rounded-lg shadow flex justify-between items-center border border-gray-200"
                          >
                            <div className='flex items-center'>
                              <span className='text-lg font-bold text-gray-400 mr-4'>{index + 1}</span>
                              <div>
                                <p className="font-semibold text-gray-900">{stop.customerName}</p>
                                <p className="text-sm text-gray-600">{stop.address?.streetAddress}</p>
                              </div>
                            </div>
                            <Button
                              onClick={() => setRouteStops(routeStops.filter(s => s.id !== stop.id))}
                              className="bg-red-500 text-white hover:bg-red-600"
                            >
                              Remove
                            </Button>
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
        </DragDropContext>

        <div className="mt-8 flex justify-end space-x-4">
          <Button onClick={() => navigate('/company/route-management')} className='bg-gray-200 text-gray-800 hover:bg-gray-300'>
            Cancel
          </Button>
          <Button onClick={handleSaveTemplate} disabled={isLoading} className='bg-green-600 text-white disabled:bg-gray-400 hover:bg-green-700'>
            {isLoading ? 'Saving...' : (editingTemplate ? 'Update Template' : 'Create Template')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RouteBuilder;