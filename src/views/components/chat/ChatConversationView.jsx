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
import {
  getChatAvatarText,
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
  } = useContext(Context);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [otherParticipant, setOtherParticipant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const companyId = audience === 'company' ? recentlySelectedCompany : '';

  useEffect(() => {
    if (!chatId || !user?.uid) {
      navigate(backPath);
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
      if (!isChatVisibleTo(chatData, user.uid, companyId)) {
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
  }, [audience, backPath, chatId, companyId, navigate, user]);

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
    <div className="flex h-full w-full justify-center overflow-hidden bg-slate-50">
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden border-x border-slate-200 bg-white">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 p-3">
          <div className="flex min-w-0 items-center gap-4">
            <button
              onClick={() => navigate(backPath)}
              className="rounded-full p-2 text-slate-600 hover:bg-slate-100"
              aria-label="Back to messages"
            >
              <ArrowLeftIcon className="h-6 w-6" />
            </button>
            {loading ? (
              <div className="flex items-center gap-4 animate-pulse">
                <div className="h-10 w-10 rounded-full bg-slate-200" />
                <div>
                  <div className="mb-1.5 h-5 w-32 rounded bg-slate-200" />
                  <div className="h-4 w-40 rounded bg-slate-200" />
                </div>
              </div>
            ) : (
              <>
                {otherParticipant?.userImage ? (
                  <img
                    src={otherParticipant.userImage}
                    alt={displayTitle}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white">
                    {avatarText}
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold text-slate-900">{displayTitle}</h1>
                  {otherParticipant?.userEmail ? (
                    <p className="truncate text-sm text-slate-500">{otherParticipant.userEmail}</p>
                  ) : null}
                </div>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {clientCompanyId ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate(`/companies/profile/${clientCompanyId}`)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  title="View company"
                >
                  <BuildingStorefrontIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Company</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate(requestServicePath)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
                  title="Request service"
                >
                  <WrenchScrewdriverIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Request Service</span>
                </button>
              </>
            ) : null}
            {otherParticipant ? (
              <button
                onClick={() => setIsModalOpen(true)}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label="View participant information"
              >
                <InformationCircleIcon className="h-6 w-6" />
              </button>
            ) : null}
          </div>
        </header>

        <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <p>Loading messages...</p>
            </div>
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
            <div className="flex h-full items-center justify-center text-slate-500">
              <p>No messages yet. Say hello!</p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </main>

        <footer className="shrink-0 border-t border-slate-200 p-4">
          <LinkedItemComposer
            audience={audience}
            disabled={!chat || !user?.uid}
            chat={chat}
            currentUser={user}
            companyId={companyId}
            onSend={handleSendLinkedItem}
          />
          <form onSubmit={handleSendMessage} className="flex items-end gap-3">
            <textarea
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              placeholder="Type a message..."
              className="h-20 flex-1 resize-none rounded-lg bg-slate-100 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="rounded-full bg-blue-600 p-3 text-white hover:bg-blue-700 disabled:bg-slate-300"
              aria-label="Send message"
            >
              <PaperAirplaneIcon className="h-6 w-6" />
            </button>
          </form>
        </footer>
      </div>
      {modalComponent}
    </div>
  );
};

export default ChatConversationView;
