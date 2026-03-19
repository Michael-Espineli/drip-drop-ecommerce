import React, { useState, useEffect, useContext } from 'react';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { PlusIcon, PencilIcon, TrashIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { v4 as uuidv4 } from 'uuid';
import { useNavigate } from 'react-router-dom';

const TermsTemplates = () => {
    const db = getFirestore();
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();
    const [templates, setTemplates] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentTemplate, setCurrentTemplate] = useState({ name: '', description: '', content: '' });

    useEffect(() => {
        if (!recentlySelectedCompany) return;
        const fetchTemplates = async () => {
            setIsLoading(true);
            const templatesRef = collection(db, 'companies', recentlySelectedCompany, 'termsTemplates');
            const querySnapshot = await getDocs(templatesRef);
            const templatesList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTemplates(templatesList);
            setIsLoading(false);
        };
        fetchTemplates();
    }, [db, recentlySelectedCompany]);

    const handleOpenModal = () => {
        setCurrentTemplate({ name: '', description: '', content: '' });
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setCurrentTemplate({ name: '', description: '', content: '' });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!currentTemplate.name) {
            toast.error('Template name is required.');
            return;
        }

        const id = uuidv4();
        const docRef = doc(db, 'companies', recentlySelectedCompany, 'termsTemplates', id);
        
        try {
            const newTemplate = { ...currentTemplate, id };
            await setDoc(docRef, newTemplate);
            toast.success(`Template created successfully!`);
            setTemplates(prev => [...prev, newTemplate]);
            handleCloseModal();
            navigate(`/company/settings/terms-templates/${id}`);
        } catch (error) {
            console.error("Error saving template: ", error);
            toast.error('Failed to save template.');
        }
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Terms Templates</h1>
                    <button 
                        onClick={handleOpenModal}
                        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg shadow-sm hover:bg-blue-700">
                        <PlusIcon className="h-5 w-5 mr-2" />
                        New Template
                    </button>
                </div>

                {isLoading ? (
                    <p>Loading templates...</p>
                ) : templates.length === 0 ? (
                    <div className="text-center py-12 px-4 bg-white rounded-lg shadow">
                        <h3 className="text-lg font-medium text-gray-900">No templates found</h3>
                        <p className="mt-1 text-sm text-gray-500">Get started by creating a new template.</p>
                    </div>
                ) : (
                    <div className="bg-white shadow overflow-hidden sm:rounded-md">
                        <ul className="divide-y divide-gray-200">
                            {templates.map(template => (
                                <li key={template.id}>
                                    <a href={`/company/settings/terms-templates/${template.id}`} className="block hover:bg-gray-50">
                                        <div className="px-4 py-4 sm:px-6 flex items-center justify-between">
                                            <div className="truncate">
                                                <p className="font-medium text-blue-600 truncate">{template.name}</p>
                                                <p className="text-sm text-gray-500 truncate">{template.description || 'No description'}</p>
                                            </div>
                                            <div className="ml-2 shrink-0 flex">
                                                <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                                            </div>
                                        </div>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 bg-gray-600 bg-opacity-75 flex justify-center items-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                        <form onSubmit={handleSave}>
                             <div className="p-6">
                                <h2 className="text-2xl font-bold mb-4">New Template</h2>
                                <div className="space-y-4">
                                    <div>
                                        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Template Name</label>
                                        <input type="text" id="name" value={currentTemplate.name} onChange={(e) => setCurrentTemplate({...currentTemplate, name: e.target.value})} className="mt-1 w-full p-2 border rounded-md" required/>
                                    </div>
                                    <div>
                                        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
                                        <textarea id="description" value={currentTemplate.description} onChange={(e) => setCurrentTemplate({...currentTemplate, description: e.target.value})} rows={3} className="mt-1 w-full p-2 border rounded-md"></textarea>
                                    </div>
                                    <div>
                                        <label htmlFor="content" className="block text-sm font-medium text-gray-700">Default Content</label>
                                        <textarea id="content" value={currentTemplate.content} onChange={(e) => setCurrentTemplate({...currentTemplate, content: e.target.value})} rows={8} className="mt-1 w-full p-2 border rounded-md"></textarea>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-gray-50 px-6 py-3 flex justify-end gap-3">
                                <button type="button" onClick={handleCloseModal} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TermsTemplates;
