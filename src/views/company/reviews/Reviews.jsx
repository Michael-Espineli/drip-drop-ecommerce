import React from 'react';
import ReviewCard from '../../components/ReviewCard';

const reviews = [
    {
        reviewer: 'John Doe',
        time: '2 days ago',
        rating: 4.5,
        description: 'Great service! The team was professional and efficient.',
        verified: true,
    },
    {
        reviewer: 'Jane Smith',
        time: '1 week ago',
        rating: 5,
        description: 'Absolutely fantastic! I highly recommend their services.',
        verified: true,
    },
    {
        reviewer: 'Peter Jones',
        time: '3 weeks ago',
        rating: 3,
        description: 'Good, but could be better. The communication was a bit slow.',
        verified: false,
    },
    {
        reviewer: 'Mary Williams',
        time: '1 month ago',
        rating: 4,
        description: 'I am very happy with the results. My pool has never looked cleaner.',
        verified: true,
    },
];

const ReviewsPage = () => {
    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8">Customer Reviews</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {reviews.map((review, index) => (
                    <ReviewCard
                        key={index}
                        reviewer={review.reviewer}
                        time={review.time}
                        rating={review.rating}
                        description={review.description}
                        verified={review.verified}
                    />
                ))}
            </div>
        </div>
    );
};

export default ReviewsPage;
