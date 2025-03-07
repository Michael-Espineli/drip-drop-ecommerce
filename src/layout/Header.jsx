import React, { useContext } from "react";
import { FaList } from 'react-icons/fa'
import { Link } from 'react-router-dom';
import { Context } from "../context/AuthContext";

const Header = ({showSidebar, setShowSidebar}) => {
    const {name, accountType, photoUrl,recentlySelectedCompanyName} = useContext(Context);

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
        <div className='fixed top-0 left-0 w-full py-5 px-2 lg:px-1.69 z-40'>
            <div className='ml-0 lg:ml-[260px] rounded-md h-[65px] flex justify-between items-center bg-[#030811] px-5 transition-all'>
                {/* Hamburger */}
                <div onClick={() => setShowSidebar(!showSidebar)} className='w-[35px] flex lg:hidden h-[35px] rounded-sm bg-[#454b39] text-[#ffffff]
                shadow-lg hover:shadow-[#454b39] justify-center items-center cursor-pointer'>
                    <span><FaList/> </span>
                </div>
                {/* Search Input */}
                <div className='hidden md:block'>
                    <input className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                    text-[#ededed] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Search'  />
                </div>
                {/*  */}
                <div className='flex justify-center items-center gap-8 relative' >
                    <div className=''>
                    {/* <div className='flex justify-center items-center'> */}

                        <Link to='/company/profile' className="w-[180px] h-[50px]">
                            <div className='flex justify-center item-center gap-3'>
                                <div className='flex justify-center items-center flex-col text-end text-[#ededed]'>
                                    <h2 className='text-md font-bold line-clamp-1'>{name} - {accountType}</h2>
                                    <span className='text-[14px] w-full font-normal'>{recentlySelectedCompanyName}</span>
                                </div>
                                {/* Profile Image */}
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