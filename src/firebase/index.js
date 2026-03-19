
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage } from "firebase/storage";

import prodConfig from './firebase.prod';
import devConfig from './firebase.dev';

let firebaseConfig;

if (process.env.NODE_ENV === 'production') {
  firebaseConfig = prodConfig;
} else {
  firebaseConfig = devConfig;
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const storage = getStorage(app);

// Connect to emulators in development
// if (process.env.NODE_ENV !== 'production') {
//   connectAuthEmulator(auth, "http://127.0.0.1:9099");
//   connectFirestoreEmulator(db, "127.0.0.1", 8080);
//   connectFunctionsEmulator(functions, "127.0.0.1", 5001);
// }

export { app, analytics, auth, db, functions,storage };
