import React from 'react';
import ConversationLinkCard from './ConversationLinkCard';
import { getMessageLinks, isOutgoingMessage } from '../../../utils/chatMessaging';

const formatMessageTime = (timestamp) => {
  if (!timestamp || typeof timestamp.toDate !== 'function') return '';

  return timestamp.toDate().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const MessageBubble = ({ message, userId, companyId = '', audience = 'company' }) => {
  const outgoing = isOutgoingMessage(message, { userId, companyId });
  const links = getMessageLinks(message);

  return (
    <div className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-xs break-words rounded-lg px-4 py-2 lg:max-w-md ${
          outgoing ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
        }`}
      >
        {message.message ? (
          <p className="whitespace-pre-wrap text-sm">{message.message}</p>
        ) : null}
        {links.map((link) => (
          <ConversationLinkCard
            key={link.id || `${link.type}-${link.recordId}`}
            link={link}
            audience={audience}
            inverted={outgoing}
          />
        ))}
        <p className="mt-1 text-right text-xs opacity-70">{formatMessageTime(message.dateSent)}</p>
      </div>
    </div>
  );
};

export default MessageBubble;
