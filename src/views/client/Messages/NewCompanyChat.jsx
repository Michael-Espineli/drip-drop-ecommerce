
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, addDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { ArrowLeftIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { v4 as uuidv4 } from 'uuid';

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
                    setCompany({ id: companyDoc.id, ...companyDoc.data() });
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
    }, [companyId]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!message.trim()) return;

        setIsSending(true);
        setError(null);

        try {
            // Step 1: Create the chat document first

            const chatId = 'cha_' + uuidv4();
            const newChatRef = doc(collection(db, 'chats',chatId));
            let fullName = dataBaseUser.firstName + " " + dataBaseUser.lastName
            const newChatData = {
                id:chatId,
                participantIds: [user.uid, company.id],
                participants: [
                    { userName: fullName, id: uuidv4(),userId:user.uid, userImage:dataBaseUser.photoUrl },
                    { userName: company.ownerName, id: uuidv4(), userId:company.ownerId, userImage: "" }
                ],
                userWhoHaveNotRead: [company.id],
                companyName: company.name,
                lastMessage: message.trim(),
                mostRecentChat: serverTimestamp(),
            };
            
            await setDoc(newChatRef, newChatData);

            // Step 2: Add the first message to the new chat
            const messageId = 'msg_' + uuidv4();
            
            const messagesColRef = doc(db,'messages',messageId);
            await setDoc(messagesColRef, {
                id:messageId,
                message: message.trim(),
                chatId: newChatRef.id,
                senderId: user.uid,
                receiverId: company.id,
                dateSent: serverTimestamp(),
            });

            // Step 3: Navigate to the newly created chat
            navigate(`/client/chat/details/${newChatRef.id}`);

        } catch (err) {
            console.error("Error sending message: ", err);
            setError("Failed to start conversation. Please try again.");
            setIsSending(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-center">Loading...</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">{error}</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <Header companyName={company?.name} onBack={() => navigate(-1)} />

                <div className="bg-white rounded-lg shadow-md mt-8">
                    <div className="p-6">
                        <p className="text-center text-gray-500">You are starting a new conversation with <strong>{company?.name}</strong>.</p>
                    </div>
                    <div className="p-4 border-t">
                        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Type your message..."
                                className="flex-grow px-4 py-2 bg-white border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                disabled={isSending}
                            />
                            <button 
                                type="submit" 
                                disabled={isSending || !message.trim()}
                                className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
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

const Header = ({ companyName, onBack }) => (
    <div className="flex flex-col gap-2">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 w-fit">
            <ArrowLeftIcon className="w-5 h-5" />
            Back
        </button>
        <h1 className="text-3xl font-bold text-gray-900 truncate">New Message to {companyName || '...'}</h1>
    </div>
);

export default NewCompanyChat;
