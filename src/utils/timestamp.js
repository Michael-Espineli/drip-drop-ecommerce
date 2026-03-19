import {
    Timestamp
} from 'firebase/firestore';

/**
 * Converts a Firestore Timestamp to a formatted date-time string.
 * @param {Timestamp} timestamp The Firestore Timestamp to convert.
 * @returns {string} A formatted string representing the date and time.
 */
export const formatTimestamp = (timestamp) => {
    if (!timestamp) {
        return '';
    }

    // Convert Firestore Timestamp to JavaScript Date object
    const date = timestamp.toDate();

    // Format the date and time
    const formattedDate = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    const formattedTime = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return `${formattedDate} at ${formattedTime}`;
};