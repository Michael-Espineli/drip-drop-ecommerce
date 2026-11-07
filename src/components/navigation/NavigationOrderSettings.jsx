import React, { useState } from 'react';
import { workspaceButtonClass } from '../workspace/workspaceStyles';
import NavigationOrderDialog from './NavigationOrderDialog';

const NavigationOrderSettings = () => {
    const [isEditorOpen, setIsEditorOpen] = useState(false);

    return (
        <section className="mb-10 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-800">Navigation Order</h2>
                    <p className="mt-1 text-sm text-gray-500">
                        Set your personal sidebar order, choose Book Marks, and move less-used links into All the rest.
                    </p>
                </div>
                <button type="button" onClick={() => setIsEditorOpen(true)} className={workspaceButtonClass({ tone: 'blue' })}>
                    Edit Order
                </button>
            </div>
            {isEditorOpen && <NavigationOrderDialog onClose={() => setIsEditorOpen(false)} />}
        </section>
    );
};

export default NavigationOrderSettings;
