import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Link, useSearchParams } from 'react-router-dom';
import { FaArrowLeft, FaExternalLinkAlt, FaPencilAlt, FaPlus, FaRegListAlt, FaSave, FaSearch, FaTimes, FaTrashAlt } from 'react-icons/fa';
import { db } from '../../../../utils/config';
import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { Context } from '../../../../context/AuthContext';
import { toast } from 'react-hot-toast';

const emptyReadingForm = {
    name: '',
    amount: '',
    UOM: '',
    chemType: '',
    linkedDosage: '',
    editable: true,
    order: 0,
    highWarning: '',
    lowWarning: '',
};

const emptyDosageForm = {
    name: '',
    amount: '',
    UOM: '',
    rate: '',
    linkedItemId: '',
    linkedItemIds: [],
    strength: '',
    editable: true,
    chemType: '',
    order: 0,
};

const collectionPathFor = (type) =>
    type === 'Readings' ? 'settings/readings/readings' : 'settings/dosages/dosages';

const templateIdKeyFor = (type) =>
    type === 'Readings' ? 'readingsTemplateId' : 'dosageTemplateId';

const formForType = (type) =>
    type === 'Readings' ? { ...emptyReadingForm } : { ...emptyDosageForm };

const normalizeNumber = (value, fallback = 0) => {
    if (value === '' || value === null || value === undefined) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const parseAmountList = (value) =>
    String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

const formatAmountList = (amounts) =>
    Array.isArray(amounts) ? amounts.filter(Boolean).join(', ') : '';

const sortAmountList = (amounts = []) => {
    const uniqueAmounts = Array.from(new Set(amounts.map((amount) => String(amount).trim()).filter(Boolean)));
    return uniqueAmounts.sort((first, second) => {
        const firstNumber = Number(first);
        const secondNumber = Number(second);
        const bothNumeric = Number.isFinite(firstNumber) && Number.isFinite(secondNumber);
        return bothNumeric ? firstNumber - secondNumber : first.localeCompare(second);
    });
};

const normalizeLinkedItemIds = (...values) =>
    Array.from(new Set(
        values.flatMap((value) => {
            if (Array.isArray(value)) return value;
            return String(value || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
        })
    ));

const isChemicalDatabaseItem = (item = {}) =>
    [item.category, item.subCategory, item.subcategory, item.type]
        .some((value) => String(value || '').trim().toLowerCase().includes('chemical'));

const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(normalizeNumber(amount));

const getDatabaseItemUnitCostCents = (item = {}) => {
    const centsValue = [item.rate, item.rateCents, item.unitCostCents, item.costCents]
        .map((value) => normalizeNumber(value, null))
        .find((value) => Number.isFinite(value) && value > 0);

    if (Number.isFinite(centsValue)) return centsValue;

    const dollarValue = [item.unitCost, item.cost]
        .map((value) => normalizeNumber(value, null))
        .find((value) => Number.isFinite(value) && value > 0);

    return Number.isFinite(dollarValue) ? Math.round(dollarValue * 100) : 0;
};

const sortTemplates = (templates = []) =>
    [...templates].sort((first, second) => {
        const firstOrder = normalizeNumber(first.order, 9999);
        const secondOrder = normalizeNumber(second.order, 9999);
        if (firstOrder !== secondOrder) return firstOrder - secondOrder;
        return String(first.name || '').localeCompare(String(second.name || ''));
    });

const formFromTemplate = (type, template = {}) => {
    if (type === 'Readings') {
        return {
            name: template.name || '',
            amount: formatAmountList(template.amount),
            UOM: template.UOM || '',
            chemType: template.chemType || '',
            linkedDosage: template.linkedDosage || '',
            editable: template.editable !== false,
            order: template.order ?? 0,
            highWarning: template.highWarning ?? '',
            lowWarning: template.lowWarning ?? '',
        };
    }

    return {
        name: template.name || '',
        amount: formatAmountList(template.amount),
        UOM: template.UOM || '',
        rate: template.rate || '',
        linkedItemId: template.linkedItemId || '',
        linkedItemIds: normalizeLinkedItemIds(template.linkedItemIds, template.linkedItemId, template.linkedItem),
        strength: template.strength ?? '',
        editable: template.editable !== false,
        chemType: template.chemType || '',
        order: template.order ?? 0,
    };
};

const payloadFromForm = (type, id, form) => {
    const basePayload = {
        id,
        [templateIdKeyFor(type)]: id,
        name: form.name.trim(),
        amount: sortAmountList(parseAmountList(form.amount)),
        UOM: form.UOM.trim(),
        chemType: form.chemType.trim() || form.name.trim(),
        editable: Boolean(form.editable),
        order: normalizeNumber(form.order),
    };

    if (type === 'Readings') {
        return {
            ...basePayload,
            linkedDosage: form.linkedDosage,
            highWarning: form.highWarning === '' ? null : normalizeNumber(form.highWarning),
            lowWarning: form.lowWarning === '' ? null : normalizeNumber(form.lowWarning),
        };
    }

    const linkedItemIds = normalizeLinkedItemIds(form.linkedItemIds, form.linkedItemId);

    return {
        ...basePayload,
        rate: String(form.rate || '').trim(),
        linkedItem: '',
        linkedItemId: linkedItemIds[0] || '',
        linkedItemIds,
        strength: normalizeNumber(form.strength),
    };
};

const payloadFromUniversalTemplate = (type, id, template, companyDosages = []) => {
    const universalTemplateId = template.id || template[templateIdKeyFor(type)] || '';
    const basePayload = {
        id,
        [templateIdKeyFor(type)]: universalTemplateId,
        name: template.name || '',
        amount: sortAmountList(template.amount || []),
        UOM: template.UOM || '',
        chemType: template.chemType || '',
        editable: template.editable !== false,
        order: normalizeNumber(template.order),
    };

    if (type === 'Readings') {
        const linkedCompanyDosage = companyDosages.find((dosage) =>
            [dosage.id, dosage.dosageTemplateId].includes(template.linkedDosage)
        );

        return {
            ...basePayload,
            linkedDosage: linkedCompanyDosage?.id || '',
            highWarning: template.highWarning ?? null,
            lowWarning: template.lowWarning ?? null,
        };
    }

    const linkedItemIds = normalizeLinkedItemIds(template.linkedItemIds, template.linkedItemId, template.linkedItem);

    return {
        ...basePayload,
        rate: String(template.rate || ''),
        linkedItem: '',
        linkedItemId: linkedItemIds[0] || '',
        linkedItemIds,
        strength: normalizeNumber(template.strength),
    };
};

const Button = ({ children, className = '', type = 'button', ...props }) => (
    <button
        type={type}
        className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
    >
        {children}
    </button>
);

const Field = ({ label, children, className = '' }) => (
    <label className={`block ${className}`}>
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">{label}</span>
        {children}
    </label>
);

const TextInput = (props) => (
    <input
        {...props}
        className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${props.className || ''}`}
    />
);

const SelectInput = (props) => (
    <select
        {...props}
        className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${props.className || ''}`}
    />
);

const ReadingsAndDosages = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const queryTab = tabParam === 'Dosages' || tabParam === 'Readings' ? tabParam : null;
    const queryTemplateId = searchParams.get('template') || '';

    const [activeTab, setActiveTab] = useState(queryTab || 'Readings');
    const [readings, setReadings] = useState([]);
    const [dosages, setDosages] = useState([]);
    const [databaseItems, setDatabaseItems] = useState([]);
    const [universalReadings, setUniversalReadings] = useState([]);
    const [universalDosages, setUniversalDosages] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState(null);
    const [mode, setMode] = useState('list');
    const [searchTerm, setSearchTerm] = useState('');
    const [databaseItemSearchTerm, setDatabaseItemSearchTerm] = useState('');
    const [databaseItemsLoaded, setDatabaseItemsLoaded] = useState(false);
    const [databaseItemsLoading, setDatabaseItemsLoading] = useState(false);
    const [databaseItemPickerOpen, setDatabaseItemPickerOpen] = useState(false);
    const [universalSearchTerm, setUniversalSearchTerm] = useState('');
    const [form, setForm] = useState(emptyReadingForm);
    const [amountInput, setAmountInput] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setReadings([]);
            setDosages([]);
            setDatabaseItems([]);
            setDatabaseItemsLoaded(false);
            setLoading(false);
            return undefined;
        }

        setLoading(true);
        const readingsRef = collection(db, 'companies', recentlySelectedCompany, 'settings', 'readings', 'readings');
        const dosagesRef = collection(db, 'companies', recentlySelectedCompany, 'settings', 'dosages', 'dosages');
        setDatabaseItems([]);
        setDatabaseItemsLoaded(false);

        const unsubscribeReadings = onSnapshot(
            readingsRef,
            (snapshot) => {
                setReadings(sortTemplates(snapshot.docs.map((readingDoc) => ({ id: readingDoc.id, ...readingDoc.data() }))));
                setLoading(false);
            },
            (error) => {
                console.error('Could not fetch readings:', error);
                toast.error('Could not fetch readings.');
                setLoading(false);
            }
        );

        const unsubscribeDosages = onSnapshot(
            dosagesRef,
            (snapshot) => {
                setDosages(sortTemplates(snapshot.docs.map((dosageDoc) => ({ id: dosageDoc.id, ...dosageDoc.data() }))));
            },
            (error) => {
                console.error('Could not fetch dosages:', error);
                toast.error('Could not fetch dosages.');
            }
        );

        return () => {
            unsubscribeReadings();
            unsubscribeDosages();
        };
    }, [recentlySelectedCompany]);

    useEffect(() => {
        const universalReadingsQuery = query(
            collection(db, 'universal', 'settings', 'readingTemplates'),
            orderBy('order', 'asc')
        );
        const universalDosagesQuery = query(
            collection(db, 'universal', 'settings', 'dosageTemplates'),
            orderBy('order', 'asc')
        );

        const unsubscribeUniversalReadings = onSnapshot(
            universalReadingsQuery,
            (snapshot) => {
                setUniversalReadings(sortTemplates(snapshot.docs.map((readingDoc) => ({ id: readingDoc.id, ...readingDoc.data() }))));
            },
            (error) => {
                console.error('Could not fetch universal readings:', error);
                toast.error('Could not fetch universal readings.');
            }
        );

        const unsubscribeUniversalDosages = onSnapshot(
            universalDosagesQuery,
            (snapshot) => {
                setUniversalDosages(sortTemplates(snapshot.docs.map((dosageDoc) => ({ id: dosageDoc.id, ...dosageDoc.data() }))));
            },
            (error) => {
                console.error('Could not fetch universal dosages:', error);
                toast.error('Could not fetch universal dosages.');
            }
        );

        return () => {
            unsubscribeUniversalReadings();
            unsubscribeUniversalDosages();
        };
    }, []);

    useEffect(() => {
        setMode('list');
        setSelectedTemplateId(null);
        setAmountInput('');
        setDatabaseItemSearchTerm('');
        setDatabaseItemPickerOpen(false);
        setUniversalSearchTerm('');
        setForm(formForType(activeTab));
    }, [activeTab]);

    const activeTemplates = activeTab === 'Readings' ? readings : dosages;
    const activeUniversalTemplates = activeTab === 'Readings' ? universalReadings : universalDosages;
    const selectedTemplate = activeTemplates.find((template) => template.id === selectedTemplateId) || null;
    const activeTemplateUniversalIds = useMemo(() => {
        return new Set(
            activeTemplates.flatMap((template) => [
                template.id,
                template[templateIdKeyFor(activeTab)],
            ]).filter(Boolean)
        );
    }, [activeTab, activeTemplates]);

    const filteredTemplates = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return activeTemplates;

        return activeTemplates.filter((template) =>
            [template.name, template.chemType, template.UOM, template.id, template[templateIdKeyFor(activeTab)]]
                .join(' ')
                .toLowerCase()
                .includes(term)
        );
    }, [activeTab, activeTemplates, searchTerm]);

    const availableUniversalTemplates = useMemo(() => {
        const term = universalSearchTerm.trim().toLowerCase();

        return activeUniversalTemplates.filter((template) => {
            const universalId = template.id || template[templateIdKeyFor(activeTab)];
            if (activeTemplateUniversalIds.has(universalId)) return false;
            if (!term) return true;

            return [template.name, template.chemType, template.UOM, template.id]
                .join(' ')
                .toLowerCase()
                .includes(term);
        });
    }, [activeTab, activeTemplateUniversalIds, activeUniversalTemplates, universalSearchTerm]);

    useEffect(() => {
        if (queryTab && queryTab !== activeTab) {
            setActiveTab(queryTab);
        }
    }, [activeTab, queryTab]);

    useEffect(() => {
        if (!queryTemplateId) return;

        const targetTemplate = activeTemplates.find((template) =>
            template.id === queryTemplateId || template[templateIdKeyFor(activeTab)] === queryTemplateId
        );

        if (!targetTemplate) return;
        if (selectedTemplateId === targetTemplate.id && mode === 'detail') return;

        setSelectedTemplateId(targetTemplate.id);
        setAmountInput('');
        setDatabaseItemSearchTerm('');
        setDatabaseItemPickerOpen(false);
        setForm(formFromTemplate(activeTab, targetTemplate));
        setMode('detail');
    }, [activeTab, activeTemplates, mode, queryTemplateId, selectedTemplateId]);

    const databaseItemById = useMemo(
        () => new Map(databaseItems.map((item) => [item.id, item])),
        [databaseItems]
    );

    const selectedLinkedItemIds = normalizeLinkedItemIds(form.linkedItemIds, form.linkedItemId);
    const selectedTemplateLinkedItemIds = useMemo(
        () => activeTab === 'Dosages' && selectedTemplate
            ? normalizeLinkedItemIds(selectedTemplate.linkedItemIds, selectedTemplate.linkedItemId, selectedTemplate.linkedItem)
            : [],
        [activeTab, selectedTemplate]
    );

    const chemicalDatabaseItems = useMemo(
        () => databaseItems.filter(isChemicalDatabaseItem),
        [databaseItems]
    );

    const filteredDatabaseItems = useMemo(() => {
        const term = databaseItemSearchTerm.trim().toLowerCase();
        if (!term) return chemicalDatabaseItems.slice(0, 80);

        return chemicalDatabaseItems.filter((item) =>
            [item.name, item.sku, item.category, item.subCategory, item.UOM, item.uom, item.size, item.id]
                .join(' ')
                .toLowerCase()
                .includes(term)
        ).slice(0, 80);
    }, [chemicalDatabaseItems, databaseItemSearchTerm]);

    const databaseItemLabel = (item = {}) =>
        [
            item.name || item.id || 'Database item',
            item.size ? `${item.size}` : '',
            item.UOM || item.uom || '',
            item.sku ? `SKU ${item.sku}` : '',
        ].filter(Boolean).join(' | ');

    const updateForm = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const updateLinkedItemIds = (nextIds) => {
        const normalizedIds = normalizeLinkedItemIds(nextIds);
        setForm((current) => ({
            ...current,
            linkedItemId: normalizedIds[0] || '',
            linkedItemIds: normalizedIds,
        }));
    };

    const toggleLinkedItemId = (itemId) => {
        const normalizedIds = normalizeLinkedItemIds(selectedLinkedItemIds);
        updateLinkedItemIds(
            normalizedIds.includes(itemId)
                ? normalizedIds.filter((id) => id !== itemId)
                : [...normalizedIds, itemId]
        );
    };

    const updateRouteForTab = (tab, templateId = '') => {
        const nextParams = { tab };
        if (templateId) nextParams.template = templateId;
        setSearchParams(nextParams);
    };

    const changeActiveTab = (tab) => {
        updateRouteForTab(tab);
        setActiveTab(tab);
    };

    const loadDatabaseItems = useCallback(async () => {
        if (!recentlySelectedCompany || databaseItemsLoaded || databaseItemsLoading) return;

        setDatabaseItemsLoading(true);
        try {
            const snapshot = await getDocs(query(
                collection(db, 'companies', recentlySelectedCompany, 'settings', 'dataBase', 'dataBase'),
                orderBy('name')
            ));
            setDatabaseItems(
                snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
            );
            setDatabaseItemsLoaded(true);
        } catch (error) {
            console.error('Could not fetch database items:', error);
            toast.error('Could not load database items.');
        } finally {
            setDatabaseItemsLoading(false);
        }
    }, [databaseItemsLoaded, databaseItemsLoading, recentlySelectedCompany]);

    useEffect(() => {
        if (activeTab === 'Dosages' && mode === 'detail' && selectedTemplateLinkedItemIds.length) {
            loadDatabaseItems();
        }
    }, [activeTab, loadDatabaseItems, mode, selectedTemplateLinkedItemIds.length]);

    const openDatabaseItemPicker = () => {
        setDatabaseItemSearchTerm('');
        if (mode === 'detail' && selectedTemplate) {
            setForm(formFromTemplate(activeTab, selectedTemplate));
        }
        setDatabaseItemPickerOpen(true);
        loadDatabaseItems();
    };

    const closeDatabaseItemPicker = () => {
        setDatabaseItemPickerOpen(false);
        setDatabaseItemSearchTerm('');
        if (mode === 'detail' && selectedTemplate) {
            setForm(formFromTemplate(activeTab, selectedTemplate));
        }
    };

    const saveLinkedDatabaseItems = async () => {
        if (mode !== 'detail' || activeTab !== 'Dosages' || !selectedTemplate || !recentlySelectedCompany) {
            setDatabaseItemPickerOpen(false);
            setDatabaseItemSearchTerm('');
            return;
        }

        const linkedItemIds = normalizeLinkedItemIds(form.linkedItemIds, form.linkedItemId);
        const toastId = toast.loading('Updating linked database items...');

        try {
            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, collectionPathFor(activeTab), selectedTemplate.id),
                {
                    linkedItem: '',
                    linkedItemId: linkedItemIds[0] || '',
                    linkedItemIds,
                }
            );
            toast.success('Linked database items updated.', { id: toastId });
            setDatabaseItemPickerOpen(false);
            setDatabaseItemSearchTerm('');
        } catch (error) {
            console.error('Failed to update linked database items:', error);
            toast.error('Could not update linked database items.', { id: toastId });
        }
    };

    const openCreate = () => {
        const nextOrder = activeTemplates.reduce((highestOrder, template) => {
            return Math.max(highestOrder, normalizeNumber(template.order, 0));
        }, 0) + 1;

        updateRouteForTab(activeTab);
        setSelectedTemplateId(null);
        setAmountInput('');
        setDatabaseItemSearchTerm('');
        setDatabaseItemPickerOpen(false);
        setForm({
            ...formForType(activeTab),
            order: nextOrder,
        });
        setMode('form');
    };

    const openUniversalPicker = () => {
        updateRouteForTab(activeTab);
        setSelectedTemplateId(null);
        setAmountInput('');
        setDatabaseItemSearchTerm('');
        setDatabaseItemPickerOpen(false);
        setUniversalSearchTerm('');
        setForm(formForType(activeTab));
        setMode('universal');
    };

    const openEdit = (template) => {
        updateRouteForTab(activeTab, template.id);
        setSelectedTemplateId(template.id);
        setAmountInput('');
        setDatabaseItemSearchTerm('');
        setDatabaseItemPickerOpen(false);
        setForm(formFromTemplate(activeTab, template));
        setMode('form');
    };

    const openDetail = (template) => {
        updateRouteForTab(activeTab, template.id);
        setSelectedTemplateId(template.id);
        setAmountInput('');
        setDatabaseItemSearchTerm('');
        setDatabaseItemPickerOpen(false);
        setForm(formFromTemplate(activeTab, template));
        setMode('detail');
    };

    const backToList = () => {
        updateRouteForTab(activeTab);
        setMode('list');
        setSelectedTemplateId(null);
        setAmountInput('');
        setDatabaseItemSearchTerm('');
        setDatabaseItemPickerOpen(false);
        setForm(formForType(activeTab));
    };

    const saveTemplate = async (event) => {
        event.preventDefault();

        if (!recentlySelectedCompany) {
            toast.error('No company selected.');
            return;
        }

        if (!form.name.trim()) {
            toast.error('Template name is required.');
            return;
        }

        const templateId = selectedTemplate?.id || uuidv4().toUpperCase();
        const payload = payloadFromForm(activeTab, templateId, form);

        if (selectedTemplate) {
            payload[templateIdKeyFor(activeTab)] = selectedTemplate[templateIdKeyFor(activeTab)] || selectedTemplate.id;
        }

        const toastId = toast.loading(selectedTemplate ? `Updating ${activeTab.toLowerCase()} template...` : `Creating ${activeTab.toLowerCase()} template...`);

        try {
            await setDoc(
                doc(db, 'companies', recentlySelectedCompany, collectionPathFor(activeTab), templateId),
                payload,
                { merge: true }
            );
            toast.success(selectedTemplate ? 'Template updated.' : 'Template created.', { id: toastId });
            setSelectedTemplateId(templateId);
            setMode('detail');
            setAmountInput('');
        } catch (error) {
            console.error('Failed to save template:', error);
            toast.error('Could not save template.', { id: toastId });
        }
    };

    const addAmount = async () => {
        if (!selectedTemplate || !recentlySelectedCompany) return;

        const nextAmount = amountInput.trim();
        if (!nextAmount) {
            toast.error('Enter an amount first.');
            return;
        }

        if (!Number.isFinite(Number(nextAmount))) {
            toast.error('Amount must be a number.');
            return;
        }

        const nextAmounts = sortAmountList([...(selectedTemplate.amount || []), nextAmount]);
        const toastId = toast.loading('Adding amount...');

        try {
            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, collectionPathFor(activeTab), selectedTemplate.id),
                { amount: nextAmounts }
            );
            toast.success('Amount added.', { id: toastId });
            setAmountInput('');
            setForm((current) => ({ ...current, amount: formatAmountList(nextAmounts) }));
        } catch (error) {
            console.error('Failed to add amount:', error);
            toast.error('Could not add amount.', { id: toastId });
        }
    };

    const deleteAmount = async (amount) => {
        if (!selectedTemplate || !recentlySelectedCompany) return;

        const nextAmounts = sortAmountList((selectedTemplate.amount || []).filter((item) => item !== amount));
        const toastId = toast.loading('Removing amount...');

        try {
            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, collectionPathFor(activeTab), selectedTemplate.id),
                { amount: nextAmounts }
            );
            toast.success('Amount removed.', { id: toastId });
            setForm((current) => ({ ...current, amount: formatAmountList(nextAmounts) }));
        } catch (error) {
            console.error('Failed to remove amount:', error);
            toast.error('Could not remove amount.', { id: toastId });
        }
    };

    const deleteTemplate = async (template) => {
        if (!recentlySelectedCompany || !template) return;

        const confirmed = window.confirm(
            `Delete ${template.name || 'this template'}? Existing stop data can still reference this id, so only delete it if you are sure.`
        );
        if (!confirmed) return;

        const toastId = toast.loading('Deleting template...');

        try {
            await deleteDoc(doc(db, 'companies', recentlySelectedCompany, collectionPathFor(activeTab), template.id));
            toast.success('Template deleted.', { id: toastId });
            backToList();
        } catch (error) {
            console.error('Failed to delete template:', error);
            toast.error('Could not delete template.', { id: toastId });
        }
    };

    const addUniversalTemplate = async (template) => {
        if (!recentlySelectedCompany || !template) return;

        const existingUniversalId = template.id || template[templateIdKeyFor(activeTab)];
        if (activeTemplateUniversalIds.has(existingUniversalId)) {
            toast.error('This universal template is already enabled for this company.');
            return;
        }

        const templateId = `${activeTab === 'Readings' ? 'com_set_rt_' : 'com_set_dt_'}${uuidv4()}`;
        const payload = payloadFromUniversalTemplate(activeTab, templateId, template, dosages);
        const toastId = toast.loading(`Adding ${template.name || 'template'}...`);

        try {
            await setDoc(
                doc(db, 'companies', recentlySelectedCompany, collectionPathFor(activeTab), templateId),
                payload,
                { merge: false }
            );
            toast.success('Universal template added to company.', { id: toastId });
            setSelectedTemplateId(templateId);
            setMode('detail');
        } catch (error) {
            console.error('Failed to add universal template:', error);
            toast.error('Could not add universal template.', { id: toastId });
        }
    };

    const renderReadingFields = () => (
        <>
            <Field label="Linked Dosage">
                <SelectInput value={form.linkedDosage} onChange={(event) => updateForm('linkedDosage', event.target.value)}>
                    <option value="">None</option>
                    {dosages.map((dosage) => (
                        <option key={dosage.id} value={dosage.id}>
                            {dosage.name || 'Unnamed dosage'}
                        </option>
                    ))}
                </SelectInput>
            </Field>

            <Field label="High Warning">
                <TextInput
                    type="number"
                    step="any"
                    value={form.highWarning}
                    onChange={(event) => updateForm('highWarning', event.target.value)}
                    placeholder="Optional"
                />
            </Field>

            <Field label="Low Warning">
                <TextInput
                    type="number"
                    step="any"
                    value={form.lowWarning}
                    onChange={(event) => updateForm('lowWarning', event.target.value)}
                    placeholder="Optional"
                />
            </Field>
        </>
    );

    const renderDosageFields = () => (
        <>
            <Field label="Rate">
                <TextInput
                    type="text"
                    value={form.rate}
                    onChange={(event) => updateForm('rate', event.target.value)}
                    placeholder="5.00"
                />
            </Field>

            <Field label="Strength">
                <TextInput
                    type="number"
                    step="any"
                    value={form.strength}
                    onChange={(event) => updateForm('strength', event.target.value)}
                    placeholder="1"
                />
            </Field>

            <div className="md:col-span-2 xl:col-span-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Linked Purchased Items</p>
                            <p className="mt-1 text-sm text-slate-500">Only chemical database items can be linked to dosages.</p>
                        </div>
                        <Button type="button" onClick={openDatabaseItemPicker} className="bg-blue-600 text-white hover:bg-blue-700">
                            <FaPlus /> Add Linked Database Item
                        </Button>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        {selectedLinkedItemIds.length ? selectedLinkedItemIds.map((itemId) => {
                            const item = databaseItemById.get(itemId);
                            return (
                                <span key={itemId} className="inline-flex items-center gap-2 rounded-md bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                                    {item ? databaseItemLabel(item) : itemId}
                                    <button
                                        type="button"
                                        onClick={() => toggleLinkedItemId(itemId)}
                                        className="text-blue-500 hover:text-red-600"
                                        aria-label={`Remove ${itemId}`}
                                    >
                                        <FaTimes />
                                    </button>
                                </span>
                            );
                        }) : (
                            <p className="text-sm text-slate-500">No linked chemical database items yet.</p>
                        )}
                    </div>
                </div>
            </div>
        </>
    );

    const renderDatabaseItemPickerModal = () => (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-3 py-6">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-blue-600">Chemical database items</p>
                        <h2 className="text-xl font-bold text-slate-950">Linked Purchased Items</h2>
                        <p className="mt-1 text-sm text-slate-500">Only database items categorized as chemicals can be selected for dosage waste reporting.</p>
                    </div>
                    <button
                        type="button"
                        onClick={closeDatabaseItemPicker}
                        className="rounded-md border border-slate-200 p-2 text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                        aria-label="Close database item picker"
                    >
                        <FaTimes />
                    </button>
                </div>

                <div className="border-b border-slate-200 p-5">
                    <div className="relative">
                        <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <TextInput
                            type="search"
                            value={databaseItemSearchTerm}
                            onChange={(event) => setDatabaseItemSearchTerm(event.target.value)}
                            placeholder="Search chemical item name, SKU, size, or unit"
                            className="pl-9"
                        />
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    {databaseItemsLoading ? (
                        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                            Loading chemical database items...
                        </div>
                    ) : filteredDatabaseItems.length ? (
                        <div className="grid gap-2 md:grid-cols-2">
                            {filteredDatabaseItems.map((item) => {
                                const checked = selectedLinkedItemIds.includes(item.id);
                                return (
                                    <label
                                        key={item.id}
                                        className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm transition ${
                                            checked ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleLinkedItemId(item.id)}
                                            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span>
                                            <span className="block font-semibold">{item.name || item.id}</span>
                                            <span className="block text-xs text-slate-500">
                                                {[item.size ? `Size ${item.size}` : '', item.UOM || item.uom || '', item.sku ? `SKU ${item.sku}` : '', item.category]
                                                    .filter(Boolean)
                                                    .join(' | ') || item.id}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                            {databaseItemsLoaded ? 'No chemical database items match that search.' : 'Open the picker to load chemical database items.'}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-slate-500">
                        <span className="font-semibold text-slate-900">{selectedLinkedItemIds.length}</span> linked item(s) selected
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" onClick={closeDatabaseItemPicker} className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                            Cancel
                        </Button>
                        <Button type="button" onClick={saveLinkedDatabaseItems} className="bg-blue-600 text-white hover:bg-blue-700">
                            {mode === 'detail' ? 'Save Linked Items' : 'Done'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderForm = () => (
        <form onSubmit={saveTemplate} className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <p className="text-sm font-semibold text-blue-600">{selectedTemplate ? 'Edit template' : 'Create template'}</p>
                    <h2 className="text-xl font-bold text-gray-900">
                        {selectedTemplate ? selectedTemplate.name : `New ${activeTab === 'Readings' ? 'Reading' : 'Dosage'}`}
                    </h2>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button onClick={backToList} className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                        <FaArrowLeft /> Back
                    </Button>
                    {selectedTemplate && (
                        <Button onClick={() => deleteTemplate(selectedTemplate)} className="border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">
                            <FaTrashAlt /> Delete
                        </Button>
                    )}
                    <Button type="submit" className="bg-blue-600 text-white hover:bg-blue-700">
                        <FaSave /> Save Template
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Name">
                    <TextInput
                        type="text"
                        value={form.name}
                        onChange={(event) => updateForm('name', event.target.value)}
                        placeholder={activeTab === 'Readings' ? 'Bromine' : 'Phosphates Down'}
                        required
                    />
                </Field>

                <Field label="Unit of Measure">
                    <TextInput
                        type="text"
                        value={form.UOM}
                        onChange={(event) => updateForm('UOM', event.target.value)}
                        placeholder={activeTab === 'Readings' ? 'ppm' : 'oz'}
                    />
                </Field>

                <Field label="Chemical Type">
                    <TextInput
                        type="text"
                        value={form.chemType}
                        onChange={(event) => updateForm('chemType', event.target.value)}
                        placeholder="Defaults to template name"
                    />
                </Field>

                <Field label="Order">
                    <TextInput
                        type="number"
                        step="1"
                        value={form.order}
                        onChange={(event) => updateForm('order', event.target.value)}
                    />
                </Field>

                {activeTab === 'Readings' ? renderReadingFields() : renderDosageFields()}

                <Field label="Preset Amounts" className="md:col-span-2 xl:col-span-3">
                    <TextInput
                        type="text"
                        value={form.amount}
                        onChange={(event) => updateForm('amount', event.target.value)}
                        placeholder="Comma separated, for example: 0, 1, 2, 3"
                    />
                </Field>

                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <input
                        type="checkbox"
                        checked={form.editable}
                        onChange={(event) => updateForm('editable', event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Editable in field apps
                </label>
            </div>
        </form>
    );

    const renderDetail = () => {
        if (!selectedTemplate) {
            return (
                <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
                    Template not found.
                </div>
            );
        }

        const detailLinkedItemIds = selectedTemplateLinkedItemIds;
        const detailLinkedItems = detailLinkedItemIds.map((itemId) => {
            const item = databaseItemById.get(itemId);
            return {
                itemId,
                item,
                unitCostCents: getDatabaseItemUnitCostCents(item),
            };
        });
        const linkedItemsWithUnitCosts = detailLinkedItems.filter(({ unitCostCents }) => unitCostCents > 0);
        const suggestedRateCents = linkedItemsWithUnitCosts.length
            ? Math.round(linkedItemsWithUnitCosts.reduce((total, { unitCostCents }) => total + unitCostCents, 0) / linkedItemsWithUnitCosts.length)
            : 0;
        const suggestedRateRange = linkedItemsWithUnitCosts.length > 1
            ? `${formatCurrency(Math.min(...linkedItemsWithUnitCosts.map(({ unitCostCents }) => unitCostCents)) / 100)} - ${formatCurrency(Math.max(...linkedItemsWithUnitCosts.map(({ unitCostCents }) => unitCostCents)) / 100)}`
            : '';
        const missingLinkedItemsCount = detailLinkedItems.filter(({ item }) => !item).length;

        return (
            <div className="space-y-4">
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <div className="border-b border-gray-200 px-5 py-4">
                        <div className="mb-4 flex justify-start">
                            <Button onClick={backToList} className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                                <FaArrowLeft /> Back
                            </Button>
                        </div>

                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-blue-600">{activeTab === 'Readings' ? 'Reading template' : 'Dosage template'}</p>
                                <h2 className="text-2xl font-bold text-gray-900">{selectedTemplate.name || 'Unnamed template'}</h2>
                                <p className="mt-1 text-sm text-gray-500">{selectedTemplate.id}</p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button onClick={() => openEdit(selectedTemplate)} className="bg-blue-600 text-white hover:bg-blue-700">
                                    <FaPencilAlt /> Edit
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 p-5 text-sm md:grid-cols-2 xl:grid-cols-4">
                        <div>
                            <p className="font-bold text-gray-500">Unit</p>
                            <p className="mt-1 text-gray-900">{selectedTemplate.UOM || '-'}</p>
                        </div>
                        <div>
                            <p className="font-bold text-gray-500">Chemical Type</p>
                            <p className="mt-1 text-gray-900">{selectedTemplate.chemType || '-'}</p>
                        </div>
                        <div>
                            <p className="font-bold text-gray-500">Order</p>
                            <p className="mt-1 text-gray-900">{selectedTemplate.order ?? 0}</p>
                        </div>
                        <div>
                            <p className="font-bold text-gray-500">Editable</p>
                            <p className="mt-1 text-gray-900">{selectedTemplate.editable === false ? 'No' : 'Yes'}</p>
                        </div>

                        {activeTab === 'Readings' ? (
                            <>
                                <div>
                                    <p className="font-bold text-gray-500">Linked Dosage</p>
                                    <p className="mt-1 text-gray-900">
                                        {dosages.find((dosage) => dosage.id === selectedTemplate.linkedDosage)?.name || selectedTemplate.linkedDosage || 'None'}
                                    </p>
                                </div>
                                <div>
                                    <p className="font-bold text-gray-500">Warnings</p>
                                    <p className="mt-1 text-gray-900">
                                        Low {selectedTemplate.lowWarning ?? '-'} / High {selectedTemplate.highWarning ?? '-'}
                                    </p>
                                </div>
                            </>
                        ) : (
                            <>
                                <div>
                                    <p className="font-bold text-gray-500">Rate</p>
                                    <p className="mt-1 text-gray-900">{selectedTemplate.rate ? `$${selectedTemplate.rate}` : '-'}</p>
                                </div>
                                <div>
                                    <p className="font-bold text-gray-500">Strength</p>
                                    <p className="mt-1 text-gray-900">{selectedTemplate.strength ?? '-'}</p>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {activeTab === 'Dosages' ? (
                    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-slate-950">Linked Database Items</h3>
                                <p className="mt-1 text-sm text-slate-500">Chemical purchases linked here are compared against dosage usage in waste reports.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Link
                                    to="/company/items"
                                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                    <FaExternalLinkAlt /> See All Database Items
                                </Link>
                                <Button type="button" onClick={openDatabaseItemPicker} className="bg-blue-600 text-white hover:bg-blue-700">
                                    <FaPlus /> Add Linked Database Item
                                </Button>
                            </div>
                        </div>

                        <div className="p-5">
                            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Suggested Rate</p>
                                <p className="mt-1 text-2xl font-bold text-emerald-950">
                                    {suggestedRateCents ? formatCurrency(suggestedRateCents / 100) : 'No cost data'}
                                </p>
                                <p className="mt-1 text-sm text-emerald-800">
                                    {suggestedRateCents
                                        ? `Average unit cost from ${linkedItemsWithUnitCosts.length} linked database item${linkedItemsWithUnitCosts.length === 1 ? '' : 's'}${suggestedRateRange ? `, range ${suggestedRateRange}` : ''}.`
                                        : databaseItemsLoading
                                            ? 'Loading linked item costs...'
                                            : 'Link database items with unit costs to produce a suggested rate.'}
                                </p>
                            </div>

                            {detailLinkedItemIds.length ? (
                                <div className="grid gap-2 md:grid-cols-2">
                                    {detailLinkedItems.map(({ itemId, item, unitCostCents }) => {
                                        return (
                                            <Link
                                                key={itemId}
                                                to={`/company/items/detail/${itemId}`}
                                                className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900 transition hover:border-blue-300 hover:bg-blue-100"
                                            >
                                                <span className="block font-bold">{item ? item.name || itemId : itemId}</span>
                                                <span className="mt-1 block text-xs text-blue-700">
                                                    {item
                                                        ? [
                                                            item.size ? `Size ${item.size}` : '',
                                                            item.UOM || item.uom || '',
                                                            item.sku ? `SKU ${item.sku}` : '',
                                                            unitCostCents ? `Unit cost ${formatCurrency(unitCostCents / 100)}` : '',
                                                        ].filter(Boolean).join(' | ') || itemId
                                                        : databaseItemsLoading ? 'Loading item details...' : 'Open database item detail'}
                                                </span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500">No chemical database items linked yet.</p>
                            )}

                            {missingLinkedItemsCount > 0 && !databaseItemsLoading ? (
                                <p className="mt-3 text-xs text-amber-700">
                                    {missingLinkedItemsCount} linked item{missingLinkedItemsCount === 1 ? '' : 's'} could not be found in the database item list.
                                </p>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <div className="border-b border-gray-200 px-5 py-4">
                        <h3 className="text-lg font-bold text-gray-900">Preset Amounts</h3>
                    </div>

                    <div className="p-5">
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <TextInput
                                type="text"
                                value={amountInput}
                                onChange={(event) => setAmountInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addAmount();
                                    }
                                }}
                                placeholder="Enter amount"
                            />
                            <Button onClick={addAmount} className="bg-blue-600 text-white hover:bg-blue-700">
                                <FaPlus /> Add
                            </Button>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            {sortAmountList(selectedTemplate.amount || []).map((amount) => (
                                <span key={amount} className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800">
                                    {amount}
                                    <button
                                        type="button"
                                        onClick={() => deleteAmount(amount)}
                                        className="text-gray-400 transition hover:text-red-600"
                                        aria-label={`Remove ${amount}`}
                                    >
                                        <FaTimes />
                                    </button>
                                </span>
                            ))}

                            {(!selectedTemplate.amount || selectedTemplate.amount.length === 0) && (
                                <p className="text-sm text-gray-500">No preset amounts yet.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderUniversalPicker = () => (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-sm font-semibold text-blue-600">Universal catalog</p>
                    <h2 className="text-xl font-bold text-gray-900">
                        Add {activeTab === 'Readings' ? 'Reading' : 'Dosage'} From Universal
                    </h2>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button onClick={backToList} className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                        <FaArrowLeft /> Back
                    </Button>
                    <Button onClick={openCreate} className="bg-blue-600 text-white hover:bg-blue-700">
                        <FaPlus /> Create Custom
                    </Button>
                </div>
            </div>

            <div className="border-b border-gray-200 px-5 py-4">
                <div className="relative w-full lg:max-w-md">
                    <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <TextInput
                        type="text"
                        value={universalSearchTerm}
                        onChange={(event) => setUniversalSearchTerm(event.target.value)}
                        placeholder="Search universal templates..."
                        className="pl-9"
                    />
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Name</th>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Unit</th>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Type</th>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Presets</th>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Default</th>
                            <th className="px-5 py-3 text-right font-bold text-gray-600">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {availableUniversalTemplates.map((template) => (
                            <tr key={template.id} className="hover:bg-blue-50/50">
                                <td className="px-5 py-3">
                                    <p className="font-bold text-gray-900">{template.name || 'Unnamed template'}</p>
                                    <p className="mt-1 text-xs text-gray-500">{template.id}</p>
                                </td>
                                <td className="px-5 py-3 text-gray-700">{template.UOM || '-'}</td>
                                <td className="px-5 py-3 text-gray-700">{template.chemType || '-'}</td>
                                <td className="px-5 py-3 text-gray-700">{template.amount?.length || 0}</td>
                                <td className="px-5 py-3 text-gray-700">
                                    {template.defaultForNewCompanies === true ? 'Yes' : 'No'}
                                </td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end">
                                        <Button onClick={() => addUniversalTemplate(template)} className="bg-blue-600 text-white hover:bg-blue-700">
                                            <FaPlus /> Add
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))}

                        {availableUniversalTemplates.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                                    No available universal {activeTab.toLowerCase()} found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderList = () => {
        const showLinkedItemsColumn = activeTab === 'Dosages';
        const tableColumnCount = showLinkedItemsColumn ? 6 : 5;

        return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-md">
                    <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <TextInput
                        type="text"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder={`Search ${activeTab.toLowerCase()}...`}
                        className="pl-9"
                    />
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button onClick={openUniversalPicker} className="border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
                        <FaPlus /> Add From Universal
                    </Button>
                    <Button onClick={openCreate} className="bg-blue-600 text-white hover:bg-blue-700">
                        <FaPlus /> Create Custom
                    </Button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Name</th>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Unit</th>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Type</th>
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Presets</th>
                            {showLinkedItemsColumn && (
                                <th className="px-5 py-3 text-left font-bold text-gray-600">Linked Items</th>
                            )}
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Order</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {filteredTemplates.map((template) => {
                            const linkedItemCount = normalizeLinkedItemIds(template.linkedItemIds, template.linkedItemId, template.linkedItem).length;

                            return (
                                <tr
                                    key={template.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => openDetail(template)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            openDetail(template);
                                        }
                                    }}
                                    className="cursor-pointer hover:bg-blue-50/50 focus:bg-blue-50 focus:outline-none"
                                    aria-label={`Open ${template.name || 'template'} detail`}
                                >
                                    <td className="px-5 py-3">
                                        <p className="text-left font-bold text-gray-900">
                                            {template.name || 'Unnamed template'}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">{template.id}</p>
                                    </td>
                                    <td className="px-5 py-3 text-gray-700">{template.UOM || '-'}</td>
                                    <td className="px-5 py-3 text-gray-700">{template.chemType || '-'}</td>
                                    <td className="px-5 py-3 text-gray-700">{template.amount?.length || 0}</td>
                                    {showLinkedItemsColumn && (
                                        <td className="px-5 py-3 text-gray-700">
                                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                                                {linkedItemCount} linked
                                            </span>
                                        </td>
                                    )}
                                    <td className="px-5 py-3 text-gray-700">{template.order ?? 0}</td>
                                </tr>
                            );
                        })}

                        {!loading && filteredTemplates.length === 0 && (
                            <tr>
                                <td colSpan={tableColumnCount} className="px-5 py-12 text-center text-gray-500">
                                    No {activeTab.toLowerCase()} found.
                                </td>
                            </tr>
                        )}

                        {loading && (
                            <tr>
                                <td colSpan={tableColumnCount} className="px-5 py-12 text-center text-gray-500">
                                    Loading templates...
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-col gap-2">
                            <p className="inline-flex w-fit items-center gap-2 rounded-md bg-blue-50 px-3 py-1 text-sm font-bold text-blue-700">
                                <FaRegListAlt /> Company Settings
                            </p>
                            <h1 className="text-3xl font-bold text-slate-950">Readings & Dosages</h1>
                            <p className="max-w-3xl text-sm text-slate-600">
                                Manage reading thresholds, dosage presets, and chemical purchase links for reporting.
                            </p>
                        </div>

                        <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                            {['Readings', 'Dosages'].map((tab) => (
                                <button
                                    key={tab}
                                    type="button"
                                    onClick={() => changeActiveTab(tab)}
                                    className={`rounded-md px-4 py-2 text-sm font-bold transition ${
                                        activeTab === tab
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                    </div>
                </section>

                {mode === 'form' && renderForm()}
                {mode === 'detail' && renderDetail()}
                {mode === 'universal' && renderUniversalPicker()}
                {mode === 'list' && renderList()}
                {databaseItemPickerOpen && renderDatabaseItemPickerModal()}
            </div>
        </div>
    );
};

export default ReadingsAndDosages;
