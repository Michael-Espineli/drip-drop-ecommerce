import React from 'react';
import './Workspace.css';

/** Profile's identity hierarchy, with Jobs-style actions on their own surface. */
export default function WorkspaceHeader({ title, eyebrow, description, meta, actions, titleAccessory, className = '' }) {
    return (
        <header className={`workspace-header ${actions ? 'workspace-header-has-actions' : ''} ${className}`}>
            <div className="workspace-header-identity">
                {eyebrow && <p className="workspace-header-eyebrow">{eyebrow}</p>}
                <div className="workspace-header-title-row">
                    <h1 className="workspace-header-title">{title}</h1>
                    {titleAccessory}
                </div>
                {description && <p className="workspace-header-description">{description}</p>}
                {meta && <div className="workspace-header-meta">{meta}</div>}
            </div>
            {actions && <div className="workspace-header-actions">{actions}</div>}
        </header>
    );
}
