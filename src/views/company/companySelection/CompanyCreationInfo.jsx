import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

const CompanyCreationInfo = () => {
    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-8">
                <h1 className="text-4xl font-extrabold text-gray-900 mb-4 text-center">Create Your Company on Drip Drop</h1>
                <p className="text-lg text-gray-600 mb-8 text-center">
                    Streamline your operations, simplify billing, and enhance customer management with our powerful software solutions.
                </p>

                <div className="grid md:grid-cols-2 gap-8 items-center mb-10">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 mb-4">Unlock Your Business Potential</h2>
                        <p className="text-gray-700 mb-6">
                            Whether you are a solo technician, a growing business, or a large commercial operation, our platform is designed to scale with your needs. Take control of your business and drive growth with Drip Drop.
                        </p>
                        <ul className="space-y-3">
                            <FeatureItem text="Unlimited Users" />
                            <FeatureItem text="Chemical Tracking & History" />
                            <FeatureItem text="Automated Customer Reports" />
                            <FeatureItem text="Optimized Routing & Scheduling" />
                            <FeatureItem text="Job & Work Order Management" />
                        </ul>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-6">
                        <img src="/path/to/your/illustration.svg" alt="Business Growth Illustration" className="w-full h-auto"/>
                    </div>
                </div>

                <div className="text-center mt-12">
                    <Link to='/company/create-new' 
                        className="inline-block bg-blue-600 text-white px-10 py-4 rounded-lg font-semibold text-lg hover:bg-blue-700 transition-transform transform hover:scale-105 shadow-lg"
                    >
                        Get Started
                    </Link>
                    <p className="mt-4 text-sm text-gray-600">All new companies start on the Free plan. You can upgrade at any time.</p>
                </div>
            </div>
        </div>
    );
};

const FeatureItem = ({ text }) => (
    <li className="flex items-center">
        <CheckCircleIcon className="w-6 h-6 text-green-500 mr-3 flex-shrink-0" />
        <span className="text-gray-700">{text}</span>
    </li>
);

export default CompanyCreationInfo;
