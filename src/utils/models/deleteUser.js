
import { getFirestore, doc, deleteDoc } from "firebase/firestore";

export const deleteUserAccount = async (userId) => {
    const db = getFirestore();
    const userDocRef = doc(db, 'users', userId);

    try {
        await deleteDoc(userDocRef);
        console.log("User account deleted successfully.");
    } catch (error) {
        console.error("Error deleting user account:", error);
        throw error;
    }
};
