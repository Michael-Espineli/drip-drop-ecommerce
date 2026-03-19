
import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from 'react-router-dom';
import { query, collection, getDocs, where, setDoc, doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from 'uuid';
import Select from 'react-select';
import toast from 'react-hot-toast';

const Input = (props) => <input {...props} className={`bg-gray-50 border-2 border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 ${props.className}`} />;
const SelectInput = (props) => <Select {...props} styles={{ control: (base) => ({ ...base, background: '#F9FAFB', border: '2px solid #E5E7EB', borderRadius: '0.5rem', padding: '0.25rem' }) }} />;

const TabButton = ({ active, onClick, children }) => (
    <button 
        type="button"
        onClick={onClick}
        className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors border-b-2 
            ${active 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`
        }
    >
        {children}
    </button>
);

const CreateNewCompanyUser = () => {
    const { name: companyName, recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState('new'); // 'new' or 'existing'

    // Form state
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState(null);
    
    const [roleList, setRoleList] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [areRolesLoading, setAreRolesLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) return;
        const fetchRoles = async () => {
            setAreRolesLoading(true);
            try {
                const rolesQuery = query(collection(db, 'companies', recentlySelectedCompany, 'roles'));
                const querySnapshot = await getDocs(rolesQuery);
                const roles = querySnapshot.docs.map(doc => ({ ...doc.data(), value: doc.id, label: doc.data().name }));
                setRoleList(roles);
            } catch (error) {
                console.error("Error fetching roles: ", error);
                toast.error("Could not load company roles.");
            } finally {
                setAreRolesLoading(false);
            }
        };
        fetchRoles();
    }, [recentlySelectedCompany]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (activeTab === 'new') {
            handleInviteNewUser();
        } else {
            handleAddExistingUser();
        }
    };

    const handleInviteNewUser = async () => {
        if (!firstName || !lastName || !email || !role) {
            toast.error("Please fill out all fields to invite a new user.");
            return;
        }

        setIsLoading(true);
        const toastId = toast.loading('Sending invite...');

        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("email", "==", email));
            const userQuerySnapshot = await getDocs(q);
            
            if (!userQuerySnapshot.empty) {
                toast.error('A user with this email already exists. Please use the "Add Existing User" tab.', { id: toastId });
                return;
            }

            const inviteId = 'invi_' + uuidv4();
            const inviteData = {
                id: inviteId, userId: null, firstName, lastName, email, companyName, 
                companyId: recentlySelectedCompany, roleId: role.id, roleName: role.label, 
                status: 'pending', workerType: 'Employee', currentUser: false, dateCreated: new Date(),
            };

            await setDoc(doc(db, "invites", inviteId), inviteData);
            
            toast.success('Invite sent successfully! The user needs to accept it.', { id: toastId });
            navigate('/company/companyUsers');

        } catch (error) {
            console.error("Error sending invite: ", error);
            toast.error(`Error: ${error.message}`, { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddExistingUser = async () => {
        if (!email || !role) {
            toast.error("Please provide an email and select a role.");
            return;
        }
        
        setIsLoading(true);
        const toastId = toast.loading('Adding user to company...');

        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("email", "==", email));
            const userQuerySnapshot = await getDocs(q);

            if (userQuerySnapshot.empty) {
                toast.error('No user found with this email. Please invite them as a new user.', { id: toastId });
                return;
            }

            const userDoc = userQuerySnapshot.docs[0];
            const userData = userDoc.data();
            const companyUserRef = doc(db, 'companies', recentlySelectedCompany, 'companyUsers', userDoc.id);
            
            const userName = (userData.firstName && userData.lastName) 
                ? `${userData.firstName} ${userData.lastName}` 
                : userData.email;

            await setDoc(companyUserRef, {
                userId: userDoc.id,
                userName: userName,
                email: userData.email,
                roleId: role.id,
                roleName: role.label,
                status: 'Active',
                workerType: 'Employee',
            }, { merge: true });

            await updateDoc(userDoc.ref, {
                companies: arrayUnion(recentlySelectedCompany)
            });

            toast.success('User successfully added to your company!', { id: toastId });
            navigate('/company/companyUsers');

        } catch(error) {
            console.error("Error adding existing user: ", error);
            toast.error(`Error: ${error.message}`, { id: toastId });
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-4xl mx-auto">
                <header className="mb-6">
                     <h1 className="text-3xl font-bold text-gray-800">Manage User Access</h1>
                    <p className="text-gray-600 mt-1">Add a new or existing user to your company.</p>
                </header>

                <div className="border-b border-gray-200 mb-6">
                    <div className="flex -mb-px">
                        <TabButton active={activeTab === 'new'} onClick={() => setActiveTab('new')}>Invite New User</TabButton>
                        <TabButton active={activeTab === 'existing'} onClick={() => setActiveTab('existing')}>Add Existing User</TabButton>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-lg border border-gray-200 space-y-6">
                    {activeTab === 'new' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                             <div className="md:col-span-2">
                                <p className="text-sm text-gray-600">An invitation will be sent to the user to create an account and join your company.</p>
                            </div>
                            <div>
                                <label className="block mb-2 text-sm font-medium text-gray-700">First Name</label>
                                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" required />
                            </div>
                            <div>
                                <label className="block mb-2 text-sm font-medium text-gray-700">Last Name</label>
                                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" required />
                            </div>
                        </div>
                    )}
                    
                    {activeTab === 'existing' && (
                         <div className="md:col-span-2">
                            <p className="text-sm text-gray-600">If the user already has an account, add them directly to your company here.</p>
                        </div>
                    )}
                    
                    <div className="space-y-6">
                        <div className="md:col-span-2">
                            <label className="block mb-2 text-sm font-medium text-gray-700">Email Address</label>
                            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john.doe@example.com" required />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block mb-2 text-sm font-medium text-gray-700">Assign Role</label>
                            <SelectInput value={role} options={roleList} onChange={setRole} placeholder="Select a role..." isLoading={areRolesLoading} required />
                        </div>
                    </div>

                    <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200 mt-6">
                        <button type="button" onClick={() => navigate('/company/companyUsers')} className='py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>
                            Cancel
                        </button>
                        <button type="submit" disabled={isLoading || areRolesLoading} className='py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-blue-300 transition'>
                            {isLoading ? 'Processing...' : (activeTab === 'new' ? 'Send Invite' : 'Add User')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CreateNewCompanyUser;
