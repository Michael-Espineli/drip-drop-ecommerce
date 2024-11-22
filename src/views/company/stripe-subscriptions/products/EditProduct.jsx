import React, {useEffect, useContext, useState} from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Context } from "../../../../context/AuthContext";

const functions = getFunctions();

function EditProduct () {
    const {stripeConnectedAccountId, user} = useContext(Context);

    const {productId} = useParams();
    const [priceList, setPricelist] = useState([]);

    useEffect(() => {
        const getPriceList = httpsCallable(functions, 'getPriceList');
        console.log('stripeConnectedAccountId')
        console.log(stripeConnectedAccountId)
        getPriceList({ 
            active : true,
            connectedAccount : stripeConnectedAccountId,
            method : "POST",
            productId : productId,
        })
        .then((result) => result.data.priceList.data)            
        .then((priceList) => {
            console.log(priceList)
            setPricelist(priceList)
        })
        .catch((error) => {
            // Handle any errors
            console.error(error);
        });
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>

                <h1>EditProduct</h1>
                <h1>{productId}</h1>
                <h1>{stripeConnectedAccountId}</h1>

                {/* Product Info */}

                {/* Product Pricing */}

                <div>
                <table>
                    <thead>
                        <tr>
                            <th scope='col' className='py-3 px-4'>Id</th>
                            <th scope='col' className='py-3 px-4'>Product Id</th>

                            <th scope='col' className='py-3 px-4'>Nick Name</th>
                            {/* <th scope='col' className='py-3 px-4'>Recurring</th> */}
                            <th scope='col' className='py-3 px-4'>unit_amount</th>
                            <th scope='col' className='py-3 px-4'></th>

                        </tr>
                    </thead>
                    <tbody>
                        {
                            priceList.map((price) =>
                            <tr key={price.id}>
                                <td scope='col' className='py-3 px-4'>{price.id}</td>
                                <td scope='col' className='py-3 px-4'>{price.product}</td>

                                <td scope='col' className='py-3 px-4'>{price.nickName}</td>
                                <td scope='col' className='py-3 px-4'>{price.unit_amount/100}</td>
                                <td scope='col' className='py-3 px-4'>{price.active ? 'Active':'Deactive'}</td>

                                <td scope='col' className='py-3 px-4'>
                                    <Link to={`/company/stripe-subscriptions/products/edit/${price.id}`}>Edit</Link>
                                </td>
                            </tr>
                            )
                        }
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    );
};

export default EditProduct;