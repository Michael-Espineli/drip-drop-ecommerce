import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  ArrowLeftIcon,
  BuildingStorefrontIcon,
  InformationCircleIcon,
  PaperAirplaneIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { COMPANY_WIDE_MESSAGES_PERMISSION_ID } from '../../../utils/companyPermissions';
import {
  getChatAvatarText,
  getChatAudienceLabel,
  getChatDisplayTitle,
  getOtherParticipant,
  getUserDisplayName,
  isChatUnreadFor,
  isChatVisibleTo,
  markChatAsRead,
  sendChatMessage,
} from '../../../utils/chatMessaging';
import MessageBubble from './MessageBubble';
import LinkedItemComposer from './LinkedItemComposer';

const ChatConversationView = ({ audience = 'company', backPath = '/companies-chat', ParticipantInfoModal }) => {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const {
    user,
    dataBaseUser,
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    companyRoleLoaded,
    hasCompanyPermission,
  } = useContext(Context);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [otherParticipant, setOtherParticipant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const companyId = audience === 'company' ? recentlySelectedCompany : '';
  const includeCompanyWide = audience === 'company'
    && companyRoleLoaded
    && hasCompanyPermission(COMPANY_WIDE_MESSAGES_PERMISSION_ID);

  useEffect(() => {
    if (!chatId || !user?.uid) {
      navigate(backPath);
      return undefined;
    }

    if (companyId && !companyRoleLoaded) {
      return undefined;
    }

    const chatDocRef = doc(db, 'chats', chatId);
    const unsubscribe = onSnapshot(chatDocRef, async (snapshot) => {
      if (!snapshot.exists()) {
        console.error('Chat not found.');
        navigate(backPath);
        return;
      }

      const chatData = { id: snapshot.id, ...snapshot.data() };
      if (!isChatVisibleTo(chatData, user.uid, companyId, { includeCompanyWide })) {
        console.error('You are not a participant in this chat.');
        navigate(backPath);
        return;
      }

      setChat(chatData);
      setOtherParticipant(getOtherParticipant(chatData, user.uid, { companyId, audience }));
      setLoading(false);

      if (isChatUnreadFor(chatData, user.uid, companyId)) {
        try {
          await markChatAsRead({ db, chatId, chat: chatData, userId: user.uid, companyId });
        } catch (error) {
          console.error('Error marking chat as read:', error);
        }
      }
    }, (error) => {
      console.error('Error loading chat:', error);
      navigate(backPath);
    });

    return () => unsubscribe();
  }, [audience, backPath, chatId, companyId, companyRoleLoaded, includeCompanyWide, navigate, user]);

  useEffect(() => {
    if (!chatId || !user?.uid) return undefined;

    const messagesRef = collection(db, 'messages');
    const messagesQuery = query(messagesRef, where('chatId', '==', chatId), orderBy('dateSent', 'asc'));
    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      setMessages(snapshot.docs.map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() })));
    }, (error) => {
      console.error('Error loading messages:', error);
    });

    return () => unsubscribe();
  }, [chatId, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!newMessage.trim() || !user?.uid || !chat) return;

    try {
      await sendChatMessage({
        db,
        chatId,
        chat,
        text: newMessage,
        senderId: user.uid,
        senderName: getUserDisplayName(dataBaseUser, user),
        senderCompanyId: companyId,
        senderCompanyName: companyId ? recentlySelectedCompanyName : '',
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleSendLinkedItem = async (link) => {
    if (!user?.uid || !chat) return;

    await sendChatMessage({
      db,
      chatId,
      chat,
      link: {
        ...link,
        companyId: chat.companyId || companyId,
        customerUserId: chat.customerUserId || '',
        audience: audience === 'client' ? 'client' : 'company',
      },
      senderId: user.uid,
      senderName: getUserDisplayName(dataBaseUser, user),
      senderCompanyId: companyId,
      senderCompanyName: companyId ? recentlySelectedCompanyName : '',
    });
  };

  const displayTitle = chat
    ? getChatDisplayTitle(chat, user?.uid, { companyId, audience })
    : otherParticipant?.userName || 'Conversation';
  const avatarText = chat ? getChatAvatarText(chat, user?.uid, { companyId, audience }) : displayTitle.charAt(0).toUpperCase();
  const audienceLabel = chat ? getChatAudienceLabel(chat) : '';
  const clientCompanyId = audience === 'client'
    ? (chat?.companyId || chat?.receiverCompanyId || otherParticipant?.companyId || '')
    : '';
  const requestServicePath = clientCompanyId
    ? `/client/service-requests/new/${clientCompanyId}?chatId=${encodeURIComponent(chatId)}`
    : '';
  const modalComponent = ParticipantInfoModal ? (
    <ParticipantInfoModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      participant={otherParticipant}
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 w-full bg-slate-50 text-slate-950">
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white lg:mx-auto lg:max-w-5xl lg:border-x lg:border-slate-200">
        <header className="shrink-0 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(backPath)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                aria-label="Back to messages"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              {loading ? (
                <div className="flex min-w-0 animate-pulse items-center gap-3">
                  <div className="h-10 w-10 rounded-md bg-slate-200" />
                  <div className="min-w-0 space-y-2">
                    <div className="h-4 w-32 rounded bg-slate-200" />
                    <div className="h-3 w-40 rounded bg-slate-100" />
                  </div>
                </div>
              ) : (
                <>
                  {otherParticipant?.userImage ? (
                    <img
                      src={otherParticipant.userImage}
                      alt={displayTitle}
                      className="h-10 w-10 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white">
                      {avatarText}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h1 className="truncate text-base font-bold text-slate-950 sm:text-lg">{displayTitle}</h1>
                      {audienceLabel ? (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${audienceLabel === 'Internal' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                          {audienceLabel}
                        </span>
                      ) : null}
                    </div>
                    {otherParticipant?.userEmail ? (
                      <p className="truncate text-xs font-medium text-slate-500 sm:text-sm">{otherParticipant.userEmail}</p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {clientCompanyId ? (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/companies/profile/${clientCompanyId}`)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:gap-2 sm:px-3"
                    title="View company"
                  >
                    <BuildingStorefrontIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Company</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(requestServicePath)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white transition hover:bg-emerald-700 sm:w-auto sm:gap-2 sm:px-3"
                    title="Request service"
                  >
                    <WrenchScrewdriverIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Request</span>
                  </button>
                </>
              ) : null}
              {otherParticipant ? (
                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="View participant information"
                >
                  <InformationCircleIcon className="h-5 w-5" />
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-5">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {loading ? (
              <LoadingMessages />
            ) : messages.length > 0 ? (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  userId={user.uid}
                  companyId={companyId}
                  audience={audience}
                />
              ))
            ) : (
              <div className="flex min-h-[45vh] items-center justify-center text-center">
                <div>
                  <p className="text-sm font-semibold text-slate-700">No messages yet</p>
                  <p className="mt-1 text-sm text-slate-500">Send the first note below.</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
          <div className="mx-auto w-full max-w-3xl">
            <LinkedItemComposer
              audience={audience}
              disabled={!chat || !user?.uid}
              chat={chat}
              currentUser={user}
              companyId={companyId}
              onSend={handleSendLinkedItem}
            />
            <form onSubmit={handleSendMessage} className="flex items-end gap-2 sm:gap-3">
              <textarea
                rows={1}
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
                placeholder="Type a message..."
                className="min-h-[44px] max-h-28 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSendMessage(event);
                  }
                }}
              />
              <button
                type="submit"
                disabled={!newMessage.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                aria-label="Send message"
              >
                <PaperAirplaneIcon className="h-5 w-5" />
              </button>
            </form>
          </div>
        </footer>
      </div>
      {modalComponent}
    </div>
  );
};

const LoadingMessages = () => (
  <div className="space-y-3 py-3">
    {[0, 1, 2].map((item) => (
      <div key={item} className={`flex animate-pulse ${item % 2 ? 'justify-end' : 'justify-start'}`}>
        <div className="h-12 w-2/3 max-w-xs rounded-lg bg-slate-200" />
      </div>
    ))}
  </div>
);

export default ChatConversationView;
