import React from 'react';
import WorkspaceHeader from './WorkspaceHeader';

// Retain record-specific menus, selectors and permission conditions on the control surface.
export default function WorkspaceRecordHeader({ title, eyebrow, description, children, className = '' }) {
    return <WorkspaceHeader title={title} eyebrow={eyebrow} description={description} className={className}
        actions={children && <div className="workspace-record-controls">{children}</div>} />;
}
