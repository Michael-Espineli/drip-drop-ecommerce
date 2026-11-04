// Matches the compact outlined controls on company/jobs/operations.
export const workspaceButtonClass = ({ tone = 'blue', active = false, className = '' } = {}) => (
    ['workspace-button', `workspace-tone-${tone}`, active && 'workspace-button-active', className]
        .filter(Boolean).join(' ')
);
