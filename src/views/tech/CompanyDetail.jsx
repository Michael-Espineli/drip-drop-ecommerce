import React, { useState, useEffect, useContext } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import { MapPinIcon, CheckCircleIcon, ChatBubbleBottomCenterTextIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';

const CompanyDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useContext(Context);
    const [company, setCompany] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchCompany = async () => {
            if (!id) return;
            setLoading(true);
            try {
                const companyDocRef = doc(db, 'companies', id);
                const companyDocSnap = await getDoc(companyDocRef);

                if (companyDocSnap.exists()) {
                    setCompany({ id: companyDocSnap.id, ...companyDocSnap.data() });
                } else {
                    console.error("No such company!");
                    setCompany(null);
                }
            } catch (error) {
                console.error("Error fetching company details: ", error);
            }
            setLoading(false);
        };

        fetchCompany();
    }, [id]);

    const handleInitiateChat = () => {
        if (!user) {
            console.error("User not logged in");
            // Optionally navigate to login page
            return;
        }
        if (!company) {
            console.error("No Company Found");
            // Optionally navigate to login page
            return;
        }
        navigate(`/company/chat/initiate/${company.ownerId}`);
    };

    if (loading) {
        return (
            <div className="w-full min-h-screen bg-gray-50 flex items-center justify-center">
                <p className="text-gray-600 text-lg">Loading company details...</p>
            </div>
        );
    }

    if (!company) {
        return (
            <div className="w-full min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-600 text-lg mb-4">Company not found.</p>
                    <Link to="/browse-companies" className="text-blue-600 hover:underline">
                        &larr; Back to Browse Companies
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to="/browse-companies" className="flex items-center text-gray-600 hover:text-gray-800 font-medium">
                        <ArrowLeftIcon className="w-5 h-5 mr-2" />
                        Back to Browse
                    </Link>
                </div>

                <div className="bg-white shadow-lg rounded-xl p-8 mb-8">
                    <div className="flex flex-col sm:flex-row items-start gap-6 mb-6">
                        {company.logoUrl && (
                            <img src={company.logoUrl} alt={`${company.name} logo`} className="w-24 h-24 rounded-full border border-gray-200 object-cover flex-shrink-0" />
                        )}
                        <div>
                            <h1 className="text-4xl font-extrabold text-gray-900">{company.name}</h1>
                            <p className="text-lg text-gray-600 mt-2">{company.description}</p>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 border-t border-gray-200 pt-6">
                        <div>
                            <h4 className="font-bold text-gray-700 mb-1">Industry</h4>
                            <p className="text-gray-600">{company.industry || 'N/A'}</p>
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-700 mb-1">Company Size</h4>
                            <p className="text-gray-600">{company.size || 'N/A'}</p>
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-700 mb-1">Region</h4>
                            <div className="flex items-center text-gray-600">
                                <MapPinIcon className="w-5 h-5 mr-2 text-gray-400" />
                                <span>{company.region || 'N/A'}</span>
                            </div>
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-700 mb-1">Hiring Status</h4>
                            {company.hiring ? (
                                <div className="flex items-center text-green-600 font-semibold">
                                    <CheckCircleIcon className="w-5 h-5 mr-2" />
                                    <span>Actively Hiring</span>
                                </div>
                            ) : (
                                <p className="text-gray-600">Not currently hiring</p>
                            )}
                        </div>
                    </div>
                    
                    <div className="mt-8 flex justify-center">
                         <button 
                            onClick={handleInitiateChat}
                            className="w-full sm:w-auto bg-blue-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-blue-700 transition-transform transform hover:scale-105 duration-300 flex items-center justify-center gap-2">
                            <ChatBubbleBottomCenterTextIcon className="w-6 h-6" />
                            <span>Chat with this Company</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CompanyDetail;
