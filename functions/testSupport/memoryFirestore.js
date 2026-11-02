const assert = require('node:assert/strict');
const copy = value => value instanceof Date ? new Date(value) : Array.isArray(value) ? value.map(copy) : value && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)])) : value;
const comparable = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value);
class MemoryFirestore {
  constructor(records) { this.records = new Map(Object.entries(records)); this.version = 0; this.readLog = []; }
  doc(path) {
    return { path, id: path.split('/').pop(), collection: (name) => this.collection(`${path}/${name}`), get: async () => this.read({ path, document: true }),
      set: async (data, options) => this.set(path, data, options), document: true };
  }
  collection(path) { return this.query(path); }
  collectionGroup(path) { return this.query(path, true); }
  query(path, group = false, constraints = []) {
    const next = constraint => this.query(path, group, [...constraints, constraint]);
    return { path, group, constraints, doc: name => this.doc(`${path}/${name}`),
      where: (field, operator, value) => next([field, operator, value]),
      orderBy: (field, direction = 'asc') => next(['__order', field, direction]),
      limit: count => next(['__limit', count]), startAfter: (...values) => next(['__cursor', values]),
      get: async () => this.read({ path, group, constraints }) };
  }
  snapshot(path, records) {
    const data = records.get(path);
    return { exists: records.has(path), id: path.split('/').pop(), ref: this.doc(path), data: () => copy(data) };
  }
  read(ref, records = this.records) {
    if (ref.document) {
      this.readLog.push({ path: ref.path, document: true, reads: 1 });
      return this.snapshot(ref.path, records);
    }
    const constraints = ref.constraints || [];
    const compare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
    const valueOf = (path, data, field, expected) => field === '__name__'
      ? (ref.group && expected === undefined || expected?.path || typeof expected === 'string' && expected.includes('/') ? path : path.split('/').pop())
      : comparable(data[field]);
    const expectedOf = v => v?.path || comparable(v);
    let recordsInQuery = [...records].filter(([path, data]) =>
      (ref.group ? path.split('/').at(-2) === ref.path : path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/')) &&
      constraints.every(([field, operator, value]) => {
        if (['__limit', '__cursor', '__order'].includes(field)) return true;
        const actual = valueOf(path, data, field, value), expected = expectedOf(value);
        return operator === '>=' ? actual >= expected : operator === '>' ? actual > expected : operator === '<' ? actual < expected :
          operator === '<=' ? actual <= expected : operator === 'in' ? expected.includes(actual) :
          operator === 'array-contains' ? (actual || []).includes(value) : actual === expected;
      }));
    const order = constraints.filter(([field]) => field === '__order');
    if (!order.length) order.push(['__order', '__name__', 'asc']);
    const cursor = constraints.find(([field]) => field === '__cursor')?.[1];
    recordsInQuery.sort(([a, av], [b, bv]) => {
      for (const [, field, direction] of order) {
        const compared = compare(valueOf(a, av, field), valueOf(b, bv, field));
        if (compared) return direction === 'desc' ? -compared : compared;
      }
      return compare(a, b);
    });
    if (cursor) recordsInQuery = recordsInQuery.filter(([path, data]) => {
      for (let i = 0; i < cursor.length; i++) {
        const [, field, direction] = order[i], compared = compare(valueOf(path, data, field, cursor[i]), expectedOf(cursor[i]));
        if (compared) return direction === 'desc' ? compared < 0 : compared > 0;
      }
      return false;
    });
    const docs = recordsInQuery.slice(0, constraints.find(([key]) => key === '__limit')?.[1] ?? Infinity)
      .map(([path]) => this.snapshot(path, records));
    this.readLog.push({ path: ref.path, group: ref.group, constraints, reads: Math.max(1, docs.length) });
    return { docs, size: docs.length, empty: !docs.length };
  }
  set(path, data, options) {
    this.records.set(path, copy(options?.merge ? { ...this.records.get(path), ...data } : { ...data })); this.version += 1;
  }
  async runTransaction(callback) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const version = this.version, records = new Map(this.records), writes = [];
      const transaction = {
        get: async (ref) => { assert.equal(writes.length, 0, 'transaction reads must precede writes'); return this.read(ref, records); },
        set: (ref, data, options) => writes.push({ ref, data, options }), delete: (ref) => writes.push({ ref, remove: true }),
      };
      const result = await callback(transaction);
      if (this.beforeCommit) { const hook = this.beforeCommit; this.beforeCommit = null; hook(); }
      if (version !== this.version) continue;
      if (this.commitError) throw this.commitError;
      writes.forEach(({ ref, data, options, remove }) => remove ? this.records.delete(ref.path) : this.set(ref.path, data, options));
      return result;
    }
    throw new Error('Transaction retry limit');
  }
}

module.exports={MemoryFirestore};
