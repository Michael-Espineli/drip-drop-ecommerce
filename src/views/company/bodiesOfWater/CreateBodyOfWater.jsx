import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { collection, addDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';

const CreateBodyOfWater = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();

    const [name, setName] = useState('');
    const [gallons, setGallons] = useState('');
    const [material, setMaterial] = useState('');
    const [notes, setNotes] = useState('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!recentlySelectedCompany) {
            setError('No company selected. Please select a company before creating a body of water.');
            return;
        }

        if (!name) {
            setError('Name is a required field.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const collectionRef = collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater');
            await addDoc(collectionRef, {
                name,
                gallons: Number(gallons) || 0,
                material,
                notes,
            });

            alert('Body of Water created successfully!');
            navigate('/bodies-of-water'); // Assumes this is the path for the list

        } catch (err) {
            console.error('Error creating document: ', err);
            setError('Failed to create Body of Water.');
            setLoading(false);
        }
    };

    return (
        <div className='px-4 md:px-8 py-6 bg-gray-800 text-white min-h-screen'>
            <div className="w-full max-w-lg mx-auto">
                <h1 className="text-2xl font-bold mb-6">Create New Body of Water</h1>
                <form onSubmit={handleCreate} className="bg-gray-700 p-6 rounded-lg shadow-md">
                    <div className="mb-4">
                        <label htmlFor="name" className="block text-sm font-bold mb-2">Name</label>
                        <input
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full p-2 bg-gray-600 rounded-md border border-gray-500 focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                    <div className="mb-4">
                        <label htmlFor="gallons" className="block text-sm font-bold mb-2">Gallons</label>
                        <input
                            id="gallons"
                            type="number"
                            value={gallons}
                            onChange={(e) => setGallons(e.target.value)}
                            className="w-full p-2 bg-gray-600 rounded-md border border-gray-500 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div className="mb-4">
                        <label htmlFor="material" className="block text-sm font-bold mb-2">Material</label>
                        <input
                            id="material"
                            type="text"
                            value={material}
                            onChange={(e) => setMaterial(e.target.value)}
                            className="w-full p-2 bg-gray-600 rounded-md border border-gray-500 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div className="mb-4">
                        <label htmlFor="notes" className="block text-sm font-bold mb-2">Notes</label>
                        <textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full p-2 bg-gray-600 rounded-md border border-gray-500 focus:outline-none focus:border-blue-500"
                            rows="4"
                        />
                    </div>

                    {error && <p className="text-red-500 text-xs italic mb-4">{error}</p>}

                    <div className="flex items-center justify-between">
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline disabled:bg-blue-300"
                        >
                            {loading ? 'Creating...' : 'Create Body of Water'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateBodyOfWater;
