import React, {useState, useContext} from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Link, useNavigate } from 'react-router-dom';
import { FaChevronLeft } from "react-icons/fa";
import toast from 'react-hot-toast';

const functions = getFunctions();

const AddNewSubscription = () => {

    const navigate = useNavigate()

    const [name, setName] = useState('');

    const [description, setDescription] = useState('');

    const [internalNotes, setInternalNotes] = useState('');

    const [cents, setCents] = useState(0);
    const [formattedPrice, setFormattedPrice] = useState(0);
    // const formattedPrice = (cents / 100).toLocaleString('en-US', {
    //     style: 'currency',
    //     currency: 'USD',
    // })
    // const handleCentsChange = (event) => {
    //     const value = event.target.value;
    //     // Remove non-numeric characters except for a potential decimal
    //     const numericValue = value.replace(/[^0-9.]/g, '');
    //     // Convert to cents and update state
    //     setCents(Math.round(parseFloat(numericValue) * 100));
    // }
    
    const handleCentsChange = (event) => {
        console.log('Handle Cents Change')
        let value = event.target.value.replace(/[^0-9.]/g, ''); // Keep only numbers and a single decimal point
        setCents(value)
        setFormattedPrice(value)
    }

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {

            event.preventDefault(); // Prevent default form submission or other behaviors
            console.log('Enter Key Pressed')
            let newCents = event.target.value.replace(/[^0-9.]/g, ''); // Keep only numbers and a single decimal point

            // Parse the displayValue to a float and convert to cents
            // const dollars = parseFloat(value);
            // const newCents = Math.round(dollars * 100);
            setCents(newCents);

            // You can now use `newCents` for your application logic (e.g., API calls)
            console.log('Value in cents:', newCents);
            setFormattedPrice((newCents).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
            }))
        }
    }
    async function addNewSubscription(e) {
        e.preventDefault()
        let newCents = parseFloat(cents)*100
        const toastId = toast.loading('Creating subscription plan...');
        const createStripeSubscription = httpsCallable(functions, 'createStripeSubscription');

        try {
            const result = await createStripeSubscription({
                name,
                price: newCents,
                description,
                internalNotes: internalNotes,
                active: true,
            });
            const subscriptionId = result.data?.subscription?.id;
            toast.success('Subscription plan created.', { id: toastId });
            navigate(`/admin/subscriptions/detail/${subscriptionId}`);
        } catch (error) {
            console.error(error);
            toast.error(error.message || 'Failed to create subscription plan.', { id: toastId });
        }

    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div>
                <div className='flex'>
                        <Link 
                        className='bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6] justify-start items-center gap-3 flex'
                        to='/admin/subscriptions'>
                                <FaChevronLeft />
                                <p>
                                 Subscription List
                                </p>                    
                        </Link>
                    </div>   
                    <p>Create New Subscription</p>
                </div>
                <form>
                    <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                        <div className='flex justify-between gap-3 items-center py-2'>
                            <h1>Name: </h1>  
                            <input 
                            value={name}
                            onChange={(e) => {setName(e.target.value)}}
                            className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                            text-[#030811] focus:border-[#ededed] overflow-hidden" type="text" name='Name' placeholder='Name'  />
                        </div>
                        <h1>Description: </h1>  
                        <textarea className="w-full px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#030811] focus:border-[#ededed] overflow-hidden resize-y" 
                        value={description}
                        onChange={(e) => {setDescription(e.target.value)}}
                        type="text" 
                        name='search' 
                        placeholder='Description'/>
                        <div className='flex justify-between gap-3 items-center py-2'>
                            <h1>Price: </h1>  
                            <div 
                            className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                            text-[#030811] focus:border-[#ededed] overflow-hidden flex">
                                <h1>$</h1>
                                <input 
                                value={formattedPrice}
                                onChange={handleCentsChange}
                                onKeyDown={handleKeyDown} type="text" name='search' placeholder='Rate'  
                                className="bg-[#ededed] text-[#030811] focus:border-[#ededed]"
                                />
                            </div>
                        </div>
                        <h1>Internal Notes : </h1>  
                        <textarea className="w-full px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#030811] focus:border-[#ededed] overflow-hidden resize-y" 
                        value={internalNotes} 
                        onChange={(e) => {setInternalNotes(e.target.value)}}
                        type="text" 
                        name='search' 
                        placeholder='Internal Notes'/>
                        <button onClick={(e) => addNewSubscription(e)} className='w-full mt-7 bg-[#2B600F] rounded-md py-1 px-2'>Create New</button>
                    </div>  
                </form>  
            </div>    
        </div>
    );
};

export default AddNewSubscription;
