import React, { useState, useContext } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';

const NewChat = ({ closeModal }) => {
    const { user } = useContext(Context);
    const [searchTerm, setSearchTerm] = useState('');
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchTerm.trim()) return;
        setLoading(true);

        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('firstName', '>=', searchTerm), where('firstName', '<=', searchTerm + '\uf8ff'));
        
        const querySnapshot = await getDocs(q);
        const userList = querySnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(u => u.id !== user.uid); // Exclude self

        setUsers(userList);
        setLoading(false);
    };

    const handleUserSelect = (selectedUser) => {
        closeModal();
        navigate(`/company/chat/initiate/${selectedUser.id}`);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="text-xl font-semibold text-gray-800">Start a New Chat</h3>
                    <button onClick={closeModal} className="p-2 text-gray-500 hover:text-gray-700">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6">
                    <form onSubmit={handleSearch} className="flex items-center gap-3 mb-4">
                        <input 
                            type="text"
                            placeholder="Search for a user..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="flex-1 w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button type="submit" className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            <MagnifyingGlassIcon className="w-6 h-6" />
                        </button>
                    </form>

                    <div className="max-h-64 overflow-y-auto">
                        {loading ? <p>Loading...</p> : (
                            <ul>
                                {users.map(u => (
                                    <li key={u.id} onClick={() => handleUserSelect(u)} className="p-3 flex items-center gap-4 hover:bg-gray-50 rounded-lg cursor-pointer">
                                        <div className="w-10 h-10 bg-gray-200 rounded-full overflow-hidden">
                                            {u.profileImageUrl && <img src={u.profileImageUrl} alt={u.firstName} className="w-full h-full object-cover" />}
                                        </div>
                                        <p className="font-semibold text-gray-700">{u.firstName} {u.lastName}</p>
                                        <p className="font-semibold text-gray-700">{u.email}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NewChat;
