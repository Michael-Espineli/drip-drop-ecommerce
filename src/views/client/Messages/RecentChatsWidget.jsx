import React, { useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { timeSince } from '../../../utils/timeFormatter';
import {
    getChatAvatarText,
    getChatDisplayTitle,
    getChatPreview,
    isChatUnreadFor,
    listenVisibleChats,
} from '../../../utils/chatMessaging';

const RecentChatsWidget = () => {
    const { user } = useContext(Context);
    const [recentChats, setRecentChats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [unreadCount, setUnreadCount] = useState(0);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return undefined;
        }

        const unsubscribe = listenVisibleChats({
            db,
            userId: user.uid,
            onChange: (visibleChats) => {
                setRecentChats(visibleChats.slice(0, 5));
                setUnreadCount(visibleChats.filter((chat) => isChatUnreadFor(chat, user.uid)).length);
                setLoading(false);
            },
            onError: (error) => {
                console.error('Error fetching recent chats:', error);
                setLoading(false);
            },
        });

        return () => unsubscribe();
    }, [user]);

    const handleChatClick = (chatId) => {
        navigate(`/client/chat/details/${chatId}`);
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
            <div className="flex min-h-[430px] flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-xl font-bold text-slate-950">Messages</h3>
                {renderSkeleton()}
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-[430px] flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                    <h3 className="text-xl font-bold text-slate-950">Messages</h3>
                    {unreadCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                            {unreadCount}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex-grow">
                {recentChats.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                        {recentChats.map(chat => (
                            <RecentChatRow
                                key={chat.id}
                                chat={chat}
                                userId={user.uid}
                                onClick={() => handleChatClick(chat.id)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="flex h-full flex-grow items-center justify-center rounded-md border border-dashed border-slate-200">
                        <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">No recent conversations.</p>
                    </div>
                )}
            </div>
            <div className="mt-6">
                <Link to="/client/chat" className="block">
                    <button className="w-full rounded-md bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 transition-colors duration-300 hover:bg-slate-200">
                        View All Chats
                    </button>
                </Link>
            </div>
        </div>
    );
};

const RecentChatRow = ({ chat, userId, onClick }) => {
    const unread = isChatUnreadFor(chat, userId);
    const title = getChatDisplayTitle(chat, userId, { audience: 'client' });
    const avatar = getChatAvatarText(chat, userId, { audience: 'client' });

    return (
        <div
            className="flex cursor-pointer items-start gap-4 rounded-md py-4 transition-colors duration-200 hover:bg-slate-50"
            onClick={onClick}
        >
            <div className="shrink-0 relative">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                    {avatar}
                </div>
                {unread && (
                    <span className="absolute top-0 right-0 block h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-white"></span>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className="truncate font-semibold text-slate-900">{title}</p>
                <p className={`line-clamp-2 text-sm text-slate-500 ${unread ? 'font-bold' : ''}`}>
                    {getChatPreview(chat)}
                </p>
            </div>
            <p className="whitespace-nowrap text-xs text-slate-400">{timeSince(chat.mostRecentChat)}</p>
        </div>
    );
};

export default RecentChatsWidget;
