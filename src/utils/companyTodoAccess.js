import { collection, onSnapshot, query, where } from 'firebase/firestore';

// Restricted roles query only authorized records. Firestore rules are not filters.
export function listenCompanyTodos({ db, companyId, userId, companyUserId, includeAll = false, onTodos, onBoards = () => {}, onError = () => {} }) {
  if (!companyId || !userId) { onTodos([]); onBoards([]); return () => {}; }
  const ids = [...new Set([userId, companyUserId].filter(Boolean))];
  const todos = collection(db, 'companies', companyId, 'todoItems');
  const boards = collection(db, 'companies', companyId, 'todoBoards');
  const stops = [], boardStops = new Map(), buckets = new Map(), boardBuckets = new Map();
  let active = true;
  const merge = source => [...new Map([...source.values()].flat().map(doc => [doc.id, doc])).values()];
  const emit = () => { if (active) onTodos(merge(buckets)); };
  const listenTodos = (key, source) => onSnapshot(source, snapshot => {
    if (!active) return; buckets.set(key, snapshot.docs); emit();
  }, error => { if (!active) return; buckets.delete(key); emit(); onError(error); });
  const listenBoards = (key, source) => onSnapshot(source, snapshot => {
    if (!active) return;
    boardBuckets.set(key, snapshot.docs);
    const visible = merge(boardBuckets), visibleIds = new Set(visible.map(doc => doc.id));
    for (const [id, stop] of boardStops) if (!visibleIds.has(id)) { stop(); boardStops.delete(id); buckets.delete(`board:${id}`); }
    for (const board of visible) if (!boardStops.has(board.id)) boardStops.set(board.id, listenTodos(`board:${board.id}`, query(todos, where('boardId', '==', board.id))));
    onBoards(visible); emit();
  }, error => { if (active) { boardBuckets.delete(key); onError(error); } });
  if (includeAll) {
    stops.push(listenTodos('all', todos), onSnapshot(boards, snapshot => { if (active) onBoards(snapshot.docs); }, onError));
  } else {
    for (const field of ['assignedToUserId','assignedToCompanyUserDocId','assignedTechId','techId']) {
      stops.push(listenTodos(field, query(todos, where(field, 'in', ids))));
    }
    stops.push(listenTodos('personal', query(todos, where('scope', '==', 'me'), where('createdByUserId', '==', userId))));
    for (const field of ['memberUserIds','memberCompanyUserDocIds','boardMemberUserIds','boardMemberCompanyUserDocIds','boardMemberCompanyUserIds']) {
      stops.push(listenTodos(field, query(todos, where(field, 'array-contains-any', ids))));
      stops.push(listenBoards(field, query(boards, where(field, 'array-contains-any', ids))));
    }
  }
  return () => { active = false; stops.forEach(stop => stop()); boardStops.forEach(stop => stop()); buckets.clear(); boardBuckets.clear(); };
}
