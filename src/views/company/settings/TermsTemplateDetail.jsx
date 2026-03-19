import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFirestore, doc, getDoc, updateDoc, deleteDoc, collection, addDoc, getDocs, deleteDoc as deleteClauseDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ArrowLeftIcon, PencilIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline';

const TermsTemplateDetail = () => {
    const { templateId } = useParams();
    const navigate = useNavigate();
    const db = getFirestore();
    const { recentlySelectedCompany } = useContext(Context);

    const [template, setTemplate] = useState(null);
    const [clauses, setClauses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editedTemplate, setEditedTemplate] = useState({ name: '', description: '', content: '' });
    const [newClause, setNewClause] = useState('');

    useEffect(() => {
        if (!recentlySelectedCompany || !templateId) return;
        
        const fetchTemplateAndClauses = async () => {
            setIsLoading(true);
            const templateRef = doc(db, 'companies', recentlySelectedCompany, 'termsTemplates', templateId);
            const clausesRef = collection(templateRef, 'clauses');

            try {
                const templateSnap = await getDoc(templateRef);
                if (templateSnap.exists()) {
                    const templateData = templateSnap.data();
                    setTemplate(templateData);
                    setEditedTemplate(templateData);
                } else {
                    toast.error("Template not found.");
                    navigate("/company/settings/terms-templates");
                }

                const clausesSnap = await getDocs(clausesRef);
                const clausesList = clausesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setClauses(clausesList);

            } catch (error) {
                console.error("Error fetching data: ", error);
                toast.error("Failed to fetch template details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchTemplateAndClauses();
    }, [db, recentlySelectedCompany, templateId, navigate]);

    const handleUpdate = async (e) => {
        e.preventDefault();
        const templateRef = doc(db, 'companies', recentlySelectedCompany, 'termsTemplates', templateId);
        try {
            await updateDoc(templateRef, editedTemplate);
            setTemplate(editedTemplate);
            setIsEditing(false);
            toast.success("Template updated successfully!");
        } catch (error) {
            console.error("Error updating template: ", error);
            toast.error("Failed to update template.");
        }
    };

    const handleDelete = async () => {
        if (window.confirm('Are you sure you want to delete this template and all its clauses?')) {
            const templateRef = doc(db, 'companies', recentlySelectedCompany,  'termsTemplates', templateId);
            try {
                await deleteDoc(templateRef);
                toast.success("Template deleted successfully!");
                navigate("/company/settings/terms-templates");
            } catch (error) {
                console.error("Error deleting template: ", error);
                toast.error("Failed to delete template.");
            }
        }
    };

    const handleAddClause = async (e) => {
        e.preventDefault();
        if (!newClause.trim()) return;

        const clausesRef = collection(db, 'companies', recentlySelectedCompany, 'termsTemplates', templateId, 'terms');
        try {
            const docRef = await addDoc(clausesRef, { text: newClause });
            setClauses([...clauses, { id: docRef.id, text: newClause }]);
            setNewClause('');
            toast.success("Clause added!");
        } catch (error) {
            console.error("Error adding clause: ", error);
            toast.error("Failed to add clause.");
        }
    };

    const handleDeleteClause = async (clauseId) => {
        const clauseRef = doc(db, 'companies', recentlySelectedCompany, 'termsTemplates', templateId, 'terms', clauseId);
        try {
            await deleteClauseDoc(clauseRef);
            setClauses(clauses.filter(c => c.id !== clauseId));
            toast.success("Clause deleted!");
        } catch (error) {
            console.error("Error deleting clause: ", error);
            toast.error("Failed to delete clause.");
        }
    };

    if (isLoading) {
        return <div className="p-8">Loading...</div>;
    }

    if (!template) {
        return null;
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <Link to="/company/settings/terms-templates" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6">
                    <ArrowLeftIcon className="h-5 w-5" />
                    Back to Templates
                </Link>

                {isEditing ? (
                    <form onSubmit={handleUpdate} className="bg-white p-8 rounded-2xl shadow-lg mb-8">
                        <div className="space-y-4 mb-6">
                             <div>
                                <label htmlFor="name" className="block text-sm font-medium text-gray-700">Template Name</label>
                                <input type="text" id="name" value={editedTemplate.name} onChange={e => setEditedTemplate({...editedTemplate, name: e.target.value})} className="mt-1 w-full p-2 border rounded-md" required />
                            </div>
                            <div>
                                <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
                                <textarea id="description" value={editedTemplate.description} onChange={e => setEditedTemplate({...editedTemplate, description: e.target.value})} rows={3} className="mt-1 w-full p-2 border rounded-md"></textarea>
                            </div>
                            <div>
                                <label htmlFor="content" className="block text-sm font-medium text-gray-700">Default Content</label>
                                <textarea id="content" value={editedTemplate.content} onChange={e => setEditedTemplate({...editedTemplate, content: e.target.value})} rows={10} className="mt-1 w-full p-2 border rounded-md"></textarea>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => setIsEditing(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Save Changes</button>
                        </div>
                    </form>
                ) : (
                    <div className="bg-white p-8 rounded-2xl shadow-lg mb-8">
                        <div className="flex justify-between items-start">
                            <div>
                                <h1 className="text-3xl font-bold text-gray-900">{template.name}</h1>
                                <p className="mt-2 text-sm text-gray-500 max-w-2xl">{template.description}</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setIsEditing(true)} className="p-2 text-blue-600 hover:text-blue-800"><PencilIcon className="h-5 w-5" /></button>
                                <button onClick={handleDelete} className="p-2 text-red-600 hover:text-red-800"><TrashIcon className="h-5 w-5" /></button>
                            </div>
                        </div>
                        <div className="mt-6 border-t border-gray-200 pt-6">
                             <h3 className="text-lg font-semibold text-gray-800">Default Content</h3>
                            <p className="mt-2 text-gray-600 whitespace-pre-wrap">{template.content || "No default content provided."}</p>
                        </div>
                    </div>
                )}

                 <div className="bg-white p-8 rounded-2xl shadow-lg">
                     <h2 className="text-2xl font-bold text-gray-900 mb-6">Template Clauses</h2>
                     
                    <form onSubmit={handleAddClause} className="flex gap-4 mb-6">
                        <input type="text" value={newClause} onChange={e => setNewClause(e.target.value)} placeholder="Enter new clause text" className="flex-grow p-2 border rounded-md" />
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md inline-flex items-center"><PlusIcon className="h-5 w-5 mr-2"/>Add</button>
                    </form>

                    {clauses.length > 0 ? (
                        <ul className="divide-y divide-gray-200">
                            {clauses.map(clause => (
                                <li key={clause.id} className="py-3 flex justify-between items-center">
                                    <p className="text-gray-800">{clause.text}</p>
                                    <button onClick={() => handleDeleteClause(clause.id)} className="text-red-500 hover:text-red-700">
                                        <TrashIcon className="h-5 w-5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-center text-gray-500 py-4">No clauses added yet.</p>
                    )}
                 </div>
            </div>
        </div>
    );
};

export default TermsTemplateDetail;
