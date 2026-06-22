import React, { useMemo, useState } from 'react';
import { FaCalculator, FaCloud, FaCreditCard, FaServer, FaUniversity } from 'react-icons/fa';
import { MdOutlinePayments } from 'react-icons/md';

const ADMIN_YELLOW = '#efb12f';

const FEE_MODEL = {
  stripeCardPercent: 2.9,
  stripeCardFixed: 0.3,
  stripeAchPercent: 0.8,
  stripeAchCap: 5,
  quickBooksCardPercent: 2.99,
  quickBooksAchPercent: 1,
  platformCardPercent: 0.08,
  platformAchPercent: 0.19,
};

const EXAMPLE_AMOUNTS = [175, 500];
const DEFAULT_CUSTOM_AMOUNTS = '175, 500, 1000, 3000, 5000';
const DAYS_IN_MONTH = 30;

const FIREBASE_MODEL = {
  firestoreReadFreePerDay: 50000,
  firestoreReadPricePer100k: 0.03,
  firestoreWriteFreePerDay: 20000,
  firestoreWritePricePer100k: 0.09,
  firestoreDeleteFreePerDay: 20000,
  firestoreDeletePricePer100k: 0.01,
  firestoreStorageFreeGb: 1,
  firestoreStoragePricePerGbMonth: 0.15,
  functionsFreeInvocations: 2000000,
  functionsInvocationPricePerMillion: 0.4,
  functionsFreeOutboundGb: 5,
  functionsOutboundPricePerGb: 0.12,
  hostingFreeStorageGb: 10,
  hostingStoragePricePerGb: 0.026,
  hostingFreeTransferGb: 10.8,
  hostingTransferPricePerGb: 0.15,
};

const DEFAULT_FIREBASE_INPUTS = {
  firestoreReads: 2500000,
  firestoreWrites: 800000,
  firestoreDeletes: 50000,
  firestoreStorageGb: 2,
  functionsInvocations: 2500000,
  functionsOutboundGb: 8,
  hostingStorageGb: 1,
  hostingTransferGb: 25,
  otherMonthlyCost: 0,
  cardVolume: 10000,
  achVolume: 10000,
};

const parsePercent = (percent) => percent / 100;

const formatMoney = (value) => (
  Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
);

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

const formatNumber = (value) => Number(value || 0).toLocaleString('en-US');

const parseNumberInput = (value) => {
  const parsed = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const getEffectivePercent = (fee, amount) => {
  if (!amount) return 0;
  return (fee / amount) * 100;
};

const calculateFees = (amount) => {
  const stripeCardFee =
    amount * parsePercent(FEE_MODEL.stripeCardPercent) + FEE_MODEL.stripeCardFixed;
  const stripeAchFee = Math.min(
    amount * parsePercent(FEE_MODEL.stripeAchPercent),
    FEE_MODEL.stripeAchCap
  );
  const quickBooksCardFee = amount * parsePercent(FEE_MODEL.quickBooksCardPercent);
  const quickBooksAchFee = amount * parsePercent(FEE_MODEL.quickBooksAchPercent);
  const platformCardFee = amount * parsePercent(FEE_MODEL.platformCardPercent);
  const platformAchFee = amount * parsePercent(FEE_MODEL.platformAchPercent);
  const dripDropCardFee = stripeCardFee + platformCardFee;
  const dripDropAchFee = stripeAchFee + platformAchFee;

  return [
    {
      provider: 'Just Stripe',
      cardFee: stripeCardFee,
      achFee: stripeAchFee,
      notes: 'Processor only',
    },
    {
      provider: 'Just QuickBooks',
      cardFee: quickBooksCardFee,
      achFee: quickBooksAchFee,
      notes: 'Published online rates',
    },
    {
      provider: 'Stripe + Drip Drop',
      cardFee: dripDropCardFee,
      achFee: dripDropAchFee,
      notes: `${formatPercent(FEE_MODEL.platformCardPercent)} card, ${formatPercent(FEE_MODEL.platformAchPercent)} ACH platform fee`,
    },
  ].map((row) => ({
    ...row,
    amount,
    cardEffective: getEffectivePercent(row.cardFee, amount),
    achEffective: getEffectivePercent(row.achFee, amount),
  }));
};

const parseCustomAmounts = (value) => {
  const uniqueAmounts = new Set();
  const matches = value.replace(/\$/g, '').match(/\d[\d,]*(?:\.\d+)?/g) || [];

  matches
    .map((item) => Number(item.replace(/,/g, '')))
    .filter((amount) => Number.isFinite(amount) && amount > 0)
    .forEach((amount) => uniqueAmounts.add(Math.round(amount * 100) / 100));

  return Array.from(uniqueAmounts).slice(0, 12);
};

const calculateFirebaseEstimate = (inputs) => {
  const firestoreReads = parseNumberInput(inputs.firestoreReads);
  const firestoreWrites = parseNumberInput(inputs.firestoreWrites);
  const firestoreDeletes = parseNumberInput(inputs.firestoreDeletes);
  const firestoreStorageGb = parseNumberInput(inputs.firestoreStorageGb);
  const functionsInvocations = parseNumberInput(inputs.functionsInvocations);
  const functionsOutboundGb = parseNumberInput(inputs.functionsOutboundGb);
  const hostingStorageGb = parseNumberInput(inputs.hostingStorageGb);
  const hostingTransferGb = parseNumberInput(inputs.hostingTransferGb);
  const otherMonthlyCost = parseNumberInput(inputs.otherMonthlyCost);
  const cardVolume = parseNumberInput(inputs.cardVolume);
  const achVolume = parseNumberInput(inputs.achVolume);

  const monthlyFreeReads = FIREBASE_MODEL.firestoreReadFreePerDay * DAYS_IN_MONTH;
  const monthlyFreeWrites = FIREBASE_MODEL.firestoreWriteFreePerDay * DAYS_IN_MONTH;
  const monthlyFreeDeletes = FIREBASE_MODEL.firestoreDeleteFreePerDay * DAYS_IN_MONTH;

  const lineItems = [
    {
      label: 'Firestore reads',
      usage: firestoreReads,
      free: monthlyFreeReads,
      billable: Math.max(0, firestoreReads - monthlyFreeReads),
      unit: 'reads',
      cost: (Math.max(0, firestoreReads - monthlyFreeReads) / 100000) * FIREBASE_MODEL.firestoreReadPricePer100k,
    },
    {
      label: 'Firestore writes',
      usage: firestoreWrites,
      free: monthlyFreeWrites,
      billable: Math.max(0, firestoreWrites - monthlyFreeWrites),
      unit: 'writes',
      cost: (Math.max(0, firestoreWrites - monthlyFreeWrites) / 100000) * FIREBASE_MODEL.firestoreWritePricePer100k,
    },
    {
      label: 'Firestore deletes',
      usage: firestoreDeletes,
      free: monthlyFreeDeletes,
      billable: Math.max(0, firestoreDeletes - monthlyFreeDeletes),
      unit: 'deletes',
      cost: (Math.max(0, firestoreDeletes - monthlyFreeDeletes) / 100000) * FIREBASE_MODEL.firestoreDeletePricePer100k,
    },
    {
      label: 'Firestore storage',
      usage: firestoreStorageGb,
      free: FIREBASE_MODEL.firestoreStorageFreeGb,
      billable: Math.max(0, firestoreStorageGb - FIREBASE_MODEL.firestoreStorageFreeGb),
      unit: 'GiB',
      cost: Math.max(0, firestoreStorageGb - FIREBASE_MODEL.firestoreStorageFreeGb) * FIREBASE_MODEL.firestoreStoragePricePerGbMonth,
    },
    {
      label: 'Functions invocations',
      usage: functionsInvocations,
      free: FIREBASE_MODEL.functionsFreeInvocations,
      billable: Math.max(0, functionsInvocations - FIREBASE_MODEL.functionsFreeInvocations),
      unit: 'invocations',
      cost: (Math.max(0, functionsInvocations - FIREBASE_MODEL.functionsFreeInvocations) / 1000000) * FIREBASE_MODEL.functionsInvocationPricePerMillion,
    },
    {
      label: 'Functions outbound',
      usage: functionsOutboundGb,
      free: FIREBASE_MODEL.functionsFreeOutboundGb,
      billable: Math.max(0, functionsOutboundGb - FIREBASE_MODEL.functionsFreeOutboundGb),
      unit: 'GB',
      cost: Math.max(0, functionsOutboundGb - FIREBASE_MODEL.functionsFreeOutboundGb) * FIREBASE_MODEL.functionsOutboundPricePerGb,
    },
    {
      label: 'Hosting storage',
      usage: hostingStorageGb,
      free: FIREBASE_MODEL.hostingFreeStorageGb,
      billable: Math.max(0, hostingStorageGb - FIREBASE_MODEL.hostingFreeStorageGb),
      unit: 'GB',
      cost: Math.max(0, hostingStorageGb - FIREBASE_MODEL.hostingFreeStorageGb) * FIREBASE_MODEL.hostingStoragePricePerGb,
    },
    {
      label: 'Hosting transfer',
      usage: hostingTransferGb,
      free: FIREBASE_MODEL.hostingFreeTransferGb,
      billable: Math.max(0, hostingTransferGb - FIREBASE_MODEL.hostingFreeTransferGb),
      unit: 'GB',
      cost: Math.max(0, hostingTransferGb - FIREBASE_MODEL.hostingFreeTransferGb) * FIREBASE_MODEL.hostingTransferPricePerGb,
    },
    {
      label: 'Other monthly Firebase/Google Cloud',
      usage: otherMonthlyCost,
      free: 0,
      billable: otherMonthlyCost,
      unit: 'USD',
      cost: otherMonthlyCost,
    },
  ];

  const totalCost = lineItems.reduce((total, item) => total + item.cost, 0);
  const platformRevenue =
    cardVolume * parsePercent(FEE_MODEL.platformCardPercent) +
    achVolume * parsePercent(FEE_MODEL.platformAchPercent);

  return {
    lineItems,
    totalCost,
    platformRevenue,
    netAfterFirebase: platformRevenue - totalCost,
    cardVolumeToCover: totalCost / parsePercent(FEE_MODEL.platformCardPercent),
    achVolumeToCover: totalCost / parsePercent(FEE_MODEL.platformAchPercent),
  };
};

const EstimateInput = ({ label, value, onChange, suffix }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
    </span>
    <div className="flex rounded-lg border border-slate-700 bg-slate-900 focus-within:border-[#efb12f] focus-within:ring-2 focus-within:ring-[#efb12f]/20">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm text-slate-100 outline-none"
      />
      {suffix && (
        <span className="flex items-center rounded-r-lg border-l border-slate-700 px-3 text-xs font-semibold text-slate-500">
          {suffix}
        </span>
      )}
    </div>
  </label>
);

const FeeComparisonTable = ({ title, amount }) => {
  const rows = useMemo(() => calculateFees(amount), [amount]);

  return (
    <section className="rounded-xl border border-slate-800/60 bg-slate-950 p-4 text-slate-100 shadow-2xl">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            {title}
          </h2>
          <p className="text-sm text-slate-400">{formatMoney(amount)} invoice comparison</p>
        </div>
        <div className="rounded-lg bg-[#efb12f]/10 px-3 py-2 text-sm font-bold text-[#efb12f] ring-1 ring-[#efb12f]/30">
          ACH target: {formatPercent(FEE_MODEL.stripeAchPercent + FEE_MODEL.platformAchPercent)}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800/60">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/80 text-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-bold">Option</th>
              <th className="px-4 py-3 text-right font-bold">Card Fee</th>
              <th className="px-4 py-3 text-right font-bold">Card Effective</th>
              <th className="px-4 py-3 text-right font-bold">ACH Fee</th>
              <th className="px-4 py-3 text-right font-bold">ACH Effective</th>
              <th className="px-4 py-3 text-left font-bold">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((row) => (
              <tr key={row.provider} className="hover:bg-slate-900/60">
                <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-100">
                  {row.provider}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-200">
                  {formatMoney(row.cardFee)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                  {formatPercent(row.cardEffective)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-200">
                  {formatMoney(row.achFee)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                  {formatPercent(row.achEffective)}
                </td>
                <td className="min-w-[220px] px-4 py-3 text-slate-400">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const CustomComparisonTable = ({ amounts }) => {
  const rows = useMemo(() => (
    amounts.map((amount) => {
      const [stripe, quickBooks, dripDrop] = calculateFees(amount);
      return {
        amount,
        stripeCardFee: stripe.cardFee,
        quickBooksCardFee: quickBooks.cardFee,
        dripDropCardFee: dripDrop.cardFee,
        stripeAchFee: stripe.achFee,
        quickBooksAchFee: quickBooks.achFee,
        dripDropAchFee: dripDrop.achFee,
      };
    })
  ), [amounts]);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800/60">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-900/80 text-slate-200">
          <tr>
            <th className="px-4 py-3 text-left font-bold">Amount</th>
            <th className="px-4 py-3 text-right font-bold">Stripe Card</th>
            <th className="px-4 py-3 text-right font-bold">QuickBooks Card</th>
            <th className="px-4 py-3 text-right font-bold">Drip Drop Card</th>
            <th className="px-4 py-3 text-right font-bold">Stripe ACH</th>
            <th className="px-4 py-3 text-right font-bold">QuickBooks ACH</th>
            <th className="px-4 py-3 text-right font-bold">Drip Drop ACH</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {rows.map((row) => (
            <tr key={row.amount} className="hover:bg-slate-900/60">
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-100">
                {formatMoney(row.amount)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                {formatMoney(row.stripeCardFee)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                {formatMoney(row.quickBooksCardFee)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-[#efb12f]">
                {formatMoney(row.dripDropCardFee)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                {formatMoney(row.stripeAchFee)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                {formatMoney(row.quickBooksAchFee)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-300">
                {formatMoney(row.dripDropAchFee)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-slate-400" colSpan={7}>
                No valid amounts entered.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const BillingFeeCalculator = () => {
  const [customAmountsInput, setCustomAmountsInput] = useState(DEFAULT_CUSTOM_AMOUNTS);
  const [firebaseInputs, setFirebaseInputs] = useState(DEFAULT_FIREBASE_INPUTS);

  const customAmounts = useMemo(
    () => parseCustomAmounts(customAmountsInput),
    [customAmountsInput]
  );
  const firebaseEstimate = useMemo(
    () => calculateFirebaseEstimate(firebaseInputs),
    [firebaseInputs]
  );

  const breakEvenAmount =
    FEE_MODEL.stripeCardFixed /
    parsePercent(FEE_MODEL.quickBooksCardPercent - FEE_MODEL.stripeCardPercent - FEE_MODEL.platformCardPercent);

  const updateFirebaseInput = (key, value) => {
    setFirebaseInputs((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <div className="min-h-screen bg-slate-900 px-2 py-5 md:px-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Billing Fee Calculator
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Compare Stripe, QuickBooks, and Drip Drop payment pricing using the current platform fee model.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-950 px-3 py-2 text-center ring-1 ring-slate-800/80">
            <p className="text-xs font-semibold uppercase text-slate-500">Card</p>
            <p className="text-lg font-extrabold text-[#efb12f]">
              {formatPercent(FEE_MODEL.platformCardPercent)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-950 px-3 py-2 text-center ring-1 ring-slate-800/80">
            <p className="text-xs font-semibold uppercase text-slate-500">ACH</p>
            <p className="text-lg font-extrabold text-emerald-300">
              {formatPercent(FEE_MODEL.platformAchPercent)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-950 px-3 py-2 text-center ring-1 ring-slate-800/80">
            <p className="text-xs font-semibold uppercase text-slate-500">Stripe Card</p>
            <p className="text-lg font-extrabold text-slate-100">
              {formatPercent(FEE_MODEL.stripeCardPercent)} + 30c
            </p>
          </div>
          <div className="rounded-lg bg-slate-950 px-3 py-2 text-center ring-1 ring-slate-800/80">
            <p className="text-xs font-semibold uppercase text-slate-500">QuickBooks</p>
            <p className="text-lg font-extrabold text-slate-100">
              {formatPercent(FEE_MODEL.quickBooksCardPercent)}
            </p>
          </div>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-slate-100 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30">
            <FaServer />
          </div>
          <div>
            <h2 className="font-extrabold text-amber-100">Pre-Deployment To-Do</h2>
            <p className="mt-1 text-sm text-amber-50/80">
              Upgrade Firebase Functions from Node.js 20 before the next production deployment window.
              Node.js 20 was flagged as deprecated and decommissions on 2026-10-30.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800/60 bg-slate-950 p-4 text-slate-100 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#efb12f]/10 text-[#efb12f] ring-1 ring-[#efb12f]/30">
              <FaCreditCard />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-100">Card Math</h2>
              <p className="mt-1 text-sm text-slate-400">
                Stripe card fee is amount x {formatPercent(FEE_MODEL.stripeCardPercent)} plus 30c.
                Drip Drop adds amount x {formatPercent(FEE_MODEL.platformCardPercent)}.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/60 bg-slate-950 p-4 text-slate-100 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20">
              <FaUniversity />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-100">ACH Math</h2>
              <p className="mt-1 text-sm text-slate-400">
                Stripe ACH is amount x {formatPercent(FEE_MODEL.stripeAchPercent)}, capped at {formatMoney(FEE_MODEL.stripeAchCap)}.
                Drip Drop adds amount x {formatPercent(FEE_MODEL.platformAchPercent)}.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/60 bg-slate-950 p-4 text-slate-100 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20">
              <MdOutlinePayments />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-100">Card Break-Even</h2>
              <p className="mt-1 text-sm text-slate-400">
                Drip Drop card pricing matches QuickBooks around {formatMoney(breakEvenAmount)}.
                ACH stays under QuickBooks until Stripe's ACH cap starts helping larger invoices.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4">
        {EXAMPLE_AMOUNTS.map((amount) => (
          <FeeComparisonTable
            key={amount}
            title={`${formatMoney(amount)} Example`}
            amount={amount}
          />
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-slate-800/60 bg-slate-950 p-4 text-slate-100 shadow-2xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#efb12f]/10 text-[#efb12f] ring-1 ring-[#efb12f]/30">
                <FaCalculator />
              </div>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
                  Custom Amounts
                </h2>
                <p className="text-sm text-slate-400">Compare up to 12 invoice amounts.</p>
              </div>
            </div>
          </div>

          <label className="w-full lg:max-w-xl">
            <span className="mb-2 block text-sm font-semibold text-slate-300">
              Amounts
            </span>
            <textarea
              value={customAmountsInput}
              onChange={(event) => setCustomAmountsInput(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#efb12f] focus:ring-2 focus:ring-[#efb12f]/20"
            />
          </label>
        </div>

        <div className="mt-4">
          <CustomComparisonTable amounts={customAmounts} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-800/60 bg-slate-950 p-4 text-slate-100 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20">
                <FaCloud />
              </div>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
                  Firebase Cost Estimator
                </h2>
                <p className="text-sm text-slate-400">
                  Estimates Firestore, Cloud Functions, and Hosting using a 30-day month and public Firebase free tiers.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-900/70 px-3 py-2 ring-1 ring-slate-800/80">
              <p className="text-xs font-semibold uppercase text-slate-500">Firebase Estimate</p>
              <p className="text-xl font-extrabold text-slate-100">
                {formatMoney(firebaseEstimate.totalCost)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-900/70 px-3 py-2 ring-1 ring-slate-800/80">
              <p className="text-xs font-semibold uppercase text-slate-500">Fee Revenue</p>
              <p className="text-xl font-extrabold text-[#efb12f]">
                {formatMoney(firebaseEstimate.platformRevenue)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-900/70 px-3 py-2 ring-1 ring-slate-800/80">
              <p className="text-xs font-semibold uppercase text-slate-500">After Firebase</p>
              <p className={`text-xl font-extrabold ${firebaseEstimate.netAfterFirebase >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {formatMoney(firebaseEstimate.netAfterFirebase)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <EstimateInput
            label="Firestore reads"
            value={firebaseInputs.firestoreReads}
            onChange={(value) => updateFirebaseInput('firestoreReads', value)}
            suffix="monthly"
          />
          <EstimateInput
            label="Firestore writes"
            value={firebaseInputs.firestoreWrites}
            onChange={(value) => updateFirebaseInput('firestoreWrites', value)}
            suffix="monthly"
          />
          <EstimateInput
            label="Firestore deletes"
            value={firebaseInputs.firestoreDeletes}
            onChange={(value) => updateFirebaseInput('firestoreDeletes', value)}
            suffix="monthly"
          />
          <EstimateInput
            label="Firestore storage"
            value={firebaseInputs.firestoreStorageGb}
            onChange={(value) => updateFirebaseInput('firestoreStorageGb', value)}
            suffix="GiB"
          />
          <EstimateInput
            label="Function invocations"
            value={firebaseInputs.functionsInvocations}
            onChange={(value) => updateFirebaseInput('functionsInvocations', value)}
            suffix="monthly"
          />
          <EstimateInput
            label="Function outbound"
            value={firebaseInputs.functionsOutboundGb}
            onChange={(value) => updateFirebaseInput('functionsOutboundGb', value)}
            suffix="GB"
          />
          <EstimateInput
            label="Hosting storage"
            value={firebaseInputs.hostingStorageGb}
            onChange={(value) => updateFirebaseInput('hostingStorageGb', value)}
            suffix="GB"
          />
          <EstimateInput
            label="Hosting transfer"
            value={firebaseInputs.hostingTransferGb}
            onChange={(value) => updateFirebaseInput('hostingTransferGb', value)}
            suffix="GB/mo"
          />
          <EstimateInput
            label="Other Firebase cost"
            value={firebaseInputs.otherMonthlyCost}
            onChange={(value) => updateFirebaseInput('otherMonthlyCost', value)}
            suffix="USD"
          />
          <EstimateInput
            label="Card billing volume"
            value={firebaseInputs.cardVolume}
            onChange={(value) => updateFirebaseInput('cardVolume', value)}
            suffix="USD/mo"
          />
          <EstimateInput
            label="ACH billing volume"
            value={firebaseInputs.achVolume}
            onChange={(value) => updateFirebaseInput('achVolume', value)}
            suffix="USD/mo"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4">
            <p className="text-sm font-semibold text-slate-300">ACH volume to cover Firebase</p>
            <p className="mt-2 text-2xl font-extrabold text-emerald-300">
              {formatMoney(firebaseEstimate.achVolumeToCover)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Based on {formatPercent(FEE_MODEL.platformAchPercent)} platform fee.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4">
            <p className="text-sm font-semibold text-slate-300">Card volume to cover Firebase</p>
            <p className="mt-2 text-2xl font-extrabold text-[#efb12f]">
              {formatMoney(firebaseEstimate.cardVolumeToCover)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Based on {formatPercent(FEE_MODEL.platformCardPercent)} platform fee.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4">
            <p className="text-sm font-semibold text-slate-300">Estimator notes</p>
            <p className="mt-2 text-sm text-slate-400">
              Cloud Functions CPU-seconds, GB-seconds, logs, Secret Manager, and regional price differences are not fully modeled here.
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-bold">Firebase Area</th>
                <th className="px-4 py-3 text-right font-bold">Usage</th>
                <th className="px-4 py-3 text-right font-bold">Free Included</th>
                <th className="px-4 py-3 text-right font-bold">Billable</th>
                <th className="px-4 py-3 text-right font-bold">Estimated Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {firebaseEstimate.lineItems.map((item) => (
                <tr key={item.label} className="hover:bg-slate-900/60">
                  <td className="px-4 py-3 font-semibold text-slate-100">{item.label}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                    {item.unit === 'USD' ? formatMoney(item.usage) : `${formatNumber(item.usage)} ${item.unit}`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-slate-400">
                    {item.unit === 'USD' ? formatMoney(item.free) : `${formatNumber(item.free)} ${item.unit}`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                    {item.unit === 'USD' ? formatMoney(item.billable) : `${formatNumber(item.billable)} ${item.unit}`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                    {formatMoney(item.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-900/80">
              <tr>
                <td className="px-4 py-3 font-extrabold text-slate-100" colSpan={4}>
                  Estimated Monthly Firebase Cost
                </td>
                <td className="px-4 py-3 text-right font-extrabold text-[#efb12f]">
                  {formatMoney(firebaseEstimate.totalCost)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
};

export default BillingFeeCalculator;
