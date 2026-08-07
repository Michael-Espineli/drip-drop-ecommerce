import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { timeSince } from '../../../utils/timeFormatter';
import { ArrowLeftIcon, ChatBubbleLeftRightIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import {
    getChatAvatarText,
    getChatDisplayTitle,
    getChatPreview,
    isChatUnreadFor,
    listenVisibleChats,
} from '../../../utils/chatMessaging';
import StartChatModal from '../../components/chat/StartChatModal';

const Messages = () => {
    const navigate = useNavigate();
    const { user } = useContext(Context);
    const [chats, setChats] = useState([]);
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

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

    const filteredChats = useMemo(() => {
        const search = searchTerm.trim().toLowerCase();
        if (!search) return chats;

        return chats.filter((chat) => {
            const title = getChatDisplayTitle(chat, user?.uid, { audience: 'client' });
            return title.toLowerCase().includes(search)
                || getChatPreview(chat).toLowerCase().includes(search);
        });
    }, [chats, searchTerm, user]);

    const unreadCount = useMemo(() => (
        chats.filter((chat) => chat.isUnread).length
    ), [chats]);

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-950 sm:px-4 lg:px-5">
            <div className="mx-auto w-full max-w-4xl space-y-5">
                <Header
                    totalCount={chats.length}
                    unreadCount={unreadCount}
                    onBack={() => navigate(-1)}
                    onNewChat={() => setIsNewChatOpen(true)}
                />

                {isNewChatOpen && (
                    <StartChatModal mode="client" closeModal={() => setIsNewChatOpen(false)} />
                )}

                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="relative">
                        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search messages"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                    </div>
                </section>

                <section className="-mx-3 overflow-hidden border-y border-slate-200 bg-white shadow-sm sm:mx-0 sm:rounded-lg sm:border">
                    {loading ? (
                        <ChatListSkeleton />
                    ) : error ? (
                        <div className="px-6 py-12 text-center text-sm font-semibold text-red-600">{error}</div>
                    ) : filteredChats.length === 0 ? (
                        <NoChatsView hasSearch={Boolean(searchTerm.trim())} />
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {filteredChats.map(chat => (
                                <ChatItem
                                    key={chat.id}
                                    chat={chat}
                                    userId={user.uid}
                                    onClick={() => handleChatClick(chat.id)}
                                />
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </div>
    );
};

const Header = ({ totalCount, unreadCount, onBack, onNewChat }) => (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
            <button
                type="button"
                onClick={onBack}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                aria-label="Back"
            >
                <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <div className="min-w-0">
                <h1 className="truncate text-3xl font-bold tracking-tight text-slate-950">Messages</h1>
                <p className="mt-1 text-sm font-medium text-slate-500">{unreadCount} unread - {totalCount} total</p>
            </div>
        </div>
        <button
            type="button"
            onClick={onNewChat}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 sm:w-auto"
        >
            <PlusIcon className="h-5 w-5" />
            <span>New Message</span>
        </button>
    </header>
);

const ChatListSkeleton = () => (
    <div className="divide-y divide-slate-100">
        {[0, 1, 2].map((item) => (
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

const NoChatsView = ({ hasSearch }) => (
    <div className="px-6 py-14 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-500">
            <ChatBubbleLeftRightIcon className="h-7 w-7" />
        </span>
        <h2 className="mt-3 text-base font-semibold text-slate-950">
            {hasSearch ? 'No messages found' : 'No messages yet'}
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            {hasSearch ? 'Try another search.' : 'Start a message with a company.'}
        </p>
    </div>
);

const ChatItem = ({ chat, userId, onClick }) => {
    const title = getChatDisplayTitle(chat, userId, { audience: 'client' });
    const preview = getChatPreview(chat);
    const avatarText = getChatAvatarText(chat, userId, { audience: 'client' });

    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                className={`flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5 ${chat.isUnread ? 'bg-blue-50/40' : 'bg-white'}`}
            >
                <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md text-sm font-bold ${chat.isUnread ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'}`}>
                    {avatarText}
                    {chat.isUnread && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400" />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="min-w-0">
                            <span className={`block truncate text-sm text-slate-950 ${chat.isUnread ? 'font-bold' : 'font-semibold'}`}>
                                {title}
                            </span>
                            <span className={`mt-1 block truncate text-sm ${chat.isUnread ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>
                                {preview}
                            </span>
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-400">
                            {chat.mostRecentChat ? timeSince(chat.mostRecentChat) : ''}
                        </span>
                    </span>
                </span>
            </button>
        </li>
    );
};

export default Messages;
