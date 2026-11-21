import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { ContractTerm, TermsTemplate, getTermDescription } from '../../../utils/models/TermsTemplate';
import { SalesAgreementChemicalBillingMode } from '../../../utils/models/Sales';
import { billingFrequencyOptions, paymentTermsOptions, rateTypeOptions } from '../../../utils/sales/agreementCadence';
import {
  termsTemplateAgreementDefaults,
  termsTemplateDefaultsFromAgreementDraft,
  termsTemplateMixedChemicalBillingSelectionOptions,
  termsTemplateUseCaseOptions,
} from '../../../utils/terms/termsTemplateAgreementDefaults';
import { getTerms, saveTermsTemplateWithTerms } from '../../../utils/terms/termsTemplateFirestore';
import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import ChemicalDosagePicker from '../sales/ChemicalDosagePicker';

const inputClass = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const secondaryClass = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

const Field = ({ label, children }) => <label className="block text-sm font-semibold text-slate-700">{label}{children}</label>;

export default function TermsTemplateEditorDialog({ companyId, template = null, initialDraft = null, dosageTemplates = [], loadingDosages = false, onSaved, onClose }) {
  const { requirePermission } = useCompanyPermissions();
  const [form, setForm] = useState(() => ({
    ...termsTemplateAgreementDefaults(template || initialDraft || {}),
    name: template?.name || '',
    description: template?.description || '',
    content: template?.content || initialDraft?.terms || '',
    useCase: template?.useCase || template?.category || 'recurringService',
  }));
  const [terms, setTerms] = useState(() => template ? [] : (initialDraft?.termsList || []).map((term) => new ContractTerm({ description: getTermDescription(term) })));
  const [previousTerms, setPreviousTerms] = useState([]);
  const [loading, setLoading] = useState(Boolean(template));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const busyRef = useRef(false);
  // Keep the same ID on retry if a save fails.
  const [model] = useState(() => new TermsTemplate(template || {}));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!template) return undefined;
    let active = true;
    setLoading(true);
    setLoadError('');
    getTerms(companyId, template.id).then((clauses) => {
      if (!active) return;
      setPreviousTerms(clauses);
      setTerms(clauses.map((term) => ({ id: term.id, description: getTermDescription(term) })));
    }).catch((failure) => {
      if (active) setLoadError(userFacingErrorMessage(failure, 'Could not load the template terms. Try again.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, template, loadAttempt]);

  const save = async (event) => {
    event.preventDefault();
    if (busyRef.current || loading || loadError) return;
    if (!requirePermission(template ? '884' : '882', template ? 'update terms templates' : 'create terms templates')) return;
    if (!companyId || !form.name.trim()) {
      setError('Enter a template name and select a company before saving.');
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError('');
    try {
      const nextTemplate = new TermsTemplate({
        ...model.toFirestore(),
        ...form,
        ...termsTemplateDefaultsFromAgreementDraft(form),
        name: form.name.trim(),
        description: form.description.trim(),
        content: form.content.trim(),
        category: form.useCase,
        updatedAt: new Date(),
      });
      const saved = await saveTermsTemplateWithTerms(companyId, nextTemplate, terms, previousTerms);
      onSaved(saved.template, saved.terms);
    } catch (failure) {
      setError(userFacingErrorMessage(failure, 'Could not save the template. Your changes are still here; try again.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const select = (key, label, options, placeholder = 'Keep agreement setting') => (
    <Field label={label}>
      <select value={form[key] || ''} onChange={(event) => update(key, event.target.value)} className={inputClass}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  );
  const mixedMode = form.chemicalBillingMixedSelectionMode || 'separatelyBilled';
  const chemicalOptions = [
    { value: SalesAgreementChemicalBillingMode.includedAll, label: 'Chemicals Included In Service' },
    { value: SalesAgreementChemicalBillingMode.billAllSeparately, label: 'Bill All Chemicals Separately' },
    { value: SalesAgreementChemicalBillingMode.mixed, label: 'Mixed Chemical Billing' },
  ];

  return (
    <Dialog open onClose={() => !busyRef.current && onClose()} className="relative z-[60]">
      <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <DialogPanel className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl ${template ? 'max-w-[max(48rem,50vw)]' : 'max-w-3xl'}`}>
          <form onSubmit={save} className="flex max-h-[92dvh] min-h-0 flex-col" aria-label="Service agreement template editor">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <DialogTitle className="text-xl font-bold text-slate-950">{template ? 'Edit Service Agreement Template' : 'New Service Agreement Template'}</DialogTitle>
                <p className="mt-1 text-sm text-slate-500">Save reusable defaults and terms, then use them in this agreement.</p>
                {template && <p className="mt-1 text-sm text-slate-500">Changes to this template will be available to future agreements.</p>}
              </div>
              <button type="button" onClick={onClose} disabled={saving} className={secondaryClass}>Close</button>
            </div>
            {loadError && <div className="space-y-2 p-5"><p role="alert" className="text-sm text-rose-700">{loadError}</p><button type="button" onClick={() => setLoadAttempt((current) => current + 1)} className={secondaryClass}>Retry loading terms</button></div>}
            <div className="min-h-0 flex-1 overflow-y-auto">
            <fieldset disabled={loading || saving || Boolean(loadError)} className="space-y-5 p-5">
              {loading && <p role="status" className="text-sm text-slate-500">Loading template terms...</p>}
              <Field label="Template Name"><input autoFocus required value={form.name} onChange={(event) => update('name', event.target.value)} className={inputClass} placeholder="e.g. Weekly residential service" /></Field>
              <Field label="Template Description"><textarea rows={2} value={form.description} onChange={(event) => update('description', event.target.value)} className={inputClass} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                {select('useCase', 'Use Case', termsTemplateUseCaseOptions, 'Custom')}
                {select('billingFrequency', 'Default Billing Frequency', billingFrequencyOptions)}
                <Field label="Default Billing Count"><input type="number" min="1" step="1" value={form.billingFrequencyCount} onChange={(event) => update('billingFrequencyCount', event.target.value)} className={inputClass} placeholder="Keep agreement setting" /></Field>
                {select('rateType', 'Default Rate Type', rateTypeOptions)}
                {select('paymentTerms', 'Default Payment Terms', paymentTermsOptions)}
                {select('chemicalBillingMode', 'Default Chemical Billing', chemicalOptions)}
              </div>
              {form.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed && <div className="space-y-3">
                {select('chemicalBillingMixedSelectionMode', 'Mixed Chemical Billing Selection', termsTemplateMixedChemicalBillingSelectionOptions, 'Selected dosages are billed separately')}
                <ChemicalDosagePicker
                  id="template-chemical-dosages"
                  label={mixedMode === 'included' ? 'Included Dosages' : 'Separately Billed Dosages'}
                  selectedIds={mixedMode === 'included' ? form.includedChemicalIds : form.separatelyBilledChemicalIds}
                  dosageTemplates={dosageTemplates}
                  loading={loadingDosages}
                  onChange={(ids) => update(mixedMode === 'included' ? 'includedChemicalIds' : 'separatelyBilledChemicalIds', ids)}
                />
              </div>}
              <Field label="Default Chemical Billing Notes"><textarea rows={2} value={form.chemicalBillingNotes} onChange={(event) => update('chemicalBillingNotes', event.target.value)} className={inputClass} /></Field>
              <Field label="Template Content"><textarea rows={4} value={form.content} onChange={(event) => update('content', event.target.value)} className={inputClass} /></Field>
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-slate-950">Template Terms</h3>
                  <button type="button" onClick={() => setTerms((current) => [...current, new ContractTerm()])} className={secondaryClass}>Add Template Term</button>
                </div>
                {terms.map((term, index) => <div key={term.id} className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <label className="block flex-1 text-sm font-semibold text-slate-700">Term {index + 1}
                    <textarea rows={2} value={term.description} onChange={(event) => setTerms((current) => current.map((item) => item.id === term.id ? { ...item, description: event.target.value } : item))} className={inputClass} />
                  </label>
                  <button type="button" onClick={() => setTerms((current) => current.filter((item) => item.id !== term.id))} className={secondaryClass} aria-label={`Remove template term ${index + 1}`}>Remove</button>
                </div>)}
                {!terms.length && <p className="text-sm text-slate-500">Add reusable term lines, or use template content above.</p>}
              </section>
            </fieldset>
            </div>
            <div className="shrink-0 space-y-3 border-t border-slate-200 p-4">
              {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} disabled={saving} className={secondaryClass}>Cancel</button>
                <button type="submit" disabled={saving || loading || Boolean(loadError)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save & Use Template'}</button>
              </div>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
