import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { timeSince } from '../../../utils/timeFormatter';

const RecentChatsWidget = () => {
    const { user } = useContext(Context);
    const [recentChats, setRecentChats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [unreadCount, setUnreadCount] = useState(0);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user?.uid) return;

        const chatsRef = collection(db, 'chats');
        const q = query(
            chatsRef,
            where('participantIds', 'array-contains', user.uid),
            orderBy('mostRecentChat', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            let unread = 0;
            const chats = snapshot.docs.map(doc => {
                const data = doc.data();
                if (data.userWhoHaveNotRead?.includes(user.uid)) {
                    unread++;
                }
                const otherParticipant = data.participants.find(p => p.userId !== user.uid);
                return {
                    id: doc.id,
                    ...data,
                    otherParticipant,
                };
            });
            setRecentChats(chats.slice(0, 3));
            setUnreadCount(unread);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching recent chats: ", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleChatClick = (chatId) => {
        navigate(`/companies-chat/detail/${chatId}`);
    };

    const renderSkeleton = () => (
        <div className="space-y-4">
            {[...Array(3)].map((_, index) => (
                <div key={index} className="flex items-center gap-4 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-gray-200"></div>
                    <div className="flex-1">
                        <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
                        <div className="h-3 w-1/2 bg-gray-200 rounded mt-1.5"></div>
                    </div>
                    <div className="w-12 h-3 bg-gray-200 rounded"></div>
                </div>
            ))}
        </div>
    );

    if (loading) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Conversations</h3>
                {renderSkeleton()}
            </div>
        );
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow-md flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                    <h3 className="text-lg font-semibold text-gray-800">Recent Conversations</h3>
                    {unreadCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                            {unreadCount}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex-grow">
                {recentChats.length > 0 ? (
                    <div className="space-y-4">
                        {recentChats.map(chat => (
                            <div
                                key={chat.id}
                                className="flex items-start gap-4 cursor-pointer hover:bg-gray-50 p-2 rounded-md transition-colors duration-200"
                                onClick={() => handleChatClick(chat.id)}
                            >
                                <div className="shrink-0 relative">
                                    {chat.otherParticipant?.userImage ? (
                                        <img src={chat.otherParticipant.userImage} alt={chat.otherParticipant.userName} className="w-10 h-10 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                                            {chat.otherParticipant?.userName?.charAt(0).toUpperCase() || 'U'}
                                        </div>
                                    )}
                                    {chat.userWhoHaveNotRead?.includes(user.uid) && (
                                        <span className="absolute top-0 right-0 block h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-white"></span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center">
                                        <p className="font-semibold text-gray-900 truncate">{chat.otherParticipant?.userName || 'Unknown User'}</p>
                                        {chat.otherParticipant?.accountType && (
                                            <span className={`ml-2 shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
                                                chat.otherParticipant.accountType === 'Company'
                                                    ? 'bg-blue-100 text-blue-800'
                                                    : 'bg-green-100 text-green-800'
                                            }`}>
                                                {chat.otherParticipant.accountType}
                                            </span>
                                        )}
                                    </div>
                                    <p className={`text-sm text-gray-500 truncate ${chat.userWhoHaveNotRead?.includes(user.uid) ? 'font-bold' : ''}`}>
                                        {chat.lastMessage}
                                    </p>
                                </div>
                                <p className="text-xs text-gray-400 whitespace-nowrap">{timeSince(chat.mostRecentChat)}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex-grow flex items-center justify-center h-full">
                        <p className="text-center text-gray-500 py-4">No recent conversations.</p>
                    </div>
                )}
            </div>
            <div className="mt-6 text-center">
                <Link to="/companies-chat">
                    <button className="w-full bg-gray-100 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors duration-300">
                        View All Chats
                    </button>
                </Link>
            </div>
        </div>
    );
};

export default RecentChatsWidget;
