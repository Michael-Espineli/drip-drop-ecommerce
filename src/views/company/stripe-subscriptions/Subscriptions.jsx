import React from 'react';
import { Link } from 'react-router-dom';
const Subscriptions = () => {
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-1'>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                <h1 className='text-[#000000] font-bold'>Subscription Management</h1>
                <div>
                    <p className='font-bold'>Step : Build - Create Products (Completed)</p>
                    <div className='px-5'>
                        <code>https://docs.stripe.com/products-prices/pricing-models?dashboard-or-api=api#flat-rate</code>
                    </div>
                </div>
                <div>
                    <p className='font-bold'>Step : Build - Create Prices (Monthly/Yearly) (Completed)</p>
                    <div className='px-5'>
                        <code>https://docs.stripe.com/products-prices/pricing-models?dashboard-or-api=api#flat-rate</code>
                    </div>
                </div>
                <div>
                    <p className='font-bold'>Step : Build - Recurring Pricing Models</p>
                    <div className='px-5'>
                        <code>https://docs.stripe.com/connect/enable-payment-acceptance-guide</code>
                    </div>
                </div>
                <div>
                    <p className='font-bold'>Step : Build - Create Customers</p>
                    <div className='px-5'>
                        <code>https://docs.stripe.com/billing/customer#manage-customers</code>
                    </div>
                </div>
                <div>
                    <p className='font-bold'>Step : Build - Create subscriptions with Stripe Billing</p>
                    <div className='px-5'>
                        <code>https://docs.stripe.com/connect/subscriptions#customer-platform</code>
                    </div>
                </div>
            </div>
            </div>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                <p className='font-bold'>Product List</p>
                <Link to='/company/stripe-subscriptions/products' className="w-[180px] h-[50px]">
                    <h1>See Products</h1>
                </Link>
  
            </div>
        </div>
    );
};

export default Subscriptions;