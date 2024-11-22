import React, {useState, useEffect, useContext, lazy} from 'react';
import { useParams } from 'react-router-dom';
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { db } from "../../utils/config";
import { Context } from '../../context/AuthContext';
import ChatCard from '../components/ChatCard';
const Chat = () => {
    const uid = 'YOlmTUaH9YUKXdHnccSOCJPQosC2'

    const [chatId, setChatId] = useState([]);
    const [chats, setChats] = useState([]);
    const [firstDoc, setFirstDoc] = useState();
    const [lastDoc, setLastDoc] = useState();

    const [messages, setMessages] = useState([]);
    const [firstMessagesDoc, setFirstMessagesDoc] = useState();
    const [lastMessagesDoc, setMessagesLastDoc] = useState();
    const [participantList, setParticipantList] = useState([]);
    const [currentPage, setCurrentPage] = useState([]);
    const [posts, setPosts] = useState([]);
    const [postsPerPage, setPostsPerPage] = useState(9);


    const [newMessage, setNewMessage] = useState([]);

    useEffect(() => {
        (async () => {
            console.log('On Load')
            try{
                let q = query(collection(db, 'chats'));
                const querySnapshot = await getDocs(q);       
                let count = 1   
                setChats([])      
                querySnapshot.forEach((doc) => {
                    if (count == 1) { 
                        setFirstDoc(doc)
                    } else {
                        setLastDoc(doc)
                    }
                    const chatData = doc.data()
                    const  chat = {
                        id:chatData.id,
                        companyId:chatData.companyId,
                        mostRecentChat:chatData.mostRecentChat,
                        status: chatData.status,
                        participants: chatData.participants

                    }
                    count = count + 1
                    setChats(chats => [...chats, chat]);                            
                });
            } catch (error){

            }
        })();
    },[])
    async function sendNewMessage(e) {
        e.preventDefault()
        console.log(newMessage)
        const  message = {
            id:'messageData.id',
            dateSent:'messageData.dateSent',
            read:'messageData.read',
            senderId: uid,
            senderName: 'messageData.senderName',
            text: newMessage,
        }
        setMessages(messages => [message, ...messages]); 
        setNewMessage('')
    }
    const getMessagesForChat = async (chatId,participants) => {
        setChatId(chatId)
        try{
            setParticipantList([])
            for (let i = 0; i < participants.length; i++) {
                if (participants[i].userId === uid) {
                } else {
                    setParticipantList(participantList => [...participantList, participants[i].userName]); 
                }
            }
            let q = query(collection(db, 'messages'),where('chatId', '==', chatId),limit(20),orderBy('dateSent'));
            const querySnapshot = await getDocs(q);       
            let count = 1   

            setMessages([])   

            querySnapshot.forEach((doc) => {
                if (count == 1) { 
                    setFirstMessagesDoc(doc)
                } else {
                    setMessagesLastDoc(doc)
                }
                const messageData = doc.data()
                const  message = {
                    id:messageData.id,
                    dateSent:messageData.dateSent,
                    read:messageData.read,
                    senderId: messageData.senderId,
                    senderName: messageData.senderName,
                    text: messageData.message,
                }
                count = count + 1
                console.log(count)
                setMessages(messages => [...messages, message]); 

            });
            console.log('Reversing ')

            // setMessages([...messages].reverse());                         


        } catch (error){
            console.error(error)
        }
      };
      const handlePagination = (pageNumber) => {
        setCurrentPage (pageNumber);
    };
    return (
        // 030811 - almost black
        // 282c28 - black green
        // 454b39 - dark olive green
        // 536546 - olive green
        // 747e79 - gray green
        // ededed - off white
        // 1D2E76 - Pool Blue
        // CDC07B - Pool Yellow
        // 9C0D38 - Pool Red
        // 2B600F - Pool Green
        <div className='px-2 md:px-7 py-5'>
            <div className="w-full flex justify-center">
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                <h1>Messages</h1>
                    <div className='w-full flex flex-wrap mt-7'>
                        <div className='w-full lg:w-4/12 lg:pr-3'>
                            <div className='w-full bg-[#454b39] p-4 rounded-md text-[#d0d2d6] h-[calc(100ch-170px)] rounded-md p-3 overflow-y-auto'>
                                {/* Chat Cards */}
                                <div className='w-full'>
                                      {
                                        chats?.map( chat => (
                                            <div className='py-2 hover:cursor-pointer' onClick={()=> {getMessagesForChat(chat.id,chat.participants)}}>
                                                <ChatCard 
                                                id={chat.id}
                                                userId={uid}
                                                participants={chat.participants}
                                                />
                                            </div>

                                        ))
                                    }
                                </div>

                            </div>
                        </div>
                        {/* Messages Section */}
                        <div className='w-full lg:w-8/12 lg:pr-3'>
                            <div className='w-full h-full bg-[#454b39] p-4 rounded-md text-[#d0d2d6]'>
                                <div>
                                    {
                                        participantList.map( people => (
                                            <h1 className='text-black-500'>{people}</h1>
                                        ))
                                    }
                                    <h1> </h1>
                                </div>
                                <div className='py-2'>
                                    <div className='bg-[#282c28] h-[calc(100ch-290px)] rounded-md p-3 overflow-y-auto flex flex-col-reverse'>
                                        {
                                            messages?.map( message => (
                                                
                                                // If statement about switch between left and right side
                                                // { uid == message.senderId && 
                                                <div>
                                                    {
                                                    (uid==message.senderId)&& 
                                                    <div className='w-full flex justify-end items-center'>
                                                        <div className='flex justify-start items-start gap-2 md:px-3 py-2 max-w-full lg:max-[85%]'>
                                                            <div className='flex justify-start items-center gap-3'>
                                                                <div className='flex justify-center items-start flex-col 
                                                                w-full bg-blue-500/50 text-white py-1 px-2 rounded-md'>
                                                                    <span>{message.text}</span>
                                                                    </div>
                                                                <img className='w-[28px] h-[28px] rounded-full bg-white' 
                                                                src='https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/duck128.jpg?alt=media&token=549d29cd-0565-4fa4-a682-3e0816cd2fdb' alt="profile" />
                                                                
                                                            </div>
                                                        </div>
                                                    </div>
                                                    }
                                                    {
                                                    (uid!=message.senderId)&& 
                                                    <div className='w-full flex justify-start items-center'>
                                                        <div className='flex justify-start items-start gap-2 md:px-3 py-2 max-w-full lg:max-[85%]'>
                                                            <div className='flex justify-start items-center gap-3'>

                                                                <img className='w-[28px] h-[28px] rounded-full bg-white' 
                                                                src='https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/duck128.jpg?alt=media&token=549d29cd-0565-4fa4-a682-3e0816cd2fdb' alt="profile" />
                                                                <div className='flex justify-center items-end flex-col 
                                                                w-full bg-gray-500/50 text-white py-1 px-2 rounded-md'>
                                                                    <span>{message.text}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    }
                                                </div>
                                            ))
                                        }
                                        {chatId&&<button>Get More Messages</button>}

                                    </div > 
                                    {/* Send New Message */}
                                    <form>
                                        <div className='items-end'>
                                            <div className='flex items-center justify-between gap-2'>
                                                <div className='w-full py-2'>
                                                    <input 
                                                    onChange={(e) => {setNewMessage(e.target.value)}}
                                                    value={newMessage}
                                                    className='w-full bg-[#ededed] rounded-md text-[#030811] px-2 py-1'
                                                    placeholder='Message'
                                                    />
                                                </div>
                                                <button 
                                                onClick={(e)=>{sendNewMessage(e)}}
                                                className='shadow-lg-[#000000] bg-[#3a48bd] hover:shadow-cyan-500/50 rounded-md py-1 px-2'>Send</button>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Chat;
