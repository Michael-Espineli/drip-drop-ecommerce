import React, { useState, useContext } from 'react';
import { getAuth } from "firebase/auth";
import { useNavigate } from 'react-router-dom';
import { getFirestore,  doc, updateDoc  } from "firebase/firestore";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Context } from "../../../../context/AuthContext";
const functions = getFunctions();


const CreateNewProduct = () => {
    const {stripeConnectedAccountId, user} = useContext(Context);

    const [name, setName] = useState('MS175');
    const [description, setDescription] = useState('Monthly Service');
    const [price, setPrice] = useState(175);

    const [active, setActive] = useState(true);
    const auth = getAuth()
    const navigate = useNavigate()

    const checkHandler = () => {
        setActive(!active)
      }
      const updatePrice = (priceString) => {
        try {
            var x = parseInt(priceString, 10);
            setPrice(x)
        }catch(error) {
            setPrice(0)
        }
    }
    async function createNewProduct(e) {
        e.preventDefault()
        console.log('createNewProduct')
        console.log(name)
        console.log(description)
        console.log(active)
        console.log(price)

        const createNewProduct = httpsCallable(functions, 'createNewProduct');
        createNewProduct({ 
            name: name,
            description: description,
            active: active,
            connectedAccount:stripeConnectedAccountId,
            method: "POST",
        })
        .then((result) => result.data.product)            
        .then((product) => {
                console.log(product)
                console.log(product.id)
                // Handle the result from the function
            navigate('/company/stripe-subscriptions/products')

            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
        // signInWithEmailAndPassword(auth,email,password)
        // .then((user) => {
        //     navigate('/company/dashboard')
        // })
        // .catch((error) => {
        //     console.log(error)
        // })
    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <h1>Create New Product</h1>
            <form>
                    <div className='left-0 w-full justify-between gap-3 text-[#000000]'>
                        <div className='p-2'>
                            <label>Name</label>
                            <input onChange={(e) => {setName(e.target.value)}} className='w-full 
                            p-2 rounded-md' type="text" placeholder='Name'></input>
                        </div>
                        <div className='p-2'>
                        <label>Description</label>
                            <input onChange={(e) => {setDescription(e.target.value)}} className='w-full 
                            p-2 rounded-md' type="text" placeholder='Description'></input>
                        </div>
                        <div className='p-2'>
                        <label>Price</label>
                            <input onChange={(e) => {updatePrice(e.target.value)}} className='w-full 
                            p-2 rounded-md' type="text" placeholder='Description'></input>
                        </div>
                        <div className="flex items-center w-full gap-3 mb-3">
                            <input className="w-4 h-4 text-blue-600 overflow-hidden bg-gray-200 rounded border-gray-300 focus:ring-blue-500" 
                             onChange={checkHandler}
                             checked={active}
                            type="checkbox" name="checkbox" id="checkbox"></input>
                            <label htmlFor="checkbox">Active</label>
                        </div>
                         <div className='p-2'>
                            <button onClick={(e) => createNewProduct(e)} 
                            className='bg-[#ffffff] p-2 rounded-md'
                            >Create New Product</button>
                        </div>
                    </div>
                </form>
        </div>
    );
};

export default CreateNewProduct;