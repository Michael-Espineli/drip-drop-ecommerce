import React, { useState, useContext, useEffect, useCallback } from 'react';
import { db } from '../../../../utils/config';
import { collection, query, onSnapshot, doc, updateDoc, addDoc, deleteDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Context } from '../../../../context/AuthContext';
import { toast } from 'react-hot-toast';

// Reusable Components for Modern UI
const Card = ({ children, onClick }) => (
    <div onClick={onClick} className={`bg-white p-4 rounded-xl shadow-md border border-gray-200 cursor-pointer hover:shadow-lg hover:border-blue-500 transition-all duration-300`}>
        {children}
    </div>
);

const Pill = ({ children, color = 'blue' }) => (
    <span className={`px-3 py-1 text-xs font-semibold rounded-full bg-${color}-100 text-${color}-800`}>
        {children}
    </span>
);

const Button = ({ children, onClick, color = 'blue', disabled = false }) => (
    <button 
        onClick={onClick} 
        disabled={disabled}
        className={`px-4 py-2 font-semibold text-white bg-${color}-600 rounded-lg shadow-md hover:bg-${color}-700 focus:outline-none focus:ring-2 focus:ring-${color}-500 focus:ring-opacity-75 disabled:bg-gray-400 transition-colors`}>
        {children}
    </button>
);

const Input = (props) => (
    <input {...props} className="w-full p-2 border-2 border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition" />
);

// Main Component
const ReadingsAndDosages = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [activeTab, setActiveTab] = useState('Readings');
    const [readings, setReadings] = useState([]);
    const [dosages, setDosages] = useState([]);
    const [selectedItem, setSelectedItem] = useState(null);
    const [loading, setLoading] = useState(true);

    // Data Fetching
    useEffect(() => {
        if (!recentlySelectedCompany) return;
        setLoading(true);

        const qReadings = query(collection(db, 'companies', recentlySelectedCompany, 'settings', 'readings', 'readings'));
        const qDosages = query(collection(db, 'companies', recentlySelectedCompany,  'settings', 'dosages', 'dosages'));

        const unsubReadings = onSnapshot(qReadings, snap => {
            setReadings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, err => toast.error('Could not fetch readings.'));

        const unsubDosages = onSnapshot(qDosages, snap => {
            setDosages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, err => toast.error('Could not fetch dosages.'));

        return () => {
            unsubReadings();
            unsubDosages();
        };
    }, [recentlySelectedCompany]);

    const handleSelectItem = (item, type) => {
        setSelectedItem({ ...item, type });
    };

    if (selectedItem) {
        return <DetailView item={selectedItem} onBack={() => setSelectedItem(null)} companyId={recentlySelectedCompany} />;
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <h1 className='text-3xl font-bold text-gray-900 mb-6'>Readings & Dosages</h1>

                <div className="flex space-x-2 border-b-2 border-gray-200 mb-6">
                    <TabButton title="Readings" isActive={activeTab === 'Readings'} onClick={() => setActiveTab('Readings')} />
                    <TabButton title="Dosages" isActive={activeTab === 'Dosages'} onClick={() => setActiveTab('Dosages')} />
                </div>

                {loading ? <p>Loading...</p> : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(activeTab === 'Readings' ? readings : dosages).map(item => (
                             <Card key={item.id} onClick={() => handleSelectItem(item, activeTab)}>
                                <h3 className="font-bold text-lg text-gray-800">{item.name}</h3>
                                <p className="text-sm text-gray-500 mb-3">{activeTab === 'Readings' ? `UOM: ${item.UOM}` : `Rate: $${item.rate}`}</p>
                                <div className="flex space-x-2">
                                    {item.linkedDosage && <Pill color="green">Linked</Pill>}
                                    <Pill color="gray">{item.amount?.length || 0} presets</Pill>
                                </div>
                             </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const TabButton = ({ title, isActive, onClick }) => (
    <button onClick={onClick} className={`px-4 py-2 text-lg font-semibold transition-colors duration-300 ${isActive ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-blue-500'}`}>
        {title}
    </button>
);

// Detail View Component
const DetailView = ({ item, onBack, companyId }) => {
    const [amountInput, setAmountInput] = useState('');

    const handleAddAmount = async () => {
        if (!amountInput || isNaN(amountInput)) {
            toast.error('Please enter a valid number.');
            return;
        }

        const collectionName = item.type === 'Readings' ? 'settings/readings/readings' : 'settings/dosages/dosages';
        const docRef = doc(db, 'companies', companyId, collectionName, item.id);
        const toastId = toast.loading('Adding amount...');

        try {
            await updateDoc(docRef, { amount: arrayUnion(amountInput) });
            // Note: For sorting, a cloud function trigger on write would be more robust.
            toast.success('Amount added!', { id: toastId });
            setAmountInput('');
        } catch (error) {
            toast.error('Failed to add amount.', { id: toastId });
            console.error(error);
        }
    };

    const handleDeleteAmount = async (amount) => {
        const collectionName = item.type === 'Readings' ? 'settings/readings/readings' : 'settings/dosages/dosages';
        const docRef = doc(db, 'companies', companyId, collectionName, item.id);
        const toastId = toast.loading('Deleting amount...');

        try {
            await updateDoc(docRef, { amount: arrayRemove(amount) });
            toast.success('Amount deleted!', { id: toastId });
        } catch (error) {
            toast.error('Failed to delete amount.', { id: toastId });
        }
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <button onClick={onBack} className="mb-6 text-blue-600 font-semibold">&larr; Back to list</button>
                
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-200">
                        <h1 className="text-3xl font-bold text-gray-800">{item.name}</h1>
                        <p className="text-gray-600">{item.type === 'Readings' ? `Unit of Measurement: ${item.UOM}` : `Strength: ${item.strength}`}</p>
                    </div>

                    <div className="p-6">
                        <h2 class="text-xl font-bold text-gray-800 mb-4">Preset Amounts</h2>
                        <div className="flex gap-4 mb-6">
                            <Input type="text" placeholder="Enter new amount" value={amountInput} onChange={e => setAmountInput(e.target.value)} />
                            <Button onClick={handleAddAmount}>Add</Button>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            {item.amount && item.amount.length > 0 ? (
                                item.amount.sort((a,b) => a-b).map(amt => (
                                    <div key={amt} className="flex items-center justify-between bg-gray-100 rounded-lg pl-4 pr-2 py-2">
                                        <span className="font-semibold mr-3">{amt}</span>
                                        <button onClick={() => handleDeleteAmount(amt)} className="text-red-500 hover:text-red-700 font-bold text-xl">&times;</button>
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-500">No preset amounts added yet.</p>
                            )}
                        </div>
                    </div>

                     <div className="p-6 border-t border-gray-200">
                        <h2 class="text-xl font-bold text-gray-800 mb-4">Details</h2>
                        {item.type === 'Readings' ? (
                            <div className="space-y-2">
                                <p><span className="font-semibold">Linked Dosage:</span> {item.linkedDosage || 'None'}</p>
                                <p><span className="font-semibold">High Warning:</span> {item.highWarning}</p>
                                <p><span className="font-semibold">Low Warning:</span> {item.lowWarning}</p>
                            </div>
                        ) : (
                             <div className="space-y-2">
                                <p><span className="font-semibold">Rate:</span> ${item.rate}</p>
                                <p><span className="font-semibold">Linked Item ID:</span> {item.linkedItemId || 'None'}</p>
                             </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReadingsAndDosages;
