import React from 'react';
import ChatConversationView from '../../components/chat/ChatConversationView';
import ParticipantInfoModal from './ParticipantInfoModal';

const CompanyConversation = () => (
  <ChatConversationView
    audience="client"
    backPath="/client/chat"
    ParticipantInfoModal={ParticipantInfoModal}
  />
);

export default CompanyConversation;
