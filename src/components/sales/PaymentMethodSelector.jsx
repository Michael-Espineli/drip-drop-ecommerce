import React from 'react';
import {
  formatSalesPaymentFeeSummary,
  normalizeSalesPaymentMethodType,
  salesPaymentMethodOptions,
} from '../../utils/sales/paymentMethodFees';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const PaymentMethodSelector = ({
  amountCents = 0,
  value = 'ach',
  onChange,
  disabled = false,
  compact = false,
  className = '',
}) => {
  const selectedValue = normalizeSalesPaymentMethodType(value);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-800">Payment Method</p>
        <span className="text-xs font-semibold text-slate-500">Drip Drop fee estimate</span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {salesPaymentMethodOptions.map((option) => {
          const selected = option.id === selectedValue;
          const summary = formatSalesPaymentFeeSummary(amountCents, option.id);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange?.(option.id)}
              disabled={disabled}
              className={`rounded-md border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                  : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-950">{option.label}</p>
                  {!compact && <p className="mt-1 text-xs leading-5 text-slate-500">{option.helper}</p>}
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${
                  selected
                    ? 'border-blue-200 bg-white text-blue-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
                >
                  {option.shortLabel}
                </span>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-700">
                {option.platformFeePercent}% | est. {formatCurrency(summary.platformFeeCents)}
              </p>
              {!compact && (
                <p className="mt-1 text-xs text-slate-500">
                  {option.stripeFeeDescription}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PaymentMethodSelector;
