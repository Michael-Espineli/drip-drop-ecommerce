// Import the functions you need from the SDKs you need
import { initializeApp, getApp  } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";

import { getFirestore } from "firebase/firestore";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyDXYk6Hpx_RAXf-21gwKo1gYUD1Xm3MQsc",
  authDomain: "the-pool-app-3e652.firebaseapp.com",
  projectId: "the-pool-app-3e652",
  storageBucket: "the-pool-app-3e652.appspot.com",
  messagingSenderId: "389359518314",
  appId: "1:389359518314:web:ecffb9eb3e0cdf84390013",
  measurementId: "G-WR1V5KG21Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(getApp());

//Disable and enable Live verse tester functions
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
export {app, analytics, auth, db};
