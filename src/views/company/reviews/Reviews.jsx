import React, { useContext, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import WorkspaceHeader from '../../../components/workspace/WorkspaceHeader';
import { displayReferenceValue } from '../../../utils/displayReferences';

const reviewDate = (review) => {
  const value = review.createdAt || review.dateCreated;
  if (!value) return '';
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

export default function Reviews() {
  const { companyId: requestedCompanyId, reviewId } = useParams();
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const companyId = recentlySelectedCompany?.id || recentlySelectedCompany || '';
  const allowed = Boolean(companyId && (!requestedCompanyId || requestedCompanyId === companyId));
  const scope = `${companyId}/${requestedCompanyId || ''}/${reviewId || ''}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ scope: '', reviews: [], error: '', loading: true });
  const state = result.scope === scope ? result : { reviews: [], error: '', loading: true };

  useEffect(() => {
    let active = true;
    if (!allowed) return undefined;
    setResult({ scope, reviews: [], error: '', loading: true });
    const load = async () => {
      try {
        const ref = collection(db, 'companies', companyId, 'reviews');
        const snapshot = reviewId ? await getDoc(doc(ref, reviewId)) : await getDocs(ref);
        const docs = reviewId ? (snapshot.exists() ? [snapshot] : []) : snapshot.docs;
        const reviews = docs.map((item) => ({ ...item.data(), id: item.id }));
        if (active) setResult({ scope, reviews, error: '', loading: false });
      } catch (error) {
        console.error('Could not load company reviews', error);
        if (active) setResult({ scope, reviews: [], error: 'Reviews could not be loaded. Please try again.', loading: false });
      }
    };
    load();
    return () => { active = false; };
  }, [allowed, companyId, reviewId, scope, attempt]);

  return (
    <div className="workspace-screen space-y-5 p-4 sm:p-6">
      <WorkspaceHeader title={reviewId ? 'Customer review' : 'Customer reviews'} description={recentlySelectedCompanyName || 'Reviews for your selected company.'} />
      {reviewId && <Link to={`/company/reviews/${encodeURIComponent(companyId)}`} className="app-back-link">Back to reviews</Link>}
      {!allowed ? <p role="alert">Select this company before viewing its reviews.</p>
        : state.loading ? <p role="status">Loading reviews…</p>
          : state.error ? <div role="alert"><p>{state.error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 min-h-[44px] rounded-md border px-4 py-2">Try again</button></div>
            : state.reviews.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-6 text-slate-600">{reviewId ? 'This review is no longer available.' : 'No customer reviews yet.'}</p>
              : <div className="grid gap-4 lg:grid-cols-2">{state.reviews.map((review) => (
                <article key={review.id} className="rounded-lg border border-slate-200 bg-white p-5 text-slate-900">
                  <h2 className="text-lg font-bold">{displayReferenceValue(review.reviewerName || review.reviewer || 'Customer', 'Customer')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{reviewDate(review)}</p>
                  {Number.isFinite(Number(review.rating)) && review.rating !== '' && review.rating != null && <p className="mt-2 font-semibold">{Math.min(5, Math.max(0, Number(review.rating)))} / 5</p>}
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{review.description || review.comment || 'No written review.'}</p>
                  {review.verified === true && <p className="mt-3 text-sm font-semibold text-emerald-700">Verified customer</p>}
                  {!reviewId && <Link to={`/company/reviews/detail/${encodeURIComponent(review.id)}`} className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-blue-700">View review</Link>}
                </article>
              ))}</div>}
    </div>
  );
}
