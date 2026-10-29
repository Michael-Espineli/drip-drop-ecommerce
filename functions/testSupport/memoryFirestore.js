const assert = require('node:assert/strict');
const copy = value => value instanceof Date ? new Date(value) : Array.isArray(value) ? value.map(copy) : value && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)])) : value;
const comparable = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value);
class MemoryFirestore {
  constructor(records) { this.records = new Map(Object.entries(records)); this.version = 0; }
  doc(path) {
    return { path, id: path.split('/').pop(), collection: (name) => this.collection(`${path}/${name}`), get: async () => this.read({ path, document: true }),
      set: async (data, options) => this.set(path, data, options), document: true };
  }
  collection(path) {
    const query = (constraints = []) => ({ path, constraints, doc: (name) => this.doc(`${path}/${name}`),
      where: (field, operator, value) => query([...constraints, [field, operator, value]]), orderBy: () => query(constraints),
      limit: (count) => query([...constraints, ["__limit", count]]), startAfter: (cursor) => query([...constraints, ["__cursor", cursor]]), get: async () => this.read({ path, constraints }) });
    return query();
  }
  read(ref, records = this.records) {
    if (ref.document) {
      const data = records.get(ref.path);
      return { exists: records.has(ref.path), id: ref.id || ref.path.split('/').pop(), ref: this.doc(ref.path), data: () => copy(data) };
    }
    const docs = [...records].filter(([path, data]) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/') && (ref.constraints || []).every(([field, operator, value]) => {
        if (field === "__limit") return true;
        if (field === "__cursor") return path.split("/").pop() > operator;
        const actual = comparable(data[field]), expected = comparable(value);
        return operator === ">=" ? actual >= expected : operator === ">" ? actual > expected : operator === "<" ? actual < expected : operator === "<=" ? actual <= expected : operator === "array-contains" ? (actual || []).includes(value) : actual === expected;
      }))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, ref.constraints?.find(([key]) => key === "__limit")?.[1] ?? Infinity)
      .map(([path]) => this.read(this.doc(path), records));
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
