import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../utils/config';

const CUSTOM_VALUE = '__custom__';

const baseInputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const baseLabelClass = 'block text-xs font-semibold uppercase text-gray-500 mb-1';

const textValue = (value) => String(value || '').trim();

const sortedByName = (items = [], field = 'name') => (
    [...items].sort((a, b) => textValue(a[field]).localeCompare(textValue(b[field])))
);

const getTypeName = (equipment = {}) => equipment.type || equipment.category || '';
const getCatalogModelId = (equipment = {}) => equipment.modelId || equipment.universalEquipmentId || '';

const EquipmentCatalogPicker = ({
    value = {},
    onChange,
    onModelSelected,
    inputClassName = baseInputClass,
    labelClassName = baseLabelClass,
    gridClassName = 'grid grid-cols-1 gap-4 md:grid-cols-3',
    labels = { type: 'Category', make: 'Make', model: 'Model' },
}) => {
    const [types, setTypes] = useState([]);
    const [makes, setMakes] = useState([]);
    const [models, setModels] = useState([]);
    const [loadingTypes, setLoadingTypes] = useState(false);
    const [loadingMakes, setLoadingMakes] = useState(false);
    const [loadingModels, setLoadingModels] = useState(false);
    const [customTypeActive, setCustomTypeActive] = useState(false);
    const [customMakeActive, setCustomMakeActive] = useState(false);
    const [customModelActive, setCustomModelActive] = useState(false);

    const valueTypeName = getTypeName(value);
    const valueTypeId = value.typeId || '';
    const valueMake = value.make || '';
    const valueMakeId = value.makeId || '';
    const valueModel = value.model || '';
    const valueModelId = getCatalogModelId(value);

    const typeSelectValue = valueTypeId ? valueTypeId : ((customTypeActive || valueTypeName) ? CUSTOM_VALUE : '');
    const makeSelectValue = valueMakeId ? valueMakeId : ((customMakeActive || valueMake) ? CUSTOM_VALUE : '');
    const modelSelectValue = valueModelId ? valueModelId : ((customModelActive || valueModel) ? CUSTOM_VALUE : '');

    const emit = (patch) => {
        onChange?.({
            ...value,
            ...patch,
        });
    };

    useEffect(() => {
        let cancelled = false;

        const loadTypes = async () => {
            setLoadingTypes(true);
            try {
                const snap = await getDocs(collection(db, 'universal', 'equipment', 'equipmentTypes'));
                if (!cancelled) {
                    setTypes(sortedByName(snap.docs.map(typeDoc => ({ id: typeDoc.id, ...typeDoc.data() }))));
                }
            } catch (error) {
                console.warn('Unable to load equipment catalog types.', error);
                if (!cancelled) setTypes([]);
            } finally {
                if (!cancelled) setLoadingTypes(false);
            }
        };

        loadTypes();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!valueTypeId && valueTypeName) setCustomTypeActive(true);
        if (valueTypeId) setCustomTypeActive(false);
    }, [valueTypeId, valueTypeName]);

    useEffect(() => {
        if (!valueMakeId && valueMake) setCustomMakeActive(true);
        if (valueMakeId) setCustomMakeActive(false);
    }, [valueMakeId, valueMake]);

    useEffect(() => {
        if (!valueModelId && valueModel) setCustomModelActive(true);
        if (valueModelId) setCustomModelActive(false);
    }, [valueModelId, valueModel]);

    useEffect(() => {
        let cancelled = false;

        const loadMakes = async () => {
            if (!valueTypeId) {
                setMakes([]);
                return;
            }

            setLoadingMakes(true);
            try {
                const snap = await getDocs(
                    query(
                        collection(db, 'universal', 'equipment', 'equipmentMakes'),
                        where('types', 'array-contains', valueTypeId)
                    )
                );
                if (!cancelled) {
                    setMakes(sortedByName(snap.docs.map(makeDoc => ({ id: makeDoc.id, ...makeDoc.data() }))));
                }
            } catch (error) {
                console.warn('Unable to load equipment catalog makes.', error);
                if (!cancelled) setMakes([]);
            } finally {
                if (!cancelled) setLoadingMakes(false);
            }
        };

        loadMakes();

        return () => {
            cancelled = true;
        };
    }, [valueTypeId]);

    useEffect(() => {
        let cancelled = false;

        const loadModels = async () => {
            if (!valueTypeId || !valueMakeId) {
                setModels([]);
                return;
            }

            setLoadingModels(true);
            try {
                const snap = await getDocs(
                    query(
                        collection(db, 'universal', 'equipment', 'equipment'),
                        where('typeId', '==', valueTypeId),
                        where('makeId', '==', valueMakeId)
                    )
                );
                if (!cancelled) {
                    setModels(sortedByName(
                        snap.docs.map(modelDoc => ({ id: modelDoc.id, ...modelDoc.data() })),
                        'model'
                    ));
                }
            } catch (error) {
                console.warn('Unable to load equipment catalog models.', error);
                if (!cancelled) setModels([]);
            } finally {
                if (!cancelled) setLoadingModels(false);
            }
        };

        loadModels();

        return () => {
            cancelled = true;
        };
    }, [valueTypeId, valueMakeId]);

    const selectedModel = useMemo(() => (
        models.find(model => model.id === valueModelId)
    ), [models, valueModelId]);

    const handleTypeChange = (event) => {
        const nextTypeId = event.target.value;

        if (!nextTypeId) {
            setCustomTypeActive(false);
            setCustomMakeActive(false);
            setCustomModelActive(false);
            emit({
                type: '',
                category: '',
                typeId: '',
                make: '',
                makeId: '',
                model: '',
                modelId: '',
                universalEquipmentId: '',
                manualPdfLink: '',
            });
            return;
        }

        if (nextTypeId === CUSTOM_VALUE) {
            setCustomTypeActive(true);
            setCustomMakeActive(false);
            setCustomModelActive(false);
            emit({
                type: '',
                category: '',
                typeId: '',
                make: '',
                makeId: '',
                model: '',
                modelId: '',
                universalEquipmentId: '',
                manualPdfLink: '',
            });
            return;
        }

        const selected = types.find(type => type.id === nextTypeId);
        setCustomTypeActive(false);
        setCustomMakeActive(false);
        setCustomModelActive(false);
        emit({
            type: selected?.name || '',
            category: selected?.name || '',
            typeId: selected?.id || '',
            make: '',
            makeId: '',
            model: '',
            modelId: '',
            universalEquipmentId: '',
            manualPdfLink: '',
        });
    };

    const handleMakeChange = (event) => {
        const nextMakeId = event.target.value;

        if (!nextMakeId) {
            setCustomMakeActive(false);
            setCustomModelActive(false);
            emit({
                make: '',
                makeId: '',
                model: '',
                modelId: '',
                universalEquipmentId: '',
                manualPdfLink: '',
            });
            return;
        }

        if (nextMakeId === CUSTOM_VALUE) {
            setCustomMakeActive(true);
            setCustomModelActive(false);
            emit({
                make: '',
                makeId: '',
                model: '',
                modelId: '',
                universalEquipmentId: '',
                manualPdfLink: '',
            });
            return;
        }

        const selected = makes.find(make => make.id === nextMakeId);
        setCustomMakeActive(false);
        setCustomModelActive(false);
        emit({
            make: selected?.name || '',
            makeId: selected?.id || '',
            model: '',
            modelId: '',
            universalEquipmentId: '',
            manualPdfLink: '',
        });
    };

    const handleModelChange = (event) => {
        const nextModelId = event.target.value;

        if (!nextModelId) {
            setCustomModelActive(false);
            emit({
                model: '',
                modelId: '',
                universalEquipmentId: '',
                manualPdfLink: '',
            });
            return;
        }

        if (nextModelId === CUSTOM_VALUE) {
            setCustomModelActive(true);
            emit({
                model: '',
                modelId: '',
                universalEquipmentId: '',
                manualPdfLink: '',
            });
            return;
        }

        const selected = models.find(model => model.id === nextModelId);
        setCustomModelActive(false);
        const modelName = selected?.model || selected?.name || '';
        const patch = {
            model: modelName,
            modelId: selected?.id || '',
            universalEquipmentId: selected?.id || '',
            manualPdfLink: selected?.manualPdfLink || '',
        };

        emit(patch);
        onModelSelected?.({ ...selected, model: modelName }, patch);
    };

    const handleCustomTypeChange = (event) => {
        emit({
            type: event.target.value,
            category: event.target.value,
            typeId: '',
        });
    };

    const handleCustomMakeChange = (event) => {
        emit({
            make: event.target.value,
            makeId: '',
        });
    };

    const handleCustomModelChange = (event) => {
        emit({
            model: event.target.value,
            modelId: '',
            universalEquipmentId: '',
            manualPdfLink: '',
        });
    };

    return (
        <div className="space-y-3">
            <div className={gridClassName}>
                <div>
                    <label className={labelClassName}>{labels.type || 'Category'}</label>
                    <select value={typeSelectValue} onChange={handleTypeChange} className={inputClassName}>
                        <option value="">{loadingTypes ? 'Loading categories...' : 'Select category'}</option>
                        {types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                        <option value={CUSTOM_VALUE}>Custom category</option>
                    </select>
                </div>

                <div>
                    <label className={labelClassName}>{labels.make || 'Make'}</label>
                    <select value={makeSelectValue} onChange={handleMakeChange} className={inputClassName} disabled={!typeSelectValue}>
                        <option value="">{loadingMakes ? 'Loading makes...' : 'Select make'}</option>
                        {makes.map(make => <option key={make.id} value={make.id}>{make.name}</option>)}
                        <option value={CUSTOM_VALUE}>Custom make</option>
                    </select>
                </div>

                <div>
                    <label className={labelClassName}>{labels.model || 'Model'}</label>
                    <select value={modelSelectValue} onChange={handleModelChange} className={inputClassName} disabled={!makeSelectValue}>
                        <option value="">{loadingModels ? 'Loading models...' : 'Select model'}</option>
                        {models.map(model => (
                            <option key={model.id} value={model.id}>
                                {model.model || model.name || 'Equipment model'}
                            </option>
                        ))}
                        <option value={CUSTOM_VALUE}>Custom model</option>
                    </select>
                </div>
            </div>

            {(typeSelectValue === CUSTOM_VALUE || makeSelectValue === CUSTOM_VALUE || modelSelectValue === CUSTOM_VALUE) && (
                <div className={gridClassName}>
                    {typeSelectValue === CUSTOM_VALUE && (
                        <div>
                            <label className={labelClassName}>Custom category</label>
                            <input value={valueTypeName} onChange={handleCustomTypeChange} className={inputClassName} />
                        </div>
                    )}
                    {makeSelectValue === CUSTOM_VALUE && (
                        <div>
                            <label className={labelClassName}>Custom make</label>
                            <input value={valueMake} onChange={handleCustomMakeChange} className={inputClassName} />
                        </div>
                    )}
                    {modelSelectValue === CUSTOM_VALUE && (
                        <div>
                            <label className={labelClassName}>Custom model</label>
                            <input value={valueModel} onChange={handleCustomModelChange} className={inputClassName} />
                        </div>
                    )}
                </div>
            )}

            {selectedModel?.manualPdfLink && (
                <a
                    href={selectedModel.manualPdfLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm font-semibold text-blue-600 hover:text-blue-800"
                >
                    View catalog manual
                </a>
            )}
        </div>
    );
};

export default EquipmentCatalogPicker;
