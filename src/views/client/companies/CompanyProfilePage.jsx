import React, {useState, useEffect, useContext, lazy} from 'react';
import { useParams } from 'react-router-dom';
import { query, collection, getDocs, doc, updateDoc, getDoc, startAfter, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import { FaCheckCircle } from "react-icons/fa";

const ReviewCard = lazy(()=> import("../../components/ReviewCard"))
const MapComponent = lazy(()=> import("../../components/MapComponent"))


// import { ReviewCard } from '../../components/ReviewCard.jsx';
const CompanyProfilePage = () => {
    const {companyId} = useParams();
    const [reviewDescription,setReviewDescription] = useState('');
    const [company,setCompany] = useState({
        dateCreated : '',
        email : '',
        id : '',
        name : '',
        ownerId : '',
        ownerName : '',
        phoneNumber : '',
        serviceZipCodes : [],
        services : [],
        verified : false

    });
    useEffect(() => {
        (async () => {
            console.log('On Load')
            //Fire base
            try{
                const docRef = doc(db, "companies",companyId);
                const companyDoc = await getDoc(docRef);
                if (companyDoc.exists()) {
                    setCompany((prevCompany) => ({
                        ...prevCompany,
                        dateCreated: companyDoc.data().dateCreated,
                        email: companyDoc.data().email,
                        id: companyDoc.data().id,
                        name: companyDoc.data().name,
                        ownerId : companyDoc.data().ownerId,
                        ownerName : companyDoc.data().ownerName,
                        phoneNumber : companyDoc.data().phoneNumber,
                        serviceZipCodes : companyDoc.data().serviceZipCodes,
                        services : companyDoc.data().services,
                        verified : companyDoc.data().verified

                    }));
                  } else {
                    console.log("No such document!");
                  }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    async function submitReview(e) {
        e.preventDefault()
        console.log(reviewDescription);
        setReviewDescription('');
    }
    return (
        // 030811 - almost black
        // 282c28 - black green
        // 454b39 - dark olive green
        // 536546 - olive green
        // 747e79 - gray green
        // ededed - off white
        // 1D2E76 - Pool Blue
        // CDC07B - Pool Yellow
        // 9C0D38 - Pool Red
        // 2B600F - Pool Green
        <div className='px-2 md:px-7 py-5'>
            {/* Images */} 
            <div className="w-full flex justify-center">
                <img className='s:w-[50px] s:h-[50px] lg:w-[300px] lg:h-[300px] rounded-full overflow-hidden bg-white' src='https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/duck128.jpg?alt=media&token=549d29cd-0565-4fa4-a682-3e0816cd2fdb' alt="profile" />
            </div>
            {/* Info */}
            <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <div className="w-full flex justify-between">
                        <h1>{company.name}</h1>

                        { company.verified ? <div className=' flex justify-end p-0 font-lg rounded-lg items-center text-[#ffffff] gap-3'>
                                <FaCheckCircle className='text-[#5190f5]'/>
                                <h1>Verified</h1>
                            </div>:<div>
                        </div>}
                    </div>
                    <h1>{company.ownerName}</h1>
                    <h1>{company.email}</h1>
                    <h1>{company.phoneNumber}</h1>
                    <div className="w-full flex justify-between">
                        <h1 className='font-bold'>Contact Company</h1>
                        <button  onClick={(e) => submitReview(e)} className='bg-[#2ad91a] cursor-pointer text-sm ml-2 rounded text-[#ffffff] px-2 py-1 rounded-md'>Internal Chat</button>

                    </div>
                </div>
            </div>
            {/* Second Section Of Body */}
            {/* <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <div className="w-full flex justify-between">
                        <h1 className='font-bold'>Contact Company</h1>
                        <button  onClick={(e) => submitReview(e)} className='bg-[#2ad91a] cursor-pointer text-sm ml-2 rounded text-[#ffffff] px-2 py-1 rounded-md'>Internal Chat</button>

                    </div>
                </div>
            </div> */}

            {/* Third Section Of Body */}
            <div className='w-full flex flex-wrap mt-7'>

                {/*  */}
                <div className='w-full lg:w-5/12 lg:pr-3'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md'>
                        <div className='py-2'>
                            <h1 className='font-bold'>Zip Codes</h1>
                            {
                                company.serviceZipCodes?.map(zip => (
                                    <h1>{zip}</h1>
                                ))
                            }
                        </div>
                        <hr/>
                        <div className='py-2'>
                            <h1 className='font-bold'>Services</h1>
                            {
                                company.services?.map(zip => (
                                    <h1>{zip}</h1>
                                ))
                            }
                        </div>
                    </div>
                </div>

                {/* Reviews */}
                <div className='w-full lg:w-7/12 lg:pr-3'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md '>
                        <h1>Reviews</h1>
            
                        <ReviewCard 
                            rating='3.5'
                            description='I absolutely loved them'
                            reviewer='Sydney Jackson'
                            verified={true}
                            time='12 hours ago'
                        />
                        <ReviewCard 
                            rating='1.5'
                            description='They were not my Favorite Customers'
                            reviewer='Debbie Pearson'
                            verified={false}
                            time='2 days ago'
                        />
                         <ReviewCard 
                            rating='4'
                            description='They were very kind to my Dog'
                            reviewer='Ron Palace'
                            verified={true}
                            time='1 Week ago'
                        />
                        <div className='py-1'>
                            <div className='py-1 px-2 bg-[#454b39] rounded-lg shadow-sm'>
                                <div className='flex justify-center items-center'>
                                    <div className='w-full px-2'>
                                        <div className='flex justify-between items-center mb-2 '>
                                            <h1 className='text-[#ffffff]'>Leave Review</h1>
                                        </div>
                                        <form>
                                            <div className='p-2 '>
                                                <input className='w-full p-2 text-xs font-normal bg-[#ededed] rounded-lg' value={reviewDescription}
                                                type="text" name='Review' placeholder='Review' onChange={(e) => {setReviewDescription(e.target.value)}}/>
                                            </div >
                                            <button  onClick={(e) => submitReview(e)} className='bg-[#2ad91a] cursor-pointer text-sm ml-2 rounded text-[#ffffff] px-2 py-1 rounded-md'>Submit</button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Forth Section Of Body */}
            <div className='w-full flex flex-wrap mt-7'>
                <div className='w-full bg-[#747e79] p-4 rounded-md'>
                    <h1>Map</h1>
                    <MapComponent/>
                </div>
            </div>
        </div>
    );
};

export default CompanyProfilePage;