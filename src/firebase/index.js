
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage } from "firebase/storage";

import prodConfig from './firebase.prod';
import devConfig from './firebase.dev';

const defaultFirebaseEnv = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const requestedFirebaseEnv = (process.env.REACT_APP_FIREBASE_ENV || defaultFirebaseEnv).toLowerCase();
const useProductionFirebase = ['production', 'prod'].includes(requestedFirebaseEnv);
const firebaseEnvironment = useProductionFirebase ? 'production' : 'development';
const firebaseConfig = useProductionFirebase ? prodConfig : devConfig;
const useFirebaseEmulators = process.env.REACT_APP_USE_FIREBASE_EMULATORS === 'true';
const usePersistentFirestoreCache = process.env.REACT_APP_FIRESTORE_PERSISTENT_CACHE === 'true';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = process.env.NODE_ENV === 'test' ? null : getAnalytics(app);
const auth = initializeAuth(app, {
  persistence: [
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
  ],
});
const firestoreSettings = process.env.NODE_ENV === 'test'
  ? {}
  : {
      localCache: usePersistentFirestoreCache
        ? persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          })
        : memoryLocalCache(),
    };
const db = initializeFirestore(app, firestoreSettings);
const functions = getFunctions(app);
const storage = getStorage(app);

if (useFirebaseEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export { app, analytics, auth, db, functions, storage, firebaseEnvironment, useFirebaseEmulators };
