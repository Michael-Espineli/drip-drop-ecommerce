import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaExclamationTriangle, FaInfoCircle, FaKeyboard, FaTrash } from 'react-icons/fa';
import { clearAppDialogOpener, setAppDialogOpener } from '../utils/appDialog';

const dialogIcon = {
  alert: FaInfoCircle,
  confirm: FaExclamationTriangle,
  prompt: FaKeyboard,
  danger: FaTrash,
};

const defaultTitleForType = {
  alert: 'Notice',
  confirm: 'Confirm Action',
  prompt: 'Confirm Action',
};

const AppDialog = ({ dialog, onCancel, onConfirm, promptValue, setPromptValue }) => {
  const type = dialog.type || 'alert';
  const isAlert = type === 'alert';
  const isPrompt = type === 'prompt';
  const isDanger = dialog.variant === 'danger' || dialog.destructive === true;
  const Icon = isDanger ? dialogIcon.danger : dialogIcon[type] || dialogIcon.alert;
  const title = dialog.title || defaultTitleForType[type] || 'Notice';
  const message = dialog.message || '';
  const confirmLabel = dialog.confirmLabel || (isAlert ? 'OK' : isDanger ? 'Delete' : 'Confirm');
  const cancelLabel = dialog.cancelLabel || 'Cancel';
  const requiredText = dialog.requireText || dialog.expectedText || '';
  const requirementLabel = dialog.requirementLabel || `Type ${requiredText} to confirm`;
  const normalizedPromptValue = promptValue.trim();
  const typedConfirmationValid = !requiredText || normalizedPromptValue === requiredText;
  const promptRequired = isPrompt && dialog.required !== false;
  const promptValid = !promptRequired || Boolean(normalizedPromptValue);
  const confirmDisabled = Boolean(dialog.loading) || !typedConfirmationValid || !promptValid;
  const confirmButtonClass = isDanger
    ? 'inline-flex items-center justify-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50'
    : 'inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
  const iconClass = isDanger
    ? 'rounded-md bg-rose-50 p-2 text-rose-700'
    : type === 'confirm'
      ? 'rounded-md bg-amber-50 p-2 text-amber-700'
      : 'rounded-md bg-blue-50 p-2 text-blue-700';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className={iconClass}>
            <Icon />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-950">{title}</h2>
            {message && (
              <p className="mt-2 whitespace-pre-line text-sm text-slate-600">
                {message}
              </p>
            )}
          </div>
        </div>

        {(isPrompt || requiredText) && (
          <div className="mt-5">
            <label className="block text-sm font-semibold text-slate-700" htmlFor="appDialogPromptInput">
              {dialog.inputLabel || (requiredText ? requirementLabel : 'Response')}
            </label>
            <input
              id="appDialogPromptInput"
              type={dialog.inputType || 'text'}
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              className={`mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                isDanger
                  ? 'focus:border-rose-500 focus:ring-rose-100'
                  : 'focus:border-blue-500 focus:ring-blue-100'
              }`}
              placeholder={dialog.placeholder || ''}
              autoFocus
            />
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {!isAlert && (
            <button
              type="button"
              onClick={onCancel}
              disabled={Boolean(dialog.loading)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={confirmButtonClass}
          >
            {isDanger && <FaTrash className="text-xs" />}
            {dialog.loadingLabel && dialog.loading ? dialog.loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const AppDialogProvider = ({ children }) => {
  const [queue, setQueue] = useState([]);
  const [activeDialog, setActiveDialog] = useState(null);
  const [promptValue, setPromptValue] = useState('');

  const openDialog = useCallback((dialog) => (
    new Promise((resolve) => {
      setQueue((current) => [...current, { ...dialog, resolve }]);
    })
  ), []);

  useEffect(() => {
    setAppDialogOpener(openDialog);
    return () => clearAppDialogOpener(openDialog);
  }, [openDialog]);

  useEffect(() => {
    if (activeDialog || queue.length === 0) return;

    const [nextDialog, ...remainingQueue] = queue;
    setActiveDialog(nextDialog);
    setPromptValue(nextDialog.defaultValue || '');
    setQueue(remainingQueue);
  }, [activeDialog, queue]);

  const closeDialog = useCallback((value) => {
    if (!activeDialog) return;

    activeDialog.resolve(value);
    setActiveDialog(null);
    setPromptValue('');
  }, [activeDialog]);

  const handleCancel = useCallback(() => {
    if (!activeDialog) return;

    closeDialog(activeDialog.type === 'prompt' ? null : false);
  }, [activeDialog, closeDialog]);

  const handleConfirm = useCallback(() => {
    if (!activeDialog) return;

    if (activeDialog.type === 'prompt') {
      closeDialog(promptValue);
      return;
    }

    if (activeDialog.type === 'confirm') {
      closeDialog(true);
      return;
    }

    closeDialog(undefined);
  }, [activeDialog, closeDialog, promptValue]);

  const dialogElement = useMemo(() => (
    activeDialog ? (
      <AppDialog
        dialog={activeDialog}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        promptValue={promptValue}
        setPromptValue={setPromptValue}
      />
    ) : null
  ), [activeDialog, handleCancel, handleConfirm, promptValue]);

  return (
    <>
      {children}
      {dialogElement}
    </>
  );
};

export default AppDialogProvider;
