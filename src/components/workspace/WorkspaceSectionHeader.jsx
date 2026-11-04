import React from 'react';
import './Workspace.css';

export default function WorkspaceSectionHeader({ title, subtitle, icon: Icon, actions, headingId }) {
    return (
        <div className="workspace-section-header">
            <div className="workspace-section-heading">
                {Icon && <Icon className="workspace-section-icon" aria-hidden="true" />}
                <div className="min-w-0">
                    <h2 id={headingId} className="workspace-section-title">{title}</h2>
                    {subtitle && <p className="workspace-section-subtitle">{subtitle}</p>}
                </div>
            </div>
            {actions && <div className="workspace-section-actions">{actions}</div>}
        </div>
    );
}
