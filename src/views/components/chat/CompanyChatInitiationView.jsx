import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeftIcon, ChatBubbleLeftRightIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { COMPANY_WIDE_MESSAGES_PERMISSION_ID } from '../../../utils/companyPermissions';
import {
  createCompanyChat,
  findVisibleChatWithParticipant,
} from '../../../utils/chatMessaging';

const getParticipantName = (data = {}) => {
  const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
  return fullName || data.name || data.email || 'User';
};

const getCustomerName = (data = {}) => (
  data.customerName
  || (data.displayAsCompany ? data.company : '')
  || getParticipantName(data)
);

const getCustomerUserId = (data = {}) => {
  const linkedCustomerIds = Array.isArray(data.linkedCustomerIds) ? data.linkedCustomerIds : [];

  return data.customerUserId
    || data.linkedCustomerUserId
    || data.linkedHomeownerUserId
    || data.homeownerUserId
    || data.userId
    || data.clientId
    || data.homeownerId
    || linkedCustomerIds[0]
    || '';
};

const findCompanyUserRecord = async ({ companyId, userId }) => {
  if (!companyId || !userId) return null;

  const [docSnap, querySnap] = await Promise.all([
    getDoc(doc(db, 'companies', companyId, 'companyUsers', userId)),
    getDocs(query(collection(db, 'companies', companyId, 'companyUsers'), where('userId', '==', userId))),
  ]);

  if (docSnap.exists()) return { id: docSnap.id, ...docSnap.data() };
  return querySnap.docs[0] ? { id: querySnap.docs[0].id, ...querySnap.docs[0].data() } : null;
};

const getCompanyUserId = (companyUser = {}, fallbackId = '') => (
  companyUser.userId || companyUser.uid || companyUser.id || fallbackId
);

const buildCompanyUserParticipant = ({ companyUser, companyId, companyName }) => {
  const userId = getCompanyUserId(companyUser);

  return {
    id: companyUser.id || userId,
    userId,
    name: companyUser.userName || getParticipantName(companyUser),
    image: companyUser.photoUrl || companyUser.profileImageUrl || '',
    email: companyUser.email || '',
    accountType: 'Company',
    companyId,
    companyName: companyName || '',
    type: 'companyUser',
  };
};

const CompanyChatInitiationView = ({ backPath = '/companies-chat' }) => {
  const params = useParams();
  const participantId = params.participantId || params.clientId;
  const navigate = useNavigate();
  const {
    user,
    dataBaseUser,
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    companyRoleLoaded,
    hasCompanyPermission,
  } = useContext(Context);
  const [newMessage, setNewMessage] = useState('');
  const [participantInfo, setParticipantInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!participantId || !user?.uid) {
      setIsLoading(false);
      return;
    }

    if (!recentlySelectedCompany) {
      setError('Select a company before starting a message.');
      setIsLoading(false);
      return;
    }

    const findOrCreateChat = async () => {
      setIsLoading(true);
      setError(null);

      try {
        let nextParticipant = null;

        const companyUserRecord = await findCompanyUserRecord({
          companyId: recentlySelectedCompany,
          userId: participantId,
        });

        if (companyUserRecord) {
          nextParticipant = buildCompanyUserParticipant({
            companyUser: companyUserRecord,
            companyId: recentlySelectedCompany,
            companyName: recentlySelectedCompanyName,
          });
        }

        if (!nextParticipant) {
          const customerDoc = await getDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', participantId));
          if (customerDoc.exists()) {
            const data = customerDoc.data();
            const customerUserId = getCustomerUserId(data);
            if (!customerUserId) {
              setError('This customer is not linked to a homeowner account yet.');
              setIsLoading(false);
              return;
            }

            nextParticipant = {
              id: customerDoc.id,
              customerId: customerDoc.id,
              userId: customerUserId,
              customerUserId,
              name: getCustomerName(data),
              customerName: getCustomerName(data),
              image: data.photoUrl || data.profileImageUrl || '',
              email: data.email || data.customerEmail || '',
              accountType: 'Client',
              type: 'customer',
            };
          }
        }

        if (!nextParticipant) {
          const participantCompanyDoc = await getDoc(doc(db, 'companies', participantId));
          if (participantCompanyDoc.exists()) {
            const data = participantCompanyDoc.data();
            nextParticipant = {
              id: participantCompanyDoc.id,
              userId: data.ownerId || participantCompanyDoc.id,
              ownerId: data.ownerId || participantCompanyDoc.id,
              name: data.name || 'Company',
              image: data.logoUrl || '',
              email: data.email || data.ownerEmail || '',
              companyId: participantCompanyDoc.id,
              companyName: data.name || '',
              type: 'company',
            };
          }
        }

        if (!nextParticipant) {
          setError('Participant not found.');
          setIsLoading(false);
          return;
        }

        const existingChat = await findVisibleChatWithParticipant({
          db,
          currentUserId: user.uid,
          selectedCompanyId: recentlySelectedCompany,
          includeCompanyWide: companyRoleLoaded && hasCompanyPermission(COMPANY_WIDE_MESSAGES_PERMISSION_ID),
          participantId: nextParticipant.ownerId || nextParticipant.userId || nextParticipant.id,
          participantCompanyId: nextParticipant.type === 'company' ? nextParticipant.companyId : '',
        });

        if (existingChat) {
          navigate(`/companies-chat/detail/${existingChat.id}`, { replace: true });
          return;
        }

        setParticipantInfo(nextParticipant);
        setIsLoading(false);
      } catch (loadError) {
        console.error('Error preparing chat:', loadError);
        setError('Unable to start this message.');
        setIsLoading(false);
      }
    };

    findOrCreateChat();
  }, [companyRoleLoaded, hasCompanyPermission, participantId, recentlySelectedCompany, recentlySelectedCompanyName, user, navigate]);

  const handleSendFirstMessage = async (event) => {
    event.preventDefault();
    if (!newMessage.trim() || !participantInfo || !recentlySelectedCompany) return;

    try {
      setIsSending(true);
      const chatId = await createCompanyChat({
        db,
        user,
        dataBaseUser,
        selectedCompanyId: recentlySelectedCompany,
        selectedCompanyName: recentlySelectedCompanyName,
        participant: participantInfo,
        message: newMessage,
      });
      if (!chatId) throw new Error('Unable to create message.');

      navigate(`/companies-chat/detail/${chatId}`, { replace: true });
    } catch (sendError) {
      console.error('Error creating chat:', sendError);
      setError('Unable to send the first message.');
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6 text-sm text-slate-500">
        Loading message...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-950 sm:px-4 lg:px-5">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <Header participantName="New Message" onBack={() => navigate(backPath)} />
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center text-sm font-semibold text-red-700">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-950 sm:px-4 lg:px-5">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <Header participantName={participantInfo?.name || 'New Message'} onBack={() => navigate(-1)} />

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
            <ParticipantAvatar participant={participantInfo} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-950">{participantInfo?.name || 'New Message'}</p>
              <p className="truncate text-sm text-slate-500">{participantInfo?.email || participantInfo?.accountType || 'Message recipient'}</p>
            </div>
          </div>
          <form onSubmit={handleSendFirstMessage} className="p-4 sm:p-5">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">First message</span>
              <textarea
                rows={5}
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
                placeholder="Type your first message..."
                className="mt-2 min-h-[132px] w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={isSending || !newMessage.trim()}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
                aria-label="Send first message"
              >
                <PaperAirplaneIcon className="h-5 w-5" />
                <span>{isSending ? 'Sending...' : 'Send Message'}</span>
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
};

const Header = ({ participantName, onBack }) => (
  <header className="flex min-w-0 items-center gap-3">
    <button
      type="button"
      onClick={onBack}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
      aria-label="Back to messages"
    >
      <ArrowLeftIcon className="h-5 w-5" />
    </button>
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
      <ChatBubbleLeftRightIcon className="h-6 w-6" />
    </span>
    <div className="min-w-0">
      <h1 className="truncate text-3xl font-bold tracking-tight text-slate-950">Messages</h1>
      <p className="truncate text-sm font-medium text-slate-500">New message to {participantName || '...'}</p>
    </div>
  </header>
);

const ParticipantAvatar = ({ participant }) => {
  const name = participant?.name || participant?.userName || 'M';
  const avatarText = name.charAt(0).toUpperCase();

  if (participant?.image) {
    return (
      <img
        src={participant.image}
        alt=""
        className="h-11 w-11 shrink-0 rounded-md object-cover"
      />
    );
  }

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-blue-50 text-sm font-bold text-blue-700">
      {avatarText}
    </span>
  );
};

export default CompanyChatInitiationView;
