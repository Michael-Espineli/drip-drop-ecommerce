import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { timeSince } from '../../../utils/timeFormatter';
import { COMPANY_WIDE_MESSAGES_PERMISSION_ID } from '../../../utils/companyPermissions';
import {
    getChatAvatarText,
    getChatDisplayTitle,
    getChatPreview,
    isChatUnreadFor,
    listenVisibleChats,
} from '../../../utils/chatMessaging';

const EMPTY_CUSTOMER_IDS = [];

const RecentChatsWidget = ({
    variant = 'card',
    limit = 3,
    showViewAll = true,
    personalOnly = false,
    unreadOnly = false,
    customerIds = EMPTY_CUSTOMER_IDS,
}) => {
    const { user, recentlySelectedCompany, companyUserAccess, companyRoleLoaded, hasCompanyPermission } = useContext(Context);
    const [recentChats, setRecentChats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [unreadCount, setUnreadCount] = useState(0);
    const navigate = useNavigate();
    const isCompact = variant === 'compact';
    const customerIdKey = Array.isArray(customerIds) ? customerIds.map((id) => String(id || '').trim()).filter(Boolean).join('|') : '';
    const customerIdSet = useMemo(() => new Set(customerIdKey ? customerIdKey.split('|') : []), [customerIdKey]);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return undefined;
        }

        if (recentlySelectedCompany && !companyRoleLoaded) {
            setLoading(true);
            return undefined;
        }

        const readableCompanyId = recentlySelectedCompany && companyUserAccess
            ? recentlySelectedCompany
            : '';

        const unsubscribe = listenVisibleChats({
            db,
            userId: user.uid,
            companyId: readableCompanyId,
            includeCompanyWide: Boolean(readableCompanyId) && hasCompanyPermission(COMPANY_WIDE_MESSAGES_PERMISSION_ID),
            onChange: (visibleChats) => {
                const filteredChats = personalOnly
                    ? visibleChats.filter((chat) => {
                        const participantIds = Array.isArray(chat.participantIds) ? chat.participantIds : [];
                        const chatCustomerId = String(chat.customerId || chat.customer?.id || chat.relationshipCustomerId || '').trim();

                        return participantIds.includes(user.uid) || (chatCustomerId && customerIdSet.has(chatCustomerId));
                    })
                    : visibleChats;
                const unreadChats = filteredChats.filter((chat) => isChatUnreadFor(chat, user.uid, readableCompanyId));
                const displayChats = unreadOnly ? unreadChats : filteredChats;

                setRecentChats(displayChats.slice(0, limit));
                setUnreadCount(unreadChats.length);
                setLoading(false);
            },
            onError: (error) => {
                console.error('Error fetching recent chats:', error);
                setLoading(false);
            },
        });

        return () => unsubscribe();
    }, [companyRoleLoaded, companyUserAccess, customerIdSet, hasCompanyPermission, limit, personalOnly, recentlySelectedCompany, unreadOnly, user]);

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
            <div className={isCompact ? "min-h-[132px]" : "bg-white p-6 rounded-lg shadow-md"}>
                <h3 className={`${isCompact ? 'mb-3 text-sm' : 'mb-4 text-lg'} font-semibold text-gray-800`}>Recent Conversations</h3>
                {renderSkeleton()}
            </div>
        );
    }

    return (
        <div className={`${isCompact ? 'flex min-h-[132px] flex-col' : 'bg-white p-6 rounded-lg shadow-md flex flex-col h-full'}`}>
            <div className={`flex items-center justify-between ${isCompact ? 'mb-2' : 'mb-4'}`}>
                <div className="flex items-center">
                    <h3 className={`${isCompact ? 'text-sm' : 'text-lg'} font-semibold text-gray-800`}>Recent Conversations</h3>
                    {unreadCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                            {unreadCount}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex-grow">
                {recentChats.length > 0 ? (
                    <div className={isCompact ? "space-y-2" : "space-y-4"}>
                        {recentChats.map(chat => (
                            <RecentChatRow
                                key={chat.id}
                                chat={chat}
                                userId={user.uid}
                                companyId={personalOnly ? '' : (recentlySelectedCompany && companyUserAccess ? recentlySelectedCompany : '')}
                                compact={isCompact}
                                onClick={() => handleChatClick(chat.id)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="flex-grow flex items-center justify-center h-full">
                        <p className="text-center text-gray-500 py-4 text-sm">
                            {unreadOnly ? 'No unread conversations.' : 'No recent conversations.'}
                        </p>
                    </div>
                )}
            </div>
            {showViewAll && (
            <div className={isCompact ? "mt-3 text-center" : "mt-6 text-center"}>
                <Link to="/companies-chat">
                    <button className={`${isCompact ? 'py-1.5 text-xs' : 'py-2'} w-full bg-gray-100 text-gray-700 font-bold px-4 rounded-lg hover:bg-gray-200 transition-colors duration-300`}>
                        View All Chats
                    </button>
                </Link>
            </div>
            )}
        </div>
    );
};

const RecentChatRow = ({ chat, userId, companyId, compact = false, onClick }) => {
    const unread = isChatUnreadFor(chat, userId, companyId);
    const title = getChatDisplayTitle(chat, userId, { companyId, audience: 'company' });
    const avatar = getChatAvatarText(chat, userId, { companyId, audience: 'company' });

    return (
        <div
            className={`${compact ? 'gap-3 p-2' : 'gap-4 p-2'} flex items-start cursor-pointer hover:bg-gray-50 rounded-md transition-colors duration-200`}
            onClick={onClick}
        >
            <div className="shrink-0 relative">
                <div className={`${compact ? 'h-8 w-8 text-xs' : 'w-10 h-10'} rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold`}>
                    {avatar}
                </div>
                {unread && (
                    <span className="absolute top-0 right-0 block h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-white"></span>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className={`${compact ? 'text-sm' : ''} font-semibold text-gray-900 truncate`}>{title}</p>
                <p className={`${compact ? 'text-xs' : 'text-sm'} text-gray-500 truncate ${unread ? 'font-bold' : ''}`}>
                    {getChatPreview(chat)}
                </p>
            </div>
            <p className="text-xs text-gray-400 whitespace-nowrap">{timeSince(chat.mostRecentChat)}</p>
        </div>
    );
};

export default RecentChatsWidget;
