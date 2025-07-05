import React, {useState} from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../utils/config';
import { Link, useLocation, Navigate } from 'react-router-dom';

const SignUp = () => {
    const [email, setEmail] = useState();
    const [password, setPassword] = useState();
    const [inviteCode, setInviteCode] = useState();
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
        <div>
            <div className='px-2 md:px-7 py-5 blue-bg white-fg'>
                <div className='w-full h-full '>
                    <Link to='/'>
                        <h2 className='w-[300px] px-[20px] font-bold text-4xl line-clamp-1'>
                            Drip Drop
                        </h2>
                    </Link>
                </div>
            </div>
            <div className='login-form pt-10 black-fg'>
                <div className=''>
                    <div className='w-full'>
                        <div className='p-2 font-bold'>
                            <h1>Company Sign Up Page</h1>
                        </div>            
                        <form>
                            <div className='left-0 w-full justify-between gap-3 text-[#000000]'>
                                <div className='p-2'>
                                    <input onChange={(e) => {setEmail(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Email'></input>
                                </div>
                                <div className='p-2'>
                                    <input onChange={(e) => {setPassword(e.target.value)}} className='w-full p-2 rounded-md' type="text"placeholder='Password'></input>
                                </div>
                                <div className='p-2 blue-bg white-fg rounded-md'>
                                    <button onClick={(e) => handleSignUp(e)} >Sign up</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
                <Link to='/signIn' className={`  px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover: transition-all w-full mb-1 underline`}>
                    <span>
                        Already have an Account? Sign In Here
                    </span>
                </Link>
            </div>
        </div>
    );
};

export default SignUp;