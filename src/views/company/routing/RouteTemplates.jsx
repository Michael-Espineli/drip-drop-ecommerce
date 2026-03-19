import React, { useState, useEffect, useContext, useMemo } from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { collection, getDocs, query, where, doc, deleteDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const RouteTemplates = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [routeTemplates, setRouteTemplates] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const navigate = useNavigate();

    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchRouteTemplates = async () => {
            setIsLoading(true);
            const templatesRef = collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes');

            try {
                const querySnapshot = await getDocs(templatesRef);
                const templates = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setRouteTemplates(templates);
            } catch (error) {
                console.error("Error fetching route templates: ", error);
                toast.error("Failed to fetch route templates.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchRouteTemplates();
    }, [recentlySelectedCompany]);

    const handleTemplateSelect = (template) => {
        setSelectedTemplate(template);
        setIsDeleteModalOpen(false);
    }

    const sortedStops = useMemo(() => {
        if (!selectedTemplate || !selectedTemplate.order) return [];
        return [...selectedTemplate.order].sort((a, b) => a.order - b.order);
    }, [selectedTemplate]);

    const handleEdit = () => {
        if (!selectedTemplate) return;
        navigate('/company/routing/route-builder', { state: { templateToEdit: selectedTemplate } });
    };

    const handleDelete = async () => {
        if (!selectedTemplate) return;
        setIsDeleting(true);
        try {
            const templateRef = doc(db, 'companies', recentlySelectedCompany, 'recurringRoutes', selectedTemplate.id);
            await deleteDoc(templateRef);
            toast.success("Template deleted successfully!");
            setRouteTemplates(prev => prev.filter(t => t.id !== selectedTemplate.id));
            setSelectedTemplate(null);
            setIsDeleteModalOpen(false);
        } catch (error) {
            console.error("Error deleting template: ", error);
            toast.error("Failed to delete template.");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                <h2 className="text-2xl font-bold mb-4">Route Templates</h2>
                {isLoading ? (
                     <div className="flex justify-center items-center h-64"><p className='text-lg'>Loading templates...</p></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-1 bg-gray-800 p-4 rounded-lg">
                            <h3 className="text-xl font-semibold mb-3 border-b border-gray-600 pb-2">Saved Templates</h3>
                            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                                {routeTemplates.map(template => (
                                    <div key={template.id} onClick={() => handleTemplateSelect(template)} className={`p-3 rounded-md cursor-pointer transition-all duration-200 ${selectedTemplate?.id === template.id ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                                        <p className="font-bold">{template.description || `Route for ${template.day}`}</p>
                                        <p className="text-sm text-gray-400">Tech: {template.tech}</p>
                                        <p className="text-sm text-gray-400">{template.order?.length || 0} Stops</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-gray-800 p-4 rounded-lg">
                            {selectedTemplate ? (
                                <div>
                                    <div className='flex justify-between items-start'>
                                        <h3 className="text-xl font-semibold mb-3 border-b border-gray-600 pb-2">Template Details</h3>
                                        <div className="flex space-x-3">
                                            <button onClick={handleEdit} className='bg-blue-600 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-700'>Edit</button>
                                            <button onClick={() => setIsDeleteModalOpen(true)} className='bg-red-600 text-white font-bold py-2 px-4 rounded-md hover:bg-red-700'>Delete</button>
                                        </div>
                                    </div>
                                    <div className="bg-gray-700 p-4 rounded-md mt-4">
                                        <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>
                                            <p><span className="font-bold">Description:</span> {selectedTemplate.description}</p>
                                            <p><span className="font-bold">Day:</span> {selectedTemplate.day}</p>
                                            <p><span className="font-bold">Technician:</span> {selectedTemplate.tech}</p>
                                            <p><span className="font-bold">Total Stops:</span> {selectedTemplate.order?.length || 0}</p>
                                        </div>
                                        <h4 className="font-bold mt-5 text-lg border-t border-gray-600 pt-4">Stop Order</h4>
                                        <div className='mt-3 space-y-2 max-h-[45vh] overflow-y-auto pr-2'>
                                            {sortedStops.map((stop) => (
                                                <div key={stop.id} className='bg-gray-600 p-3 rounded-md flex items-center'>
                                                    <span className='text-lg font-bold mr-4 bg-gray-800 w-8 h-8 flex items-center justify-center rounded-full'>{stop.order}</span>
                                                    <div>
                                                        <p className="font-semibold">{stop.customerName}</p>
                                                        <p className="text-sm text-gray-400">Location ID: {stop.locationId}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full bg-gray-900/50 rounded-md"><p className="text-gray-400 text-lg">Select a template to view details</p></div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {isDeleteModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl text-white">
                        <h3 className="text-xl font-bold mb-4">Confirm Deletion</h3>
                        <p>Are you sure you want to delete the template "{selectedTemplate?.description}"? This action cannot be undone.</p>
                        <div className="flex justify-end space-x-4 mt-6">
                            <button onClick={() => setIsDeleteModalOpen(false)} className="bg-gray-600 py-2 px-4 rounded-md hover:bg-gray-500">Cancel</button>
                            <button onClick={handleDelete} disabled={isDeleting} className="bg-red-600 py-2 px-4 rounded-md hover:bg-red-700 disabled:bg-red-400">
                                {isDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RouteTemplates;
