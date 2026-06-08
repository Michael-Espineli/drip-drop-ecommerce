
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { timeSince } from '../../../utils/timeFormatter';
import { ChatBubbleLeftRightIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import {
    getChatDisplayTitle,
    getChatPreview,
    isChatUnreadFor,
    listenVisibleChats,
} from '../../../utils/chatMessaging';

const Messages = () => {
    const navigate = useNavigate();
    const { user } = useContext(Context);
    const [chats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = listenVisibleChats({
            db,
            userId: user.uid,
            onChange: (visibleChats) => {
                const chatsData = visibleChats.map(chat => ({
                    ...chat,
                    isUnread: isChatUnreadFor(chat, user.uid),
                }));
                setChats(chatsData);
                setLoading(false);
            },
            onError: (err) => {
                console.error("Error fetching chats: ", err);
                setError("Failed to load messages.");
                setLoading(false);
            },
        });

        return () => unsubscribe();
    }, [user]);

    const handleChatClick = (chatId) => {
        navigate(`/client/chat/details/${chatId}`);
    };

    if (loading) {
        return <div className="p-8 text-center">Loading chats...</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">{error}</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <Header onBack={() => navigate(-1)} />

                {chats.length === 0 ? (
                    <NoChatsView />
                ) : (
                    <div className="bg-white rounded-lg shadow-md mt-8">
                        <ul className="divide-y divide-gray-200">
                            {chats.map(chat => (
                                <ChatItem
                                    key={chat.id}
                                    chat={chat}
                                    userId={user.uid}
                                    onClick={() => handleChatClick(chat.id)}
                                />
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

const Header = ({ onBack }) => (
    <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
            <ArrowLeftIcon className="w-6 h-6" />
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Messages</h1>
    </div>
);

const NoChatsView = () => (
    <div className="text-center py-20">
        <ChatBubbleLeftRightIcon className="mx-auto h-12 w-12 text-gray-400" />
        <h2 className="mt-2 text-lg font-medium text-gray-900">No conversations yet</h2>
        <p className="mt-1 text-sm text-gray-500">When you start a conversation with a company, it will appear here.</p>
    </div>
);

const ChatItem = ({ chat, userId, onClick }) => {
    const title = getChatDisplayTitle(chat, userId, { audience: 'client' });
    const preview = getChatPreview(chat);

    return (
        <li onClick={onClick} className="p-4 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    {chat.isUnread && <span className="h-3 w-3 shrink-0 bg-green-500 rounded-full"></span>}
                    <div className="min-w-0">
                        <p className={`truncate font-semibold ${chat.isUnread ? 'text-gray-900' : 'text-gray-700'}`}>
                            {title}
                        </p>
                        <p className={`truncate text-sm ${chat.isUnread ? 'text-gray-700 font-semibold' : 'text-gray-500'}`}>
                            {preview}
                        </p>
                    </div>
                </div>
                <p className="shrink-0 text-xs text-gray-400">
                    {chat.mostRecentChat ? timeSince(chat.mostRecentChat) : ''}
                </p>
            </div>
        </li>
    );
};

export default Messages;
