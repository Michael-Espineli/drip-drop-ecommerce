import { findDuplicateCustomerSuggestions } from './customerDuplicates';

test('suggestions preserve customer order, identity reasons, and one entry per pair', () => {
    const customers = [
        { id: 'a', email: 'AMY@example.com', phoneNumber: '555-123-4567' },
        { id: 'b', email: 'amy@example.com', phoneNumber: '(555) 123-4567' },
        { id: 'c', phoneNumber: '+1 555 123 4567' },
        { id: 'd', firstName: 'Dana', billingAddress: { streetAddress: '12 Pool Lane' } },
        { id: 'e', firstName: 'Dana', billingAddress: { streetAddress: '12 Pool Lane' } },
        { id: 'f', migrationSource: { sourceCustomerKey: 'source-1' } },
        { id: 'g', migrationSource: { sourceCustomerKey: 'source-1' } },
        { id: 'h', stripeCustomerId: 'cus_1' },
        { id: 'i', stripeCustomerId: 'cus_1' },
    ];
    expect(findDuplicateCustomerSuggestions(customers)).toEqual([
        { primary: customers[0], duplicate: customers[1], reason: 'email' },
        { primary: customers[0], duplicate: customers[2], reason: 'phone' },
        { primary: customers[1], duplicate: customers[2], reason: 'phone' },
        { primary: customers[3], duplicate: customers[4], reason: 'name and billing address' },
        { primary: customers[5], duplicate: customers[6], reason: 'source customer key' },
        { primary: customers[7], duplicate: customers[8], reason: 'Stripe customer' },
    ]);
});

test('limits suggestions to the first six unique pairs', () => {
    const customers = Array.from({ length: 10 }, (_, index) => ({ id: `customer-${index}`, email: 'shared@example.com' }));
    const suggestions = findDuplicateCustomerSuggestions(customers);
    expect(suggestions).toHaveLength(6);
    expect(suggestions.map(({ primary, duplicate }) => [primary.id, duplicate.id])).toEqual(
        customers.slice(1, 7).map((customer) => ['customer-0', customer.id])
    );
    expect(findDuplicateCustomerSuggestions(customers, 1)).toHaveLength(1);
    expect(findDuplicateCustomerSuggestions(customers, 0)).toEqual([]);
});

test('does not suggest blank identities or matching records with the same ID', () => {
    expect(findDuplicateCustomerSuggestions([
        { id: 'a' },
        { id: 'b' },
        { id: 'c', email: 'amy@example.com' },
        { id: 'c', email: 'amy@example.com' },
        { email: 'amy@example.com' },
    ])).toEqual([]);
});

test('a large unrelated customer list does not repeatedly normalize every other customer', () => {
    let reads = 0;
    const customers = Array.from({ length: 1000 }, (_, index) => ({
        id: `customer-${index}`,
        get email() {
            reads += 1;
            return `customer-${index}@example.com`;
        },
    }));
    expect(findDuplicateCustomerSuggestions(customers)).toEqual([]);
    expect(reads).toBeLessThan(10000);
});
