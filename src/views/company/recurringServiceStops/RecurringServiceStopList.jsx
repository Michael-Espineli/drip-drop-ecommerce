
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, getDocs, query, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Select from 'react-select';
import toast from 'react-hot-toast';
import { FaEdit, FaPlus, FaTimes, FaUsers } from 'react-icons/fa';
import { db } from '../../../utils/config';
import { Context } from "../../../context/AuthContext";
import { reportAppError } from '../../../utils/errorReporting';
import { filterRecordsByCustomerTags } from '../../../utils/customerTags';
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from '../../../utils/models/FeatureFlag';
import {
    RSS_DAY_OPTIONS,
    RSS_FREQUENCY_OPTIONS,
    buildRecurringServiceStopEditForm,
    buildRecurringServiceStopUpdatePayload,
    companyUserOptionFromDoc,
    firstRecurringDayValue,
    formatDateInputValue,
    optionForValue,
    optionsWithCurrentValue,
    payTypeOptionFromDoc,
    recurringRoutePayTypeOptions,
    selectedPayTypeOptionForStop,
    selectedTechOptionForStop,
} from '../../../utils/recurringServiceStopEdit';
import { sortCompanyUsersByName } from '../../../utils/companyUsers';
import {
    applyTaskGroupToRecurringServiceStop,
    fetchRecurringTaskGroupOptions,
    loadRecurringServiceStopTasks,
} from '../../../utils/recurringServiceStopTasks';

const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const functions = getFunctions();

const dateValue = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
    const date = dateValue(value);
    if (!date) return "No date";
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const normalizedDay = (stop) => {
    if (Array.isArray(stop.day)) return stop.day.join(", ");
    if (Array.isArray(stop.daysOfWeek)) return stop.daysOfWeek.join(", ");
    return stop.day || stop.daysOfWeek || "Unscheduled";
};

const stopStatus = (stop) => {
    const endDate = dateValue(stop.endDate);
    if (stop.noEndDate || !endDate) return { label: "Active", className: "bg-emerald-100 text-emerald-800" };
    if (endDate < new Date()) return { label: "Ended", className: "bg-slate-100 text-slate-600" };
    return { label: "Ends Scheduled", className: "bg-amber-100 text-amber-800" };
};

const commonSelectedValue = (items, getter) => {
    if (!items.length) return "";
    const firstValue = getter(items[0]) || "";
    return items.every((item) => (getter(item) || "") === firstValue) ? firstValue : "";
};

const commonSelectedBoolean = (items, getter) => {
    if (!items.length) return undefined;
    const firstValue = Boolean(getter(items[0]));
    return items.every((item) => Boolean(getter(item)) === firstValue) ? firstValue : undefined;
};

const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 8,
    colors: {
        ...theme.colors,
        primary25: "#EFF6FF",
        primary: "#2563EB",
        neutral0: "#FFFFFF",
        neutral20: "#D1D5DB",
        neutral30: "#9CA3AF",
    },
});

const selectStyles = {
    control: (base, state) => ({
        ...base,
        minHeight: 42,
        borderRadius: 8,
        borderColor: state.isFocused ? "#2563EB" : "#D1D5DB",
        boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.18)" : "none",
        "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#9CA3AF" },
    }),
    menu: (base) => ({ ...base, borderRadius: 8, overflow: "hidden", zIndex: 1001 }),
};

const RecurringServiceStopList = () => {
    const {
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        user,
        dataBaseUser,
        accountType,
        companyRole,
        companyUserAccess,
        selectedCustomerRegionTag,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const navigate = useNavigate();
    const [stops, setStops] = useState([]);
    const [customersById, setCustomersById] = useState(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [dayFilter, setDayFilter] = useState("all");
    const [frequencyFilter, setFrequencyFilter] = useState("all");
    const [techFilter, setTechFilter] = useState("all");
    const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
    const [companyUserOptions, setCompanyUserOptions] = useState([]);
    const [taskGroupOptions, setTaskGroupOptions] = useState([]);
    const [editingStop, setEditingStop] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [editingStopTasks, setEditingStopTasks] = useState([]);
    const [loadingEditingStopTasks, setLoadingEditingStopTasks] = useState(false);
    const [selectedTaskTemplate, setSelectedTaskTemplate] = useState(null);
    const [applyingTaskTemplate, setApplyingTaskTemplate] = useState(false);
    const [bulkEditMode, setBulkEditMode] = useState(false);
    const [selectedStopIds, setSelectedStopIds] = useState([]);
    const [bulkEditForm, setBulkEditForm] = useState(null);
    const [bulkEditFields, setBulkEditFields] = useState([]);
    const [savingBulkEdit, setSavingBulkEdit] = useState(false);
    const customerAreaFilteringEnabled = featureFlagsLoaded && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);
    const errorContext = useMemo(() => ({
        userId: user?.uid || dataBaseUser?.id || dataBaseUser?.uid || '',
        userEmail: user?.email || dataBaseUser?.email || '',
        accountType: accountType || dataBaseUser?.accountType || '',
        companyId: recentlySelectedCompany || '',
        companyName: recentlySelectedCompanyName || '',
    }), [accountType, dataBaseUser, recentlySelectedCompany, recentlySelectedCompanyName, user]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setCustomersById(new Map());
            return;
        }

        let cancelled = false;

        const fetchCustomers = async () => {
            try {
                const customerSnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers'));
                if (cancelled) return;

                setCustomersById(new Map(customerSnapshot.docs.map((customerDoc) => [
                    customerDoc.id,
                    { id: customerDoc.id, ...customerDoc.data() },
                ])));
            } catch (error) {
                console.error("Error loading customer access for recurring stops:", error);
                if (!cancelled) setCustomersById(new Map());
            }
        };

        fetchCustomers();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setCompanyServiceStopTypes([]);
            setCompanyUserOptions([]);
            setTaskGroupOptions([]);
            return;
        }

        let cancelled = false;

        const fetchEditOptions = async () => {
            try {
                const [payTypesSnapshot, companyUsersSnapshot, taskGroupOptionsResult] = await Promise.all([
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'companyPayTypes')),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'companyUsers')),
                    fetchRecurringTaskGroupOptions({ db, companyId: recentlySelectedCompany }),
                ]);
                if (cancelled) return;

                setCompanyServiceStopTypes(payTypesSnapshot.docs.map(payTypeOptionFromDoc));
                setCompanyUserOptions(sortCompanyUsersByName(companyUsersSnapshot.docs.map(companyUserOptionFromDoc)));
                setTaskGroupOptions(taskGroupOptionsResult);
            } catch (error) {
                console.error("Error loading recurring stop edit options:", error);
                if (!cancelled) {
                    setCompanyServiceStopTypes([]);
                    setCompanyUserOptions([]);
                    setTaskGroupOptions([]);
                }
                reportAppError(error, {
                    context: errorContext,
                    source: "recurring-service-stop-list",
                    where: "RecurringServiceStopList.fetchEditOptions",
                    title: "Recurring service stop edit options failed to load",
                    description: "The recurring service stop list could not load pay types or technicians for inline editing.",
                    data: {
                        companyId: recentlySelectedCompany,
                    },
                });
            }
        };

        fetchEditOptions();

        return () => {
            cancelled = true;
        };
    }, [errorContext, recentlySelectedCompany]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setIsLoading(false);
            return;
        }

        const stopsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop'));

        const unsubscribe = onSnapshot(stopsQuery, (snapshot) => {
            const stopsList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })).sort((a, b) => {
                const dayDelta = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
                if (Number.isFinite(dayDelta) && dayDelta !== 0) return dayDelta;
                return String(a.customerName || "").localeCompare(String(b.customerName || ""));
            });
            setStops(stopsList);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching recurring service stops:", error);
            reportAppError(error, {
                context: errorContext,
                source: "recurring-service-stop-list",
                where: "RecurringServiceStopList.onSnapshot",
                title: "Recurring service stop list failed to load",
                description: "The recurring service stop list snapshot listener failed.",
                data: {
                    companyId: recentlySelectedCompany,
                },
            });
            setIsLoading(false);
        });

        return () => unsubscribe();

    }, [errorContext, recentlySelectedCompany]);

    const regionVisibleStops = useMemo(
        () => filterRecordsByCustomerTags({
            records: stops,
            customersById,
            role: companyRole,
            userAccess: companyUserAccess,
            selectedRegionTag: selectedCustomerRegionTag,
            regionalAccessEnabled: customerAreaFilteringEnabled,
        }),
        [companyRole, companyUserAccess, customersById, selectedCustomerRegionTag, stops, customerAreaFilteringEnabled]
    );

    const frequencyOptions = useMemo(
        () => Array.from(new Set(regionVisibleStops.map((stop) => stop.frequency).filter(Boolean))).sort(),
        [regionVisibleStops]
    );

    const techOptions = useMemo(
        () => Array.from(new Map(regionVisibleStops.map((stop) => [stop.techId || stop.tech || "unassigned", stop.tech || "Unassigned"]))).sort((a, b) => a[1].localeCompare(b[1])),
        [regionVisibleStops]
    );

    const serviceStopTypeOptions = useMemo(
        () => recurringRoutePayTypeOptions(companyServiceStopTypes),
        [companyServiceStopTypes]
    );

    const visibleStops = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();

        return regionVisibleStops.filter((stop) => {
            const matchesSearch = !term || [
                stop.internalId,
                stop.customerName,
                stop.tech,
                stop.payTypeName,
                stop.type,
                stop.frequency,
                normalizedDay(stop),
                stop.address?.streetAddress,
                stop.serviceLocationId,
                stop.id,
            ].some((value) => String(value || "").toLowerCase().includes(term));

            const matchesDay = dayFilter === "all" || normalizedDay(stop).includes(dayFilter);
            const matchesFrequency = frequencyFilter === "all" || stop.frequency === frequencyFilter;
            const techKey = stop.techId || stop.tech || "unassigned";
            const matchesTech = techFilter === "all" || techKey === techFilter;

            return matchesSearch && matchesDay && matchesFrequency && matchesTech;
        });
    }, [dayFilter, frequencyFilter, regionVisibleStops, searchTerm, techFilter]);

    const selectedStops = useMemo(() => {
        const selectedIds = new Set(selectedStopIds);
        return visibleStops.filter((stop) => selectedIds.has(stop.id));
    }, [selectedStopIds, visibleStops]);

    useEffect(() => {
        const visibleIds = new Set(visibleStops.map((stop) => stop.id));
        setSelectedStopIds((current) => current.filter((id) => visibleIds.has(id)));
    }, [visibleStops]);

    const stats = useMemo(() => {
        const active = regionVisibleStops.filter((stop) => stopStatus(stop).label === "Active").length;
        const ended = regionVisibleStops.filter((stop) => stopStatus(stop).label === "Ended").length;
        const routeLinked = regionVisibleStops.filter((stop) => stop.serviceLocationId && stop.techId && stop.day).length;
        return { active, ended, routeLinked };
    }, [regionVisibleStops]);

    const handleCreateNew = () => {
        navigate('/company/recurring-service-stops/create');
    };

    const handleRowClick = (stopId) => {
        if (bulkEditMode) {
            setSelectedStopIds((current) => (
                current.includes(stopId)
                    ? current.filter((id) => id !== stopId)
                    : [...current, stopId]
            ));
            return;
        }

        navigate(`/company/recurringServiceStop/details/${stopId}`);
    }

    const updateEditForm = (field, value) => {
        setEditForm((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const loadTasksForEditStop = async (stop) => {
        if (!recentlySelectedCompany || !stop?.id) {
            setEditingStopTasks([]);
            return;
        }

        try {
            setLoadingEditingStopTasks(true);
            const tasks = await loadRecurringServiceStopTasks({
                db,
                companyId: recentlySelectedCompany,
                recurringServiceStopId: stop.id,
                recurringServiceStop: stop,
            });
            setEditingStopTasks(tasks);
        } catch (error) {
            console.error("Error loading recurring stop tasks:", error);
            setEditingStopTasks([]);
            reportAppError(error, {
                context: errorContext,
                source: "recurring-service-stop-list",
                where: "RecurringServiceStopList.loadTasksForEditStop",
                title: "Recurring service stop tasks failed to load",
                description: "The recurring service stop edit popup could not load existing recurring tasks.",
                data: {
                    companyId: recentlySelectedCompany,
                    recurringServiceStopId: stop?.id || "",
                },
            });
            toast.error("Failed to load recurring stop tasks");
        } finally {
            setLoadingEditingStopTasks(false);
        }
    };

    const openEditModal = (stop, event) => {
        event.stopPropagation();
        setEditingStop(stop);
        setEditForm(buildRecurringServiceStopEditForm({
            stop,
            payTypeOptions: serviceStopTypeOptions,
            technicianOptions: companyUserOptions,
        }));
        setSelectedTaskTemplate(null);
        setEditingStopTasks([]);
        loadTasksForEditStop(stop);
    };

    const closeEditModal = () => {
        if (savingEdit || applyingTaskTemplate) return;
        setEditingStop(null);
        setEditForm(null);
        setEditingStopTasks([]);
        setSelectedTaskTemplate(null);
    };

    const toggleBulkEditMode = () => {
        if (bulkEditMode) {
            setSelectedStopIds([]);
            setBulkEditForm(null);
            setBulkEditFields([]);
        }
        setBulkEditMode((current) => !current);
    };

    const toggleStopSelection = (stopId, event) => {
        event.stopPropagation();
        setSelectedStopIds((current) => (
            current.includes(stopId)
                ? current.filter((id) => id !== stopId)
                : [...current, stopId]
        ));
    };

    const selectAllVisibleStops = () => {
        setSelectedStopIds(visibleStops.map((stop) => stop.id));
    };

    const clearSelectedStops = () => {
        setSelectedStopIds([]);
    };

    const buildBulkEditFormForStops = (stopsToEdit) => {
        const payTypeId = commonSelectedValue(stopsToEdit, (stop) => stop.payTypeId || stop.typeId || "");
        const payTypeName = commonSelectedValue(stopsToEdit, (stop) => stop.payTypeName || stop.type || "");
        const techId = commonSelectedValue(stopsToEdit, (stop) => stop.techId || "");
        const techName = commonSelectedValue(stopsToEdit, (stop) => stop.tech || "");
        const frequency = commonSelectedValue(stopsToEdit, (stop) => stop.frequency || "");
        const day = commonSelectedValue(stopsToEdit, (stop) => firstRecurringDayValue(stop.day || stop.daysOfWeek));
        const startDate = commonSelectedValue(stopsToEdit, (stop) => formatDateInputValue(stop.startDate));
        const noEndDate = commonSelectedBoolean(stopsToEdit, (stop) => stop.noEndDate !== false);
        const endDate = noEndDate === false
            ? commonSelectedValue(stopsToEdit, (stop) => formatDateInputValue(stop.endDate))
            : "";

        return {
            payType: payTypeId || payTypeName
                ? selectedPayTypeOptionForStop({
                    payTypeId,
                    payTypeName,
                    typeId: payTypeId,
                    type: payTypeName,
                }, serviceStopTypeOptions)
                : null,
            frequency: frequency ? optionForValue(RSS_FREQUENCY_OPTIONS, frequency, frequency) : null,
            technician: techId || techName
                ? selectedTechOptionForStop({ tech: techName, techId }, companyUserOptions)
                : null,
            day: day ? optionForValue(RSS_DAY_OPTIONS, day, day) : null,
            startDate,
            noEndDate,
            endDate,
        };
    };

    const openBulkEditModal = () => {
        if (!selectedStops.length) {
            toast.error("Select at least one recurring service stop");
            return;
        }

        setEditingStop(null);
        setEditForm(null);
        setBulkEditFields([]);
        setBulkEditForm(buildBulkEditFormForStops(selectedStops));
    };

    const closeBulkEditModal = () => {
        if (savingBulkEdit) return;
        setBulkEditForm(null);
        setBulkEditFields([]);
    };

    const setBulkFieldDirty = (field, dirty = true) => {
        setBulkEditFields((current) => {
            if (dirty) return current.includes(field) ? current : [...current, field];
            return current.filter((item) => item !== field);
        });
    };

    const updateBulkEditForm = (field, value) => {
        setBulkEditForm((current) => ({
            ...current,
            [field]: value,
        }));
        setBulkFieldDirty(field, Boolean(value));
    };

    const updateBulkNoEndDate = (value) => {
        setBulkEditForm((current) => ({
            ...current,
            noEndDate: value === "unchanged" ? undefined : value === "noEndDate",
            endDate: value === "endDate" ? current?.endDate || "" : "",
        }));
        setBulkEditFields((current) => {
            const withoutDateFields = current.filter((field) => field !== "noEndDate" && field !== "endDate");
            return value === "unchanged" ? withoutDateFields : [...withoutDateFields, "noEndDate"];
        });
    };

    const updateBulkEndDate = (value) => {
        setBulkEditForm((current) => ({
            ...current,
            endDate: value,
        }));
        setBulkEditFields((current) => {
            const withNoEndDate = current.includes("noEndDate") ? current : [...current, "noEndDate"];
            return withNoEndDate.includes("endDate") ? withNoEndDate : [...withNoEndDate, "endDate"];
        });
    };

    const updateBulkStartDate = (value) => {
        setBulkEditForm((current) => ({
            ...current,
            startDate: value,
        }));
        setBulkFieldDirty("startDate", Boolean(value));
    };

    const bulkFormHasChanges = () => bulkEditFields.length > 0;

    const buildFormForBulkStop = (stop, form) => {
        const useBulkDate = bulkEditFields.includes("noEndDate") || bulkEditFields.includes("endDate");
        const existingDay = stop.day || firstRecurringDayValue(stop.daysOfWeek);

        return {
            payType: bulkEditFields.includes("payType")
                ? form.payType
                : selectedPayTypeOptionForStop(stop, serviceStopTypeOptions),
            frequency: bulkEditFields.includes("frequency")
                ? form.frequency
                : optionForValue(RSS_FREQUENCY_OPTIONS, stop.frequency, stop.frequency),
            technician: bulkEditFields.includes("technician")
                ? form.technician
                : selectedTechOptionForStop(stop, companyUserOptions),
            day: bulkEditFields.includes("day")
                ? form.day
                : optionForValue(RSS_DAY_OPTIONS, existingDay, existingDay),
            startDate: bulkEditFields.includes("startDate")
                ? form.startDate
                : formatDateInputValue(stop.startDate),
            noEndDate: useBulkDate ? form.noEndDate : stop.noEndDate !== false,
            endDate: useBulkDate ? form.endDate : formatDateInputValue(stop.endDate),
        };
    };

    const saveBulkRecurringStopEdit = async (event) => {
        event.preventDefault();
        if (!bulkEditForm || !selectedStops.length) return;

        try {
            if (!bulkFormHasChanges()) {
                throw new Error("Choose at least one field to update.");
            }

            if (bulkEditFields.includes("noEndDate") && bulkEditForm.noEndDate === false && !bulkEditForm.endDate) {
                throw new Error("Select an end date or leave the end setting unchanged.");
            }

            if (bulkEditFields.includes("startDate") && !bulkEditForm.startDate) {
                throw new Error("Select a start date or leave the start date unchanged.");
            }

            setSavingBulkEdit(true);
            const callable = httpsCallable(functions, "updateRecurringServiceStop");

            for (const stop of selectedStops) {
                const recurringServiceStopPayload = buildRecurringServiceStopUpdatePayload({
                    stop,
                    form: buildFormForBulkStop(stop, bulkEditForm),
                    companyServiceStopTypes,
                });
                const result = await callable({
                    companyId: recentlySelectedCompany,
                    recurringServiceStop: recurringServiceStopPayload,
                    syncRoute: true,
                });

                if (result.data?.success === false || (result.data?.status && Number(result.data.status) >= 400)) {
                    throw new Error(result.data?.error || `Recurring service stop ${stop.internalId || stop.id} failed to update.`);
                }
            }

            toast.success(`Updated ${selectedStops.length} recurring service stops`);
            setBulkEditForm(null);
            setBulkEditMode(false);
            setSelectedStopIds([]);
            setBulkEditFields([]);
        } catch (error) {
            console.error("Error bulk updating recurring service stops:", error);
            reportAppError(error, {
                context: errorContext,
                source: "recurring-service-stop-list",
                where: "RecurringServiceStopList.saveBulkRecurringStopEdit",
                title: "Recurring service stop bulk edit failed",
                description: "The recurring service stop list failed to save bulk schedule or pay type edits.",
                data: {
                    companyId: recentlySelectedCompany,
                    recurringServiceStopIds: selectedStops.map((stop) => stop.id),
                    selectedCount: selectedStops.length,
                    payTypeId: bulkEditForm?.payType?.value || "",
                    frequency: bulkEditForm?.frequency?.value || "",
                    technicianId: bulkEditForm?.technician?.value || "",
                    day: bulkEditForm?.day?.value || "",
                    startDate: bulkEditForm?.startDate || "",
                    noEndDate: bulkEditForm?.noEndDate,
                    endDate: bulkEditForm?.endDate || "",
                },
            });
            toast.error(error.message || "Failed to update selected recurring service stops");
        } finally {
            setSavingBulkEdit(false);
        }
    };

    const applySelectedTaskTemplateToEditingStop = async () => {
        if (!editingStop || !selectedTaskTemplate || !recentlySelectedCompany) return;

        try {
            setApplyingTaskTemplate(true);
            const result = await applyTaskGroupToRecurringServiceStop({
                db,
                companyId: recentlySelectedCompany,
                recurringServiceStop: editingStop,
                recurringServiceStopId: editingStop.id,
                taskGroup: selectedTaskTemplate,
            });

            setEditingStopTasks((current) => [
                ...result.recurringTasks,
                ...current,
            ]);
            setSelectedTaskTemplate(null);
            toast.success(
                `${result.recurringTasks.length} task${result.recurringTasks.length === 1 ? "" : "s"} added to ${result.futureStopCount} future service stop${result.futureStopCount === 1 ? "" : "s"}`
            );
        } catch (error) {
            console.error("Error applying recurring stop task template:", error);
            reportAppError(error, {
                context: errorContext,
                source: "recurring-service-stop-list",
                where: "RecurringServiceStopList.applySelectedTaskTemplateToEditingStop",
                title: "Recurring service stop task template failed",
                description: "The recurring service stop edit popup failed while applying a task template.",
                data: {
                    companyId: recentlySelectedCompany,
                    recurringServiceStopId: editingStop?.id || "",
                    taskGroupId: selectedTaskTemplate?.id || "",
                },
            });
            toast.error(error.message || "Failed to apply task template");
        } finally {
            setApplyingTaskTemplate(false);
        }
    };

    const saveRecurringStopEdit = async (event) => {
        event.preventDefault();
        if (!editingStop || !editForm) return;

        try {
            setSavingEdit(true);
            const recurringServiceStopPayload = buildRecurringServiceStopUpdatePayload({
                stop: editingStop,
                form: editForm,
                companyServiceStopTypes,
            });
            const callable = httpsCallable(functions, "updateRecurringServiceStop");
            const result = await callable({
                companyId: recentlySelectedCompany,
                recurringServiceStop: recurringServiceStopPayload,
                syncRoute: true,
            });

            if (result.data?.success === false || (result.data?.status && Number(result.data.status) >= 400)) {
                throw new Error(result.data?.error || "Recurring service stop update failed.");
            }

            toast.success("Recurring service stop updated");
            setEditingStop(null);
            setEditForm(null);
        } catch (error) {
            console.error("Error updating recurring service stop:", error);
            reportAppError(error, {
                context: errorContext,
                source: "recurring-service-stop-list",
                where: "RecurringServiceStopList.saveRecurringStopEdit",
                title: "Recurring service stop inline edit failed",
                description: "The recurring service stop list popup failed to save schedule or pay type edits.",
                data: {
                    companyId: recentlySelectedCompany,
                    recurringServiceStopId: editingStop?.id || "",
                    payTypeId: editForm?.payType?.value || "",
                    frequency: editForm?.frequency?.value || "",
                    technicianId: editForm?.technician?.value || "",
                    day: editForm?.day?.value || "",
                    startDate: editForm?.startDate || "",
                    noEndDate: editForm?.noEndDate,
                    endDate: editForm?.endDate || "",
                },
            });
            toast.error(error.message || "Failed to update recurring service stop");
        } finally {
            setSavingEdit(false);
        }
    };

    const selectedStopIdSet = new Set(selectedStopIds);
    const allVisibleStopsSelected = visibleStops.length > 0 &&
        visibleStops.every((stop) => selectedStopIdSet.has(stop.id));
    const isBulkEditModal = Boolean(bulkEditForm);
    const activeEditForm = isBulkEditModal ? bulkEditForm : editForm;
    const activeSaving = isBulkEditModal ? savingBulkEdit : (savingEdit || applyingTaskTemplate);
    const activeModalTitle = isBulkEditModal
        ? `Edit ${selectedStops.length} Recurring Stops`
        : "Edit Recurring Stop";
    const activeModalSubtitle = isBulkEditModal
        ? "Blank fields will stay unchanged for the selected stops."
        : `${editingStop?.customerName || "Recurring stop"} - ${editingStop?.internalId || editingStop?.id || ""}`;
    const activeDateMin = activeEditForm?.startDate || (!isBulkEditModal ? formatDateInputValue(editingStop?.startDate) : "") || undefined;
    const updateActiveEditForm = isBulkEditModal ? updateBulkEditForm : updateEditForm;
    const closeActiveEditModal = isBulkEditModal ? closeBulkEditModal : closeEditModal;
    const saveActiveEdit = isBulkEditModal ? saveBulkRecurringStopEdit : saveRecurringStopEdit;
    const frequencyPickerOptions = optionsWithCurrentValue(
        RSS_FREQUENCY_OPTIONS,
        activeEditForm?.frequency?.value
    );
    const dayPickerOptions = optionsWithCurrentValue(
        RSS_DAY_OPTIONS,
        activeEditForm?.day?.value
    );

    return (
        <div className='min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5'>
            <div className="w-full">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-3xl font-bold text-slate-900">Recurring Service Stops</h2>
                        <p className="mt-1 text-slate-600">Recurring stop templates that seed future service stops.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link
                            to="/company/recurringServiceStop/active-customers-without-recurring-service-stops"
                            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                        >
                            <FaUsers className="text-xs" />
                            Missing Stops
                        </Link>
                        <button
                            type="button"
                            onClick={toggleBulkEditMode}
                            className={`inline-flex items-center gap-2 rounded-md px-4 py-3 text-sm font-semibold transition ${bulkEditMode
                                ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                : "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                }`}
                        >
                            <FaEdit className="text-xs" />
                            {bulkEditMode ? "Cancel Edit" : "Edit"}
                        </button>
                        <button
                            onClick={handleCreateNew}
                            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                            <FaPlus className="text-xs" />
                            Create New
                        </button>
                    </div>
                </div>

                <div className="mb-6 grid gap-4 md:grid-cols-4">
                    <SummaryCard label="Visible Stops" value={visibleStops.length} />
                    <SummaryCard label="Active" value={stats.active} />
                    <SummaryCard label="Ended" value={stats.ended} />
                    <SummaryCard label="Route Linked" value={stats.routeLinked} />
                </div>

                <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
                        <input
                            type="search"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Search customer, address, tech, internal ID..."
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                            <option value="all">All days</option>
                            {dayOrder.map((day) => <option key={day} value={day}>{day}</option>)}
                        </select>
                        <select value={frequencyFilter} onChange={(event) => setFrequencyFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                            <option value="all">All frequencies</option>
                            {frequencyOptions.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
                        </select>
                        <select value={techFilter} onChange={(event) => setTechFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                            <option value="all">All technicians</option>
                            {techOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </div>
                </div>

                {bulkEditMode && (
                    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-blue-800">
                            {selectedStopIds.length} selected
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={openBulkEditModal}
                                disabled={!selectedStopIds.length}
                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                            >
                                Edit Selected
                            </button>
                            <button
                                type="button"
                                onClick={selectAllVisibleStops}
                                disabled={!visibleStops.length || allVisibleStopsSelected}
                                className="rounded-md border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                            >
                                Select Visible
                            </button>
                            <button
                                type="button"
                                onClick={clearSelectedStops}
                                disabled={!selectedStopIds.length}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                    {isLoading ? (
                        <div className="p-8 text-center"><p className="text-slate-500">Loading stops...</p></div>
                    ) : visibleStops.length === 0 ? (
                        <div className="text-center p-8">
                            <h3 className="text-xl font-semibold text-slate-700">No Recurring Stops Found</h3>
                            <p className="text-slate-500 mt-2">Try adjusting filters or create a new recurring service stop.</p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    {bulkEditMode && (
                                        <th scope="col" className="px-6 py-3 text-left">
                                            <input
                                                type="checkbox"
                                                checked={allVisibleStopsSelected}
                                                onChange={(event) => {
                                                    if (event.target.checked) {
                                                        selectAllVisibleStops();
                                                    } else {
                                                        clearSelectedStops();
                                                    }
                                                }}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                aria-label="Select all visible recurring service stops"
                                            />
                                        </th>
                                    )}
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stop</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Tech</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pay Type</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Day</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Frequency</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start / End</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {visibleStops.map(stop => {
                                    const status = stopStatus(stop);
                                    const selected = selectedStopIdSet.has(stop.id);
                                    return (
                                    <tr key={stop.id} onClick={() => handleRowClick(stop.id)} className={`${selected ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-gray-50"} cursor-pointer`}>
                                        {bulkEditMode && (
                                            <td className="px-6 py-4 whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={(event) => toggleStopSelection(stop.id, event)}
                                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                    aria-label={`Select ${stop.internalId || stop.customerName || stop.id}`}
                                                />
                                            </td>
                                        )}
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-semibold text-slate-900">{stop.internalId || "—"}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{stop.customerName}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{stop.address?.streetAddress}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{stop.tech || 'Not Assigned'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{stop.payTypeName || stop.type || "—"}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{normalizedDay(stop)}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{stop.frequency}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{formatDate(stop.startDate)}</div>
                                            <div className="text-xs text-gray-500">{stop.noEndDate ? "No end date" : formatDate(stop.endDate)}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={(event) => event.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-2">
                                                {!bulkEditMode && (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => openEditModal(stop, event)}
                                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                                        title="Edit recurring service stop"
                                                    >
                                                        <FaEdit className="text-xs" />
                                                        Edit
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {activeEditForm && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4">
                    <form
                        onSubmit={saveActiveEdit}
                        className="flex h-[88vh] max-h-[900px] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-950">{activeModalTitle}</h3>
                                <p className="mt-1 text-sm text-slate-600">
                                    {activeModalSubtitle}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeActiveEditModal}
                                disabled={activeSaving}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                                title="Close"
                            >
                                <FaTimes />
                            </button>
                        </div>

                        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-5">
                            {!isBulkEditModal && editingStop && (
                                <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                                    <ReadonlyDatum label="Internal ID" value={editingStop.internalId || "—"} />
                                    <ReadonlyDatum label="Customer" value={editingStop.customerName || "—"} />
                                    <ReadonlyDatum label="Location" value={editingStop.address?.streetAddress || "—"} />
                                    <ReadonlyDatum label="Current Schedule" value={`${normalizedDay(editingStop)} • ${editingStop.frequency || "—"}`} />
                                </div>
                            )}

                            <ModalField label="Pay Type">
                                <Select
                                    value={activeEditForm.payType}
                                    options={serviceStopTypeOptions}
                                    onChange={(option) => updateActiveEditForm("payType", option)}
                                    isSearchable
                                    isClearable={isBulkEditModal}
                                    placeholder={isBulkEditModal ? "Leave unchanged" : "Select pay type"}
                                    theme={selectTheme}
                                    styles={selectStyles}
                                />
                            </ModalField>

                            <ModalField label="Frequency">
                                <Select
                                    value={activeEditForm.frequency}
                                    options={frequencyPickerOptions}
                                    onChange={(option) => updateActiveEditForm("frequency", option)}
                                    isSearchable
                                    isClearable={isBulkEditModal}
                                    placeholder={isBulkEditModal ? "Leave unchanged" : "Select frequency"}
                                    theme={selectTheme}
                                    styles={selectStyles}
                                />
                            </ModalField>

                            <ModalField label="Technician">
                                <Select
                                    value={activeEditForm.technician}
                                    options={companyUserOptions}
                                    onChange={(option) => updateActiveEditForm("technician", option)}
                                    isSearchable
                                    isClearable={isBulkEditModal}
                                    placeholder={isBulkEditModal ? "Leave unchanged" : "Select technician"}
                                    theme={selectTheme}
                                    styles={selectStyles}
                                />
                            </ModalField>

                            <ModalField label="Day">
                                <Select
                                    value={activeEditForm.day}
                                    options={dayPickerOptions}
                                    onChange={(option) => updateActiveEditForm("day", option)}
                                    isSearchable
                                    isClearable={isBulkEditModal}
                                    placeholder={isBulkEditModal ? "Leave unchanged" : "Select day"}
                                    theme={selectTheme}
                                    styles={selectStyles}
                                />
                            </ModalField>

                            <ModalField label="Start Date">
                                <input
                                    type="date"
                                    value={activeEditForm.startDate || ""}
                                    onChange={(event) => (
                                        isBulkEditModal
                                            ? updateBulkStartDate(event.target.value)
                                            : updateActiveEditForm("startDate", event.target.value)
                                    )}
                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            </ModalField>

                            <ModalField label="Does Not End">
                                {isBulkEditModal ? (
                                    <select
                                        value={activeEditForm.noEndDate === undefined ? "unchanged" : (activeEditForm.noEndDate ? "noEndDate" : "endDate")}
                                        onChange={(event) => updateBulkNoEndDate(event.target.value)}
                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        <option value="unchanged">Leave unchanged</option>
                                        <option value="noEndDate">No end date</option>
                                        <option value="endDate">Ends on date</option>
                                    </select>
                                ) : (
                                    <label className="flex min-h-[42px] items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={activeEditForm.noEndDate}
                                            onChange={(event) => updateActiveEditForm("noEndDate", event.target.checked)}
                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        No End Date
                                    </label>
                                )}
                            </ModalField>

                            {activeEditForm.noEndDate === false && (
                                <ModalField label="End Date">
                                    <input
                                        type="date"
                                        value={activeEditForm.endDate}
                                        min={activeDateMin}
                                        onChange={(event) => (
                                            isBulkEditModal
                                                ? updateBulkEndDate(event.target.value)
                                                : updateActiveEditForm("endDate", event.target.value)
                                        )}
                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </ModalField>
                            )}

                            {!isBulkEditModal && (
                                <div className="rounded-lg border border-slate-200 bg-white p-4">
                                    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-900">Tasks</h4>
                                            <p className="text-xs text-slate-500">
                                                {loadingEditingStopTasks
                                                    ? "Loading tasks..."
                                                    : `${editingStopTasks.length} recurring task${editingStopTasks.length === 1 ? "" : "s"}`}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                        <Select
                                            value={selectedTaskTemplate}
                                            options={taskGroupOptions}
                                            onChange={setSelectedTaskTemplate}
                                            isSearchable
                                            isClearable
                                            isDisabled={applyingTaskTemplate}
                                            placeholder={taskGroupOptions.length ? "Select task template" : "No task templates found"}
                                            theme={selectTheme}
                                            styles={selectStyles}
                                        />
                                        <button
                                            type="button"
                                            onClick={applySelectedTaskTemplateToEditingStop}
                                            disabled={!selectedTaskTemplate || applyingTaskTemplate}
                                            className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                                        >
                                            {applyingTaskTemplate ? "Applying..." : "Apply Template"}
                                        </button>
                                    </div>

                                    <div className="mt-3 rounded-md border border-slate-200">
                                        {loadingEditingStopTasks ? (
                                            <div className="px-3 py-3 text-sm text-slate-500">Loading recurring tasks...</div>
                                        ) : editingStopTasks.length ? (
                                            <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto">
                                                {editingStopTasks.map((task, index) => (
                                                    <div key={task.id || `${task.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                                        <div className="min-w-0">
                                                            <p className="truncate font-semibold text-slate-900">{task.name || "Task"}</p>
                                                            <p className="truncate text-xs text-slate-500">{task.type || "—"}</p>
                                                        </div>
                                                        <span className="shrink-0 text-xs font-semibold text-slate-500">{task.estimatedTime || 0} min</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="px-3 py-3 text-sm text-slate-500">No recurring tasks.</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                            <button
                                type="button"
                                onClick={closeActiveEditModal}
                                disabled={activeSaving}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={activeSaving}
                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                            >
                                {activeSaving ? "Saving..." : (isBulkEditModal ? `Save ${selectedStops.length} Stops` : "Save Changes")}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

const SummaryCard = ({ label, value }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{Number(value || 0).toLocaleString()}</p>
    </div>
);

const ModalField = ({ label, children }) => (
    <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</label>
        {children}
    </div>
);

const ReadonlyDatum = ({ label, value }) => (
    <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={String(value || "")}>{value}</p>
    </div>
);

export default RecurringServiceStopList;
