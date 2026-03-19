import React, { useEffect, useState, useContext } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc, getDoc, getDocs, collection, query, where, limit, orderBy  } from 'firebase/firestore';
import { db } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

// how to receive /client/connect-to-company?companyId=YOUR_COMPANY_ID&customerId=YOUR_CUSTOMER_ID
// how to receive /client/connect-to-company?companyId=com_7d90268d-b1bd-4cba-9b18-39edceeec046&customerId=com_cus_2f36a059-09f1-471b-a1ed-0d97c1ab18e8


const ConnectToCompany = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useContext(Context);
    const [company, setCompany] = useState({})
    const [customer, setCustomer] = useState({})
    const [companyId, setCompanyId] = useState()
    const [customerId, setCustomerId] = useState()
    const [serviceLocations, setServiceLocations] = useState([])
    const [bodiesOfWater, setBodiesOfWater] = useState([])
    const [equipmentList, setEquipment] = useState([])

    const [status, setStatus] = useState('Connecting your account...');
    const [loading, setLoading] = useState(true);
    const [hasAccount, setHasAccount] = useState(true);

    useEffect(() => {
        const companyId = searchParams.get('companyId');
        setCompanyId(companyId)

        const customerId = searchParams.get('customerId');
        setCustomerId(customerId)
        // Immediately remove the parameters from the URL for a cleaner user experience
        // navigate('.', { replace: true });

        if (!user) {
            toast.error('You must be logged in to connect an account.');
            setStatus('Error: You must be logged in.');
            return;
        }

        if (!companyId || !customerId) {
            toast.error('Invalid or incomplete connection link.');
            setStatus('Error: Missing company or customer information in the link.');
            return;
        }
        const fetchCustomer = async () => {

            try {
                const customerRef = doc(db, 'companies', companyId, 'customers', customerId);
                const docSnap = await getDoc(customerRef);
                if (docSnap.exists()) {
                    const customerData = docSnap.data();
                    setCustomer({ id: docSnap.id, ...customerData });
                    if (customerData.linkedCustomerIds.count == 0) {
                        setHasAccount(true)
                    } else {
                        setHasAccount(false)
                    }
                } else {
                        toast.error('Customer not found.');
                }
            } catch (error) {
                toast.error("Failed to fetch customer data.");
            } finally {
                setLoading(false);
            }
        };
        const fetchCompany = async () => {

            try {
                const companyRef = doc(db, 'companies', companyId,);
                const docSnap = await getDoc(companyRef);
                if (docSnap.exists()) {
                    const companyData = docSnap.data();
                    setCompany({ id: docSnap.id, ...companyData });
                    
                } else {
                    toast.error('Customer not found.');
                }
            } catch (error) {
                toast.error("Failed to fetch customer data.");
            } finally {
                setLoading(false);
            }
        };
        const fetchLocations = async () => {
            try {
                let q = query(collection(db, 'companies',companyId,'serviceLocations'),where("customerId","==",customerId));
                    const querySnapshot = await getDocs(q);       
                    setServiceLocations([])      
                    querySnapshot.forEach((doc) => {
                        const locationData = doc.data();
                        setServiceLocations(location => [...location, locationData]); 
                    });
            } catch (error) {
                toast.error("Failed to fetch customer data.");
            } finally {
                setLoading(false);
            }
        };

        const fetchBodiesOfWater = async () => {

            try {
                let q = query(collection(db, 'companies',companyId,'bodiesOfWater'),where("customerId","==",customerId));
                    const querySnapshot = await getDocs(q);       
                    setBodiesOfWater([])      
                    querySnapshot.forEach((doc) => {
                        const locationData = doc.data();
                        setBodiesOfWater(location => [...location, locationData]); 
                    });
            } catch (error) {
                toast.error("Failed to fetch customer data.");
            } finally {
                setLoading(false);
            }
        };
        const fetchEquipment = async () => {

            try {
                let q = query(collection(db, 'companies',companyId,'equipment'),where("customerId","==",customerId));
                    const querySnapshot = await getDocs(q);       
                    setEquipment([])      
                    querySnapshot.forEach((doc) => {
                        const locationData = doc.data();
                        setEquipment(location => [...location, locationData]); 
                    });
            } catch (error) {
                toast.error("Failed to fetch customer data.");
            } finally {
                setLoading(false);
            }
        };

        fetchCompany();
        fetchCustomer();
        fetchLocations();
        fetchBodiesOfWater();
        fetchEquipment();

    }, [user, searchParams, navigate]);

    async function linkAccount(e) {
        e.preventDefault()
        try {
            const functionName = httpsCallable(functions, 'createHomeOwnerCustomerBasedOnCompany');
            functionName({ 
                companyId: companyId,
                companyName: company.name,
                customerId: customerId,
                homeOwnerId: user.uid
            })
            .then((result) => {
                console.log(result)
                // Handle the result from the function
            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
            toast.success('Successfully connected your account!');
            setStatus('Success! Your account has been linked.');

            // Redirect to the client dashboard after a brief delay
            setTimeout(() => navigate('/client/dashboard'), 2000);

        } catch (error) {
            console.error("Failed to connect account:", error);
            toast.error('An error occurred while linking your account.');
            setStatus(`Error: Could not link your account. Please contact support if the problem persists.`);
        }
    };
    
    if (loading){
        return <div className="flex justify-center items-center h-screen">Loading ...</div>;
    } else if (hasAccount){
        return <div className="flex justify-center items-center h-screen">Account already linked</div>;
    } else {return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg overflow-hidden">
      
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-200">
            <h1 className="text-xl font-semibold text-gray-900">
              Connect Your Account
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Review your information before continuing
            </p>
          </div>
      
          {/* Content */}
          <div className="px-6 py-5 space-y-6">
      
            {/* Company */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Company
              </h2>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-900">
                {company.name}
              </div>
            </section>
      
            {/* Customer */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Customer
              </h2>
      
              <div className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm">
                <span className="text-gray-500">Name</span>
                <span className="text-gray-900 text-right">
                  {customer.firstName} {customer.lastName}
                </span>
              </div>
      
              <div className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm">
                <span className="text-gray-500">Email</span>
                <span className="text-gray-900 text-right">
                  {customer.email}
                </span>
              </div>
      
              <div className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm">
                <span className="text-gray-500">Phone</span>
                <span className="text-gray-900 text-right">
                  {customer.phoneNumber}
                </span>
              </div>
            </section>
      
            {/* Locations */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Service Locations
              </h2>
      
              <div className="space-y-2">
                {serviceLocations?.map(location => (
                  <div
                    key={location.id}
                    className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-900"
                  >
                    {location.address.streetAddress}
                  </div>
                ))}
              </div>
            </section>
      
            {/* Bodies of Water */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Bodies of Water
              </h2>
      
              <div className="flex flex-wrap gap-2">
                {bodiesOfWater?.map(bow => (
                  <span
                    key={bow.id}
                    className="px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-sm text-gray-800"
                  >
                    {bow.name}
                  </span>
                ))}
              </div>
            </section>
      
            {/* Equipment */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Equipment
              </h2>
      
              <div className="flex flex-wrap gap-2">
                {equipmentList?.map(eq => (
                  <span
                    key={eq.id}
                    className="px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-sm text-gray-800"
                  >
                    {eq.type}
                  </span>
                ))}
              </div>
            </section>
          </div>
      
          {/* Actions */}
          <div className="px-6 py-5 border-t border-gray-200 space-y-3">
      
            <button
                onClick={linkAccount}
                className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
            >
                Connect Account & Create New Location
            </button>
            {/* do in later update */}
            {/* <button
              onClick={linkAccount}
              className="w-full py-3 rounded-xl bg-gray-100 text-gray-900 font-medium hover:bg-gray-200 transition"
            >
              Connect Account & Update Location
            </button> */}
          </div>
        </div>
      </div>
      
      );
      
    }
};

export default ConnectToCompany;
