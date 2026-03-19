import React, { useState, useEffect, useContext, lazy } from 'react';
import Header from './components/Header';
import { Context } from '../../../context/AuthContext';
import { query, collection, getDocs, doc, setDoc, limit, deleteDoc, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import { v4 as uuidv4 } from 'uuid';
import { AssociatedBusiness } from '../../../utils/models/AssociatedBusiness';
import { Link } from 'react-router-dom';
import { MultiLocationMap } from '../../components/MultiLocationMap';

const ReviewCard = lazy(() => import('../../components/ReviewCard'));

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

const B2BView = ({ companyData }) => {
    const { recentlySelectedCompany } = useContext(Context);
    const [businesses, setBusinesses] = useState([]);

    useEffect(() => {
        const fetchAssociatedBusinesses = async () => {
            if (recentlySelectedCompany && companyData) {
                let q = query(collection(db, 'companies', recentlySelectedCompany, 'business'), where('companyId', '==', companyData.id), limit(1));
                const querySnapshot = await getDocs(q);
                const businessesData = querySnapshot.docs.map(doc => AssociatedBusiness.fromFirestore(doc));
                setBusinesses(businessesData);
            }
        }
        fetchAssociatedBusinesses();
    }, [recentlySelectedCompany, companyData]);

    const handleSaveAssociatedBusiness = async () => {
        if (!recentlySelectedCompany || !companyData.id) {
            alert("Cannot save associated business. A company must be selected and the viewed page must be a valid company.");
            return;
        }

        const associatedBusinessData = {
            id: 'com_cus_' + uuidv4(),
            companyId: companyData.id,
            companyName: companyData.name
        }

        try {
            const docRef = doc(db, 'companies', recentlySelectedCompany, 'business', companyData.id);
            await setDoc(docRef, associatedBusinessData);
            alert('Successfully saved as an associated business!');
            setBusinesses([AssociatedBusiness.fromFirestore({ data: () => associatedBusinessData })]);
        } catch (error) {
            console.error("Error saving associated business: ", error);
            alert('Failed to save associated business.');
        }
    };

    const handleUnsaveAssociatedBusiness = async () => {
        if (!recentlySelectedCompany || businesses.length === 0) {
            alert("Cannot unsave associated business. A company must be selected and the viewed page must be a valid company.");
            return;
        }

        try {
            const docRef = doc(db, 'companies', recentlySelectedCompany, 'business', companyData.id);
            await deleteDoc(docRef);
            alert('Successfully unsaved as an associated business!');
            setBusinesses([]);
        } catch (error) {
            console.error("Error unsaving associated business: ", error);
            alert('Failed to unsave associated business.');
        }
    };

    return (
        <div className='w-full min-h-screen bg-gray-50'>
            <Header companyData={companyData} editMode={false} />
            <div className='p-4 border-b border-gray-200'>
                <div className="w-full flex justify-between items-center">
                    <Link to={`/messages/newCompany/${companyData.id}`} className='bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-300'>
                        Internal Chat
                    </Link>
                    {
                        (businesses.length > 0 ?
                            <button onClick={handleUnsaveAssociatedBusiness} className='bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-300'>
                                Unsave as Associate
                            </button> :
                            <button onClick={handleSaveAssociatedBusiness} className='bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-300'>
                                Save as Associate
                            </button>)
                    }
                </div>
            </div>
            <Services companyData={companyData} />
            <Reviews companyData={companyData} />
            <ServiceArea companyData={companyData} />
        </div>
    );
};

export default B2BView;
