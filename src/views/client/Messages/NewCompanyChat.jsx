
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { ArrowLeftIcon, BuildingOffice2Icon, ChatBubbleLeftRightIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { createClientCompanyChat, findVisibleChatWithParticipant } from '../../../utils/chatMessaging';

const NewCompanyChat = () => {
    const { companyId } = useParams();
    const navigate = useNavigate();
    const { user, dataBaseUser } = useContext(Context);

    const [company, setCompany] = useState(null);
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchCompany = async () => {
            try {
                const companyDoc = await getDoc(doc(db, 'companies', companyId));
                if (companyDoc.exists()) {
                    const companyData = { id: companyDoc.id, ...companyDoc.data() };
                    const existingChat = user?.uid
                        ? await findVisibleChatWithParticipant({
                            db,
                            currentUserId: user.uid,
                            participantId: companyData.ownerId || companyData.userId || companyData.id,
                            participantCompanyId: companyData.id,
                        })
                        : null;

                    if (existingChat) {
                        navigate(`/client/chat/details/${existingChat.id}`, { replace: true });
                        return;
                    }

                    setCompany(companyData);
                } else {
                    setError("Company not found.");
                }
            } catch (err) {
                console.error(err);
                setError("Failed to load company details.");
            }
            setLoading(false);
        };

        if (companyId) {
            fetchCompany();
        }
    }, [companyId, navigate, user]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!message.trim()) return;

        setIsSending(true);
        setError(null);

        try {
            const chatId = await createClientCompanyChat({
                db,
                user,
                dataBaseUser,
                company,
                message,
            });
            if (!chatId) throw new Error("Unable to create message.");

            navigate(`/client/chat/details/${chatId}`);

        } catch (err) {
            console.error("Error sending message: ", err);
            setError("Failed to start conversation. Please try again.");
            setIsSending(false);
        }
    };

    if (loading) {
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
                    <Header companyName="New Message" onBack={() => navigate(-1)} />
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
                <Header companyName={company?.name} onBack={() => navigate(-1)} />

                <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                        <CompanyAvatar company={company} />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-950">{company?.name || 'Company'}</p>
                            <p className="truncate text-sm text-slate-500">{company?.email || company?.ownerEmail || 'Message recipient'}</p>
                        </div>
                    </div>
                    <form onSubmit={handleSendMessage} className="p-4 sm:p-5">
                        <label className="block">
                            <span className="text-sm font-semibold text-slate-700">First message</span>
                            <textarea
                                rows={5}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Type your message..."
                                className="mt-2 min-h-[132px] w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                disabled={isSending}
                            />
                        </label>
                        <div className="mt-4 flex justify-end">
                            <button
                                type="submit"
                                disabled={isSending || !message.trim()}
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

const Header = ({ companyName, onBack }) => (
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
            <p className="truncate text-sm font-medium text-slate-500">New message to {companyName || '...'}</p>
        </div>
    </header>
);

const CompanyAvatar = ({ company }) => {
    if (company?.logoUrl || company?.photoUrl) {
        return (
            <img
                src={company.logoUrl || company.photoUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-md object-cover"
            />
        );
    }

    return (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            <BuildingOffice2Icon className="h-6 w-6" />
        </span>
    );
};

export default NewCompanyChat;
