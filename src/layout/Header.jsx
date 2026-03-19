import React, { useContext } from "react";
import { Link } from 'react-router-dom';
import { Context } from "../context/AuthContext";
 
const Header = ({showSidebar, setShowSidebar}) => {
    const { name, accountType, photoUrl, recentlySelectedCompanyName } = useContext(Context);

    // Do not render the header for Admin or if the account type is not set
    if (accountType === 'Admin' || !accountType) {
        return  (     
            <div onClick={() => setShowSidebar(!showSidebar)} className='w-[35px] flex lg:hidden h-[35px] rounded-sm border border-slate-400 text-white justify-center items-center cursor-pointer hover:bg-blue-500'>
                <span>三</span>
            </div>
        )      
    }

    const profileLink = accountType === 'Company' ? '/company/profile' : '/client/profile';
    // const profileLink = '/company/profile' 
    return (
        <div className='fixed top-0 left-0 w-full py-5 px-2 lg:px-1.69 z-40'>
            <div className='ml-0 lg:ml-[260px] rounded-md h-[65px] flex justify-between items-center bg-[#0e245c] px-5 transition-all'>
                {/* Hamburger Icon */}
                <div onClick={() => setShowSidebar(!showSidebar)} className='w-[35px] flex lg:hidden h-[35px] rounded-sm border border-slate-400 text-white justify-center items-center cursor-pointer hover:bg-blue-500'>
                    <span>三</span>
                </div>
                
                {/* Search Input */}
                <div className='hidden md:block'>
                    <input 
                        className="px-3 py-2 outline-none border-none bg-slate-700 rounded-md text-white focus:ring-2 focus:ring-blue-500"
                        type="text" 
                        name='search' 
                        placeholder='Search' 
                    />
                </div>

                {/* Profile Section */}
                <div className='flex justify-center items-center gap-8 relative'>
                    <div>
                        <Link to={profileLink} className="w-auto h-[50px]">
                            <div className='flex justify-center items-center gap-3'>
                                <div className='flex justify-center items-center flex-col text-end text-white'>
                                    <h2 className='text-md font-bold line-clamp-1'>
                                        {accountType === 'Company' ? `${name} - ${accountType}` : name}
                                    </h2>
                                    {accountType === 'Company' && recentlySelectedCompanyName && (
                                        <span className='text-[14px] w-full font-normal'>{recentlySelectedCompanyName}</span>
                                    )}
                                </div>
                                <img className='w-[45px] h-[45px] rounded-full bg-white' src={photoUrl} alt="profile" />
                            </div>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Header;
