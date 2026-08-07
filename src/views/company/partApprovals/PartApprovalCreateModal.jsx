import React, { useContext, useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import { itemPhotoFieldsFromSource } from '../../../utils/itemPhotos';
import { buildPartApprovalShoppingItemPayload } from '../../../utils/partApprovalShopping';

const selectStyles = {
  control: (provided) => ({
    ...provided,
    minHeight: '42px',
    borderColor: '#cbd5e1',
    borderRadius: '0.375rem',
    boxShadow: 'none',
  }),
  menu: (provided) => ({
    ...provided,
    zIndex: 80,
  }),
};

const toCentsFromDollars = (value) => {
  const amount = Number.parseFloat(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const formatCurrency = (amountCents = 0) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format((Number(amountCents) || 0) / 100);

const getCustomerName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return customer.companyName || customer.company || customer.displayName || 'Customer';
  }

  return (
    customer.displayName ||
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
    customer.companyName ||
    customer.company ||
    customer.email ||
    'Customer'
  );
};

const getCustomerEmail = (customer = {}) => (
  customer.email ||
  customer.billingEmail ||
  customer.customerEmail ||
  customer.receiverEmail ||
  ''
);

const getCustomerUserId = (customer = {}) => (
  customer.customerUserId ||
  customer.userId ||
  customer.uid ||
  customer.linkedCustomerUserId ||
  customer.linkedHomeownerUserId ||
  customer.homeownerUserId ||
  customer.homeownerId ||
  ''
);

const normalizeCustomerOption = (docId, data = {}) => {
  const id = data.id || docId;
  const name = getCustomerName(data);
  const email = getCustomerEmail(data);

  return {
    ...data,
    id,
    name,
    email,
    customerUserId: getCustomerUserId(data),
    label: [name, email].filter(Boolean).join(' - '),
    value: id,
  };
};

const asText = (value) => (typeof value === 'string' || typeof value === 'number'
  ? String(value).trim()
  : '');

const getAddressParts = (data = {}) => {
  const address = data.address && typeof data.address === 'object' ? data.address : {};
  const serviceAddress = data.serviceAddress && typeof data.serviceAddress === 'object' ? data.serviceAddress : {};
  const billingAddress = data.billingAddress && typeof data.billingAddress === 'object' ? data.billingAddress : {};

  return {
    streetAddress:
      asText(data.streetAddress) ||
      asText(data.address) ||
      asText(data.addressLine1) ||
      asText(data.line1) ||
      asText(address.streetAddress) ||
      asText(address.address) ||
      asText(address.addressLine1) ||
      asText(address.line1) ||
      asText(serviceAddress.streetAddress) ||
      asText(serviceAddress.address) ||
      asText(billingAddress.streetAddress) ||
      asText(billingAddress.address),
    city:
      asText(data.city) ||
      asText(address.city) ||
      asText(serviceAddress.city) ||
      asText(billingAddress.city),
    state:
      asText(data.state) ||
      asText(address.state) ||
      asText(serviceAddress.state) ||
      asText(billingAddress.state),
    zip:
      asText(data.zip) ||
      asText(data.zipCode) ||
      asText(address.zip) ||
      asText(address.zipCode) ||
      asText(serviceAddress.zip) ||
      asText(serviceAddress.zipCode) ||
      asText(billingAddress.zip) ||
      asText(billingAddress.zipCode),
  };
};

const normalizeServiceLocationOption = (docId, data = {}) => {
  const id = data.id || docId;
  const addressParts = getAddressParts(data);
  const name =
    asText(data.nickName) ||
    asText(data.name) ||
    addressParts.streetAddress ||
    'Service Location';
  const address = [
    addressParts.streetAddress,
    addressParts.city,
    addressParts.state,
    addressParts.zip,
  ].filter(Boolean).join(', ');

  return {
    ...data,
    id,
    name,
    streetAddress: addressParts.streetAddress,
    city: addressParts.city,
    state: addressParts.state,
    zip: addressParts.zip,
    label: address ? `${name} - ${address}` : name,
    value: id,
  };
};

const normalizeDbItemOption = (docId, data = {}) => {
  const id = data.id || docId;
  const name = data.name || 'Unnamed Item';
  const unitCostCents = Number(data.rate || data.cost || 0);
  const unitPriceCents = Number(data.sellPrice || data.rate || data.cost || 0);
  const photoFields = itemPhotoFieldsFromSource(data, name);

  return {
    ...data,
    id,
    name,
    description: data.description || '',
    genericItemId: data.genericItemId || '',
    dbItemId: id,
    unitCostCents,
    unitPriceCents,
    ...photoFields,
    label: `${name} (${formatCurrency(unitPriceCents)})`,
    value: id,
  };
};

const initialForm = {
  mode: 'database',
  name: '',
  description: '',
  quantity: '1',
  unitCost: '',
  unitPrice: '',
};

const timestampFromValue = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value;
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const PartApprovalCreateModal = ({
  open,
  onClose,
  fixedCustomer = null,
  fixedServiceLocation = null,
  workflowContext = {},
  hideCost = false,
  allowInPersonApproval = false,
  onCreated,
}) => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, user, dataBaseUser } = useContext(Context);
  const [customers, setCustomers] = useState([]);
  const [dbItems, setDbItems] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedDbItem, setSelectedDbItem] = useState(null);
  const [selectedServiceLocation, setSelectedServiceLocation] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fixedCustomerOption = useMemo(() => (
    fixedCustomer ? normalizeCustomerOption(fixedCustomer.id, fixedCustomer) : null
  ), [fixedCustomer]);
  const fixedServiceLocationOption = useMemo(() => (
    fixedServiceLocation ? normalizeServiceLocationOption(fixedServiceLocation.id, fixedServiceLocation) : null
  ), [fixedServiceLocation]);

  useEffect(() => {
    if (!open) return;

    setForm(initialForm);
    setSelectedDbItem(null);
    setSelectedServiceLocation(fixedServiceLocationOption);
    setSelectedCustomer(fixedCustomerOption);
  }, [fixedCustomerOption, fixedServiceLocationOption, open]);

  useEffect(() => {
    if (!open || !recentlySelectedCompany) return undefined;

    let active = true;

    const loadOptions = async () => {
      setLoading(true);

      try {
        const itemsPromise = getDocs(collection(db, 'companies', recentlySelectedCompany, 'settings', 'dataBase', 'dataBase'));
        const customersPromise = fixedCustomerOption
          ? Promise.resolve(null)
          : getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers'));

        const [itemsSnap, customersSnap] = await Promise.all([itemsPromise, customersPromise]);
        if (!active) return;

        setDbItems(
          itemsSnap.docs
            .map((itemDoc) => normalizeDbItemOption(itemDoc.id, itemDoc.data()))
            .sort((left, right) => left.name.localeCompare(right.name))
        );

        if (customersSnap) {
          setCustomers(
            customersSnap.docs
              .map((customerDoc) => normalizeCustomerOption(customerDoc.id, customerDoc.data()))
              .filter((customer) => customer.active !== false && customer.isActive !== false)
              .sort((left, right) => left.name.localeCompare(right.name))
          );
        } else {
          setCustomers([]);
        }
      } catch (loadError) {
        console.error('Unable to load part approval options', loadError);
        toast.error('Unable to load part approval options.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOptions();

    return () => {
      active = false;
    };
  }, [fixedCustomerOption, open, recentlySelectedCompany]);

  useEffect(() => {
    if (!open || !recentlySelectedCompany || !selectedCustomer?.id) {
      setServiceLocations([]);
      setSelectedServiceLocation(null);
      return undefined;
    }

    if (fixedServiceLocationOption) {
      setServiceLocations([fixedServiceLocationOption]);
      setSelectedServiceLocation(fixedServiceLocationOption);
      return undefined;
    }

    let active = true;

    const loadServiceLocations = async () => {
      try {
        const locationSnap = await getDocs(
          query(
            collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'),
            where('customerId', '==', selectedCustomer.id)
          )
        );

        if (!active) return;

        setServiceLocations(
          locationSnap.docs
            .map((locationDoc) => normalizeServiceLocationOption(locationDoc.id, locationDoc.data()))
            .sort((left, right) => left.name.localeCompare(right.name))
        );
      } catch (locationError) {
        console.error('Unable to load service locations for part approval', locationError);
        setServiceLocations([]);
      }
    };

    loadServiceLocations();

    return () => {
      active = false;
    };
  }, [fixedServiceLocationOption, open, recentlySelectedCompany, selectedCustomer?.id]);

  const quantity = Number.parseFloat(form.quantity || '0') || 0;
  const unitCostCents = form.mode === 'database'
    ? Number(selectedDbItem?.unitCostCents || 0)
    : toCentsFromDollars(form.unitCost);
  const unitPriceCents = form.mode === 'database'
    ? Number(selectedDbItem?.unitPriceCents || 0)
    : toCentsFromDollars(form.unitPrice);
  const totalCostCents = Math.round(unitCostCents * quantity);
  const totalPriceCents = Math.round(unitPriceCents * quantity);

  const itemName = form.mode === 'database'
    ? selectedDbItem?.name || ''
    : form.name.trim();
  const itemDescription = form.mode === 'database'
    ? selectedDbItem?.description || form.description || ''
    : form.description.trim();

  const canSave = Boolean(
    recentlySelectedCompany &&
    selectedCustomer?.id &&
    itemName &&
    quantity > 0 &&
    unitPriceCents > 0
  );

  const findLinkedCustomerUserId = async (customer) => {
    const directUserId = getCustomerUserId(customer);
    if (directUserId) return directUserId;

    const email = getCustomerEmail(customer).trim();
    if (!email) return '';

    const userSnap = await getDocs(query(collection(db, 'users'), where('email', '==', email), limit(1)));
    if (!userSnap.empty) return userSnap.docs[0].id;

    const normalizedEmail = email.toLowerCase();
    if (normalizedEmail === email) return '';

    const normalizedSnap = await getDocs(query(collection(db, 'users'), where('email', '==', normalizedEmail), limit(1)));
    return normalizedSnap.empty ? '' : normalizedSnap.docs[0].id;
  };

  const handleDbItemChange = (option) => {
    setSelectedDbItem(option);
    setForm((current) => ({
      ...current,
      name: option?.name || '',
      description: option?.description || '',
    }));
  };

  const createApproval = async (approvalMode = 'pending') => {
    if (!canSave || saving) return;

    const approvedInPerson = approvalMode === 'approved';
    if (approvedInPerson && !allowInPersonApproval) return;

    setSaving(true);

    try {
      const customerUserId = await findLinkedCustomerUserId(selectedCustomer);
      const customerEmail = getCustomerEmail(selectedCustomer);
      const approvalId = `cpa_${uuidv4()}`;
      const shoppingListItemId = approvedInPerson ? `comp_shop_${uuidv4()}` : '';
      const serviceLocationSnapshot = selectedServiceLocation
        ? {
          id: selectedServiceLocation.id,
          name: selectedServiceLocation.name || '',
          nickName: selectedServiceLocation.nickName || selectedServiceLocation.name || '',
          streetAddress: selectedServiceLocation.streetAddress || '',
          city: selectedServiceLocation.city || '',
          state: selectedServiceLocation.state || '',
          zip: selectedServiceLocation.zip || '',
        }
        : {};
      const scheduledDate = timestampFromValue(workflowContext?.scheduledDate || workflowContext?.serviceDate);
      const techId =
        workflowContext?.techId ||
        workflowContext?.assignedTechId ||
        workflowContext?.assignedToUserId ||
        workflowContext?.userId ||
        '';
      const techName =
        workflowContext?.techName ||
        workflowContext?.technicianName ||
        workflowContext?.assignedTechName ||
        workflowContext?.assignedToUserName ||
        workflowContext?.userName ||
        '';
      const photoFields = form.mode === 'database'
        ? itemPhotoFieldsFromSource(selectedDbItem, itemName || 'Part photo')
        : {};
      const now = serverTimestamp();
      const historyNow = new Date();
      const requestedByName =
        `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() ||
        dataBaseUser?.userName ||
        user?.displayName ||
        user?.email ||
        '';

      const payload = {
        id: approvalId,
        companyId: recentlySelectedCompany,
        companyName: recentlySelectedCompanyName || '',
        customerApprovalUrl: `${window.location.origin}/customer/part-approvals/${approvalId}`,
        customerId: selectedCustomer.id,
        customerUserId: customerUserId || null,
        customerName: selectedCustomer.name || getCustomerName(selectedCustomer),
        customerEmail,
        email: customerEmail,
        billingEmail: selectedCustomer.billingEmail || customerEmail,
        serviceLocationId: selectedServiceLocation?.id || '',
        serviceLocationName: selectedServiceLocation?.name || '',
        serviceLocationAddress: workflowContext?.serviceLocationAddress || '',
        serviceLocationSnapshot,
        shoppingListItemId,
        shoppingListPath: shoppingListItemId
          ? `companies/${recentlySelectedCompany}/shoppingList/${shoppingListItemId}`
          : '',
        itemName,
        name: itemName,
        description: itemDescription,
        quantity: String(quantity),
        dbItemId: form.mode === 'database' ? selectedDbItem?.id || '' : '',
        dbItemName: form.mode === 'database' ? selectedDbItem?.name || '' : '',
        genericItemId: form.mode === 'database' ? selectedDbItem?.genericItemId || '' : '',
        subCategory: form.mode === 'database' ? 'Data Base' : 'Part',
        plannedUnitCostCents: unitCostCents,
        plannedUnitPriceCents: unitPriceCents,
        plannedTotalCostCents: totalCostCents,
        plannedTotalPriceCents: totalPriceCents,
        status: approvedInPerson ? 'approved' : 'pending',
        approvalStatus: approvedInPerson ? 'approved' : 'pending',
        fulfillmentStatus: approvedInPerson ? 'approvedAwaitingPurchase' : 'awaitingCustomerApproval',
        sourceType: 'partApprovalRequest',
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
        requestedByUserId: user?.uid || dataBaseUser?.id || '',
        requestedByUserName: requestedByName,
        jobId: workflowContext?.jobId || '',
        jobName: workflowContext?.jobName || workflowContext?.jobInternalId || '',
        jobInternalId: workflowContext?.jobInternalId || '',
        linkedTaskId: workflowContext?.linkedTaskId || '',
        linkedTaskName: workflowContext?.linkedTaskName || '',
        linkedTaskType: workflowContext?.linkedTaskType || '',
        serviceStopId: workflowContext?.serviceStopId || '',
        serviceStopInternalId: workflowContext?.serviceStopInternalId || '',
        scheduledServiceStopId: workflowContext?.serviceStopId || '',
        scheduledServiceStopInternalId: workflowContext?.serviceStopInternalId || '',
        scheduledDate,
        techId,
        techName,
        assignedTechId: techId,
        assignedTechName: techName,
        assignedToUserId: techId,
        assignedToUserName: techName,
        assignedTechIds: techId ? [techId] : [],
        assignedTechNames: techName ? [techName] : [],
        purchaserId: techId,
        purchaserName: techName,
        history: [
          {
            id: `cpa_hist_${uuidv4()}`,
            action: 'requested',
            status: approvedInPerson ? 'approved' : 'pending',
            note: itemDescription,
            source: 'companyWeb',
            sourceLabel: 'Company web app',
            actorUserId: user?.uid || dataBaseUser?.id || '',
            actorUserName: requestedByName,
            actorEmail: user?.email || '',
            customerId: selectedCustomer.id,
            customerName: selectedCustomer.name || getCustomerName(selectedCustomer),
            createdAt: historyNow,
          },
          ...(approvedInPerson
            ? [{
              id: `cpa_hist_${uuidv4()}`,
              action: 'technicianApproved',
              status: 'approved',
              note: 'Approved in person',
              source: 'technicianOnBehalfOfCustomer',
              sourceLabel: 'Technician on behalf of customer',
              actorUserId: user?.uid || dataBaseUser?.id || '',
              actorUserName: requestedByName,
              actorEmail: user?.email || '',
              customerId: selectedCustomer.id,
              customerName: selectedCustomer.name || getCustomerName(selectedCustomer),
              createdAt: historyNow,
            }]
            : []),
        ],
        prepKeys: [
          workflowContext?.jobId ? `job:${workflowContext.jobId}` : '',
          selectedCustomer?.id ? `customer:${selectedCustomer.id}` : '',
          selectedServiceLocation?.id ? `serviceLocation:${selectedServiceLocation.id}` : '',
          workflowContext?.serviceStopId ? `serviceStop:${workflowContext.serviceStopId}` : '',
          workflowContext?.linkedTaskId ? `jobTask:${workflowContext.linkedTaskId}` : '',
          techId ? `user:${techId}` : '',
        ].filter(Boolean),
        ...photoFields,
        ...(approvedInPerson
          ? {
            response: 'approved',
            responseNote: 'Approved in person',
            respondedAt: now,
            respondedByUserId: user?.uid || '',
            respondedByUserName:
              `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() ||
              dataBaseUser?.userName ||
              user?.displayName ||
              user?.email ||
              '',
            respondedByEmail: user?.email || '',
            approvedInPerson: true,
            inPersonApprovedByUserId: user?.uid || '',
            shoppingListGeneratedAt: now,
          }
          : {}),
      };

      if (approvedInPerson) {
        const batch = writeBatch(db);
        batch.set(doc(db, 'customerPartApprovals', approvalId), payload);
        batch.set(
          doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId),
          buildPartApprovalShoppingItemPayload({
            approval: payload,
            shoppingListItemId,
            now,
            generated: true,
          }),
          { merge: true }
        );
        await batch.commit();
      } else {
        await setDoc(doc(db, 'customerPartApprovals', approvalId), payload);
      }

      toast.success(approvedInPerson
        ? 'Part approved and added to the shopping list.'
        : customerUserId
          ? 'Part approval created.'
          : 'Part approval created. Link the customer account so it appears in their portal.');
      onCreated?.(payload);
      onClose?.();
    } catch (saveError) {
      console.error('Unable to create part approval', saveError);
      toast.error(saveError.message || 'Unable to create part approval.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await createApproval('pending');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Customer approval</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">New Part Approval</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Customer</label>
              {fixedCustomerOption ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                  {fixedCustomerOption.label}
                </div>
              ) : (
                <Select
                  value={selectedCustomer}
                  options={customers}
                  onChange={setSelectedCustomer}
                  isLoading={loading}
                  isSearchable
                  placeholder="Select a customer"
                  styles={selectStyles}
                />
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Service Location</label>
              <Select
                value={selectedServiceLocation}
                options={serviceLocations}
                onChange={setSelectedServiceLocation}
                isClearable
                isDisabled={!selectedCustomer || Boolean(fixedServiceLocationOption)}
                placeholder="Optional location"
                styles={selectStyles}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Item Type</label>
              <select
                value={form.mode}
                onChange={(event) => {
                  setSelectedDbItem(null);
                  setForm({ ...initialForm, mode: event.target.value });
                }}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="database">Database Item</option>
                <option value="manual">Manual Part</option>
              </select>
            </div>

            {form.mode === 'database' ? (
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Database Item</label>
                <Select
                  value={selectedDbItem}
                  options={dbItems}
                  onChange={handleDbItemChange}
                  isLoading={loading}
                  isSearchable
                  placeholder="Select an item"
                  styles={selectStyles}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Part Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Part name"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Unit Price</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unitPrice}
                    onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Customer price"
                  />
                </div>
              </>
            )}

            {form.mode === 'manual' && !hideCost && (
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Unit Cost</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unitCost}
                  onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Internal cost"
                />
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Quantity</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.quantity}
                onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Customer Note</label>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[110px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Explain why the part is needed"
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Unit Price</p>
                <p className="mt-1 font-semibold text-slate-950">{formatCurrency(unitPriceCents)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Quantity</p>
                <p className="mt-1 font-semibold text-slate-950">{quantity || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer Total</p>
                <p className="mt-1 font-semibold text-slate-950">{formatCurrency(totalPriceCents)}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave || saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Creating...' : 'Create Customer Approval'}
            </button>
            {allowInPersonApproval && (
              <button
                type="button"
                onClick={() => createApproval('approved')}
                disabled={!canSave || saving}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Approved In Person'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default PartApprovalCreateModal;
