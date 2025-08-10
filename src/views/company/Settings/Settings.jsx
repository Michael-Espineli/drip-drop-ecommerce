import React from 'react';
import {Link } from 'react-router-dom';

const Settings = () => {
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full blue-bg rounded-md text-[#d0d2d6] p-4'>
                <h1 className=' font-bold'>Settings</h1>

                
                <Link to='/company/selector'>
                    <p>Change Selected Company</p>
                </Link>
                <p>Products</p>
                <p>Service</p>
                <p>Readings and Dosages</p>
                <p>Task Groups</p>
                <p>Job templates</p>
                <p>Email Configuration</p>
                <p>Custom Contract Terms</p>
                <p>Quick books</p>
                <p>Stripe</p>
            </div>
        </div>
    );
};

export default Settings;