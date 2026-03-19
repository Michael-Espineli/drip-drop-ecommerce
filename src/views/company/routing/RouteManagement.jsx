
import React, { useState, useEffect, useContext, useMemo } from "react";
import { query, collection, getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';
import Select from 'react-select';
import toast from 'react-hot-toast';

const RouteTemplateCard = ({ template, onEdit }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200 hover:shadow-xl transition-shadow">
        <div className="flex justify-between items-start mb-4">
            <h3 className="font-bold text-lg text-gray-800 flex-grow pr-4">{template.description}</h3>
            <button 
                onClick={() => onEdit(template)} 
                className='bg-blue-100 text-blue-800 font-semibold py-1 px-4 rounded-lg hover:bg-blue-200 text-sm transition-colors'>
                Edit
            </button>
        </div>
        <div className="space-y-3 text-sm">
            <div className="flex items-center">
                <span className="font-semibold text-gray-500 w-24">Technician:</span>
                <span className="text-gray-800 font-medium">{template.tech}</span>
            </div>
            <div className="flex items-center">
                <span className="font-semibold text-gray-500 w-24">Day of Week:</span>
                <span className="text-gray-800 font-medium">{template.day}</span>
            </div>
            <div className="flex items-center">
                <span className="font-semibold text-gray-500 w-24">Stops:</span>
                <span className="text-gray-800 font-medium">{template.order?.length || 0}</span>
            </div>
        </div>
    </div>
);

const RouteManagement = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();
    
    const [allTemplates, setAllTemplates] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    // Filtering state
    const [dayFilter, setDayFilter] = useState(null);
    const [techFilter, setTechFilter] = useState(null);

    const dayOptions = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => ({ value: d, label: d }));

    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const routesQuery = query(collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes'));
                const routesSnapshot = await getDocs(routesQuery);
                const templates = routesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setAllTemplates(templates);

                const techQuery = query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'));
                const techSnapshot = await getDocs(techQuery);
                const techList = techSnapshot.docs.map(doc => ({ value: doc.data().userId, label: doc.data().userName }));
                setTechnicians(techList);

            } catch (error) {
                console.error("Error fetching route templates: ", error);
                toast.error("Failed to load route templates.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [recentlySelectedCompany]);

    const filteredTemplates = useMemo(() => {
        return allTemplates.filter(template => {
            const dayMatch = !dayFilter || template.day === dayFilter.value;
            const techMatch = !techFilter || template.techId === techFilter.value;
            return dayMatch && techMatch;
        });
    }, [allTemplates, dayFilter, techFilter]);

    const handleEdit = (template) => {
        navigate('/company/route-builder', { state: { templateToEdit: template } });
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Route Templates</h1>
                        <p className="text-gray-600 mt-1">Manage and organize your recurring route templates.</p>
                    </div>
                    <button
                        onClick={() => navigate('/company/route-builder')}
                        className='mt-4 sm:mt-0 py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all'>
                        Create New Template
                    </button>
                </header>

                <div className="bg-white p-4 rounded-2xl shadow-lg mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <h3 className="md:col-span-1 font-semibold text-gray-700 my-auto">Filter templates:</h3>
                        <Select options={dayOptions} value={dayFilter} onChange={setDayFilter} placeholder="Filter by day..." isClearable />
                        <Select options={technicians} value={techFilter} onChange={setTechFilter} placeholder="Filter by technician..." isLoading={isLoading} isClearable />
                    </div>
                </div>

                {isLoading ? (
                    <div className="text-center py-10"><p className="text-gray-500">Loading templates...</p></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredTemplates.length > 0 ? (
                            filteredTemplates.map(template => (
                                <RouteTemplateCard key={template.id} template={template} onEdit={handleEdit} />
                            ))
                        ) : (
                            <div className="col-span-full text-center py-12 bg-white rounded-2xl shadow-lg">
                                <h3 className="text-xl font-semibold text-gray-700">No Route Templates Found</h3>
                                <p className="text-gray-500 mt-2">Get started by creating a new template or adjust your filters.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RouteManagement;
