#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const compositeKey = specification => {
  const fields = specification.fields.map(field => ({
    fieldPath: field.fieldPath,
    ...(field.order ? { order: field.order } : {}),
    ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
    ...(field.vectorConfig ? { vectorConfig: field.vectorConfig } : {}),
  }));
  if (!fields.some(field => field.fieldPath === '__name__')) {
    fields.push({ fieldPath: '__name__', order: fields.filter(field => field.order).at(-1)?.order || 'ASCENDING' });
  }
  return JSON.stringify({ collectionGroup: specification.collectionGroup, queryScope: specification.queryScope, fields });
};
const fieldIndexKey = index => JSON.stringify({
  queryScope: index.queryScope || 'COLLECTION',
  ...(index.order ? { order: index.order } : {}),
  ...(index.arrayConfig ? { arrayConfig: index.arrayConfig } : {}),
});

function compareIndexes(declared, deployed) {
  const available = new Set((deployed.indexes || []).map(compositeKey));
  const seen = new Set(), duplicates = [];
  for (const index of declared.indexes || []) {
    const key = compositeKey(index);
    if (seen.has(key)) duplicates.push(index);
    seen.add(key);
  }
  const missingIndexes = (declared.indexes || []).filter(index => !available.has(compositeKey(index)));
  const missingFields = (declared.fieldOverrides || []).flatMap(field => {
    const actual = (deployed.fieldOverrides || []).find(other => other.collectionGroup === field.collectionGroup && other.fieldPath === field.fieldPath);
    const actualIndexes = new Set((actual?.indexes || []).map(fieldIndexKey));
    const indexes = field.indexes.filter(index => !actualIndexes.has(fieldIndexKey(index)));
    return indexes.length ? [{ ...field, indexes }] : [];
  });
  return { missingIndexes, missingFields, duplicates };
}

function main() {
  const repo = path.resolve(__dirname, '..');
  const position = process.argv.indexOf('--project');
  const project = position < 0 ? 'development' : process.argv[position + 1];
  if (!project || project.startsWith('--')) throw new Error('Pass a Firebase project ID or alias after --project.');
  const declared = JSON.parse(fs.readFileSync(path.join(repo, 'firestore.indexes.json')));
  const output = execFileSync('firebase', ['firestore:indexes', '--project', project, '--json', '--non-interactive'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const response = JSON.parse(output);
  if (response.status !== 'success' || !response.result) throw new Error('Firebase did not return an index inventory.');
  const report = compareIndexes(declared, response.result);
  if (report.missingIndexes.length || report.missingFields.length || report.duplicates.length) {
    console.error(JSON.stringify({ project, ...report }, null, 2));
    console.error('Index definitions differ. Run npm run deploy:dev:indexes for development; remove duplicate local definitions before deploying.');
    process.exitCode = 1;
    return;
  }
  console.log(`Firestore index definitions match ${project}: ${declared.indexes.length} composite indexes and ${declared.fieldOverrides.length} field configurations.`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { compositeKey, compareIndexes };
