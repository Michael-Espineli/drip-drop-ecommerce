import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    ArrowLeftIcon,
    ChevronRightIcon,
    DocumentDuplicateIcon,
    MagnifyingGlassIcon,
    PlusIcon,
} from '@heroicons/react/24/outline';
import { Context } from '../../../context/AuthContext';
import FeatureInfoButton from '../../../components/FeatureInfoButton';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { SalesAgreementChemicalBillingMode } from '../../../utils/models/Sales';
import { TermsTemplate } from '../../../utils/models/TermsTemplate';
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
    duplicateTermsTemplate,
    listenTermsTemplates,
    saveTermsTemplate,
} from '../../../utils/terms/termsTemplateFirestore';

const emptyTemplate = {
    name: '',
    description: '',
    content: '',
    useCase: 'recurringService',
    billingFrequency: '',
    billingFrequencyCount: '',
    rateType: '',
    paymentTerms: '',
    chemicalBillingMode: '',
    chemicalBillingMixedSelectionMode: TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled,
    includedChemicalIds: [],
    separatelyBilledChemicalIds: [],
    chemicalBillingNotes: '',
};

const chemicalBillingModeOptions = [
    { value: SalesAgreementChemicalBillingMode.includedAll, label: 'Chemicals Included In Service' },
    { value: SalesAgreementChemicalBillingMode.billAllSeparately, label: 'Bill All Chemicals Separately' },
    { value: SalesAgreementChemicalBillingMode.mixed, label: 'Mixed Chemical Billing' },
];

const templatePreview = (template) => {
    const content = String(template?.content || '').trim();
    if (content) return content;

    return 'No default content saved yet.';
};

const optionLabel = (options, value) => (
    options.find((option) => option.value === value)?.label || ''
);

const templateDefaultChips = (template) => {
    const defaults = termsTemplateAgreementDefaults(template);

    return [
        defaults.billingFrequency && optionLabel(billingFrequencyOptions, defaults.billingFrequency),
        defaults.billingFrequencyCount && `Count ${defaults.billingFrequencyCount}`,
        defaults.rateType && optionLabel(rateTypeOptions, defaults.rateType),
        defaults.paymentTerms && optionLabel(paymentTermsOptions, defaults.paymentTerms),
        defaults.chemicalBillingMode && optionLabel(chemicalBillingModeOptions, defaults.chemicalBillingMode),
    ].filter(Boolean);
};

const StatCard = ({ label, value, helper }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
);

const TemplateCard = ({ template, canDuplicate, isDuplicating, onDuplicate }) => {
    const defaultChips = templateDefaultChips(template);

    return (
        <article className="flex min-h-[220px] flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-slate-950">{template.name || 'Terms Template'}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                        {template.description || 'No description added.'}
                    </p>
                </div>
                <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {termsTemplateUseCaseLabel(template.useCase || template.category)}
                </span>
            </div>

            <div className="mt-4 flex-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Default Content</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-700">{templatePreview(template)}</p>
            </div>

            {defaultChips.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {defaultChips.map((chip) => (
                        <span key={chip} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            {chip}
                        </span>
                    ))}
                </div>
            )}

            <p className="mt-3 truncate text-xs text-slate-400">{template.id}</p>

            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                {canDuplicate && (
                    <button
                        type="button"
                        onClick={() => onDuplicate(template)}
                        disabled={isDuplicating}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <DocumentDuplicateIcon className="h-4 w-4" />
                        {isDuplicating ? 'Duplicating...' : 'Duplicate'}
                    </button>
                )}
                <Link
                    to={`/company/settings/terms-templates/${template.id}`}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                    Open
                    <ChevronRightIcon className="h-4 w-4" />
                </Link>
            </div>
        </article>
    );
};

const TermsTemplates = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const navigate = useNavigate();
    const [templates, setTemplates] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentTemplate, setCurrentTemplate] = useState(emptyTemplate);
    const [search, setSearch] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [duplicatingTemplateId, setDuplicatingTemplateId] = useState('');

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setTemplates([]);
            setIsLoading(false);
            return undefined;
        }

        setIsLoading(true);
        return listenTermsTemplates(
            recentlySelectedCompany,
            (templatesList) => {
                setTemplates(templatesList);
                setIsLoading(false);
            },
            (error) => {
                console.error('Error fetching templates: ', error);
                toast.error('Failed to load terms templates.');
                setIsLoading(false);
            }
        );
    }, [recentlySelectedCompany]);

    const filteredTemplates = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return templates;

        return templates.filter((template) => [
            template.name,
            template.description,
            template.content,
            template.useCase,
            template.category,
            template.billingFrequency,
            template.rateType,
            template.paymentTerms,
            template.chemicalBillingMode,
            template.id,
        ].some((value) => String(value || '').toLowerCase().includes(query)));
    }, [search, templates]);

    const summary = useMemo(() => ({
        total: templates.length,
        withContent: templates.filter((template) => String(template.content || '').trim()).length,
        withDefaults: templates.filter((template) => termsTemplateHasAgreementDefaults(template)).length,
    }), [templates]);

    const handleOpenModal = () => {
        if (!requirePermission('882', 'create terms templates')) return;

        setCurrentTemplate(emptyTemplate);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setCurrentTemplate(emptyTemplate);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!requirePermission('882', 'create terms templates')) return;

        if (!recentlySelectedCompany) {
            toast.error('Select a company before creating a template.');
            return;
        }

        if (!currentTemplate.name.trim()) {
            toast.error('Template name is required.');
            return;
        }

        setIsSaving(true);

        try {
            const newTemplate = new TermsTemplate({
                ...currentTemplate,
                name: currentTemplate.name.trim(),
                description: currentTemplate.description.trim(),
                content: currentTemplate.content.trim(),
                useCase: currentTemplate.useCase || 'custom',
                category: currentTemplate.useCase || 'custom',
                billingFrequencyCount: currentTemplate.billingFrequencyCount
                    ? Math.max(Number(currentTemplate.billingFrequencyCount) || 1, 1)
                    : '',
                chemicalBillingNotes: currentTemplate.chemicalBillingNotes.trim(),
            });
            await saveTermsTemplate(recentlySelectedCompany, newTemplate);
            toast.success('Template created successfully!');
            handleCloseModal();
            navigate(`/company/settings/terms-templates/${newTemplate.id}`);
        } catch (error) {
            console.error('Error saving template: ', error);
            toast.error('Failed to save template.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDuplicate = async (template) => {
        if (!requirePermission('882', 'create terms templates')) return;

        if (!recentlySelectedCompany) {
            toast.error('Select a company before duplicating a template.');
            return;
        }

        setDuplicatingTemplateId(template.id);

        try {
            const duplicatedTemplate = await duplicateTermsTemplate(recentlySelectedCompany, template.id);
            toast.success(`${duplicatedTemplate.name} created.`);
            navigate(`/company/settings/terms-templates/${duplicatedTemplate.id}`);
        } catch (error) {
            console.error('Error duplicating template: ', error);
            toast.error(error.message || 'Failed to duplicate template.');
        } finally {
            setDuplicatingTemplateId('');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <Link to="/company/settings" className="app-back-link">
                                <ArrowLeftIcon className="h-4 w-4" />
                                Back to Settings
                            </Link>
                            <div className="mt-3 flex items-center gap-2">
                                <h1 className="text-3xl font-bold text-slate-950">Terms Templates</h1>
                                <FeatureInfoButton title="How Terms Templates Work" align="left">
                                    <p>
                                        Terms templates are saved under this company at
                                        {' '}<span className="font-semibold">companies/{'{companyId}'}/termsTemplates</span>.
                                        Each pool company can keep its own residential, commercial, weekly, twice-weekly, or custom service terms.
                                    </p>
                                    <p>
                                        When a service agreement or estimate is drafted, the selected template can seed the agreement terms,
                                        then the company can adjust the final wording for that customer.
                                    </p>
                                </FeatureInfoButton>
                            </div>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                Reusable agreement language for estimates, service agreements, and company-specific terms.
                            </p>
                        </div>

                        {can('882') && (
                            <button
                                type="button"
                                onClick={handleOpenModal}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                <PlusIcon className="h-5 w-5" />
                                New Template
                            </button>
                        )}
                    </div>
                </section>

                <section className="grid gap-4 sm:grid-cols-3">
                    <StatCard label="Templates" value={summary.total} helper="Saved terms records" />
                    <StatCard label="Default Copy" value={summary.withContent} helper="Templates with content" />
                    <StatCard label="Agreement Defaults" value={summary.withDefaults} helper="Templates that seed billing" />
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="relative">
                        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search name, description, content, or template ID"
                            className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                    </div>
                </section>

                {isLoading ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
                        Loading templates...
                    </div>
                ) : templates.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                        <h3 className="text-xl font-bold text-slate-950">No templates found</h3>
                        <p className="mt-2 text-sm text-slate-500">Create a template to seed new service agreement terms.</p>
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
                        No templates match that search.
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filteredTemplates.map((template) => (
                            <TemplateCard
                                key={template.id}
                                template={template}
                                canDuplicate={can('882')}
                                isDuplicating={duplicatingTemplateId === template.id}
                                onDuplicate={handleDuplicate}
                            />
                        ))}
                    </div>
                )}
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <form onSubmit={handleSave}>
                            <div className="border-b border-slate-200 p-5">
                                <h2 className="text-xl font-bold text-slate-950">New Template</h2>
                                <p className="mt-1 text-sm text-slate-500">Start with default content now, then add reusable term lines after saving.</p>
                            </div>
                            <div className="space-y-4 p-5">
                                <div>
                                    <label htmlFor="name" className="block text-sm font-semibold text-slate-700">Template Name</label>
                                    <input
                                        type="text"
                                        id="name"
                                        value={currentTemplate.name}
                                        onChange={(e) => setCurrentTemplate({ ...currentTemplate, name: e.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        required
                                    />
                                </div>
                                <div>
                                    <label htmlFor="description" className="block text-sm font-semibold text-slate-700">Description</label>
                                    <textarea
                                        id="description"
                                        value={currentTemplate.description}
                                        onChange={(e) => setCurrentTemplate({ ...currentTemplate, description: e.target.value })}
                                        rows={3}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="useCase" className="block text-sm font-semibold text-slate-700">Use Case</label>
                                    <select
                                        id="useCase"
                                        value={currentTemplate.useCase}
                                        onChange={(e) => setCurrentTemplate({ ...currentTemplate, useCase: e.target.value })}
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
                                        value={currentTemplate.content}
                                        onChange={(e) => setCurrentTemplate({ ...currentTemplate, content: e.target.value })}
                                        rows={8}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Agreement Defaults</h3>
                                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                                        <div>
                                            <label htmlFor="billingFrequency" className="block text-sm font-semibold text-slate-700">Billing Frequency</label>
                                            <select
                                                id="billingFrequency"
                                                value={currentTemplate.billingFrequency}
                                                onChange={(e) => setCurrentTemplate({ ...currentTemplate, billingFrequency: e.target.value })}
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
                                                value={currentTemplate.billingFrequencyCount}
                                                onChange={(e) => setCurrentTemplate({ ...currentTemplate, billingFrequencyCount: e.target.value })}
                                                placeholder="No default"
                                                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="rateType" className="block text-sm font-semibold text-slate-700">Rate Type</label>
                                            <select
                                                id="rateType"
                                                value={currentTemplate.rateType}
                                                onChange={(e) => setCurrentTemplate({ ...currentTemplate, rateType: e.target.value })}
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
                                                value={currentTemplate.paymentTerms}
                                                onChange={(e) => setCurrentTemplate({ ...currentTemplate, paymentTerms: e.target.value })}
                                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            >
                                                <option value="">No default</option>
                                                {paymentTermsOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="chemicalBillingMode" className="block text-sm font-semibold text-slate-700">Chemical Billing</label>
                                            <select
                                                id="chemicalBillingMode"
                                                value={currentTemplate.chemicalBillingMode}
                                                onChange={(e) => setCurrentTemplate({ ...currentTemplate, chemicalBillingMode: e.target.value })}
                                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            >
                                                <option value="">No default</option>
                                                {chemicalBillingModeOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {currentTemplate.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed && (
                                            <div>
                                                <label htmlFor="chemicalBillingMixedSelectionMode" className="block text-sm font-semibold text-slate-700">Mixed Billing Selection</label>
                                                <select
                                                    id="chemicalBillingMixedSelectionMode"
                                                    value={currentTemplate.chemicalBillingMixedSelectionMode}
                                                    onChange={(e) => setCurrentTemplate({ ...currentTemplate, chemicalBillingMixedSelectionMode: e.target.value })}
                                                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                >
                                                    {termsTemplateMixedChemicalBillingSelectionOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        <div className="sm:col-span-2">
                                            <label htmlFor="chemicalBillingNotes" className="block text-sm font-semibold text-slate-700">Chemical Billing Notes</label>
                                            <input
                                                id="chemicalBillingNotes"
                                                type="text"
                                                value={currentTemplate.chemicalBillingNotes}
                                                onChange={(e) => setCurrentTemplate({ ...currentTemplate, chemicalBillingNotes: e.target.value })}
                                                placeholder="tabs supplied by customer, phosphate billed separately"
                                                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    disabled={isSaving}
                                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSaving ? 'Saving...' : 'Create Template'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TermsTemplates;
