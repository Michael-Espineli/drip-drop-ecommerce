import React from 'react';

const normalizeToken = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const productTokens = new Set([
  'material',
  'materials',
  'materialstopurchase',
  'product',
  'products',
  'part',
  'parts',
  'databaseitem',
  'shoppinglistitem',
  'shoppingitem',
]);

const otherTokens = new Set([
  'fee',
  'discount',
  'tax',
  'adjustment',
]);

export const lineItemBillingSection = (item = {}) => {
  const tokens = [
    item.billingSection,
    item.section,
    item.group,
    item.type,
    item.salesItemType,
    item.sourceType,
    item.metadata?.billingSection,
    item.metadata?.sourceType,
  ].map(normalizeToken).filter(Boolean);

  if (tokens.some((token) => productTokens.has(token))) return 'products';
  if (tokens.some((token) => otherTokens.has(token))) return 'other';
  return 'services';
};

export const groupLineItemsByBillingSection = (lineItems = []) => {
  const groups = {
    services: [],
    products: [],
    other: [],
  };

  (Array.isArray(lineItems) ? lineItems : []).forEach((item) => {
    groups[lineItemBillingSection(item)].push(item);
  });

  return groups;
};

const lineItemAmountCents = (item = {}, field, fallback = 0) => {
  const value = item[field];
  if (value !== undefined && value !== null && value !== '') return Number(value) || 0;
  return fallback;
};

const sectionLabels = {
  services: {
    title: 'Services',
    empty: 'No services were included.',
    fallbackName: 'Service',
  },
  products: {
    title: 'Products',
    empty: 'No products were included.',
    fallbackName: 'Product',
  },
  other: {
    title: 'Other Charges',
    empty: 'No other charges were included.',
    fallbackName: 'Charge',
  },
};

const LineItemTable = ({ items, formatCurrency, fallbackName, includeStripePrice }) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200">
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Item</th>
          <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Qty</th>
          <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Unit</th>
          <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Total</th>
          {includeStripePrice && (
            <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Stripe Price</th>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {items.map((item, index) => {
          const quantity = Number(item.quantity || 1);
          const unitAmountCents = lineItemAmountCents(
            item,
            'unitAmountCents',
            lineItemAmountCents(item, 'unitPriceCents', lineItemAmountCents(item, 'rateAmountCents'))
          );
          const totalAmountCents = lineItemAmountCents(
            item,
            'totalAmountCents',
            lineItemAmountCents(
              item,
              'totalPriceCents',
              lineItemAmountCents(item, 'amount', lineItemAmountCents(item, 'totalCents', unitAmountCents * Math.max(quantity, 0)))
            )
          );

          return (
            <tr key={item.id || item.catalogItemId || `${item.name || fallbackName}-${index}`}>
              <td className="px-5 py-4">
                <p className="font-semibold text-slate-950">{item.name || item.description || fallbackName}</p>
                {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
              </td>
              <td className="px-5 py-4 text-slate-700">{quantity || 1}</td>
              <td className="px-5 py-4 text-slate-700">{formatCurrency(unitAmountCents)}</td>
              <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(totalAmountCents)}</td>
              {includeStripePrice && (
                <td className="px-5 py-4 text-xs text-slate-500">{item.stripePriceId || 'Inline Checkout price'}</td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const LineItemSectionTables = ({
  lineItems = [],
  formatCurrency,
  emptyMessage = 'No services or products were included.',
  includeEmptySections = false,
  includeStripePrice = false,
}) => {
  const groups = groupLineItemsByBillingSection(lineItems);
  const orderedSections = ['services', 'products', 'other'];
  const hasItems = orderedSections.some((sectionKey) => groups[sectionKey].length > 0);

  if (!hasItems) {
    return <div className="p-5 text-sm text-slate-500">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-5">
      {orderedSections.map((sectionKey) => {
        const items = groups[sectionKey];
        const labels = sectionLabels[sectionKey];

        if (!includeEmptySections && items.length === 0) return null;

        return (
          <section key={sectionKey} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-950">{labels.title}</h3>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">
                {items.length}
              </span>
            </div>
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                {labels.empty}
              </div>
            ) : (
              <LineItemTable
                items={items}
                formatCurrency={formatCurrency}
                fallbackName={labels.fallbackName}
                includeStripePrice={includeStripePrice}
              />
            )}
          </section>
        );
      })}
    </div>
  );
};

export default LineItemSectionTables;
