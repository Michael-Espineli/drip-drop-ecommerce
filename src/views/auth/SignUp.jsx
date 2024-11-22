import React, {useState} from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../utils/config';

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
        </div>
    );
};

export default SignUp;