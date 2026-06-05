import React, { useState, useEffect } from 'react';
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
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

const UniversalEquipment = () => {
  const [view, setView] = useState('list'); // list, detail, create, edit
  const [equipment, setEquipment] = useState([]);
  const [filteredEquipment, setFilteredEquipment] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalType, setModalType] = useState(''); // 'type' or 'make'
  const [newItemName, setNewItemName] = useState('');

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
  const ADMIN_YELLOW = '#debf44';

  const cardClass =
    'w-full bg-slate-950 p-4 rounded-xl text-slate-100 border border-slate-800/60 shadow-2xl';
  const inputClass =
    `w-full px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 ` +
    `placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[${ADMIN_YELLOW}]/30`;
  const selectClass =
    `w-full px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 ` +
    `focus:outline-none focus:ring-2 focus:ring-[${ADMIN_YELLOW}]/30`;

  const btnPrimary =
    `px-4 py-2 rounded-md font-semibold bg-[${ADMIN_YELLOW}] text-slate-950 hover:bg-[${ADMIN_YELLOW}]/90 transition`;
  const btnSecondary =
    'px-4 py-2 rounded-md font-semibold bg-slate-900/70 text-slate-200 border border-slate-800/60 hover:bg-slate-900 transition';
  const btnAccentOutline =
    `px-4 py-2 rounded-md font-semibold bg-[${ADMIN_YELLOW}]/10 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/30 hover:bg-[${ADMIN_YELLOW}]/15 transition`;
  const btnDangerOutline =
    'px-4 py-2 rounded-md font-semibold bg-red-500/15 text-red-200 ring-1 ring-red-500/30 hover:bg-red-500/20 transition';
  const btnDangerSolid =
    'px-4 py-2 rounded-md font-semibold bg-red-500 text-white hover:bg-red-400 transition';

  const fetchEquipmentTypes = async () => {
    const q = query(collection(db, 'universal', 'equipment', 'equipmentTypes'));
    const querySnapshot = await getDocs(q);
    const typesList = querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() }));
    setEquipmentTypes(typesList);
  };

  const fetchEquipmentMakes = async () => {
    if (type) {
      const selectedType = equipmentTypes.find((t) => t.name === type);
      if (selectedType) {
        setTypeId(selectedType.id);
        const q = query(
          collection(db, 'universal', 'equipment', 'equipmentMakes'),
          where('types', 'array-contains', selectedType.id)
        );
        const querySnapshot = await getDocs(q);
        const makesList = querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() }));
        setEquipmentMakes(makesList);
      }
    } else {
      setEquipmentMakes([]);
      setMake('');
      setMakeId('');
    }
  };

  useEffect(() => {
    fetchEquipmentTypes();
  }, []);

  useEffect(() => {
    if (view === 'list') {
      const fetchEquipment = async () => {
        const q = query(
          collection(db, 'universal', 'equipment', 'equipment'),
          orderBy(sortField, sortDirection)
        );
        const querySnapshot = await getDocs(q);
        const equipmentList = querySnapshot.docs.map((docu) => ({ id: docu.id, ...docu.data() }));
        setEquipment(equipmentList);
        setFilteredEquipment(equipmentList);
      };
      fetchEquipment();
    }
  }, [view, sortField, sortDirection]);

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
  }, [type, equipmentTypes]);

  const handleSort = (field) => {
    const order = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortField(field);
    setSortDirection(order);
  };

  const handleCreateNew = () => {
    resetForm();
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
    await deleteDoc(doc(db, 'universal', 'equipment', 'equipment', selectedEquipment.id));
    setView('list');
    setShowConfirm(false);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

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

    if (view === 'edit') {
      const docRef = doc(db, 'universal', 'equipment', 'equipment', selectedEquipment.id);
      await updateDoc(docRef, equipmentData);
    } else {
      await setDoc(doc(collection(db, 'universal', 'equipment', 'equipment'), equipmentId), equipmentData);
    }

    await saveUniversalParts(targetEquipmentId);
    setView('list');
    resetForm();
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
    setShowAddModal(true);
  };

  const handleAddNewItem = async () => {
    if (!newItemName) return;

    const collectionName = modalType === 'type' ? 'equipmentTypes' : 'equipmentMakes';
    const id = 'unv_equ_' + uuidv4();
    const selectedType = equipmentTypes.find((item) => item.name === type);

    await setDoc(doc(collection(db, 'universal', 'equipment', collectionName), id), {
      id,
      name: newItemName,
      description: '',
      ...(modalType === 'make' ? { types: selectedType?.id ? [selectedType.id] : [] } : {}),
    });

    setNewItemName('');
    setShowAddModal(false);

    if (modalType === 'type') {
      fetchEquipmentTypes();
    } else {
      fetchEquipmentMakes();
    }
  };

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

  const renderDetailView = () => (
    <div className={cardClass}>
      <button onClick={() => setView('list')} className={btnSecondary + ' mb-4'}>
        Back to List
      </button>

      <h1 className="font-extrabold text-xl tracking-tight mb-4" style={{ color: ADMIN_YELLOW }}>
        {selectedEquipment?.name}
      </h1>

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
      {view === 'detail' && renderDetailView()}
      {(view === 'create' || view === 'edit') && renderCreateEditView()}
      {showAddModal && renderAddTypeMakeModal()}
    </div>
  );
};

export default UniversalEquipment;
