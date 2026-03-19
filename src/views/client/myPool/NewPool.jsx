import React, { useState, useContext } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { motion } from 'framer-motion';
import { HomeModernIcon } from '@heroicons/react/24/outline';

const NewPool = () => {
    const { user } = useContext(Context);
    const navigate = useNavigate();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        city: '',
        state: '',
        zipCode: ''
    });

    const handleChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name || !formData.address || !formData.city || !formData.state || !formData.zipCode) {
            toast.error('Please fill out all fields.');
            return;
        }

        setIsSubmitting(true);
        try {
            await addDoc(collection(db, 'serviceLocations'), {
                ...formData,
                userId: user.uid,
                createdAt: serverTimestamp(),
            });
            toast.success('New pool location added!');
            navigate('/client/my-pool');
        } catch (error) {
            toast.error('Failed to add new pool location.');
            console.error("Error adding document: ", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-2xl mx-auto bg-white rounded-xl shadow-2xl p-8"
            >
                <div className="flex flex-col items-center mb-6">
                     <HomeModernIcon className="w-12 h-12 text-teal-500 mb-2" />
                    <h1 className="text-3xl font-bold text-center text-gray-800">Add a New Pool Location</h1>
                    <p className="text-gray-500 mt-1">Enter the details for your new service location.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Location Name</label>
                        <input
                            type="text"
                            id="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="e.g., Main Street Pool"
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="address" className="block text-sm font-medium text-gray-700">Street Address</label>
                        <input
                            type="text"
                            id="address"
                            value={formData.address}
                            onChange={handleChange}
                            className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="123 Poolside Drive"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <label htmlFor="city" className="block text-sm font-medium text-gray-700">City</label>
                            <input
                                type="text"
                                id="city"
                                value={formData.city}
                                onChange={handleChange}
                                className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="state" className="block text-sm font-medium text-gray-700">State</label>
                            <input
                                type="text"
                                id="state"
                                value={formData.state}
                                onChange={handleChange}
                                className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="zipCode" className="block text-sm font-medium text-gray-700">Zip Code</label>
                            <input
                                type="text"
                                id="zipCode"
                                value={formData.zipCode}
                                onChange={handleChange}
                                className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                required
                            />
                        </div>
                    </div>

                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full font-semibold py-3 px-4 rounded-lg text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50 transition-all shadow-lg"
                    >
                        {isSubmitting ? 'Saving...' : 'Save Location'}
                    </motion.button>
                </form>
            </motion.div>
        </div>
    );
};

export default NewPool;
