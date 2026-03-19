import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { Context } from '../../context/AuthContext';
import { BriefcaseIcon, BuildingOffice2Icon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import RecentChatsWidget from '../dashboard/components/RecentChatsWidget';
import InvitesWidget from '../dashboard/components/InvitesWidget'; // Import the new widget
 
const NoCompanySelected = () => {
    const { name } = useContext(Context);

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="w-full max-w-6xl mx-auto">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-800 mb-2">Welcome, {name}!</h1>
                    <p className="text-lg text-gray-600">What would you like to do today?</p>
                </div>

                {/* Main Action Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
                    <ActionCard
                        to="/browse-companies"
                        icon={<BriefcaseIcon className="w-10 h-10 text-blue-500" />}
                        title="Find a Company"
                        description="View pending invites or browse companies to join."
                        buttonText="Browse Companies"
                        buttonClass="bg-blue-600 hover:bg-blue-700"
                    />
                    {/* Update 4.1 the Markting Update */}
                    {/* <ActionCard
                        to="/job-postings"
                        icon={<ClipboardDocumentListIcon className="w-10 h-10 text-purple-500" />}
                        title="Job Postings"
                        description="Browse and apply for job openings."
                        buttonText="Find a Job"
                        buttonClass="bg-purple-500 hover:bg-purple-600"
                    /> */}
                    <ActionCard
                        to="/company/create-Info"
                        icon={<BuildingOffice2Icon className="w-10 h-10 text-green-500" />}
                        title="Start Your Own"
                        description="Create a company and start managing your business."
                        buttonText="Create Company"
                        buttonClass="bg-green-500 hover:bg-green-600"
                    />
                </div>

                {/* Lower Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2">
                        <RecentChatsWidget />
                    </div>
                    <div className="lg:col-span-1">
                        <InvitesWidget />
                    </div>
                </div>
            </div>
        </div>
    );
};

// Reusable Action Card Component
const ActionCard = ({ to, icon, title, description, buttonText, buttonClass }) => (
    <div className="bg-white shadow-lg rounded-lg p-6 flex flex-col items-center text-center transform hover:scale-105 transition-transform duration-300">
        <div className="bg-gray-100 p-4 rounded-full mb-4">
            {icon}
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-3">{title}</h2>
        <p className="text-gray-600 mb-5 text-sm flex-grow">{description}</p>
        <Link to={to} className="w-full">
            <button className={`w-full text-white font-bold py-2 px-4 rounded-lg transition-colors duration-300 ${buttonClass}`}>
                {buttonText}
            </button>
        </Link>
    </div>
);

export default NoCompanySelected;
