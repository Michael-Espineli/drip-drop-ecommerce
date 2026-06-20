import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import {
  ArrowLeftIcon,
  BeakerIcon,
  CameraIcon,
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { functions } from '../../utils/config';

const displayText = (value, fallback = 'Not captured') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;

  const text = String(value).trim();
  return text || fallback;
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return 'Not captured';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(millis));
};

const splitSurveyNotes = (notes = '') => {
  const text = displayText(notes, '');
  if (!text) return { locationNotes: '', findings: [] };

  const marker = text.match(/\n\s*Survey Findings\s*\n/i);
  if (!marker) return { locationNotes: text, findings: [] };

  const markerIndex = marker.index || 0;
  return {
    locationNotes: text.slice(0, markerIndex).trim(),
    findings: text
      .slice(markerIndex + marker[0].length)
      .split('\n')
      .map((line) => line.trim().replace(/^\d+\.\s*/, ''))
      .filter(Boolean),
  };
};

const photoUrl = (photo) => {
  if (!photo) return '';
  if (typeof photo === 'string') return photo;

  return photo.url ||
    photo.imageURL ||
    photo.imageUrl ||
    photo.image ||
    photo.src ||
    photo.downloadURL ||
    photo.photoUrl ||
    photo.photoURL ||
    photo.thumbnailUrl ||
    photo.publicUrl ||
    photo.path ||
    '';
};

const photoCaption = (photo, fallback) => {
  if (!photo || typeof photo === 'string') return fallback;
  return photo.caption || photo.description || photo.name || fallback;
};

const isWebUrl = (value) => /^https?:\/\//i.test(String(value || ''));

const getEquipmentTitle = (equipment = {}) => (
  equipment.name ||
  [equipment.make, equipment.model].filter(Boolean).join(' ') ||
  equipment.type ||
  'Equipment'
);

const getBodyOfWaterTitle = (body = {}) => (
  body.name ||
  body.type ||
  body.bodyOfWaterType ||
  'Body of Water'
);

const normalizeKey = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const equipmentSurveyFindings = (equipment = []) => (
  equipment
    .map((item) => {
      const status = displayText(item.status || item.operationStatus || item.equipmentStatus, '');
      const flaggedStatus = [
        'needsservice',
        'needsrepair',
        'repair',
        'maintenance',
        'notoperational',
        'nonoperational',
        'offline',
        'failed',
      ].some((key) => normalizeKey(status).includes(key));
      const needsService = Boolean(
        item.needsService ||
        item.needsRepair ||
        item.serviceRecommended ||
        item.repairRecommended
      );

      if (!flaggedStatus && !needsService) return null;

      return {
        id: item.id,
        title: getEquipmentTitle(item),
        status: status || 'Needs attention',
        notes: item.notes || item.serviceNotes || item.recommendationNotes || '',
      };
    })
    .filter(Boolean)
);

const Field = ({ label, value, children }) => (
  <div>
    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 text-sm font-semibold text-slate-950">{children || displayText(value)}</dd>
  </div>
);

const PhotoGrid = ({ photos = [], title }) => {
  const normalizedPhotos = photos
    .map((photo, index) => ({
      url: photoUrl(photo),
      caption: photoCaption(photo, `${title || 'Photo'} ${index + 1}`),
    }))
    .filter((photo) => photo.url);

  if (!normalizedPhotos.length) return null;

  return (
    <div className="mt-4">
      {title && <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>}
      <div className={`${title ? 'mt-2' : ''} grid grid-cols-2 gap-3 sm:grid-cols-3`}>
        {normalizedPhotos.map((photo, index) => (
          isWebUrl(photo.url) ? (
            <a
              key={`${photo.url}-${index}`}
              href={photo.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-md border border-slate-200 bg-slate-50"
            >
              <img src={photo.url} alt={photo.caption} className="h-32 w-full object-cover" />
            </a>
          ) : (
            <div key={`${photo.url}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">{photo.caption}</p>
              <p className="mt-1 break-all">{photo.url}</p>
            </div>
          )
        ))}
      </div>
    </div>
  );
};

const addPhotosFromKeys = ({ collection, keys, label, target, seen }) => {
  keys.forEach((key) => {
    const photos = collection?.[key];
    if (!Array.isArray(photos)) return;

    photos.forEach((photo, index) => {
      const url = photoUrl(photo);
      if (!url || seen.has(url)) return;

      seen.add(url);
      target.push({
        ...(typeof photo === 'object' && photo ? photo : {}),
        url,
        caption: photoCaption(photo, `${label} ${index + 1}`),
      });
    });
  });
};

const buildSitePhotoGallery = ({
  serviceStop = {},
  serviceLocation = {},
  bodiesOfWater = [],
  equipment = [],
  stopDataRecords = [],
  tasks = [],
}) => {
  const seen = new Set();
  const photos = [];
  const photoKeys = [
    'photoUrls',
    'photos',
    'sitePhotos',
    'inspectionPhotos',
    'servicePhotos',
    'completionPhotos',
    'beforePhotos',
    'afterPhotos',
  ];

  addPhotosFromKeys({ collection: serviceLocation, keys: [...photoKeys, 'serviceLocationPhotos'], label: 'Location Photo', target: photos, seen });
  addPhotosFromKeys({ collection: serviceStop, keys: photoKeys, label: 'Service Stop Photo', target: photos, seen });

  bodiesOfWater.forEach((body) => {
    addPhotosFromKeys({
      collection: body,
      keys: [...photoKeys, 'bodyOfWaterPhotos'],
      label: `${getBodyOfWaterTitle(body)} Photo`,
      target: photos,
      seen,
    });
  });

  equipment.forEach((item) => {
    addPhotosFromKeys({
      collection: item,
      keys: [...photoKeys, 'equipmentPhotos'],
      label: `${getEquipmentTitle(item)} Photo`,
      target: photos,
      seen,
    });
  });

  stopDataRecords.forEach((record) => {
    addPhotosFromKeys({
      collection: record,
      keys: photoKeys,
      label: 'Stop Data Photo',
      target: photos,
      seen,
    });
  });

  tasks.forEach((task) => {
    addPhotosFromKeys({
      collection: task,
      keys: photoKeys,
      label: `${task.name || task.type || 'Task'} Photo`,
      target: photos,
      seen,
    });
  });

  return photos;
};

const PublicServiceAgreementInspectionReport = () => {
  const { agreementId } = useParams();
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const emailParam = queryParams.get('email') || '';
  const accessToken = queryParams.get('accessToken') || queryParams.get('reviewToken') || '';
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!agreementId) {
      setError('Missing service agreement id.');
      setLoading(false);
      return undefined;
    }

    if (!accessToken) {
      setError('This private report link is missing its email access token.');
      setLoading(false);
      return undefined;
    }

    let isActive = true;

    const loadReport = async () => {
      setLoading(true);
      setError('');

      try {
        const getReport = httpsCallable(functions, 'getPublicServiceAgreementInspectionReport');
        const result = await getReport({
          agreementId,
          email: emailParam,
          accessToken,
        });

        if (!isActive) return;
        setReport(result.data?.report || null);
        if (!result.data?.report) setError('Inspection report not found.');
      } catch (loadError) {
        console.error('Unable to load public inspection report', loadError);
        if (isActive) {
          setReport(null);
          setError(loadError.message || 'Unable to verify this inspection report link.');
        }
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadReport();

    return () => {
      isActive = false;
    };
  }, [accessToken, agreementId, emailParam]);

  const serviceStop = useMemo(
    () => (report?.serviceStop ? report.serviceStop : {}),
    [report?.serviceStop]
  );
  const serviceLocation = useMemo(
    () => (report?.serviceLocation ? report.serviceLocation : {}),
    [report?.serviceLocation]
  );
  const bodiesOfWater = useMemo(
    () => (Array.isArray(report?.bodiesOfWater) ? report.bodiesOfWater : []),
    [report?.bodiesOfWater]
  );
  const equipment = useMemo(
    () => (Array.isArray(report?.equipment) ? report.equipment : []),
    [report?.equipment]
  );
  const stopDataRecords = useMemo(
    () => (Array.isArray(report?.stopDataRecords) ? report.stopDataRecords : []),
    [report?.stopDataRecords]
  );
  const tasks = useMemo(
    () => (Array.isArray(report?.tasks) ? report.tasks : []),
    [report?.tasks]
  );
  const findings = equipmentSurveyFindings(equipment);
  const surveyNotes = splitSurveyNotes(
    serviceLocation.notes ||
    serviceLocation.locationNotes ||
    serviceStop.serviceLocationNotes ||
    serviceStop.description ||
    ''
  );
  const bodyOfWaterById = useMemo(
    () => new Map(bodiesOfWater.map((body) => [body.id, body])),
    [bodiesOfWater]
  );
  const sitePhotoGallery = useMemo(
    () => buildSitePhotoGallery({
      serviceStop,
      serviceLocation,
      bodiesOfWater,
      equipment,
      stopDataRecords,
      tasks,
    }),
    [bodiesOfWater, equipment, serviceLocation, serviceStop, stopDataRecords, tasks]
  );
  const backPath = `/customer/service-agreements/${agreementId}${location.search || ''}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Loading inspection report...
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
          <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-xl font-bold text-amber-950">We could not verify this inspection report</h1>
          <p className="mt-2 text-sm text-amber-800">{error}</p>
          <Link
            to={backPath}
            className="mt-5 inline-flex justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
          >
            Back to Agreement
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-950 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <Link to={backPath} className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Service Agreement
          </Link>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Inspection Report</p>
              <h1 className="mt-2 text-3xl font-bold">{report.agreementTitle || 'Service Agreement Survey Report'}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                {report.companyName} prepared this report from the site visit used to build the service agreement.
              </p>
            </div>
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              Private Email Link
            </span>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-bold">Visit Summary</h2>
          </div>
          <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Customer" value={report.customerName || serviceStop.customerName} />
            <Field label="Technician" value={serviceStop.tech || serviceStop.technicianName} />
            <Field label="Survey Date" value={formatDate(serviceStop.serviceDate || serviceStop.startTime || serviceStop.createdAt)} />
            <Field label="Status" value={serviceStop.operationStatus || serviceStop.status} />
            <Field
              label="Address"
              value={`${serviceStop.address?.streetAddress || serviceLocation.streetAddress || ''}${serviceStop.address?.city || serviceLocation.city ? `, ${serviceStop.address?.city || serviceLocation.city}` : ''}${serviceStop.address?.state || serviceLocation.state ? `, ${serviceStop.address?.state || serviceLocation.state}` : ''}`}
            />
            <Field label="Location" value={serviceLocation.nickName || serviceLocation.name || serviceStop.customerName} />
            <Field label="Bodies of Water" value={bodiesOfWater.length ? String(bodiesOfWater.length) : 'None captured'} />
            <Field label="Equipment Items" value={equipment.length ? String(equipment.length) : 'None captured'} />
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Service Location Notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
            {surveyNotes.locationNotes || 'No location notes were captured.'}
          </p>
          <PhotoGrid title="Location Photos" photos={serviceLocation.photoUrls || serviceLocation.photos || serviceLocation.serviceLocationPhotos || []} />
          <PhotoGrid title="Service Stop Photos" photos={serviceStop.photoUrls || serviceStop.photos || []} />
        </section>

        {(surveyNotes.findings.length > 0 || findings.length > 0) && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <h2 className="text-lg font-bold text-amber-950">Suggested Repairs and Changes</h2>
            <div className="mt-3 space-y-3">
              {surveyNotes.findings.map((finding, index) => (
                <div key={`${finding}-${index}`} className="rounded-md border border-amber-200 bg-white px-4 py-3 text-sm text-amber-900">
                  {finding}
                </div>
              ))}
              {findings.map((finding) => (
                <div key={finding.id || finding.title} className="rounded-md border border-amber-200 bg-white px-4 py-3 text-sm text-amber-900">
                  <p className="font-bold">{finding.title}</p>
                  <p className="mt-1">Status: {finding.status}</p>
                  {finding.notes && <p className="mt-1 whitespace-pre-line">{finding.notes}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <BeakerIcon className="h-5 w-5 text-blue-600" />
            Body of Water Details
          </h2>
          {bodiesOfWater.length ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {bodiesOfWater.map((body) => (
                <div key={body.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{getBodyOfWaterTitle(body)}</p>
                      <p className="mt-1 text-sm text-slate-500">{displayText(body.type || body.bodyOfWaterType || body.waterType, 'Pool')}</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {displayText(body.status || body.operationStatus, 'Active')}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <Field label="Material" value={body.material || body.surfaceMaterial} />
                    <Field label="Shape" value={body.shape} />
                    <Field label="Gallons" value={body.gallons || body.capacityGallons || body.volume} />
                    <Field label="Sanitizer" value={body.sanitizer || body.sanitizerType} />
                    <Field label="Length" value={body.length} />
                    <Field label="Width" value={body.width} />
                    <Field label="Shallow Depth" value={body.shallowEndDepth || body.shallowDepth} />
                    <Field label="Deep Depth" value={body.deepEndDepth || body.deepDepth} />
                  </dl>
                  {(body.notes || body.description) && (
                    <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700">{body.notes || body.description}</p>
                  )}
                  <PhotoGrid title="Water Photos" photos={body.photoUrls || body.photos || body.bodyOfWaterPhotos || []} />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              No body of water information was captured for this survey.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <WrenchScrewdriverIcon className="h-5 w-5 text-blue-600" />
            Equipment Information
          </h2>
          {equipment.length ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {equipment.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{getEquipmentTitle(item)}</p>
                      <p className="mt-1 text-sm text-slate-500">{displayText(item.type || item.equipmentType, 'Equipment')}</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {displayText(item.status || item.operationStatus || item.equipmentStatus, 'Operational')}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <Field label="Make" value={item.make || item.manufacturer} />
                    <Field label="Model" value={item.model} />
                    <Field label="Catalog Match" value={item.catalogMatchName || item.catalogMatch || item.catalogModelName} />
                    <Field label="Needs Service" value={item.needsService || item.needsRepair} />
                    <Field label="Last Service" value={formatDate(item.lastServiceDate || item.lastServicedAt)} />
                    <Field label="Next Service" value={formatDate(item.nextServiceDate || item.nextScheduledServiceDate)} />
                    <Field label="Clean Pressure" value={item.cleanFilterPressure || item.cleanPressure} />
                    <Field label="Current Pressure" value={item.currentFilterPressure || item.currentPressure} />
                  </dl>
                  {(item.notes || item.serviceNotes || item.recommendationNotes) && (
                    <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700">
                      {item.notes || item.serviceNotes || item.recommendationNotes}
                    </p>
                  )}
                  <PhotoGrid title="Equipment Photos" photos={item.photoUrls || item.photos || item.equipmentPhotos || []} />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              No equipment information was captured for this survey.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <CameraIcon className="h-5 w-5 text-blue-600" />
            Captured Readings and Dosages
          </h2>
          {stopDataRecords.length ? (
            <div className="mt-4 space-y-3">
              {stopDataRecords.map((record) => {
                const body = bodyOfWaterById.get(record.bodyOfWaterId);
                const observations = Array.isArray(record.observation)
                  ? record.observation
                  : Array.isArray(record.observations)
                    ? record.observations
                    : [];

                return (
                  <div key={record.id || record.bodyOfWaterId} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="font-bold">{body ? getBodyOfWaterTitle(body) : 'Stop Data'}</p>
                    <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Readings</p>
                        {(record.readings || []).length ? (
                          <div className="mt-2 space-y-1 text-sm text-slate-700">
                            {(record.readings || []).map((reading, index) => (
                              <p key={`${reading.templateId || reading.name || 'reading'}-${index}`}>
                                <span className="font-semibold">{reading.name || reading.templateName || reading.readingName || 'Reading'}:</span>{' '}
                                {displayText(reading.amount || reading.value)}
                                {reading.UOM || reading.uom ? ` ${reading.UOM || reading.uom}` : ''}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-500">No readings captured.</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Dosages</p>
                        {(record.dosages || []).length ? (
                          <div className="mt-2 space-y-1 text-sm text-slate-700">
                            {(record.dosages || []).map((dosage, index) => (
                              <p key={`${dosage.templateId || dosage.name || 'dosage'}-${index}`}>
                                <span className="font-semibold">{dosage.name || dosage.templateName || dosage.dosageName || 'Dosage'}:</span>{' '}
                                {displayText(dosage.amount || dosage.value)}
                                {dosage.UOM || dosage.uom ? ` ${dosage.UOM || dosage.uom}` : ''}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-500">No dosages captured.</p>
                        )}
                      </div>
                    </div>
                    {observations.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Observations</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-700">
                          {observations.map((observation, index) => (
                            <li key={`${observation}-${index}`}>{observation}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              No readings, dosages, or observations have been saved for this survey.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <CameraIcon className="h-5 w-5 text-blue-600" />
                Site Photo Gallery
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Photos captured during the visit, grouped into one gallery for review.
              </p>
            </div>
            <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
              {sitePhotoGallery.length} photo{sitePhotoGallery.length === 1 ? '' : 's'}
            </span>
          </div>

          {sitePhotoGallery.length ? (
            <PhotoGrid photos={sitePhotoGallery} />
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              No site photos were captured for this report.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default PublicServiceAgreementInspectionReport;
