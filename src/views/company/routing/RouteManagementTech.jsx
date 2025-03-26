import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, getCountFromServer, startAt, where, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DatePicker from "react-datepicker";
import { format } from 'date-fns'; 

const RouteManagementDay = ({day, tech, techId}) => {

    const {name,recentlySelectedCompany} = useContext(Context);
            
    const [recurringRoute, setRecurringRoute] = useState({
        id : "",
        tech : "",
        techId : "",
        day: "",
        order : [],
        workerType : "",
        description : "",
    });

    useEffect(() => {
        (async () => {
            try{
                //Checks to see if any recurring routes exist
                let recurringRouteQuery = query(collection(db, 'companies',recentlySelectedCompany,'recurringRoute'), where("techId", "==", techId), where("day", "==", day),limit(1)); 
                const recurringRouteSnapShot = await getDocs(recurringRouteQuery);     

                let workingRecurringRouteList = []      

                recurringRouteSnapShot.forEach((doc) => {
                    const recurringRouteData = doc.data()
                    const recurringRoute = {
                        id: recurringRouteData.id,
                        tech: recurringRouteData.tech,
                        techId: recurringRouteData.techId,
                        order: recurringRouteData.order,
                        day: day,
                        workerType: recurringRouteData.workerType,
                        description: recurringRouteData.description
                    }
                    workingRecurringRouteList.push(recurringRoute)
                });

                //There probable is going to be a bug here when I create the ability to modify recurring routes. 

                //Checks to see if there was any recurring Route Found
                if (workingRecurringRouteList.length > 0 ){

                    let recurringRoute = workingRecurringRouteList[0]
                    //Verify that the amount of recurring service stops on that day for that technician == the amount of order objects are the same. 

                    //if they are the same, do nothing
                    //
                } else {

                    console.log('No Recurring Routes Found')

                    //Check to see if any recurring Service stops 

                    const recurringServiceStopQuery = query(collection(db, "companies",recentlySelectedCompany,'recurringServiceStop'), where("techId", "==", techId), where("daysOfWeek", "==", day));
                    const snapshot = await getCountFromServer(recurringServiceStopQuery);
                    console.log('count: ', snapshot.data().count);
                    if (snapshot.data().count > 0 ){
                        //Recurring Service Stops Found. 

                        //Create New Recurring Route with recurring Service stops
                        let workingRecurringServiceStopList = []
                        const recurringServiceStopsSnapShot = await getDocs(recurringServiceStopQuery);     
                        recurringServiceStopsSnapShot.forEach((doc) => {
                            const rssData = doc.data()
                            const recurringServiceStop = {
                                id:rssData.id,
                                internalId : rssData.internalId,
                                type:rssData.type,
                                typeId:rssData.typeId,
                                typeImage: rssData.typeImage,
                                customerId:rssData.customerId,
                                customerName: rssData.customerName,
        
                                streetAddress:rssData.address.streetAddress,
                                city:rssData.address.city,
                                state:rssData.address.state,
                                zip:rssData.address.zip,
                                latitude:rssData.address.latitude,
                                longitude:rssData.address.longitude,
        
                                tech:rssData.tech,
                                techId:rssData.techId,
                                dateCreated:rssData.dateCreated,
                                startDate:rssData.startDate,
                                endDate:rssData.endDate,
                                noEndDate:rssData.noEndDate,
                                frequency:rssData.frequency,
                                daysOfWeek:rssData.daysOfWeek,
                                lastCreated:rssData.lastCreated,
        
                                serviceLocationId:rssData.serviceLocationId,
                                estimatedTime:rssData.estimatedTime,
                                otherCompany:rssData.otherCompany,
                                laborContractId:rssData.laborContractId,
                                contractedCompanyId:rssData.contractedCompanyId
                            }
                            workingRecurringServiceStopList.push(recurringServiceStop)
                        });

                        //Create Recurring Route 
                        let id = "RR" + uuidv4()
                        let order = []
                        order.push({
                            name:'Hi'
                        })
                        let description = ""
                        const newRecurringRoute = {
                            id: id,
                            tech: tech,
                            techId: techId,
                            day: day,
                            order: order,
                            description: description
                        }

                        //update Current 
                        setRecurringRoute(newRecurringRoute)
                        //Upload Recurring Route
                    } else {
                        console.log('No Recurring Service Stops Found')
                    }
                }

            } catch(error){
                console.log('Error')
            }
        })();
    },[])

    return (
        <>
            {
                (recurringRoute.order.length!=0)&&<div>
                    <div className='px-2 md:px-7 py-5'>

                        <h1>{tech.userName}</h1>
                            <hr/>
                            <h1>{recurringRoute.id}</h1>
                            <div className="px-4">
                                {
                                    recurringRoute.order?.map(rr => (
                                        <h1>
                                            {rr.customerName}
                                        </h1>
                                    ))
                                }
                        </div>      
                    </div>
                </div>
            }  
        </>  
    );
};

export default RouteManagementDay;