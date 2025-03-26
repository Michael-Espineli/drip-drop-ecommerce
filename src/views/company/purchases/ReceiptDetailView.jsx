import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns'; // Or any other date formatting library

const ReceiptDetailView = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    const {receiptId} = useParams();
    const [purchaseList, setPurchaseList] = useState([]);

    const [receipt, setReceipt] = useState({
        id : '',
        cost : '',
        costAfterTax : '',
        date : '',
        invoiceNum : '',
        numberOfItems : '',
        pdfUrlList : '',
        purchasedItemIds : '',
        storeId : '',
        storeName : '',
        techId : '',
        techName : ''
    });
    useEffect(() => {
        (async () => {
            try{
                const docRef = doc(db, "companies",recentlySelectedCompany,'receipts',receiptId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    const data = docSnap.data()

                    const date = data.date.toDate();
                    const formattedDate = format(date, 'MM / d / yyyy'); 
                    setReceipt((receipt) => ({
                        ...receipt,
                        id : data.id,
                        cost : formatCurrency(data.cost/100),
                        costAfterTax : formatCurrency(data.costAfterTax/100),
                        date : formattedDate,
                        invoiceNum : data.invoiceNum,
                        numberOfItems : data.numberOfItems,
                        pdfUrlList : data.pdfUrlList,
                        purchasedItemIds : data.purchasedItemIds,
                        storeId : data.storeId,
                        storeName : data.storeName,
                        techId : data.techId,
                        techName : data.techName
                    }));
                    let q;
                            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("receiptId", "==", receiptId));
                            const querySnapshot = await getDocs(q);
                            let count = 1 
                            setPurchaseList([])  
                            querySnapshot.forEach((doc) => {
                                const purchaseData = doc.data()
                                const dateCreated = purchaseData.date.toDate();
                                const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                                const purchase = {
                                    id:purchaseData.id,
                                    name:purchaseData.name,
                                    invoiceNum:purchaseData.invoiceNum,
                                    price:purchaseData.price/100,
                                    quantityString: purchaseData.quantityString,
                                    techName:purchaseData.techName,
                                    venderName:purchaseData.venderName,
                                    date:formattedDate1,
                                }
                                count = count + 1
                                setPurchaseList(purchaseList => [...purchaseList, purchase]); 
                            });
                } else {
                console.log("No such document!");
                }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])

    function formatCurrency(number, locale = 'en-US', currency = 'USD') {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency
        }).format(number);
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
        // 919191 = gray
        <div className='px-2 md:px-7 py-5'>
            <div className=' py-2'>
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                to={`/company/purchasedItems`}
                >Back</Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between py-1'>
                        <p className='font-bold text-lg'>Receipt Detail View</p>
                    </div>
                    <hr/>
                    
                    <p>Cost -  {receipt.cost}</p>
                    <p>date  - {receipt.date}</p>
                    <p>Store  - {receipt.storeName}</p>
                    <p>Tech  - {receipt.techName}</p>
                </div>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md mt-2  text-[#cfcfcf]'>
                <div className='left-0 w-full justify-between'>
                    <p>Items</p>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm  border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Price</th>
                                <th className='py-3 px-4'>Quantity</th>
                                <th className='py-3 px-4'>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {
                            purchaseList?.map(task => (
                            <tr key={task.id}>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${task.id}`}>{task.name}</Link></td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${task.id}`}>$ {task.price}</Link></td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${task.id}`}>{task.quantityString}</Link></td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${task.id}`}>$ {task.quantityString*task.price}</Link></td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                    <button>
                                        Edit
                                    </button>
                                </td>
                            </tr>
                            ))
                            }
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div className='w-full bg-[#0e245c] p-4 rounded-md mt-2 text-[#cfcfcf]'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between py-1'>
                        <p className='font-bold text-lg'>Upload Images and Pictures</p>
                    </div>
                    <hr/>
                    
                    <p>Cost -  {receipt.cost}</p>
                </div>
            </div>
        </div>
    );
}
    export default ReceiptDetailView;
