import React, { useEffect, useState, useContext } from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import { getNav } from '../navigation/index';
import { RiLogoutBoxLine } from 'react-icons/ri'
import { signOut, getAuth } from 'firebase/auth';
import { Context } from "../context/AuthContext";

const Sidebar = ({showSidebar,setShowSidebar}) => {
    const {name, accountType, photoUrl} = useContext(Context);

    const auth = getAuth()
    const {pathname} = useLocation()
    const [allNav,setAllNav] = useState([])
    const role = accountType //'Client'
    const categories=['Physical Locations','Routing','Users','Operations','Monies','Stripe','NA'];
    const [selectedCategory,setSelectedCategory] = useState('Physical Locations')

    useEffect(() => {

        const navs = getNav(role)
        setAllNav(navs)
    },[role])

    async function handleSignOut () {
        try {
            await signOut(auth)
        } catch (error) {
            
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
        <div>
            <div onClick={() => setShowSidebar(false)} className={`fixed duration-200 ${!showSidebar ? 'invisible' : 'visible'} w-screen h-screen bg-[#000000] top-0 left-0 z-10`}>
            </div>
            <div className={`w-[260px] fixed bg-[#747e79] z-50 top-0 h-screen shadow-[0_0_15px_0rgb(34_41_47_/_5%)] transition-all ${showSidebar ? 'left-0' : '-left-[260px] lg:left-0'}`}>
                <div className='h-[70px] flex justify-center items-center'>
                    <Link to='/' className="w-[180px] h-[50px]">
                    <h1 className='text-4xl font-serif font-family:Times New Roman'>Drip Drop </h1> {/* Drip Drop Logo */}
                    </Link>
                </div>
                <hr className='bg-[#030811]'/>
                <div className='px-[16px]'>
                    <ul>
                        {
                            categories.map((category,i) =>
                                <div key={i}>
                                    {
                                        //  Categorized

                                    (category!=='NA')&&
                                    <div>
                                        <li>
                                            <button 
                                            onClick={(e)=>(setSelectedCategory(category))}
                                            ><span className='font-bold'>{category}</span></button>
                                        </li>
                                        {
                                            (selectedCategory===category)&&
                                            <div>
                                                {
                                                    allNav.map((nn,ii) => <div>
                                                        {
                                                        (nn.category===category)&&<li key={ii}>
                                                        
                                                        <Link to={nn.path} className={`${pathname === nn.path ? 'bg-[#1D2E76] shadow-indigo-500/50 text-[#ffffff] duration-500' : 'bg-[#454b39] text-[#000000] font-bold duration-200'} px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:pl-4 transition-all w-full mb-1`}>
                                                            <span>{nn.icon}</span>
                                                            <span>{nn.title}</span>
                                                        </Link>
                                                    </li>
                                                        }
                                                    </div>
                                                    )
                                                }
                                            </div>
                                        }
                                        
                                    </div>
                                    
                                    }
                                    {/* un Categorized */}
                                     {
                                    (category==='NA')&&
                                    <div>
                                     
                                        <hr/>
                                        {
                                            allNav.map((n,i) => <div>
                                                {
                                                (n.category==='NA')&&<li key={i}>
                                                
                                                <Link to={n.path} className={`${pathname === n.path ? 'bg-[#1D2E76] shadow-indigo-500/50 text-[#ffffff] duration-500' : 'text-[#000000] font-bold duration-200'} px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:pl-4 transition-all w-full mb-1`}>
                                                    <span>{n.icon}</span>
                                                    <span>{n.title}</span>
                                                </Link>
                                            </li>
                                                }
                                            </div>
                                            )
                                        }
                                        </div>
                                    }
                                </div>
                            )
                        }
                        {/* {
                            allNav.map((n,i) => <li key={i}>
                                <Link to={n.path} className={`${pathname === n.path ? 'bg-[#536546] shadow-indigo-500/50 text-[#ffffff] duration-500' : 'text-[#000000] font-bold duration-200'} px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:pl-4 transition-all w-full mb-1`}>
                                    <span>{n.icon}</span>
                                    <span>{n.title}</span>
                                </Link>
                            </li>)
                        } */}
                        <li>
                            <button onClick={() => {handleSignOut()}}className='text-[#000000] font-bold duration-200 px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:pl-4 transition-all w-full mb-1'>
                                <span> <RiLogoutBoxLine/> </span>
                                <span>Logout</span>
                            </button>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;