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
        className={`max-w-[82%] break-words rounded-lg px-3.5 py-2.5 text-sm shadow-sm sm:max-w-md ${
          outgoing ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-800'
        }`}
      >
        {message.message ? (
          <p className="whitespace-pre-wrap leading-5">{message.message}</p>
        ) : null}
        {links.map((link) => (
          <ConversationLinkCard
            key={link.id || `${link.type}-${link.recordId}`}
            link={link}
            audience={audience}
            inverted={outgoing}
          />
        ))}
        <p className={`mt-1 text-right text-[11px] font-medium ${outgoing ? 'text-blue-100' : 'text-slate-400'}`}>
          {formatMessageTime(message.dateSent)}
        </p>
      </div>
    </div>
  );
};

export default MessageBubble;
