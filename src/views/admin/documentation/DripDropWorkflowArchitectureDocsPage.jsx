export default function DripDropWorkflowArchitectureDocsPage() {
    const ADMIN_YELLOW = '#efb12f';
    const sections = [
        {
            title: '1. Job Lifecycle',
            content: `A Job is the parent record for planned work. It owns the customer-facing scope, pricing, workflow status, planned labor, materials, offers, scheduled service stops, actual work, and billing.`,
            firestorePath: 'companies/{companyId}/workOrders/{jobId}',
            fields: [
                'id: String',
                'internalId: String',
                'description: String',
                'operationStatus: JobOperationStatus',
                'billingStatus: JobBillingStatus',
                'customerId: String',
                'customerName: String',
                'serviceLocationId: String',
                'serviceStopIds: [String]',
                'laborContractIds: [String]',
                'adminId: String',
                'adminName: String',
                'rate: Int // cents',
                'laborCost: Int // cents',
                'purchasedItemsIds: [String]?'
            ],
            extra: {
                operationStatus: [
                    'estimatePending',
                    'unscheduled',
                    'scheduled',
                    'inProgress',
                    'finished',
                    'waitingForParts'
                ],
                billingStatus: [
                    'draft',
                    'estimate',
                    'accepted',
                    'inProgress',
                    'invoiced',
                    'paid',
                    'expired'
                ]
            }
        },
        {
            title: '2. Planned Labor',
            content: `Planned labor now comes from two sources: planned service stops and job tasks.`,
            firestorePath: 'companies/{companyId}/workOrders/{jobId}/plannedServiceStops/{plannedStopId}',
            fields: [
                'id: String',
                'companyId: String',
                'jobId: String',
                'name: String',
                'description: String',
                'serviceStopTypeId: String',
                'serviceStopTypeName: String',
                'estimatedMinutes: Int',
                'sortOrder: Int',
                'taskIds: [String]',
                'plannedLaborCostCents: Int?'
            ],
            formulas: [
                'plannedServiceStopLaborCents = sum(plannedServiceStops.plannedLaborCostCents)',
                'plannedTaskLaborCents = sum(jobTasks.contractedRate)',
                'plannedTotalLaborCents = plannedServiceStopLaborCents + plannedTaskLaborCents'
            ]
        },
        {
            title: '3. Job Materials & Shopping List Integration',
            content: `ShoppingListItem is the shared planned-material record. There should not be separate objects for job materials, route prep materials, and shopping list items.`,
            firestorePath: 'companies/{companyId}/shoppingList/{shoppingListItemId}',
            bullets: [
                'Job Materials tab reads ShoppingListItem records where jobId == currentJob.id',
                'Shopping Center should use targeted indexed queries based on prepKeys',
                'The same ShoppingListItem can appear in different views depending on context'
            ]
        },
        {
            title: '4. ShoppingListItem Model',
            content: `ShoppingListItem is the central reusable planned-material object.`,
            fields: [
                'category: ShoppingListCategory',
                'subCategory: ShoppingListSubCategory',
                'status: ShoppingListStatus',
                'purchaserId: String',
                'name: String',
                'description: String',
                'jobId: String?',
                'customerId: String?',
                'serviceStopId: String?',
                'serviceLocationId: String?',
                'prepKeys: [String]',
                'needsAction: Bool',
                'assignedTechIds: [String]',
                'plannedUnitCostCents: Int?',
                'plannedUnitPriceCents: Int?',
                'plannedTotalCostCents: Int?',
                'plannedTotalPriceCents: Int?'
            ],
            extra: {
                categories: ['personal', 'customer', 'job'],
                statusBehavior: [
                    'Need to Purchase → needsAction = true',
                    'Purchased → needsAction = true',
                    'Installed → needsAction = false'
                ]
            }
        },
        {
            title: '5. Prep Keys',
            content: `prepKeys make shopping items queryable without reading the entire company collection.`,
            codeBlocks: [
                `[
  "job:{jobId}",
  "customer:{customerId}",
  "serviceLocation:{serviceLocationId}"
]`,
                `[
  "user:{userId}"
]`,
                `[
  "serviceStop:{serviceStopId}",
  "customer:{customerId}",
  "serviceLocation:{serviceLocationId}",
  "job:{jobId}"
]`
            ]
        },
        {
            title: '6. Route Prep Shopping Queries',
            content: `The technician route prep context comes from today's ServiceStop records.`,
            bullets: [
                'Build route prep keys from serviceStopList and current user',
                'Query shopping items where needsAction == true',
                'Use prepKeys arrayContainsAny routePrepKeysChunk',
                'Chunk route prep keys into groups of 10',
                'Deduplicate by item id'
            ]
        },
        {
            title: '7. Shopping Center Views',
            bullets: [
                'Route Prep',
                'Outstanding',
                'My Items',
                'Customers',
                'Jobs',
                'Purchased'
            ]
        },
        {
            title: '8. Job Templates',
            content: `Templates are reusable job structures that can create new jobs.`,
            firestorePath: 'companies/{companyId}/jobTemplates/{templateId}',
            bullets: [
                'Copy template tasks into workOrders/{jobId}/tasks',
                'Copy planned stops into plannedServiceStops',
                'Copy shopping items into shoppingList with the new jobId',
                'Copy planned material pricing snapshots',
                'Do not copy customer/service location unless explicitly selected'
            ]
        },
        {
            title: '9. Work Offers',
            firestorePath: 'companies/{companyId}/workOffers/{offerId}',
            fields: [
                'jobId',
                'taskIds',
                'serviceStopTypeId',
                'serviceStopTypeName',
                'canTechnicianSchedule',
                'estimatedPayCents',
                'status'
            ]
        },
        {
            title: '10. Actual Work & Payroll',
            bullets: [
                'Actual payroll line items',
                'Actual purchased material costs',
                'Actual profit',
                'Plan vs actual comparison'
            ]
        },
        {
            title: '11. Billing',
            content: `Billing uses the same planned and actual values.`,
            important: 'job.rate = customer price in cents',
            bullets: [
                'Customer Price',
                'Planned Labor',
                'Planned Material Cost',
                'Planned Material Billable',
                'Projected Profit',
                'Actual Payroll',
                'Actual Material Cost',
                'Actual Profit',
                'Invoice Status'
            ]
        },
        {
            title: '12. Money Rules',
            content: `All durable job/material/payroll money values should be stored as cents.`,
            fields: [
                'job.rate: Int // cents',
                'job.laborCost: Int // cents',
                'JobTask.contractedRate: Int // cents',
                'ShoppingListItem.plannedUnitCostCents: Int?',
                'ShoppingListItem.plannedUnitPriceCents: Int?',
                'ShoppingListItem.plannedTotalCostCents: Int?',
                'ShoppingListItem.plannedTotalPriceCents: Int?'
            ]
        },
        {
            title: '13. High-Level Mental Model',
            content: `The central principle is to reuse records and add lookup fields for different workflows instead of creating duplicate objects.`,
            codeBlocks: [
                `Job
├─ Planned Stops
├─ Tasks
├─ ShoppingListItems as planned materials
├─ Work Offers
├─ Scheduled Service Stops
├─ Actual Payroll
├─ Purchased Items
└─ Billing`,
                `Shopping Center
├─ Route Prep
├─ Outstanding
├─ My Items
├─ Customer Items
└─ Job Items`
            ]
        }
    ];

    return (
        <div className="min-h-screen bg-slate-900 px-2 py-5 text-slate-100 md:px-7">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="rounded-xl border border-slate-800/60 bg-slate-950 p-6 shadow-2xl md:p-8">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p
                                className="text-sm font-semibold uppercase tracking-wide"
                                style={{ color: ADMIN_YELLOW }}
                            >
                                Internal Documentation
                            </p>
                            <h1 className="mt-2 text-4xl font-extrabold text-slate-100">
                                DripDrop Workflow Architecture
                            </h1>
                            <p className="mt-3 max-w-3xl text-base text-slate-400">
                                Architecture overview for jobs, planned labor, shopping integration,
                                templates, route prep, payroll, billing, and reusable workflow data models.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <StatCard title="Core Modules" value="13" />
                            <StatCard title="Primary Principle" value="Reuse Records" />
                        </div>
                    </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
                    <div className="sticky top-6 h-fit rounded-xl border border-slate-800/60 bg-slate-950 p-5 shadow-2xl">
                        <h2 className="mb-4 text-lg font-semibold text-slate-100">
                            Navigation
                        </h2>

                        <div className="space-y-2">
                            {sections.map((section, index) => (
                                <a
                                    key={section.title}
                                    href={`#section-${index}`}
                                    className="block rounded-md px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-900/70 hover:text-slate-100"
                                >
                                    {section.title}
                                </a>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-6">
                        {sections.map((section, index) => (
                            <div
                                id={`section-${index}`}
                                key={section.title}
                                className="rounded-xl border border-slate-800/60 bg-slate-950 p-6 shadow-2xl"
                            >
                                <h2 className="text-2xl font-bold text-slate-100">
                                    {section.title}
                                </h2>

                                {section.content && (
                                    <p className="mt-4 text-base leading-7 text-slate-400">
                                        {section.content}
                                    </p>
                                )}

                                {section.firestorePath && (
                                    <div className="mt-5 rounded-lg border border-slate-800/60 bg-slate-900/60 p-4">
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Firestore Path
                                        </p>
                                        <code className="text-sm text-slate-200">
                                            {section.firestorePath}
                                        </code>
                                    </div>
                                )}

                                {section.fields && (
                                    <div className="mt-6">
                                        <h3 className="mb-3 text-lg font-semibold text-slate-100">
                                            Important Fields
                                        </h3>

                                        <div className="grid gap-3 md:grid-cols-2">
                                            {section.fields.map((field) => (
                                                <div
                                                    key={field}
                                                    className="rounded-lg border border-slate-800/60 bg-slate-900/60 px-4 py-3 font-mono text-sm text-slate-300"
                                                >
                                                    {field}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {section.bullets && (
                                    <div className="mt-6">
                                        <ul className="space-y-3">
                                            {section.bullets.map((bullet) => (
                                                <li
                                                    key={bullet}
                                                    className="flex items-start gap-3 rounded-lg border border-slate-800/60 bg-slate-900/60 p-4"
                                                >
                                                    <div
                                                        className="mt-1 h-2 w-2 rounded-full"
                                                        style={{ backgroundColor: ADMIN_YELLOW }}
                                                    />
                                                    <span className="text-sm leading-6 text-slate-300">
                                                        {bullet}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {section.formulas && (
                                    <div className="mt-6 space-y-3">
                                        <h3 className="text-lg font-semibold text-slate-100">
                                            Calculations
                                        </h3>

                                        {section.formulas.map((formula) => (
                                            <div
                                                key={formula}
                                                className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-mono text-sm text-emerald-200"
                                            >
                                                {formula}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {section.codeBlocks && (
                                    <div className="mt-6 space-y-4">
                                        {section.codeBlocks.map((block) => (
                                            <pre
                                                key={block}
                                                className="overflow-auto rounded-lg border border-slate-800/60 bg-slate-900/80 p-4 text-sm text-slate-100"
                                            >
                                                <code>{block}</code>
                                            </pre>
                                        ))}
                                    </div>
                                )}

                                {section.extra?.operationStatus && (
                                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                                        <StatusGroup
                                            title="Operation Status"
                                            items={section.extra.operationStatus}
                                        />

                                        <StatusGroup
                                            title="Billing Status"
                                            items={section.extra.billingStatus}
                                        />
                                    </div>
                                )}

                                {section.extra?.categories && (
                                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                                        <StatusGroup
                                            title="Categories"
                                            items={section.extra.categories}
                                        />

                                        <StatusGroup
                                            title="Status Behavior"
                                            items={section.extra.statusBehavior}
                                        />
                                    </div>
                                )}

                                {section.important && (
                                    <div className="mt-6 rounded-lg border border-[#efb12f]/30 bg-[#efb12f]/10 p-5">
                                        <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: ADMIN_YELLOW }}>
                                            Important Rule
                                        </p>

                                        <p className="mt-2 font-mono text-sm text-slate-100">
                                            {section.important}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value }) {
    return (
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {title}
            </p>

            <p className="mt-2 text-lg font-bold text-slate-100">{value}</p>
        </div>
    );
}

function StatusGroup({ title, items }) {
    const ADMIN_YELLOW = '#efb12f';

    return (
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/60 p-5">
            <h3 className="mb-4 text-lg font-semibold text-slate-100">{title}</h3>

            <div className="flex flex-wrap gap-2">
                {items.map((item) => (
                    <span
                        key={item}
                        className="rounded-full border bg-slate-950 px-3 py-1 text-sm text-slate-300"
                        style={{ borderColor: `${ADMIN_YELLOW}4d` }}
                    >
                        {item}
                    </span>
                ))}
            </div>
        </div>
    );
}
