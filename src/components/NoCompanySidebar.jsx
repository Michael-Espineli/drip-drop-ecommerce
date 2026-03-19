import React, { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HomeIcon, ArrowLeftOnRectangleIcon, ChatBubbleBottomCenterTextIcon, InboxStackIcon, BuildingOffice2Icon, ChevronDownIcon, ChevronRightIcon, UserPlusIcon, MagnifyingGlassIcon, ClipboardDocumentListIcon, BookmarkIcon } from '@heroicons/react/24/outline';
import { Context } from '../context/AuthContext';
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";

const NoCompanySidebar = ({ showSidebar, setShowSidebar }) => {
    const auth = getAuth();
    const { handleLogout } = useContext(Context);
    const navigate = useNavigate();
    const [invitesOpen, setInvitesOpen] = useState(false);

    const logout = async () => {
        try {
          await signOut(auth);
          console.log("User signed out successfully");
          // You can add further logic here, like redirecting the user
        } catch (error) {
          console.error("Logout failed:", error.message);
        }
      };

    const toggleInvites = () => {
        setInvitesOpen(!invitesOpen);
    };

    return (
        <div>
            {/* Overlay for mobile view */}
            <div onClick={() => setShowSidebar(false)} className={`fixed duration-200 lg:hidden ${showSidebar ? 'w-screen h-screen bg-[#8a8a8a6c] top-0 left-0 z-10' : 'w-0'}`}></div>

            {/* Sidebar */}
            <div className={`w-[260px] fixed bg-white z-50 top-0 h-screen shadow-[0_0_15px_0_rgb(0,0,0,0.4)] transition-all ${showSidebar ? 'left-0' : '-left-[260px] lg:left-0'}`}>
                <div className='flex flex-col h-full'>
                    {/* Header */}
                    <div className='h-[95px] flex justify-center items-center border-b border-b-slate-200 shrink-0'>
                        <Link to='/company/dashboard' className='text-gray-800 font-bold text-3xl'>
                            Drip Drop
                        </Link>
                    </div>
                    
                    {/* Navigation */}
                    <nav className='px-4 pt-5 text-gray-700 flex-grow overflow-y-auto'>
                        {/* Home */}
                        <Link to="/company/dashboard" className="w-full px-3 py-2 rounded-md flex justify-start items-center gap-3 hover:bg-gray-100 transition-all font-medium">
                            <HomeIcon className="w-6 h-6 text-gray-500" />
                            <span>Home</span>
                        </Link>
                        {/* Chats */}
                        <Link to="/companies-chat" className="w-full px-3 py-2 mt-2 rounded-md flex justify-start items-center gap-3 hover:bg-gray-100 transition-all font-medium">
                            <ChatBubbleBottomCenterTextIcon className="w-6 h-6 text-gray-500" />
                            <span>Chats</span>
                        </Link>

                        {/* Invites Dropdown */}
                        <div className="mt-2">
                            <button onClick={toggleInvites} className="w-full px-3 py-2 rounded-md flex justify-between items-center gap-3 hover:bg-gray-100 transition-all font-medium">
                                <div className="flex items-center gap-3">
                                    <InboxStackIcon className="w-6 h-6 text-gray-500" />
                                    <span>Invites</span>
                                </div>
                                {invitesOpen ? <ChevronDownIcon className="w-5 h-5" /> : <ChevronRightIcon className="w-5 h-5" />}
                            </button>
                            {invitesOpen && (
                                <div className="pl-8 mt-1 space-y-1">
                                    <Link to="/invites/pending" className="block px-3 py-1.5 rounded-md text-sm hover:bg-gray-100">Pending</Link>
                                    <Link to="/invites/accepted" className="block px-3 py-1.5 rounded-md text-sm hover:bg-gray-100">Accepted</Link>
                                    <Link to="/invites/rejected" className="block px-3 py-1.5 rounded-md text-sm hover:bg-gray-100">Rejected</Link>
                                </div>
                            )}
                        </div>

                        {/* Company & Job Actions */}
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <Link to="/browse-companies" className="w-full px-3 py-2 rounded-md flex justify-start items-center gap-3 hover:bg-gray-100 transition-all font-medium">
                                <MagnifyingGlassIcon className="w-6 h-6 text-gray-500" />
                                <span>Browse Companies</span>
                            </Link>
                            <Link to="/saved-companies" className="w-full px-3 py-2 mt-2 rounded-md flex justify-start items-center gap-3 hover:bg-gray-100 transition-all font-medium">
                                <BookmarkIcon className="w-6 h-6 text-gray-500" />
                                <span>Saved Companies</span>
                            </Link>
                            {/* Update 4.1 Marketing */}
                             {/* <Link to="/job-postings" className="w-full px-3 py-2 mt-2 rounded-md flex justify-start items-center gap-3 hover:bg-gray-100 transition-all font-medium">
                                <ClipboardDocumentListIcon className="w-6 h-6 text-gray-500" />
                                <span>Job Postings</span>
                            </Link> */}
                            <Link to="/company/selection" className="w-full px-3 py-2 mt-2 rounded-md flex justify-start items-center gap-3 hover:bg-gray-100 transition-all font-medium">
                                <BuildingOffice2Icon className="w-6 h-6 text-gray-500" />
                                <span>Select Company</span>
                            </Link>
                        </div>
                    </nav>

                    {/* Logout */}
                    <div className="p-4 border-t border-t-slate-200 shrink-0">
                        <button onClick={logout} className="w-full flex items-center px-4 py-3 text-left text-red-500 hover:bg-red-50 rounded-lg font-medium">
                            <ArrowLeftOnRectangleIcon className="w-6 h-6 mr-3" />
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NoCompanySidebar;
