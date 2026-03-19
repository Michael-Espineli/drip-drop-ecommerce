import React from 'react';
import { FaStar, FaStarHalfAlt, FaRegStar, FaCheckCircle } from 'react-icons/fa';

const Header = ({ companyData, editMode, setEditMode, handleSave, handleCancel, handleChange }) => {
    return (
        <div>
            <div className="w-full h-64 bg-cover bg-center" style={{ backgroundImage: `url('https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/IMG_1008%20copy.JPG?alt=media&token=2fff1e2b-f034-4a6f-931b-3f8daf949c6e')` }}></div>
            <div className="w-full max-w-6xl mx-auto px-8">
                <div className="flex items-end gap-8">
                    <div className="w-40 h-40 rounded-full overflow-hidden border-4 border-white shadow-lg -mt-16 bg-white">
                        <img className="w-full h-full object-cover" src={companyData.photoUrl || 'https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/duck128.jpg?alt=media&token=549d29cd-0565-4fa4-a682-3e0816cd2fdb'} alt="profile" />
                    </div>
                    <div className="flex-grow pb-4">
                        {editMode ? (
                            <div className='flex justify-between items-center'>
                                <input type="text" name="name" value={companyData.name} onChange={handleChange} className='text-4xl font-bold text-gray-800 bg-transparent border-b-2 border-gray-300 focus:outline-none focus:border-blue-500'/>
                                <div className="flex gap-2">
                                    <button onClick={handleSave} className='bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg'>Save</button>
                                    <button onClick={handleCancel} className='bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg'>Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <div className='flex justify-between items-center'>
                                <h1 className='text-4xl font-bold text-gray-800'>{companyData.name}</h1>
                                { setEditMode && <button onClick={() => setEditMode(true)} className='bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg'>Edit</button>  }
                            </div>
                        )}
                        <div className='flex items-center gap-4 mt-2'>
                            <div className="flex items-center text-yellow-500">
                                <FaStar /><FaStar /><FaStar /><FaStarHalfAlt /><FaRegStar />
                                <p className='ml-2 text-gray-600'>(14 Reviews)</p>
                            </div>
                            { companyData.verified && <div className='flex items-center gap-2 text-green-500 font-semibold'><FaCheckCircle /><span>Verified</span></div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Header;
