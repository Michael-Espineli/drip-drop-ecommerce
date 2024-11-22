import React from 'react';
import { useParams } from 'react-router-dom';

const EquipmentDetailView = () => {
    const {equipmentId} = useParams();

    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                <h1 className='font-bold'>EquipmentDetailView</h1>
                <h1>{equipmentId}</h1>
                <h1>Main Pump</h1>
                <h1>Pump</h1>
                <h1>Operational</h1>
                <h1>5-10 Years</h1>
                <h1>$2,800</h1>
                <h1>No</h1>

            </div>
        </div>

    );
};

export default EquipmentDetailView;