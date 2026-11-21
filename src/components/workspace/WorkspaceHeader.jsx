import React from 'react';
import { Link } from 'react-router-dom';
import './Workspace.css';

/** Profile's identity hierarchy, with Jobs-style actions on their own surface. */
export default function WorkspaceHeader({ title, eyebrow, description, meta, actions, titleAccessory, backLink, className = '' }) {
    const eyebrowLabel = eyebrow && <p className="workspace-header-eyebrow">{eyebrow}</p>;

    return (
        <header className={`workspace-header ${actions ? 'workspace-header-has-actions' : ''} ${className}`}>
            <div className="workspace-header-identity">
                {backLink ? (
                    <div className="workspace-header-navigation">
                        <Link to={backLink.to} className="workspace-header-back">
                            <span aria-hidden="true">&larr;</span>
                            {backLink.label}
                        </Link>
                        {eyebrowLabel}
                    </div>
                ) : eyebrowLabel}
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
