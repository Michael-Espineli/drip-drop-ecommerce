import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { db } from '../../../utils/config'; // Assuming you have your Firebase config here
import { collection, setDoc, doc } from 'firebase/firestore';
import {v4 as uuidv4} from 'uuid';
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns'; // Or any other date formatting library

const BulkCustomerUpload = () => {
  const {name,recentlySelectedCompany} = useContext(Context);

  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState([]);
  const navigate = useNavigate();

  const [total, setTotal] = useState('');
  const [current, setCurrent] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const [isCustomerCount, setIsCustomerCount] = useState(0);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const getGeocode = async (address) => {
    try {
      // const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
      // if (!apiKey) {
      //   throw new Error("Google Maps API key is missing. Please set it up in your environment variables.");
      // }
      const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=AIzaSyD3eajIfPOTYQR7-O8VlFTBCVnz7HjUnns`);
      const data = await response.json();
      if (data.status === 'OK') {
        const { lat, lng } = data.results[0].geometry.location;
        return { latitude: lat, longitude: lng };
      } else {
        console.error('Geocoding failed:', data.status);
        return { latitude: null, longitude: null };
      }
    } catch (error) {
      console.error('Error during geocoding:', error);
      setError('Error during geocoding. Please check your API key and network connection.');
      return { latitude: null, longitude: null };
    }
  };


  const handleUpload = () => {
    if (!file) {
      setError('Please select a file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        console.log("Attempting Upload")

        const bstr = evt.target.result;
        console.log(1)
        const wb = XLSX.read(bstr, { type: 'binary' });
        console.log(2)
        const wsname = wb.SheetNames[0];
        console.log(3)
        const ws = wb.Sheets[wsname];
        console.log(4)
        const data = XLSX.utils.sheet_to_json(ws);
        console.log(data)
        // Assuming your customer data has fields like 'firstName', 'lastName', 'email'
        let count = 0 
        setTotal(data.length)
        setIsLoading(true)
        for (const customer of data) {
          count += 1
          setCurrent(count)
          console.log(customer)
          let customerId = 'com_cus_' + uuidv4();
          const fullAddress = `${customer.streetAddress}, ${customer.city}, ${customer.state} ${customer.zipCode}`;
          const { latitude, longitude } = await getGeocode(fullAddress);

          let address = {
            streetAddress: customer.streetAddress ?? "",
            city: customer.city ?? "",
            state: customer.state ?? "",
            zip: customer.zipCode + ""  ?? "",
            latitude,
            longitude, 
          }
          console.log(address)
          let hireDate = new Date(((customer.hiredate ?? 0) - 25569) * 86400 * 1000);
          // console.log(hireDate)
          let customerName = customer.firstName + " " + customer.lastName
          let customerModel = {
            id:customerId,
            firstName: customer.firstName ?? "",
            lastName: customer.lastName ?? "",
            email: customer.email ?? "",
            billingAddress: address,
            phoneNumber: customer.phoneNumber + "" ?? "",
            phoneLabel: customer.firstName ?? "",
            active: true,
            company: customer.company ?? "",
            displayAsCompany: customer.displayAsCompany === "True" ? true : false,
            hireDate: hireDate,
            billingNotes: customer.billingNotes ?? "",
            tags: tags,
            linkedCustomerIds: [],
            linkedInviteId: "",
          }

          // console.log('Uploaded ' + customerName)
          let serviceLocationId = 'com_sl_' + uuidv4();
          let contactId = 'com_con_' + uuidv4();
          let bodyOfWaterId = 'com_bow_' + uuidv4();
          let serviceLocationModel = {
            id:serviceLocationId,
            nickName: "House",
            address: address,
            gateCode: "",
            dogName: [],
            estimatedTime: 15,
            mainContact: {
              id : contactId,
              name : customerName ?? "",
              phoneNumber : customer.phoneNumber + "" ?? "",
              email : customer.email ?? "",
              notes : ""
            },
            notes: "",
            bodiesOfWaterId: [bodyOfWaterId],
            rateType:"",
            laborType:"",
            chemicalCost:"",
            laborCost:"",
            rate:"",
            customerId : customerId,
            customerName : customerName,
            preText: false,
            verified: false,
            photoUrls:[]
          }
          let bodyOfWaterModel = {
            id:bodyOfWaterId,
            name:"pool",
            gallons:"16000",
            material:"",
            customerId:customerId,
            serviceLocationId:serviceLocationId,
            notes:"",
            lastFilled:new Date(),
          }
          let filterId = 'com_equ_' + uuidv4();
          let pumpId = 'com_equ_' + uuidv4();
          const futureDate = new Date();

          futureDate.setMonth(futureDate.getMonth() + 6);
          let filterModel = {
            id:filterId,
            name : "filter",
            type : "Filter",
            typeId: "",
            make: "",
            makeId: "",
            model: "",
            modelId: "",
            dateInstalled  : new Date(),
            status: "Operational",
            needsService: true,
            cleanFilterPressure : 10,
            currentPressure : 10,
            lastServiceDate : new Date(),
            serviceFrequency : 6,
            serviceFrequencyEvery : "Month",
            nextServiceDate : futureDate,
            notes : "",
            customerName : customerName,
            customerId : customerId,
            serviceLocationId  : serviceLocationId,
            bodyOfWaterId : bodyOfWaterId,
            photoUrls : [],
            isActive: true,
          }
          let pumpModel = {
            id:pumpId,
            name : "pump",
            type : "Pump",
            typeId: "",
            make: "",
            makeId: "",
            model: "",
            modelId: "",
            dateInstalled  : new Date(),
            status: "Operational",
            needsService: false,
            notes : "",
            customerName : customerName,
            customerId : customerId,
            serviceLocationId  : serviceLocationId,
            bodyOfWaterId : bodyOfWaterId,
            photoUrls : [],
            isActive: true,
          }

          // console.log(customerModel)
          await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'customers'),customerId), customerModel);
          await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'),serviceLocationId), serviceLocationModel);
          await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'),bodyOfWaterId), bodyOfWaterModel);
          await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'equipment'),filterId), filterModel);
          await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'equipment'),pumpId), pumpModel);
          // console.log('uploaded location '+ address.streetAddress)
          //Set Up first customer
        }

        setSuccess('Customers uploaded successfully!');

        setIsLoading(false)
        setError('');
        setTimeout(() => {
          navigate('/company/customers');
        }, 2000);
      } catch (err) {
        setError('Error processing file. Make sure it is a valid Excel file.');
        console.error(err);
      }
    };
    reader.readAsBinaryString(file);
  };
  const addTag = () => {
    if (tag.trim() !== '') {
      setTags(prevTags => [...prevTags, tag.trim()]);
      setTag('');
    }
  };

  const removeTag = (tagToRemove) => {
    setTags(prevTags => prevTags.filter(t => t !== tagToRemove));
  };
  //Development Tester Functions 

  const handleFeatureLimitChange = (value) => {
    const limit = parseInt(value, 10);
    // If the value is not a number (e.g., empty string), keep it as is for the input,
    // but you might want to ensure it's stored as a number.
    setIsCustomerCount(limit)
    
  };
  const firstNames = ["John", "Jane", "Mike", "Sarah", "Chris", "Emily","Ellie","Eva","Dani","Bella","Alexa", "Gia", "Kenzie", "Piper", "Riley", "Chloe"];
  const lastNames = ["Smith", "Johnson", "Brown", "Taylor", "Anderson"];
  const streets = ["Main St", "Oak Ave", "Maple Dr", "Pine Rd"];
  const cities = ["San Diego", "La Mesa", "El Cajon", "San Diego"];
  const states = ["CA", "CA", "CA", "CA"];
  
  const randomItem = arr => arr[Math.floor(Math.random() * arr.length)];
  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  
  function generateRandomCustomer() {
    const firstName = randomItem(firstNames);
    const lastName = randomItem(lastNames);
  
    return {
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(1,999)}@test.com`,
      phoneNumber: `555${randomInt(1000000, 9999999)}`,
      streetAddress: `${randomInt(100,999)} ${randomItem(streets)}`,
      city: randomItem(cities),
      state: randomItem(states),
      zipCode: randomInt(10000, 99999),
      hiredate: 25569 + randomInt(0, 4000), // Excel-style date offset
      company: "",
      displayAsCompany: false,
      billingNotes: ""
    };
  }

  async function handleTestUpload(e) {
          e.preventDefault()

    try {
      console.log("Attempting Test Upload")


      setTotal(isCustomerCount);
      setIsLoading(true);
      
      for (let i = 0; i < isCustomerCount; i++) {
        setCurrent(i + 1);
      
        const customer = generateRandomCustomer();
        const customerId = `com_cus_${uuidv4()}`;
        const customerName = `${customer.firstName} ${customer.lastName}`;
      
        const fullAddress = `${customer.streetAddress}, ${customer.city}, ${customer.state} ${customer.zipCode}`;
        const { latitude, longitude } = await getGeocode(fullAddress);
      
        const address = {
          streetAddress: customer.streetAddress,
          city: customer.city,
          state: customer.state,
          zip: customer.zipCode.toString(),
          latitude,
          longitude
        };
      
        const hireDate = new Date(
          ((customer.hiredate ?? 0) - 25569) * 86400 * 1000
        );

        // console.log(hireDate)
        let customerModel = {
          id:customerId,
          firstName: customer.firstName ?? "",
          lastName: customer.lastName ?? "",
          email: customer.email ?? "",
          billingAddress: address,
          phoneNumber: customer.phoneNumber + "" ?? "",
          phoneLabel: customer.firstName ?? "",
          active: true,
          company: customer.company ?? "",
          displayAsCompany: customer.displayAsCompany ?? false,
          hireDate: hireDate,
          billingNotes: customer.billingNotes ?? "",
          tags: tags,
          linkedCustomerIds: [],
          linkedInviteId: "",
        }

        // console.log('Uploaded ' + customerName)
        let serviceLocationId = 'com_sl_' + uuidv4();
        let contactId = 'com_con_' + uuidv4();
        let bodyOfWaterId = 'com_bow_' + uuidv4();
        let serviceLocationModel = {
          id:serviceLocationId,
          nickName: "House",
          address: address,
          gateCode: "",
          dogName: [],
          estimatedTime: 15,
          mainContact: {
            id : contactId,
            name : customerName ?? "",
            phoneNumber : customer.phoneNumber + "" ?? "",
            email : customer.email ?? "",
            notes : ""
          },
          notes: "",
          bodiesOfWaterId: [bodyOfWaterId],
          rateType:"",
          laborType:"",
          chemicalCost:"",
          laborCost:"",
          rate:"",
          customerId : customerId,
          customerName : customerName,
          preText: false,
          verified: false,
          photoUrls:[]
        }
        let bodyOfWaterModel = {
          id:bodyOfWaterId,
          name:"pool",
          gallons:"16000",
          material:"",
          customerId:customerId,
          serviceLocationId:serviceLocationId,
          notes:"",
          lastFilled:new Date(),
        }
        let filterId = 'com_equ_' + uuidv4();
        let pumpId = 'com_equ_' + uuidv4();
        const futureDate = new Date();

        futureDate.setMonth(futureDate.getMonth() + 6);
        let filterModel = {
          id:filterId,
          name : "filter",
          type : "Filter",
          typeId: "",
          make: "",
          makeId: "",
          model: "",
          modelId: "",
          dateInstalled  : new Date(),
          status: "Operational",
          needsService: true,
          cleanFilterPressure : 10,
          currentPressure : 10,
          lastServiceDate : new Date(),
          serviceFrequency : 6,
          serviceFrequencyEvery : "Month",
          nextServiceDate : futureDate,
          notes : "",
          customerName : customerName,
          customerId : customerId,
          serviceLocationId  : serviceLocationId,
          bodyOfWaterId : bodyOfWaterId,
          photoUrls : [],
          isActive: true,
        }
        let pumpModel = {
          id:pumpId,
          name : "pump",
          type : "Pump",
          typeId: "",
          make: "",
          makeId: "",
          model: "",
          modelId: "",
          dateInstalled  : new Date(),
          status: "Operational",
          needsService: false,
          notes : "",
          customerName : customerName,
          customerId : customerId,
          serviceLocationId  : serviceLocationId,
          bodyOfWaterId : bodyOfWaterId,
          photoUrls : [],
          isActive: true,
        }

        // console.log(customerModel)
        await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'customers'),customerId), customerModel);
        await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'),serviceLocationId), serviceLocationModel);
        await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'),bodyOfWaterId), bodyOfWaterModel);
        await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'equipment'),filterId), filterModel);
        await setDoc(doc(collection(db, 'companies', recentlySelectedCompany, 'equipment'),pumpId), pumpModel);
        // console.log('uploaded location '+ address.streetAddress)
        //Set Up first customer
      }

      setSuccess('Customers uploaded successfully!');

      setIsLoading(false)
      setError('');
    } catch (err) {
      setError('Error processing file. Make sure it is a valid Excel file.');
      console.error(err);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Bulk Upload Customers</h1>
      <div className="mb-4">
        <input
          type="file"
          accept=".xlsx, .xls"
          onChange={handleFileChange}
          className="p-2 border rounded"
        />
      </div>
      <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4" role="alert">
        <p className="font-bold">Important Note</p>
        <p>This feature requires that you format your excel document in a specific way. Please see how it should be formatted below. Please contact support if you need nay help</p>
      
        <div className='overflow-x-auto'>
            <table className="min-w-full bg-white">
                <thead className="bg-gray-100">
                    <tr>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>firstName</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>lastName</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>displayAsCompany</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>company</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>streetAddress</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>city</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>state</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>phoneNumber</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>email</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>billingNotes</th>
                        <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>hireDate</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                        <tr className="hover:bg-gray-50 transition-colors">
                            <td className='p-4 whitespace-nowrap'>John</td>
                            <td className='p-4 whitespace-nowrap'>Doe</td>
                            <td className='p-4 whitespace-nowrap'>TRUE / FALSE</td>
                            <td className='p-4 whitespace-nowrap'>John Doe Pools</td>
                            <td className='p-4 whitespace-nowrap'>3081 El Cajoon Blvd</td>
                            <td className='p-4 whitespace-nowrap'>CA</td>
                            <td className='p-4 whitespace-nowrap'>92101</td>
                            <td className='p-4 whitespace-nowrap'>555-555-5555</td>
                            <td className='p-4 whitespace-nowrap'>john.doe@gmail.com</td>
                            <td className='p-4 whitespace-nowrap'></td>
                            <td className='p-4 whitespace-nowrap'>12/6/2020</td>
                        </tr>
                </tbody>
            </table>
        </div>
      
      </div>
      {
        isLoading&&<p>{current}/{total}</p>
      }
      {error && <p className="text-red-500">{error}</p>}
      {success && <p className="text-green-500">{success}</p>}
      <div>
        Add Common Traits of all of them, IE Tags or something or another

        <div className="flex py-2 gap-2"><label>Tag</label><input type="text" value={tag} onChange={(e) => setTag(e.target.value)} className=" p-1 rounded-md" />
          <button
          onClick={addTag}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
          Add Tag
          </button>
        </div>
          <div className='w-full'>
            {
              tags?.map((chat, index) => (
                  <div className="flex py-2 gap-2" key={index}>
                    <h1>{chat}</h1>
                    <button
                      onClick={() => removeTag(chat)}
                      className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
                    >
                      Delete
                    </button>
                  </div>

              ))
            }
        </div>
      </div>
      <button
        onClick={handleUpload}
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      >
        Upload
      </button>

      <hr/>
      {process.env.NODE_ENV === 'development' && (
        <div className="p-4 my-4 bg-yellow-900 border-2 border-yellow-500 rounded-lg">
          <h3 className="text-xl font-bold text-yellow-400">🚧 Development Only:Upload For Developers Random Customers 🚧</h3>
          <p className="text-yellow-300">This feature is for testing and will not be in the final product.</p>
          {/* You can put any component or button here. For example: */}
          <input 
              type="number" 
              value={isCustomerCount} 
              onChange={(e) => handleFeatureLimitChange(e.target.value)}
              className="w-32 bg-gray-600 rounded-md p-2 font-semibold disabled:bg-gray-800 disabled:cursor-not-allowed"
              placeholder='0'
          />
          <button
            onClick={(e) => handleTestUpload(e)} 
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Upload Test
          </button>
        </div>
      )}
    </div>
  );
};

export default BulkCustomerUpload;