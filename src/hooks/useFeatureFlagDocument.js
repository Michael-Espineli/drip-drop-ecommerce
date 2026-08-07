import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../utils/config';
import { FIREBASE_NETWORK_FALLBACK_MS, isFirebaseNetworkError } from '../utils/firebaseNetwork';

const getFallbackFeatureFlag = (featureFlagId) => (
  featureFlagId
    ? { id: featureFlagId, key: featureFlagId, enabled: true, offlineFallback: true }
    : null
);

export default function useFeatureFlagDocument(featureFlagId) {
  const [state, setState] = useState({
    flag: null,
    loaded: false,
    error: null,
  });

  useEffect(() => {
    if (!featureFlagId) {
      setState({ flag: null, loaded: true, error: null });
      return undefined;
    }

    setState((current) => ({ ...current, loaded: false, error: null }));
    let resolved = false;
    const fallbackTimer = window.setTimeout(() => {
      if (resolved) return;

      setState({
        flag: getFallbackFeatureFlag(featureFlagId),
        loaded: true,
        error: null,
      });
    }, FIREBASE_NETWORK_FALLBACK_MS);

    const unsubscribe = onSnapshot(
      doc(db, 'featureFlags', featureFlagId),
      (snapshot) => {
        const waitingForServerFlag = snapshot.metadata?.fromCache && !snapshot.exists();

        if (!waitingForServerFlag) {
          resolved = true;
          window.clearTimeout(fallbackTimer);
        }

        setState({
          flag: snapshot.exists()
            ? { id: snapshot.id, ...snapshot.data() }
            : waitingForServerFlag
              ? getFallbackFeatureFlag(featureFlagId)
              : null,
          loaded: true,
          error: null,
        });
      },
      (error) => {
        resolved = true;
        window.clearTimeout(fallbackTimer);

        console.error(`Error loading feature flag ${featureFlagId}:`, error);
        setState({
          flag: isFirebaseNetworkError(error) ? getFallbackFeatureFlag(featureFlagId) : null,
          loaded: true,
          error,
        });
      }
    );

    return () => {
      resolved = true;
      window.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, [featureFlagId]);

  return {
    ...state,
    enabled: Boolean(state.flag?.enabled),
    releaseDate: state.flag?.releaseDate || null,
  };
}
