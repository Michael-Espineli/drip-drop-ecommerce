import React, {useState, useEffect, useContext} from 'react';
import { query, collection, getDocs, limit, orderBy, where } from "firebase/firestore";
import { db } from "../../utils/config";
import { Context } from '../../context/AuthContext';
import ChatCard from '../components/ChatCard';

const NoCompanyChat = () => {
    const { user } = useContext(Context);
    const [chatId, setChatId] = useState(null);
    const [chats, setChats] = useState([]);
    const [messages, setMessages] = useState([]);
    const [participantList, setParticipantList] = useState([]);
    const [newMessage, setNewMessage] = useState('');

    useEffect(() => {
        (async () => {
            try {
                // Query all chats the user is a participant in
                const q = query(collection(db, 'chats'), where('participants', 'array-contains', user.uid));
                const querySnapshot = await getDocs(q);
                const chatList = [];
                querySnapshot.forEach((doc) => {
                    const chatData = doc.data();
                    chatList.push({
                        id: doc.id, // Use doc.id as the chat ID
                        ...chatData
                    });
                });
                setChats(chatList);
            } catch (error) {
                console.error("Error fetching chats: ", error);
            }
        })();
    }, [user.uid]);

    const sendNewMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !chatId) return;

        const messageData = {
            chatId: chatId,
            senderId: user.uid,
            senderName: user.displayName || "Anonymous", // Assumes user object has displayName
            text: newMessage,
            dateSent: new Date(),
            read: false
        };

        // Mock sending message by adding to local state
        setMessages(prevMessages => [messageData, ...prevMessages]);
        setNewMessage('');

        // Here you would typically add the message to Firestore
        // await addDoc(collection(db, "messages"), messageData);
    };

    const getMessagesForChat = async (selectedChatId, participants) => {
        setChatId(selectedChatId);
        setParticipantList(participants.filter(p => p.userId !== user.uid).map(p => p.userName));

        try {
            const q = query(collection(db, 'messages'), where('chatId', '==', selectedChatId), orderBy('dateSent', 'desc'), limit(50));
            const querySnapshot = await getDocs(q);
            const messageList = [];
            querySnapshot.forEach((doc) => {
                messageList.push({ id: doc.id, ...doc.data() });
            });
            setMessages(messageList);
        } catch (error) {
            console.error("Error fetching messages: ", error);
        }
    };

    return (
        <div className='px-2 md:px-7 py-5 bg-gray-50'>
            <div className="w-full flex justify-center">
                <div className='w-full p-4 rounded-md'>
                    <h2 className="text-3xl font-bold mb-6 text-gray-800">Messages</h2>
                    <div className='w-full flex flex-wrap mt-4'>
                        {/* Sidebar with chat list */}
                        <div className='w-full lg:w-4/12 lg:pr-4'>
                            <div className='w-full bg-white p-4 rounded-lg shadow-md h-[calc(100vh-200px)] overflow-y-auto'>
                                {chats.map(chat => (
                                    <div key={chat.id} className='py-2 hover:cursor-pointer' onClick={() => getMessagesForChat(chat.id, chat.participants)}>
                                        <ChatCard 
                                            id={chat.id}
                                            userId={user.uid}
                                            participants={chat.participants}
                                            isActive={chat.id === chatId}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Main chat window */}
                        <div className='w-full lg:w-8/12'>
                            <div className='w-full h-full bg-white p-4 rounded-lg shadow-md flex flex-col'>
                                {chatId ? (
                                    <>
                                        <div className='border-b pb-3 mb-4'>
                                            <h3 className='text-xl font-semibold text-gray-800'>{participantList.join(', ')}</h3>
                                        </div>
                                        <div className='flex-grow h-[calc(100vh-380px)] overflow-y-auto flex flex-col-reverse p-3 bg-gray-50 rounded-md'>
                                            {messages.map((message, index) => (
                                                <div key={index} className={`flex ${message.senderId === user.uid ? 'justify-end' : 'justify-start'} mb-3`}>
                                                    <div className={`py-2 px-4 rounded-2xl max-w-lg ${message.senderId === user.uid ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                                                        <p className='text-sm'>{message.text}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <form onSubmit={sendNewMessage} className='mt-4'>
                                            <div className='flex items-center gap-3'>
                                                <input 
                                                    onChange={(e) => setNewMessage(e.target.value)}
                                                    value={newMessage}
                                                    className='w-full bg-gray-100 rounded-full text-gray-800 px-4 py-2 border focus:outline-none focus:ring-2 focus:ring-blue-500'
                                                    placeholder='Type your message...'
                                                />
                                                <button type="submit" className='bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-5 rounded-full shadow-lg transition-colors duration-300'>
                                                    Send
                                                </button>
                                            </div>
                                        </form>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-500">
                                        <p>Select a chat to start messaging</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NoCompanyChat;
