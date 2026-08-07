import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../../../utils/config';
import {
  collection,
  getDocs,
  query,
  orderBy,
  where,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

const sortByField = (items = [], field = 'name', direction = 'asc') => (
  [...items].sort((a, b) => {
    const left = String(a?.[field] || '').toLowerCase();
    const right = String(b?.[field] || '').toLowerCase();
    const comparison = left.localeCompare(right);

    return direction === 'desc' ? comparison * -1 : comparison;
  })
);

const getPermissionMessage = (error, action) => (
  error?.code === 'permission-denied'
    ? `Firestore denied permission to ${action}. Make sure this account is listed as super-master, has accountType "Admin", or has a Firebase admin custom claim, and that the latest rules are deployed.`
    : `Unable to ${action}. Please refresh and try again.`
);

const UniversalEquipment = () => {
  const [view, setView] = useState('list'); // list, detail, create, edit, suggestions
  const [equipment, setEquipment] = useState([]);
  const [filteredEquipment, setFilteredEquipment] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [allEquipmentMakes, setAllEquipmentMakes] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalType, setModalType] = useState(''); // 'type' or 'make'
  const [newItemName, setNewItemName] = useState('');
  const [newMakeTypeIds, setNewMakeTypeIds] = useState([]);
  const [modalError, setModalError] = useState('');
  const [equipmentSuggestions, setEquipmentSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [suggestionStatusFilter, setSuggestionStatusFilter] = useState('New');
  const [formError, setFormError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [selectedMakeRecord, setSelectedMakeRecord] = useState(null);
  const [makeDetailTypeIds, setMakeDetailTypeIds] = useState([]);
  const [makeDetailSaving, setMakeDetailSaving] = useState(false);
  const [makeDetailMessage, setMakeDetailMessage] = useState('');
  const [makeDetailError, setMakeDetailError] = useState('');
  const [newModelForm, setNewModelForm] = useState({
    typeId: '',
    model: '',
    name: '',
    manualPdfLink: '',
  });
  const [newModelSaving, setNewModelSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [typeId, setTypeId] = useState('');
  const [make, setMake] = useState('');
  const [makeId, setMakeId] = useState('');
  const [model, setModel] = useState('');
  const [manualPdfLink, setManualPdfLink] = useState('');
  const [equipmentMakes, setEquipmentMakes] = useState([]);
  const [parts, setParts] = useState([]);
  const [originalPartIds, setOriginalPartIds] = useState([]);

  // --- Admin theme helpers (single source of truth) ---
  const ADMIN_YELLOW = '#efb12f';

  const cardClass =
    'w-full bg-slate-950 p-4 rounded-xl text-slate-100 border border-slate-800/60 shadow-2xl';
  const inputClass =
    `w-full px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 ` +
    `placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30`;
  const selectClass =
    `w-full px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 ` +
    `focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30`;

  const btnPrimary =
    `px-4 py-2 rounded-md font-semibold bg-[#efb12f] text-slate-950 hover:bg-[#efb12f]/90 transition`;
  const btnSecondary =
    'px-4 py-2 rounded-md font-semibold bg-slate-900/70 text-slate-200 border border-slate-800/60 hover:bg-slate-900 transition';
  const btnAccentOutline =
    `px-4 py-2 rounded-md font-semibold bg-[#efb12f]/10 text-[#efb12f] ring-1 ring-[#efb12f]/30 hover:bg-[#efb12f]/15 transition`;
  const btnDangerOutline =
    'px-4 py-2 rounded-md font-semibold bg-red-500/15 text-red-200 ring-1 ring-red-500/30 hover:bg-red-500/20 transition';
  const btnDangerSolid =
    'px-4 py-2 rounded-md font-semibold bg-red-500 text-white hover:bg-red-400 transition';

  const formatDateTime = (value) => {
    if (!value) return 'No date';
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return 'No date';

    return date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const suggestionStatusClass = (status) => {
    if (status === 'Reconciled') return 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/30';
    if (status === 'Reviewed') return 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30';
    if (status === 'Dismissed') return 'bg-slate-700/60 text-slate-300 ring-1 ring-slate-600/60';

    return 'bg-[#efb12f]/15 text-[#efb12f] ring-1 ring-[#efb12f]/30';
  };

  const fetchEquipmentTypes = useCallback(async () => {
    const q = query(collection(db, 'universal', 'equipment', 'equipmentTypes'));
    const querySnapshot = await getDocs(q);
    const typesList = sortByField(querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() })));
    setEquipmentTypes(typesList);
  }, []);

  const fetchAllEquipmentMakes = useCallback(async () => {
    const q = query(collection(db, 'universal', 'equipment', 'equipmentMakes'));
    const querySnapshot = await getDocs(q);
    const makesList = sortByField(querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() })));
    setAllEquipmentMakes(makesList);
  }, []);

  const fetchEquipmentCatalog = useCallback(async () => {
    const q = query(collection(db, 'universal', 'equipment', 'equipment'));
    const querySnapshot = await getDocs(q);
    const equipmentList = sortByField(
      querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() })),
      sortField,
      sortDirection
    );
    setEquipment(equipmentList);
    setFilteredEquipment(equipmentList);
  }, [sortField, sortDirection]);

  const fetchEquipmentSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    setSuggestionsError('');

    try {
      const q = query(
        collection(db, 'universalEquipmentSuggestions'),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      setEquipmentSuggestions(querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() })));
    } catch (error) {
      console.error('Error loading potential new equipment:', error);
      setEquipmentSuggestions([]);
      setSuggestionsError(
        error?.code === 'permission-denied'
          ? 'Your account is signed in, but Firestore is not recognizing it as a super-master or Drip Drop admin for the potential equipment queue.'
          : 'Potential equipment could not be loaded. Please refresh and try again.'
      );
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  const fetchEquipmentMakes = useCallback(async () => {
    if (type) {
      const selectedType = equipmentTypes.find((t) => t.name === type);
      if (selectedType) {
        setTypeId(selectedType.id);
        const q = query(
          collection(db, 'universal', 'equipment', 'equipmentMakes'),
          where('types', 'array-contains', selectedType.id)
        );
        const querySnapshot = await getDocs(q);
        const makesList = sortByField(querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() })));
        setEquipmentMakes(makesList);
      }
    } else {
      setEquipmentMakes([]);
      setMake('');
      setMakeId('');
    }
  }, [equipmentTypes, type]);

  useEffect(() => {
    fetchEquipmentTypes();
    fetchAllEquipmentMakes();
  }, [fetchAllEquipmentMakes, fetchEquipmentTypes]);

  useEffect(() => {
    if (['list', 'makes', 'makeDetail'].includes(view)) {
      fetchEquipmentCatalog();
    }
  }, [fetchEquipmentCatalog, view]);

  useEffect(() => {
    if (view === 'suggestions') {
      fetchEquipmentSuggestions();
    }
  }, [fetchEquipmentSuggestions, view]);

  useEffect(() => {
    let results = equipment;

    if (searchTerm) {
      results = results.filter(
        (item) =>
          (item.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (item.make || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (item.model || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (filterType) {
      results = results.filter((item) => item.type === filterType);
    }

    setFilteredEquipment(results);
  }, [searchTerm, filterType, equipment]);

  useEffect(() => {
    fetchEquipmentMakes();
  }, [fetchEquipmentMakes]);

  const handleSort = (field) => {
    const order = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortField(field);
    setSortDirection(order);
  };

  const handleCreateNew = () => {
    resetForm();
    setFormError('');
    setView('create');
  };

  const handleTypeChange = (value) => {
    const selectedType = equipmentTypes.find((item) => item.name === value);
    setType(value);
    setTypeId(selectedType?.id || '');
    setMake('');
    setMakeId('');
  };

  const handleMakeChange = (value) => {
    const selectedMake = equipmentMakes.find((item) => item.name === value);
    setMake(value);
    setMakeId(selectedMake?.id || '');
  };

  const handleSelectEquipment = async (id) => {
    setDetailError('');
    const docRef = doc(db, 'universal', 'equipment', 'equipment', id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const partList = await fetchUniversalParts(docSnap.id);
      setSelectedEquipment({ id: docSnap.id, ...docSnap.data(), parts: partList });
      setParts(partList);
      setOriginalPartIds(partList.map((part) => part.id).filter(Boolean));
      setView('detail');
    } else {
      console.log('No such document!');
    }
  };

  const handleEdit = () => {
    setFormError('');
    setName(selectedEquipment?.name || '');
    setType(selectedEquipment?.type || '');
    setTypeId(selectedEquipment?.typeId || '');
    setMake(selectedEquipment?.make || '');
    setMakeId(selectedEquipment?.makeId || '');
    setModel(selectedEquipment?.model || '');
    setManualPdfLink(selectedEquipment?.manualPdfLink || '');
    setParts(selectedEquipment?.parts || []);
    setOriginalPartIds((selectedEquipment?.parts || []).map((part) => part.id).filter(Boolean));
    setView('edit');
  };

  const handleDelete = async () => {
    setDetailError('');

    try {
      await deleteDoc(doc(db, 'universal', 'equipment', 'equipment', selectedEquipment.id));
      setView('list');
      setShowConfirm(false);
    } catch (error) {
      console.error('Error deleting universal equipment:', error);
      setDetailError(getPermissionMessage(error, 'delete this universal equipment'));
      setShowConfirm(false);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const equipmentId = 'com_equ_' + uuidv4();
    const targetEquipmentId = view === 'edit' ? selectedEquipment.id : equipmentId;

    const equipmentData = {
      id: targetEquipmentId,
      name,
      type,
      typeId,
      make,
      makeId,
      model,
      modelId: targetEquipmentId,
      manualPdfLink,
    };

    try {
      if (view === 'edit') {
        const docRef = doc(db, 'universal', 'equipment', 'equipment', selectedEquipment.id);
        await updateDoc(docRef, equipmentData);
      } else {
        await setDoc(doc(collection(db, 'universal', 'equipment', 'equipment'), equipmentId), equipmentData);
      }

      await saveUniversalParts(targetEquipmentId);
      await fetchEquipmentCatalog();
      setView('list');
      resetForm();
    } catch (error) {
      console.error('Error saving universal equipment:', error);
      setFormError(getPermissionMessage(error, 'save universal equipment'));
    }
  };

  const resetForm = () => {
    setName('');
    setType('');
    setTypeId('');
    setMake('');
    setMakeId('');
    setModel('');
    setManualPdfLink('');
    setParts([]);
    setOriginalPartIds([]);
  };

  const fetchUniversalParts = async (equipmentId) => {
    const partsSnapshot = await getDocs(
      collection(db, 'universal', 'equipment', 'equipment', equipmentId, 'parts')
    );

    return partsSnapshot.docs.map((partDoc) => ({
      id: partDoc.id,
      ...partDoc.data(),
    }));
  };

  const saveUniversalParts = async (equipmentId) => {
    const cleanParts = parts
      .map((part) => ({
        ...part,
        name: (part.name || '').trim(),
        sku: (part.sku || '').trim(),
        manualPdfLink: (part.manualPdfLink || '').trim(),
      }))
      .filter((part) => part.name);

    const currentIds = cleanParts.map((part) => part.id).filter(Boolean);
    const removedIds = originalPartIds.filter((partId) => !currentIds.includes(partId));

    await Promise.all([
      ...removedIds.map((partId) =>
        deleteDoc(doc(db, 'universal', 'equipment', 'equipment', equipmentId, 'parts', partId))
      ),
      ...cleanParts.map((part) => {
        const partId = part.id || 'unv_equ_part_' + uuidv4();

        return setDoc(
          doc(db, 'universal', 'equipment', 'equipment', equipmentId, 'parts', partId),
          {
            id: partId,
            name: part.name,
            sku: part.sku || '',
            make: make || '',
            model: model || '',
            manualPdfLink: part.manualPdfLink || '',
          }
        );
      }),
    ]);
  };

  const addPartRow = () => {
    setParts((current) => [
      ...current,
      {
        id: 'unv_equ_part_' + uuidv4(),
        name: '',
        sku: '',
        manualPdfLink: '',
      },
    ]);
  };

  const updatePart = (partId, field, value) => {
    setParts((current) =>
      current.map((part) => (part.id === partId ? { ...part, [field]: value } : part))
    );
  };

  const removePart = (partId) => {
    setParts((current) => current.filter((part) => part.id !== partId));
  };

  const handleOpenAddModal = (t) => {
    setModalType(t);
    setNewItemName('');
    setNewMakeTypeIds(t === 'make' && typeId ? [typeId] : []);
    setModalError('');
    setShowAddModal(true);
  };

  const handleAddNewItem = async () => {
    if (!newItemName) return;
    setModalError('');

    const collectionName = modalType === 'type' ? 'equipmentTypes' : 'equipmentMakes';
    const id = 'unv_equ_' + uuidv4();
    const selectedType = equipmentTypes.find((item) => item.name === type);
    const selectedTypeIds = newMakeTypeIds.length
      ? newMakeTypeIds
      : selectedType?.id
        ? [selectedType.id]
        : [];

    try {
      await setDoc(doc(collection(db, 'universal', 'equipment', collectionName), id), {
        id,
        name: newItemName,
        description: '',
        ...(modalType === 'make' ? { types: selectedTypeIds } : {}),
      });

      setNewItemName('');
      setNewMakeTypeIds([]);
      setShowAddModal(false);

      if (modalType === 'type') {
        await fetchEquipmentTypes();
      } else {
        await fetchAllEquipmentMakes();
        await fetchEquipmentMakes();
      }
    } catch (error) {
      console.error('Error creating universal equipment type or make:', error);
      setModalError(getPermissionMessage(error, `add this ${modalType || 'catalog item'}`));
    }
  };

  const getTypeName = (typeIdToFind) => (
    equipmentTypes.find((item) => item.id === typeIdToFind)?.name || ''
  );

  const getMakeTypeLabels = (typeIds = []) => (
    typeIds
      .map((typeIdToFind) => getTypeName(typeIdToFind))
      .filter(Boolean)
      .join(', ') || 'No types assigned'
  );

  const arraysHaveSameValues = (left = [], right = []) => {
    if (left.length !== right.length) return false;
    const rightValues = new Set(right);

    return left.every((item) => rightValues.has(item));
  };

  const selectedMakeModels = useMemo(() => {
    if (!selectedMakeRecord) return [];

    return sortByField(
      equipment.filter((item) => (
        item.makeId === selectedMakeRecord.id
        || (!item.makeId && item.make === selectedMakeRecord.name)
      )),
      'model',
      'asc'
    );
  }, [equipment, selectedMakeRecord]);

  const selectedMakeTypeOptions = useMemo(() => (
    equipmentTypes.filter((item) => makeDetailTypeIds.includes(item.id))
  ), [equipmentTypes, makeDetailTypeIds]);

  const getMakeModelCount = (makeRecord) => (
    equipment.filter((item) => (
      item.makeId === makeRecord.id
      || (!item.makeId && item.make === makeRecord.name)
    )).length
  );

  const openMakeDetail = (makeRecord) => {
    const typeIds = Array.isArray(makeRecord.types) ? makeRecord.types : [];
    setSelectedMakeRecord(makeRecord);
    setMakeDetailTypeIds(typeIds);
    setMakeDetailMessage('');
    setMakeDetailError('');
    setNewModelForm({
      typeId: typeIds[0] || '',
      model: '',
      name: '',
      manualPdfLink: '',
    });
    setView('makeDetail');
  };

  const toggleMakeType = (typeIdToToggle) => {
    setMakeDetailTypeIds((current) => (
      current.includes(typeIdToToggle)
        ? current.filter((item) => item !== typeIdToToggle)
        : [...current, typeIdToToggle]
    ));
  };

  const persistMakeTypes = async (typeIdsToSave = makeDetailTypeIds) => {
    if (!selectedMakeRecord?.id) return null;

    const uniqueTypeIds = [...new Set(typeIdsToSave)].filter(Boolean);
    await updateDoc(doc(db, 'universal', 'equipment', 'equipmentMakes', selectedMakeRecord.id), {
      types: uniqueTypeIds,
      updatedAt: serverTimestamp(),
    });

    const updatedMake = { ...selectedMakeRecord, types: uniqueTypeIds };
    setSelectedMakeRecord(updatedMake);
    setAllEquipmentMakes((current) => (
      sortByField(current.map((item) => (item.id === updatedMake.id ? updatedMake : item)))
    ));
    setEquipmentMakes((current) => (
      sortByField(current.map((item) => (item.id === updatedMake.id ? updatedMake : item)))
    ));

    return updatedMake;
  };

  const saveMakeTypes = async () => {
    setMakeDetailSaving(true);
    setMakeDetailError('');
    setMakeDetailMessage('');

    try {
      await persistMakeTypes();
      setMakeDetailMessage('Make type assignments saved.');
    } catch (error) {
      console.error('Error updating universal equipment make:', error);
      setMakeDetailError(getPermissionMessage(error, 'update this make'));
    } finally {
      setMakeDetailSaving(false);
    }
  };

  const updateNewModelForm = (field, value) => {
    setNewModelForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const createModelForMake = async (event) => {
    event.preventDefault();
    if (!selectedMakeRecord?.id) return;

    const selectedType = equipmentTypes.find((item) => item.id === newModelForm.typeId);
    const modelName = newModelForm.model.trim();
    const displayName = newModelForm.name.trim() || [selectedMakeRecord.name, modelName].filter(Boolean).join(' ');

    if (!selectedType || !modelName) {
      setMakeDetailError('Choose a type and enter a model name before adding a model.');
      return;
    }

    setNewModelSaving(true);
    setMakeDetailError('');
    setMakeDetailMessage('');

    try {
      const nextTypeIds = makeDetailTypeIds.includes(selectedType.id)
        ? makeDetailTypeIds
        : [...makeDetailTypeIds, selectedType.id];
      const savedTypeIds = Array.isArray(selectedMakeRecord.types) ? selectedMakeRecord.types : [];

      if (!arraysHaveSameValues(savedTypeIds, nextTypeIds)) {
        await persistMakeTypes(nextTypeIds);
      }

      const equipmentId = 'unv_equ_' + uuidv4();
      await setDoc(doc(db, 'universal', 'equipment', 'equipment', equipmentId), {
        id: equipmentId,
        name: displayName,
        type: selectedType.name || '',
        typeId: selectedType.id,
        make: selectedMakeRecord.name || '',
        makeId: selectedMakeRecord.id,
        model: modelName,
        modelId: equipmentId,
        manualPdfLink: newModelForm.manualPdfLink.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await fetchEquipmentCatalog();
      setNewModelForm({
        typeId: selectedType.id,
        model: '',
        name: '',
        manualPdfLink: '',
      });
      setMakeDetailMessage('Model added to this make.');
    } catch (error) {
      console.error('Error creating universal equipment model:', error);
      setMakeDetailError(getPermissionMessage(error, 'add a model to this make'));
    } finally {
      setNewModelSaving(false);
    }
  };

  const handleUpdateSuggestionStatus = async (suggestionId, status) => {
    setSuggestionsError('');

    try {
      await updateDoc(doc(db, 'universalEquipmentSuggestions', suggestionId), {
        status,
        reviewedAt: serverTimestamp(),
      });

      fetchEquipmentSuggestions();
    } catch (error) {
      console.error('Error updating potential equipment status:', error);
      setSuggestionsError(getPermissionMessage(error, 'update this potential equipment item'));
    }
  };

  const visibleEquipmentSuggestions = equipmentSuggestions.filter((suggestion) => (
    !suggestionStatusFilter || suggestion.status === suggestionStatusFilter
  ));

  const renderListView = () => (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="font-extrabold text-xl tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Universal Equipment
          </h1>
          <p className="text-sm text-slate-400">Manage types, makes, and equipment records</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <input
            type="text"
            placeholder="Search name, make, model..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={inputClass}
          />

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className={selectClass + ' sm:w-[220px]'}
          >
            <option value="">All Types</option>
            {equipmentTypes.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
          <button onClick={() => handleOpenAddModal('type')} className={btnAccentOutline}>
            Add Type
          </button>

          <button onClick={() => handleOpenAddModal('make')} className={btnAccentOutline}>
            Add Make
          </button>

          <button onClick={() => setView('makes')} className={btnAccentOutline}>
            Manage Makes
          </button>

          <button onClick={() => setView('suggestions')} className={btnAccentOutline}>
            Potential New Equipment
          </button>

          <button onClick={handleCreateNew} className={btnAccentOutline}>
            Create New
          </button>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-slate-800/60">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70">
            <tr className="text-slate-200">
              <th
                className="px-4 py-3 text-left font-bold cursor-pointer select-none"
                onClick={() => handleSort('name')}
                style={{ color: sortField === 'name' ? ADMIN_YELLOW : undefined }}
              >
                Name
              </th>
              <th
                className="px-4 py-3 text-left font-bold cursor-pointer select-none"
                onClick={() => handleSort('type')}
                style={{ color: sortField === 'type' ? ADMIN_YELLOW : undefined }}
              >
                Type
              </th>
              <th
                className="px-4 py-3 text-left font-bold cursor-pointer select-none"
                onClick={() => handleSort('make')}
                style={{ color: sortField === 'make' ? ADMIN_YELLOW : undefined }}
              >
                Make
              </th>
              <th
                className="px-4 py-3 text-left font-bold cursor-pointer select-none"
                onClick={() => handleSort('model')}
                style={{ color: sortField === 'model' ? ADMIN_YELLOW : undefined }}
              >
                Model
              </th>
              <th className="px-4 py-3 text-left font-bold">Manual</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/60">
            {filteredEquipment.map((item) => (
              <tr
                key={item.id}
                onClick={() => handleSelectEquipment(item.id)}
                className="cursor-pointer hover:bg-slate-900/60 transition"
              >
                <td className="px-4 py-3 text-slate-100">{item.name}</td>
                <td className="px-4 py-3 text-slate-200">{item.type}</td>
                <td className="px-4 py-3 text-slate-200">{item.make}</td>
                <td className="px-4 py-3 text-slate-300">{item.model}</td>
                <td className="px-4 py-3 text-slate-300">
                  {item.manualPdfLink ? 'Linked' : 'None'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderMakesView = () => (
    <div className={cardClass}>
      <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-extrabold text-xl tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Universal Makes
          </h1>
          <p className="text-sm text-slate-400">Manage manufacturer type coverage and model records</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleOpenAddModal('make')} className={btnAccentOutline}>
            Add Make
          </button>
          <button onClick={() => setView('list')} className={btnSecondary}>
            Back to Catalog
          </button>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-slate-800/60">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70">
            <tr className="text-slate-200">
              <th className="px-4 py-3 text-left font-bold">Make</th>
              <th className="px-4 py-3 text-left font-bold">Types</th>
              <th className="px-4 py-3 text-left font-bold">Models</th>
              <th className="px-4 py-3 text-left font-bold">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/60">
            {allEquipmentMakes.map((makeRecord) => (
              <tr key={makeRecord.id} className="align-top hover:bg-slate-900/60 transition">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-100">{makeRecord.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{makeRecord.id}</p>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {getMakeTypeLabels(Array.isArray(makeRecord.types) ? makeRecord.types : [])}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {getMakeModelCount(makeRecord)}
                </td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => openMakeDetail(makeRecord)} className={btnPrimary}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {allEquipmentMakes.length === 0 && (
        <div className="mt-4 rounded-lg border border-slate-800/60 p-6 text-sm text-slate-400">
          No makes found.
        </div>
      )}
    </div>
  );

  const renderMakeDetailView = () => (
    <div className={cardClass}>
      <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-extrabold text-xl tracking-tight" style={{ color: ADMIN_YELLOW }}>
            {selectedMakeRecord?.name || 'Make'}
          </h1>
          <p className="text-sm text-slate-400">{selectedMakeRecord?.id || 'No make selected'}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setView('makes')} className={btnSecondary}>
            Back to Makes
          </button>
          <button onClick={() => setView('list')} className={btnSecondary}>
            Back to Catalog
          </button>
        </div>
      </div>

      {makeDetailError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {makeDetailError}
        </div>
      )}

      {makeDetailMessage && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          {makeDetailMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-lg border border-slate-800/60 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-200">Assigned Types</h2>
              <p className="text-xs text-slate-500">These types control where this make appears in company equipment pickers.</p>
            </div>
            <button
              type="button"
              onClick={saveMakeTypes}
              disabled={makeDetailSaving}
              className={btnPrimary + (makeDetailSaving ? ' opacity-60' : '')}
            >
              {makeDetailSaving ? 'Saving...' : 'Save Types'}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {equipmentTypes.map((typeRecord) => (
              <label
                key={typeRecord.id}
                className="flex min-h-[44px] items-center gap-3 rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={makeDetailTypeIds.includes(typeRecord.id)}
                  onChange={() => toggleMakeType(typeRecord.id)}
                  className="h-4 w-4 accent-[#efb12f]"
                />
                <span>{typeRecord.name}</span>
              </label>
            ))}
          </div>
        </div>

        <form onSubmit={createModelForMake} className="rounded-lg border border-slate-800/60 p-4">
          <h2 className="text-sm font-bold text-slate-200">Add Model</h2>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-semibold text-slate-300">Type</label>
              <select
                value={newModelForm.typeId}
                onChange={(event) => updateNewModelForm('typeId', event.target.value)}
                className={selectClass + ' mt-1'}
                disabled={selectedMakeTypeOptions.length === 0}
                required
              >
                <option value="">{selectedMakeTypeOptions.length ? 'Select a type' : 'Assign a type first'}</option>
                {selectedMakeTypeOptions.map((typeRecord) => (
                  <option key={typeRecord.id} value={typeRecord.id}>
                    {typeRecord.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-300">Model</label>
              <input
                type="text"
                value={newModelForm.model}
                onChange={(event) => updateNewModelForm('model', event.target.value)}
                className={inputClass + ' mt-1'}
                placeholder="Model or product family"
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-300">Display Name</label>
              <input
                type="text"
                value={newModelForm.name}
                onChange={(event) => updateNewModelForm('name', event.target.value)}
                className={inputClass + ' mt-1'}
                placeholder={`${selectedMakeRecord?.name || 'Make'} model name`}
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-300">Manual PDF Link</label>
              <input
                type="text"
                value={newModelForm.manualPdfLink}
                onChange={(event) => updateNewModelForm('manualPdfLink', event.target.value)}
                className={inputClass + ' mt-1'}
                placeholder="https://..."
              />
            </div>

            <button
              type="submit"
              disabled={newModelSaving || selectedMakeTypeOptions.length === 0}
              className={btnPrimary + ((newModelSaving || selectedMakeTypeOptions.length === 0) ? ' opacity-60' : '')}
            >
              {newModelSaving ? 'Adding...' : 'Add Model'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-4 rounded-lg border border-slate-800/60 overflow-hidden">
        <div className="px-4 py-3 bg-slate-900/70 text-sm font-bold text-slate-200">
          Models
        </div>

        {selectedMakeModels.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No models found for this make.</div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/50">
                <tr className="text-slate-200">
                  <th className="px-4 py-3 text-left font-bold">Model</th>
                  <th className="px-4 py-3 text-left font-bold">Name</th>
                  <th className="px-4 py-3 text-left font-bold">Type</th>
                  <th className="px-4 py-3 text-left font-bold">Manual</th>
                  <th className="px-4 py-3 text-left font-bold">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60">
                {selectedMakeModels.map((modelRecord) => (
                  <tr key={modelRecord.id} className="align-top">
                    <td className="px-4 py-3 text-slate-100">{modelRecord.model || 'No model'}</td>
                    <td className="px-4 py-3 text-slate-300">{modelRecord.name || 'No display name'}</td>
                    <td className="px-4 py-3 text-slate-300">{modelRecord.type || getTypeName(modelRecord.typeId) || 'No type'}</td>
                    <td className="px-4 py-3 text-slate-300">{modelRecord.manualPdfLink ? 'Linked' : 'None'}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => handleSelectEquipment(modelRecord.id)} className={btnSecondary}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderSuggestionsView = () => (
    <div className={cardClass}>
      <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-extrabold text-xl tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Potential New Equipment
          </h1>
          <p className="text-sm text-slate-400">Custom make and model submissions from company equipment creation</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={suggestionStatusFilter}
            onChange={(e) => setSuggestionStatusFilter(e.target.value)}
            className={selectClass + ' w-[180px]'}
          >
            <option value="">All Statuses</option>
            <option value="New">New</option>
            <option value="Reviewed">Reviewed</option>
            <option value="Reconciled">Reconciled</option>
            <option value="Dismissed">Dismissed</option>
          </select>

          <button onClick={fetchEquipmentSuggestions} className={btnSecondary}>
            Refresh
          </button>

          <button onClick={() => setView('list')} className={btnSecondary}>
            Back to Catalog
          </button>
        </div>
      </div>

      {suggestionsError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-100">
          {suggestionsError}
        </div>
      ) : suggestionsLoading ? (
        <div className="rounded-lg border border-slate-800/60 p-6 text-sm text-slate-400">
          Loading potential equipment...
        </div>
      ) : visibleEquipmentSuggestions.length === 0 ? (
        <div className="rounded-lg border border-slate-800/60 p-6 text-sm text-slate-400">
          No potential equipment found.
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr className="text-slate-200">
                <th className="px-4 py-3 text-left font-bold">Submitted</th>
                <th className="px-4 py-3 text-left font-bold">Equipment</th>
                <th className="px-4 py-3 text-left font-bold">Catalog Values</th>
                <th className="px-4 py-3 text-left font-bold">Company</th>
                <th className="px-4 py-3 text-left font-bold">Status</th>
                <th className="px-4 py-3 text-left font-bold">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {visibleEquipmentSuggestions.map((suggestion) => (
                <tr key={suggestion.id} className="align-top">
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                    {formatDateTime(suggestion.createdAt || suggestion.createdAtMillis)}
                  </td>
                  <td className="px-4 py-3 text-slate-200">
                    <p className="font-semibold text-slate-100">{suggestion.equipmentName || 'Equipment'}</p>
                    <p className="mt-1 text-xs text-slate-500">{suggestion.equipmentId || 'No equipment id'}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {suggestion.customCategoryRequested && (
                        <span className="rounded-full px-2 py-0.5 text-xs bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30">Custom category</span>
                      )}
                      {suggestion.customMakeRequested && (
                        <span className="rounded-full px-2 py-0.5 text-xs bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30">Custom make</span>
                      )}
                      {suggestion.customModelRequested && (
                        <span className="rounded-full px-2 py-0.5 text-xs bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30">Custom model</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    <p><span className="text-slate-500">Type:</span> {suggestion.type || 'None'}</p>
                    <p><span className="text-slate-500">Make:</span> {suggestion.make || 'None'}</p>
                    <p><span className="text-slate-500">Model:</span> {suggestion.model || 'None'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    <p>{suggestion.companyName || suggestion.companyId || 'Company'}</p>
                    <p className="mt-1 text-xs text-slate-500">{suggestion.customerName || 'No customer name'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${suggestionStatusClass(suggestion.status)}`}>
                      {suggestion.status || 'New'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      {suggestion.status !== 'Reviewed' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'Reviewed')}
                          className={btnPrimary}
                        >
                          Mark Reviewed
                        </button>
                      )}
                      {suggestion.status !== 'Dismissed' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'Dismissed')}
                          className={btnSecondary}
                        >
                          Dismiss
                        </button>
                      )}
                      {suggestion.status !== 'New' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'New')}
                          className={btnAccentOutline}
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderDetailView = () => (
    <div className={cardClass}>
      <button onClick={() => setView('list')} className={btnSecondary + ' mb-4'}>
        Back to List
      </button>

      <h1 className="font-extrabold text-xl tracking-tight mb-4" style={{ color: ADMIN_YELLOW }}>
        {selectedEquipment?.name}
      </h1>

      {detailError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {detailError}
        </div>
      )}

      <div className="space-y-2 text-sm">
        <p className="text-slate-200">
          <span className="text-slate-400 font-semibold">Type:</span> {selectedEquipment?.type}
        </p>
        <p className="text-slate-200">
          <span className="text-slate-400 font-semibold">Make:</span> {selectedEquipment?.make}
        </p>
        <p className="text-slate-200">
          <span className="text-slate-400 font-semibold">Model:</span> {selectedEquipment?.model}
        </p>
        <p className="text-slate-200">
          <span className="text-slate-400 font-semibold">Parts:</span>{' '}
          {selectedEquipment?.parts?.length || 0}
        </p>
        <p className="text-slate-200">
          <span className="text-slate-400 font-semibold">Manual:</span>{' '}
          {selectedEquipment?.manualPdfLink ? (
            <a
              href={selectedEquipment.manualPdfLink}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
              style={{ color: ADMIN_YELLOW }}
            >
              View Manual
            </a>
          ) : (
            <span className="text-slate-500">None</span>
          )}
        </p>
      </div>

      {!!selectedEquipment?.parts?.length && (
        <div className="mt-5 rounded-lg border border-slate-800/60 overflow-hidden">
          <div className="px-4 py-3 bg-slate-900/70 text-sm font-bold text-slate-200">
            Catalog Parts
          </div>
          <div className="divide-y divide-slate-800/60">
            {selectedEquipment.parts.map((part) => (
              <div key={part.id} className="px-4 py-3 text-sm text-slate-200">
                <p className="font-semibold">{part.name || 'Part'}</p>
                <p className="text-slate-400">
                  {part.sku ? `SKU: ${part.sku}` : 'No SKU'}
                  {part.manualPdfLink ? ' • Manual linked' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button onClick={handleEdit} className={btnPrimary}>
          Edit
        </button>

        <button onClick={() => setShowConfirm(true)} className={btnDangerOutline}>
          Delete
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="w-[92%] max-w-md bg-slate-950 p-5 rounded-xl border border-slate-800/60 text-slate-100 shadow-2xl">
            <p className="font-bold text-lg" style={{ color: ADMIN_YELLOW }}>
              Confirm delete
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Are you sure you want to delete this equipment?
            </p>

            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowConfirm(false)} className={btnSecondary}>
                Cancel
              </button>

              <button onClick={handleDelete} className={btnDangerSolid}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderCreateEditView = () => (
    <div className={cardClass}>
      <h1 className="font-extrabold text-xl tracking-tight mb-4" style={{ color: ADMIN_YELLOW }}>
        {view === 'edit' ? 'Edit' : 'Create New'} Universal Equipment
      </h1>

      <form onSubmit={handleFormSubmit}>
        {formError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-semibold text-slate-300">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass + ' mt-1'}
              required
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-300">Type</label>
            <select value={type} onChange={(e) => handleTypeChange(e.target.value)} className={selectClass + ' mt-1'}>
              <option value="">Select a Type</option>
              {equipmentTypes.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-300">Make</label>
            <select value={make} onChange={(e) => handleMakeChange(e.target.value)} className={selectClass + ' mt-1'}>
              <option value="">Select a Make</option>
              {equipmentMakes.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-300">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputClass + ' mt-1'}
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-semibold text-slate-300">Manual PDF Link</label>
            <input
              type="text"
              value={manualPdfLink}
              onChange={(e) => setManualPdfLink(e.target.value)}
              className={inputClass + ' mt-1'}
            />
          </div>

          <div className="md:col-span-2 rounded-lg border border-slate-800/60 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-bold text-slate-200">Catalog Parts</p>
                <p className="text-xs text-slate-500">Parts are copied to company equipment when this catalog item is selected.</p>
              </div>
              <button type="button" onClick={addPartRow} className={btnAccentOutline}>
                Add Part
              </button>
            </div>

            <div className="space-y-3">
              {parts.map((part) => (
                <div key={part.id} className="grid grid-cols-1 lg:grid-cols-[1fr_180px_1fr_auto] gap-3">
                  <input
                    type="text"
                    value={part.name || ''}
                    onChange={(e) => updatePart(part.id, 'name', e.target.value)}
                    className={inputClass}
                    placeholder="Part name"
                  />
                  <input
                    type="text"
                    value={part.sku || ''}
                    onChange={(e) => updatePart(part.id, 'sku', e.target.value)}
                    className={inputClass}
                    placeholder="SKU"
                  />
                  <input
                    type="text"
                    value={part.manualPdfLink || ''}
                    onChange={(e) => updatePart(part.id, 'manualPdfLink', e.target.value)}
                    className={inputClass}
                    placeholder="Part manual link"
                  />
                  <button type="button" onClick={() => removePart(part.id)} className={btnDangerOutline}>
                    Remove
                  </button>
                </div>
              ))}

              {parts.length === 0 && (
                <p className="text-sm text-slate-500">No parts added yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="submit" className={btnPrimary}>
            {view === 'edit' ? 'Update' : 'Create'} Equipment
          </button>

          <button type="button" onClick={() => setView('list')} className={btnSecondary}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );

  const renderAddTypeMakeModal = () => (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="w-[92%] max-w-md bg-slate-950 p-5 rounded-xl border border-slate-800/60 text-slate-100 shadow-2xl">
        <h2 className="text-lg font-extrabold mb-4" style={{ color: ADMIN_YELLOW }}>
          Add New {modalType === 'type' ? 'Type' : 'Make'}
        </h2>

        <input
          type="text"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          className={inputClass}
          placeholder={`Enter new ${modalType} name`}
        />

        {modalError && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            {modalError}
          </div>
        )}

        {modalType === 'make' && (
          <div className="mt-4 rounded-lg border border-slate-800/60 p-3">
            <p className="mb-3 text-sm font-bold text-slate-200">Assign Types</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {equipmentTypes.map((typeRecord) => (
                <label key={typeRecord.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={newMakeTypeIds.includes(typeRecord.id)}
                    onChange={() => setNewMakeTypeIds((current) => (
                      current.includes(typeRecord.id)
                        ? current.filter((item) => item !== typeRecord.id)
                        : [...current, typeRecord.id]
                    ))}
                    className="h-4 w-4 accent-[#efb12f]"
                  />
                  <span>{typeRecord.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setShowAddModal(false)} className={btnSecondary}>
            Cancel
          </button>

          <button onClick={handleAddNewItem} className={btnPrimary}>
            Add
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="px-2 md:px-7 py-5 bg-slate-900 min-h-screen">
      {view === 'list' && renderListView()}
      {view === 'makes' && renderMakesView()}
      {view === 'makeDetail' && renderMakeDetailView()}
      {view === 'suggestions' && renderSuggestionsView()}
      {view === 'detail' && renderDetailView()}
      {(view === 'create' || view === 'edit') && renderCreateEditView()}
      {showAddModal && renderAddTypeMakeModal()}
    </div>
  );
};

export default UniversalEquipment;
