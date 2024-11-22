import React, { useState, useContext, useEffect } from 'react';
import { getAuth } from "firebase/auth";
import { useNavigate } from 'react-router-dom';
import { getFirestore,  doc, updateDoc  } from "firebase/firestore";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Context } from "../../../../context/AuthContext";
import { Link } from 'react-router-dom';

const functions = getFunctions();

const Products = () => {
    const {stripeConnectedAccountId, user} = useContext(Context);

    const [name, setName] = useState('MS175');
    const [description, setDescription] = useState('Monthly Service');
    const [active, setActive] = useState(true);
    const auth = getAuth()
    const navigate = useNavigate()
    const [productList, setProductList] = useState([]);

    const checkHandler = () => {
        setActive(!active)
      }

    useEffect(() => {
        const getProductList = httpsCallable(functions, 'getProductList');
        getProductList({ 
            active: true,
            connectedAccount:stripeConnectedAccountId,
            method: "POST",
        })
        .then((result) => result.data.productList.data)            
        .then((productList) => {
            console.log(productList)
            setProductList(productList)
        })
        .catch((error) => {
            // Handle any errors
            console.error(error);
        });
    },[])
    async function getProductList(e) {
        e.preventDefault()
        console.log('createNewProduct')
        console.log(name)
        console.log(description)
        console.log(active)

        const getProductList = httpsCallable(functions, 'getProductList');
        getProductList({ 
            active: true,
            connectedAccount:stripeConnectedAccountId,
            method: "POST",
        })
        .then((result) => result.data.productList.data)            
        .then((productList) => {
                console.log(productList)
                setProductList(productList)
            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                <p className='font-bold'>Product List {productList.length}</p>
                <button onClick={(e) => {getProductList(e)}}>Get Products</button>
                <Link to='/company/stripe-subscriptions/products/addNew' className="w-[180px] h-[50px]">
                    <h1>Add New</h1>
                </Link>
                <table>
                    <thead>
                        <tr>
                            <th scope='col' className='py-3 px-4'>Id</th>
                            <th scope='col' className='py-3 px-4'>Name</th>
                            <th scope='col' className='py-3 px-4'>Description</th>
                            <th scope='col' className='py-3 px-4'>Active</th>
                            <th scope='col' className='py-3 px-4'></th>

                        </tr>
                    </thead>
                    <tbody>
                        {
                            productList.map((product) =>
                            <tr key={product.id}>
                                <td scope='col' className='py-3 px-4'>{product.id}</td>
                                <td scope='col' className='py-3 px-4'>{product.name}</td>
                                <td scope='col' className='py-3 px-4'>{product.description}</td>
                                <td scope='col' className='py-3 px-4'>{product.active ? 'Active':'Deactive'}</td>

                                <td scope='col' className='py-3 px-4'>
                                    <Link to={`/company/stripe-subscriptions/products/edit/${product.id}`}>Edit</Link>
                                    </td>
                            </tr>
                            )
                        }
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Products;