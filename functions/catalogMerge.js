const { createHash } = require('node:crypto');
const { companyActor, can, documentId, fail } = require('./companyActor');

const unique = values => [...new Set(values.filter(Boolean))];
const ids = value => Array.isArray(value) ? value.filter(id => typeof id === 'string' && id && !id.includes('/')) : [];
const vendorIds = product => unique([...ids(product.vendorItemIds), ...ids(product.storeItemsIds), ...ids([product.preferredVendorItemId])]);
const retired = row => row.archived || row.mergedIntoProductId || row.mergedIntoVendorItemId;
const explicitProduct = row => row.productId || row.genericItemId || '';
const productName = row => row.name || row.commonName || row.specificName || row.description || 'Product';
const vendorName = row => row.name || row.description || row.sku || 'Vendor item';
const supplierId = row => String(row.vendorId || row.venderId || '').trim();
const supplierName = row => String(row.storeName || row.vendorName || '').trim().toLowerCase();

const queries = async (tx, refs) => {
  const results = await Promise.all(refs.map(ref => tx.get(ref)));
  return distinct(results.flatMap(result => result.docs));
};
const distinct = snapshots => [...new Map(snapshots.filter(snap => snap.exists).map(snap => [snap.ref.path, snap])).values()];
const readIds = async (tx, collection, values) => Promise.all(ids(unique(values)).map(id => tx.get(collection.doc(id))));
const productLinks = (products, id) => [
  products.where('vendorItemIds', 'array-contains', id),
  products.where('storeItemsIds', 'array-contains', id),
  products.where('preferredVendorItemId', '==', id),
];
const connection = (id, name) => ({ productId: id, genericItemId: id, productName: name, genericItemName: name });

const supplierLinks = (suppliers, preferred) => {
  const nextIds = suppliers.map(snap => snap.id).sort((left, right) => left.localeCompare(right));
  return {
    vendorItemIds: nextIds, storeItemsIds: nextIds,
    storeItems: unique(suppliers.map(snap => vendorName(snap.data()))).sort(),
    preferredVendorItemId: nextIds.includes(preferred) ? preferred : nextIds[0] || '',
  };
};

async function productPlan(tx, products, vendors, keep, source) {
  const sameRecords = [keep, source];
  const [reverse, listed] = await Promise.all([
    queries(tx, sameRecords.flatMap(({ id }) => ['productId', 'genericItemId'].map(field => vendors.where(field, '==', id)))),
    readIds(tx, vendors, sameRecords.flatMap(snap => vendorIds(snap.data()))),
  ]);
  const candidates = distinct([...reverse, ...listed]).filter(snap => !retired(snap.data()));
  const legacy = candidates.filter(snap => !explicitProduct(snap.data()));
  const legacyOwners = await Promise.all(legacy.map(snap => queries(tx, productLinks(products, snap.id))));
  const participating = new Set(sameRecords.map(snap => snap.id));
  const legacyById = new Map(legacy.map((snap, index) => {
    const owners = legacyOwners[index].filter(owner => !retired(owner.data())).map(owner => owner.id);
    if (owners.some(id => !participating.has(id)) && owners.some(id => participating.has(id))) {
      fail('failed-precondition', `Resolve the product connection for ${vendorName(snap.data())} before merging. It is listed on another product.`);
    }
    return [snap.id, owners];
  }));
  const ownedBy = snap => explicitProduct(snap.data()) ? [explicitProduct(snap.data())] : legacyById.get(snap.id);
  const connected = candidates.filter(snap => ownedBy(snap).some(id => participating.has(id)));
  const formerlyPreferred = snap => supplierLinks(connected.filter(vendor => {
    const owners = ownedBy(vendor);
    return owners.length === 1 && owners[0] === snap.id;
  }), snap.data().preferredVendorItemId).preferredVendorItemId;
  const sourcePreferred = connected.find(snap => snap.id === formerlyPreferred(source));
  const oldCost = sourcePreferred?.data().rate ?? sourcePreferred?.data().cost;
  const keepPreferred = keep.data().preferredVendorItemId;
  const preferred = connected.some(snap => snap.id === keepPreferred && ownedBy(snap).includes(keep.id))
    ? keepPreferred : formerlyPreferred(keep) || formerlyPreferred(source);
  const sourcePatch = {
    ...supplierLinks([], ''),
    availableForJobs: false, availableForJob: false, jobProductAvailable: false,
    availableForPartApproval: false, partApprovalAvailable: false, availableForCustomerSale: false,
    availableForPartPurchase: false, partPurchaseAvailable: false,
    ...(Number.isFinite(Number(oldCost)) && { defaultCostCents: Number(oldCost) }),
  };
  const nextLinks = supplierLinks(connected, preferred);
  const vendorWrites = connected.filter(snap => {
    const data = snap.data();
    return data.productId !== keep.id || data.genericItemId !== keep.id;
  });
  return {
    reads: [...candidates, ...legacyOwners.flat()],
    writes: [[keep, nextLinks], [source, sourcePatch],
      ...vendorWrites.map(snap => [snap, connection(keep.id, productName(keep.data()))])],
    summary: {
      vendorItemsToMove: vendorWrites.length,
      preferredVendorItem: connected.find(snap => snap.id === nextLinks.preferredVendorItemId)?.data() || null,
    },
  };
}

const dosageIds = dosage => unique([dosage.linkedItemIds, dosage.linkedItemId, dosage.linkedItem].flatMap(value =>
  Array.isArray(value) ? value : String(value || '').split(',').map(id => id.trim())
));

const updateDosageLinks = (snapshots, affected, replacement) => snapshots.flatMap(snap => {
  const previous = dosageIds(snap.data());
  if (!previous.some(id => affected.has(id))) return [];
  const next = unique(previous.map(id => affected.has(id) ? replacement : id));
  return [[snap, { linkedItem: '', linkedItemIds: next, linkedItemId: next[0] || '' }]];
});

async function vendorPlan(tx, products, vendors, dosages, keep, source) {
  const left = keep.data(), right = source.data();
  const differentSuppliers = supplierId(left) && supplierId(right)
    ? supplierId(left) !== supplierId(right)
    : supplierName(left) && supplierName(right) && supplierName(left) !== supplierName(right);
  if (differentSuppliers) fail('failed-precondition', 'Vendor items must belong to the same supplier to be merged.');

  const [keepLinks, sourceLinks, explicit, dosageSnap] = await Promise.all([
    queries(tx, productLinks(products, keep.id)), queries(tx, productLinks(products, source.id)),
    readIds(tx, products, [explicitProduct(left), explicitProduct(right)]), tx.get(dosages),
  ]);
  const allProducts = distinct([...keepLinks, ...sourceLinks, ...explicit]).filter(snap => !retired(snap.data()));
  const ownerIds = unique([[left, keepLinks], [right, sourceLinks]].flatMap(([data, links]) => {
    const explicitId = explicitProduct(data);
    return explicitId ? allProducts.filter(snap => snap.id === explicitId).map(snap => snap.id)
      : links.filter(snap => !retired(snap.data())).map(snap => snap.id);
  }));
  if (ownerIds.length > 1) fail('failed-precondition', 'These vendor items are linked to different products. Resolve the product connections before merging.');
  const owner = allProducts.find(snap => snap.id === ownerIds[0]);
  const otherVendors = await readIds(tx, vendors, allProducts.flatMap(snap => vendorIds(snap.data())));
  const byId = new Map(distinct(otherVendors).filter(snap => !retired(snap.data())).map(snap => [snap.id, snap]));
  const productWrites = allProducts.map(snap => {
    const data = snap.data();
    const nextIds = vendorIds(data).filter(id => id !== source.id && id !== keep.id);
    if (snap.id === owner?.id) nextIds.push(keep.id);
    const nextVendors = nextIds.map(id => id === keep.id ? keep : byId.get(id)).filter(Boolean);
    const preferred = data.preferredVendorItemId === source.id ? keep.id : data.preferredVendorItemId;
    return [snap, {
      ...supplierLinks(nextVendors, preferred),
      vendorItemIds: nextIds, storeItemsIds: nextIds,
    }];
  });
  const dosageWrites = updateDosageLinks(dosageSnap.docs, new Set([source.id]), keep.id);
  return {
    reads: [...allProducts, ...otherVendors],
    writes: [[keep, {
      ...connection(owner?.id || '', owner ? productName(owner.data()) : ''),
      ...(!supplierId(left) && supplierId(right) && { vendorId: supplierId(right), venderId: supplierId(right) }),
      ...(!supplierName(left) && supplierName(right) && { storeName: right.storeName || right.vendorName }),
    }], [source, connection('', '')],
      ...productWrites, ...dosageWrites],
    summary: { dosageTemplates: dosageWrites.length, connectedProduct: owner ? productName(owner.data()) : '' },
  };
}

const previewRecord = (snap, kind) => {
  const row = snap.data();
  return {
    id: snap.id, name: (kind === 'product' ? productName : vendorName)(row),
    sku: row.sku || '', unit: row.UOM || row.uom || '', size: row.size || '',
    supplier: row.storeName || row.vendorName || '', active: row.active !== false,
    priceCents: Number(kind === 'product' ? row.sellPrice ?? row.billingRate ?? row.defaultSellPrice ?? 0 : row.rate ?? row.cost ?? 0) || 0,
  };
};

function createCatalogMerge(db, now = () => new Date()) {
  return async function mergeCatalogDuplicates(request) {
    const { companyId: companyValue, keepId: keepValue, sourceId: sourceValue, kind, action, reviewToken } = request.data || {};
    const companyId = documentId(companyValue, 'Company');
    const keepId = documentId(keepValue, 'Record to keep');
    const sourceId = documentId(sourceValue, 'Duplicate record');
    if (keepId === sourceId || !['product', 'vendorItem'].includes(kind) || !['preview', 'merge'].includes(action)) {
      fail('invalid-argument', 'Choose two different records of the same type.');
    }

    return db.runTransaction(async tx => {
      const actor = await companyActor(db, tx, companyId, request.auth?.uid, request.auth?.token);
      if (!can(actor, '854')) fail('permission-denied', 'Update Catalog permission is required to merge duplicates.');
      const settings = `companies/${companyId}/settings`;
      const products = db.collection(`${settings}/genericItems/genericItems`);
      const vendors = db.collection(`${settings}/dataBase/dataBase`);
      const catalog = kind === 'product' ? products : vendors;
      const mergeField = kind === 'product' ? 'mergedIntoProductId' : 'mergedIntoVendorItemId';
      const [keep, source] = await Promise.all([tx.get(catalog.doc(keepId)), tx.get(catalog.doc(sourceId))]);
      if (!keep.exists || !source.exists) fail('not-found', 'One of these catalog records no longer exists.');
      if (action === 'merge' && source.data()[mergeField] === keepId) return { status: 'merged', keepId };
      if (retired(keep.data()) || retired(source.data())) fail('failed-precondition', 'One of these records has already been merged or archived. Refresh the catalog and choose another record.');

      const plan = kind === 'product' ? await productPlan(tx, products, vendors, keep, source)
        : await vendorPlan(tx, products, vendors, db.collection(`${settings}/dosages/dosages`), keep, source);
      if (plan.writes.length > 450) fail('failed-precondition', 'These records have too many live links for a single merge.');
      const versions = distinct([keep, source, ...plan.reads, ...plan.writes.map(([snap]) => snap)])
        .map(snap => [snap.ref.path, snap.updateTime ? [snap.updateTime.seconds, snap.updateTime.nanoseconds] : snap.data()])
        .sort(([left], [right]) => left.localeCompare(right));
      const token = createHash('sha256').update(JSON.stringify([kind, keep.ref.path, source.ref.path, versions])).digest('hex');
      if (action === 'preview') {
        const { preferredVendorItem, ...summary } = plan.summary;
        return { status: 'review', reviewToken: token, keep: previewRecord(keep, kind), source: previewRecord(source, kind),
          summary: { ...summary, preferredVendorItem: preferredVendorItem ? vendorName(preferredVendorItem) : '' } };
      }
      if (reviewToken !== token) fail('aborted', 'Catalog records changed. Review the merge again before confirming.');

      const time = now();
      for (const [snap, patch] of plan.writes) {
        const isSource = snap.ref.path === source.ref.path, isKeep = snap.ref.path === keep.ref.path;
        tx.set(snap.ref, {
          ...patch, updatedAt: time, dateUpdated: time,
          ...(isSource && { [mergeField]: keep.id, active: false, archived: true, mergedAt: time, mergedBy: actor.uid }),
          ...(isKeep && { mergedSourceIds: unique([...ids(keep.data().mergedSourceIds), source.id, ...ids(source.data().mergedSourceIds)]) }),
        }, { merge: true });
      }
      return { status: 'merged', keepId };
    });
  };
}

function createCatalogProductDeletion(db, now = () => new Date()) {
  return async function deleteCatalogProductAndVendorItems(request) {
    const data = request.data || {};
    const companyId = documentId(data.companyId, 'Company');
    const productId = documentId(data.productId, 'Product');
    if (!Array.isArray(data.vendorItemIds) || !data.vendorItemIds.length || data.vendorItemIds.length > 450) {
      fail('invalid-argument', 'Choose the linked vendor items to delete.');
    }
    const deleteIds = new Set(data.vendorItemIds.map(id => documentId(id, 'Vendor item')));
    return db.runTransaction(async tx => {
      const actor = await companyActor(db, tx, companyId, request.auth?.uid, request.auth?.token);
      if (!can(actor, '856')) fail('permission-denied', 'Delete Catalog permission is required.');
      const settings = `companies/${companyId}/settings`;
      const products = db.collection(`${settings}/genericItems/genericItems`);
      const vendors = db.collection(`${settings}/dataBase/dataBase`);
      const product = await tx.get(products.doc(productId));
      if (!product.exists) return { status: 'deleted' };
      if (retired(product.data()) || product.data().mergedSourceIds?.length) {
        fail('failed-precondition', 'Products in a merge are kept for catalog history.');
      }
      const listedIds = vendorIds(product.data());
      const [reverse, listed, dosageTemplates, owners] = await Promise.all([
        queries(tx, ['productId', 'genericItemId'].map(field => vendors.where(field, '==', productId))),
        readIds(tx, vendors, [...listedIds, ...deleteIds]),
        tx.get(db.collection(`${settings}/dosages/dosages`)),
        queries(tx, [...deleteIds].flatMap(id => productLinks(products, id))),
      ]);
      const suppliers = distinct([...reverse, ...listed]);
      for (const id of deleteIds) {
        const vendor = suppliers.find(snap => snap.id === id)?.data();
        const belongsToProduct = vendor && (explicitProduct(vendor) ? explicitProduct(vendor) === productId : listedIds.includes(id));
        const otherOwner = owners.some(snap => snap.id !== productId && !retired(snap.data()) && vendorIds(snap.data()).includes(id));
        if (!belongsToProduct || otherOwner || [vendor.productId, vendor.genericItemId].some(ownerId => ownerId && ownerId !== productId)) {
          fail('failed-precondition', 'A selected vendor item is missing or is linked to another product. Refresh the catalog and review the connections.');
        }
        if (retired(vendor) || vendor.mergedSourceIds?.length) fail('failed-precondition', 'Vendor items in a merge are kept for catalog history.');
      }
      const disconnect = reverse.filter(snap => !deleteIds.has(snap.id) && !retired(snap.data()));
      const dosageWrites = updateDosageLinks(dosageTemplates.docs, deleteIds, '');
      if (1 + deleteIds.size + disconnect.length + dosageWrites.length > 450) {
        fail('failed-precondition', 'These items have too many live links for a single deletion.');
      }
      const time = now();
      for (const snap of disconnect) {
        const current = snap.data();
        const patch = { updatedAt: time, dateUpdated: time };
        if (current.productId === productId) Object.assign(patch, { productId: '', productName: '' });
        if (current.genericItemId === productId) Object.assign(patch, { genericItemId: '', genericItemName: '' });
        tx.set(snap.ref, patch, { merge: true });
      }
      for (const [snap, patch] of dosageWrites) tx.set(snap.ref, { ...patch, updatedAt: time, dateUpdated: time }, { merge: true });
      for (const id of deleteIds) tx.delete(vendors.doc(id));
      tx.delete(product.ref);
      return { status: 'deleted' };
    });
  };
}

module.exports = { createCatalogMerge, createCatalogProductDeletion };
