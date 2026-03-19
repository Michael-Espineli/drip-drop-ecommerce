export const timeSince = (date) => {
  // Check if the date object is a valid Firestore Timestamp and has the toDate method
  if (!date || typeof date.toDate !== 'function') {
    // If it's not a valid timestamp (e.g., a pending serverTimestamp), return a default string
    return "a moment ago";
  }

  const seconds = Math.floor((new Date() - date.toDate()) / 1000);

  let interval = seconds / 31536000;
  if (interval > 1) {
    return Math.floor(interval) + " years ago";
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return Math.floor(interval) + " months ago";
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + " days ago";
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + " hours ago";
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + " minutes ago";
  }
  return Math.floor(seconds) + " seconds ago";
};