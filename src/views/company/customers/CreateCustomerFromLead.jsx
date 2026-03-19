import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';
import { v4 as uuidv4 } from 'uuid';

const CreateCustomerFromLead = () => {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form states from CreateNewCustomer
    const [displayAsCompany, setDisplayAsCompany] = useState(false);
    const [useDifferentBillingAddress, setUseDifferentBillingAddress] = useState(false);
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        companyName: '',
        email: '',
        phone: '',
        billingNotes: '',
    });
    const [billingAddress, setBillingAddress] = useState({ streetAddress: '', city: '', state: '', zip: '' });

    // Service Location, BOW, Equipment states
    const [addServiceLocation, setAddServiceLocation] = useState(true);
    const [addBodyOfWater, setAddBodyOfWater] = useState(false);
    const [addEquipment, setAddEquipment] = useState(false);

    const [serviceLocationData, setServiceLocationData] = useState({ nickName: 'Main', gateCode: '', dogName: '', notes: '', preText: false });
    const [bodyOfWaterData, setBodyOfWaterData] = useState({ name: 'Main Pool', gallons: '15000', material: 'Plaster', notes: '' });
    const [equipmentData, setEquipmentData] = useState([{ name: 'Pump', make: '', model: '' }, { name: 'Filter', make: '', model: '' }]);

    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) return;
        const fetchLead = async () => {
            setLoading(true);
            const leadRef = doc(db, 'homeOwnerServiceRequests', leadId);
            try {
                const docSnap = await getDoc(leadRef);
                if (docSnap.exists()) {
                    const leadData = { id: docSnap.id, ...docSnap.data() };
                    setLead(leadData);
                    // Pre-fill form
                    const nameParts = (leadData.homeownerName || '').split(' ');
                    setFormData({
                        firstName: nameParts[0] || '',
                        lastName: nameParts.slice(1).join(' ') || '',
                        email: leadData.homeownerEmail || '',
                        phone: leadData.homeownerPhone || '',
                        companyName: '', billingNotes: ''
                    });

                } else {
                    toast.error("Lead not found.");
                    navigate('/company/leads');
                }
            } catch (error) {
                toast.error("Failed to fetch lead details.");
            } finally {
                setLoading(false);
            }
        };
        fetchLead();
    }, [leadId, recentlySelectedCompany, db, navigate]);

    const handleInputChange = (e, setter, nestedField) => {
        const { name, value, type, checked } = e.target;
        const val = type === 'checkbox' ? checked : value;
        if (setter) {
            setter(prev => nestedField ? { ...prev, [nestedField]: { ...prev[nestedField], [name]: val } } : { ...prev, [name]: val });
        } else {
            setFormData(prev => ({...prev, [name]: val}));
        }
    };
    
    const handleEquipmentListChange = (index, e) => {
        const { name, value } = e.target;
        const newList = [...equipmentData];
        newList[index] = { ...newList[index], [name]: value };
        setEquipmentData(newList);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || !lead) return;

        setIsSubmitting(true);
        const toastId = toast.loading('Creating customer and assets...');
        
        const customerId = 'com_cus_' + uuidv4();
        const serviceLocationId = 'com_sl_' + uuidv4();
        const bodyOfWaterId = 'com_bow_' + uuidv4();
        
        const finalBillingAddress = useDifferentBillingAddress ? billingAddress : lead.serviceLocationAddress;

        try {
            // 1. Create Customer
            const customerData = {
                id: customerId, 
                companyId: recentlySelectedCompany, 
                createdAt: new Date(),
                firstName: formData.firstName, 
                lastName: formData.lastName,
                companyName: displayAsCompany ? formData.companyName : '', 
                displayAsCompany, active: true,
                email: formData.email, 
                phoneNumber: formData.phone,
                billingAddress: finalBillingAddress, 
                billingNotes: formData.billingNotes,
                hireDate: new Date(),
                linkedInviteId: ""

            };
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', customerId), customerData);

            // 2. Create Service Location (if checked)
            if (addServiceLocation) {
                await setDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId), {
                    id: serviceLocationId, customerId, companyId: recentlySelectedCompany, ...serviceLocationData,
                    address: lead.serviceLocationAddress, // Use lead's address
                });

                // 3. Create Body of Water (if checked)
                if (addBodyOfWater) {
                    await setDoc(doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bodyOfWaterId), {
                        id: bodyOfWaterId, customerId, serviceLocationId, companyId: recentlySelectedCompany, ...bodyOfWaterData
                    });
                    
                    // 4. Create Equipment (if checked)
                    if (addEquipment) {
                        for (const equip of equipmentData) {
                            if (equip.name) { // Only add if name is present
                                const equipmentId = 'com_equip_' + uuidv4();
                                await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId), {
                                    id: equipmentId, customerId, serviceLocationId, bodyOfWaterId, companyId: recentlySelectedCompany, ...equip
                                });
                            }
                        }
                    }
                }
            }
            
            // 5. Update Lead
            const fullName = formData.firstName + " " + formData.lastName
            await updateDoc(doc(db, 'homeOwnerServiceRequests', leadId), { customerId, customerName:fullName});

            toast.success('Successfully converted lead to customer!', { id: toastId });
            navigate(`/company/customers/details/${customerId}`);

        } catch (error) {
            console.error("Error creating customer from lead:", error);
            toast.error('Conversion failed.', { id: toastId });
            setIsSubmitting(false);
        }
    };
    
    if (loading) return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">Create Customer from Lead</h1>
                <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-lg space-y-8">
                    
                    {/* Customer Details */}
                    <div className="border-b pb-6">
                        <div className="flex justify-between items-center">
                             <h2 className="text-xl font-bold">Customer Details</h2>
                             <label className="flex items-center"><input type="checkbox" checked={displayAsCompany} onChange={e => setDisplayAsCompany(e.target.checked)} className="mr-2"/>Display as Company</label>
                        </div>
                         {displayAsCompany ? (
                            <div><label className="block text-sm font-medium text-gray-700">Company Name</label><input type="text" name="companyName" value={formData.companyName} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" required/></div>
                         ) : (
                             <div className="grid md:grid-cols-2 gap-4 mt-4">
                                <div><label className="block text-sm font-medium">First Name</label><input type="text" name="firstName" value={formData.firstName} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" required/></div>
                                <div><label className="block text-sm font-medium">Last Name</label><input type="text" name="lastName" value={formData.lastName} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" /></div>
                             </div>
                         )}
                         <div className="grid md:grid-cols-2 gap-4 mt-4">
                            <div><label className="block text-sm font-medium">Email</label><input type="email" name="email" value={formData.email} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" required/></div>
                            <div><label className="block text-sm font-medium">Phone</label><input type="tel" name="phone" value={formData.phone} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md"/></div>
                        </div>
                        <div className="mt-4"><label className="block text-sm font-medium">Billing Notes</label><textarea name="billingNotes" value={formData.billingNotes} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md"/></div>
                        <label className="flex items-center mt-4"><input type="checkbox" checked={useDifferentBillingAddress} onChange={e => setUseDifferentBillingAddress(e.target.checked)} className="mr-2"/>Use different billing address</label>
                         {useDifferentBillingAddress && (
                            <div className="mt-2 p-4 border rounded-lg bg-gray-50">
                                <h3 className="font-semibold mb-2">Billing Address</h3>
                                <input type="text" name="streetAddress" placeholder="Street Address" value={billingAddress.streetAddress} onChange={e => handleInputChange(e, setBillingAddress, 'billingAddress')} className="w-full mt-2 p-2 border rounded-md" required/>
                                <div className="grid md:grid-cols-3 gap-4 mt-2">
                                    <input type="text" name="city" placeholder="City" value={billingAddress.city} onChange={e => handleInputChange(e, setBillingAddress, 'billingAddress')} className="w-full p-2 border rounded-md" required/>
                                    <input type="text" name="state" placeholder="State" value={billingAddress.state} onChange={e => handleInputChange(e, setBillingAddress, 'billingAddress')} className="w-full p-2 border rounded-md" required/>
                                    <input type="text" name="zipCode" placeholder="Zip Code" value={billingAddress.zip} onChange={e => handleInputChange(e, setBillingAddress, 'billingAddress')} className="w-full p-2 border rounded-md" required/>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Service Location, BOW, Equipment */}
                    <div className="border-b pb-6">
                        <label className="flex items-center font-bold"><input type="checkbox" checked={addServiceLocation} onChange={e => setAddServiceLocation(e.target.checked)} className="mr-2 h-5 w-5"/>Add Service Location</label>
                        {addServiceLocation && (
                            <div className="pl-6 mt-4 space-y-4">
                                <p className="p-4 bg-blue-50 rounded-lg">Service Address will be pre-filled from the lead: <br/><b>{lead?.serviceLocationAddress?.streetAddress}, {lead?.serviceLocationAddress?.city}</b></p>
                                <div><label className="block text-sm font-medium">Location Nickname</label><input type="text" name="nickName" value={serviceLocationData.nickName} onChange={e => handleInputChange(e, setServiceLocationData)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                
                                <label className="flex items-center font-semibold"><input type="checkbox" checked={addBodyOfWater} onChange={e => setAddBodyOfWater(e.target.checked)} className="mr-2 h-5 w-5"/>Add Body of Water</label>
                                {addBodyOfWater && (
                                    <div className="pl-6 mt-2 space-y-4 p-4 border-l-2">
                                        <div><label className="block text-sm font-medium">Pool Name</label><input type="text" name="name" value={bodyOfWaterData.name} onChange={e => handleInputChange(e, setBodyOfWaterData)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                        <div><label className="block text-sm font-medium">Volume (Gallons)</label><input type="number" name="gallons" value={bodyOfWaterData.gallons} onChange={e => handleInputChange(e, setBodyOfWaterData)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                        
                                        <label className="flex items-center font-semibold"><input type="checkbox" checked={addEquipment} onChange={e => setAddEquipment(e.target.checked)} className="mr-2 h-5 w-5"/>Add Equipment</label>
                                        {addEquipment && (
                                            <div className="pl-6 mt-2 space-y-4 p-4 border-l-2">
                                                {[0, 1].map(index => (
                                                     <div key={index} className="p-2 border rounded-md">
                                                        <h4 className="font-medium mb-1">Equipment #{index + 1}</h4>
                                                        <input placeholder="Name (e.g., Pump)" name="name" value={equipmentData[index].name} onChange={e => handleEquipmentListChange(index, e)} className="w-full mb-2 p-2 border rounded-md" />
                                                        <input placeholder="Make" name="make" value={equipmentData[index].make} onChange={e => handleEquipmentListChange(index, e)} className="w-full mb-2 p-2 border rounded-md" />
                                                        <input placeholder="Model" name="model" value={equipmentData[index].model} onChange={e => handleEquipmentListChange(index, e)} className="w-full p-2 border rounded-md" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end pt-4">
                        <Link to={`/company/leads/${leadId}`} className="px-4 py-2 mr-3 text-sm font-medium text-gray-700 bg-white border rounded-md shadow-sm hover:bg-gray-50">Cancel</Link>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">
                            {isSubmitting ? 'Converting...' : 'Convert Lead to Customer'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateCustomerFromLead;
