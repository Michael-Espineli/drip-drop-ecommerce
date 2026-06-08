import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowTopRightOnSquareIcon, LinkIcon } from '@heroicons/react/24/outline';
import {
  getConversationLinkLabel,
  getConversationLinkRoute,
  normalizeConversationLink,
} from '../../../utils/chatMessaging';

const ConversationLinkCard = ({ link, audience = 'company', inverted = false }) => {
  const navigate = useNavigate();
  const normalizedLink = normalizeConversationLink(link);
  const route = getConversationLinkRoute(normalizedLink, audience);
  const label = getConversationLinkLabel(normalizedLink.type);

  const cardClasses = inverted
    ? 'border-blue-200 bg-white/95 text-slate-900'
    : 'border-slate-200 bg-white text-slate-900';
  const metaClasses = inverted ? 'text-blue-700' : 'text-slate-500';

  const handleOpen = () => {
    if (route) navigate(route);
  };

  return (
    <div className={`mt-2 overflow-hidden rounded-lg border ${cardClasses}`}>
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
          <LinkIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold uppercase ${metaClasses}`}>{label}</p>
          <p className="mt-0.5 truncate text-sm font-semibold">{normalizedLink.title}</p>
          {normalizedLink.subtitle ? (
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">{normalizedLink.subtitle}</p>
          ) : null}
          {normalizedLink.recordId ? (
            <p className="mt-2 truncate font-mono text-[11px] text-slate-400">{normalizedLink.recordId}</p>
          ) : null}
        </div>
        {route ? (
          <button
            type="button"
            onClick={handleOpen}
            className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label={`Open ${label}`}
          >
            <ArrowTopRightOnSquareIcon className="h-5 w-5" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default ConversationLinkCard;
