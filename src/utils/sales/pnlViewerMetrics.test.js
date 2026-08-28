import { buildPnlViewerMatrix } from './pnlViewerMetrics';

describe('buildPnlViewerMatrix', () => {
  it('excludes one-time job estimate agreements and costs from recurring service PNL', () => {
    const result = buildPnlViewerMatrix({
      companyId: 'company-1',
      dateRangeStart: new Date(2026, 0, 1, 0, 0, 0),
      dateRangeEnd: new Date(2026, 0, 31, 23, 59, 59),
      customersById: new Map([
        ['customer-1', { id: 'customer-1', customerName: 'Ada Pool' }],
      ]),
      serviceLocations: [
        { id: 'location-1', customerId: 'customer-1', nickName: 'Backyard' },
      ],
      serviceAgreements: [
        {
          id: 'agreement-recurring',
          customerId: 'customer-1',
          customerName: 'Ada Pool',
          serviceLocationIds: ['location-1'],
          sourceType: 'recurringService',
          status: 'accepted',
          totalAmountCents: 20000,
          rateType: 'perMonth',
          serviceCadence: 'weekly',
          billingFrequency: 'day',
          billingFrequencyCount: 31,
          startDate: new Date(2026, 0, 1),
          lineItems: [{ billingBehavior: 'recurring', totalAmountCents: 20000 }],
        },
        {
          id: 'agreement-one-time',
          customerId: 'customer-1',
          customerName: 'Ada Pool',
          serviceLocationIds: ['location-1'],
          sourceType: 'oneOffJob',
          status: 'accepted',
          totalAmountCents: 50000,
          rateType: 'oneTime',
          serviceCadence: 'oneTime',
          startDate: new Date(2026, 0, 1),
          lineItems: [{ billingBehavior: 'oneTime', totalAmountCents: 50000 }],
        },
      ],
      serviceStops: [
        {
          id: 'stop-recurring',
          recurringServiceStopId: 'rss-1',
          customerId: 'customer-1',
          customerName: 'Ada Pool',
          serviceLocationId: 'location-1',
          serviceDate: new Date(2026, 0, 15),
        },
        {
          id: 'stop-one-time',
          jobId: 'job-1',
          customerId: 'customer-1',
          customerName: 'Ada Pool',
          serviceLocationId: 'location-1',
          serviceDate: new Date(2026, 0, 16),
        },
      ],
      stopData: [
        {
          id: 'stop-data-recurring',
          serviceStopId: 'stop-recurring',
          customerId: 'customer-1',
          customerName: 'Ada Pool',
          serviceLocationId: 'location-1',
          date: new Date(2026, 0, 15),
          dosages: [],
        },
        {
          id: 'stop-data-one-time',
          serviceStopId: 'stop-one-time',
          customerId: 'customer-1',
          customerName: 'Ada Pool',
          serviceLocationId: 'location-1',
          date: new Date(2026, 0, 16),
          dosages: [],
        },
      ],
      payrollLines: [
        {
          id: 'pay-recurring',
          serviceStopId: 'stop-recurring',
          customerId: 'customer-1',
          serviceLocationId: 'location-1',
          completedDate: new Date(2026, 0, 15),
          totalAmountCents: 3000,
        },
        {
          id: 'pay-one-time',
          serviceStopId: 'stop-one-time',
          customerId: 'customer-1',
          serviceLocationId: 'location-1',
          completedDate: new Date(2026, 0, 16),
          totalAmountCents: 10000,
        },
      ],
    });

    expect(result.rows).toHaveLength(1);

    const [row] = result.rows;
    expect(row.agreementIds).toEqual(['agreement-recurring']);
    expect(row.revenueCents).toBe(20000);
    expect(row.laborCents).toBe(3000);
    expect(row.visits).toBe(1);
    expect(row.netCents).toBe(17000);
    expect(result.totals.netCents).toBe(17000);
  });
});
