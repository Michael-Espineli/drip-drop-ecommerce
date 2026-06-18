import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DatePicker from "react-datepicker";
import { query, collection, getDocs, getDoc, where, Timestamp, doc, updateDoc, setDoc, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { db, functions } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import "react-datepicker/dist/react-datepicker.css";
import { v4 as uuidv4 } from "uuid";
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { fetchCompanyVendors } from '../../../utils/vendors';

const ALL_ROUTES_OPTION = '__all_active_routes__';
const ALL_ROUTES_MAP_OVERLAYS = Object.freeze({
    stops: true,
    techTrail: false,
    timeAreas: false,
});
const MOVE_MODE_ONE_TIME = 'oneTime';
const MOVE_MODE_PERMANENT = 'permanent';
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_ROUTE_WEEK_OFFSET = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_STOP_BUCKETS = Object.freeze({
    routes: 'routes',
    jobs: 'jobs',
    estimates: 'estimates',
});

const getDateValue = (value) => {
    if (!value) return null;

    if (typeof value?.toDate === 'function') {
        return value.toDate();
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const startOfDayDate = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
};

const endOfDayDate = (value) => {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
};

const startOfWeekDate = (value) => {
    const date = startOfDayDate(value);
    date.setDate(date.getDate() - date.getDay());
    return date;
};

const addDaysToDate = (value, days) => {
    const date = new Date(value);
    date.setDate(date.getDate() + days);
    return date;
};

const sameCalendarDate = (left, right) => (
    startOfDayDate(left).getTime() === startOfDayDate(right).getTime()
);

const dayKey = (date) => format(date, 'yyyy-MM-dd');

const weekOffsetFromCurrent = (weekStart, currentWeekStart) => (
    Math.round((startOfWeekDate(weekStart).getTime() - startOfWeekDate(currentWeekStart).getTime()) / (DAY_MS * 7))
);

const clampDateToRouteWindow = (date, currentWeekStart) => {
    const minDate = startOfDayDate(currentWeekStart);
    const maxDate = endOfDayDate(addDaysToDate(currentWeekStart, (MAX_ROUTE_WEEK_OFFSET * 7) + 6));
    const nextDate = startOfDayDate(date);

    if (nextDate < minDate) return minDate;
    if (nextDate > maxDate) return maxDate;

    return nextDate;
};

const getStopTiming = (stop) => {
    const start = getDateValue(stop?.startTime);
    const end = getDateValue(stop?.endTime);
    return { start, end };
};

const getStopDisplayStatus = (stop) => {
    const { start, end } = getStopTiming(stop);

    if (!start) {
        return {
            label: 'Not Finished',
            className: 'bg-yellow-100 text-yellow-800',
        };
    }

    if (start && !end) {
        return {
            label: 'In Progress',
            className: 'bg-blue-100 text-blue-800',
        };
    }

    return {
        label: 'Finished',
        className: 'bg-green-100 text-green-800',
    };
};

const isStopMovable = (stop) => {
    const { end } = getStopTiming(stop);
    const operationStatus = String(stop?.operationStatus || '').toLowerCase();

    return !end && operationStatus !== 'finished';
};

const formatTimeValue = (date) => {
    if (!date) return 'N/A';

    return date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
};

const formatElapsedDuration = (start, end = new Date()) => {
    if (!start) return 'N/A';

    const diffMs = Math.max(0, end.getTime() - start.getTime());
    const totalSeconds = Math.floor(diffMs / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${paddedMinutes}:${paddedSeconds}`;
    }

    return `${minutes}:${paddedSeconds}`;
};

const formatAreaDuration = (start, end) => {
    if (!start || !end) return '0 min';

    const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${totalMinutes} min`;
};

const isValidCoordinate = (lat, lng) => (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
);

const getStopCoordinate = (stop) => {
    const lat = Number.parseFloat(stop?.address?.latitude);
    const lng = Number.parseFloat(stop?.address?.longitude);

    if (!isValidCoordinate(lat, lng)) return null;

    return { lat, lng };
};

const getAddressCoordinate = (address) => {
    const lat = Number.parseFloat(address?.latitude ?? address?.lat);
    const lng = Number.parseFloat(address?.longitude ?? address?.lng);

    if (!isValidCoordinate(lat, lng)) return null;

    return { lat, lng };
};

const getVendorCoordinate = (vendor) => (
    getAddressCoordinate(vendor?.address) || getAddressCoordinate(vendor)
);

const formatAddressValue = (address) => [
    address?.streetAddress,
    address?.city,
    address?.state,
    address?.zip || address?.zipCode,
].filter(Boolean).join(', ');

const formatVendorAddress = (vendor) => formatAddressValue({
    streetAddress: vendor?.streetAddress || vendor?.address?.streetAddress,
    city: vendor?.city || vendor?.address?.city,
    state: vendor?.state || vendor?.address?.state,
    zip: vendor?.zip || vendor?.address?.zip || vendor?.address?.zipCode,
});

const getRouteLocationCoordinate = (location) => {
    const lat = Number.parseFloat(location?.latitude);
    const lng = Number.parseFloat(location?.longitude);

    if (!isValidCoordinate(lat, lng)) return null;

    return { lat, lng };
};

const getOrderedRouteStops = (route, stops) => {
    if (!route) return [];

    const routeStopIds = route.serviceStopsIds || [];
    const stopById = new Map(stops.map(stop => [stop.id, stop]));
    const orderedStops = routeStopIds
        .map(stopId => stopById.get(stopId))
        .filter(Boolean);

    if (orderedStops.length > 0) return orderedStops;

    return stops.filter(stop => stop.techId === route.techId || stop.tech === route.techName);
};

const mergeStopsIntoRouteOrder = (route, stops) => {
    const stopById = new Map(stops.map(stop => [stop.id, stop]));
    const orderedIds = route?.serviceStopsIds?.length
        ? route.serviceStopsIds
        : (Array.isArray(route?.order) ? [...route.order]
            .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
            .map(item => item.serviceStopId || item.id)
            .filter(Boolean) : []);
    const includedStopIds = new Set();
    const orderedStops = orderedIds
        .map(stopId => stopById.get(stopId))
        .filter(Boolean)
        .filter(stop => {
            if (includedStopIds.has(stop.id)) return false;
            includedStopIds.add(stop.id);
            return true;
        });
    const remainingStops = stops.filter(stop => !includedStopIds.has(stop.id));

    return [...orderedStops, ...remainingStops];
};

const buildActiveRouteOrder = (route, orderedStops) => {
    const existingOrder = Array.isArray(route?.order) ? route.order : [];
    const existingByStopId = new Map(existingOrder.map(item => [item.serviceStopId || item.id, item]));

    return orderedStops.map((stop, index) => {
        const existing = existingByStopId.get(stop.id) || {};

        return {
            ...existing,
            id: existing.id || stop.routeOrderId || `route_order_${uuidv4()}`,
            order: index + 1,
            serviceStopId: stop.id,
            recurringServiceStopId: existing.recurringServiceStopId || stop.recurringServiceStopId || "",
            customerId: existing.customerId || stop.customerId || "",
            customerName: existing.customerName || stop.customerName || "",
            locationId: existing.locationId || stop.serviceLocationId || stop.locationId || "",
        };
    });
};

const sameStopOrder = (leftStops, rightStops) => (
    leftStops.length === rightStops.length &&
    leftStops.every((stop, index) => stop.id === rightStops[index]?.id)
);

const autoOrderStopsFromAnchor = (stops, anchorCoordinate, anchorPosition) => {
    const coordinateStops = [];
    const missingCoordinateStops = [];

    stops.forEach((stop) => {
        const coordinate = getStopCoordinate(stop);

        if (coordinate) {
            coordinateStops.push({ stop, coordinate });
        } else {
            missingCoordinateStops.push(stop);
        }
    });

    const ordered = [];
    let currentCoordinate = anchorCoordinate;

    while (coordinateStops.length > 0) {
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;

        coordinateStops.forEach((item, index) => {
            const distance = distanceMeters(currentCoordinate, item.coordinate);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        });

        const [nextStop] = coordinateStops.splice(nearestIndex, 1);
        ordered.push(nextStop.stop);
        currentCoordinate = nextStop.coordinate;
    }

    if (anchorPosition === 'end') {
        return {
            orderedStops: [...missingCoordinateStops, ...ordered.reverse()],
            missingCoordinateCount: missingCoordinateStops.length,
        };
    }

    return {
        orderedStops: [...ordered, ...missingCoordinateStops],
        missingCoordinateCount: missingCoordinateStops.length,
    };
};

const routeHasWorkActivity = (route) => Boolean(
    route.startTime ||
    route.endTime ||
    (route.status && route.status !== 'Did Not Start')
);

const getRouteStopCount = (route) => (
    Array.isArray(route?.serviceStopsIds)
        ? route.serviceStopsIds.length
        : Number(route?.totalStops || 0)
);

const createWeekStopBuckets = () => ({
    [WEEK_STOP_BUCKETS.routes]: 0,
    [WEEK_STOP_BUCKETS.jobs]: 0,
    [WEEK_STOP_BUCKETS.estimates]: 0,
});

const normalizeStopBucketValue = (value = '') => (
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[_/-]/g, '')
);

const serviceStopHasReference = (stop, keys = []) => (
    keys.some((key) => {
        const value = stop?.[key];
        if (!value) return false;
        if (typeof value === 'object') return Boolean(value.id || value.internalId);
        return Boolean(String(value).trim());
    })
);

const getServiceStopWeekBucket = (stop = {}) => {
    const bucketValues = [
        stop.serviceStopTypeUseCaseRawValue,
        stop.serviceStopUseCaseSourceId,
        stop.serviceStopTypeUseCase,
        stop.typeUseCase,
        stop.category,
        stop.serviceStopCategory,
        stop.serviceStopTypeCategory,
        stop.typeId,
        stop.serviceStopTypeId,
        stop.type,
        stop.serviceStopTypeName,
        stop.sourceId,
        stop.stopPayCategory,
        stop.stopPayBucketId,
        stop.serviceStopBucketId,
        stop.serviceStopBucket,
    ].map(normalizeStopBucketValue).filter(Boolean);

    const hasBucketValue = (...values) => (
        bucketValues.some((bucketValue) => (
            values.some((value) => bucketValue.includes(normalizeStopBucketValue(value)))
        ))
    );

    if (hasBucketValue(
        'estimate',
        'jobEstimate',
        'serviceAgreementEstimate',
        'serviceEstimate',
        'system_job_estimate_service_stop',
        'system_service_agreement_estimate_service_stop'
    )) {
        return WEEK_STOP_BUCKETS.estimates;
    }

    if (
        hasBucketValue(
            'jobVisit',
            'customerRelationship',
            'system_job_service_stop',
            'system_customer_relationship_service_stop',
            'serviceCall'
        ) ||
        serviceStopHasReference(stop, ['jobId', 'workOrderId', 'assignedJobId'])
    ) {
        return WEEK_STOP_BUCKETS.jobs;
    }

    if (
        hasBucketValue(
            'recurringRoute',
            'recurringServiceStop',
            'route',
            'system_recurring_service_stop'
        ) ||
        serviceStopHasReference(stop, ['recurringServiceStopId', 'recurringStopId', 'routeId', 'activeRouteId'])
    ) {
        return WEEK_STOP_BUCKETS.routes;
    }

    return WEEK_STOP_BUCKETS.routes;
};

const pickCanonicalRoute = (routes) => (
    [...routes].sort((a, b) => {
        const aHasWork = routeHasWorkActivity(a);
        const bHasWork = routeHasWorkActivity(b);

        if (aHasWork !== bHasWork) return aHasWork ? -1 : 1;

        const stopDelta = (b.serviceStopsIds?.length || 0) - (a.serviceStopsIds?.length || 0);
        if (stopDelta !== 0) return stopDelta;

        return String(a.id || '').localeCompare(String(b.id || ''));
    })[0] || null
);

const activeRouteDocumentId = (date, techId) => (
    `com_ar_${format(new Date(date), 'yyyyMMdd')}_${String(techId || '').replace(/\//g, '_')}`
);

const normalizeFleetVehicle = (snap) => {
    const data = snap.data();
    return {
        id: snap.id,
        ...data,
        miles: Number(data?.miles || 0),
    };
};

const vehicleLabel = (vehicle) => {
    if (!vehicle) return 'No vehicle';

    const name = vehicle.nickName || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
    const plate = vehicle.plate ? ` (${vehicle.plate})` : '';
    return `${name || vehicle.vehicalType || 'Vehicle'}${plate}`;
};

const personalVehicleLabel = (tech) => {
    const vehicle = tech?.personalVehicle || {};
    const name = vehicle.nickName || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
    const plate = vehicle.plate ? ` (${vehicle.plate})` : '';
    return `${name || `${tech?.userName || 'Technician'} personal vehicle`}${plate}`;
};

const routeVehicleSelectionValue = (route) => {
    if (route?.vehicleSource === 'Personal') return `personal:${route.personalVehicleOwnerId || route.techId}`;
    if (route?.vehicalId) return `fleet:${route.vehicalId}`;
    return 'none';
};

const routeVehicleSummary = (route, fleetVehicles, technicians) => {
    if (!route) return 'No vehicle assigned';

    if (route.vehicleSource === 'Personal') {
        const tech = technicians.find(item => item.userId === (route.personalVehicleOwnerId || route.techId));
        return route.vehicleLabel || personalVehicleLabel(tech);
    }

    if (route.vehicalId) {
        const vehicle = fleetVehicles.find(item => item.id === route.vehicalId);
        return route.vehicleLabel || vehicleLabel(vehicle);
    }

    return 'No vehicle assigned';
};

const routeVehicleSourceLabel = (route) => {
    if (route?.vehicleSource === 'Personal') return 'Personal';
    if (route?.vehicalId || route?.vehicleSource === 'Company Fleet') return 'Company fleet';
    return 'Unassigned';
};

const buildVehicleOptionsForRoute = (route, technicians, fleetVehicles) => {
    const tech = technicians.find(item => item.userId === route.techId);
    const activeFleetVehicles = fleetVehicles.filter(vehicle => vehicle.status !== 'Retired');
    const options = [
        { value: 'none', label: 'No vehicle assigned' },
        ...activeFleetVehicles.map(vehicle => ({
            value: `fleet:${vehicle.id}`,
            label: `Company: ${vehicleLabel(vehicle)}`,
        })),
    ];

    if (tech?.allowPersonalVehicle) {
        options.push({
            value: `personal:${tech.userId}`,
            label: `Personal: ${personalVehicleLabel(tech)}`,
        });
    }

    return options;
};

const distanceMeters = (from, to) => {
    const earthRadiusMeters = 6371000;
    const toRadians = value => value * Math.PI / 180;

    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const deltaLat = toRadians(to.lat - from.lat);
    const deltaLng = toRadians(to.lng - from.lng);

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const nearestStopToCoordinate = (coordinate, stops) => {
    const stopsWithCoordinates = stops
        .map(stop => ({ stop, coordinate: getStopCoordinate(stop) }))
        .filter(item => item.coordinate);

    return stopsWithCoordinates.reduce((nearest, item) => {
        const distance = distanceMeters(coordinate, item.coordinate);

        if (!nearest || distance < nearest.distance) {
            return { stop: item.stop, distance };
        }

        return nearest;
    }, null)?.stop || null;
};

const buildAreaEstimates = (locations, stops) => {
    const validLocations = locations
        .map(location => ({
            ...location,
            coordinate: getRouteLocationCoordinate(location),
            timeDate: getDateValue(location?.time),
        }))
        .filter(location => location.coordinate && location.timeDate)
        .sort((a, b) => a.timeDate - b.timeDate);

    if (validLocations.length === 0) return [];

    const groups = [];
    let currentGroup = [];

    validLocations.forEach(location => {
        if (currentGroup.length === 0) {
            currentGroup = [location];
            return;
        }

        const firstLocation = currentGroup[0];

        if (distanceMeters(firstLocation.coordinate, location.coordinate) <= 140) {
            currentGroup.push(location);
        } else {
            groups.push(currentGroup);
            currentGroup = [location];
        }
    });

    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }

    return groups
        .map((group, index) => {
            const first = group[0];
            const last = group[group.length - 1];
            const center = group.reduce(
                (partial, location) => ({
                    lat: partial.lat + location.coordinate.lat,
                    lng: partial.lng + location.coordinate.lng,
                }),
                { lat: 0, lng: 0 }
            );
            const coordinate = {
                lat: center.lat / group.length,
                lng: center.lng / group.length,
            };
            const nearestStop = nearestStopToCoordinate(coordinate, stops);

            return {
                id: group.map(location => location.id).join('-') || `area-${index}`,
                areaNumber: index + 1,
                coordinate,
                startTime: first.timeDate,
                endTime: last.timeDate,
                locationCount: group.length,
                durationText: formatAreaDuration(first.timeDate, last.timeDate),
                subtitle: nearestStop?.customerName
                    ? `Near ${nearestStop.customerName}`
                    : nearestStop?.address?.streetAddress
                        ? `Near ${nearestStop.address.streetAddress}`
                        : 'Technician stayed in this area',
            };
        })
        .filter(area => area.locationCount > 1 && area.endTime > area.startTime);
};

const checkpointIndexes = (total, limit) => {
    if (total <= 0) return [];
    if (total <= limit) return Array.from({ length: total }, (_, index) => index);
    if (limit <= 1) return [0];

    const step = (total - 1) / (limit - 1);
    const indexes = Array.from({ length: limit }, (_, index) => Math.round(index * step));

    return Array.from(new Set(indexes)).sort((a, b) => a - b);
};

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const minutesBetween = (start, end) => {
    if (!start || !end) return 0;

    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
};

const getRouteDurationMinutes = (route) => {
    const durationSeconds = Number(route?.durationSeconds);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        return Math.round(durationSeconds / 60);
    }

    const durationMinutes = Number(route?.durationMin);
    return Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 0;
};

const numberOrNull = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const timelinePercent = (date, rangeStart, rangeEnd) => {
    if (!date || !rangeStart || !rangeEnd || rangeEnd <= rangeStart) return 0;

    const totalMs = rangeEnd.getTime() - rangeStart.getTime();
    const offsetMs = date.getTime() - rangeStart.getTime();

    return Math.min(100, Math.max(0, (offsetMs / totalMs) * 100));
};

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60000);

const roundDateToMinuteStep = (date, minuteStep = 15, direction = 'floor') => {
    const nextDate = new Date(date);
    nextDate.setSeconds(0, 0);
    const minutes = nextDate.getMinutes();
    const roundedMinutes = direction === 'ceil'
        ? Math.ceil(minutes / minuteStep) * minuteStep
        : Math.floor(minutes / minuteStep) * minuteStep;

    nextDate.setMinutes(roundedMinutes);
    return nextDate;
};

const buildTimelineMarks = (start, end, minuteStep = 15) => {
    const marks = [];
    let mark = roundDateToMinuteStep(start, minuteStep, 'floor');
    const lastMark = roundDateToMinuteStep(end, minuteStep, 'ceil');

    while (mark <= lastMark) {
        marks.push(mark);
        mark = addMinutes(mark, minuteStep);
    }

    return marks;
};

const expandTimelineRangeForSegments = (range, segments) => {
    const segmentDates = segments
        .flatMap(segment => [segment.displayStart, segment.displayEnd])
        .filter(Boolean);

    if (!segmentDates.length) return range;

    return {
        start: new Date(Math.min(range.start.getTime(), ...segmentDates.map(date => date.getTime()))),
        end: new Date(Math.max(range.end.getTime(), ...segmentDates.map(date => date.getTime()))),
    };
};

const stopDurationMinutes = (stop, start, end) => (
    Math.max(
        15,
        minutesBetween(start, end),
        Number(stop?.duration || stop?.estimatedDuration || stop?.estimatedMinutes || 0)
    )
);

const layoutSequentialStopSegments = (segments) => {
    let cursor = null;

    return [...segments]
        .sort((left, right) => {
            const orderDelta = (left.stop.routeStopIndex || left.index + 1) - (right.stop.routeStopIndex || right.index + 1);
            if (orderDelta !== 0) return orderDelta;
            return left.start.getTime() - right.start.getTime();
        })
        .map((segment) => {
            const duration = stopDurationMinutes(segment.stop, segment.start, segment.end);
            const displayStart = cursor && segment.start < cursor ? cursor : segment.start;
            const displayEnd = addMinutes(displayStart, duration);

            cursor = displayEnd;

            return {
                ...segment,
                duration,
                displayStart,
                displayEnd,
                isSequentiallyShifted: displayStart.getTime() !== segment.start.getTime(),
            };
        });
};

const getRouteTimelineRange = (route, stops, areas, logs, now) => {
    const hasOpenStop = stops.some(stop => {
        const { start, end } = getStopTiming(stop);
        return start && !end;
    });
    const hasOpenLog = logs.some(log => log.startTimeDate && !log.endTimeDate);
    const shouldIncludeNow = route?.status === 'In Progress' || hasOpenStop || hasOpenLog;
    const dates = [
        getDateValue(route?.startTime),
        getDateValue(route?.endTime),
        ...stops.flatMap(stop => {
            const { start, end } = getStopTiming(stop);
            return [start, end];
        }),
        ...areas.flatMap(area => [area.startTime, area.endTime]),
        ...logs.flatMap(log => [log.startTimeDate, log.endTimeDate]),
    ].filter(Boolean);

    if (dates.length === 0) {
        const fallbackStart = new Date(now);
        fallbackStart.setHours(7, 0, 0, 0);
        return {
            start: fallbackStart,
            end: addMinutes(fallbackStart, 360),
        };
    }

    const start = new Date(Math.min(...dates.map(date => date.getTime())));
    const endCandidates = dates.map(date => date.getTime());

    if (shouldIncludeNow) {
        endCandidates.push(now.getTime());
    }

    const end = new Date(Math.max(...endCandidates));

    return {
        start: addMinutes(start, -15),
        end: addMinutes(end, 20),
    };
};

const getLogTone = (type) => {
    switch (type) {
        case 'Working':
            return 'bg-emerald-600 text-white';
        case 'On Break':
            return 'bg-amber-500 text-white';
        case 'On Lunch':
            return 'bg-orange-600 text-white';
        default:
            return 'bg-slate-600 text-white';
    }
};

const getStopTone = (stop) => {
    const status = getStopDisplayStatus(stop).label;

    if (status === 'Finished') return 'bg-blue-600 text-white';
    if (status === 'In Progress') return 'bg-sky-600 text-white';

    return 'bg-slate-400 text-white';
};

const buildDemoRouteData = (companyId, serviceDate) => {
    const companyName = 'Demo Pool Company';
    const routeId = `demo_route_${format(serviceDate, 'yyyyMMdd')}`;
    const techId = 'demo_tech_maya';
    const techName = 'Maya Chen';
    const at = (hour, minute) => {
        const date = new Date(serviceDate);
        date.setHours(hour, minute, 0, 0);
        return date;
    };
    const stopTemplates = [
        ['demo_stop_1', 'Katy Freeway Pool', '9400 Katy Fwy', 29.7832, -95.5177, at(7, 12), at(7, 46)],
        ['demo_stop_2', 'Rice Military Service', '5102 Washington Ave', 29.7701, -95.4153, at(8, 29), at(8, 58)],
        ['demo_stop_3', 'Downtown Spa', '1200 Main St', 29.7553, -95.3668, at(9, 21), at(9, 50)],
        ['demo_stop_4', 'Eastwood Weekly', '4500 Harrisburg Blvd', 29.7428, -95.3291, at(10, 22), at(10, 57)],
        ['demo_stop_5', 'Galena Park Check', '1700 Clinton Dr', 29.7412, -95.2441, at(11, 32), at(12, 6)],
        ['demo_stop_6', 'Pasadena Route End', '1801 Strawberry Rd', 29.6911, -95.2091, at(12, 49), at(13, 10)],
    ];

    const stops = stopTemplates.map(([id, customerName, streetAddress, latitude, longitude, startTime, endTime], index) => ({
        id,
        internalId: id,
        companyId,
        companyName,
        customerId: `demo_customer_${index + 1}`,
        customerName,
        address: {
            streetAddress,
            city: 'Houston',
            state: 'TX',
            zip: '77000',
            latitude,
            longitude,
        },
        dateCreated: at(6, 30),
        serviceDate,
        startTime,
        endTime,
        duration: endTime ? minutesBetween(startTime, endTime) : 0,
        estimatedDuration: 30,
        tech: techName,
        techId,
        recurringServiceStopId: `demo_rss_${index + 1}`,
        description: 'Demo service stop for route dashboard testing.',
        serviceLocationId: `demo_location_${index + 1}`,
        typeId: 'demo_service',
        type: 'Recurring Service Stop',
        typeImage: '',
        jobId: '',
        jobName: null,
        operationStatus: endTime ? 'Finished' : 'Not Finished',
        billingStatus: 'Not Invoiced',
        includeReadings: false,
        includeDosages: false,
        otherCompany: false,
        laborContractId: '',
        contractedCompanyId: '',
        photoUrls: [],
        mainCompanyId: companyId,
        isInvoiced: false,
    }));

    const trailCoordinates = [
        [7, 0, 29.7819, -95.5302],
        [7, 12, 29.7830, -95.5181],
        [7, 28, 29.7834, -95.5174],
        [7, 46, 29.7831, -95.5179],
        [8, 10, 29.7755, -95.4611],
        [8, 29, 29.7700, -95.4156],
        [8, 48, 29.7703, -95.4149],
        [9, 5, 29.7627, -95.3917],
        [9, 21, 29.7552, -95.3671],
        [9, 50, 29.7555, -95.3665],
        [10, 8, 29.7508, -95.3479],
        [10, 22, 29.7426, -95.3294],
        [10, 41, 29.7430, -95.3288],
        [10, 57, 29.7427, -95.3290],
        [11, 18, 29.7438, -95.2814],
        [11, 32, 29.7410, -95.2444],
        [11, 50, 29.7414, -95.2439],
        [12, 6, 29.7411, -95.2440],
        [12, 31, 29.7094, -95.2266],
        [12, 49, 29.6910, -95.2094],
    ];

    const locations = trailCoordinates.map(([hour, minute, latitude, longitude], index) => ({
        id: `demo_route_location_${index + 1}`,
        activeRouteId: routeId,
        time: at(hour, minute),
        latitude,
        longitude,
        userId: techId,
        userName: techName,
    }));

    const logs = [
        ['demo_log_work_1', 'Working', at(7, 0), at(9, 55), 29.7819, -95.5302, 29.7555, -95.3665, false],
        ['demo_log_break_1', 'On Break', at(9, 55), at(10, 10), 29.7555, -95.3665, 29.7508, -95.3479, false],
        ['demo_log_work_2', 'Working', at(10, 10), at(12, 10), 29.7508, -95.3479, 29.7411, -95.2440, false],
        ['demo_log_lunch_1', 'On Lunch', at(12, 10), at(12, 40), 29.7411, -95.2440, 29.7014, -95.2195, false],
        ['demo_log_work_3', 'Working', at(12, 40), at(13, 15), 29.7014, -95.2195, 29.6910, -95.2094, false],
    ].map(([id, type, startTime, endTime, startLatitude, startLongitude, endLatitude, endLongitude, current]) => ({
        id,
        activeRouteId: routeId,
        startTime,
        startLatitude,
        startLongitude,
        endTime,
        endLatitude,
        endLongitude,
        type,
        companyId,
        companyName,
        userId: techId,
        userName: techName,
        current,
    }));

    return {
        tech: {
            docId: techId,
            id: techId,
            userId: techId,
            userName: techName,
            firstName: 'Maya',
            lastName: 'Chen',
            roleName: 'Technician',
            status: 'Active',
            workerType: 'Employee',
        },
        route: {
            id: routeId,
            name: `${techName}'s Demo Route - ${format(serviceDate, 'MM/dd/yyyy')}`,
            date: serviceDate,
            serviceStopsIds: stops.map(stop => stop.id),
            order: stops.map((stop, index) => ({ id: stop.id, serviceStopId: stop.id, order: index + 1 })),
            startTime: at(7, 0),
            endTime: at(13, 15),
            startMilage: 10210,
            endMilage: null,
            techId,
            techName,
            traineeId: null,
            traineeName: null,
            durationSeconds: minutesBetween(at(7, 0), at(12, 49)) * 60,
            distanceMiles: 42.7,
            status: 'Finished',
            totalStops: stops.length,
            finishedStops: stops.filter(stop => stop.endTime).length,
            vehicalId: 'demo-truck-12',
        },
        stops,
        locations,
        logs,
    };
};

const useNow = () => {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const interval = setInterval(() => {
            setNow(new Date());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    return now;
};

const RouteDashboard = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const now = useNow();
    const todayDate = useMemo(() => startOfDayDate(new Date()), []);
    const currentWeekStart = useMemo(() => startOfWeekDate(todayDate), [todayDate]);
    const maxSelectableDate = useMemo(() => endOfDayDate(addDaysToDate(currentWeekStart, (MAX_ROUTE_WEEK_OFFSET * 7) + 6)), [currentWeekStart]);

    const [serviceDate, setServiceDate] = useState(new Date());
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingWeekMetrics, setIsLoadingWeekMetrics] = useState(false);
    const [weekMetrics, setWeekMetrics] = useState({});
    const [weekMetricsRefreshKey, setWeekMetricsRefreshKey] = useState(0);
    const [serviceStops, setServiceStops] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [fleetVehicles, setFleetVehicles] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [activeRoutes, setActiveRoutes] = useState([]);
    const [activeRouteLocations, setActiveRouteLocations] = useState([]);
    const [activeRouteLogs, setActiveRouteLogs] = useState([]);
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [isSeedingDemoRoute, setIsSeedingDemoRoute] = useState(false);
    const [vehicleUpdatingRouteId, setVehicleUpdatingRouteId] = useState('');
    const [selectedStopIds, setSelectedStopIds] = useState([]);
    const [moveMode, setMoveMode] = useState(MOVE_MODE_ONE_TIME);
    const [moveDate, setMoveDate] = useState(new Date());
    const [moveDay, setMoveDay] = useState(format(new Date(), 'EEEE'));
    const [moveTechId, setMoveTechId] = useState('');
    const [isMovingStops, setIsMovingStops] = useState(false);
    const [showMoveStopsPanel, setShowMoveStopsPanel] = useState(false);
    const [showMapPanel, setShowMapPanel] = useState(true);
    const [mapOverlays, setMapOverlays] = useState({
        stops: true,
        techTrail: true,
        timeAreas: true,
    });
    const selectedWeekStart = useMemo(() => startOfWeekDate(serviceDate), [serviceDate]);
    const weekDays = useMemo(() => (
        DAYS_OF_WEEK.map((dayName, index) => ({
            dayName,
            date: addDaysToDate(selectedWeekStart, index),
        }))
    ), [selectedWeekStart]);
    const weekTotals = useMemo(() => (
        weekDays.reduce((totals, { date }) => {
            const metric = weekMetrics[dayKey(date)] || {};
            const buckets = metric.stopBuckets || {};

            totals.totalStops += metric.serviceStopCount || 0;
            totals.routes += buckets.routes || 0;
            totals.jobs += buckets.jobs || 0;
            totals.estimates += buckets.estimates || 0;

            return totals;
        }, {
            totalStops: 0,
            routes: 0,
            jobs: 0,
            estimates: 0,
        })
    ), [weekDays, weekMetrics]);
    const selectedWeekOffset = weekOffsetFromCurrent(selectedWeekStart, currentWeekStart);
    const canNavigatePreviousWeek = selectedWeekOffset > 0;
    const canNavigateNextWeek = selectedWeekOffset < MAX_ROUTE_WEEK_OFFSET;

    const handleServiceDateChange = useCallback((date) => {
        if (!date) return;
        setServiceDate(clampDateToRouteWindow(date, currentWeekStart));
    }, [currentWeekStart]);

    const navigateWeek = useCallback((direction) => {
        const nextWeekStart = addDaysToDate(selectedWeekStart, direction * 7);
        const nextWeekOffset = weekOffsetFromCurrent(nextWeekStart, currentWeekStart);

        if (nextWeekOffset < 0 || nextWeekOffset > MAX_ROUTE_WEEK_OFFSET) return;

        handleServiceDateChange(addDaysToDate(nextWeekStart, serviceDate.getDay()));
    }, [currentWeekStart, handleServiceDateChange, selectedWeekStart, serviceDate]);

    const refreshWeekMetrics = useCallback(() => {
        setWeekMetricsRefreshKey((current) => current + 1);
    }, []);

    const fetchData = useCallback(async (date) => {
        if (!recentlySelectedCompany) return;
        setIsLoading(true);

        try {
            const startOfDay = new Date(date).setHours(0, 0, 0, 0);
            const endOfDay = new Date(date).setHours(23, 59, 59, 999);

            const stopsQuery = query(
                collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                where("serviceDate", ">=", new Date(startOfDay)),
                where("serviceDate", "<=", new Date(endOfDay))
            );
            const stopsSnapshot = await getDocs(stopsQuery);
            const fetchedStops = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setServiceStops(fetchedStops);

            const techQuery = query(collection(db, "companies", recentlySelectedCompany, 'companyUsers'));
            const techSnapshot = await getDocs(techQuery);
            const fetchedTechs = techSnapshot.docs.map(doc => ({ ...doc.data(), docId: doc.id }));
            setTechnicians(fetchedTechs);

            const fleetQuery = query(collection(db, "companies", recentlySelectedCompany, 'vehicals'));
            const fleetSnapshot = await getDocs(fleetQuery);
            const fetchedFleet = fleetSnapshot.docs
                .map(normalizeFleetVehicle)
                .sort((a, b) => (a.nickName || '').localeCompare(b.nickName || ''));
            setFleetVehicles(fetchedFleet);

            const syncedRoutes = await syncActiveRoutes(fetchedStops, fetchedTechs, date);
            await fetchActiveRouteActivity(syncedRoutes);

        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            toast.error("Failed to load dashboard data.");
        } finally {
            setIsLoading(false);
        }
    }, [recentlySelectedCompany]);

    const fetchActiveRouteActivity = async (routes) => {
        if (!recentlySelectedCompany || routes.length === 0) {
            setActiveRouteLocations([]);
            setActiveRouteLogs([]);
            return;
        }

        const [locationSnapshots, logSnapshots] = await Promise.all([
            Promise.all(routes.map(route => {
                const locationsQuery = query(
                    collection(db, 'companies', recentlySelectedCompany, 'activeRouteLocations'),
                    where('activeRouteId', '==', route.id)
                );

                return getDocs(locationsQuery);
            })),
            Promise.all(routes.map(route => {
                const logsQuery = query(
                    collection(db, 'companies', recentlySelectedCompany, 'activeRouteLogs'),
                    where('activeRouteId', '==', route.id)
                );

                return getDocs(logsQuery);
            })),
        ]);

        const fetchedLocations = locationSnapshots.flatMap((snapshot, routeIndex) => (
            snapshot.docs.map(locationDoc => ({
                id: locationDoc.id,
                routeId: routes[routeIndex].id,
                ...locationDoc.data(),
            }))
        ));

        const fetchedLogs = logSnapshots.flatMap((snapshot, routeIndex) => (
            snapshot.docs.map(logDoc => ({
                id: logDoc.id,
                routeId: routes[routeIndex].id,
                ...logDoc.data(),
            }))
        ));

        setActiveRouteLocations(fetchedLocations);
        setActiveRouteLogs(fetchedLogs);
    };

    const fetchWeekMetrics = useCallback(async (weekStart) => {
        if (!recentlySelectedCompany) {
            setWeekMetrics({});
            return;
        }

        setIsLoadingWeekMetrics(true);

        try {
            const weekEnd = endOfDayDate(addDaysToDate(weekStart, 6));
            const metricsByDay = DAYS_OF_WEEK.reduce((metrics, dayName, index) => {
                const date = addDaysToDate(weekStart, index);

                metrics[dayKey(date)] = {
                    serviceStopCount: 0,
                    stopBuckets: createWeekStopBuckets(),
                    activeRouteCount: 0,
                    recurringRouteCount: 0,
                    routeCount: 0,
                    routeSource: 'active',
                };

                return metrics;
            }, {});

            const [stopsSnapshot, activeRoutesSnapshot, recurringRoutesSnapshot] = await Promise.all([
                getDocs(query(
                    collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                    where('serviceDate', '>=', startOfDayDate(weekStart)),
                    where('serviceDate', '<=', weekEnd)
                )),
                getDocs(query(
                    collection(db, 'companies', recentlySelectedCompany, 'activeRoutes'),
                    where('date', '>=', startOfDayDate(weekStart)),
                    where('date', '<=', weekEnd)
                )),
                getDocs(collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes')),
            ]);

            stopsSnapshot.docs.forEach(stopDoc => {
                const stop = stopDoc.data();
                const stopDate = getDateValue(stop.serviceDate);
                if (!stopDate) return;

                const key = dayKey(stopDate);
                if (!metricsByDay[key]) return;

                metricsByDay[key].serviceStopCount += 1;
                metricsByDay[key].stopBuckets[getServiceStopWeekBucket(stop)] += 1;
            });

            activeRoutesSnapshot.docs
                .map(routeDoc => ({ id: routeDoc.id, ...routeDoc.data() }))
                .filter(route => !route.duplicateOf && getRouteStopCount(route) > 0)
                .forEach(route => {
                    const routeDate = getDateValue(route.date);
                    if (!routeDate) return;

                    const key = dayKey(routeDate);
                    if (!metricsByDay[key]) return;

                    metricsByDay[key].activeRouteCount += 1;
                });

            recurringRoutesSnapshot.docs
                .map(routeDoc => routeDoc.data())
                .forEach(route => {
                    const dayIndex = DAYS_OF_WEEK.indexOf(route.day);
                    if (dayIndex === -1) return;

                    const date = addDaysToDate(weekStart, dayIndex);
                    const key = dayKey(date);
                    if (!metricsByDay[key]) return;

                    metricsByDay[key].recurringRouteCount += 1;
                });

            Object.keys(metricsByDay).forEach(key => {
                const metric = metricsByDay[key];
                const hasActiveRoutes = metric.activeRouteCount > 0;

                metric.routeCount = hasActiveRoutes ? metric.activeRouteCount : metric.recurringRouteCount;
                metric.routeSource = hasActiveRoutes ? 'active' : 'recurring';
            });

            setWeekMetrics(metricsByDay);
        } catch (error) {
            console.error('Error loading route week metrics:', error);
            setWeekMetrics({});
        } finally {
            setIsLoadingWeekMetrics(false);
        }
    }, [recentlySelectedCompany]);

    const syncActiveRoutes = async (stops, techs, date) => {
        const startOfDay = new Date(date).setHours(0, 0, 0, 0);
        const endOfDay = new Date(date).setHours(23, 59, 59, 999);

        const routesQuery = query(
            collection(db, 'companies', recentlySelectedCompany, 'activeRoutes'),
            where("date", ">=", new Date(startOfDay)),
            where("date", "<=", new Date(endOfDay))
        );

        const routesSnapshot = await getDocs(routesQuery);
        const existingRoutes = routesSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(route => !route.duplicateOf);

        for (const tech of techs) {
            const techStops = stops.filter(stop => stop.techId === tech.userId || stop.tech === tech.userName);
            const routesForTech = existingRoutes.filter(route => route.techId === tech.userId);
            const routeForTech = pickCanonicalRoute(routesForTech);

            if (techStops.length === 0) {
                if (routeForTech) {
                    const routeRef = doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', routeForTech.id);
                    await updateDoc(routeRef, {
                        totalStops: 0,
                        finishedStops: 0,
                        status: 'Did Not Start',
                        serviceStopsIds: [],
                        order: []
                    });
                }

                continue;
            }

            const finishedStopsCount = techStops.filter(stop => {
                const { start, end } = getStopTiming(stop);
                return start && end;
            }).length;

            const inProgressStopsCount = techStops.filter(stop => {
                const { start, end } = getStopTiming(stop);
                return start && !end;
            }).length;

            const totalStopsCount = techStops.length;

            const newStatus =
                finishedStopsCount === totalStopsCount
                    ? 'Finished'
                    : inProgressStopsCount > 0
                        ? 'In Progress'
                        : 'Did Not Start';

            if (routeForTech) {
                const routeRef = doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', routeForTech.id);
                const orderedTechStops = mergeStopsIntoRouteOrder(routeForTech, techStops);
                await updateDoc(routeRef, {
                    totalStops: totalStopsCount,
                    finishedStops: finishedStopsCount,
                    status: newStatus,
                    serviceStopsIds: orderedTechStops.map(stop => stop.id),
                    order: buildActiveRouteOrder(routeForTech, orderedTechStops)
                });

                const duplicateRoutes = routesForTech.filter(route => route.id !== routeForTech.id);
                await Promise.all(duplicateRoutes.map(route => updateDoc(
                    doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', route.id),
                    {
                        duplicateOf: routeForTech.id,
                        serviceStopsIds: [],
                        order: [],
                        totalStops: 0,
                        finishedStops: 0
                    }
                )));
            } else {
                const id = activeRouteDocumentId(new Date(startOfDay), tech.userId);
                const newRoute = {
                    id,
                    name: `${tech.userName}'s Route - ${format(date, 'MM/dd/yyyy')}`,
                    date: Timestamp.fromDate(new Date(startOfDay)),
                    techId: tech.userId,
                    techName: tech.userName,
                    serviceStopsIds: techStops.map(stop => stop.id),
                    totalStops: totalStopsCount,
                    finishedStops: finishedStopsCount,
                    status: newStatus,
                    durationSeconds: 0,
                    distanceMiles: 0,
                    vehicalId: "",
                    vehicleSource: "",
                    personalVehicleOwnerId: "",
                    vehicleLabel: "",
                    vehiclePlate: "",
                    vehicleKind: "",
                    order: buildActiveRouteOrder(null, techStops)
                };

                await setDoc(doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', id), newRoute);
            }
        }

        const finalRoutesSnapshot = await getDocs(routesQuery);
        const finalRoutes = finalRoutesSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(route => !route.duplicateOf);
        const syncedRoutes = Object.values(finalRoutes.reduce((routesByTech, route) => {
            const current = routesByTech[route.techId];
            routesByTech[route.techId] = pickCanonicalRoute([current, route].filter(Boolean));
            return routesByTech;
        }, {}));

        setActiveRoutes(syncedRoutes);
        setSelectedRouteId(previousRouteId => {
            if (previousRouteId === ALL_ROUTES_OPTION) {
                return ALL_ROUTES_OPTION;
            }

            if (syncedRoutes.some(route => route.id === previousRouteId)) {
                return previousRouteId;
            }

            return syncedRoutes.length > 0 ? ALL_ROUTES_OPTION : '';
        });

        return syncedRoutes;
    };

    useEffect(() => {
        fetchData(serviceDate).then(refreshWeekMetrics);
    }, [serviceDate, fetchData, refreshWeekMetrics]);

    useEffect(() => {
        fetchWeekMetrics(selectedWeekStart);
    }, [fetchWeekMetrics, selectedWeekStart, weekMetricsRefreshKey]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setVendors([]);
            return undefined;
        }

        let isMounted = true;

        fetchCompanyVendors(db, recentlySelectedCompany)
            .then((fetchedVendors) => {
                if (isMounted) setVendors(fetchedVendors);
            })
            .catch((error) => {
                console.error('Error loading vendors for route reorder:', error);
                if (isMounted) setVendors([]);
            });

        return () => {
            isMounted = false;
        };
    }, [recentlySelectedCompany]);

    const isAllRoutesSelected = selectedRouteId === ALL_ROUTES_OPTION;
    const displayActiveRoutes = useMemo(() => (
        activeRoutes.filter(route => getOrderedRouteStops(route, serviceStops).length > 0)
    ), [activeRoutes, serviceStops]);

    const selectedRoute = useMemo(
        () => isAllRoutesSelected ? null : displayActiveRoutes.find(route => route.id === selectedRouteId) || null,
        [displayActiveRoutes, isAllRoutesSelected, selectedRouteId]
    );

    const allRouteStops = useMemo(() => {
        const stopsWithRoute = [];
        const includedStopIds = new Set();

        displayActiveRoutes.forEach(route => {
            getOrderedRouteStops(route, serviceStops).forEach((stop, index) => {
                if (includedStopIds.has(stop.id)) return;

                includedStopIds.add(stop.id);
                stopsWithRoute.push({
                    ...stop,
                    routeId: route.id,
                    routeName: route.name,
                    routeTechId: route.techId,
                    routeTechName: route.techName,
                    routeStopIndex: index + 1,
                });
            });
        });

        serviceStops.forEach(stop => {
            if (includedStopIds.has(stop.id)) return;

            const techRoute = displayActiveRoutes.find(route => (
                route.techId === stop.techId ||
                route.techName === stop.tech ||
                route.serviceStopsIds?.includes(stop.id)
            ));

            includedStopIds.add(stop.id);
            stopsWithRoute.push({
                ...stop,
                routeId: techRoute?.id || '',
                routeName: techRoute?.name || '',
                routeTechId: techRoute?.techId || stop.techId || '',
                routeTechName: techRoute?.techName || stop.tech || 'Unassigned',
                routeStopIndex: null,
            });
        });

        return stopsWithRoute.sort((a, b) => {
            const techCompare = String(a.routeTechName || a.tech || '').localeCompare(String(b.routeTechName || b.tech || ''));
            if (techCompare !== 0) return techCompare;

            const aIndex = a.routeStopIndex ?? Number.MAX_SAFE_INTEGER;
            const bIndex = b.routeStopIndex ?? Number.MAX_SAFE_INTEGER;
            if (aIndex !== bIndex) return aIndex - bIndex;

            const aTime = getDateValue(a.serviceDate)?.getTime() || 0;
            const bTime = getDateValue(b.serviceDate)?.getTime() || 0;
            return aTime - bTime;
        });
    }, [displayActiveRoutes, serviceStops]);

    useEffect(() => {
        setSelectedRouteId(previousRouteId => {
            if (previousRouteId === ALL_ROUTES_OPTION) {
                return displayActiveRoutes.length > 0 ? ALL_ROUTES_OPTION : '';
            }

            if (displayActiveRoutes.some(route => route.id === previousRouteId)) {
                return previousRouteId;
            }

            return displayActiveRoutes.length > 0 ? ALL_ROUTES_OPTION : '';
        });
    }, [displayActiveRoutes]);

    const selectedRouteStops = useMemo(
        () => isAllRoutesSelected ? allRouteStops : getOrderedRouteStops(selectedRoute, serviceStops),
        [allRouteStops, isAllRoutesSelected, selectedRoute, serviceStops]
    );

    const selectedStopsForMove = useMemo(() => {
        const stopsById = new Map(allRouteStops.map(stop => [stop.id, stop]));

        serviceStops.forEach(stop => {
            if (!stopsById.has(stop.id)) {
                stopsById.set(stop.id, stop);
            }
        });

        return selectedStopIds
            .map(stopId => stopsById.get(stopId))
            .filter(Boolean)
            .filter(isStopMovable);
    }, [allRouteStops, selectedStopIds, serviceStops]);

    const selectedRouteLocations = useMemo(() => (
        isAllRoutesSelected ? [] :
        activeRouteLocations
            .filter(location => location.activeRouteId === selectedRouteId || location.routeId === selectedRouteId)
            .map(location => ({
                ...location,
                timeDate: getDateValue(location?.time),
            }))
            .filter(location => getRouteLocationCoordinate(location) && location.timeDate)
            .sort((a, b) => a.timeDate - b.timeDate)
    ), [activeRouteLocations, isAllRoutesSelected, selectedRouteId]);

    const selectedRouteAreaEstimates = useMemo(
        () => buildAreaEstimates(selectedRouteLocations, selectedRouteStops),
        [selectedRouteLocations, selectedRouteStops]
    );

    const selectedRouteLogs = useMemo(() => (
        isAllRoutesSelected ? [] :
        activeRouteLogs
            .filter(log => log.activeRouteId === selectedRouteId || log.routeId === selectedRouteId)
            .map(log => ({
                ...log,
                startTimeDate: getDateValue(log?.startTime),
                endTimeDate: getDateValue(log?.endTime),
            }))
            .filter(log => log.startTimeDate)
            .sort((a, b) => a.startTimeDate - b.startTimeDate)
    ), [activeRouteLogs, isAllRoutesSelected, selectedRouteId]);

    useEffect(() => {
        setSelectedStopIds([]);
        setMoveDate(new Date(serviceDate));
        setMoveDay(format(serviceDate, 'EEEE'));
    }, [serviceDate]);

    const toggleMapOverlay = (overlayName) => {
        setMapOverlays(previous => ({
            ...previous,
            [overlayName]: !previous[overlayName],
        }));
    };

    const toggleSelectedStop = (stop) => {
        if (!isStopMovable(stop)) {
            toast.error('Finished stops cannot be moved from the active route manager.');
            return;
        }

        setSelectedStopIds(currentIds => (
            currentIds.includes(stop.id)
                ? currentIds.filter(id => id !== stop.id)
                : [...currentIds, stop.id]
        ));
    };

    const toggleRouteUnfinishedStops = (route) => {
        const routeStopIds = getOrderedRouteStops(route, serviceStops)
            .filter(isStopMovable)
            .map(stop => stop.id);

        if (routeStopIds.length === 0) {
            toast.error('This route has no unfinished stops to move.');
            return;
        }

        setSelectedStopIds(currentIds => {
            const routeIdSet = new Set(routeStopIds);
            const hasEveryRouteStop = routeStopIds.every(stopId => currentIds.includes(stopId));

            if (hasEveryRouteStop) {
                return currentIds.filter(stopId => !routeIdSet.has(stopId));
            }

            return Array.from(new Set([...currentIds, ...routeStopIds]));
        });
    };

    const selectAllUnfinishedStops = () => {
        const unfinishedStopIds = serviceStops
            .filter(isStopMovable)
            .map(stop => stop.id);

        if (unfinishedStopIds.length === 0) {
            toast.error('There are no unfinished stops on this date.');
            return;
        }

        setSelectedStopIds(unfinishedStopIds);
    };

    const moveSelectedStops = async () => {
        if (!recentlySelectedCompany || selectedStopsForMove.length === 0) return;

        const destinationTech = technicians.find(tech => tech.userId === moveTechId);
        if (!destinationTech) {
            toast.error('Select a destination technician.');
            return;
        }

        setIsMovingStops(true);

        try {
            if (moveMode === MOVE_MODE_PERMANENT) {
                const updateServiceStopDayPermanently = httpsCallable(functions, 'updateServiceStopDayPermanently');
                const response = await updateServiceStopDayPermanently({
                    companyId: recentlySelectedCompany,
                    serviceStopList: selectedStopsForMove.map(stop => ({ id: stop.id })),
                    newTech: {
                        userId: destinationTech.userId,
                        userName: destinationTech.userName,
                    },
                    newDay: moveDay,
                });

                if (response?.data?.status === 500) {
                    throw new Error(response.data.error || 'Permanent move failed.');
                }

                toast.success('Permanent move submitted.');
            } else {
                const nextServiceDate = new Date(moveDate);
                nextServiceDate.setHours(0, 0, 0, 0);
                const batch = writeBatch(db);

                selectedStopsForMove.forEach(stop => {
                    batch.update(doc(db, 'companies', recentlySelectedCompany, 'serviceStops', stop.id), {
                        serviceDate: Timestamp.fromDate(nextServiceDate),
                        techId: destinationTech.userId,
                        tech: destinationTech.userName,
                        updatedAt: Timestamp.fromDate(new Date()),
                    });
                });

                await batch.commit();
                toast.success('Selected stops moved.');
            }

            setSelectedStopIds([]);
            await fetchData(serviceDate);
            refreshWeekMetrics();
        } catch (error) {
            console.error('Error moving selected stops:', error);
            toast.error('Failed to move selected stops.');
        } finally {
            setIsMovingStops(false);
        }
    };

    const updateRouteVehicle = async (route, selectedValue) => {
        if (!recentlySelectedCompany || !route?.id) return;

        setVehicleUpdatingRouteId(route.id);

        try {
            let payload = {
                vehicalId: "",
                vehicleSource: "",
                personalVehicleOwnerId: "",
                vehicleLabel: "",
                vehiclePlate: "",
                vehicleKind: "",
                vehicleMake: "",
                vehicleModel: "",
            };

            if (selectedValue.startsWith('fleet:')) {
                const vehicleId = selectedValue.replace('fleet:', '');
                const vehicle = fleetVehicles.find(item => item.id === vehicleId);

                if (!vehicle) {
                    toast.error('Vehicle no longer exists.');
                    return;
                }

                payload = {
                    ...payload,
                    vehicalId: vehicle.id,
                    vehicleSource: 'Company Fleet',
                    vehicleLabel: vehicleLabel(vehicle),
                    vehiclePlate: vehicle.plate || "",
                    vehicleKind: vehicle.vehicalType || "",
                    vehicleMake: vehicle.make || "",
                    vehicleModel: vehicle.model || "",
                };
            } else if (selectedValue.startsWith('personal:')) {
                const ownerId = selectedValue.replace('personal:', '');
                const tech = technicians.find(item => item.userId === ownerId);
                const personalVehicle = tech?.personalVehicle || {};

                if (!tech?.allowPersonalVehicle) {
                    toast.error('This technician is not allowed to use a personal vehicle.');
                    return;
                }

                payload = {
                    ...payload,
                    vehicleSource: 'Personal',
                    personalVehicleOwnerId: ownerId,
                    vehicleLabel: personalVehicleLabel(tech),
                    vehiclePlate: personalVehicle.plate || "",
                    vehicleKind: personalVehicle.vehicalType || "",
                    vehicleMake: personalVehicle.make || "",
                    vehicleModel: personalVehicle.model || "",
                    personalVehicle: {
                        nickName: personalVehicle.nickName || "",
                        vehicalType: personalVehicle.vehicalType || "",
                        year: personalVehicle.year || "",
                        make: personalVehicle.make || "",
                        model: personalVehicle.model || "",
                        color: personalVehicle.color || "",
                        plate: personalVehicle.plate || "",
                        miles: Number(personalVehicle.miles || 0),
                    },
                };
            }

            await updateDoc(doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', route.id), payload);

            setActiveRoutes(currentRoutes => (
                currentRoutes.map(currentRoute => (
                    currentRoute.id === route.id ? { ...currentRoute, ...payload } : currentRoute
                ))
            ));

            toast.success('Route vehicle updated.');
        } catch (error) {
            console.error('Error updating route vehicle:', error);
            toast.error('Failed to update route vehicle.');
        } finally {
            setVehicleUpdatingRouteId('');
        }
    };

    const saveRouteCompletion = async (route, draft) => {
        if (!recentlySelectedCompany || !route?.id) return;

        const startMileage = numberOrNull(draft.startMileage);
        const endMileage = numberOrNull(draft.endMileage);

        if (startMileage !== null && endMileage !== null && endMileage < startMileage) {
            toast.error("End mileage must be greater than or equal to start mileage.");
            return;
        }

        const completedAt = new Date();
        const routeStartTime =
            getDateValue(route.startTime) ||
            getDateValue(route.startTimeDate) ||
            getDateValue(route.date) ||
            completedAt;
        const distanceMiles =
            startMileage !== null && endMileage !== null
                ? Number((endMileage - startMileage).toFixed(1))
                : Number(route.distanceMiles || route.distance || 0);
        const durationMinutes = minutesBetween(routeStartTime, completedAt);
        const payload = {
            startMilage: startMileage,
            startMileage,
            endMilage: endMileage,
            endMileage,
            distanceMiles,
            distance: distanceMiles,
            endTime: Timestamp.fromDate(completedAt),
            completedAt: Timestamp.fromDate(completedAt),
            completedDate: Timestamp.fromDate(completedAt),
            durationSeconds: durationMinutes * 60,
            status: "Finished",
            operationStatus: "Finished",
            mileageStatus: endMileage !== null ? "Complete" : "Needs Mileage",
            completionNotes: draft.completionNotes || "",
            finishedStops: route.totalStops || route.finishedStops || 0,
        };

        try {
            await updateDoc(doc(db, "companies", recentlySelectedCompany, "activeRoutes", route.id), payload);

            if (route.vehicalId && endMileage !== null) {
                await updateDoc(doc(db, "companies", recentlySelectedCompany, "vehicals", route.vehicalId), {
                    miles: endMileage,
                    lastRouteId: route.id,
                    lastRouteDate: route.date || Timestamp.fromDate(completedAt),
                    lastRouteMileageUpdatedAt: Timestamp.fromDate(completedAt),
                });
            }

            setActiveRoutes((currentRoutes) =>
                currentRoutes.map((currentRoute) =>
                    currentRoute.id === route.id ? { ...currentRoute, ...payload } : currentRoute
                )
            );

            toast.success("Route completion saved.");
        } catch (error) {
            console.error("Error saving route completion:", error);
            toast.error("Failed to save route completion.");
        }
    };

    const findRecurringRouteForActiveRoute = async (route, activeOrder) => {
        if (!recentlySelectedCompany || !route?.techId) return null;

        const directRouteId = route.recurringRouteId || route.plannedRouteId || route.routeTemplateId || route.recurringRouteDocId;
        if (directRouteId) {
            const directRef = doc(db, 'companies', recentlySelectedCompany, 'recurringRoutes', directRouteId);
            const directSnap = await getDoc(directRef);

            if (directSnap.exists()) {
                return { id: directSnap.id, ...directSnap.data() };
            }
        }

        const routeDate = getDateValue(route.date) || serviceDate;
        const routeDay = format(routeDate, 'EEEE');
        const activeRecurringIds = new Set(
            activeOrder
                .map(item => item.recurringServiceStopId)
                .filter(Boolean)
        );

        const routesSnapshot = await getDocs(query(
            collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes'),
            where('techId', '==', route.techId)
        ));

        const candidates = routesSnapshot.docs
            .map(routeDoc => ({ id: routeDoc.id, ...routeDoc.data() }))
            .filter(candidate => candidate.day === routeDay);

        if (candidates.length === 0) return null;
        if (candidates.length === 1 && activeRecurringIds.size === 0) return candidates[0];

        const scoredCandidates = candidates
            .map(candidate => {
                const candidateOrder = Array.isArray(candidate.order)
                    ? candidate.order
                    : Array.isArray(candidate.recurringRouteOrder)
                        ? candidate.recurringRouteOrder
                        : [];
                const candidateIds = new Set([
                    ...candidateOrder.map(item => item.recurringServiceStopId).filter(Boolean),
                    ...(Array.isArray(candidate.rssIds) ? candidate.rssIds : []),
                ]);
                const score = [...activeRecurringIds].filter(rssId => candidateIds.has(rssId)).length;

                return { candidate, score };
            })
            .sort((left, right) => right.score - left.score);

        if (scoredCandidates[0]?.score > 0) return scoredCandidates[0].candidate;

        return candidates.length === 1 ? candidates[0] : null;
    };

    const saveRouteOrder = async (route, orderedStops, options = {}) => {
        if (!recentlySelectedCompany || !route?.id || !orderedStops?.length) return false;

        const nextOrder = buildActiveRouteOrder(route, orderedStops);
        const serviceStopsIds = orderedStops.map(stop => stop.id);
        const updatePlannedRoute = Boolean(options.updatePlannedRoute);
        const activeRoutePayload = {
            serviceStopsIds,
            order: nextOrder,
            totalStops: orderedStops.length,
            updatedAt: Timestamp.fromDate(new Date()),
        };
        let activeRouteSaved = false;

        try {
            await updateDoc(doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', route.id), activeRoutePayload);
            activeRouteSaved = true;

            setActiveRoutes(currentRoutes => (
                currentRoutes.map(currentRoute => (
                    currentRoute.id === route.id
                        ? { ...currentRoute, ...activeRoutePayload }
                        : currentRoute
                ))
            ));

            if (updatePlannedRoute) {
                const recurringRoute = await findRecurringRouteForActiveRoute(route, nextOrder);

                if (!recurringRoute) {
                    throw new Error('No matching planned route was found for this technician and day.');
                }

                const updateRecurringRouteOrderPermanently = httpsCallable(functions, 'updateRecurringRouteOrderPermanently');
                const response = await updateRecurringRouteOrderPermanently({
                    companyId: recentlySelectedCompany,
                    routeId: recurringRoute.id,
                    recurringRouteOrder: recurringRoute.order || recurringRoute.recurringRouteOrder || [],
                    serviceStopOrders: nextOrder,
                });

                if (response?.data?.status === 500 || response?.data?.success === false) {
                    throw new Error(response.data.error || 'Planned route order update failed.');
                }
            }

            toast.success(updatePlannedRoute ? 'Route order saved and planned route updated.' : 'Route order saved for today.');
            await fetchData(serviceDate);
            refreshWeekMetrics();
            return true;
        } catch (error) {
            console.error('Error saving route order:', error);
            toast.error(activeRouteSaved && updatePlannedRoute
                ? 'Daily order saved, but failed to update the planned route.'
                : 'Failed to save route order.'
            );

            if (activeRouteSaved) {
                await fetchData(serviceDate);
                refreshWeekMetrics();
            }

            return false;
        }
    };

    const seedDemoRoute = async () => {
        if (!recentlySelectedCompany || process.env.NODE_ENV === 'production') return;

        setIsSeedingDemoRoute(true);

        try {
            const seededDate = new Date(serviceDate);
            seededDate.setHours(0, 0, 0, 0);

            const demo = buildDemoRouteData(recentlySelectedCompany, seededDate);
            const batch = writeBatch(db);
            const companyRef = collection(db, 'companies', recentlySelectedCompany, 'companyUsers');
            const stopsRef = collection(db, 'companies', recentlySelectedCompany, 'serviceStops');
            const routesRef = collection(db, 'companies', recentlySelectedCompany, 'activeRoutes');
            const locationsRef = collection(db, 'companies', recentlySelectedCompany, 'activeRouteLocations');
            const logsRef = collection(db, 'companies', recentlySelectedCompany, 'activeRouteLogs');

            batch.set(doc(companyRef, demo.tech.docId), demo.tech, { merge: true });
            demo.stops.forEach(stop => batch.set(doc(stopsRef, stop.id), stop, { merge: true }));
            batch.set(doc(routesRef, demo.route.id), demo.route, { merge: true });
            demo.locations.forEach(location => batch.set(doc(locationsRef, location.id), location, { merge: true }));
            demo.logs.forEach(log => batch.set(doc(logsRef, log.id), log, { merge: true }));

            await batch.commit();
            toast.success('Demo route data added.');
            await fetchData(serviceDate);
            refreshWeekMetrics();
        } catch (error) {
            console.error('Error seeding demo route:', error);
            toast.error('Failed to add demo route data.');
        } finally {
            setIsSeedingDemoRoute(false);
        }
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className=" mx-auto">
                <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Daily Route Board</h1>
                        <p className="text-gray-500">Manage today's routes, stops, technician locations, and route activity.</p>
                    </div>
                    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <Link
                            to="/company/serviceStops"
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-center text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                        >
                            Service Stops
                        </Link>
                        {!sameCalendarDate(serviceDate, todayDate) && (
                            <button
                                type="button"
                                onClick={() => handleServiceDateChange(todayDate)}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                            >
                                Today
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowMoveStopsPanel((current) => !current)}
                            className={`rounded-lg border px-3 py-2 text-sm font-semibold shadow-sm transition ${showMoveStopsPanel
                                    ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                }`}
                        >
                            Move Stops{selectedStopsForMove.length ? ` (${selectedStopsForMove.length})` : ''}
                        </button>
                        {process.env.NODE_ENV !== 'production' && (
                            <button
                                type="button"
                                onClick={seedDemoRoute}
                                disabled={isSeedingDemoRoute || !recentlySelectedCompany}
                                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isSeedingDemoRoute ? 'Adding Demo...' : 'Add Demo Route'}
                            </button>
                        )}
                        <DatePicker
                            selected={serviceDate}
                            onChange={handleServiceDateChange}
                            minDate={currentWeekStart}
                            maxDate={maxSelectableDate}
                            className="bg-white border border-gray-300 rounded-lg p-2 shadow-sm text-gray-700"
                        />
                    </div>
                </header>

                <RouteWeekNavigator
                    weekDays={weekDays}
                    weekMetrics={weekMetrics}
                    weekTotals={weekTotals}
                    selectedDate={serviceDate}
                    todayDate={todayDate}
                    isLoading={isLoadingWeekMetrics}
                    canNavigatePreviousWeek={canNavigatePreviousWeek}
                    canNavigateNextWeek={canNavigateNextWeek}
                    onPreviousWeek={() => navigateWeek(-1)}
                    onNextWeek={() => navigateWeek(1)}
                    onSelectDate={handleServiceDateChange}
                />

                {!isLoading && showMoveStopsPanel && (
                    <div className="mb-4">
                        <MoveStopsPanel
                            selectedStops={selectedStopsForMove}
                            selectedStopIds={selectedStopIds}
                            totalStops={serviceStops.length}
                            technicians={technicians}
                            moveMode={moveMode}
                            moveDate={moveDate}
                            moveDay={moveDay}
                            moveTechId={moveTechId}
                            isMovingStops={isMovingStops}
                            onMoveModeChange={setMoveMode}
                            onMoveDateChange={setMoveDate}
                            onMoveDayChange={setMoveDay}
                            onMoveTechChange={setMoveTechId}
                            onMoveSelectedStops={moveSelectedStops}
                            onSelectAllUnfinished={selectAllUnfinishedStops}
                            onClearSelection={() => setSelectedStopIds([])}
                        />
                    </div>
                )}

                {isLoading ? (
                    <div className="flex justify-center items-center h-64">
                        <p className="text-gray-500">Loading dashboard...</p>
                    </div>
                ) : (
                    <main className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
                        <div className="min-w-0 space-y-4">
                            <RouteWorkloadBoard
                                routes={displayActiveRoutes}
                                stops={serviceStops}
                                selectedRouteId={selectedRouteId}
                                selectedStopIds={selectedStopIds}
                                onSelectRoute={setSelectedRouteId}
                                onSelectRouteStops={toggleRouteUnfinishedStops}
                                onToggleStop={toggleSelectedStop}
                                onOpenStop={(stop) => navigate(`/company/serviceStops/detail/${stop.id}`)}
                            />

                            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-800">Map & Activity</h2>
                                        <p className="text-sm text-gray-500">
                                            {isAllRoutesSelected
                                                ? 'All technician service stops for the selected day. Trails and time areas are hidden in this view.'
                                                : 'Focused route map, technician trail, and activity timeline.'}
                                        </p>
                                    </div>

                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                        <select
                                            value={selectedRouteId}
                                            onChange={(event) => setSelectedRouteId(event.target.value)}
                                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm sm:w-72"
                                            disabled={displayActiveRoutes.length === 0}
                                        >
                                            {displayActiveRoutes.length === 0 ? (
                                                <option value="">No active routes</option>
                                            ) : (
                                                <>
                                                    <option value={ALL_ROUTES_OPTION}>All technicians</option>
                                                    {displayActiveRoutes.map(route => (
                                                        <option key={route.id} value={route.id}>
                                                            {route.techName || route.name || 'Route'}
                                                        </option>
                                                    ))}
                                                </>
                                            )}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => setShowMapPanel((current) => !current)}
                                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                                        >
                                            {showMapPanel ? 'Hide Map' : 'Show Map'}
                                        </button>
                                    </div>
                                </div>

                                {showMapPanel && (
                                    <>
                                        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                                            <RouteMapMetric
                                                label={isAllRoutesSelected ? 'Total Stops' : 'Stops'}
                                                value={selectedRouteStops.length}
                                                tone="blue"
                                            />
                                            <RouteMapMetric
                                                label={isAllRoutesSelected ? 'Technicians' : 'Trail Points'}
                                                value={isAllRoutesSelected ? displayActiveRoutes.length : selectedRouteLocations.length}
                                                tone="orange"
                                            />
                                            <RouteMapMetric
                                                label={isAllRoutesSelected ? 'Finished' : 'Time Areas'}
                                                value={isAllRoutesSelected ? selectedRouteStops.filter(stop => getStopTiming(stop).end).length : selectedRouteAreaEstimates.length}
                                                tone="purple"
                                            />
                                            <RouteMapMetric
                                                label={isAllRoutesSelected ? 'In Progress' : 'Route Logs'}
                                                value={isAllRoutesSelected ? selectedRouteStops.filter(stop => {
                                                    const { start, end } = getStopTiming(stop);
                                                    return start && !end;
                                                }).length : selectedRouteLogs.length}
                                                tone="emerald"
                                            />
                                        </div>

                                        {selectedRoute && (
                                            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                                                <span className="font-semibold text-gray-900">Vehicle:</span>{" "}
                                                {routeVehicleSummary(selectedRoute, fleetVehicles, technicians)}
                                                <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-500">
                                                    {routeVehicleSourceLabel(selectedRoute)}
                                                </span>
                                            </div>
                                        )}

                                        {isAllRoutesSelected ? (
                                            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                                                Showing service stops only across all technicians.
                                            </div>
                                        ) : (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                <OverlayButton
                                                    label="Stops"
                                                    colorClass="blue"
                                                    isOn={mapOverlays.stops}
                                                    onClick={() => toggleMapOverlay('stops')}
                                                />
                                                <OverlayButton
                                                    label="Tech trail"
                                                    colorClass="orange"
                                                    isOn={mapOverlays.techTrail}
                                                    onClick={() => toggleMapOverlay('techTrail')}
                                                />
                                                <OverlayButton
                                                    label="Time areas"
                                                    colorClass="purple"
                                                    isOn={mapOverlays.timeAreas}
                                                    onClick={() => toggleMapOverlay('timeAreas')}
                                                />
                                            </div>
                                        )}

                                        <div className="mt-4 h-80 w-full overflow-hidden rounded-lg border border-gray-200 md:h-[420px]">
                                            {(isAllRoutesSelected || selectedRoute) && (selectedRouteStops.length > 0 || selectedRouteLocations.length > 0) ? (
                                                <RouteActivityMap
                                                    route={selectedRoute}
                                                    stops={selectedRouteStops}
                                                    routeLocations={selectedRouteLocations}
                                                    areaEstimates={selectedRouteAreaEstimates}
                                                    overlays={isAllRoutesSelected ? ALL_ROUTES_MAP_OVERLAYS : mapOverlays}
                                                    showTechnicianLabels={isAllRoutesSelected}
                                                />
                                            ) : (
                                                <div className='flex h-full items-center justify-center bg-gray-100'>
                                                    <p className='text-gray-500'>
                                                        {isAllRoutesSelected ? 'No service stop map data for this date.' : 'No map data for this route.'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {!isAllRoutesSelected && selectedRoute && (
                                            <RouteProgressTimeline
                                                route={selectedRoute}
                                                stops={selectedRouteStops}
                                                areaEstimates={selectedRouteAreaEstimates}
                                                routeLogs={selectedRouteLogs}
                                                now={now}
                                            />
                                        )}
                                    </>
                                )}
                            </section>

                            {!isAllRoutesSelected && selectedRoute && (
                                <ActiveRouteDetailPanel
                                    route={selectedRoute}
                                    stops={selectedRouteStops}
                                    locations={selectedRouteLocations}
                                    areaEstimates={selectedRouteAreaEstimates}
                                    routeLogs={selectedRouteLogs}
                                    selectedStopIds={selectedStopIds}
                                    vendors={vendors}
                                    onSaveRouteCompletion={saveRouteCompletion}
                                    onSaveRouteOrder={saveRouteOrder}
                                    onToggleStop={toggleSelectedStop}
                                    onOpenStop={(stop) => navigate(`/company/serviceStops/detail/${stop.id}`)}
                                />
                            )}

                            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                                <h2 className='text-lg font-bold text-gray-800'>
                                    Service Stops ({serviceStops.length})
                                </h2>
                                <ServiceStopTable
                                    stops={serviceStops}
                                    navigate={navigate}
                                    now={now}
                                    selectedStopIds={selectedStopIds}
                                    onToggleStop={toggleSelectedStop}
                                />
                            </section>
                        </div>

                        <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
                            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                                <h2 className="text-lg font-bold text-gray-800">Technician Overview</h2>
                                <div className="mt-3 max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                                    {displayActiveRoutes.length > 0 ? displayActiveRoutes.map(route => (
                                        <TechRouteCard
                                            key={route.id}
                                            route={route}
                                            stops={serviceStops}
                                            now={now}
                                            technicians={technicians}
                                            fleetVehicles={fleetVehicles}
                                            onVehicleChange={updateRouteVehicle}
                                            isVehicleUpdating={vehicleUpdatingRouteId === route.id}
                                        />
                                    )) : (
                                        <p className="text-gray-500 pt-4">No active routes for this date.</p>
                                    )}
                                </div>
                            </section>
                        </aside>
                    </main>
                )}
            </div>
        </div>
    );
};

const WeekBucketStat = ({ label, value, className }) => (
    <div className={`rounded-lg border px-3 py-2 ${className}`}>
        <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</p>
        <p className="mt-0.5 text-lg font-bold leading-none">{value}</p>
    </div>
);

const RouteWeekNavigator = ({
    weekDays,
    weekMetrics,
    weekTotals,
    selectedDate,
    todayDate,
    isLoading,
    canNavigatePreviousWeek,
    canNavigateNextWeek,
    onPreviousWeek,
    onNextWeek,
    onSelectDate,
}) => (
    <section className="mb-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-col gap-3 border-b border-gray-100 pb-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Week Total</p>
                <div className="mt-1 flex items-end gap-2">
                    <p className="text-3xl font-bold leading-none text-gray-900">
                        {isLoading ? '...' : weekTotals.totalStops}
                    </p>
                    <p className="pb-1 text-sm font-semibold text-gray-500">stops</p>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <WeekBucketStat
                    label="Routes"
                    value={isLoading ? '...' : weekTotals.routes}
                    className="border-blue-100 bg-blue-50 text-blue-700"
                />
                <WeekBucketStat
                    label="Jobs"
                    value={isLoading ? '...' : weekTotals.jobs}
                    className="border-emerald-100 bg-emerald-50 text-emerald-700"
                />
                <WeekBucketStat
                    label="Estimates"
                    value={isLoading ? '...' : weekTotals.estimates}
                    className="border-violet-100 bg-violet-50 text-violet-700"
                />
            </div>
        </div>
        <div className="flex items-stretch gap-2">
            <button
                type="button"
                onClick={onPreviousWeek}
                disabled={!canNavigatePreviousWeek}
                className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Previous week"
            >
                <ChevronLeftIcon className="h-4 w-4" />
            </button>

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {weekDays.map(({ dayName, date }) => {
                    const key = dayKey(date);
                    const metric = weekMetrics[key] || {};
                    const isSelected = sameCalendarDate(date, selectedDate);
                    const isToday = sameCalendarDate(date, todayDate);
                    const routeCount = metric.routeCount ?? 0;
                    const serviceStopCount = metric.serviceStopCount ?? 0;

                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onSelectDate(date)}
                            className={`min-w-0 rounded-lg border px-3 py-2 text-left transition ${isSelected
                                    ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                                    : isToday
                                        ? 'border-blue-200 bg-blue-50 text-gray-900 hover:bg-blue-100'
                                        : 'border-gray-200 bg-gray-50 text-gray-800 hover:border-gray-300 hover:bg-white'
                                }`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className={`truncate text-sm font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                                        {dayName}
                                    </p>
                                    <p className={`text-xs font-semibold ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                                        {format(date, 'MMM d')}
                                    </p>
                                </div>
                                {isToday && (
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${isSelected ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'}`}>
                                        Today
                                    </span>
                                )}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-1">
                                <div className={`rounded-md px-2 py-1 ${isSelected ? 'bg-white/15' : 'bg-white'}`}>
                                    <p className={`text-[10px] font-semibold uppercase ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                                        Stops
                                    </p>
                                    <p className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                                        {isLoading ? '...' : serviceStopCount}
                                    </p>
                                </div>
                                <div className={`rounded-md px-2 py-1 ${isSelected ? 'bg-white/15' : 'bg-white'}`}>
                                    <p className={`text-[10px] font-semibold uppercase ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                                        Routes
                                    </p>
                                    <p className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                                        {isLoading ? '...' : routeCount}
                                    </p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <button
                type="button"
                onClick={onNextWeek}
                disabled={!canNavigateNextWeek}
                className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Next week"
            >
                <ChevronRightIcon className="h-4 w-4" />
            </button>
        </div>
    </section>
);

const getRouteStatusClass = (status) => {
    switch (status) {
        case 'Finished':
            return 'bg-green-100 text-green-800';
        case 'In Progress':
            return 'bg-blue-100 text-blue-800';
        default:
            return 'bg-yellow-100 text-yellow-800';
    }
};

const RouteWorkloadBoard = ({
    routes,
    stops,
    selectedRouteId,
    selectedStopIds,
    onSelectRoute,
    onSelectRouteStops,
    onToggleStop,
    onOpenStop,
}) => {
    const routeGroups = useMemo(() => {
        const routedStopIds = new Set();
        const groups = routes
            .map(route => {
                const routeStops = getOrderedRouteStops(route, stops);
                routeStops.forEach(stop => routedStopIds.add(stop.id));

                return {
                    id: route.id,
                    route,
                    techName: route.techName || route.name || 'Route',
                    stops: routeStops,
                };
            })
            .filter(group => group.stops.length > 0)
            .sort((a, b) => a.techName.localeCompare(b.techName));
        const looseStops = stops.filter(stop => !routedStopIds.has(stop.id));

        if (looseStops.length > 0) {
            groups.push({
                id: 'unassigned-route-stops',
                route: null,
                techName: 'Unassigned',
                stops: looseStops,
            });
        }

        return groups;
    }, [routes, stops]);
    const finishedCount = stops.filter(stop => getStopTiming(stop).end).length;
    const unfinishedCount = stops.filter(isStopMovable).length;

    return (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">Daily Routes</h2>
                    <p className="text-sm text-gray-500">Dense dispatch view for route-level or individual stop moves.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <DetailPill label="Stops" value={stops.length} />
                    <DetailPill label="Routes" value={routes.length} />
                    <DetailPill label="Finished" value={finishedCount} />
                    <DetailPill label="Open" value={unfinishedCount} />
                </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                {routeGroups.length ? routeGroups.map(group => {
                    const finishedCount = group.stops.filter(stop => getStopTiming(stop).end).length;
                    const selectedInRoute = group.stops.filter(stop => selectedStopIds.includes(stop.id)).length;
                    const isFocused = group.route && selectedRouteId === group.route.id;

                    return (
                        <div
                            key={group.id}
                            className={`overflow-hidden rounded-lg border ${isFocused ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'}`}
                        >
                            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-gray-900">{group.techName}</p>
                                        <p className="text-xs text-gray-500">{finishedCount}/{group.stops.length} finished</p>
                                    </div>
                                    {group.route && (
                                        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${getRouteStatusClass(group.route.status)}`}>
                                            {group.route.status || 'Did Not Start'}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {group.route && (
                                        <button
                                            type="button"
                                            onClick={() => onSelectRoute(group.route.id)}
                                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                                        >
                                            Focus
                                        </button>
                                    )}
                                    {group.route && (
                                        <button
                                            type="button"
                                            onClick={() => onSelectRouteStops(group.route)}
                                            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                                        >
                                            {selectedInRoute ? `${selectedInRoute} selected` : 'Select unfinished'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
                                {group.stops.map((stop, index) => {
                                    const status = getStopDisplayStatus(stop);
                                    const routeIndex = stop.routeStopIndex || index + 1;
                                    const isSelected = selectedStopIds.includes(stop.id);
                                    const movable = isStopMovable(stop);

                                    return (
                                        <div
                                            key={stop.id}
                                            className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => onToggleStop(stop)}
                                                disabled={!movable}
                                                className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${isSelected
                                                        ? 'border-blue-600 bg-blue-600 text-white'
                                                        : movable
                                                            ? 'border-blue-100 bg-blue-50 text-blue-700 hover:border-blue-400'
                                                            : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                                                    }`}
                                                title={movable ? 'Select stop to move' : 'Finished stops cannot be moved'}
                                            >
                                                {isSelected ? '✓' : routeIndex}
                                            </button>
                                            <span className="min-w-0 flex-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenStop(stop)}
                                                    className="block min-w-0 text-left"
                                                >
                                                    <span className="block truncate text-sm font-semibold text-gray-900">{stop.customerName || 'Service Stop'}</span>
                                                    <span className="block truncate text-xs text-gray-500">{stop.address?.streetAddress || 'No address'}</span>
                                                </button>
                                            </span>
                                            <span
                                                className={`h-2.5 w-2.5 rounded-full ${status.label === 'Finished'
                                                        ? 'bg-green-500'
                                                        : status.label === 'In Progress'
                                                            ? 'bg-blue-500'
                                                            : 'bg-yellow-500'
                                                    }`}
                                                title={status.label}
                                            >
                                                <span className="sr-only">{status.label}</span>
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                }) : (
                    <div className="rounded-lg border border-gray-200 px-4 py-6 text-sm text-gray-500 xl:col-span-2">
                        No service stops loaded for this date.
                    </div>
                )}
            </div>
        </section>
    );
};

const MoveStopsPanel = ({
    selectedStops,
    selectedStopIds,
    totalStops,
    technicians,
    moveMode,
    moveDate,
    moveDay,
    moveTechId,
    isMovingStops,
    onMoveModeChange,
    onMoveDateChange,
    onMoveDayChange,
    onMoveTechChange,
    onMoveSelectedStops,
    onSelectAllUnfinished,
    onClearSelection,
}) => {
    const selectedCount = selectedStops.length;
    const selectedPreview = selectedStops.slice(0, 4);

    return (
        <section className="rounded-xl border border-blue-200 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0 xl:w-52">
                    <h2 className="text-lg font-bold text-gray-800">Move Stops</h2>
                    <p className="text-sm text-gray-500">{selectedCount} selected out of {totalStops}</p>
                    <span className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                        {selectedCount}
                    </span>
                </div>

                <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-[220px_180px_minmax(200px,1fr)_220px]">
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Move Type</span>
                        <div className="mt-1 grid grid-cols-2 rounded-lg border border-gray-200 bg-gray-50 p-1">
                            <button
                                type="button"
                                onClick={() => onMoveModeChange(MOVE_MODE_ONE_TIME)}
                                className={`rounded-md px-3 py-2 text-sm font-semibold ${moveMode === MOVE_MODE_ONE_TIME ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                            >
                                One Time
                            </button>
                            <button
                                type="button"
                                onClick={() => onMoveModeChange(MOVE_MODE_PERMANENT)}
                                className={`rounded-md px-3 py-2 text-sm font-semibold ${moveMode === MOVE_MODE_PERMANENT ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                            >
                                Permanent
                            </button>
                        </div>
                    </div>

                    {moveMode === MOVE_MODE_ONE_TIME ? (
                        <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Destination Date</span>
                            <DatePicker
                                selected={moveDate}
                                onChange={onMoveDateChange}
                                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                    ) : (
                        <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recurring Day</span>
                            <select
                                value={moveDay}
                                onChange={(event) => onMoveDayChange(event.target.value)}
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                            >
                                {DAYS_OF_WEEK.map(day => (
                                    <option key={day} value={day}>{day}</option>
                                ))}
                            </select>
                        </label>
                    )}

                    <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Technician</span>
                        <select
                            value={moveTechId}
                            onChange={(event) => onMoveTechChange(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                            <option value="">Select technician</option>
                            {technicians.map(tech => (
                                <option key={tech.userId || tech.docId} value={tech.userId}>
                                    {tech.userName}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selection</span>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={onSelectAllUnfinished}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Select All Open
                            </button>
                            <button
                                type="button"
                                onClick={onClearSelection}
                                disabled={selectedStopIds.length === 0}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>

                <div className="xl:w-56">
                    <button
                        type="button"
                        onClick={onMoveSelectedStops}
                        disabled={!selectedCount || !moveTechId || isMovingStops}
                        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isMovingStops ? 'Moving...' : `Move ${selectedCount || ''} Stop${selectedCount === 1 ? '' : 's'}`}
                    </button>
                    {moveMode === MOVE_MODE_PERMANENT && (
                        <p className="mt-2 text-xs text-gray-500">Permanent moves update recurring and future unfinished stops.</p>
                    )}
                </div>
            </div>

            {selectedPreview.length > 0 && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        {selectedPreview.map(stop => (
                            <div key={stop.id} className="min-w-0 text-sm">
                                <p className="truncate font-semibold text-gray-900">{stop.customerName || 'Service Stop'}</p>
                                <p className="truncate text-xs text-gray-500">{stop.routeTechName || stop.tech || 'Unassigned'}</p>
                            </div>
                        ))}
                        {selectedStops.length > selectedPreview.length && (
                            <p className="text-xs font-semibold text-gray-500">
                                +{selectedStops.length - selectedPreview.length} more
                            </p>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
};

const ActiveRouteDetailPanel = ({
    route,
    stops,
    locations,
    areaEstimates,
    routeLogs,
    selectedStopIds,
    vendors = [],
    onSaveRouteCompletion,
    onSaveRouteOrder,
    onToggleStop,
    onOpenStop,
}) => {
    const expectedStopCount = route.serviceStopsIds?.length || 0;
    const hasStopMismatch = expectedStopCount !== stops.length;
    const latestLocation = locations[locations.length - 1] || null;
    const selectedCount = stops.filter(stop => selectedStopIds.includes(stop.id)).length;
    const unfinishedStops = stops.filter(isStopMovable);
    const [completionDraft, setCompletionDraft] = useState({
        startMileage: "",
        endMileage: "",
        completionNotes: "",
    });
    const [isEditingOrder, setIsEditingOrder] = useState(false);
    const [draftStops, setDraftStops] = useState(stops);
    const [isOrderDirty, setIsOrderDirty] = useState(false);
    const [anchorPosition, setAnchorPosition] = useState('start');
    const [anchorSource, setAnchorSource] = useState('vendor');
    const [selectedVendorId, setSelectedVendorId] = useState('');
    const [manualAnchorAddress, setManualAnchorAddress] = useState(null);
    const [manualAnchorInput, setManualAnchorInput] = useState('');
    const [isSavingOrder, setIsSavingOrder] = useState(false);
    const stopSignature = useMemo(() => stops.map(stop => stop.id).join('|'), [stops]);
    const displayStops = isEditingOrder ? draftStops : stops;
    const selectedVendor = vendors.find(vendor => vendor.id === selectedVendorId);

    useEffect(() => {
        setCompletionDraft({
            startMileage: route.startMilage ?? route.startMileage ?? "",
            endMileage: route.endMilage ?? route.endMileage ?? "",
            completionNotes: route.completionNotes || "",
        });
    }, [route.completionNotes, route.endMilage, route.endMileage, route.id, route.startMilage, route.startMileage]);

    useEffect(() => {
        setDraftStops(stops);
        setIsOrderDirty(false);
        setIsEditingOrder(false);
    }, [route.id, stopSignature]);

    const updateCompletionDraft = (field, value) => {
        setCompletionDraft((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const startEditingOrder = () => {
        setDraftStops(stops);
        setIsOrderDirty(false);
        setIsEditingOrder(true);
    };

    const cancelEditingOrder = () => {
        setDraftStops(stops);
        setIsOrderDirty(false);
        setIsEditingOrder(false);
    };

    const moveDraftStop = (index, direction) => {
        const nextIndex = index + direction;

        if (nextIndex < 0 || nextIndex >= draftStops.length || isSavingOrder) return;

        setDraftStops(currentStops => {
            const nextStops = [...currentStops];
            [nextStops[index], nextStops[nextIndex]] = [nextStops[nextIndex], nextStops[index]];
            setIsOrderDirty(!sameStopOrder(nextStops, stops));
            return nextStops;
        });
    };

    const resetDraftOrder = () => {
        setDraftStops(stops);
        setIsOrderDirty(false);
    };

    const applyAutoOrder = () => {
        const anchorCoordinate = anchorSource === 'vendor'
            ? getVendorCoordinate(selectedVendor)
            : getAddressCoordinate(manualAnchorAddress);

        if (!anchorCoordinate) {
            toast.error(anchorSource === 'vendor'
                ? 'Select a vendor with a saved map address, or use manual address.'
                : 'Select an address from autocomplete before auto-ordering.'
            );
            return;
        }

        const { orderedStops, missingCoordinateCount } = autoOrderStopsFromAnchor(
            draftStops,
            anchorCoordinate,
            anchorPosition
        );

        if (sameStopOrder(orderedStops, draftStops)) {
            toast.success('Route order already matches that location.');
            return;
        }

        setDraftStops(orderedStops);
        setIsOrderDirty(!sameStopOrder(orderedStops, stops));

        if (missingCoordinateCount > 0) {
            toast.error(`${missingCoordinateCount} stop${missingCoordinateCount === 1 ? '' : 's'} had no map coordinates and stayed outside the optimized set.`);
        } else {
            toast.success('Route stops reordered by location.');
        }
    };

    const saveDraftOrder = async (updatePlannedRoute = false) => {
        if (!isOrderDirty || isSavingOrder) return;

        setIsSavingOrder(true);

        try {
            const saved = await onSaveRouteOrder(route, draftStops, { updatePlannedRoute });

            if (saved) {
                setIsOrderDirty(false);
                setIsEditingOrder(false);
            }
        } finally {
            setIsSavingOrder(false);
        }
    };

    return (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h3 className="text-lg font-bold text-gray-800">Active Route Detail</h3>
                    <p className="text-sm text-gray-500">
                        Stops, logs, latest location, and completion controls for {route.techName || 'this route'}.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <DetailPill label="Stops" value={`${route.finishedStops || 0}/${route.totalStops || expectedStopCount}`} />
                    <DetailPill label="Logs" value={routeLogs.length} />
                    <DetailPill label="GPS" value={locations.length} />
                    <DetailPill label="Areas" value={areaEstimates.length} />
                </div>
            </div>

            {hasStopMismatch && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    Route stop count mismatch. Route has {expectedStopCount} ID(s), but {stops.length} stop(s) loaded.
                </div>
            )}

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-lg border border-gray-200">
                    <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="font-semibold text-gray-800">Route Stops</p>
                            <p className="text-xs text-gray-500">{unfinishedStops.length} unfinished stop(s) can be moved.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                                {selectedCount} selected
                            </span>
                            {isEditingOrder ? (
                                <button
                                    type="button"
                                    onClick={cancelEditingOrder}
                                    disabled={isSavingOrder}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={startEditingOrder}
                                    disabled={!stops.length}
                                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Edit Order
                                </button>
                            )}
                        </div>
                    </div>

                    {isEditingOrder && (
                        <div className="border-b border-blue-100 bg-blue-50/70 p-4">
                            <div className="grid gap-3 lg:grid-cols-[180px_180px_minmax(220px,1fr)_auto] lg:items-end">
                                <div>
                                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Optimize From</span>
                                    <div className="mt-1 grid grid-cols-2 rounded-lg border border-blue-200 bg-white p-1">
                                        <button
                                            type="button"
                                            onClick={() => setAnchorPosition('start')}
                                            className={`rounded-md px-3 py-2 text-sm font-semibold ${anchorPosition === 'start' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                        >
                                            Start
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAnchorPosition('end')}
                                            className={`rounded-md px-3 py-2 text-sm font-semibold ${anchorPosition === 'end' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                        >
                                            End
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Location Type</span>
                                    <div className="mt-1 grid grid-cols-2 rounded-lg border border-blue-200 bg-white p-1">
                                        <button
                                            type="button"
                                            onClick={() => setAnchorSource('vendor')}
                                            className={`rounded-md px-3 py-2 text-sm font-semibold ${anchorSource === 'vendor' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200' : 'text-gray-600 hover:text-gray-900'}`}
                                        >
                                            Vendor
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAnchorSource('manual')}
                                            className={`rounded-md px-3 py-2 text-sm font-semibold ${anchorSource === 'manual' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200' : 'text-gray-600 hover:text-gray-900'}`}
                                        >
                                            Manual
                                        </button>
                                    </div>
                                </div>

                                {anchorSource === 'vendor' ? (
                                    <label className="block">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Vendor Address</span>
                                        <select
                                            value={selectedVendorId}
                                            onChange={(event) => setSelectedVendorId(event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"
                                        >
                                            <option value="">Select vendor</option>
                                            {vendors.map(vendor => {
                                                const addressLabel = formatVendorAddress(vendor);

                                                return (
                                                    <option key={vendor.id} value={vendor.id}>
                                                        {vendor.name}{addressLabel ? ` - ${addressLabel}` : ''}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </label>
                                ) : (
                                    <div>
                                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Manual Address</span>
                                        <AddressAutocomplete
                                            initialValue={manualAnchorInput}
                                            placeholder="Start typing an address"
                                            onAddressSelect={(address) => {
                                                setManualAnchorAddress(address);
                                                setManualAnchorInput(formatAddressValue(address));
                                            }}
                                            onInputChange={setManualAnchorInput}
                                            customClasses="mt-1 w-full rounded-lg border border-blue-200 bg-white py-2 pl-10 pr-3 text-sm text-gray-900"
                                            iconClasses="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-blue-500"
                                        />
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={applyAutoOrder}
                                    disabled={isSavingOrder}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Auto Reorder
                                </button>
                            </div>

                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs font-semibold text-blue-800">
                                    {isOrderDirty ? 'Order changes are ready to save.' : 'Use arrows or auto reorder to change this route.'}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={resetDraftOrder}
                                        disabled={!isOrderDirty || isSavingOrder}
                                        className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Reset
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => saveDraftOrder(false)}
                                        disabled={!isOrderDirty || isSavingOrder}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSavingOrder ? 'Saving...' : 'Save Today'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => saveDraftOrder(true)}
                                        disabled={!isOrderDirty || isSavingOrder}
                                        className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSavingOrder ? 'Saving...' : 'Save Today + Planned Route'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="divide-y divide-gray-100">
                        {displayStops.length ? displayStops.map((stop, index) => {
                            const status = getStopDisplayStatus(stop);
                            const movable = isStopMovable(stop);
                            const isSelected = selectedStopIds.includes(stop.id);

                            return (
                                <div key={stop.id} className="flex items-center gap-3 px-4 py-3">
                                    {isEditingOrder && (
                                        <div className="flex shrink-0 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => moveDraftStop(index, -1)}
                                                disabled={index === 0 || isSavingOrder}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                aria-label={`Move ${stop.customerName || 'service stop'} up`}
                                            >
                                                <ArrowUpIcon className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveDraftStop(index, 1)}
                                                disabled={index === draftStops.length - 1 || isSavingOrder}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                aria-label={`Move ${stop.customerName || 'service stop'} down`}
                                            >
                                                <ArrowDownIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onToggleStop(stop)}
                                        disabled={!movable}
                                        className={`h-8 w-8 rounded-full border text-sm font-bold ${isSelected
                                                ? 'border-blue-600 bg-blue-600 text-white'
                                                : !movable
                                                    ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                                                    : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400'
                                            }`}
                                        title={movable ? 'Select stop' : 'Finished stops cannot be moved'}
                                    >
                                        {isSelected ? '✓' : index + 1}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onOpenStop(stop)}
                                        className="min-w-0 flex-1 text-left"
                                    >
                                        <p className="truncate font-semibold text-gray-900">{stop.customerName || 'Service Stop'}</p>
                                        <p className="truncate text-sm text-gray-500">{stop.address?.streetAddress || 'No address'}</p>
                                    </button>
                                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${status.className}`}>
                                        {status.label}
                                    </span>
                                </div>
                            );
                        }) : (
                            <div className="px-4 py-6 text-sm text-gray-500">No stops loaded for this route.</div>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-lg border border-gray-200 p-4">
                        <p className="font-semibold text-gray-800">Latest Location</p>
                        {latestLocation ? (
                            <div className="mt-2 space-y-1 text-sm text-gray-600">
                                <p>{latestLocation.userName || route.techName || 'Technician'}</p>
                                <p>{latestLocation.timeDate ? `${format(latestLocation.timeDate, 'MMM d, yyyy')} at ${formatTimeValue(latestLocation.timeDate)}` : 'No timestamp'}</p>
                                <p className="font-mono text-xs text-gray-500">{latestLocation.latitude}, {latestLocation.longitude}</p>
                            </div>
                        ) : (
                            <p className="mt-2 text-sm text-gray-500">No GPS breadcrumbs loaded.</p>
                        )}
                    </div>

                    <div className="rounded-lg border border-gray-200 p-4">
                        <p className="font-semibold text-gray-800">Route Completion</p>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="space-y-1">
                                <span className="text-xs font-semibold text-gray-600">Start Mileage</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={completionDraft.startMileage}
                                    onChange={(event) => updateCompletionDraft("startMileage", event.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-semibold text-gray-600">End Mileage</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={completionDraft.endMileage}
                                    onChange={(event) => updateCompletionDraft("endMileage", event.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>
                        </div>
                        <label className="mt-3 block space-y-1">
                            <span className="text-xs font-semibold text-gray-600">Notes</span>
                            <textarea
                                value={completionDraft.completionNotes}
                                onChange={(event) => updateCompletionDraft("completionNotes", event.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => onSaveRouteCompletion(route, completionDraft)}
                            className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                            Save Route Completion
                        </button>
                    </div>

                    <div className="rounded-lg border border-gray-200 p-4">
                        <p className="font-semibold text-gray-800">Route Logs</p>
                        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                            {routeLogs.length ? routeLogs.map(log => (
                                <div key={log.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                                    <p className="font-semibold text-gray-800">{log.type || 'Route Log'}</p>
                                    <p className="text-xs text-gray-500">
                                        {formatTimeValue(log.startTimeDate)} - {log.endTimeDate ? formatTimeValue(log.endTimeDate) : 'Now'}
                                    </p>
                                </div>
                            )) : (
                                <p className="text-sm text-gray-500">No route logs loaded.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DetailPill = ({ label, value }) => (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
        <div className="text-sm font-bold text-gray-900">{value}</div>
    </div>
);

const RouteMapMetric = ({ label, value, tone }) => {
    const toneClasses = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        orange: 'bg-orange-50 text-orange-700 border-orange-100',
        purple: 'bg-purple-50 text-purple-700 border-purple-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };

    return (
        <div className={`rounded-lg border px-4 py-3 ${toneClasses[tone] || toneClasses.blue}`}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
    );
};

const OverlayButton = ({ label, colorClass, isOn, onClick }) => {
    const activeClasses = {
        blue: 'border-blue-200 bg-blue-50 text-blue-700',
        orange: 'border-orange-200 bg-orange-50 text-orange-700',
        purple: 'border-purple-200 bg-purple-50 text-purple-700',
    };

    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${isOn
                    ? activeClasses[colorClass]
                    : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
        >
            {isOn ? label : `Hide ${label}`}
        </button>
    );
};

const TimelineBar = ({ start, end, rangeStart, rangeEnd, className, children, minWidth = 2.4 }) => {
    const left = timelinePercent(start, rangeStart, rangeEnd);
    const right = timelinePercent(end, rangeStart, rangeEnd);
    const width = Math.max(minWidth, right - left);

    return (
        <div
            className={`absolute top-2 h-11 overflow-hidden rounded-lg px-2 py-1 text-xs font-semibold shadow-sm ${className}`}
            style={{
                left: `${left}%`,
                width: `${Math.min(width, 100 - left)}%`,
            }}
            title={typeof children === 'string' ? children : undefined}
        >
            {children}
        </div>
    );
};

const CurrentTimeMarker = ({ now, rangeStart, rangeEnd }) => {
    if (!now || now < rangeStart || now > rangeEnd) return null;

    return (
        <div
            className="pointer-events-none absolute bottom-1 top-1 z-20 border-l-2 border-red-500"
            style={{ left: `${timelinePercent(now, rangeStart, rangeEnd)}%` }}
        />
    );
};

const TimelineRow = ({ label, sublabel, children, timelineWidth }) => (
    <div
        className="grid min-w-max gap-3 border-t border-gray-100 py-2 first:border-t-0"
        style={{ gridTemplateColumns: `190px ${timelineWidth}px` }}
    >
        <div className="flex flex-col justify-center">
            <div className="text-sm font-semibold text-gray-800">{label}</div>
            {sublabel && <div className="text-xs text-gray-500">{sublabel}</div>}
        </div>
        <div className="relative h-16 rounded-lg bg-gray-50">
            {children}
        </div>
    </div>
);

const RouteProgressTimeline = ({ route, stops, areaEstimates, routeLogs, now }) => {
    const baseRange = getRouteTimelineRange(route, stops, areaEstimates, routeLogs, now);
    const rawStopSegments = stops
        .map((stop, index) => {
            const { start, end } = getStopTiming(stop);
            return {
                stop,
                index,
                start,
                end: end || (start ? now : null),
            };
        })
        .filter(segment => segment.start && segment.end);
    const stopSegments = layoutSequentialStopSegments(rawStopSegments);
    const expandedRange = expandTimelineRangeForSegments(baseRange, stopSegments);
    const range = {
        start: roundDateToMinuteStep(expandedRange.start, 15, 'floor'),
        end: roundDateToMinuteStep(expandedRange.end, 15, 'ceil'),
    };
    const showCurrentMarker = now >= range.start && now <= range.end;
    const timeMarks = buildTimelineMarks(range.start, range.end, 15);
    const slotCount = Math.max(1, Math.ceil(minutesBetween(range.start, range.end) / 15));
    const timelineWidth = Math.max(840, slotCount * 58);

    return (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h3 className="text-lg font-bold text-gray-800">Route Timeline</h3>
                    <p className="text-sm text-gray-500">
                        Time areas, service stop work windows, and route log modes for the selected technician.
                    </p>
                </div>
                <div className="text-xs font-semibold text-gray-500">
                    {formatTimeValue(range.start)} - {formatTimeValue(range.end)}
                </div>
            </div>

            <div className="overflow-x-auto">
                <div className="min-w-max">
                    <div
                        className="grid gap-3 pb-2"
                        style={{ gridTemplateColumns: `190px ${timelineWidth}px` }}
                    >
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Time</div>
                        <div className="relative h-6">
                            {timeMarks.map(mark => (
                                <div
                                    key={mark.toISOString()}
                                    className="absolute top-0 h-6 border-l border-gray-300 pl-2 text-xs font-semibold text-gray-500"
                                    style={{ left: `${timelinePercent(mark, range.start, range.end)}%` }}
                                >
                                    {formatTimeValue(mark)}
                                </div>
                            ))}
                            {showCurrentMarker && (
                                <div
                                    className="absolute top-0 h-6 border-l-2 border-red-500 pl-1 text-[10px] font-bold uppercase text-red-600"
                                    style={{ left: `${timelinePercent(now, range.start, range.end)}%` }}
                                >
                                    Now
                                </div>
                            )}
                        </div>
                    </div>

                    <TimelineRow
                        label="Time Areas"
                        sublabel={`${areaEstimates.length} dwell estimate${areaEstimates.length === 1 ? '' : 's'}`}
                        timelineWidth={timelineWidth}
                    >
                        {areaEstimates.map(area => (
                            <TimelineBar
                                key={area.id}
                                start={area.startTime}
                                end={area.endTime}
                                rangeStart={range.start}
                                rangeEnd={range.end}
                                className="bg-purple-600 text-white"
                            >
                                <div className="truncate">Area {area.areaNumber} · {area.durationText}</div>
                                <div className="truncate text-[10px] font-medium opacity-90">{area.subtitle}</div>
                            </TimelineBar>
                        ))}
                        <CurrentTimeMarker now={now} rangeStart={range.start} rangeEnd={range.end} />
                    </TimelineRow>

                    <TimelineRow
                        label="Service Stops"
                        sublabel={`${stopSegments.length} timed stop${stopSegments.length === 1 ? '' : 's'}`}
                        timelineWidth={timelineWidth}
                    >
                        {stopSegments.map(segment => (
                            <TimelineBar
                                key={segment.stop.id}
                                start={segment.displayStart}
                                end={segment.displayEnd}
                                rangeStart={range.start}
                                rangeEnd={range.end}
                                className={getStopTone(segment.stop)}
                            >
                                <div className="truncate">#{segment.stop.routeStopIndex || segment.index + 1} {formatTimeValue(segment.displayStart)} - {formatTimeValue(segment.displayEnd)}</div>
                                <div className="truncate text-[10px] font-medium opacity-90">{segment.stop.customerName}</div>
                            </TimelineBar>
                        ))}
                        <CurrentTimeMarker now={now} rangeStart={range.start} rangeEnd={range.end} />
                    </TimelineRow>

                    <TimelineRow
                        label="Route Logs"
                        sublabel={`${routeLogs.length} work mode event${routeLogs.length === 1 ? '' : 's'}`}
                        timelineWidth={timelineWidth}
                    >
                        {routeLogs.map(log => (
                            <TimelineBar
                                key={log.id}
                                start={log.startTimeDate}
                                end={log.endTimeDate || now}
                                rangeStart={range.start}
                                rangeEnd={range.end}
                                className={getLogTone(log.type)}
                            >
                                <div className="truncate">{log.type || 'Route Log'}</div>
                                <div className="truncate text-[10px] font-medium opacity-90">
                                    {formatTimeValue(log.startTimeDate)} - {log.endTimeDate ? formatTimeValue(log.endTimeDate) : 'Now'}
                                </div>
                            </TimelineBar>
                        ))}
                        <CurrentTimeMarker now={now} rangeStart={range.start} rangeEnd={range.end} />
                    </TimelineRow>
                </div>
            </div>
        </div>
    );
};

const technicianStopLabel = (stop, fallbackIndex) => {
    const techName = stop.routeTechName || stop.tech || 'Unassigned';
    const initials = techName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase())
        .join('') || 'U';
    const stopNumber = stop.routeStopIndex || fallbackIndex + 1;

    return `${initials}-${stopNumber}`;
};

const RouteActivityMap = ({ route, stops, routeLocations, areaEstimates, overlays, showTechnicianLabels = false }) => {
    const mapRef = useRef(null);

    useEffect(() => {
        if (!window.google?.maps || !mapRef.current) {
            return;
        }

        const googleMaps = window.google.maps;
        const map = new googleMaps.Map(mapRef.current, {
            zoom: 11,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
        });
        const bounds = new googleMaps.LatLngBounds();
        const infoWindow = new googleMaps.InfoWindow();
        const overlaysToClear = [];

        class MapTextLabel extends googleMaps.OverlayView {
            constructor(position, text, color) {
                super();
                this.position = new googleMaps.LatLng(position.lat, position.lng);
                this.text = text;
                this.color = color;
                this.div = null;
            }

            onAdd() {
                this.div = document.createElement('div');
                this.div.textContent = this.text;
                this.div.style.position = 'absolute';
                this.div.style.transform = 'translate(-50%, 10px)';
                this.div.style.padding = '3px 7px';
                this.div.style.borderRadius = '999px';
                this.div.style.background = this.color;
                this.div.style.color = '#ffffff';
                this.div.style.fontSize = '11px';
                this.div.style.fontWeight = '700';
                this.div.style.whiteSpace = 'nowrap';
                this.div.style.boxShadow = '0 4px 10px rgba(15, 23, 42, 0.18)';
                this.getPanes().overlayMouseTarget.appendChild(this.div);
            }

            draw() {
                if (!this.div) return;

                const projection = this.getProjection();
                const point = projection.fromLatLngToDivPixel(this.position);

                if (point) {
                    this.div.style.left = `${point.x}px`;
                    this.div.style.top = `${point.y}px`;
                }
            }

            onRemove() {
                if (this.div) {
                    this.div.remove();
                    this.div = null;
                }
            }
        }

        const addCircleMarker = ({ position, label, title, fillColor, scale = 13, labelText, infoContent }) => {
            const marker = new googleMaps.Marker({
                position,
                map,
                title,
                label: label
                    ? {
                        text: String(label),
                        color: '#ffffff',
                        fontSize: '12px',
                        fontWeight: '700',
                    }
                    : undefined,
                icon: {
                    path: googleMaps.SymbolPath.CIRCLE,
                    fillColor,
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                    scale,
                },
            });

            overlaysToClear.push(marker);
            bounds.extend(position);

            if (labelText) {
                const textLabel = new MapTextLabel(position, labelText, fillColor);
                textLabel.setMap(map);
                overlaysToClear.push(textLabel);
            }

            if (infoContent) {
                marker.addListener('click', () => {
                    infoWindow.setContent(infoContent);
                    infoWindow.open(map, marker);
                });
            }

            return marker;
        };

        const stopPoints = stops
            .map((stop, index) => ({
                stop,
                index,
                position: getStopCoordinate(stop),
            }))
            .filter(item => item.position);

        const trailPoints = routeLocations
            .map(location => ({
                location,
                position: getRouteLocationCoordinate(location),
            }))
            .filter(item => item.position);

        if (overlays.stops && stopPoints.length > 0) {
            if (stopPoints.length > 1) {
                const stopPath = new googleMaps.Polyline({
                    path: stopPoints.map(point => point.position),
                    geodesic: true,
                    strokeColor: '#2563eb',
                    strokeOpacity: 0.72,
                    strokeWeight: 4,
                    map,
                });
                overlaysToClear.push(stopPath);
            }

            stopPoints.forEach(({ stop, index, position }) => {
                const status = getStopDisplayStatus(stop).label;
                const fillColor = status === 'Finished'
                    ? '#16a34a'
                    : status === 'In Progress'
                        ? '#2563eb'
                        : '#ca8a04';
                const markerLabel = showTechnicianLabels ? technicianStopLabel(stop, index) : index + 1;

                addCircleMarker({
                    position,
                    label: markerLabel,
                    title: stop.customerName || `Stop ${index + 1}`,
                    fillColor,
                    scale: showTechnicianLabels ? 16 : 14,
                    infoContent: `
                        <div style="font-family: Arial, sans-serif; padding: 6px;">
                            <p style="font-weight: 700; margin: 0 0 4px 0;">${escapeHtml(showTechnicianLabels ? markerLabel : `Stop ${index + 1}`)}: ${escapeHtml(stop.customerName || 'Service Stop')}</p>
                            ${showTechnicianLabels ? `<p style="margin: 0 0 4px 0;">Technician: ${escapeHtml(stop.routeTechName || stop.tech || 'Unassigned')}</p>` : ''}
                            <p style="margin: 0 0 4px 0;">${escapeHtml(stop.address?.streetAddress || 'No address')}</p>
                            <p style="margin: 0;">Status: ${escapeHtml(status)}</p>
                        </div>
                    `,
                });
            });
        }

        if (overlays.techTrail && trailPoints.length > 0) {
            if (trailPoints.length > 1) {
                const trailPath = new googleMaps.Polyline({
                    path: trailPoints.map(point => point.position),
                    geodesic: true,
                    strokeColor: '#f97316',
                    strokeOpacity: 0.76,
                    strokeWeight: 4,
                    map,
                });
                overlaysToClear.push(trailPath);
            }

            const checkpointSource = trailPoints.slice(0, Math.max(trailPoints.length - 1, 0));
            checkpointIndexes(checkpointSource.length, 8).forEach(index => {
                const point = checkpointSource[index];
                const checkpointTime = point.location.timeDate
                    ? formatTimeValue(point.location.timeDate)
                    : 'No time';

                addCircleMarker({
                    position: point.position,
                    label: index + 1,
                    labelText: `GPS ${index + 1}`,
                    title: `GPS ${index + 1}`,
                    fillColor: '#f97316',
                    scale: 10,
                    infoContent: `
                        <div style="font-family: Arial, sans-serif; padding: 6px;">
                            <p style="font-weight: 700; margin: 0 0 4px 0;">GPS ${index + 1}</p>
                            <p style="margin: 0;">${escapeHtml(checkpointTime)}</p>
                        </div>
                    `,
                });
            });

            const latestPoint = trailPoints[trailPoints.length - 1];

            addCircleMarker({
                position: latestPoint.position,
                label: '',
                labelText: 'Now',
                title: `${route.techName || 'Technician'} latest location`,
                fillColor: '#ea580c',
                scale: 15,
                infoContent: `
                    <div style="font-family: Arial, sans-serif; padding: 6px;">
                        <p style="font-weight: 700; margin: 0 0 4px 0;">Latest Location</p>
                        <p style="margin: 0;">${escapeHtml(formatTimeValue(latestPoint.location.timeDate))}</p>
                    </div>
                `,
            });
        }

        if (overlays.timeAreas && areaEstimates.length > 0) {
            areaEstimates.forEach(area => {
                addCircleMarker({
                    position: area.coordinate,
                    label: area.areaNumber,
                    labelText: area.durationText,
                    title: `Area ${area.areaNumber}`,
                    fillColor: '#9333ea',
                    scale: 14,
                    infoContent: `
                        <div style="font-family: Arial, sans-serif; padding: 6px;">
                            <p style="font-weight: 700; margin: 0 0 4px 0;">Area ${area.areaNumber}: ${escapeHtml(area.durationText)}</p>
                            <p style="margin: 0 0 4px 0;">${escapeHtml(area.subtitle)}</p>
                            <p style="margin: 0;">${escapeHtml(formatTimeValue(area.startTime))} - ${escapeHtml(formatTimeValue(area.endTime))} · ${area.locationCount} breadcrumbs</p>
                        </div>
                    `,
                });
            });
        }

        if (!bounds.isEmpty()) {
            map.fitBounds(bounds);

            if (stopPoints.length + trailPoints.length + areaEstimates.length === 1) {
                map.setZoom(15);
            }
        } else {
            map.setCenter({ lat: 34.052235, lng: -118.243683 });
        }

        return () => {
            overlaysToClear.forEach(overlay => overlay.setMap(null));
            infoWindow.close();
        };
    }, [route, stops, routeLocations, areaEstimates, overlays, showTechnicianLabels]);

    return <div ref={mapRef} className="h-full min-h-[400px] w-full" />;
};

const TechRouteCard = ({
    route,
    stops,
    now,
    technicians,
    fleetVehicles,
    onVehicleChange,
    isVehicleUpdating,
}) => {
    const getStatusClass = (status) => {
        switch (status) {
            case 'Finished':
                return 'bg-green-100 text-green-800';
            case 'In Progress':
                return 'bg-blue-100 text-blue-800';
            default:
                return 'bg-yellow-100 text-yellow-800';
        }
    };

    const routeStops = stops.filter(stop => route.serviceStopsIds?.includes(stop.id));
    const activeStop = routeStops.find(stop => {
        const { start, end } = getStopTiming(stop);
        return start && !end;
    });

    const activeStart = activeStop ? getStopTiming(activeStop).start : null;
    const durationMinutes = getRouteDurationMinutes(route);
    const vehicleOptions = buildVehicleOptionsForRoute(route, technicians, fleetVehicles);

    return (
        <div className="border rounded-lg p-4 transition-all hover:shadow-md">
            <div className="flex justify-between items-center mb-2">
                <p className="font-bold text-gray-800">{route.techName}</p>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${getStatusClass(route.status)}`}>
                    {route.status}
                </span>
            </div>

            <div className="text-sm text-gray-600 space-y-1">
                <p>Stops: {route.finishedStops} / {route.totalStops}</p>
                <p>Mileage: {route.distanceMiles ? `${Number(route.distanceMiles).toFixed(1)} mi` : 'N/A'}</p>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vehicle</p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-500">
                            {routeVehicleSourceLabel(route)}
                        </span>
                    </div>
                    <select
                        value={routeVehicleSelectionValue(route)}
                        onChange={(event) => onVehicleChange(route, event.target.value)}
                        disabled={isVehicleUpdating}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {vehicleOptions.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <p className="mt-2 text-xs text-gray-500">
                        {routeVehicleSummary(route, fleetVehicles, technicians)}
                    </p>
                </div>

                {activeStart ? (
                    <>
                        <p>Started: {formatTimeValue(activeStart)}</p>
                        <p>Timer: {formatElapsedDuration(activeStart, now)}</p>
                    </>
                ) : (
                    <p>
                        Duration: {durationMinutes
                            ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
                            : 'N/A'}
                    </p>
                )}
            </div>
        </div>
    );
};

const ServiceStopTable = ({ stops, navigate, now, selectedStopIds = [], onToggleStop }) => (
    <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
                <tr>
                    <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Move</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Customer</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Address</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Technician</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Status</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Start Time</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Duration</th>
                </tr>
            </thead>

            <tbody className="bg-white divide-y divide-gray-200">
                {stops.length > 0 ? stops.map(stop => {
                    const { start, end } = getStopTiming(stop);
                    const status = getStopDisplayStatus(stop);
                    const isSelected = selectedStopIds.includes(stop.id);
                    const movable = isStopMovable(stop);

                    return (
                        <tr
                            key={stop.id}
                            onClick={() => navigate(`/company/serviceStops/detail/${stop.id}`)}
                            className="cursor-pointer hover:bg-gray-50"
                        >
                            <td className='px-4 py-3 whitespace-nowrap'>
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onToggleStop(stop);
                                    }}
                                    disabled={!movable}
                                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${isSelected
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : movable
                                                ? 'border-blue-100 bg-blue-50 text-blue-700 hover:border-blue-400'
                                                : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                                        }`}
                                    title={movable ? 'Select stop to move' : 'Finished stops cannot be moved'}
                                >
                                    {isSelected ? '✓' : '+'}
                                </button>
                            </td>
                            <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900'>
                                {stop.customerName}
                            </td>

                            <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-600'>
                                {stop.address?.streetAddress || 'No Address'}
                            </td>

                            <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-600'>
                                {stop.tech || 'Unassigned'}
                            </td>

                            <td className='px-6 py-4 whitespace-nowrap'>
                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${status.className}`}>
                                    {status.label}
                                </span>
                            </td>

                            <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-600'>
                                {formatTimeValue(start)}
                            </td>

                            <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-600'>
                                {start ? formatElapsedDuration(start, end || now) : 'N/A'}
                            </td>
                        </tr>
                    );
                }) : (
                    <tr>
                        <td colSpan="7" className="text-center py-10 text-gray-500">
                            No service stops for the selected date.
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    </div>
);

export default RouteDashboard;
