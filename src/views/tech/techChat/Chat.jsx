import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { timeSince } from '../../../utils/timeFormatter';
import {
    getChatAvatarText,
    getChatDisplayTitle,
    getChatPreview,
    isChatUnreadFor,
    listenVisibleChats,
    markChatAsRead,
} from '../../../utils/chatMessaging';
import NewChat from './NewChat';

const Chat = () => {
    const { user, recentlySelectedCompany } = useContext(Context);
    const [chats, setChats] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return undefined;
        }

        setLoading(true);
        const unsubscribe = listenVisibleChats({
            db,
            userId: user.uid,
            companyId: recentlySelectedCompany || '',
            onChange: (visibleChats) => {
                setChats(visibleChats);
                setLoading(false);
            },
            onError: (error) => {
                console.error('Error fetching company chats:', error);
                setLoading(false);
            },
        });

        return () => unsubscribe();
    }, [recentlySelectedCompany, user]);

    const filteredChats = useMemo(() => (
        chats.filter((chat) => {
            const title = getChatDisplayTitle(chat, user?.uid, {
                companyId: recentlySelectedCompany,
                audience: 'company',
            });

            return title.toLowerCase().includes(searchTerm.toLowerCase())
                || getChatPreview(chat).toLowerCase().includes(searchTerm.toLowerCase());
        })
    ), [chats, recentlySelectedCompany, searchTerm, user]);

    const handleChatClick = async (chat) => {
        try {
            if (isChatUnreadFor(chat, user.uid, recentlySelectedCompany)) {
                await markChatAsRead({
                    db,
                    chatId: chat.id,
                    chat,
                    userId: user.uid,
                    companyId: recentlySelectedCompany || '',
                });
            }
        } catch (error) {
            console.error('Error marking chat as read:', error);
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
                        <span>Start a new chat</span>
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
                        {loading ? (
                            <p className="p-6 text-center text-gray-500">Loading chats...</p>
                        ) : filteredChats.length > 0 ? (
                            filteredChats.map(chat => (
                                <ChatListItem
                                    key={chat.id}
                                    chat={chat}
                                    userId={user.uid}
                                    companyId={recentlySelectedCompany}
                                    onClick={() => handleChatClick(chat)}
                                />
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

const ChatListItem = ({ chat, userId, companyId, onClick }) => {
    const title = getChatDisplayTitle(chat, userId, { companyId, audience: 'company' });
    const preview = getChatPreview(chat);
    const unread = isChatUnreadFor(chat, userId, companyId);
    const avatarText = getChatAvatarText(chat, userId, { companyId, audience: 'company' });

    return (
        <li onClick={onClick} className="p-4 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center">
                <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                    {avatarText}
                    {unread && (
                        <span className="absolute right-0 top-0 block h-3 w-3 rounded-full border-2 border-white bg-red-500" />
                    )}
                </div>
                <div className="ml-4 min-w-0 flex-1">
                    <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                            <p className={`truncate font-semibold text-gray-800 ${unread ? 'font-bold' : ''}`}>{title}</p>
                            <p className={`truncate text-sm ${unread ? 'font-semibold text-gray-700' : 'text-gray-500'}`}>{preview}</p>
                        </div>
                        <p className="shrink-0 text-xs text-gray-400 whitespace-nowrap">{timeSince(chat.mostRecentChat)}</p>
                    </div>
                </div>
            </div>
        </li>
    );
};

export default Chat;
