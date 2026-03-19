import React, { useState } from 'react';
import ReadingsAndDosagesHistory from './ReadingsAndDosagesHistory';

// Placeholder components
const ServiceStopsHistory = () => <div className="text-center p-8 border rounded-md bg-gray-50">Service Stops History (Placeholder)</div>;
const RepairsHistory = () => <div className="text-center p-8 border rounded-md bg-gray-50">Repairs History (Placeholder)</div>;

const CustomerHistory = ({ customerId }) => {
    const [activeTab, setActiveTab] = useState('readings'); // 'readings', 'serviceStops', 'repairs'

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <h1 className="text-2xl font-bold mb-4">Customer History</h1>
            <div className="flex border-b">
                <button
                    className={`py-2 px-4 font-semibold ${activeTab === 'readings' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    onClick={() => setActiveTab('readings')}
                >
                    Readings and Dosages
                </button>
                <button
                    className={`py-2 px-4 font-semibold ${activeTab === 'serviceStops' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    onClick={() => setActiveTab('serviceStops')}
                >
                    Service Stops
                </button>
                <button
                    className={`py-2 px-4 font-semibold ${activeTab === 'repairs' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    onClick={() => setActiveTab('repairs')}
                >
                    Repairs
                </button>
            </div>
            <div className="mt-4">
                {activeTab === 'readings' && <ReadingsAndDosagesHistory customerId={customerId} />}
                {activeTab === 'serviceStops' && <ServiceStopsHistory />}
                {activeTab === 'repairs' && <RepairsHistory />}
            </div>
        </div>
    );
};

export default CustomerHistory;
