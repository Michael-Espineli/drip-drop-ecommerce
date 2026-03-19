import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { ArrowLeftIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { v4 as uuidv4 } from 'uuid';

const ChatInitiation = () => {
    const { participantId } = useParams();
    const { user, dataBaseUser } = useContext(Context);
    const [newMessage, setNewMessage] = useState('');
    const [participantInfo, setParticipantInfo] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        console.log("participantId: ", participantId)
        console.log("user: ", user)
        if (!participantId || !user) {

            // navigate('/companies-chat');
            return;
        }

        const findOrCreateChat = async () => {
            const chatsRef = collection(db, 'chats');
            const q = query(chatsRef, where('participantIds', 'in', [[user.uid, participantId], [participantId, user.uid]]));
            const existingChatSnapshot = await getDocs(q);

            if (!existingChatSnapshot.empty) {
                const chatId = existingChatSnapshot.docs[0].id;
                navigate(`/companies-chat/detail/${chatId}`, { replace: true });
                return;
            }
            
            let participantDoc;
            participantDoc = await getDoc(doc(db, 'users', participantId));
            if (participantDoc.exists()) {
                const data = participantDoc.data();
                setParticipantInfo({
                    id: participantDoc.id,
                    name: `${data.firstName} ${data.lastName}`,
                    image: data.profileImageUrl,
                    type: 'user'
                });
            } else {
                participantDoc = await getDoc(doc(db, 'companies', participantId));
                if (participantDoc.exists()) {
                    const data = participantDoc.data();
                    setParticipantInfo({
                        id: participantDoc.id,
                        name: data.name,
                        image: data.logoUrl,
                        type: 'company'
                    });
                } else {
                    console.error("Participant not found in 'users' or 'companies'");
                    navigate('/companies-chat');
                    return;
                }
            }
            setIsLoading(false);
        };

        findOrCreateChat();
    }, [participantId, user, navigate]);

    const handleSendFirstMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !participantInfo) return;

        const batch = writeBatch(db);
        const chatId = 'chat_' + uuidv4();
        const newChatRef = doc(db, 'chats',chatId);
        const newChatData = {
            id:chatId,
            companyName: participantInfo.name,
            participantIds: [user.uid, participantInfo.id],
            participants: [
                {
                    id:uuidv4(),
                    userId: user.uid,
                    userName: `${dataBaseUser.firstName} ${dataBaseUser.lastName}`,
                    userImage: dataBaseUser.photoUrl || "",
                },
                {
                    id:uuidv4(),
                    userId: participantInfo.id,
                    userName: participantInfo.name,
                    userImage: participantInfo.image || "",
                }
            ],
            mostRecentChat: serverTimestamp(),
            userWhoHaveNotRead: [participantInfo.id],
            lastMessage: newMessage,
        };
        await setDoc(newChatRef, newChatData);

        const messageId = 'msg_' + uuidv4();

        const newMessageRef = doc(db, 'messages', messageId);
        const newMessageData = {
            id:messageId,
            chatId: newChatRef.id,
            message: newMessage,
            senderId: user.uid,
            senderName: `${dataBaseUser.firstName} ${dataBaseUser.lastName}` || "User",
            read: false,
            dateSent: serverTimestamp(),
        };
        await setDoc(newMessageRef, newMessageData);

        await batch.commit();

        navigate(`/companies-chat/detail/${newChatRef.id}`, { replace: true });
    };

    if (isLoading) {
        return <div className="flex justify-center items-center h-screen"><p>Loading chat...</p></div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <Header companyName={participantInfo?.name || 'New Chat'} onBack={() => navigate(-1)} />

                <div className="bg-white rounded-lg shadow-md mt-8">
                    <div className="p-6">
                        <p className="text-center text-gray-500">You are starting a new conversation with <strong>{participantInfo?.name || 'New Chat'}</strong>.</p>
                    </div>
                    <div className="p-4 border-t">
                        <form onSubmit={handleSendFirstMessage} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="Type your first message..."
                                className="flex-grow px-4 py-2 bg-white border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button 
                                type="submit" 
                                disabled={!newMessage.trim()}
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

const Header = ({ clientName, onBack }) => (
    <div className="flex flex-col gap-2">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 w-fit">
            <ArrowLeftIcon className="w-5 h-5" />
            Back
        </button>
        <h1 className="text-3xl font-bold text-gray-900 truncate">New Message to {clientName || '...'}</h1>
    </div>
);
export default ChatInitiation;
