
import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, query, where, collection, getDocs, limit } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const DetailItem = ({ label, value, children }) => (
    <div className="py-2">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {value ? <p className="font-semibold text-gray-800">{value}</p> : children}
    </div>
);

const DetailCard = ({ title, children }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4 pb-3 border-b border-gray-200">{title}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            {children}
        </div>
    </div>
);

const CompanyUserDetails = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { companyUserId } = useParams(); // This should be the userId
    const navigate = useNavigate();

    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany || !companyUserId) return;

        const fetchUser = async () => {
            setIsLoading(true);
            try {
                // The ID from the URL is the userId, not the document ID in the companyUsers subcollection.
                // We need to query for the document where the `userId` field matches.
                const usersRef = collection(db, "companies", recentlySelectedCompany, 'companyUsers');
                const q = query(usersRef, where("userId", "==", companyUserId), limit(1));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const userDoc = querySnapshot.docs[0];
                    setUser({ id: userDoc.id, ...userDoc.data() });
                } else {
                    toast.error("User not found in this company.");
                    navigate('/company/companyUsers');
                }
            } catch (error) {
                console.error("Error fetching user details: ", error);
                toast.error("Failed to load user details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchUser();
    }, [recentlySelectedCompany, companyUserId, navigate]);

    const getStatusClass = (status) => {
        switch (status) {
            case 'Active': return 'bg-green-100 text-green-800';
            case 'Pending': return 'bg-yellow-100 text-yellow-800';
            case 'Inactive': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (isLoading) {
        return <div className="flex justify-center items-center h-screen"><p className="text-gray-500">Loading user details...</p></div>;
    }

    if (!user) {
        return null; // Or a dedicated "Not Found" component
    }

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">{user.userName}</h1>
                        <p className="text-gray-600 mt-1">Company user profile and details.</p>
                    </div>
                    <div className="flex space-x-3 mt-4 sm:mt-0">
                        <button onClick={() => navigate('/company/companyUsers')} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Back to List</button>
                        {/* <button className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition'>Edit User</button> */}
                    </div>
                </header>

                <div className="space-y-8">
                    <DetailCard title="User Information">
                        <DetailItem label="Full Name" value={user.userName} />
                        <DetailItem label="User ID" value={user.userId} />
                        <DetailItem label="Worker Type" value={user.workerType} />
                        <DetailItem label="Date Created">
                            <p className="font-semibold text-gray-800">
                                {user.dateCreated ? format(user.dateCreated.toDate(), 'PPP') : 'N/A'}
                            </p>
                        </DetailItem>
                    </DetailCard>

                    <DetailCard title="Role & Status">
                        <DetailItem label="Role" value={user.roleName} />
                        <DetailItem label="Role ID" value={user.roleId} />
                        <DetailItem label="Status">
                            <span className={`text-sm font-bold px-3 py-1 rounded-full ${getStatusClass(user.status)}`}>
                                {user.status}
                            </span>
                        </DetailItem>
                    </DetailCard>

                    {user.workerType === 'Sub-Contractor' && (
                        <DetailCard title="Linked Company">
                            <DetailItem label="Company Name" value={user.linkedCompanyName} />
                            <DetailItem label="Company ID" value={user.linkedCompanyId} />
                        </DetailCard>
                    )}
                </div>
            </div>
        </div>
    );
}

export default CompanyUserDetails;
