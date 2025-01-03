import React, {useState} from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../utils/config';
import { Link, useLocation, Navigate } from 'react-router-dom';

const SignUp = () => {
    const [email, setEmail] = useState();
    const [password, setPassword] = useState();
    async function handleSignUp(e) {
        e.preventDefault()

        createUserWithEmailAndPassword(auth,email,password)
        .then((user) => {
            console.log(user)
        })
        .catch((error) => {
            console.log(error)
        })
    }
    return (
        <div>
            <h1>Sign Up Page</h1>

            <form>
                <input onChange={(e) => {setEmail(e.target.value)}} type="text" placeholder='Email'></input>
                <input onChange={(e) => {setPassword(e.target.value)}} type="text"placeholder='Password'></input>
                <button onClick={(e) => handleSignUp(e)} >Sign up</button>
            </form>
            <Link to='/signIn' className={`px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:pl-4 transition-all w-full mb-1`}>
            <span>Sign In</span>
            </Link>
        </div>
    );
};

export default SignUp;