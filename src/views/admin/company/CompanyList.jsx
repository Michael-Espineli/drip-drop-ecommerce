import React, { useState, useContext, useEffect } from 'react';
import { getFunctions } from 'firebase/functions';
import { query, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Link } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';

const functions = getFunctions();

function CompanyList() {
  const ADMIN_YELLOW = '#debf44';

  const { stripeConnectedAccountId, user } = useContext(Context);
  const [companyList, setCompanyList] = useState([]);

  useEffect(() => {
    (async () => {
      console.log('On Load');
      try {
        const q = query(collection(db, 'companies'));
        const querySnapshot = await getDocs(q);

        const companies = [];
        querySnapshot.forEach((docSnap) => {
          const companyData = docSnap.data();
          companies.push({
            id: companyData.id,
            ownerId: companyData.ownerId,
            ownerName: companyData.ownerName,
            name: companyData.name,
            photoUrl: companyData.photoUrl,
            dateCreated: companyData.dateCreated,
            email: companyData.email,
            phoneNumber: companyData.phoneNumber,
            verified: companyData.verified,
            serviceZipCodes: companyData.serviceZipCodes,
            services: companyData.services,
            accountType: companyData.accountType,
            paidUntil: companyData.paidUntil,
            status: companyData.status,
            stripeConnectAccountId: companyData.stripeConnectAccountId,
            stripeConnectAccountStatus: companyData.stripeConnectAccountStatus,
            yelpURL: companyData.yelpURL,
            websiteURL: companyData.websiteURL,
          });
        });

        setCompanyList(companies);
      } catch (error) {
        console.log(error);
      }
    })();
  }, []);

  return (
    <div className="px-2 md:px-7 py-5 bg-slate-900 min-h-screen">
      <div className="w-full bg-slate-950 p-4 rounded-xl text-slate-100 border border-slate-800/60 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="font-extrabold text-xl tracking-tight" style={{ color: ADMIN_YELLOW }}>
              Company List
            </h1>
            <p className="text-sm text-slate-400">Browse and manage registered companies</p>
          </div>
        </div>

        <div className="relative overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr className="text-slate-200">
                <th className="py-3 px-4 text-left font-bold">Name</th>
                <th className="py-3 px-4 text-left font-bold">Owner</th>
                <th className="py-3 px-4 text-left font-bold">Verified</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {companyList?.map((company) => (
                <tr key={company.id} className="hover:bg-slate-900/60 transition">
                  <td className="px-4 py-3">
                    <Link
                      className="block w-full h-full text-slate-100 hover:opacity-90"
                      style={{ color: ADMIN_YELLOW }}
                      to={`/admin/company/detail/${company.id}`}
                    >
                      {company.name}
                    </Link>
                  </td>

                  <td className="px-4 py-3">
                    <Link
                      className="block w-full h-full text-slate-200 hover:text-slate-100"
                      to={`/admin/company/detail/${company.id}`}
                    >
                      {company.ownerName}
                    </Link>
                  </td>

                  <td className="px-4 py-3">
                    <Link
                      className="block w-full h-full"
                      to={`/admin/company/detail/${company.id}`}
                    >
                      {company.verified ? (
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
                            bg-[var(--admin-yellow)]/15 ring-1 ring-[var(--admin-yellow)]/30"
                          style={{
                            // inline fallback if CSS var isn't set anywhere else
                            color: ADMIN_YELLOW,
                            borderColor: 'rgba(222,191,68,0.3)',
                          }}
                        >
                          Verified
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
                            bg-red-500/15 text-red-200 ring-1 ring-red-500/30"
                        >
                          Not Verified
                        </span>
                      )}
                    </Link>
                  </td>
                </tr>
              ))}

              {companyList?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={3}>
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Optional: set a CSS var once on the page if you want to use it elsewhere */}
      <style>{`:root { --admin-yellow: ${ADMIN_YELLOW}; }`}</style>
    </div>
  );
}

export default CompanyList;
