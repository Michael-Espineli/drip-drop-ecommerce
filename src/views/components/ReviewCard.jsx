import React from 'react';
import { FaCheckCircle } from "react-icons/fa";
import { IoStarSharp, IoStarOutline, IoStarHalfSharp } from "react-icons/io5";

const ReviewCard = (props) => {

    const renderStars = () => {
        const rating = parseFloat(props.rating);
        const stars = [];
        for (let i = 1; i <= 5; i++) {
            if (i <= rating) {
                stars.push(<IoStarSharp key={i} />);
            } else if (i - 0.5 === rating) {
                stars.push(<IoStarHalfSharp key={i} />);
            } else {
                stars.push(<IoStarOutline key={i} />);
            }
        }
        return stars;
    };

    return (
        <div className='bg-white rounded-lg shadow-md p-4'>
            <div className='flex items-start'>
                <img className='w-12 h-12 rounded-full' src='https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/duck128.jpg?alt=media&token=549d29cd-0565-4fa4-a682-3e0816cd2fdb' alt="profile" />
                <div className='ml-4 flex-grow'>
                    <div className='flex justify-between items-center'>
                        <h3 className='text-lg font-semibold text-gray-800'>{props.reviewer}</h3>
                        <span className='text-sm text-gray-500'>{props.time}</span>
                    </div>
                    <div className='flex items-center my-1 text-yellow-500'>
                        {renderStars()}
                    </div>
                    <p className='text-gray-600'>{props.description}</p>
                    {props.verified && (
                        <div className='flex items-center mt-2 text-green-500 font-semibold'>
                            <FaCheckCircle className="mr-2" />
                            <span>Verified Customer</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReviewCard;
