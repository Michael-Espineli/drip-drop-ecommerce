import React from 'react';

const ChatCard = (props) => {
    const currentUserId = props.userId;
    const participants = Array.isArray(props.participants) ? props.participants : [];
    const otherParticipants = participants.filter((participant) => participant.userId !== currentUserId);
    const title = otherParticipants.map((participant) => participant.userName).filter(Boolean).join(', ') || 'Message';
    const imageUrl = otherParticipants.find((participant) => participant.userImage)?.userImage;
    const avatarText = title.charAt(0).toUpperCase();

    return (
        <div className={`w-full rounded-lg border px-3 py-3 transition ${props.isActive ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <div className="flex items-center gap-3">
                {imageUrl ? (
                    <img className="h-10 w-10 shrink-0 rounded-md object-cover" src={imageUrl} alt="" />
                ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-sm font-bold text-blue-700">
                        {avatarText}
                    </span>
                )}
                <div className="min-w-0">
                    <h1 className="truncate text-sm font-semibold text-slate-950">{title}</h1>
                    <p className="truncate text-xs font-medium text-slate-500">Messages</p>
                </div>
            </div>
        </div>
    );
};

export default ChatCard;
