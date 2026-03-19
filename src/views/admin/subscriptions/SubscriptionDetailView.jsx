import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { availableFeatures } from '../../../utils/features';

const SubscriptionDetailView = () => {
  const ADMIN_YELLOW = '#debf44';

  const { subscriptionId } = useParams();
  const navigate = useNavigate();
  const [subscription, setSubscription] = useState(null);
  const [originalSubscription, setOriginalSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const syncFeatures = (firestoreData) => {
    const firestoreFeatures = firestoreData.features || [];
    const syncedFeatures = availableFeatures.map((appFeature) => {
      const existingFeature = firestoreFeatures.find((f) => f.name === appFeature.name);
      return {
        ...appFeature,
        limit: existingFeature ? existingFeature.limit : 0,
      };
    });
    return syncedFeatures;
  };

  const fetchSubscription = useCallback(async () => {
    setLoading(true);
    try {
      const docRef = doc(db, 'subscriptions', subscriptionId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const syncedFeatures = syncFeatures(data);
        const subData = {
          id: docSnap.id,
          ...data,
          features: syncedFeatures,
          formattedDateCreated: data.dateCreated
            ? format(data.dateCreated.toDate(), 'PPP p')
            : 'N/A',
          formattedLastUpdated: data.lastUpdated
            ? format(data.lastUpdated.toDate(), 'PPP p')
            : 'N/A',
        };
        setSubscription(subData);
        setOriginalSubscription(subData);
      } else {
        setError('No such subscription found!');
        toast.error('Subscription not found.');
      }
    } catch (err) {
      console.error('Error fetching document:', err);
      setError('Failed to fetch subscription data.');
      toast.error('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [subscriptionId]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSubscription((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleFeatureLimitChange = (index, value) => {
    const updatedFeatures = [...subscription.features];
    const limit = parseInt(value, 10);
    updatedFeatures[index].limit = isNaN(limit) ? 0 : limit;
    setSubscription((prev) => ({ ...prev, features: updatedFeatures }));
  };

  const handleNoLimitToggle = (index, isChecked) => {
    const updatedFeatures = [...subscription.features];
    updatedFeatures[index].limit = isChecked ? -1 : 0;
    setSubscription((prev) => ({ ...prev, features: updatedFeatures }));
  };

  const handleUpdateSubscription = async () => {
    const docRef = doc(db, 'subscriptions', subscriptionId);
    const toastId = toast.loading('Updating subscription...');
    try {
      const { id, formattedDateCreated, formattedLastUpdated, ...updatePayload } = subscription;

      updatePayload.features = subscription.features.map(({ name, limit }) => ({ name, limit }));
      updatePayload.lastUpdated = serverTimestamp();

      await updateDoc(docRef, updatePayload);
      toast.success('Subscription updated successfully!', { id: toastId });
      setIsEditing(false);
      fetchSubscription();
    } catch (err) {
      console.error('Error updating subscription:', err);
      toast.error(`Update failed: ${err.message}`, { id: toastId });
    }
  };

  const handleCancelEdit = () => {
    setSubscription(originalSubscription);
    setIsEditing(false);
    toast('Edit canceled');
  };

  if (loading) return <p className="text-center mt-8 text-slate-200">Loading...</p>;
  if (error) return <p className="text-center text-red-400 mt-8">{error}</p>;
  if (!subscription) return null;

  // --- Theme helpers ---
  const page = 'bg-slate-900 min-h-screen';
  const wrap = 'container mx-auto p-8';
  const card =
    'bg-slate-950 text-slate-100 border border-slate-800/60 rounded-xl shadow-2xl';
  const panel =
    'bg-slate-900/40 border border-slate-800/60 rounded-xl';
  const label = 'block text-sm font-semibold text-slate-400';
  const input =
    `w-full bg-slate-900/70 border border-slate-800/60 rounded-md p-2 mt-1 text-slate-100 ` +
    `placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[${ADMIN_YELLOW}]/30`;
  const textarea =
    `w-full bg-slate-900/70 border border-slate-800/60 rounded-md p-2 mt-1 text-slate-100 ` +
    `placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[${ADMIN_YELLOW}]/30`;
  const monoBox =
    'text-base mt-1 p-2 bg-slate-900/70 border border-slate-800/60 rounded-md min-h-[42px] font-mono break-all';
  const readBox =
    'text-base mt-1 p-2 bg-slate-900/50 border border-slate-800/60 rounded-md';
  const btnPrimary =
    `bg-[${ADMIN_YELLOW}] hover:bg-[${ADMIN_YELLOW}]/90 text-slate-950 font-bold py-3 px-6 rounded-lg transition`;
  const btnOutline =
    `bg-[${ADMIN_YELLOW}]/10 hover:bg-[${ADMIN_YELLOW}]/15 text-[${ADMIN_YELLOW}] font-bold py-3 px-6 rounded-lg transition ring-1 ring-[${ADMIN_YELLOW}]/30`;
  const btnSecondary =
    'bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-lg transition';
  const btnCancel =
    'bg-slate-600 hover:bg-slate-500 text-slate-950 font-bold py-3 px-6 rounded-lg transition';
  const btnSave =
    'bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg transition';

  return (
    <div className={page}>
      <div className={wrap}>
        <h1 className="text-4xl font-extrabold mb-8">
          {isEditing ? 'Edit' : 'View'} Subscription:{' '}
          <span style={{ color: ADMIN_YELLOW }}>{subscription.name}</span>
        </h1>

        <div className={`${card} p-8 grid grid-cols-1 md:grid-cols-2 gap-8`}>
          {/* Plan Details */}
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold border-b border-slate-800/60 pb-2">
              Plan Details
            </h2>

            <div>
              <label className={label}>Plan Name</label>
              {isEditing ? (
                <input
                  type="text"
                  name="name"
                  value={subscription.name}
                  onChange={handleInputChange}
                  className={input}
                />
              ) : (
                <p className={`text-lg min-h-[42px] ${readBox}`}>{subscription.name}</p>
              )}
            </div>

            <div>
              <label className={label}>Description</label>
              {isEditing ? (
                <textarea
                  name="description"
                  value={subscription.description}
                  onChange={handleInputChange}
                  className={`${textarea} h-24`}
                />
              ) : (
                <p className={`text-base min-h-[112px] ${readBox}`}>{subscription.description}</p>
              )}
            </div>

            <div>
              <label className={label}>Price (in cents)</label>
              {isEditing ? (
                <input
                  type="number"
                  name="price"
                  value={subscription.price}
                  onChange={handleInputChange}
                  className={input}
                />
              ) : (
                <p className={`text-lg min-h-[42px] ${readBox}`}>{subscription.price}</p>
              )}
            </div>

            <div className="flex items-center pt-2">
              {isEditing ? (
                <>
                  <input
                    type="checkbox"
                    name="active"
                    checked={subscription.active}
                    onChange={handleInputChange}
                    className={`h-4 w-4 rounded border-slate-700 bg-slate-900 text-[${ADMIN_YELLOW}] focus:ring-[${ADMIN_YELLOW}]/30`}
                  />
                  <label className="ml-2 text-sm text-slate-300">Active</label>
                </>
              ) : (
                <p className={`text-lg font-bold ${subscription.active ? 'text-emerald-400' : 'text-red-400'}`}>
                  {subscription.active ? 'Active' : 'Inactive'}
                </p>
              )}
            </div>
          </div>

          {/* Identifiers & Notes */}
          <div className={`space-y-4 ${panel} p-6`}>
            <h2 className="text-2xl font-semibold border-b border-slate-800/60 pb-2">
              Identifiers & Notes
            </h2>

            <div>
              <label className={label}>Stripe Product ID</label>
              {isEditing ? (
                <input
                  type="text"
                  name="stripeProductId"
                  value={subscription.stripeProductId}
                  onChange={handleInputChange}
                  className={input}
                />
              ) : (
                <p className={monoBox}>{subscription.stripeProductId || 'Not set'}</p>
              )}
            </div>

            <div>
              <label className={label}>Stripe Price ID</label>
              {isEditing ? (
                <input
                  type="text"
                  name="stripePriceId"
                  value={subscription.stripePriceId}
                  onChange={handleInputChange}
                  className={input}
                />
              ) : (
                <p className={monoBox}>{subscription.stripePriceId || 'Not set'}</p>
              )}
            </div>

            <div>
              <label className={label}>Internal Notes</label>
              {isEditing ? (
                <textarea
                  name="internalNotes"
                  value={subscription.internalNotes}
                  onChange={handleInputChange}
                  className={`${textarea} h-24`}
                />
              ) : (
                <p className={`text-base min-h-[112px] ${readBox}`}>
                  {subscription.internalNotes || 'No notes'}
                </p>
              )}
            </div>

            <div className="text-sm text-slate-500 pt-4">
              <p>Date Created: {subscription.formattedDateCreated}</p>
              <p>Last Updated: {subscription.formattedLastUpdated}</p>
            </div>
          </div>

          {/* Feature Limits */}
          <div className="md:col-span-2 mt-8 pt-8 border-t border-slate-800/60">
            <h2 className="text-2xl font-semibold mb-4">Feature Limits</h2>

            <div className="space-y-4">
              {subscription.features.map((feature, index) => (
                <div
                  key={feature.name}
                  className={`p-4 rounded-xl border border-slate-800/60 ${
                    isEditing ? 'bg-slate-900/60' : 'bg-slate-900/30'
                  }`}
                >
                  <div className="flex justify-between items-center gap-4">
                    <div>
                      <p className="font-bold text-lg text-slate-100">{feature.displayName}</p>
                      <p className="text-sm text-slate-400">{feature.description}</p>
                    </div>

                    {isEditing ? (
                      <div className="flex items-center space-x-4">
                        <input
                          type="number"
                          value={feature.limit === -1 ? '' : feature.limit}
                          onChange={(e) => handleFeatureLimitChange(index, e.target.value)}
                          disabled={feature.limit === -1}
                          className="w-32 bg-slate-900/70 border border-slate-800/60 rounded-md p-2 font-semibold text-slate-100 disabled:bg-slate-950 disabled:cursor-not-allowed"
                          placeholder="0"
                        />

                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            id={`no-limit-${index}`}
                            checked={feature.limit === -1}
                            onChange={(e) => handleNoLimitToggle(index, e.target.checked)}
                            className={`h-4 w-4 rounded border-slate-700 bg-slate-900 text-[${ADMIN_YELLOW}] focus:ring-[${ADMIN_YELLOW}]/30`}
                          />
                          <label htmlFor={`no-limit-${index}`} className="ml-2 text-sm font-medium text-slate-300">
                            No Limit
                          </label>
                        </div>
                      </div>
                    ) : (
                      <span
                        className={`font-extrabold text-2xl ${
                          feature.limit === -1 ? 'text-emerald-400' : ''
                        }`}
                        style={feature.limit === -1 ? undefined : { color: ADMIN_YELLOW }}
                      >
                        {feature.limit === -1 ? 'Unlimited' : feature.limit}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-end space-x-4">
          <button onClick={() => navigate('/admin/subscriptions')} className={btnSecondary}>
            Back to List
          </button>

          {isEditing ? (
            <>
              <button onClick={handleCancelEdit} className={btnCancel}>
                Cancel
              </button>
              <button onClick={handleUpdateSubscription} className={btnSave}>
                Save Changes
              </button>
            </>
          ) : (
            <button onClick={() => setIsEditing(true)} className={btnOutline}>
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionDetailView;
