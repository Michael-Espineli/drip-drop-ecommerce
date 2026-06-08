import React from 'react';
import ChatConversationView from '../../components/chat/ChatConversationView';
import ParticipantInfoModal from './ParticipantInfoModal';

const CompanyConversation = () => (
  <ChatConversationView
    audience="company"
    backPath="/companies-chat"
    ParticipantInfoModal={ParticipantInfoModal}
  />
);

export default CompanyConversation;
