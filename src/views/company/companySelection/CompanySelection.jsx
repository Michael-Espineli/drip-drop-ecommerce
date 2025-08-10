
import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';

const CompanySelection = () => {

    return (
        <div className='flex justify-center px-2 md:px-7 py-5'>
            <div className="">
                <div className="flex justify-center">
                    <h2 className="text-5xl">Company Selection Page</h2>
                </div>
                <div className="flex justify-center p-5">
                    <h2>Please Forgive the Work In Progress </h2>
                </div>
                    <img className="h-auto max-w-xl rounded-lg shadow-xl dark:shadow-gray-800" src="/constructionDuck.png" alt="Foreman"></img>
            </div>
        </div>
    );
}

export default CompanySelection;
