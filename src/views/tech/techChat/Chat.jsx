import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import NewChat from './NewChat';

const Chat = () => {
    const { user } = useContext(Context);
    const [chats, setChats] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) return;

        const chatsRef = collection(db, 'chats');
        const q = query(
            chatsRef, 
            where('participantIds', 'array-contains', user.uid),
            orderBy('mostRecentChat', 'desc')
        );

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const chatList = querySnapshot.docs.map(doc => {
                const data = doc.data();
                const otherParticipant = data.participants.find(p => p.userId !== user.uid);
                
                return {
                    id: doc.id,
                    ...data,
                    otherParticipantName: otherParticipant ? otherParticipant.userName : 'Unknown User',
                    otherParticipantImage: otherParticipant ? otherParticipant.userImage : null,
                };
            });
            setChats(chatList);
        });

        return () => unsubscribe();
    }, [user]);

    const filteredChats = chats.filter(chat => 
        chat.otherParticipantName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleChatClick = async (chat) => {
        if (chat.userWhoHaveNotRead && chat.userWhoHaveNotRead.includes(user.uid)) {
            const chatDocRef = doc(db, "chats", chat.id);
            await updateDoc(chatDocRef, {
                userWhoHaveNotRead: chat.userWhoHaveNotRead.filter(id => id !== user.uid)
            });
        }
        navigate(`/companies-chat/detail/${chat.id}`);
    };

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Chats</h1>
                    <button 
                        onClick={() => setIsNewChatOpen(true)} 
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors"
                    >
                        <PlusIcon className="w-6 h-6" />
                        <span>New Chat</span>
                    </button>
                </div>

                {isNewChatOpen && <NewChat closeModal={() => setIsNewChatOpen(false)} />}

                <div className="relative mb-6">
                    <MagnifyingGlassIcon className="absolute top-1/2 left-4 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input 
                        type="text"
                        placeholder="Search chats..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <ul className="divide-y divide-gray-200">
                        {filteredChats.length > 0 ? (
                            filteredChats.map(chat => (
                                <li key={chat.id} onClick={() => handleChatClick(chat)} className="p-4 hover:bg-gray-50 cursor-pointer">
                                    <div className="flex items-center">
                                        <div className="w-12 h-12 bg-gray-200 rounded-full flex-shrink-0 overflow-hidden">
                                            {chat.otherParticipantImage ? (
                                                <img src={chat.otherParticipantImage} alt={chat.otherParticipantName} className="w-full h-full object-cover" />
                                            ) : null}
                                        </div>
                                        <div className="ml-4 flex-1">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <p className={`font-semibold text-gray-800 ${chat.userWhoHaveNotRead?.includes(user.uid) ? 'font-bold' : ''}`}>{chat.otherParticipantName}</p>
                                                    <p className="text-sm text-gray-500 truncate max-w-xs md:max-w-md">{chat.lastMessage}</p>
                                                </div>
                                                <p className="text-xs text-gray-400 whitespace-nowrap">{new Date(chat.mostRecentChat.seconds * 1000).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            ))
                        ) : (
                            <p className="p-6 text-center text-gray-500">No chats found.</p>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default Chat;
