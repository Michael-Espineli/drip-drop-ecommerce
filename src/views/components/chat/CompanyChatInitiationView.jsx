import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeftIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
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

const CompanyChatInitiationView = ({ backPath = '/companies-chat' }) => {
  const params = useParams();
  const participantId = params.participantId || params.clientId;
  const navigate = useNavigate();
  const {
    user,
    dataBaseUser,
    recentlySelectedCompany,
    recentlySelectedCompanyName,
  } = useContext(Context);
  const [newMessage, setNewMessage] = useState('');
  const [participantInfo, setParticipantInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!participantId || !user?.uid) {
      setIsLoading(false);
      return;
    }

    if (!recentlySelectedCompany) {
      setError('Select a company before starting a chat.');
      setIsLoading(false);
      return;
    }

    const findOrCreateChat = async () => {
      setIsLoading(true);
      setError(null);

      try {
        let nextParticipant = null;
        const participantUserDoc = await getDoc(doc(db, 'users', participantId));

        if (participantUserDoc.exists()) {
          const data = participantUserDoc.data();
          nextParticipant = {
            id: participantUserDoc.id,
            userId: participantUserDoc.id,
            name: getParticipantName(data),
            image: data.photoUrl || data.profileImageUrl || data.profileImageURL || '',
            email: data.email || '',
            accountType: data.accountType || '',
            companyId: data.companyId || '',
            companyName: data.companyName || '',
            type: 'user',
          };
        } else {
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
          } else if (recentlySelectedCompany) {
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
          participantId: nextParticipant.ownerId || nextParticipant.userId || nextParticipant.id,
          participantCompanyId: nextParticipant.companyId,
        });

        if (existingChat) {
          navigate(`/companies-chat/detail/${existingChat.id}`, { replace: true });
          return;
        }

        setParticipantInfo(nextParticipant);
        setIsLoading(false);
      } catch (loadError) {
        console.error('Error preparing chat:', loadError);
        setError('Unable to start this chat.');
        setIsLoading(false);
      }
    };

    findOrCreateChat();
  }, [participantId, recentlySelectedCompany, user, navigate]);

  const handleSendFirstMessage = async (event) => {
    event.preventDefault();
    if (!newMessage.trim() || !participantInfo || !recentlySelectedCompany) return;

    try {
      const chatId = await createCompanyChat({
        db,
        user,
        dataBaseUser,
        selectedCompanyId: recentlySelectedCompany,
        selectedCompanyName: recentlySelectedCompanyName,
        participant: participantInfo,
        message: newMessage,
      });
      if (!chatId) throw new Error('Unable to create chat.');

      navigate(`/companies-chat/detail/${chatId}`, { replace: true });
    } catch (sendError) {
      console.error('Error creating chat:', sendError);
      setError('Unable to send the first message.');
    }
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen"><p>Loading chat...</p></div>;
  }

  if (error) {
    return (
      <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <Header participantName="New Chat" onBack={() => navigate(backPath)} />
          <div className="mt-8 rounded-lg bg-white p-6 text-center text-red-600 shadow-md">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <Header participantName={participantInfo?.name || 'New Chat'} onBack={() => navigate(-1)} />

        <div className="bg-white rounded-lg shadow-md mt-8">
          <div className="p-6">
            <p className="text-center text-gray-500">
              You are starting a new conversation with <strong>{participantInfo?.name || 'New Chat'}</strong>.
            </p>
          </div>
          <div className="p-4 border-t">
            <form onSubmit={handleSendFirstMessage} className="flex items-center gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
                placeholder="Type your first message..."
                className="flex-grow px-4 py-2 bg-white border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={!newMessage.trim()}
                className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                aria-label="Send first message"
              >
                <PaperAirplaneIcon className="w-6 h-6" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

const Header = ({ participantName, onBack }) => (
  <div className="flex flex-col gap-2">
    <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 w-fit">
      <ArrowLeftIcon className="w-5 h-5" />
      Back
    </button>
    <h1 className="text-3xl font-bold text-gray-900 truncate">New Message to {participantName || '...'}</h1>
  </div>
);

export default CompanyChatInitiationView;
