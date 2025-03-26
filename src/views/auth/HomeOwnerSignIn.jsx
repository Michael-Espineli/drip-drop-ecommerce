import React, {useState} from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
// import { auth } from '../../utils/config';
import { getAuth } from "firebase/auth";
import { useNavigate } from 'react-router-dom';
import { Link, useLocation, Navigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';

const HomeOwnerSignIn = () => {
    const [email, setEmail] = useState();
    const [password, setPassword] = useState();
    const auth = getAuth()
    const navigate = useNavigate()
    async function handleSignUp(e) {
        e.preventDefault()

        //Guard Statements
        if (email=="" && password == "") {
            toast.error('Please Fill Out Form')
        }else if (email=="") {
            toast.error('Email Field Blank')
        } else if (password =="") {
            toast.error('Password Field Blank')
        } else {
            signInWithEmailAndPassword(auth,email,password)
            .then((user) => {
                navigate('/company/dashboard')
            })
            .catch((error) => {
                switch (error) {
                    case "FirebaseError: Firebase: Error (auth/invalid-credential).":
                        toast.error('Failed to login: Invalid Credentials')
                    default:
                        toast.error('Failed to login: Invalid Credentials') 
                }
               
                console.log(error)
            })
        }
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
        <div className='px-2 md:px-7 py-5 bg-[#0e245c] text-[#ffffff] font-bold'>
            <div className='w-full h-full '>
                <Link to='/' className={`px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:pl-4 transition-all w-full mb-1 font-bold`}>
                    Home
                </Link>
                <div className='p-2'>
                    <h1>Home Owner Sign In Page</h1>
                </div>
                <form>
                    <div className='left-0 w-full justify-between gap-3 text-[#000000]'>
                        <div className='p-2'>
                            <input onChange={(e) => {setEmail(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Email'></input>
                        </div>
                        <div className='p-2'>
                            <input onChange={(e) => {setPassword(e.target.value)}} className='w-full p-2 rounded-md' type="password" placeholder='Password'></input>
                        </div>
                        <div className='p-2  text-[#cfcfcf]'>
                            <button onClick={(e) => handleSignUp(e)} >Sign In</button>
                        </div>
                    </div>
                </form>
                <Link to='/homeOwnerSignUp' className={` text-[#cfcfcf] px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:text-[#de3c6d] transition-all w-full mb-1 underline`}>
                    <span>
                        Don't have an account? Sign up here.
                    </span>
                </Link>
            </div>
        </div>
    );
};


export default HomeOwnerSignIn;