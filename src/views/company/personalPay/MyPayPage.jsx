import React, { useContext, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import WorkspaceHeader from '../../../components/workspace/WorkspaceHeader';
import WorkspaceSectionHeader from '../../../components/workspace/WorkspaceSectionHeader';
import { workspaceButtonClass } from '../../../components/workspace/workspaceStyles';
import { canViewOwnPay } from '../../../utils/myPay';
import PayRequestsPanel from '../payroll/PayRequestsPanel';
import { usePaysheet, money, dateLabel, dayLabel, periodLabel, PaysheetSummary, WorkBreakdown, PayLine } from './Paysheet';
import '../ProfilePage.css';
import './MyPayPage.css';

function SavedStatement({ companyId, statement }) {
  const { sheet, loading, error, refresh } = usePaysheet(companyId, { statementId: statement.id });
  return <div className="paysheet-saved-detail">{loading ? <p role="status">Loading statement…</p> : error ? <div role="alert"><p>{error}</p><button className={workspaceButtonClass()} onClick={refresh}>Try again</button></div> : <><PaysheetSummary sheet={sheet} /><WorkBreakdown sheet={sheet} /></>}</div>;
}
function History({ companyId, sheet, older }) {
  const [selected, setSelected] = useState('');
  return <>
    <section className="profile-card" aria-label="Pay history"><WorkspaceSectionHeader title="Statements & history" subtitle="Finalized statements and earlier work stay available here." />
      <div className="profile-card-body">
        {!sheet.statements.length && <p className="profile-empty">No finalized statements yet. Your current earnings are available on Paysheet.</p>}
        {sheet.statements.map(statement => <details key={statement.id} className="my-pay-statement" onToggle={event => { if (event.currentTarget.open) setSelected(statement.id); }}>
          <summary><span><strong>{statement.reference}</strong><span className="profile-caption">{dateLabel(statement.startDate)} – {dateLabel(statement.endDate)}</span></span><span className="my-pay-statement-total"><strong>{money(statement.totalCents)}</strong><span>{statement.status === 'paid' || statement.paidAt ? 'Recorded paid' : 'Approved · unpaid'}</span></span></summary>
          {selected === statement.id && <SavedStatement companyId={companyId} statement={statement} />}
        </details>)}
      </div>
    </section>
    {(older || sheet.olderItems.length > 0) && <section className="profile-card" aria-label="Older unpaid work"><WorkspaceSectionHeader title="Older unpaid work" subtitle={`Completed before ${dayLabel(sheet.startDateKey)} · separate from this period’s totals`} /><div className="profile-card-body">{sheet.olderItems.length ? sheet.olderItems.map(line => <div key={line.id}><p className="profile-caption">{dateLabel(line.completedDate)} · {line.customerName}</p><PayLine line={line} /><Link className="paysheet-issue" to={`/company/my-pay?tab=requests&${new URLSearchParams({ line: line.id, work: line.title })}`}>Report a pay issue</Link></div>) : <p>No older unpaid work recorded.</p>}</div></section>}
  </>;
}
function MyPayWorkspace({ companyId, technicianId, companyName }) {
  const [params] = useSearchParams();
  const requested = params.get('tab'), tab = ['history', 'statements'].includes(requested) ? 'history' : requested === 'requests' ? 'requests' : 'paysheet';
  const [period, setPeriod] = useState({}), [draft, setDraft] = useState({});
  const requestPeriod = tab === 'requests' && params.get('statement') ? { statementId: params.get('statement') }
    : tab === 'requests' && params.get('start') && params.get('end') ? { startDateKey: params.get('start'), endDateKey: params.get('end') } : period;
  const { sheet, loading, error, refresh } = usePaysheet(companyId, requestPeriod);
  const workTypes = [...new Map((sheet?.lineItems || []).filter(item => item.payTypeId).map(item => [item.payTypeId, { id: item.payTypeId, name: item.payTypeName, defaultRateType: item.rateType }])).values()];
  return <div className="my-pay-page profile-page"><div className="profile-workspace">
    <WorkspaceHeader title="Paysheet" eyebrow="My Pay" description="See what you earned, what was recorded paid, and how each route adds up."
      meta={<span>{companyName || 'Selected company'}</span>}
      actions={<><Link to="/company/profile" className={workspaceButtonClass({ tone: 'slate' })}>My Profile</Link><button className={workspaceButtonClass()} onClick={refresh} disabled={loading}>Refresh</button></>} />
    <nav aria-label="My Pay sections" className="my-pay-tabs">{[['paysheet', 'Paysheet'], ['history', 'History'], ['requests', 'Pay Requests']].map(([value, label]) => <Link key={value} aria-current={tab === value ? 'page' : undefined} to={`/company/my-pay${value === 'paysheet' ? '' : `?tab=${value}`}`} className={workspaceButtonClass({ active: tab === value })}>{label}</Link>)}</nav>
    {tab !== 'requests' && <form className="paysheet-period" onSubmit={event => { event.preventDefault(); setPeriod(draft); }}>
      <span><strong>{Object.keys(period).length ? 'Selected period' : 'Last 30 days'}</strong>{sheet && <span className="profile-caption">{periodLabel(sheet)}</span>}</span>
      <label>From<input aria-label="Period start" type="date" required value={draft.startDateKey || sheet?.startDateKey || ''} onChange={event => setDraft({ ...{ startDateKey: sheet?.startDateKey, endDateKey: sheet?.endDateKey }, ...draft, startDateKey: event.target.value })} /></label>
      <label>Through<input aria-label="Period end" type="date" required value={draft.endDateKey || sheet?.endDateKey || ''} onChange={event => setDraft({ ...{ startDateKey: sheet?.startDateKey, endDateKey: sheet?.endDateKey }, ...draft, endDateKey: event.target.value })} /></label>
      <button className={workspaceButtonClass()} disabled={loading}>View period</button><button type="button" className={workspaceButtonClass({ tone: 'slate' })} onClick={() => { setPeriod({}); setDraft({}); }}>Last 30 days</button>
    </form>}
    {loading && <p role="status">Loading your paysheet…</p>}
    {error && <div role="alert" className="profile-card profile-card-body"><p className="profile-error">Your pay is unavailable. {error}</p><button className={workspaceButtonClass()} onClick={refresh}>Try again</button></div>}
    {sheet && tab === 'paysheet' && <><PaysheetSummary sheet={sheet} /><WorkBreakdown sheet={sheet} /></>}
    {sheet && tab === 'history' && <History companyId={companyId} sheet={sheet} older={params.get('older') === '1'} />}
    {tab === 'requests' && <>
      {params.get('work') && <p className="paysheet-notice">Pay issue for: {params.get('work')}. Enter the amount and explain what needs correcting.</p>}
      <PayRequestsPanel key={`${companyId}:${technicianId}:${params.get('line') || ''}:${params.get('work') || ''}`} companyId={companyId} workTypes={workTypes} audience="self"
        initialRequestType={params.get('line') ? 'payCorrection' : 'payout'} initialPayLineItemId={params.get('line') || ''}
        initialReason={params.get('work') ? `Please review pay for ${params.get('work')}. ` : ''} payItems={[...(sheet?.lineItems || []), ...(sheet?.olderItems || [])]} />
    </>}
  </div></div>;
}
export default function MyPayPage() {
  const context = useContext(Context);
  if (!context.recentlySelectedCompany) return <div className="profile-page"><p>Select a company to view your pay.</p><Link to="/company/selection" className={workspaceButtonClass()}>Select Company</Link></div>;
  if (context.companyRoleLoading || !context.companyRoleLoaded) return <div className="profile-page" role="status">Loading your company access…</div>;
  if (!canViewOwnPay(context)) return <div className="profile-page" role="alert">Your pay is unavailable because you do not have active access to this company.</div>;
  return <MyPayWorkspace key={`${context.recentlySelectedCompany}:${context.user.uid}`} companyId={context.recentlySelectedCompany} technicianId={context.user.uid} companyName={context.recentlySelectedCompanyName} />;
}
