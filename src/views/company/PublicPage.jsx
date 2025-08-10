import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import { Company } from '../../utils/models/Company';
import { FaStar, FaStarHalfAlt, FaRegStar } from 'react-icons/fa';

const PublicPage = () => {
    const {recentlySelectedCompany} = useContext(Context);
    const [company, setCompany] = useState({
        id : '',
        companyId : '',
        companyName : '',
        services : [],
        serviceZipCodes : [],
        dateCreated : '',
        description : '',
        duration : '',
    });
    useEffect(() => {
        const fetchCompany = async () => {

            console.log("Fetch Company");
            try{
                const docRef = doc(db, "companies",recentlySelectedCompany);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    const itemData =  Company.fromFirestore(docSnap)

                    setCompany((company) => ({
                        ...company,
                        itemData
                    }));
                    setCompany(itemData)

                } else {
                console.log("No such document!");
                }
            } catch (e){
                console.log(e);
            }
        }
        fetchCompany();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>

            <div className='w-full flex flex-wrap mt-4'>
                {/* Chart */}
                <div className='w-full lg:w-1/2 lg:pr-3'>

                    <div className='h-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                        <h1 className='font-bold'>Public Page</h1>
                        <h1>Name: {company.name}</h1>      
                        {company.needToVerify ? <div>Verification Pending</div>:<div>
                            {company.verified ? <div>Verifified</div>:<div>
                                UnVerified
                                </div>}    
                            </div>}  
                        <div className="flex items-center">                 
                            <h1>
                                Rating:
                            </h1>     
                            <FaStar className="yellow-fg"/>
                            <FaStar className="yellow-fg"/>
                            <FaStar className="yellow-fg"/>
                            <FaStarHalfAlt className="yellow-fg"/>
                            <FaRegStar className="yellow-fg"/>
                        </div>     

                        <h1>Phone Number: {company.phoneNumber}</h1>   
                        <h1>Email: {company.email}</h1>     
                        <h1>Bio: Something Something Bio</h1>          
                        <h1><a href={company.websiteURL}>Web Site</a></h1>  
                        <h1><a href={company.yelpURL}>Yelp</a></h1>          
                    </div>
                </div>
                <div className='w-full lg:w-1/2 lg:pr-3'>
                    <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                        <h1>Owner Information</h1>
                        <h1>Owner Name: {company.ownerName}</h1>   
                    </div>

                    <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4 mt-4'>
                        <h1>Service</h1>
                        <h1>Service Zip Codes:</h1>
                        
                        {company.serviceZipCodes.map(item => (  
                            <div key={item}>
                                <p>{item}</p>
                            </div>
                        ))}             
                        <h1>Services:</h1>

                        {company.services.map(item => (  
                            <div key={item}>
                                <p>{item}</p>
                            </div>
                        ))} 
                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4 mt-4'>
                <h1 className="font-bold">Reviews</h1>
            </div>

            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4 mt-4'>
                <h1 className="font-bold">File Complaint</h1>
            </div>
        </div>
    );
};

export default PublicPage;