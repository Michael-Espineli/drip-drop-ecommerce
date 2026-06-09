import React, { useContext, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { FaArrowLeft, FaPencilAlt, FaPlus, FaRegListAlt, FaSave, FaSearch, FaTimes, FaTrashAlt } from 'react-icons/fa';
import { db } from '../../../../utils/config';
import {
    collection,
    deleteDoc,
    doc,
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

    return {
        ...basePayload,
        rate: String(form.rate || '').trim(),
        linkedItemId: String(form.linkedItemId || '').trim(),
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

    return {
        ...basePayload,
        rate: String(template.rate || ''),
        linkedItemId: template.linkedItemId || '',
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
    const [activeTab, setActiveTab] = useState('Readings');
    const [readings, setReadings] = useState([]);
    const [dosages, setDosages] = useState([]);
    const [universalReadings, setUniversalReadings] = useState([]);
    const [universalDosages, setUniversalDosages] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState(null);
    const [mode, setMode] = useState('list');
    const [searchTerm, setSearchTerm] = useState('');
    const [universalSearchTerm, setUniversalSearchTerm] = useState('');
    const [form, setForm] = useState(emptyReadingForm);
    const [amountInput, setAmountInput] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setReadings([]);
            setDosages([]);
            setLoading(false);
            return undefined;
        }

        setLoading(true);
        const readingsRef = collection(db, 'companies', recentlySelectedCompany, 'settings', 'readings', 'readings');
        const dosagesRef = collection(db, 'companies', recentlySelectedCompany, 'settings', 'dosages', 'dosages');

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

    const updateForm = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const openCreate = () => {
        const nextOrder = activeTemplates.reduce((highestOrder, template) => {
            return Math.max(highestOrder, normalizeNumber(template.order, 0));
        }, 0) + 1;

        setSelectedTemplateId(null);
        setAmountInput('');
        setForm({
            ...formForType(activeTab),
            order: nextOrder,
        });
        setMode('form');
    };

    const openUniversalPicker = () => {
        setSelectedTemplateId(null);
        setAmountInput('');
        setUniversalSearchTerm('');
        setForm(formForType(activeTab));
        setMode('universal');
    };

    const openEdit = (template) => {
        setSelectedTemplateId(template.id);
        setAmountInput('');
        setForm(formFromTemplate(activeTab, template));
        setMode('form');
    };

    const openDetail = (template) => {
        setSelectedTemplateId(template.id);
        setAmountInput('');
        setForm(formFromTemplate(activeTab, template));
        setMode('detail');
    };

    const backToList = () => {
        setMode('list');
        setSelectedTemplateId(null);
        setAmountInput('');
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

            <Field label="Linked Item Id">
                <TextInput
                    type="text"
                    value={form.linkedItemId}
                    onChange={(event) => updateForm('linkedItemId', event.target.value)}
                    placeholder="Optional inventory item id"
                />
            </Field>
        </>
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

        return (
            <div className="space-y-4">
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 md:flex-row md:items-start md:justify-between">
                        <div>
                            <p className="text-sm font-semibold text-blue-600">{activeTab === 'Readings' ? 'Reading template' : 'Dosage template'}</p>
                            <h2 className="text-2xl font-bold text-gray-900">{selectedTemplate.name || 'Unnamed template'}</h2>
                            <p className="mt-1 text-sm text-gray-500">{selectedTemplate.id}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button onClick={backToList} className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                                <FaArrowLeft /> Back
                            </Button>
                            <Button onClick={() => openEdit(selectedTemplate)} className="bg-blue-600 text-white hover:bg-blue-700">
                                <FaPencilAlt /> Edit
                            </Button>
                            <Button onClick={() => deleteTemplate(selectedTemplate)} className="bg-red-600 text-white hover:bg-red-700">
                                <FaTrashAlt /> Delete
                            </Button>
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
                                <div>
                                    <p className="font-bold text-gray-500">Linked Item</p>
                                    <p className="mt-1 text-gray-900">{selectedTemplate.linkedItemId || 'None'}</p>
                                </div>
                            </>
                        )}
                    </div>
                </div>

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

    const renderList = () => (
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
                            <th className="px-5 py-3 text-left font-bold text-gray-600">Order</th>
                            <th className="px-5 py-3 text-right font-bold text-gray-600">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {filteredTemplates.map((template) => (
                            <tr key={template.id} className="hover:bg-blue-50/50">
                                <td className="px-5 py-3">
                                    <button
                                        type="button"
                                        onClick={() => openDetail(template)}
                                        className="text-left font-bold text-gray-900 hover:text-blue-700"
                                    >
                                        {template.name || 'Unnamed template'}
                                    </button>
                                    <p className="mt-1 text-xs text-gray-500">{template.id}</p>
                                </td>
                                <td className="px-5 py-3 text-gray-700">{template.UOM || '-'}</td>
                                <td className="px-5 py-3 text-gray-700">{template.chemType || '-'}</td>
                                <td className="px-5 py-3 text-gray-700">{template.amount?.length || 0}</td>
                                <td className="px-5 py-3 text-gray-700">{template.order ?? 0}</td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end gap-2">
                                        <Button onClick={() => openEdit(template)} className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                                            <FaPencilAlt /> Edit
                                        </Button>
                                        <Button onClick={() => deleteTemplate(template)} className="border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">
                                            <FaTrashAlt /> Delete
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))}

                        {!loading && filteredTemplates.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                                    No {activeTab.toLowerCase()} found.
                                </td>
                            </tr>
                        )}

                        {loading && (
                            <tr>
                                <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                                    Loading templates...
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1 text-sm font-bold text-blue-700">
                            <FaRegListAlt /> Company Settings
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">Readings & Dosages</h1>
                    </div>

                    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
                        {['Readings', 'Dosages'].map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className={`rounded-md px-4 py-2 text-sm font-bold transition ${
                                    activeTab === tab
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                {mode === 'form' && renderForm()}
                {mode === 'detail' && renderDetail()}
                {mode === 'universal' && renderUniversalPicker()}
                {mode === 'list' && renderList()}
            </div>
        </div>
    );
};

export default ReadingsAndDosages;
