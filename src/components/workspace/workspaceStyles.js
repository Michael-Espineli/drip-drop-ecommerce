import './Workspace.css';

// Matches the compact outlined controls on company/jobs/operations.
export const workspaceButtonClass = ({ tone = 'blue', active = false, className = '' } = {}) => (
    ['workspace-button', `workspace-tone-${tone}`, active && 'workspace-button-active', className]
        .filter(Boolean).join(' ')
);

export const workspaceSelectStyles = (overrides = {}) => {
    const merge = (key, styles) => (provided, state) => ({
        ...provided,
        ...(typeof overrides[key] === 'function' ? overrides[key](provided, state) : {}),
        ...styles(state),
    });
    return {
        ...overrides,
        control: merge('control', state => ({ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', borderColor: state.isFocused ? 'var(--workspace-blue-active)' : 'var(--color-border-strong)', borderRadius: 'var(--app-control-radius)', minHeight: 'max(44px, 2.75rem)' })),
        menu: merge('menu', () => ({ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--app-control-radius)' })),
        option: merge('option', state => ({ backgroundColor: state.isSelected ? 'var(--workspace-blue-hover)' : state.isFocused ? 'var(--workspace-blue-bg)' : 'var(--color-surface)', color: state.isDisabled ? 'var(--color-text-subtle)' : 'var(--color-text)', cursor: state.isDisabled ? 'not-allowed' : 'pointer' })),
        singleValue: merge('singleValue', () => ({ color: 'var(--color-text)' })),
        input: merge('input', () => ({ color: 'var(--color-text)' })),
        placeholder: merge('placeholder', () => ({ color: 'var(--color-text-subtle)' })),
        multiValue: merge('multiValue', () => ({ backgroundColor: 'var(--workspace-blue-bg)' })),
        multiValueLabel: merge('multiValueLabel', () => ({ color: 'var(--workspace-blue-text)' })),
    };
};
