import React, { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, orderBy, onSnapshot, setDoc, serverTimestamp, where, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { ArrowLeftIcon, PaperAirplaneIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import ParticipantInfoModal from './ParticipantInfoModal';

import { v4 as uuidv4 } from 'uuid';
const CompanyConversation = () => {
    const { chatId } = useParams();
    const { user, dataBaseUser } = useContext(Context);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [otherParticipant, setOtherParticipant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const navigate = useNavigate();
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        if (!chatId || !user) {
            navigate('/companies-chat');
            return;
        }

        const chatDocRef = doc(db, 'chats', chatId);

        const handleChatView = async () => {
            setLoading(true);
            const chatDocSnap = await getDoc(chatDocRef);

            if (!chatDocSnap.exists()) {
                console.error("Chat not found!");
                navigate('/companies-chat');
                return;
            }
            
            const chatData = chatDocSnap.data();

            if (!chatData.participantIds.includes(user.uid)) {
                console.error("You are not a participant in this chat.");
                navigate('/companies-chat');
                return;
            }

            const otherP = chatData.participants.find(p => p.userId !== user.uid);
            setOtherParticipant(otherP);
            setLoading(false);

            if (chatData.userWhoHaveNotRead && chatData.userWhoHaveNotRead.includes(user.uid)) {
                await updateDoc(chatDocRef, {
                    userWhoHaveNotRead: chatData.userWhoHaveNotRead.filter(id => id !== user.uid)
                });
            }
        };

        handleChatView();

        const messagesRef = collection(db, 'messages');
        const qMessages = query(messagesRef, where('chatId', '==', chatId), orderBy('dateSent', 'asc'));

        const unsubscribe = onSnapshot(qMessages, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMessages(msgs);
        });

        return () => unsubscribe();

    }, [chatId, user, navigate]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !user || !otherParticipant) return;

        try {
            const messageId = 'msg_' + uuidv4();
            
            await setDoc(doc(db, 'messages',messageId), {
                id:messageId,
                chatId: chatId,
                message: newMessage,
                senderId: user.uid,
                senderName: `${dataBaseUser.firstName} ${dataBaseUser.lastName}` || "User",
                read: false,
                dateSent: serverTimestamp(),
            });

            await updateDoc(doc(db, 'chats', chatId), {
                lastMessage: newMessage,
                mostRecentChat: serverTimestamp(),
                userWhoHaveNotRead: [otherParticipant.userId]
            });

            setNewMessage('');
        } catch (error) {
            console.error("Error sending message: ", error);
        }
    };

    return (
        <div className="h-full w-full overflow-hidden bg-gray-50 flex justify-center">
            <div className="flex flex-col h-full w-full max-w-4xl bg-white border-x border-gray-200 overflow-hidden">
    
                {/* HEADER - Now with Info Button */}
                <header className="shrink-0 flex items-center justify-between gap-4 p-3 border-b border-gray-200">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/companies-chat')}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-full"
                        >
                            <ArrowLeftIcon className="w-6 h-6" />
                        </button>
                        {otherParticipant ? (
                            <>
                                {otherParticipant.userImage ? (
                                    <img src={otherParticipant.userImage} alt={otherParticipant.userName} className="w-10 h-10 rounded-full object-cover" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-lg">
                                        {otherParticipant.userName?.charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div>
                                    <h1 className="text-lg font-semibold truncate">
                                        {otherParticipant.userName}
                                    </h1>
                                    {otherParticipant.userEmail && (
                                        <p className="text-sm text-gray-500 truncate">
                                            {otherParticipant.userEmail}
                                        </p>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center gap-4 animate-pulse">
                                <div className="w-10 h-10 rounded-full bg-gray-200"></div>
                                <div>
                                    <div className="w-32 h-5 bg-gray-200 rounded mb-1.5"></div>
                                    <div className="w-40 h-4 bg-gray-200 rounded"></div>
                                </div>
                            </div>
                        )}
                    </div>
                    {otherParticipant && (
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
                        >
                            <InformationCircleIcon className="w-6 h-6" />
                        </button>
                    )}
                </header>
    
                <main className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                    {loading ? (
                         <div className="flex justify-center items-center h-full text-gray-500"><p>Loading messages...</p></div>
                    ) : messages.length > 0 ? (
                        messages.map(msg => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.senderId === user.uid ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`px-4 py-2 rounded-lg max-w-xs lg:max-w-md break-words ${
                                        msg.senderId === user.uid
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-gray-100 text-gray-800'
                                    }`}
                                >
                                    <p style={{whiteSpace: 'pre-wrap'}}>{msg.message}</p>
                                    <p className="text-xs mt-1 text-right opacity-70">
                                        {msg.dateSent?.toDate().toLocaleTimeString([], {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                        })}
                                    </p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="flex justify-center items-center h-full text-gray-500">
                            <p>No messages yet. Say hello!</p>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </main>
    
                {/* INPUT */}
                <footer className="shrink-0 border-t border-gray-200 p-4">
                    <form onSubmit={handleSendMessage} className="flex gap-3 items-end">
                        <textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..."
                            className="flex-1 resize-none h-20 px-4 py-3 bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage(e);
                                }
                            }}
                        />
                        <button
                            type="submit"
                            disabled={!newMessage.trim()}
                            className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300"
                        >
                            <PaperAirplaneIcon className="w-6 h-6" />
                        </button>
                    </form>
                </footer>
            </div>

            {/* MODAL */}
            <ParticipantInfoModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                participant={otherParticipant}
            />
        </div>
    );
}

export default CompanyConversation;
