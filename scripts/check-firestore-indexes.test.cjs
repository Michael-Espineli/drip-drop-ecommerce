const test = require('node:test');
const assert = require('node:assert/strict');
const { compareIndexes } = require('./check-firestore-indexes.cjs');
const index = {
  collectionGroup: 'homeownerServiceStops', queryScope: 'COLLECTION',
  fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'serviceDate', order: 'DESCENDING' }],
};
const spec = (indexes = [], fieldOverrides = []) => ({ indexes, fieldOverrides });

test('accepts the implicit document-name ordering returned by Firestore', () => {
  const cloud = { ...index, fields: [...index.fields, { fieldPath: '__name__', order: 'DESCENDING' }] };
  assert.deepEqual(compareIndexes(spec([index]), spec([cloud])), { missingIndexes: [], missingFields: [], duplicates: [] });
  const reorderedProperties = { ...cloud, fields: cloud.fields.map(field => ({ order: field.order, fieldPath: field.fieldPath })) };
  assert.equal(compareIndexes(spec([index]), spec([reorderedProperties])).missingIndexes.length, 0);
});
test('flags a missing composite without requiring unrelated cloud indexes to be deleted', () => {
  const unrelated = { ...index, collectionGroup: 'otherRecords' };
  assert.deepEqual(compareIndexes(spec([index]), spec([unrelated])).missingIndexes, [index]);
  assert.deepEqual(compareIndexes(spec([]), spec([unrelated])).missingIndexes, []);
});
test('distinguishes collection scope, sort direction and explicit document-name direction', () => {
  for (const cloud of [
    { ...index, queryScope: 'COLLECTION_GROUP' },
    { ...index, fields: [index.fields[0], { fieldPath: 'serviceDate', order: 'ASCENDING' }] },
    { ...index, fields: [...index.fields, { fieldPath: '__name__', order: 'ASCENDING' }] },
  ]) assert.equal(compareIndexes(spec([index]), spec([cloud])).missingIndexes.length, 1);
});
test('detects missing collection-group field coverage even when collection indexes exist', () => {
  const field = { collectionGroup: 'customers', fieldPath: 'portalEmailNormalized', indexes: [
    { order: 'ASCENDING', queryScope: 'COLLECTION' }, { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
  ] };
  const cloud = { ...field, indexes: [field.indexes[0]] };
  const report = compareIndexes(spec([], [field]), spec([], [cloud]));
  assert.deepEqual(report.missingFields[0].indexes, [field.indexes[1]]);
});
test('accepts extra field indexes and detects duplicate local composite definitions', () => {
  const field = { collectionGroup: 'tasks', fieldPath: 'workerId', indexes: [{ queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' }] };
  const cloud = { ...field, indexes: [...field.indexes, { queryScope: 'COLLECTION', order: 'DESCENDING' }] };
  const report = compareIndexes(spec([index, index], [field]), spec([index], [cloud]));
  assert.deepEqual(report.missingFields, []);
  assert.equal(report.duplicates.length, 1);
});
