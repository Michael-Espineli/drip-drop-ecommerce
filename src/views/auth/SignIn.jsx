import React, {useState} from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
// import { auth } from '../../utils/config';
import { getAuth } from "firebase/auth";
import { useNavigate } from 'react-router-dom';
const SignIn = () => {
    const [email, setEmail] = useState();
    const [password, setPassword] = useState();
    const auth = getAuth()
    const navigate = useNavigate()
    async function handleSignUp(e) {
        e.preventDefault()
        signInWithEmailAndPassword(auth,email,password)
        .then((user) => {
            navigate('/company/dashboard')
        })
        .catch((error) => {
            console.log(error)
        })
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
        <div className='px-2 md:px-7 py-5 bg-[#454b39] text-[#ffffff] font-bold'>
            <div className='w-full h-full '>
                <div className='p-2'>
                    <h1>Sign In Page</h1>
                </div>
                <form>
                    <div className='left-0 w-full justify-between gap-3 text-[#000000]'>
                        <div className='p-2'>
                            <input onChange={(e) => {setEmail(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Email'></input>
                        </div>
                        <div className='p-2'>
                            <input onChange={(e) => {setPassword(e.target.value)}} className='w-full p-2 rounded-md' type="password" placeholder='Password'></input>
                        </div>
                        <div className='p-2'>
                            <button onClick={(e) => handleSignUp(e)} >Sign In</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};


export default SignIn;