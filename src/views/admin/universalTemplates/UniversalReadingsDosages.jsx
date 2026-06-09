import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { db } from '../../../utils/config';

const ADMIN_YELLOW = '#debf44';

const emptyReadingForm = {
  name: '',
  amount: '',
  UOM: '',
  chemType: '',
  linkedDosage: '',
  editable: true,
  order: 0,
  highWarning: 0,
  lowWarning: 0,
  defaultForNewCompanies: false,
};

const emptyDosageForm = {
  name: '',
  amount: '',
  UOM: '',
  rate: '',
  linkedItemId: '',
  strength: 0,
  editable: true,
  chemType: '',
  order: 0,
  defaultForNewCompanies: false,
};

const collectionNameFor = (templateType) =>
  templateType === 'readings' ? 'readingTemplates' : 'dosageTemplates';

const prefixFor = (templateType) => (templateType === 'readings' ? 'univ_rt_' : 'univ_dt_');

const parseAmountList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const formatAmountList = (value) =>
  Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '');

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const formFromTemplate = (templateType, template = {}) => {
  if (templateType === 'readings') {
    return {
      name: template.name || '',
      amount: formatAmountList(template.amount),
      UOM: template.UOM || '',
      chemType: template.chemType || '',
      linkedDosage: template.linkedDosage || '',
      editable: template.editable !== false,
      order: template.order || 0,
      highWarning: template.highWarning ?? 0,
      lowWarning: template.lowWarning ?? 0,
      defaultForNewCompanies: template.defaultForNewCompanies === true,
    };
  }

  return {
    name: template.name || '',
    amount: formatAmountList(template.amount),
    UOM: template.UOM || '',
    rate: template.rate || '',
    linkedItemId: template.linkedItemId || '',
    strength: template.strength || 0,
    editable: template.editable !== false,
    chemType: template.chemType || '',
    order: template.order || 0,
    defaultForNewCompanies: template.defaultForNewCompanies === true,
  };
};

const payloadFromForm = (templateType, id, form) => {
  const basePayload = {
    id,
    name: form.name.trim(),
    amount: parseAmountList(form.amount),
    UOM: form.UOM.trim(),
    chemType: form.chemType.trim(),
    editable: Boolean(form.editable),
    order: toNumber(form.order),
    defaultForNewCompanies: Boolean(form.defaultForNewCompanies),
  };

  if (templateType === 'readings') {
    return {
      ...basePayload,
      linkedDosage: form.linkedDosage.trim(),
      highWarning: toNumber(form.highWarning),
      lowWarning: toNumber(form.lowWarning),
    };
  }

  return {
    ...basePayload,
    rate: form.rate.trim(),
    linkedItemId: form.linkedItemId.trim(),
    strength: toNumber(form.strength),
  };
};

function UniversalReadingsDosages() {
  const [templateType, setTemplateType] = useState('readings');
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(emptyReadingForm);

  const cardClass = 'w-full bg-slate-950 p-4 rounded-xl text-slate-100 border border-slate-800/60 shadow-2xl';
  const inputClass = 'w-full px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-400/30';
  const btnPrimary = 'px-4 py-2 rounded-md font-semibold bg-yellow-400 text-slate-950 hover:bg-yellow-300 transition';
  const btnSecondary = 'px-4 py-2 rounded-md font-semibold bg-slate-900/70 text-slate-200 border border-slate-800/60 hover:bg-slate-900 transition';
  const btnOutline = 'px-4 py-2 rounded-md font-semibold bg-yellow-400/10 text-yellow-300 ring-1 ring-yellow-400/30 hover:bg-yellow-400/15 transition';
  const btnDanger = 'px-4 py-2 rounded-md font-semibold bg-red-500/15 text-red-200 ring-1 ring-red-500/30 hover:bg-red-500/20 transition';

  const loadTemplates = useCallback(async () => {
    setLoading(true);

    try {
      const templatesQuery = query(
        collection(db, 'universal', 'settings', collectionNameFor(templateType)),
        orderBy('order', 'asc')
      );
      const snapshot = await getDocs(templatesQuery);
      setTemplates(snapshot.docs.map((templateDoc) => ({ id: templateDoc.id, ...templateDoc.data() })));
    } catch (error) {
      console.error('Failed to load universal templates:', error);
      toast.error('Could not load universal templates.');
    } finally {
      setLoading(false);
    }
  }, [templateType]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    setSelectedTemplate(null);
    setIsEditing(false);
    setForm(templateType === 'readings' ? emptyReadingForm : emptyDosageForm);
  }, [templateType]);

  const filteredTemplates = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return templates;

    return templates.filter((template) =>
      [template.name, template.chemType, template.UOM, template.id]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [searchTerm, templates]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const startCreate = () => {
    setSelectedTemplate(null);
    setIsEditing(true);
    setForm(templateType === 'readings' ? emptyReadingForm : emptyDosageForm);
  };

  const startEdit = (template) => {
    setSelectedTemplate(template);
    setForm(formFromTemplate(templateType, template));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setSelectedTemplate(null);
    setForm(templateType === 'readings' ? emptyReadingForm : emptyDosageForm);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error('Template name is required.');
      return;
    }

    const templateId = selectedTemplate?.id || `${prefixFor(templateType)}${uuidv4()}`;
    const payload = payloadFromForm(templateType, templateId, form);

    try {
      await setDoc(
        doc(db, 'universal', 'settings', collectionNameFor(templateType), templateId),
        payload,
        { merge: true }
      );
      toast.success(selectedTemplate ? 'Template updated.' : 'Template created.');
      cancelEdit();
      loadTemplates();
    } catch (error) {
      console.error('Failed to save universal template:', error);
      toast.error('Could not save template.');
    }
  };

  const handleDelete = async (template) => {
    const confirmed = window.confirm(`Delete ${template.name || 'this template'}?`);
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'universal', 'settings', collectionNameFor(templateType), template.id));
      toast.success('Template deleted.');
      if (selectedTemplate?.id === template.id) cancelEdit();
      loadTemplates();
    } catch (error) {
      console.error('Failed to delete universal template:', error);
      toast.error('Could not delete template.');
    }
  };

  const renderReadingFields = () => (
    <>
      <div>
        <label className="text-sm font-semibold text-slate-300">Linked Dosage Id</label>
        <input
          type="text"
          value={form.linkedDosage}
          onChange={(event) => updateForm('linkedDosage', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-slate-300">High Warning</label>
        <input
          type="number"
          step="any"
          value={form.highWarning}
          onChange={(event) => updateForm('highWarning', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-slate-300">Low Warning</label>
        <input
          type="number"
          step="any"
          value={form.lowWarning}
          onChange={(event) => updateForm('lowWarning', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
    </>
  );

  const renderDosageFields = () => (
    <>
      <div>
        <label className="text-sm font-semibold text-slate-300">Rate</label>
        <input
          type="text"
          value={form.rate}
          onChange={(event) => updateForm('rate', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-slate-300">Linked Item Id</label>
        <input
          type="text"
          value={form.linkedItemId}
          onChange={(event) => updateForm('linkedItemId', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-slate-300">Strength</label>
        <input
          type="number"
          step="any"
          value={form.strength}
          onChange={(event) => updateForm('strength', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-900 px-2 py-5 md:px-7">
      <div className={cardClass}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
              Universal Readings & Dosages
            </h1>
            <p className="text-sm text-slate-400">Manage the global catalog companies can choose from</p>
          </div>

          <button type="button" onClick={startCreate} className={btnOutline}>
            Create {templateType === 'readings' ? 'Reading' : 'Dosage'}
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-full rounded-lg border border-slate-800/60 bg-slate-900/70 p-1 lg:w-auto">
            {[
              { value: 'readings', label: 'Readings' },
              { value: 'dosages', label: 'Dosages' },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setTemplateType(tab.value)}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition lg:flex-none ${
                  templateType === tab.value
                    ? 'bg-yellow-400 text-slate-950'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className={`${inputClass} lg:w-[340px]`}
          />
        </div>

        {isEditing && (
          <form onSubmit={handleSubmit} className="mb-5 rounded-lg border border-slate-800/60 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-100">
                {selectedTemplate ? 'Edit' : 'Create'} {templateType === 'readings' ? 'Reading' : 'Dosage'} Template
              </h2>
              <button type="button" onClick={cancelEdit} className={btnSecondary}>
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="text-sm font-semibold text-slate-300">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  className={`${inputClass} mt-1`}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-300">UOM</label>
                <input
                  type="text"
                  value={form.UOM}
                  onChange={(event) => updateForm('UOM', event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-300">Chemical Type</label>
                <input
                  type="text"
                  value={form.chemType}
                  onChange={(event) => updateForm('chemType', event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-300">Order</label>
                <input
                  type="number"
                  step="1"
                  value={form.order}
                  onChange={(event) => updateForm('order', event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-300">Amounts</label>
                <input
                  type="text"
                  value={form.amount}
                  onChange={(event) => updateForm('amount', event.target.value)}
                  className={`${inputClass} mt-1`}
                  placeholder="Comma-separated"
                />
              </div>

              {templateType === 'readings' ? renderReadingFields() : renderDosageFields()}

              <label className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <input
                  type="checkbox"
                  checked={form.editable}
                  onChange={(event) => updateForm('editable', event.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                Editable
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <input
                  type="checkbox"
                  checked={form.defaultForNewCompanies}
                  onChange={(event) => updateForm('defaultForNewCompanies', event.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                Add to new companies by default
              </label>
            </div>

            <div className="mt-5 flex justify-end">
              <button type="submit" className={btnPrimary}>
                Save Template
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr className="text-slate-200">
                <th className="px-4 py-3 text-left font-bold">Name</th>
                <th className="px-4 py-3 text-left font-bold">Type</th>
                <th className="px-4 py-3 text-left font-bold">UOM</th>
                <th className="px-4 py-3 text-left font-bold">Order</th>
                <th className="px-4 py-3 text-left font-bold">Default</th>
                <th className="px-4 py-3 text-left font-bold">Editable</th>
                <th className="px-4 py-3 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredTemplates.map((template) => (
                <tr key={template.id} className="hover:bg-slate-900/60">
                  <td className="px-4 py-3 text-slate-100">
                    <p className="font-semibold">{template.name || 'Unnamed'}</p>
                    <p className="text-xs text-slate-500">{template.id}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-200">{template.chemType || '-'}</td>
                  <td className="px-4 py-3 text-slate-200">{template.UOM || '-'}</td>
                  <td className="px-4 py-3 text-slate-300">{template.order ?? 0}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {template.defaultForNewCompanies === true
                      ? 'Yes'
                      : template.defaultForNewCompanies === false
                        ? 'No'
                        : 'Legacy'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{template.editable === false ? 'No' : 'Yes'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => startEdit(template)} className={btnSecondary}>
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDelete(template)} className={btnDanger}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && filteredTemplates.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No templates found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Loading templates...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default UniversalReadingsDosages;
