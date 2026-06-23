import React, { useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
  FaBuilding,
  FaEdit,
  FaExclamationTriangle,
  FaGlobe,
  FaMapMarkerAlt,
  FaPlus,
  FaSave,
  FaSearch,
  FaSyncAlt,
  FaTimes,
  FaTools,
  FaTrash,
} from 'react-icons/fa';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { MultiLocationMap } from '../../components/MultiLocationMap';

const GOOGLE_MAPS_GEOCODE_KEY = 'AIzaSyCeLjQNGFZ6W7pIYIXECBq7N47TBNKhivE';

const SERVICE_OPTIONS = [
  { value: 'pool_cleaning', label: 'Pool Cleaning' },
  { value: 'equipment_repair', label: 'Equipment Repair' },
  { value: 'chemical_balancing', label: 'Chemical Balancing' },
  { value: 'leak_detection', label: 'Leak Detection' },
  { value: 'pool_inspection', label: 'Pool Inspection' },
  { value: 'filter_cleaning', label: 'Filter Cleaning' },
  { value: 'cartridge_filter_replacement', label: 'Cartridge Filter Replacement' },
  { value: 'de_filter_service', label: 'DE Filter Service' },
  { value: 'sand_filter_service', label: 'Sand Filter Service' },
  { value: 'pump_repair', label: 'Pump Repair' },
  { value: 'pump_replacement', label: 'Pump Replacement' },
  { value: 'variable_speed_pump_installation', label: 'Variable Speed Pump Installation' },
  { value: 'motor_replacement', label: 'Motor Replacement' },
  { value: 'heater_repair', label: 'Heater Repair' },
  { value: 'heater_installation', label: 'Heater Installation' },
  { value: 'heat_pump_service', label: 'Heat Pump Service' },
  { value: 'automation_setup', label: 'Automation Setup' },
  { value: 'automation_repair', label: 'Automation Repair' },
  { value: 'salt_system_installation', label: 'Salt System Installation' },
  { value: 'salt_cell_cleaning', label: 'Salt Cell Cleaning' },
  { value: 'salt_cell_replacement', label: 'Salt Cell Replacement' },
  { value: 'chlorine_generator_service', label: 'Chlorine Generator Service' },
  { value: 'pool_opening', label: 'Pool Opening' },
  { value: 'pool_closing', label: 'Pool Closing' },
  { value: 'green_pool_cleanup', label: 'Green Pool Cleanup' },
  { value: 'algae_treatment', label: 'Algae Treatment' },
  { value: 'black_algae_treatment', label: 'Black Algae Treatment' },
  { value: 'phosphate_treatment', label: 'Phosphate Treatment' },
  { value: 'water_testing', label: 'Water Testing' },
  { value: 'water_chemistry_startup', label: 'Water Chemistry Startup' },
  { value: 'acid_wash', label: 'Acid Wash' },
  { value: 'chlorine_wash', label: 'Chlorine Wash' },
  { value: 'tile_cleaning', label: 'Tile Cleaning' },
  { value: 'tile_repair', label: 'Tile Repair' },
  { value: 'coping_repair', label: 'Coping Repair' },
  { value: 'plaster_repair', label: 'Plaster Repair' },
  { value: 'resurfacing_consultation', label: 'Resurfacing Consultation' },
  { value: 'pool_remodeling_consultation', label: 'Pool Remodeling Consultation' },
  { value: 'pool_light_repair', label: 'Pool Light Repair' },
  { value: 'led_light_upgrade', label: 'LED Light Upgrade' },
  { value: 'gfci_troubleshooting', label: 'GFCI Troubleshooting' },
  { value: 'electrical_diagnostics', label: 'Electrical Diagnostics' },
  { value: 'plumbing_leak_repair', label: 'Plumbing Leak Repair' },
  { value: 'valve_repair', label: 'Valve Repair' },
  { value: 'valve_replacement', label: 'Valve Replacement' },
  { value: 'skimmer_repair', label: 'Skimmer Repair' },
  { value: 'skimmer_replacement', label: 'Skimmer Replacement' },
  { value: 'main_drain_service', label: 'Main Drain Service' },
  { value: 'return_line_repair', label: 'Return Line Repair' },
  { value: 'vacuum_line_repair', label: 'Vacuum Line Repair' },
  { value: 'cleaner_repair', label: 'Cleaner Repair' },
  { value: 'robotic_cleaner_setup', label: 'Robotic Cleaner Setup' },
  { value: 'pressure_cleaner_service', label: 'Pressure Cleaner Service' },
  { value: 'suction_cleaner_service', label: 'Suction Cleaner Service' },
  { value: 'pool_cover_installation', label: 'Pool Cover Installation' },
  { value: 'pool_cover_repair', label: 'Pool Cover Repair' },
  { value: 'safety_cover_service', label: 'Safety Cover Service' },
  { value: 'solar_cover_service', label: 'Solar Cover Service' },
  { value: 'solar_heating_repair', label: 'Solar Heating Repair' },
  { value: 'solar_heating_installation', label: 'Solar Heating Installation' },
  { value: 'spa_cleaning', label: 'Spa Cleaning' },
  { value: 'spa_chemical_service', label: 'Spa Chemical Service' },
  { value: 'spa_heater_repair', label: 'Spa Heater Repair' },
  { value: 'spa_jet_repair', label: 'Spa Jet Repair' },
  { value: 'spa_drain_and_fill', label: 'Spa Drain and Fill' },
  { value: 'water_feature_repair', label: 'Water Feature Repair' },
  { value: 'fountain_service', label: 'Fountain Service' },
  { value: 'waterfall_service', label: 'Waterfall Service' },
  { value: 'deck_jet_repair', label: 'Deck Jet Repair' },
  { value: 'autofill_repair', label: 'Autofill Repair' },
  { value: 'autofill_installation', label: 'Autofill Installation' },
  { value: 'pool_drain_and_refill', label: 'Pool Drain and Refill' },
  { value: 'calcium_removal', label: 'Calcium Removal' },
  { value: 'scale_treatment', label: 'Scale Treatment' },
  { value: 'stain_treatment', label: 'Stain Treatment' },
  { value: 'metal_sequestration', label: 'Metal Sequestration' },
  { value: 'enzyme_treatment', label: 'Enzyme Treatment' },
  { value: 'filter_pressure_diagnostics', label: 'Filter Pressure Diagnostics' },
  { value: 'flow_issue_diagnostics', label: 'Flow Issue Diagnostics' },
  { value: 'air_leak_diagnostics', label: 'Air Leak Diagnostics' },
  { value: 'priming_issue_repair', label: 'Priming Issue Repair' },
  { value: 'equipment_pad_inspection', label: 'Equipment Pad Inspection' },
  { value: 'equipment_pad_plumbing', label: 'Equipment Pad Plumbing' },
  { value: 'equipment_upgrade_consultation', label: 'Equipment Upgrade Consultation' },
  { value: 'new_pool_startup', label: 'New Pool Startup' },
  { value: 'pool_school_orientation', label: 'Pool School Orientation' },
  { value: 'weekly_maintenance', label: 'Weekly Maintenance' },
  { value: 'biweekly_maintenance', label: 'Biweekly Maintenance' },
  { value: 'one_time_cleaning', label: 'One Time Cleaning' },
  { value: 'vacation_pool_care', label: 'Vacation Pool Care' },
  { value: 'storm_cleanup', label: 'Storm Cleanup' },
  { value: 'debris_removal', label: 'Debris Removal' },
  { value: 'fire_ash_cleanup', label: 'Fire Ash Cleanup' },
  { value: 'hoa_pool_maintenance', label: 'HOA Pool Maintenance' },
  { value: 'commercial_pool_maintenance', label: 'Commercial Pool Maintenance' },
  { value: 'apartment_pool_service', label: 'Apartment Pool Service' },
  { value: 'hotel_pool_service', label: 'Hotel Pool Service' },
  { value: 'municipal_pool_service', label: 'Municipal Pool Service' },
  { value: 'warranty_inspection', label: 'Warranty Inspection' },
  { value: 'pre_purchase_pool_inspection', label: 'Pre-Purchase Pool Inspection' },
];

const toList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
};

const listToText = (value, formatter = (item) => item) => toList(value).map(formatter).join(', ');

const labelize = (value) => String(value || '')
  .replace(/([A-Z])/g, ' $1')
  .replace(/[_-]/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const formatOfferingLabel = (value) => {
  const text = String(value || '').trim();
  const option = SERVICE_OPTIONS.find((service) => (
    service.value.toLowerCase() === text.toLowerCase()
    || service.label.toLowerCase() === text.toLowerCase()
  ));

  return option?.label || labelize(text);
};

const getOfferingOption = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;

  return SERVICE_OPTIONS.find((service) => (
    service.value.toLowerCase() === text.toLowerCase()
    || service.label.toLowerCase() === text.toLowerCase()
  )) || null;
};

const normalizeOfferingValue = (value) => {
  const text = String(value || '').trim();
  const option = getOfferingOption(text);

  return option?.value || text;
};

const normalizeOfferingList = (value) => {
  const uniqueValues = new Map();
  toList(value).forEach((item) => {
    const normalized = normalizeOfferingValue(item);
    if (normalized) {
      uniqueValues.set(normalized.toLowerCase(), normalized);
    }
  });

  return [...uniqueValues.values()];
};

const safeHref = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(https?:|mailto:|tel:)/i.test(text)) return text;
  return `https://${text}`;
};

const formatDate = (value) => {
  if (!value) return 'Not synced';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not synced';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
};

const normalizeCompanyData = (company = {}) => ({
  ...company,
  serviceZipCodes: toList(company.serviceZipCodes),
  serviceAreas: toList(company.serviceAreas),
  services: toList(company.services),
});

const compactList = (items, limit = 4, formatter = (item) => item) => {
  const list = toList(items);
  if (list.length === 0) return 'Not set';
  const visible = list.slice(0, limit).map(formatter).join(', ');
  return list.length > limit ? `${visible} +${list.length - limit} more` : visible;
};

const getLocationZip = (location = {}) => String(
  location.address?.zip
  || location.address?.zipCode
  || location.zip
  || location.zipCode
  || ''
).trim();

const getLocationArea = (location = {}) => {
  const city = String(location.address?.city || location.city || '').trim();
  const state = String(location.address?.state || location.state || '').trim();
  return [city, state].filter(Boolean).join(', ');
};

const buildServiceAreaSync = (locations = []) => {
  const activeLocations = locations.filter((location) => (
    location.active !== false && location.isActive !== false
  ));
  const zipCodes = [...new Set(activeLocations.map(getLocationZip).filter(Boolean))].sort();
  const serviceAreas = [...new Set(activeLocations.map(getLocationArea).filter(Boolean))].sort();

  return {
    serviceZipCodes: zipCodes,
    serviceAreas,
    locationCount: activeLocations.length,
  };
};

const getGeocode = async (address) => {
  if (!address) return null;

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_GEOCODE_KEY}`);
    const data = await response.json();
    if (data.status === 'OK') {
      const { lat, lng } = data.results[0].geometry.location;
      return { latitude: lat, longitude: lng };
    }

    console.error('Geocoding failed:', data.status);
    return null;
  } catch (error) {
    console.error('Error during geocoding:', error);
    return null;
  }
};

const geocodeZipCodes = async (zipCodes) => {
  const geocodedLocations = await Promise.all(toList(zipCodes).map((zip) => getGeocode(zip)));
  return geocodedLocations.filter(Boolean);
};

const StatTile = ({ icon: Icon, label, value, helper }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
      </div>
      <span className="rounded-md bg-slate-100 p-2 text-slate-600">
        <Icon />
      </span>
    </div>
    {helper && <p className="mt-2 text-sm text-slate-500">{helper}</p>}
  </div>
);

const Section = ({ title, subtitle, children, action }) => (
  <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
    <div className="p-5">{children}</div>
  </section>
);

const InfoField = ({
  label,
  name,
  value,
  displayValue,
  editMode,
  onChange,
  type = 'text',
  placeholder = '',
  helper = '',
}) => (
  <label className="block">
    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
    {editMode ? (
      <>
        <input
          type={type}
          name={name}
          value={value || ''}
          onChange={onChange}
          placeholder={placeholder}
          className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
      </>
    ) : (
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{displayValue || value || 'Not set'}</p>
    )}
  </label>
);

const ListField = ({
  label,
  name,
  value,
  displayFormatter,
  editMode,
  onChange,
  placeholder = '',
  helper = '',
}) => (
  <label className="block">
    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
    {editMode ? (
      <>
        <textarea
          name={name}
          value={listToText(value, displayFormatter)}
          onChange={onChange}
          placeholder={placeholder}
          rows={3}
          className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
      </>
    ) : (
      <BadgeList items={value} formatter={displayFormatter} />
    )}
  </label>
);

const OfferingsField = ({
  label,
  value,
  editMode,
  onChange,
  helper = '',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [customOffering, setCustomOffering] = useState('');

  const selectedServices = useMemo(() => normalizeOfferingList(value), [value]);
  const selectedKeys = useMemo(
    () => new Set(selectedServices.map((service) => service.toLowerCase())),
    [selectedServices]
  );
  const selectedCustomServices = selectedServices.filter((service) => !getOfferingOption(service));
  const filteredOptions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return SERVICE_OPTIONS;

    return SERVICE_OPTIONS.filter((service) => (
      service.label.toLowerCase().includes(query)
      || service.value.toLowerCase().includes(query)
    ));
  }, [searchTerm]);

  const updateSelection = (nextServices) => {
    onChange(normalizeOfferingList(nextServices));
  };

  const toggleService = (serviceValue) => {
    if (selectedKeys.has(serviceValue.toLowerCase())) {
      updateSelection(selectedServices.filter((service) => service.toLowerCase() !== serviceValue.toLowerCase()));
      return;
    }

    updateSelection([...selectedServices, serviceValue]);
  };

  const removeService = (serviceValue) => {
    updateSelection(selectedServices.filter((service) => service.toLowerCase() !== serviceValue.toLowerCase()));
  };

  const handleAddCustom = () => {
    const normalized = normalizeOfferingValue(customOffering);
    if (!normalized) return;

    if (selectedKeys.has(normalized.toLowerCase())) {
      setCustomOffering('');
      return;
    }

    updateSelection([...selectedServices, normalized]);
    setCustomOffering('');
  };

  return (
    <div className="block">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-xs font-semibold text-slate-500">
          {selectedServices.length} selected
        </span>
      </div>

      {!editMode ? (
        <BadgeList items={value} formatter={formatOfferingLabel} />
      ) : (
        <div className="mt-2 space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={`Search ${SERVICE_OPTIONS.length} service options`}
                className="w-full rounded-md border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white">
              {filteredOptions.length > 0 ? (
                <div className="grid gap-0 sm:grid-cols-2">
                  {filteredOptions.map((service) => {
                    const checked = selectedKeys.has(service.value.toLowerCase());

                    return (
                      <label
                        key={service.value}
                        className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 last:border-b-0 hover:bg-blue-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleService(service.value)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>{service.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 py-4 text-sm font-semibold text-slate-500">No matching services.</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={customOffering}
              onChange={(event) => setCustomOffering(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAddCustom();
                }
              }}
              placeholder="Add custom service"
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={handleAddCustom}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
            >
              <FaPlus />
              Add
            </button>
          </div>

          {selectedServices.length > 0 && (
            <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Selected Services</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedServices.map((service) => (
                  <span
                    key={service}
                    className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800"
                  >
                    {formatOfferingLabel(service)}
                    <button
                      type="button"
                      onClick={() => removeService(service)}
                      aria-label={`Remove ${formatOfferingLabel(service)}`}
                      className="rounded-full p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-800"
                    >
                      <FaTrash className="text-[10px]" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {selectedCustomServices.length > 0 && (
            <p className="text-xs text-slate-500">
              Custom: {selectedCustomServices.map(formatOfferingLabel).join(', ')}
            </p>
          )}

          {helper && <p className="text-xs text-slate-500">{helper}</p>}
        </div>
      )}
    </div>
  );
};

const BadgeList = ({ items, formatter = (item) => item, tone = 'slate' }) => {
  const list = toList(items);
  const toneClass = tone === 'blue'
    ? 'border-blue-200 bg-blue-50 text-blue-800'
    : 'border-slate-200 bg-slate-50 text-slate-700';

  if (list.length === 0) return <p className="mt-1 text-sm text-slate-500">Not set</p>;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {list.map((item) => (
        <span key={item} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>
          {formatter(item)}
        </span>
      ))}
    </div>
  );
};

const WorkflowCard = ({ title, body, meta, buttonLabel, onClick, loading }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-white p-2 text-slate-600 shadow-sm">
            <FaTools />
          </span>
          <h3 className="text-base font-bold text-slate-950">{title}</h3>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">{body}</p>
        {meta && <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{meta}</p>}
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <FaSyncAlt className={loading ? 'animate-spin' : ''} />
        {loading ? 'Updating...' : buttonLabel}
      </button>
    </div>
  </div>
);

const CompanyInfo = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const [company, setCompany] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({});
  const [zipCodeList, setZipCodeList] = useState([]);
  const [syncingAreas, setSyncingAreas] = useState(false);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setCompany(null);
      setFormData({});
      setZipCodeList([]);
      setIsLoading(false);
      return;
    }

    const fetchCompany = async () => {
      setIsLoading(true);
      try {
        const docRef = doc(db, 'companies', recentlySelectedCompany);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const companyData = normalizeCompanyData({ id: docSnap.id, ...docSnap.data() });
          setCompany(companyData);
          setFormData(companyData);
          setZipCodeList(await geocodeZipCodes(companyData.serviceZipCodes));
        } else {
          toast.error('Company not found.');
          setCompany(null);
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to fetch company data.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCompany();
  }, [recentlySelectedCompany]);

  const summary = useMemo(() => ({
    zipCount: toList(formData.serviceZipCodes).length,
    areaCount: toList(formData.serviceAreas).length,
    offeringCount: toList(formData.services).length,
  }), [formData.serviceAreas, formData.serviceZipCodes, formData.services]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleListChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: toList(value) }));
  };

  const handleOfferingsSelectionChange = (services) => {
    setFormData((prev) => ({
      ...prev,
      services: normalizeOfferingList(services),
    }));
  };

  const buildSavePayload = () => ({
    name: formData.name || '',
    email: formData.email || '',
    phoneNumber: formData.phoneNumber || '',
    websiteURL: formData.websiteURL || '',
    yelpURL: formData.yelpURL || '',
    photoUrl: formData.photoUrl || '',
    serviceZipCodes: toList(formData.serviceZipCodes),
    serviceAreas: toList(formData.serviceAreas),
    services: normalizeOfferingList(formData.services),
    updatedAt: serverTimestamp(),
  });

  const handleSave = async () => {
    const nextCompanyData = normalizeCompanyData({
      ...company,
      ...formData,
      serviceZipCodes: toList(formData.serviceZipCodes),
      serviceAreas: toList(formData.serviceAreas),
      services: normalizeOfferingList(formData.services),
    });

    const updatePromise = async () => {
      const docRef = doc(db, 'companies', recentlySelectedCompany);
      await updateDoc(docRef, buildSavePayload());
      setCompany(nextCompanyData);
      setFormData(nextCompanyData);
      setEditMode(false);
      setZipCodeList(await geocodeZipCodes(nextCompanyData.serviceZipCodes));
    };

    toast.promise(updatePromise(), {
      loading: 'Saving company information...',
      success: 'Company information updated.',
      error: 'Failed to save changes.',
    });
    toast('Information changes may affect verification status.');
  };

  const handleCancel = () => {
    setFormData(company || {});
    setEditMode(false);
  };

  const handleSyncServiceAreas = async () => {
    if (!recentlySelectedCompany || syncingAreas) return;

    setSyncingAreas(true);
    try {
      const snapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'));
      const locations = snapshot.docs.map((locationDoc) => ({
        id: locationDoc.id,
        ...locationDoc.data(),
      }));
      const syncResult = buildServiceAreaSync(locations);

      if (syncResult.serviceZipCodes.length === 0 && syncResult.serviceAreas.length === 0) {
        toast.error('No active service locations with ZIP codes or city/state areas were found.');
        return;
      }

      const docRef = doc(db, 'companies', recentlySelectedCompany);
      await updateDoc(docRef, {
        serviceZipCodes: syncResult.serviceZipCodes,
        serviceAreas: syncResult.serviceAreas,
        serviceAreaSourceLocationCount: syncResult.locationCount,
        serviceAreaSyncedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const nextCompanyData = normalizeCompanyData({
        ...company,
        ...formData,
        serviceZipCodes: syncResult.serviceZipCodes,
        serviceAreas: syncResult.serviceAreas,
        serviceAreaSourceLocationCount: syncResult.locationCount,
        serviceAreaSyncedAt: new Date(),
      });

      setCompany(nextCompanyData);
      setFormData(nextCompanyData);
      setZipCodeList(await geocodeZipCodes(syncResult.serviceZipCodes));
      toast.success(`Service coverage updated from ${syncResult.locationCount} active service locations.`);
    } catch (error) {
      console.error('Unable to sync service areas', error);
      toast.error('Unable to update service coverage.');
    } finally {
      setSyncingAreas(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Loading company information...
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No company selected or data found.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || company.name || 'Selected company'}</p>
              <h1 className="text-3xl font-bold text-slate-950">Company Information</h1>
              <p className="max-w-3xl text-sm text-slate-600">
                Operational company details used by public profiles, service request intake, and internal routing context.
              </p>
            </div>
            {!editMode ? (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                <FaEdit />
                Edit Info
              </button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                >
                  <FaSave />
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  <FaTimes />
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <StatTile icon={FaMapMarkerAlt} label="Service ZIPs" value={summary.zipCount} helper={compactList(formData.serviceZipCodes, 3)} />
          <StatTile icon={FaGlobe} label="Service Areas" value={summary.areaCount} helper={compactList(formData.serviceAreas, 3)} />
          <StatTile icon={FaBuilding} label="Offerings" value={summary.offeringCount} helper={compactList(formData.services, 3, formatOfferingLabel)} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-6">
            <Section title="Contact & Profile" subtitle="Core company fields used across Drip Drop.">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <InfoField label="Company Name" name="name" value={formData.name} editMode={editMode} onChange={handleInputChange} />
                <InfoField label="Contact Email" name="email" value={formData.email} editMode={editMode} onChange={handleInputChange} type="email" />
                <InfoField label="Phone Number" name="phoneNumber" value={formData.phoneNumber} editMode={editMode} onChange={handleInputChange} type="tel" />
                <InfoField
                  label="Company Website"
                  name="websiteURL"
                  value={formData.websiteURL}
                  displayValue={formData.websiteURL && (
                    <a href={safeHref(formData.websiteURL)} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:text-blue-900">
                      {formData.websiteURL}
                    </a>
                  )}
                  editMode={editMode}
                  onChange={handleInputChange}
                  type="url"
                  placeholder="https://..."
                />
                <InfoField
                  label="Yelp Profile URL"
                  name="yelpURL"
                  value={formData.yelpURL}
                  displayValue={formData.yelpURL && (
                    <a href={safeHref(formData.yelpURL)} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:text-blue-900">
                      {formData.yelpURL}
                    </a>
                  )}
                  editMode={editMode}
                  onChange={handleInputChange}
                  type="url"
                  placeholder="https://yelp.com/biz/..."
                />
                <InfoField
                  label="Logo / Photo URL"
                  name="photoUrl"
                  value={formData.photoUrl}
                  displayValue={formData.photoUrl && (
                    <a href={safeHref(formData.photoUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:text-blue-900">
                      {formData.photoUrl}
                    </a>
                  )}
                  editMode={editMode}
                  onChange={handleInputChange}
                  type="url"
                  placeholder="https://..."
                />
              </div>
            </Section>

            <Section
              title="Service Coverage"
              subtitle="Internal source data for public profile service areas and lead matching."
              action={(
                <button
                  type="button"
                  onClick={handleSyncServiceAreas}
                  disabled={syncingAreas}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSyncAlt className={syncingAreas ? 'animate-spin' : ''} />
                  {syncingAreas ? 'Syncing...' : 'Sync From Locations'}
                </button>
              )}
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="space-y-5">
                  <ListField
                    label="Service Zip Codes"
                    name="serviceZipCodes"
                    value={formData.serviceZipCodes}
                    editMode={editMode}
                    onChange={handleListChange}
                    helper="Separate multiple ZIP codes with commas."
                    placeholder="91942, 91941, 92020"
                  />
                  <ListField
                    label="Service Areas"
                    name="serviceAreas"
                    value={formData.serviceAreas}
                    editMode={editMode}
                    onChange={handleListChange}
                    helper="Separate city/state service areas with commas."
                    placeholder="La Mesa, El Cajon, Spring Valley"
                  />
                  <OfferingsField
                    label="Services Offered"
                    value={formData.services}
                    editMode={editMode}
                    onChange={handleOfferingsSelectionChange}
                    helper="Choose from the list or add a custom service."
                  />
                </div>
                <div className="min-h-[22rem] overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                  {zipCodeList.length > 0 ? (
                    <MultiLocationMap locations={zipCodeList} />
                  ) : (
                    <div className="flex h-full min-h-[22rem] items-center justify-center px-5 text-center text-sm font-semibold text-slate-500">
                      Add service ZIP codes to preview coverage.
                    </div>
                  )}
                </div>
              </div>
            </Section>
          </div>

          <aside className="space-y-6">
            <Section title="Update Workflows" subtitle="Refresh company info from operational records.">
              <WorkflowCard
                title="Update Service Coverage"
                body="Reads active service locations in this company, finds their unique ZIP codes and city/state areas, then updates the company service coverage fields used by public pages and service intake."
                meta={`Last sync: ${formatDate(company.serviceAreaSyncedAt)}${company.serviceAreaSourceLocationCount ? ` from ${company.serviceAreaSourceLocationCount} locations` : ''}`}
                buttonLabel="Run Sync"
                onClick={handleSyncServiceAreas}
                loading={syncingAreas}
              />
            </Section>

            <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="rounded-md bg-white p-2 text-amber-700 shadow-sm">
                  <FaExclamationTriangle />
                </span>
                <div>
                  <h2 className="text-base font-bold text-amber-900">Verification Note</h2>
                  <p className="mt-2 text-sm text-amber-800">
                    Changes here can affect public profile accuracy and company verification. Keep the fields factual and current.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-rose-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold text-rose-700">Advanced</h2>
              <p className="mt-2 text-sm text-slate-600">Transfer company ownership to another user.</p>
              <button
                type="button"
                onClick={() => toast.error('This feature is not yet implemented.')}
                className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700"
              >
                Change Owner
              </button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default CompanyInfo;
