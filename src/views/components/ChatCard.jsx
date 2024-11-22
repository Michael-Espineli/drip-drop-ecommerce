import React, {useState, useEffect, useContext, lazy} from 'react';
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { db } from "../../utils/config";

const ChatCard = (props) => {
    const [participantList, setParticipantList] = useState([]);
    const currentUserId = props.userId
    const participants = props.participants

    useEffect(() => {
        (async () => {
            setParticipantList([])
            for (let i = 0; i < participants.length; i++) {
                if (participants[i].userId === currentUserId) {
                } else {
                    setParticipantList(participantList => [...participantList, participants[i].userName]); 
                }
            }
        })();
    },[])
    return (
        <div className='w-full bg-[#ededed] px-2 py-1 rounded-md text-[#030811]'>
            <div className='flex justify-start items-center'>
                <img className='w-[28px] h-[28px] rounded-full bg-white' src='https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/duck128.jpg?alt=media&token=549d29cd-0565-4fa4-a682-3e0816cd2fdb' alt="profile" />
                <div>
                    {
                        participantList.map( people => (
                            <h1 className='text-[#030811]'>{people}</h1>
                        ))
                    }
                </div>
            </div>
        </div>
    );
};

export default ChatCard;