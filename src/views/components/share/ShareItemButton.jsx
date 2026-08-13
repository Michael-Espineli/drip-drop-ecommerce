import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  ShareIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { COMPANY_WIDE_MESSAGES_PERMISSION_ID } from "../../../utils/companyPermissions";
import {
  CHAT_AUDIENCE,
  buildSharedRecordUrl,
  getChatAudience,
  getChatAvatarText,
  getChatDisplayTitle,
  getChatPreview,
  getConversationLinkLabel,
  getUserDisplayName,
  listenVisibleChats,
  normalizeConversationLink,
  sendChatMessage,
} from "../../../utils/chatMessaging";

const copyText = async (text) => {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined") return false;

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }
};

const chatSearchText = (chat, userId, companyId) => [
  getChatDisplayTitle(chat, userId, { companyId, audience: "company" }),
  getChatPreview(chat),
  chat.customerName,
  chat.companyName,
  chat.title,
].filter(Boolean).join(" ").toLowerCase();

const ShareItemButton = ({
  type,
  recordId,
  title,
  subtitle = "",
  companyId = "",
  customerId = "",
  customerUserId = "",
  collectionPath = "",
  webPath = "",
  companyWebPath = "",
  className = "",
  buttonClassName = "",
  label = "Share",
  compact = false,
  disabled = false,
}) => {
  const navigate = useNavigate();
  const {
    user,
    dataBaseUser,
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    companyRoleLoaded,
    hasCompanyPermission,
  } = useContext(Context);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("message");
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const resolvedCompanyId = companyId || recentlySelectedCompany || "";
  const normalizedLink = useMemo(() => normalizeConversationLink({
    type,
    recordId,
    title,
    subtitle,
    companyId: resolvedCompanyId,
    customerId,
    customerUserId,
    collectionPath,
    webPath,
    companyWebPath: companyWebPath || webPath,
  }), [
    collectionPath,
    companyWebPath,
    customerId,
    customerUserId,
    recordId,
    resolvedCompanyId,
    subtitle,
    title,
    type,
    webPath,
  ]);
  const shareUrl = useMemo(() => buildSharedRecordUrl(normalizedLink, {
    audience: "external",
    companyId: resolvedCompanyId,
    customerId,
    customerUserId,
  }), [customerId, customerUserId, normalizedLink, resolvedCompanyId]);
  const linkLabel = getConversationLinkLabel(normalizedLink.type);
  const canShare = Boolean(normalizedLink.type && normalizedLink.recordId && resolvedCompanyId && user?.uid);

  const internalChats = useMemo(() => (
    chats.filter((chat) => getChatAudience(chat) === CHAT_AUDIENCE.internal)
  ), [chats]);
  const filteredChats = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return internalChats;

    return internalChats.filter((chat) => (
      chatSearchText(chat, user?.uid, resolvedCompanyId).includes(search)
    ));
  }, [internalChats, resolvedCompanyId, searchTerm, user]);
  const selectedChat = useMemo(() => (
    internalChats.find((chat) => chat.id === selectedChatId) || null
  ), [internalChats, selectedChatId]);

  useEffect(() => {
    if (!isOpen || !user?.uid || !resolvedCompanyId) {
      setChats([]);
      setChatsLoading(false);
      return undefined;
    }

    setChatsLoading(true);
    const unsubscribe = listenVisibleChats({
      db,
      userId: user.uid,
      companyId: resolvedCompanyId,
      includeCompanyWide: companyRoleLoaded && hasCompanyPermission(COMPANY_WIDE_MESSAGES_PERMISSION_ID),
      onChange: (visibleChats) => {
        setChats(visibleChats);
        setChatsLoading(false);
      },
      onError: (error) => {
        console.error("Unable to load share target chats:", error);
        setChatsLoading(false);
      },
    });

    return () => unsubscribe();
  }, [companyRoleLoaded, hasCompanyPermission, isOpen, resolvedCompanyId, user]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedChatId && filteredChats.some((chat) => chat.id === selectedChatId)) return;
    setSelectedChatId(filteredChats[0]?.id || "");
  }, [filteredChats, isOpen, selectedChatId]);

  useEffect(() => {
    if (!copied) return undefined;

    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const openShare = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsOpen(true);
  };

  const closeShare = () => {
    if (sending) return;

    setIsOpen(false);
    setSearchTerm("");
    setMessageDraft("");
    setActiveTab("message");
  };

  const handleCopyLink = async () => {
    try {
      const didCopy = await copyText(shareUrl);
      if (!didCopy) throw new Error("Clipboard unavailable.");
      setCopied(true);
      toast.success("Link copied.");
    } catch (error) {
      console.error("Unable to copy share link:", error);
      toast.error("Could not copy link.");
    }
  };

  const handleSendInternal = async () => {
    if (!selectedChat || !canShare || sending) return;

    setSending(true);
    try {
      await sendChatMessage({
        db,
        chatId: selectedChat.id,
        chat: selectedChat,
        text: messageDraft,
        link: normalizedLink,
        senderId: user.uid,
        senderName: getUserDisplayName(dataBaseUser, user),
        senderCompanyId: resolvedCompanyId,
        senderCompanyName: recentlySelectedCompanyName || "",
      });
      toast.success("Shared in Messages.");
      closeShare();
    } catch (error) {
      console.error("Unable to share item in messages:", error);
      toast.error("Could not send share.");
    } finally {
      setSending(false);
    }
  };

  const handleOpenMessages = () => {
    closeShare();
    navigate("/company/messages");
  };

  return (
    <span className={className}>
      <button
        type="button"
        onClick={openShare}
        disabled={disabled || !canShare}
        className={buttonClassName || "inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"}
        aria-label={`Share ${title || linkLabel}`}
        title={`Share ${title || linkLabel}`}
      >
        <ShareIcon className="h-4 w-4" aria-hidden="true" />
        {!compact && <span>{label}</span>}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/50 px-0 sm:items-center sm:px-4 sm:py-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Share ${title || linkLabel}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeShare();
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg bg-white shadow-xl sm:rounded-lg">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                  <ShareIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold text-slate-950">Share {linkLabel}</h3>
                  <p className="truncate text-sm font-medium text-slate-500">{normalizedLink.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeShare}
                disabled={sending}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Close share"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("message")}
                className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${activeTab === "message" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
              >
                <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden="true" />
                Internal
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("link")}
                className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${activeTab === "link" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
              >
                <LinkIcon className="h-4 w-4" aria-hidden="true" />
                Link
              </button>
            </div>

            {activeTab === "message" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-slate-100 p-4 sm:p-5">
                  <div className="relative">
                    <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search internal messages"
                      className="h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      type="search"
                    />
                  </div>
                </div>

                <div className="min-h-[16rem] flex-1 overflow-y-auto p-2 sm:p-3">
                  {chatsLoading ? (
                    <ShareChatSkeleton />
                  ) : filteredChats.length > 0 ? (
                    <ul className="space-y-1">
                      {filteredChats.map((chat) => (
                        <ShareChatOption
                          key={chat.id}
                          chat={chat}
                          userId={user?.uid}
                          companyId={resolvedCompanyId}
                          selected={chat.id === selectedChatId}
                          onSelect={() => setSelectedChatId(chat.id)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                        <ChatBubbleLeftRightIcon className="h-7 w-7" aria-hidden="true" />
                      </span>
                      <p className="mt-3 text-sm font-semibold text-slate-950">No internal messages found.</p>
                      <button
                        type="button"
                        onClick={handleOpenMessages}
                        className="mt-4 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                      >
                        Open Messages
                      </button>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 p-4 sm:p-5">
                  <textarea
                    rows={3}
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    placeholder="Add a message"
                    className="min-h-[88px] w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeShare}
                      disabled={sending}
                      className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSendInternal}
                      disabled={!selectedChat || sending || !canShare}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <PaperAirplaneIcon className="h-4 w-4" aria-hidden="true" />
                      {sending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 sm:p-5">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">External link</span>
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700 outline-none"
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    {copied ? (
                      <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy Link"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
};

const ShareChatOption = ({ chat, userId, companyId, selected, onSelect }) => {
  const title = getChatDisplayTitle(chat, userId, { companyId, audience: "company" });
  const preview = getChatPreview(chat);
  const avatarText = getChatAvatarText(chat, userId, { companyId, audience: "company" });

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition ${selected ? "bg-blue-50 ring-2 ring-blue-100" : "hover:bg-slate-50"}`}
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold ${selected ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700"}`}>
          {avatarText}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-950">{title}</span>
          <span className="mt-0.5 block truncate text-sm text-slate-500">{preview}</span>
        </span>
        {selected && <CheckCircleIcon className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />}
      </button>
    </li>
  );
};

const ShareChatSkeleton = () => (
  <div className="space-y-2">
    {[0, 1, 2].map((item) => (
      <div key={item} className="flex animate-pulse items-center gap-3 rounded-md px-3 py-3">
        <div className="h-10 w-10 rounded-md bg-slate-200" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-1/2 rounded bg-slate-200" />
          <div className="h-3 w-2/3 rounded bg-slate-100" />
        </div>
      </div>
    ))}
  </div>
);

export default ShareItemButton;
