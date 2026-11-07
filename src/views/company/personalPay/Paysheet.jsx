import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkspaceSectionHeader from '../../../components/workspace/WorkspaceSectionHeader';
import { workspaceButtonClass } from '../../../components/workspace/workspaceStyles';
import { technicianWorkflow } from '../../../utils/technicianWorkflow';
import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import './MyPayPage.css';

export const money = value => (Number(value) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const dayLabel = key => key ? new Date(key + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
export const dateLabel = value => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date not recorded';
export const periodLabel = sheet => `${dayLabel(sheet.startDateKey)} – ${dayLabel(sheet.endDateKey)}`;
export function usePaysheet(companyId, options = {}) {
  const [retry, setRetry] = useState(0), [state, setState] = useState({ loading: true, sheet: null, error: '' });
  const key = JSON.stringify({ companyId, ...options });
  useEffect(() => {
    let cancelled = false;
    setState({ key, loading: true, sheet: null, error: '' });
    technicianWorkflow('getTechnicianPaysheet', { ...JSON.parse(key), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(sheet => {
      if (!sheet || sheet.version !== 1) throw new Error('The paysheet could not be verified.');
      if (!cancelled) setState({ key, loading: false, sheet, error: '' });
    }).catch(error => { if (!cancelled) setState({ key, loading: false, sheet: null, error: userFacingErrorMessage(error) }); });
    return () => { cancelled = true; };
  }, [key, retry]);
  return { ...(state.key === key ? state : { loading: true, sheet: null, error: '' }), refresh: () => setRetry(value => value + 1) };
}

export function PayTotals({ summary, loading }) {
  return <dl className="paysheet-metrics" aria-busy={loading}>
    {[["Earned", summary?.earnedCents], ["Recorded paid", summary?.recordedPaidCents], ["Still owed", summary?.remainingCents]].map(([label, amount]) =>
      <div key={label}><dt>{label}</dt><dd>{loading ? '—' : money(amount)}</dd></div>)}
  </dl>;
}
export function OlderBalance({ sheet, link = false }) {
  const { olderUnpaidCents, olderReviewCount } = sheet.summary;
  if (!olderUnpaidCents && !olderReviewCount) return null;
  return <p className="paysheet-notice">Before {dayLabel(sheet.startDateKey)}: {money(olderUnpaidCents)} still owed{olderReviewCount ? ` · ${olderReviewCount} pay items need review` : ''}.
    {link && <> <Link to="/company/my-pay?tab=history&older=1">View older unpaid work</Link></>}
  </p>;
}
export function ProfilePaySnapshot({ companyId }) {
  const { sheet, loading, error, refresh } = usePaysheet(companyId, { mode: 'summary' });
  return <>
    <p className="profile-caption">{sheet ? `Last 30 days · ${periodLabel(sheet)}` : 'Last 30 days'}</p>
    {error ? <div role="alert"><p className="profile-error">Pay is unavailable. {error}</p><button className={workspaceButtonClass()} onClick={refresh}>Try again</button></div> : <>
      <PayTotals summary={sheet?.summary} loading={loading} />
      {sheet && <><OlderBalance sheet={sheet} link />{sheet.summary.reviewCount > 0 && <p className="paysheet-notice">{sheet.summary.reviewCount} {sheet.summary.reviewCount === 1 ? "pay item needs" : "pay items need"} review.</p>}</>}
    </>}
    <div className="profile-payout-actions"><Link to="/company/my-pay" className={workspaceButtonClass({ active: true })}>Open Paysheet</Link></div>
  </>;
}
const issueLink = (title, lineId = '', sheet) => `/company/my-pay?tab=requests&${new URLSearchParams({ work: title, ...(lineId ? { line: lineId } : {}), ...(sheet?.statement ? { statement: sheet.statement.id } : sheet ? { start: sheet.startDateKey, end: sheet.endDateKey } : {}) })}`;
export function PayLine({ line, hideTitle = false }) {
  return <div className="paysheet-pay-line">
    <div>{!hideTitle && <strong>{line.title}</strong>}<span className="profile-caption">{line.rateDescription}</span>
      <span className="profile-caption">{line.statusLabel}{line.isPaid ? ` · ${dateLabel(line.paidAt)}${line.paymentReference ? ` · ${line.paymentReference}` : ''}` : ''}</span>
    </div>
    <strong className="paysheet-amount">{line.needsReview ? 'Pending' : money(line.totalAmountCents)}</strong>
  </div>;
}
export function WorkBreakdown({ sheet }) {
  return <section className="profile-card paysheet-work" aria-label="Work verification">
    <WorkspaceSectionHeader title="Verify your work" subtitle="Day → route → stop → tasks. Included work stays visible without a separate earnings line." />
    <div className="profile-card-body">
      {!sheet.days.length && <p className="profile-empty">No completed work or earnings found for this period.</p>}
      {sheet.days.map(day => <div key={day.id} className="paysheet-day"><h3>{dayLabel(day.id)}</h3>
        {day.routes.map(route => <div key={route.id} className="paysheet-route"><div className="paysheet-route-heading"><h4>{route.name}</h4><strong>{money(route.totalCents)}</strong></div>
          {route.stops.map(stop => <details key={stop.id} className="paysheet-stop">
            <summary><span><strong>{stop.title}</strong><span className="profile-caption">{stop.subtitle}</span></span>
              <span className={`paysheet-coverage ${stop.coverageLabel === 'Pay needs review' ? 'paysheet-review' : ''}`}><span>{stop.amountCents !== 0 && stop.amountCents != null ? money(stop.amountCents) : ''}</span><span>{stop.coverageLabel}</span></span></summary>
            <div className="paysheet-stop-body">
              {stop.lines.map(line => <PayLine key={line.id} line={line} />)}
              {stop.tasks.length > 0 && <div className="paysheet-tasks"><h5>Completed tasks</h5>{stop.tasks.map(task => <div key={task.id} className="paysheet-task">
                <div className="paysheet-task-heading"><strong>{task.title}</strong>{!task.lines.length && <span className={task.coverageLabel === 'Pay needs review' ? 'paysheet-review' : 'profile-caption'}>{task.coverageLabel}</span>}</div>
                {task.lines.map(line => <PayLine key={line.id} line={line} hideTitle={line.title === task.title} />)}
                {task.coverageLabel === 'Pay needs review' && <Link to={issueLink(`${stop.title} · ${task.title} · ${dayLabel(day.id)}`, task.lines[0]?.id, sheet)} className="paysheet-issue">Report a pay issue for this task</Link>}
              </div>)}</div>}
              {!stop.tasks.some(task => task.coverageLabel === 'Pay needs review') && <Link to={issueLink(`${stop.title} · ${dayLabel(day.id)}`, stop.lines[0]?.id, sheet)} className="paysheet-issue">Report a pay issue for this work</Link>}
            </div>
          </details>)}
          {route.lines.map(line => <details key={line.id} className="paysheet-stop"><summary><span><strong>{line.title}</strong><span className="profile-caption">{line.customerName || line.serviceLocationAddress || line.statusLabel}</span></span><strong>{line.needsReview ? 'Pending' : money(line.totalAmountCents)}</strong></summary><div className="paysheet-stop-body"><PayLine line={line} /><Link to={issueLink(`${line.title} · ${dayLabel(day.id)}`, line.id, sheet)} className="paysheet-issue">Report a pay issue</Link></div></details>)}
        </div>)}
      </div>)}
    </div>
  </section>;
}
export function PaysheetSummary({ sheet }) {
  return <section className="profile-card paysheet-stub" aria-label="Earnings summary">
    <WorkspaceSectionHeader title={sheet.statement?.reference || 'Earnings summary'} subtitle={sheet.statement ? 'Saved statement' : 'Live paysheet · updates as your work is recorded'} />
    <div className="profile-card-body">
      <div className="paysheet-identity"><div><strong>{sheet.technicianName}</strong><span>{sheet.companyName}</span></div><div><strong>{periodLabel(sheet)}</strong><span>Work completed in this period</span></div></div>
      {sheet.statement ? <dl className="paysheet-earnings"><div><dt>Work earnings</dt><dd>{money(sheet.statement.subtotalCents)}</dd></div><div><dt>Statement adjustments</dt><dd>{money(sheet.statement.adjustmentCents)}</dd></div><div className="paysheet-total"><dt>Total pay</dt><dd>{money(sheet.statement.totalCents)}</dd></div></dl> : <>
        <PayTotals summary={sheet.summary} />
        <dl className="paysheet-earnings">{sheet.earnings.map(item => <div key={item.id}><dt>{item.label}</dt><dd>{money(item.amountCents)}</dd></div>)}<div className="paysheet-total"><dt>Total earnings</dt><dd>{money(sheet.summary.earnedCents)}</dd></div></dl>
        <p className="profile-caption">Work uses completion dates; statement adjustments use the statement’s period-ending date. Amounts awaiting review are excluded.</p>
        <OlderBalance sheet={sheet} link />
      </>}
      {sheet.summary.reviewCount > 0 && <p role="status" className="paysheet-notice">{sheet.summary.reviewCount} {sheet.summary.reviewCount === 1 ? "item needs" : "items need"} pay review. The total may be incomplete.</p>}
      {sheet.missingCount > 0 && <p role="status" className="paysheet-notice">{sheet.missingCount} saved pay items could not be found. This work breakdown is incomplete; the saved statement total is shown above.</p>}
      {sheet.detailWarning && <p role="status" className="paysheet-notice">{sheet.detailWarning}</p>}
      {sheet.statement?.paidAt && <p>Recorded paid {dateLabel(sheet.statement.paidAt)}{sheet.statement.paymentReference ? ` · ${sheet.statement.paymentReference}` : ''}</p>}
      {sheet.statement?.notes && <p>{sheet.statement.notes}</p>}
      {sheet.statement?.paidNotes && <p>{sheet.statement.paidNotes}</p>}
    </div>
  </section>;
}
