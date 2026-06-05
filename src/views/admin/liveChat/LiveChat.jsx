import React, { useMemo, useState } from 'react';

const ADMIN_YELLOW = '#debf44';

function LiveChat() {
  const [searchTerm, setSearchTerm] = useState('');
  const conversations = useMemo(() => [], []);
  const selectedConversation = conversations[0] || null;

  const filteredConversations = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    if (!search) return conversations;

    return conversations.filter((conversation) => {
      return Object.values(conversation)
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }, [conversations, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-900 px-2 md:px-7 py-5 text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Live Chat
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Monitor and respond to admin support conversations.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-950 border border-slate-800/60 rounded-xl px-4 py-3 min-w-28">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Open</p>
            <p className="mt-1 text-2xl font-extrabold" style={{ color: ADMIN_YELLOW }}>0</p>
          </div>
          <div className="bg-slate-950 border border-slate-800/60 rounded-xl px-4 py-3 min-w-28">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Waiting</p>
            <p className="mt-1 text-2xl font-extrabold text-orange-200">0</p>
          </div>
          <div className="bg-slate-950 border border-slate-800/60 rounded-xl px-4 py-3 min-w-28">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Closed</p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-300">0</p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4 min-h-[620px]">
        <aside className="bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800/60">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search conversations"
              className="w-full px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
            />
          </div>

          <div className="divide-y divide-slate-800/60">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className="w-full text-left p-4 hover:bg-slate-900/60 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-100">{conversation.name}</p>
                    <p className="mt-1 text-sm text-slate-400 line-clamp-2">{conversation.preview}</p>
                  </div>
                  <span className="text-xs text-slate-500">{conversation.time}</span>
                </div>
              </button>
            ))}
          </div>

          {filteredConversations.length === 0 && (
            <div className="p-8 text-center">
              <p className="font-bold text-slate-100">No conversations found.</p>
              <p className="mt-1 text-sm text-slate-500">Live chat threads will appear here.</p>
            </div>
          )}
        </aside>

        <section className="bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800/60 flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-slate-100">
                {selectedConversation?.name || 'Conversation'}
              </p>
              <p className="text-sm text-slate-500">
                {selectedConversation ? selectedConversation.status : 'No active thread selected'}
              </p>
            </div>

            <button
              type="button"
              disabled={!selectedConversation}
              className="px-4 py-2 rounded-md font-semibold bg-slate-900/70 text-slate-300 border border-slate-800/60 disabled:opacity-40"
            >
              Close Thread
            </button>
          </div>

          <div className="flex-1 p-6 flex items-center justify-center">
            <div className="text-center max-w-sm">
              <p className="text-lg font-bold text-slate-100">No chat selected.</p>
              <p className="mt-1 text-sm text-slate-500">
                Conversation messages and admin replies will show here when chat data is connected.
              </p>
            </div>
          </div>

          <div className="p-4 border-t border-slate-800/60">
            <div className="flex gap-3">
              <input
                type="text"
                disabled={!selectedConversation}
                placeholder="Type a reply"
                className="flex-1 px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
              />
              <button
                type="button"
                disabled={!selectedConversation}
                className="px-4 py-2 rounded-md font-semibold bg-[#debf44] text-slate-950 hover:bg-[#debf44]/90 transition disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default LiveChat;
