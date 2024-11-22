import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";

export default function Home() {
    return (
        <div className='px-2 md:px-7 py-5'>
            <h2>Home Page</h2>
        </div>
    );
}