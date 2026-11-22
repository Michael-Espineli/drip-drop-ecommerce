import React from "react";
import { Link } from "react-router-dom";
import WorkspaceHeader from "../../../components/workspace/WorkspaceHeader";
import WorkspaceSectionHeader from "../../../components/workspace/WorkspaceSectionHeader";
import { workspaceButtonClass, workspaceSelectStyles } from "../../../components/workspace/workspaceStyles";
import "./JobCreateLayout.css";

const jobsPath = "/company/jobs";

export const jobCreateSelectStyles = workspaceSelectStyles({
    control: (base, state) => ({
        ...base,
        boxShadow: state.isFocused ? "0 0 0 1px var(--workspace-blue-active)" : "none",
        "&:hover": { borderColor: "var(--workspace-blue-active)" },
    }),
    menu: (base) => ({ ...base, zIndex: 40 }),
});

export function JobCreateHeader({ title, description, closeAction }) {
    return <WorkspaceHeader
        title={title}
        description={description}
        eyebrow="Company operations"
        backLink={closeAction ? undefined : { to: jobsPath, label: "Back to Jobs" }}
        titleAccessory={closeAction}
        className={closeAction ? "job-create-dialog-header" : undefined}
    />;
}

export function JobCreateCard({ title, subtitle, icon, action, children }) {
    return (
        <section className="job-create-card">
            <WorkspaceSectionHeader title={title} subtitle={subtitle} icon={icon} actions={action} />
            <div className="job-create-card-body">{children}</div>
        </section>
    );
}

export function JobCreateSummaryRow({ label, value, valueClassName = "" }) {
    return (
        <div className="job-create-summary-row">
            <dt>{label}</dt>
            <dd className={valueClassName}>{value || "Not set"}</dd>
        </div>
    );
}

export function JobCreateActions({ label, onSubmit, disabled, submitUnavailable, onCancel, cancelDisabled }) {
    const cancelClassName = workspaceButtonClass({ tone: "slate" });
    return (
        <div className="job-create-actions">
            {onCancel ? (
                <button type="button" onClick={onCancel} disabled={cancelDisabled} className={cancelClassName}>Cancel</button>
            ) : (
                <Link to={jobsPath} className={cancelClassName}>Cancel</Link>
            )}
            <button type="button" onClick={onSubmit} disabled={disabled} aria-disabled={submitUnavailable} className={workspaceButtonClass()}>
                {label}
            </button>
        </div>
    );
}
