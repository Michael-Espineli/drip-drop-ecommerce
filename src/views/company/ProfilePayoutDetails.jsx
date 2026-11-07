import React, { useState } from "react";
import { workspaceButtonClass } from "../../components/workspace/workspaceStyles";

const money = (value) => (value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const date = (value) => value ? value.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Date unavailable";

export function PayoutWorkList({ items, label }) {
  return <ul className="profile-payout-work" aria-label={label}>
    {items.map(item => <li key={item.id}>
      <div className="profile-payout-work-copy">
        <p className="profile-payout-work-title">{item.title}</p>
        <p className="profile-caption">{date(item.completedDate)}{item.customer ? ` · ${item.customer}` : ""}</p>
        {!item.needsReview && item.rateDescription && <p className="profile-caption">{item.rateDescription}</p>}
        {item.isPaid && item.paidDate && <p className="profile-caption">Paid {date(item.paidDate)}</p>}
      </div>
      <div className="profile-payout-work-pay">
        <p className="profile-payout-work-amount">{item.needsReview ? "Pending" : money(item.amountCents)}</p>
        <span className={`profile-payout-status ${item.isPaid ? "is-paid" : item.needsReview ? "is-review" : ""}`}>{item.statusLabel}</span>
      </div>
    </li>)}
  </ul>;
}

export default function ProfilePayoutDetails({ summary, loading }) {
  const [filter, setFilter] = useState("unpaid");
  const [expanded, setExpanded] = useState(false);
  const items = filter === "unpaid" ? summary.unpaidItems : summary.paidItems;
  return <>
    <div className="profile-metrics" aria-busy={loading}>
      <div className="profile-metric">
        <p className="profile-metric-label">Still to be paid</p>
        <p className="profile-metric-value">{loading ? "—" : money(summary.owedCents)}</p>
        <p className="profile-metric-helper">Calculated pay awaiting payment</p>
      </div>
      <div className="profile-metric">
        <p className="profile-metric-label">Marked paid</p>
        <p className="profile-metric-value">{loading ? "—" : money(summary.paidCents)}</p>
        <p className="profile-metric-helper">For work in this period</p>
      </div>
      <div className="profile-metric">
        <p className="profile-metric-label">Last payout</p>
        <p className="profile-payout-date">{loading ? "—" : summary.lastPayoutDate ? date(summary.lastPayoutDate) : "None recorded"}</p>
        {summary.lastPayoutDate && !loading && <p className="profile-metric-helper">{summary.lastPayoutLabel}</p>}
      </div>
    </div>
    {!loading && <>
      {summary.reviewCount > 0 && <p className="profile-payout-review" role="status">
        <strong>{summary.reviewCount} {summary.reviewCount === 1 ? "pay item needs" : "pay items need"} review.</strong>{" "}
        These amounts are pending and are excluded from the unpaid total.
      </p>}
      <div className="profile-payout-work-heading">
        <h3>Work &amp; pay</h3>
        <div className="profile-payout-filters" aria-label="Payment status">
          {[["unpaid", "Unpaid", summary.unpaidItems.length], ["paid", "Paid", summary.paidItems.length]].map(([value, label, count]) =>
            <button key={value} type="button" aria-pressed={filter === value}
              className={workspaceButtonClass({ tone: value === "paid" ? "emerald" : "blue", active: filter === value })}
              onClick={() => { setFilter(value); setExpanded(false); }}>{label} ({count})</button>)}
        </div>
      </div>
      {items.length === 0 ? <p className="profile-empty">{filter === "paid" ? "No work marked paid in this period." : "No unpaid pay recorded in this period."}</p> :
        <PayoutWorkList items={expanded ? items : items.slice(0, 5)} label={filter === "unpaid" ? "Unpaid work" : "Paid work"} />}
      {items.length > 5 && <button type="button" className={workspaceButtonClass({ tone: "slate" })}
        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? "Show fewer" : `Show all ${items.length} ${filter} items`}
      </button>}
      <p className="profile-caption">$0 pay items are hidden. Missing work or pay? Use Pay Requests to ask for a correction.</p>
    </>}
  </>;
}
