
import React, { useState, useEffect, lazy } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from './components/Header';
import { query, collection, getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";
import { MultiLocationMap } from '../../components/MultiLocationMap';
import { ChatBubbleLeftRightIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';

const ReviewCard = lazy(() => import('../../components/ReviewCard'));

const ActionButtons = ({ companyData }) => {
    const navigate = useNavigate();

    const handleStartChat = () => {
        navigate(`/messages/newCompany/${companyData.id}`);
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-md">
            <div className="flex flex-col gap-4">
                <button 
                    onClick={handleStartChat}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors"
                >
                    <ChatBubbleLeftRightIcon className="w-5 h-5" />
                    <span>Start Chat</span>
                </button>
                <Link 
                    to={`/client/service-requests/new/${companyData.id}`}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition-colors"
                >
                    <WrenchScrewdriverIcon className="w-5 h-5" />
                    <span>Request Service</span>
                </Link>
            </div>
        </div>
    );
};

const AboutUs = ({ companyData }) => (
    <div className="p-6">
        <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">About Us</h2>
            <p className="text-gray-600">{companyData.bio}</p>
        </div>
    </div>
);

const Services = ({ companyData }) => (
    <div className="p-6">
        <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Services</h3>
            {companyData.services && companyData.services.length > 0 ? (
                <ul className="list-disc list-inside text-gray-600">
                    {companyData.services.map((service, index) => (
                        <li key={index}>{service}</li>
                    ))}
                </ul>
            ) : (
                <p className="text-gray-600">No services listed.</p>
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
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Reviews</h2>
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

const ServiceArea = ({ companyData }) => {
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
                {error && <p className="text-red-500">{error}</p>}
                <div className="w-full h-96">
                    <MultiLocationMap locations={locations} />
                </div>
            </div>
        </div>
    );
};

const ContactInfo = ({ companyData }) => {
    return (
        <div className="p-6 bg-white rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Contact Information</h2>
            <div className='text-gray-600'>
                <p><strong>Phone:</strong> {companyData.phoneNumber}</p>
                <p><strong>Email:</strong> <a href={`mailto:${companyData.email}`} className="text-blue-500 hover:underline">{companyData.email}</a></p>
                <p><strong>Website:</strong> <a href={companyData.websiteURL} target='_blank' rel='noopener noreferrer' className="text-blue-500 hover:underline">{companyData.websiteURL}</a></p>
                <p><strong>Yelp:</strong> <a href={companyData.yelpURL} target='_blank' rel='noopener noreferrer' className="text-blue-500 hover:underline">{companyData.yelpURL}</a></p>
            </div>
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

const CustomerView = ({ companyData }) => {
    return (
        <div className='w-full min-h-screen bg-gray-50'>
            <Header companyData={companyData} editMode={false} />
            <div className="w-full max-w-6xl mx-auto p-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 flex flex-col gap-8">
                        <AboutUs companyData={companyData} />
                        <Services companyData={companyData} />
                    </div>
                    <div className="lg:col-span-1 flex flex-col gap-8">
                        <ActionButtons companyData={companyData} />
                        <ContactInfo companyData={companyData} />
                        <OwnerInfo companyData={companyData} />
                    </div>
                </div>
                <Reviews companyData={companyData} />
                <ServiceArea companyData={companyData} />
            </div>
        </div>
    );
};

export default CustomerView;
