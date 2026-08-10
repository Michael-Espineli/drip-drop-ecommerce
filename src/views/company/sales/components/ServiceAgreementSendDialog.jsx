import React, { useEffect, useMemo, useState } from 'react';
import { FaEnvelope, FaTimes } from 'react-icons/fa';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const splitEmails = (value = '') => (
  String(value || '')
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean)
);

const uniqueEmails = (emails = []) => {
  const seen = new Set();
  return emails.filter((email) => {
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isValidEmail = (email = '') => emailPattern.test(String(email || '').trim());

const ServiceAgreementSendDialog = ({
  agreement,
  open,
  sending = false,
  includeInspectionReport = false,
  hasLinkedInspectionReport = false,
  onClose,
  onConfirm,
}) => {
  const savedEmail = agreement?.email || agreement?.customerEmail || agreement?.billingEmail || '';
  const [primaryEmail, setPrimaryEmail] = useState(savedEmail);
  const [additionalEmailText, setAdditionalEmailText] = useState('');

  useEffect(() => {
    if (!open) return;
    setPrimaryEmail(savedEmail);
    setAdditionalEmailText('');
  }, [open, savedEmail]);

  const additionalEmails = useMemo(() => {
    const primaryKey = primaryEmail.trim().toLowerCase();
    return uniqueEmails(splitEmails(additionalEmailText))
      .filter((email) => email.toLowerCase() !== primaryKey);
  }, [additionalEmailText, primaryEmail]);

  const invalidAdditionalEmails = additionalEmails.filter((email) => !isValidEmail(email));
  const primaryEmailValue = primaryEmail.trim();
  const primaryEmailInvalid = Boolean(primaryEmailValue) && !isValidEmail(primaryEmailValue);
  const recipients = [primaryEmailValue, ...additionalEmails].filter(Boolean);
  const canSend = Boolean(primaryEmailValue && !primaryEmailInvalid && invalidAdditionalEmails.length === 0 && !sending);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-blue-50 p-2 text-blue-700">
                <FaEnvelope />
              </span>
              <h2 className="text-xl font-bold text-slate-950">Verify Email Recipients</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {agreement?.title || 'Service Agreement'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close send verification"
          >
            <FaTimes />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <p className="font-semibold text-slate-700">Email on agreement</p>
            <p className="mt-1 break-all text-slate-600">{savedEmail || 'No email on file'}</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="serviceAgreementPrimaryEmail">
              Primary Recipient
            </label>
            <input
              id="serviceAgreementPrimaryEmail"
              type="email"
              value={primaryEmail}
              onChange={(event) => setPrimaryEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="customer@example.com"
              disabled={sending}
            />
            {primaryEmailInvalid && (
              <p className="mt-1 text-xs font-semibold text-rose-700">Enter a valid primary email.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="serviceAgreementAdditionalEmails">
              Additional Recipients
            </label>
            <textarea
              id="serviceAgreementAdditionalEmails"
              value={additionalEmailText}
              onChange={(event) => setAdditionalEmailText(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="owner@example.com, manager@example.com"
              disabled={sending}
            />
            {invalidAdditionalEmails.length > 0 && (
              <p className="mt-1 text-xs font-semibold text-rose-700">
                Check: {invalidAdditionalEmails.join(', ')}
              </p>
            )}
          </div>

          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <p className="font-semibold">Will send to</p>
            <p className="mt-1 break-all">{recipients.length ? recipients.join(', ') : 'Add a primary recipient.'}</p>
          </div>

          {includeInspectionReport && (
            <div className={`rounded-md border px-3 py-2 text-xs ${
              hasLinkedInspectionReport
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
            >
              {hasLinkedInspectionReport
                ? 'Inspection report will be included.'
                : 'No linked inspection report was found yet.'}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.({ primaryEmail: primaryEmailValue, additionalEmails })}
            disabled={!canSend}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FaEnvelope className="text-xs" />
            {sending ? 'Sending...' : 'Send Service Agreement'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServiceAgreementSendDialog;
