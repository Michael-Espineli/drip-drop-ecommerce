import React, {useState, useEffect} from 'react';
// import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
// import { db } from "../../utils/config";

const ChatCard = (props) => {
    const [participantList, setParticipantList] = useState([]);
    const currentUserId = props.userId
    const participants = props.participants

    useEffect(() => {
        (async () => {
            setParticipantList([])
            for (let i = 0; i < participants.length; i++) {
                if (participants[i].userId !== currentUserId) {
                    setParticipantList(participantList => [...participantList, participants[i].userName]); 
                }
            }
        })();
    },[])
    return (
        <div className='w-full bg-[#ededed] px-2 py-1 rounded-md text-[#030811]'>
            <div className='flex justify-start items-center'>
                <img className='w-[28px] h-[28px] rounded-full bg-white' src={participantList[0].userImage} alt="profile" />
                <div>
                    {
                        participantList.map( person => (
                            
                            <h1 className='text-[#030811]'>{person}</h1>
                        ))
                    }
                </div>
            </div>
        </div>
    );
};

export default ChatCard;