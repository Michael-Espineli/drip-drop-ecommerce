import React, { useState, useEffect, useContext } from 'react';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { PlusIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Link, useNavigate } from 'react-router-dom';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { TermsTemplate } from '../../../utils/models/TermsTemplate';
import { listenTermsTemplates, saveTermsTemplate } from '../../../utils/terms/termsTemplateFirestore';
import FeatureInfoButton from '../../../components/FeatureInfoButton';

const TermsTemplates = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const navigate = useNavigate();
    const [templates, setTemplates] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentTemplate, setCurrentTemplate] = useState({ name: '', description: '', content: '' });

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
                console.error("Error fetching templates: ", error);
                toast.error("Failed to load terms templates.");
                setIsLoading(false);
            }
        );
    }, [recentlySelectedCompany]);

    const handleOpenModal = () => {
        if (!requirePermission("882", "create terms templates")) return;

        setCurrentTemplate({ name: '', description: '', content: '' });
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setCurrentTemplate({ name: '', description: '', content: '' });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!requirePermission("882", "create terms templates")) return;

        if (!currentTemplate.name) {
            toast.error('Template name is required.');
            return;
        }

        try {
            const newTemplate = new TermsTemplate(currentTemplate);
            await saveTermsTemplate(recentlySelectedCompany, newTemplate);
            toast.success(`Template created successfully!`);
            handleCloseModal();
            navigate(`/company/settings/terms-templates/${newTemplate.id}`);
        } catch (error) {
            console.error("Error saving template: ", error);
            toast.error('Failed to save template.');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-4">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
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
                        {can("882") && (
                            <button
                                onClick={handleOpenModal}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                <PlusIcon className="h-5 w-5" />
                                New Template
                            </button>
                        )}
                    </div>
                </section>

                {isLoading ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
                        Loading templates...
                    </div>
                ) : templates.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
                        <h3 className="text-lg font-semibold text-slate-950">No templates found</h3>
                        <p className="mt-1 text-sm text-slate-500">Get started by creating a new template.</p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                        <ul className="divide-y divide-slate-200">
                            {templates.map(template => (
                                <li key={template.id}>
                                    <Link to={`/company/settings/terms-templates/${template.id}`} className="block transition hover:bg-slate-50">
                                        <div className="flex items-center justify-between gap-4 px-5 py-4">
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-blue-700">{template.name}</p>
                                                <p className="mt-1 truncate text-sm text-slate-500">{template.description || 'No description'}</p>
                                            </div>
                                            <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-400" />
                                        </div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="w-full max-w-2xl rounded-lg bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <form onSubmit={handleSave}>
                            <div className="border-b border-slate-200 p-5">
                                <h2 className="text-xl font-bold text-slate-950">New Template</h2>
                            </div>
                            <div className="space-y-4 p-5">
                                <div>
                                    <label htmlFor="name" className="block text-sm font-semibold text-slate-700">Template Name</label>
                                    <input type="text" id="name" value={currentTemplate.name} onChange={(e) => setCurrentTemplate({...currentTemplate, name: e.target.value})} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" required/>
                                </div>
                                <div>
                                    <label htmlFor="description" className="block text-sm font-semibold text-slate-700">Description</label>
                                    <textarea id="description" value={currentTemplate.description} onChange={(e) => setCurrentTemplate({...currentTemplate, description: e.target.value})} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"></textarea>
                                </div>
                                <div>
                                    <label htmlFor="content" className="block text-sm font-semibold text-slate-700">Default Content</label>
                                    <textarea id="content" value={currentTemplate.content} onChange={(e) => setCurrentTemplate({...currentTemplate, content: e.target.value})} rows={8} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"></textarea>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
                                <button type="button" onClick={handleCloseModal} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
                                <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TermsTemplates;
