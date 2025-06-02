
import React, { useState } from "react";

const WorkInProgress = () => {

    return (
        <div className='flex justify-center px-2 md:px-7 py-5'>
            <div className="">
                <div className="flex justify-center">
                    <h2 className="text-5xl">Under Construction</h2>
                </div>
                <div className="flex justify-center p-5">
                    <h2>Please Forgive the Work In Progress </h2>
                </div>
                    <img className="h-auto max-w-xl rounded-lg shadow-xl dark:shadow-gray-800" src="/constructionDuck.png" alt="Foreman"></img>
            </div>
        </div>
    );//Layla Jenner
}

export default WorkInProgress;
