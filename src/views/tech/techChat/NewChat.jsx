import React from 'react';
import StartChatModal from '../../components/chat/StartChatModal';

const NewChat = ({ closeModal }) => (
    <StartChatModal mode="company" closeModal={closeModal} />
);

export default NewChat;
