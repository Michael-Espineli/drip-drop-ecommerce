import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { ChatBubbleLeftRightIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { timeSince } from '../../../utils/timeFormatter';
import {
    CHAT_AUDIENCE,
    getChatAudience,
    getChatAudienceLabel,
    getChatAvatarText,
    getChatDisplayTitle,
    getChatPreview,
    isChatUnreadFor,
    listenVisibleChats,
    markChatAsRead,
} from '../../../utils/chatMessaging';
import NewChat from './NewChat';

const filterOptions = [
    { id: 'all', label: 'All' },
    { id: CHAT_AUDIENCE.external, label: 'Customers' },
    { id: CHAT_AUDIENCE.internal, label: 'Internal' },
];

const Chat = () => {
    const { user, recentlySelectedCompany } = useContext(Context);
    const [chats, setChats] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [audienceFilter, setAudienceFilter] = useState('all');
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user?.uid) {
            setChats([]);
            setLoading(false);
            return undefined;
        }

        if (!recentlySelectedCompany) {
            setChats([]);
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

            if (audienceFilter !== 'all' && getChatAudience(chat) !== audienceFilter) return false;

            return title.toLowerCase().includes(searchTerm.toLowerCase())
                || getChatPreview(chat).toLowerCase().includes(searchTerm.toLowerCase());
        })
    ), [audienceFilter, chats, recentlySelectedCompany, searchTerm, user]);

    const audienceCounts = useMemo(() => ({
        all: chats.length,
        [CHAT_AUDIENCE.external]: chats.filter((chat) => getChatAudience(chat) === CHAT_AUDIENCE.external).length,
        [CHAT_AUDIENCE.internal]: chats.filter((chat) => getChatAudience(chat) === CHAT_AUDIENCE.internal).length,
    }), [chats]);

    const unreadCount = useMemo(() => (
        chats.filter((chat) => isChatUnreadFor(chat, user?.uid, recentlySelectedCompany)).length
    ), [chats, recentlySelectedCompany, user]);

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
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-950 sm:px-4 lg:px-5">
            <div className="w-full space-y-5">
                <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                            <ChatBubbleLeftRightIcon className="h-6 w-6" />
                        </span>
                        <div className="min-w-0">
                            <h1 className="truncate text-3xl font-bold tracking-tight text-slate-950">Messages</h1>
                            <p className="mt-1 text-sm font-medium text-slate-500">
                                {unreadCount} unread - {chats.length} total
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsNewChatOpen(true)}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 sm:w-auto"
                    >
                        <PlusIcon className="h-5 w-5" />
                        <span>New Message</span>
                    </button>
                </header>

                {isNewChatOpen && <NewChat closeModal={() => setIsNewChatOpen(false)} />}

                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="relative lg:max-w-md lg:flex-1">
                            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search messages"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1">
                            {filterOptions.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setAudienceFilter(item.id)}
                                    className={`min-w-0 rounded-md px-2.5 py-2 text-sm font-semibold transition ${audienceFilter === item.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950'}`}
                                >
                                    <span className="truncate">{item.label}</span>
                                    <span className="ml-1 text-xs opacity-70">{audienceCounts[item.id] || 0}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="-mx-3 overflow-hidden border-y border-slate-200 bg-white shadow-sm sm:mx-0 sm:rounded-lg sm:border">
                    {loading ? (
                        <ChatListSkeleton />
                    ) : filteredChats.length > 0 ? (
                        <ul className="divide-y divide-slate-100">
                            {filteredChats.map(chat => (
                                <ChatListItem
                                    key={chat.id}
                                    chat={chat}
                                    userId={user.uid}
                                    companyId={recentlySelectedCompany}
                                    onClick={() => handleChatClick(chat)}
                                />
                            ))}
                        </ul>
                    ) : (
                        <EmptyMessagesState hasSearch={Boolean(searchTerm.trim()) || audienceFilter !== 'all'} />
                    )}
                </section>
            </div>
        </div>
    );
};

const ChatListSkeleton = () => (
    <div className="divide-y divide-slate-100">
        {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex animate-pulse items-center gap-3 px-4 py-4 sm:px-5">
                <div className="h-11 w-11 rounded-md bg-slate-200" />
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-1/3 rounded bg-slate-200" />
                    <div className="h-3 w-2/3 rounded bg-slate-100" />
                </div>
                <div className="h-3 w-10 rounded bg-slate-100" />
            </div>
        ))}
    </div>
);

const EmptyMessagesState = ({ hasSearch }) => (
    <div className="px-6 py-14 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-500">
            <ChatBubbleLeftRightIcon className="h-7 w-7" />
        </span>
        <h2 className="mt-3 text-base font-semibold text-slate-950">
            {hasSearch ? 'No messages found' : 'No messages yet'}
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            {hasSearch ? 'Try another search or filter.' : 'Start a message with a customer or teammate.'}
        </p>
    </div>
);

const ChatListItem = ({ chat, userId, companyId, onClick }) => {
    const title = getChatDisplayTitle(chat, userId, { companyId, audience: 'company' });
    const preview = getChatPreview(chat);
    const unread = isChatUnreadFor(chat, userId, companyId);
    const avatarText = getChatAvatarText(chat, userId, { companyId, audience: 'company' });
    const audienceLabel = getChatAudienceLabel(chat);

    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                className={`group flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5 ${unread ? 'bg-blue-50/40' : 'bg-white'}`}
            >
                <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md text-sm font-bold ${unread ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'}`}>
                    {avatarText}
                    {unread && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400" />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                                <span className={`truncate text-sm text-slate-950 ${unread ? 'font-bold' : 'font-semibold'}`}>{title}</span>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${audienceLabel === 'Internal' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                                    {audienceLabel}
                                </span>
                            </span>
                            <span className={`mt-1 block truncate text-sm ${unread ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{preview}</span>
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-400">{timeSince(chat.mostRecentChat)}</span>
                    </span>
                </span>
            </button>
        </li>
    );
};

export default Chat;
