import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../utils/config';

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

    const unsubscribe = onSnapshot(
      doc(db, 'featureFlags', featureFlagId),
      (snapshot) => {
        setState({
          flag: snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null,
          loaded: true,
          error: null,
        });
      },
      (error) => {
        console.error(`Error loading feature flag ${featureFlagId}:`, error);
        setState({
          flag: null,
          loaded: true,
          error,
        });
      }
    );

    return unsubscribe;
  }, [featureFlagId]);

  return {
    ...state,
    enabled: Boolean(state.flag?.enabled),
    releaseDate: state.flag?.releaseDate || null,
  };
}
