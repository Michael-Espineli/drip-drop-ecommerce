import React, { useState, useEffect, lazy } from 'react';
import Header from './components/Header';
import { doc, updateDoc, query, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { MultiLocationMap } from '../../components/MultiLocationMap';
import { Link } from 'react-router-dom';

const ReviewCard = lazy(() => import('../../components/ReviewCard'));

const AboutUs = ({ companyData, editMode, handleChange }) => (
    <div className="p-6">
        <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">About Us</h2>
            {editMode ? (
                <textarea name="bio" value={companyData.bio} onChange={handleChange} placeholder='Bio' className='w-full p-2 border border-gray-300 rounded-lg' />
            ) : (
                <p className="text-gray-600">{companyData.bio}</p>
            )}
        </div>
    </div>
);

const Services = ({ companyData, editMode, handleChange }) => (
    <div className="p-6">
        <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Services</h3>
            {editMode ? (
                <textarea name="services" value={companyData.services.join(', ')} onChange={(e) => handleChange({ target: { name: 'services', value: e.target.value.split(', ') } })} placeholder='Services (comma-separated)' className='w-full p-2 border border-gray-300 rounded-lg' />
            ) : (
                companyData.services && companyData.services.length > 0 ? (
                    <ul className="list-disc list-inside text-gray-600">
                        {companyData.services.map((service, index) => (
                            <li key={index}>{service}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-600">No services listed.</p>
                )
            )}
        </div>
    </div>
);

const Reviews = ({ companyData }) => {
    const [reviews, setReviews] = useState([]);

    useEffect(() => {
        const fetchReviews = async () => {
            if (companyData && companyData.id) {
                const q = query(collection(db, 'companies', companyData.id, 'reviews'));
                const querySnapshot = await getDocs(q);
                const reviewsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setReviews(reviewsData);
            }
        };

        fetchReviews();
    }, [companyData]);

    return (
        <div className="p-6">
            <div className="bg-white rounded-lg shadow-md p-6">
                <Link to={`/company/reviews/${companyData.id}`}>  
                    <h2 className="text-2xl font-bold text-gray-800 mb-4">Reviews</h2>
                </Link>
                
                <div className="space-y-4 mt-4">
                    {reviews.length > 0 ? (
                        reviews.map(review => (
                            <ReviewCard
                                key={review.id}
                                rating={review.rating}
                                description={review.description}
                                reviewer={review.reviewerName}
                                verified={review.verified}
                                time={new Date(review.createdAt?.seconds * 1000).toLocaleDateString()}
                            />
                        ))
                    ) : (
                        <p>No reviews yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

const ServiceArea = ({ companyData, editMode, handleChange }) => {
    const [locations, setLocations] = useState([]);
    const [error, setError] = useState('');

    const getGeocode = async (address) => {
        try {
            const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=AIzaSyCeLjQNGFZ6W7pIYIXECBq7N47TBNKhivE`);
            const data = await response.json();
            if (data.status === 'OK') {
                const { lat, lng } = data.results[0].geometry.location;
                return { latitude: lat, longitude: lng };
            } else {
                console.error('Geocoding failed:', data.status);
                return null;
            }
        } catch (error) {
            console.error('Error during geocoding:', error);
            setError('Error during geocoding. Please check your API key and network connection.');
            return null;
        }
    };

    useEffect(() => {
        if (companyData && companyData.serviceZipCodes) {
            const geocodeZipCodes = async () => {
                const geocodedLocations = await Promise.all(
                    companyData.serviceZipCodes.map(zip => getGeocode(zip))
                );
                setLocations(geocodedLocations.filter(location => location !== null));
            };
            geocodeZipCodes();
        }
    }, [companyData]);

    return (
        <div className="p-6">
            <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Service Area</h2>
                {editMode ? (
                    <textarea name="serviceZipCodes" value={companyData.serviceZipCodes.join(', ')} onChange={(e) => handleChange({ target: { name: 'serviceZipCodes', value: e.target.value.split(', ') } })} placeholder='Service Zip Codes (comma-separated)' className='w-full p-2 border border-gray-300 rounded-lg' />
                ) : (
                    error ? <p className="text-red-500">{error}</p> : (
                        <div className="w-full h-96">
                            <MultiLocationMap locations={locations} />
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

const ContactInfo = ({ companyData, editMode, handleChange }) => {
    return (
        <div className="p-6 bg-white rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Contact Information</h2>
            {editMode ? (
                <div className='flex flex-col gap-4'>
                    <input type="text" name="phoneNumber" value={companyData.phoneNumber} onChange={handleChange} placeholder='Phone Number' className='w-full p-2 border border-gray-300 rounded-lg' />
                    <input type="email" name="email" value={companyData.email} onChange={handleChange} placeholder='Email' className='w-full p-2 border border-gray-300 rounded-lg' />
                    <input type="text" name="websiteURL" value={companyData.websiteURL} onChange={handleChange} placeholder='Website URL' className='w-full p-2 border border-gray-300 rounded-lg' />
                    <input type="text" name="yelpURL" value={companyData.yelpURL} onChange={handleChange} placeholder='Yelp URL' className='w-full p-2 border border-gray-300 rounded-lg' />
                </div>
            ) : (
                <div className='text-gray-600'>
                    <p><strong>Phone:</strong> {companyData.phoneNumber}</p>
                    <p><strong>Email:</strong> <a href={`mailto:${companyData.email}`} className="text-blue-500 hover:underline">{companyData.email}</a></p>
                    <p><strong>Website:</strong> <a href={companyData.websiteURL} target='_blank' rel='noopener noreferrer' className="text-blue-500 hover:underline">{companyData.websiteURL}</a></p>
                    <p><strong>Yelp:</strong> <a href={companyData.yelpURL} target='_blank' rel='noopener noreferrer' className="text-blue-500 hover:underline">{companyData.yelpURL}</a></p>
                </div>
            )}
        </div>
    );
};

const OwnerInfo = ({ companyData }) => {
    return (
        <div className="p-6 bg-white rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Owner Information</h2>
            <p className="text-gray-600"><strong>Owner Name:</strong> {companyData.ownerName}</p>
        </div>
    );
};

const SelfView = ({ companyData }) => {
    const [editMode, setEditMode] = useState(false);
    const [company, setCompany] = useState(companyData);

    useEffect(() => {
        setCompany(companyData);
    }, [companyData]);

    const handleSave = async () => {
        const updatedData = { ...company };
        try {
            const docRef = doc(db, "companies", companyData.id);
            await updateDoc(docRef, updatedData);
            setEditMode(false);
        } catch (error) {
            console.error("Error updating document: ", error);
        }
    };

    const handleCancel = () => {
        setCompany(companyData);
        setEditMode(false);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setCompany(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div className='w-full min-h-screen bg-gray-50'>
            <Header 
                companyData={company} 
                editMode={editMode} 
                setEditMode={setEditMode} 
                handleSave={handleSave} 
                handleCancel={handleCancel} 
                handleChange={handleChange} 
            />
            <div className="w-full max-w-6xl mx-auto p-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 flex flex-col gap-8">
                        <AboutUs companyData={company} editMode={editMode} handleChange={handleChange} />
                        <Services companyData={company} editMode={editMode} handleChange={handleChange} />
                    </div>
                    <div className="lg:col-span-1 flex flex-col gap-8">
                        <ContactInfo companyData={company} editMode={editMode} handleChange={handleChange} />
                        <OwnerInfo companyData={company} />
                    </div>
                </div>
                <ServiceArea companyData={company} editMode={editMode} handleChange={handleChange} />
                <Reviews companyData={company} />
            </div>
        </div>
    );
};

export default SelfView;
