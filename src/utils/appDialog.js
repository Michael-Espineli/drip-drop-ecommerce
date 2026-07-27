let appDialogOpener = null;

const normalizeOptions = (messageOrOptions = {}) => (
  typeof messageOrOptions === 'string'
    ? { message: messageOrOptions }
    : { ...messageOrOptions }
);

const fallbackDialog = (type, options) => {
  if (typeof window === 'undefined') {
    if (type === 'confirm') return Promise.resolve(false);
    if (type === 'prompt') return Promise.resolve(null);
    return Promise.resolve();
  }

  if (type === 'confirm') {
    return Promise.resolve(window.confirm(options.message || options.title || 'Are you sure?'));
  }

  if (type === 'prompt') {
    return Promise.resolve(window.prompt(options.message || options.title || '', options.defaultValue || ''));
  }

  window.alert(options.message || options.title || '');
  return Promise.resolve();
};

const openAppDialog = (type, messageOrOptions) => {
  const options = normalizeOptions(messageOrOptions);

  if (!appDialogOpener) {
    return fallbackDialog(type, options);
  }

  return appDialogOpener({ ...options, type });
};

export const setAppDialogOpener = (opener) => {
  appDialogOpener = opener;
};

export const clearAppDialogOpener = (opener) => {
  if (!opener || appDialogOpener === opener) {
    appDialogOpener = null;
  }
};

export const appAlert = (messageOrOptions) => openAppDialog('alert', messageOrOptions);

export const appConfirm = (messageOrOptions) => openAppDialog('confirm', messageOrOptions);

export const appPrompt = (messageOrOptions) => openAppDialog('prompt', messageOrOptions);
