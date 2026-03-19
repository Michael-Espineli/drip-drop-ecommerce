import React, { useState, useContext, useEffect } from 'react';
import { getFunctions } from 'firebase/functions';
import { query, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Link } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';

const functions = getFunctions();

function SubscriptionList() {
  const ADMIN_YELLOW = '#debf44';

  const { stripeConnectedAccountId, user } = useContext(Context);
  const [subscriptionList, setSubscriptionList] = useState([]);

  const [firstDoc, setFirstDoc] = useState();
  const [lastDoc, setLastDoc] = useState();

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'subscriptions'));
        const querySnapshot = await getDocs(q);

        let count = 1;
        const subs = [];
        let first = undefined;
        let last = undefined;

        querySnapshot.forEach((docSnap) => {
          if (count === 1) first = docSnap;
          last = docSnap;

          const contractData = docSnap.data();
          const contract = {
            id: contractData.id,
            stripeProductId: contractData.stripeProductId,
            stripePriceId: contractData.stripePriceId,
            cost: contractData.cost,
            name: contractData.name,
            description: contractData.description,
            status: contractData.status,
            // keep original fields, but also support your current UI using "rate"
            rate: contractData.rate ?? contractData.cost ?? 0,
          };

          count += 1;
          subs.push(contract);
        });

        setFirstDoc(first);
        setLastDoc(last);
        setSubscriptionList(subs);
      } catch (error) {
        console.log(error);
      }
    })();
  }, []);

  const pageWrap = 'px-2 md:px-7 py-5 bg-slate-900 min-h-screen';
  const card =
    'w-full bg-slate-950 p-4 rounded-xl text-slate-100 border border-slate-800/60 shadow-2xl';
  const btnPrimary =
    `inline-flex items-center px-4 py-2 rounded-md font-semibold bg-[${ADMIN_YELLOW}] text-slate-950 hover:bg-[${ADMIN_YELLOW}]/90 transition`;
  const btnOutline =
    `inline-flex items-center px-3 py-1.5 rounded-md font-semibold bg-[${ADMIN_YELLOW}]/10 text-[${ADMIN_YELLOW}] ring-1 ring-[${ADMIN_YELLOW}]/30 hover:bg-[${ADMIN_YELLOW}]/15 transition`;

  return (
    <div className={pageWrap}>
      <div className="py-2">
        <div className="flex justify-end items-center">
          <Link to="/admin/subscriptions/addNew" className={btnPrimary}>
            Create New Subscription
          </Link>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="font-extrabold text-xl tracking-tight" style={{ color: ADMIN_YELLOW }}>
              Subscriptions
            </h1>
            <p className="text-sm text-slate-400">Manage your billing plans</p>
          </div>
        </div>

        <div className="relative overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr className="text-slate-200">
                <th className="py-3 px-4 text-left font-bold">Name</th>
                <th className="py-3 px-4 text-left font-bold">Rate</th>
                <th className="py-3 px-4 text-left font-bold">Description</th>
                <th className="py-3 px-4 text-left font-bold">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {subscriptionList?.map((subscription) => (
                <tr key={subscription.id} className="hover:bg-slate-900/60 transition">
                  <td className="py-3 px-4 font-medium text-slate-100 whitespace-nowrap">
                    {subscription.name}
                  </td>

                  <td className="py-3 px-4 font-medium text-slate-200 whitespace-nowrap">
                    {(subscription.rate ?? 0) / 100}
                  </td>

                  <td className="py-3 px-4 font-medium text-slate-300">
                    {subscription.description}
                  </td>

                  <td className="py-3 px-4">
                    <Link className={btnOutline} to={`/admin/subscriptions/detail/${subscription.id}`}>
                      Detail
                    </Link>
                  </td>
                </tr>
              ))}

              {subscriptionList?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={4}>
                    No subscriptions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default SubscriptionList;
