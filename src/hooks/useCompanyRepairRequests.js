import { useCallback, useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../utils/config';
import { compareRepairRequestsByDate, RepairRequest } from '../utils/models/RepairRequest';

// Both sources use the same live records for previews and the filterable list.
export default function useCompanyRepairRequests(companyId) {
  const [state, setState] = useState({ companyId: null, requests: [], loading: true });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const sources = { company: [], homeowner: [] };
    const loaded = new Set();
    setState({ companyId, requests: [], loading: !!companyId });
    if (!companyId) return undefined;

    const queries = {
      company: collection(db, 'companies', companyId, 'repairRequests'),
      homeowner: query(collection(db, 'homeownerRepairRequests'), where('companyId', '==', companyId)),
    };
    const publish = () => {
      if (!cancelled) setState({ companyId, requests: [...sources.company, ...sources.homeowner].sort(compareRepairRequestsByDate), loading: loaded.size < 2 });
    };
    const unsubscribers = Object.entries(queries).map(([sourcePath, requestQuery]) => onSnapshot(requestQuery, (snapshot) => {
      if (cancelled) return;
      sources[sourcePath] = snapshot.docs.map((document) => {
        const data = document.data();
        return {
          ...data,
          ...RepairRequest.fromFirestore(document),
          sourcePath,
          source: sourcePath === 'homeowner' || data.source === 'publicTechnician' ? 'external' : 'internal',
        };
      });
      loaded.add(sourcePath);
      publish();
    }, (error) => {
      if (cancelled) return;
      console.error('Error loading repair requests:', error);
      sources[sourcePath] = [];
      loaded.add(sourcePath);
      publish();
    }));
    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [companyId, revision]);

  return { ...(state.companyId === companyId ? state : { requests: [], loading: !!companyId }), refresh };
}
