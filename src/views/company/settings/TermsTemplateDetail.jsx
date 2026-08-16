import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { deleteDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ArrowLeftIcon, CheckIcon, DocumentDuplicateIcon, PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { SalesAgreementChemicalBillingMode } from '../../../utils/models/Sales';
import { ContractTerm, getTermDescription } from '../../../utils/models/TermsTemplate';
import {
    billingFrequencyOptions,
    paymentTermsOptions,
    rateTypeOptions,
} from '../../../utils/sales/agreementCadence';
import {
    TermsTemplateChemicalBillingMixedSelectionMode,
    termsTemplateAgreementDefaults,
    termsTemplateHasAgreementDefaults,
    termsTemplateMixedChemicalBillingSelectionOptions,
    termsTemplateUseCaseLabel,
    termsTemplateUseCaseOptions,
} from '../../../utils/terms/termsTemplateAgreementDefaults';
import {
    deleteContractTerm,
    duplicateTermsTemplate,
    getTerms,
    getTermsTemplate,
    saveContractTerm,
    termsTemplateDoc,
    updateTermsTemplate,
} from '../../../utils/terms/termsTemplateFirestore';
import { appConfirm } from '../../../utils/appDialog';

const chemicalBillingModeOptions = [
    { value: SalesAgreementChemicalBillingMode.includedAll, label: 'Chemicals Included In Service' },
    { value: SalesAgreementChemicalBillingMode.billAllSeparately, label: 'Bill All Chemicals Separately' },
    { value: SalesAgreementChemicalBillingMode.mixed, label: 'Mixed Chemical Billing' },
];

const optionLabel = (options, value) => (
    options.find((option) => option.value === value)?.label || ''
);

const templateForm = (template = {}) => {
    const defaults = termsTemplateAgreementDefaults(template);

    return {
        name: template.name || '',
        description: template.description || '',
        content: template.content || '',
        useCase: defaults.useCase || 'recurringService',
        billingFrequency: defaults.billingFrequency,
        billingFrequencyCount: defaults.billingFrequencyCount ? String(defaults.billingFrequencyCount) : '',
        rateType: defaults.rateType,
        paymentTerms: defaults.paymentTerms,
        chemicalBillingMode: defaults.chemicalBillingMode,
        chemicalBillingMixedSelectionMode: defaults.chemicalBillingMixedSelectionMode
            || TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled,
        includedChemicalIds: defaults.includedChemicalIds,
        separatelyBilledChemicalIds: defaults.separatelyBilledChemicalIds,
        chemicalBillingNotes: defaults.chemicalBillingNotes,
    };
};

const templateDefaultRows = (template = {}) => {
    const defaults = termsTemplateAgreementDefaults(template);

    return [
        ['Use Case', termsTemplateUseCaseLabel(defaults.useCase)],
        ['Billing Frequency', optionLabel(billingFrequencyOptions, defaults.billingFrequency) || 'No default'],
        ['Billing Count', defaults.billingFrequencyCount || 'No default'],
        ['Rate Type', optionLabel(rateTypeOptions, defaults.rateType) || 'No default'],
        ['Payment Terms', optionLabel(paymentTermsOptions, defaults.paymentTerms) || 'No default'],
        ['Chemical Billing', optionLabel(chemicalBillingModeOptions, defaults.chemicalBillingMode) || 'No default'],
        defaults.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
            ? [
                'Mixed Selection',
                optionLabel(termsTemplateMixedChemicalBillingSelectionOptions, defaults.chemicalBillingMixedSelectionMode) || 'No default',
            ]
            : null,
        defaults.includedChemicalIds.length ? ['Included Dosage IDs', defaults.includedChemicalIds.join(', ')] : null,
        defaults.separatelyBilledChemicalIds.length ? ['Separately Billed Dosage IDs', defaults.separatelyBilledChemicalIds.join(', ')] : null,
        ['Chemical Notes', defaults.chemicalBillingNotes || 'No default'],
    ].filter(Boolean);
};

const clauseDrafts = (clauses = []) => clauses.map((clause) => ({
    id: clause.id,
    description: getTermDescription(clause),
}));

const newClauseDraft = () => new ContractTerm({ description: '' });

const DetailStatCard = ({ label, value, helper }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        <p className="mt-1 truncate text-sm text-slate-500" title={helper}>{helper}</p>
    </div>
);

const TermsTemplateDetail = () => {
    const { templateId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();

    const [template, setTemplate] = useState(null);
    const [clauses, setClauses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [editedTemplate, setEditedTemplate] = useState(templateForm());
    const [editedClauses, setEditedClauses] = useState([]);

    useEffect(() => {
        if (!recentlySelectedCompany || !templateId) return undefined;

        const fetchTemplateAndClauses = async () => {
            setIsLoading(true);

            try {
                const templateData = await getTermsTemplate(recentlySelectedCompany, templateId);
                if (templateData) {
                    setTemplate(templateData);
                    setEditedTemplate(templateForm(templateData));
                } else {
                    toast.error("Template not found.");
                    navigate("/company/settings/terms-templates");
                    return;
                }

                const termsList = await getTerms(recentlySelectedCompany, templateId);
                setClauses(termsList);
                setEditedClauses(clauseDrafts(termsList));
            } catch (error) {
                console.error("Error fetching data: ", error);
                toast.error("Failed to fetch template details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchTemplateAndClauses();
    }, [recentlySelectedCompany, templateId, navigate]);

    const beginEditing = () => {
        if (!requirePermission("884", "update terms templates")) return;

        setEditedTemplate(templateForm(template));
        setEditedClauses(clauseDrafts(clauses));
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setEditedTemplate(templateForm(template));
        setEditedClauses(clauseDrafts(clauses));
        setIsEditing(false);
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        if (!requirePermission("884", "update terms templates")) return;

        if (!editedTemplate.name.trim()) {
            toast.error("Template name is required.");
            return;
        }

        const nextTemplate = {
            name: editedTemplate.name.trim(),
            description: editedTemplate.description.trim(),
            content: editedTemplate.content.trim(),
            useCase: editedTemplate.useCase || 'custom',
            category: editedTemplate.useCase || 'custom',
            billingFrequency: editedTemplate.billingFrequency,
            billingFrequencyCount: editedTemplate.billingFrequencyCount
                ? Math.max(Number(editedTemplate.billingFrequencyCount) || 1, 1)
                : '',
            rateType: editedTemplate.rateType,
            paymentTerms: editedTemplate.paymentTerms,
            chemicalBillingMode: editedTemplate.chemicalBillingMode,
            chemicalBillingMixedSelectionMode: editedTemplate.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
                ? editedTemplate.chemicalBillingMixedSelectionMode
                : '',
            includedChemicalIds: editedTemplate.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
                && editedTemplate.chemicalBillingMixedSelectionMode === TermsTemplateChemicalBillingMixedSelectionMode.included
                ? editedTemplate.includedChemicalIds
                : [],
            separatelyBilledChemicalIds: editedTemplate.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
                && editedTemplate.chemicalBillingMixedSelectionMode === TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled
                ? editedTemplate.separatelyBilledChemicalIds
                : [],
            chemicalBillingNotes: editedTemplate.chemicalBillingNotes.trim(),
        };
        const nextClauses = editedClauses
            .map((clause) => ({
                id: clause.id || newClauseDraft().id,
                description: String(clause.description || '').trim(),
            }))
            .filter((clause) => clause.description);
        const nextClauseIds = new Set(nextClauses.map((clause) => clause.id));
        const removedClauses = clauses.filter((clause) => !nextClauseIds.has(clause.id));

        setIsSaving(true);

        try {
            await updateTermsTemplate(recentlySelectedCompany, templateId, nextTemplate);
            await Promise.all([
                ...nextClauses.map((clause) => saveContractTerm(
                    recentlySelectedCompany,
                    templateId,
                    new ContractTerm(clause)
                )),
                ...removedClauses.map((clause) => deleteContractTerm(recentlySelectedCompany, templateId, clause.id)),
            ]);

            setTemplate({ ...template, ...nextTemplate });
            setClauses(nextClauses.map((clause) => new ContractTerm(clause)));
            setEditedTemplate(nextTemplate);
            setEditedClauses(nextClauses);
            setIsEditing(false);
            toast.success("Template updated successfully!");
        } catch (error) {
            console.error("Error updating template: ", error);
            toast.error("Failed to update template.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!isEditing || !requirePermission("886", "delete terms templates")) return;

        const confirmed = await appConfirm({
            title: 'Delete Service Agreement Template',
            message: 'Are you sure you want to delete this template and all its terms?',
            confirmLabel: 'Delete Template',
            variant: 'danger',
        });
        if (!confirmed) return;

        try {
            await deleteDoc(termsTemplateDoc(recentlySelectedCompany, templateId));
            toast.success("Template deleted successfully!");
            navigate("/company/settings/terms-templates");
        } catch (error) {
            console.error("Error deleting template: ", error);
            toast.error("Failed to delete template.");
        }
    };

    const handleDuplicate = async () => {
        if (!requirePermission("882", "create terms templates")) return;

        if (!recentlySelectedCompany) {
            toast.error("Select a company before duplicating a template.");
            return;
        }

        setIsDuplicating(true);

        try {
            const duplicatedTemplate = await duplicateTermsTemplate(recentlySelectedCompany, templateId);
            toast.success(`${duplicatedTemplate.name} created.`);
            navigate(`/company/settings/terms-templates/${duplicatedTemplate.id}`);
        } catch (error) {
            console.error("Error duplicating template: ", error);
            toast.error(error.message || "Failed to duplicate template.");
        } finally {
            setIsDuplicating(false);
        }
    };

    const updateEditedClause = (clauseId, description) => {
        setEditedClauses((current) => current.map((clause) => (
            clause.id === clauseId ? { ...clause, description } : clause
        )));
    };

    const addEditedClause = () => {
        const draft = newClauseDraft();
        setEditedClauses((current) => [...current, { id: draft.id, description: draft.description }]);
    };

    const removeEditedClause = (clauseId) => {
        setEditedClauses((current) => current.filter((clause) => clause.id !== clauseId));
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
                <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
                    Loading...
                </div>
            </div>
        );
    }

    if (!template) {
        return null;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-6">
                <Link
                    to="/company/settings/terms-templates"
                    className="app-back-link"
                >
                    <ArrowLeftIcon className="h-4 w-4" />
                    Back to Templates
                </Link>

                {isEditing ? (
                    <form onSubmit={handleUpdate} className="space-y-6">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                        Editing Service Agreement Template
                                    </span>
                                    <h1 className="mt-3 text-3xl font-bold text-slate-950">Edit Template</h1>
                                    <p className="mt-1 text-sm text-slate-500">Update the saved agreement defaults and terms lines.</p>
                                </div>
                            </div>

                            <div className="mt-5 grid gap-4">
                                <div>
                                    <label htmlFor="name" className="block text-sm font-semibold text-slate-700">Template Name</label>
                                    <input
                                        type="text"
                                        id="name"
                                        value={editedTemplate.name}
                                        onChange={e => setEditedTemplate({ ...editedTemplate, name: e.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        required
                                    />
                                </div>
                                <div>
                                    <label htmlFor="description" className="block text-sm font-semibold text-slate-700">Description</label>
                                    <textarea
                                        id="description"
                                        value={editedTemplate.description}
                                        onChange={e => setEditedTemplate({ ...editedTemplate, description: e.target.value })}
                                        rows={3}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="useCase" className="block text-sm font-semibold text-slate-700">Use Case</label>
                                    <select
                                        id="useCase"
                                        value={editedTemplate.useCase}
                                        onChange={(event) => setEditedTemplate({ ...editedTemplate, useCase: event.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        {termsTemplateUseCaseOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="content" className="block text-sm font-semibold text-slate-700">Default Content</label>
                                    <textarea
                                        id="content"
                                        value={editedTemplate.content}
                                        onChange={e => setEditedTemplate({ ...editedTemplate, content: e.target.value })}
                                        rows={6}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </div>
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div>
                                <h2 className="text-xl font-bold text-slate-950">Agreement Defaults</h2>
                                <p className="mt-1 text-sm text-slate-500">Optional defaults copied into a draft when this template is selected.</p>
                            </div>

                            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                    <label htmlFor="billingFrequency" className="block text-sm font-semibold text-slate-700">Billing Frequency</label>
                                    <select
                                        id="billingFrequency"
                                        value={editedTemplate.billingFrequency}
                                        onChange={(event) => setEditedTemplate({ ...editedTemplate, billingFrequency: event.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        <option value="">No default</option>
                                        {billingFrequencyOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label htmlFor="billingFrequencyCount" className="block text-sm font-semibold text-slate-700">Billing Count</label>
                                    <input
                                        id="billingFrequencyCount"
                                        type="number"
                                        min="1"
                                        value={editedTemplate.billingFrequencyCount}
                                        onChange={(event) => setEditedTemplate({ ...editedTemplate, billingFrequencyCount: event.target.value })}
                                        placeholder="No default"
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="rateType" className="block text-sm font-semibold text-slate-700">Rate Type</label>
                                    <select
                                        id="rateType"
                                        value={editedTemplate.rateType}
                                        onChange={(event) => setEditedTemplate({ ...editedTemplate, rateType: event.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        <option value="">No default</option>
                                        {rateTypeOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label htmlFor="paymentTerms" className="block text-sm font-semibold text-slate-700">Payment Terms</label>
                                    <select
                                        id="paymentTerms"
                                        value={editedTemplate.paymentTerms}
                                        onChange={(event) => setEditedTemplate({ ...editedTemplate, paymentTerms: event.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        <option value="">No default</option>
                                        {paymentTermsOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="lg:col-span-2">
                                    <label htmlFor="chemicalBillingMode" className="block text-sm font-semibold text-slate-700">Chemical Billing</label>
                                    <select
                                        id="chemicalBillingMode"
                                        value={editedTemplate.chemicalBillingMode}
                                        onChange={(event) => setEditedTemplate({ ...editedTemplate, chemicalBillingMode: event.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        <option value="">No default</option>
                                        {chemicalBillingModeOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {editedTemplate.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed && (
                                    <div className="lg:col-span-2">
                                        <label htmlFor="chemicalBillingMixedSelectionMode" className="block text-sm font-semibold text-slate-700">Mixed Billing Selection</label>
                                        <select
                                            id="chemicalBillingMixedSelectionMode"
                                            value={editedTemplate.chemicalBillingMixedSelectionMode}
                                            onChange={(event) => setEditedTemplate({ ...editedTemplate, chemicalBillingMixedSelectionMode: event.target.value })}
                                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        >
                                            {termsTemplateMixedChemicalBillingSelectionOptions.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="sm:col-span-2 lg:col-span-4">
                                    <label htmlFor="chemicalBillingNotes" className="block text-sm font-semibold text-slate-700">Chemical Billing Notes</label>
                                    <input
                                        id="chemicalBillingNotes"
                                        type="text"
                                        value={editedTemplate.chemicalBillingNotes}
                                        onChange={(event) => setEditedTemplate({ ...editedTemplate, chemicalBillingNotes: event.target.value })}
                                        placeholder="tabs supplied by customer, phosphate billed separately"
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </div>
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <h2 className="text-xl font-bold text-slate-950">Template Terms</h2>
                                <button
                                    type="button"
                                    onClick={addEditedClause}
                                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                    <PlusIcon className="h-5 w-5" />
                                    Add Line
                                </button>
                            </div>

                            <div className="mt-4 space-y-3">
                                {editedClauses.map((clause, index) => (
                                    <div key={clause.id} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-500">
                                            {index + 1}
                                        </div>
                                        <textarea
                                            value={clause.description}
                                            onChange={(event) => updateEditedClause(clause.id, event.target.value)}
                                            rows={2}
                                            placeholder="Terms line"
                                            className="min-h-[72px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeEditedClause(clause.id)}
                                            className="inline-flex h-9 items-center justify-center rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}

                                {editedClauses.length === 0 && (
                                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                        Add terms lines to make this template selectable in service agreements.
                                    </div>
                                )}
                            </div>
                        </section>

                        <div className="sticky bottom-0 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-end">
                            {can("886") && (
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={isSaving}
                                    className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 sm:mr-auto"
                                >
                                    <TrashIcon className="h-5 w-5" />
                                    Delete Template
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={cancelEditing}
                                disabled={isSaving}
                                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                                <XMarkIcon className="h-5 w-5" />
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <CheckIcon className="h-5 w-5" />
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <>
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                            {termsTemplateUseCaseLabel(template.useCase || template.category)}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                            {clauses.length} term{clauses.length === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                    <h1 className="mt-3 text-3xl font-bold text-slate-950">{template.name}</h1>
                                    <p className="mt-2 max-w-3xl text-sm text-slate-500">{template.description || 'No description'}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {can("882") && (
                                        <button
                                            type="button"
                                            onClick={handleDuplicate}
                                            disabled={isDuplicating}
                                            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <DocumentDuplicateIcon className="h-5 w-5" />
                                            {isDuplicating ? 'Duplicating...' : 'Duplicate'}
                                        </button>
                                    )}
                                    {can("884") && (
                                        <button
                                            type="button"
                                            onClick={beginEditing}
                                            disabled={isDuplicating}
                                            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <PencilIcon className="h-5 w-5" />
                                            Edit Template
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="mt-5 border-t border-slate-200 pt-5">
                                <h2 className="text-lg font-bold text-slate-950">Default Content</h2>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                                    {template.content || "No default content provided."}
                                </p>
                            </div>
                        </section>

                        <section className="grid gap-4 sm:grid-cols-3">
                            <DetailStatCard label="Terms" value={clauses.length} helper="Reusable term lines" />
                            <DetailStatCard label="Default Copy" value={String(template.content || '').trim() ? 'Yes' : 'No'} helper="Seed agreement body text" />
                            <DetailStatCard label="Agreement Defaults" value={termsTemplateHasAgreementDefaults(template) ? 'Yes' : 'No'} helper="Seed billing and chemical settings" />
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div>
                                <h2 className="text-xl font-bold text-slate-950">Agreement Defaults</h2>
                                <p className="mt-1 text-sm text-slate-500">These values are copied into draft agreements when this template is selected.</p>
                            </div>

                            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {templateDefaultRows(template).map(([label, value]) => (
                                    <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                                        <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</dd>
                                    </div>
                                ))}
                            </dl>

                            <p className="mt-4 truncate text-xs text-slate-400">{template.id}</p>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-950">Template Terms</h2>
                                    <p className="mt-1 text-sm text-slate-500">These lines are copied into service agreements that use this template.</p>
                                </div>
                            </div>

                            {clauses.length > 0 ? (
                                <div className="mt-4 space-y-3">
                                    {clauses.map((clause, index) => (
                                        <div key={clause.id} className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-500">
                                                {index + 1}
                                            </span>
                                            <p className="text-sm leading-6 text-slate-700">{getTermDescription(clause)}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                    No terms added yet.
                                </p>
                            )}
                        </section>
                    </>
                )}
            </div>
        </div>
    );
};

export default TermsTemplateDetail;
