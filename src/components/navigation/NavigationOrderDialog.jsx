import React, { useContext, useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { ArrowDownIcon, ArrowUpIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { doc, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from '../../context/AuthContext';
import { db } from '../../utils/config';
import { userFacingErrorMessage } from '../../utils/permissionErrors';
import { COMPANY_PINNED_CATEGORY, DEFAULT_COMPANY_CATEGORY_ORDER } from '../../navigation';
import {
    getCompanyNavigationCandidates,
    normalizeAllTheRestPaths,
    normalizeBookmarkPaths,
    normalizeNavigationOrder,
} from '../../navigation/companyNavigationPreferences';
import { workspaceButtonClass } from '../workspace/workspaceStyles';

const NavigationOrderDialog = ({ onClose }) => {
    const context = useContext(Context);
    const { user, dataBaseUser, setDataBaseUser } = context;
    const savedOrder = dataBaseUser?.settings?.companyNavigationCategoryOrder;
    const savedBookmarks = dataBaseUser?.settings?.companyNavigationBookmarks;
    const savedRestPaths = dataBaseUser?.settings?.companyNavigationAllTheRest;
    const [categoryOrder, setCategoryOrder] = useState(() => normalizeNavigationOrder(savedOrder));
    const [bookmarkPaths, setBookmarkPaths] = useState(() => normalizeBookmarkPaths(savedBookmarks));
    const [restPaths, setRestPaths] = useState(() => normalizeAllTheRestPaths(savedRestPaths));
    const [activePanel, setActivePanel] = useState('Sidebar links');
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const savingRef = useRef(false);
    const currentUserIdRef = useRef(user?.uid);
    currentUserIdRef.current = user?.uid;

    useEffect(() => {
        setCategoryOrder(normalizeNavigationOrder(savedOrder));
        setBookmarkPaths(normalizeBookmarkPaths(savedBookmarks));
        setRestPaths(normalizeAllTheRestPaths(savedRestPaths));
    }, [savedOrder, savedBookmarks, savedRestPaths, user?.uid]);

    const candidates = getCompanyNavigationCandidates(context);
    const mainItems = candidates.filter((item) => !restPaths.includes(item.path));
    const restItems = candidates.filter((item) => restPaths.includes(item.path));
    const bookmarkCandidates = mainItems.filter((item) => item.category !== COMPANY_PINNED_CATEGORY);
    const disabled = isSaving || !user?.uid;

    const savePreference = async (field, nextValue, setValue, previousValue, successMessage) => {
        if (savingRef.current || !user?.uid) return;
        const savingUserId = user.uid;
        savingRef.current = true;
        setIsSaving(true);
        setSaveError('');
        setValue(nextValue);

        try {
            await updateDoc(doc(db, 'users', savingUserId), { [`settings.${field}`]: nextValue });
            if (currentUserIdRef.current !== savingUserId) return;
            setDataBaseUser((current) => ({
                ...current,
                settings: { ...(current?.settings || {}), [field]: nextValue },
            }));
            toast.success(successMessage);
        } catch (error) {
            if (currentUserIdRef.current !== savingUserId) return;
            setValue(previousValue);
            const message = userFacingErrorMessage(error, 'Could not save your sidebar changes. Please try again.');
            setSaveError(message);
            toast.error(message);
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    };

    const saveRestPaths = (nextPaths) => savePreference(
        'companyNavigationAllTheRest', normalizeAllTheRestPaths(nextPaths), setRestPaths, restPaths, 'Sidebar updated.'
    );

    const moveCategory = (index, direction) => {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= categoryOrder.length) return;
        const nextOrder = [...categoryOrder];
        [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
        savePreference('companyNavigationCategoryOrder', nextOrder, setCategoryOrder, categoryOrder, 'Navigation order updated.');
    };

    const close = () => { if (!savingRef.current) onClose(); };
    const renderLinkRow = (item, inRest) => (
        <li key={item.path} className="flex items-center gap-2 p-3 sm:gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-500 [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">{item.icon}</span>
            <span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-900">{item.title}</span>
            <button
                type="button"
                disabled={disabled}
                onClick={() => saveRestPaths(inRest ? restPaths.filter((path) => path !== item.path) : [...restPaths, item.path])}
                aria-label={inRest ? `Move ${item.title} back to sidebar` : `Move ${item.title} to All the rest`}
                className={workspaceButtonClass({ tone: inRest ? 'blue' : 'slate', className: 'shrink-0 !px-2 !text-xs sm:!px-3' })}
            >
                {inRest ? 'Move back' : 'Move out'}
            </button>
        </li>
    );

    return (
        <Dialog open onClose={close} className="company-theme relative z-[70]">
            <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
            <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
                <DialogPanel className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                        <div>
                            <DialogTitle className="text-lg font-semibold text-slate-900">Edit Navigation Order</DialogTitle>
                            <p className="mt-1 text-sm text-slate-500">Choose your sidebar links, category order, and Book Marks.</p>
                        </div>
                        <button type="button" onClick={close} disabled={isSaving} aria-label="Close navigation order editor" className={workspaceButtonClass({ tone: 'slate', className: 'h-10 w-10 shrink-0 !p-2' })}>
                            <XMarkIcon className="h-5 w-5 shrink-0" />
                        </button>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-200 px-5 py-3" role="group" aria-label="Navigation editor sections">
                        {['Sidebar links', 'Category order', 'Book Marks'].map((panel) => (
                            <button key={panel} type="button" aria-pressed={activePanel === panel} onClick={() => setActivePanel(panel)} className={workspaceButtonClass({ tone: 'blue', active: activePanel === panel, className: '!px-3 !text-xs' })}>
                                {panel}
                            </button>
                        ))}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5" aria-busy={isSaving}>
                        {saveError && <p role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{saveError}</p>}
                        {activePanel === 'Sidebar links' && (
                            <div className="space-y-5">
                                <p className="text-sm text-slate-500">Move any link out of your main sidebar into the All the rest dropdown. You can move it back here anytime.</p>
                                {[COMPANY_PINNED_CATEGORY, ...categoryOrder].map((category) => {
                                    const items = mainItems.filter((item) => item.category === category);
                                    if (!items.length) return null;
                                    return (
                                        <section key={category} aria-label={category === COMPANY_PINNED_CATEGORY ? 'Dashboard items' : category}>
                                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{category === COMPANY_PINNED_CATEGORY ? 'Dashboard items' : category}</h4>
                                            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">{items.map((item) => renderLinkRow(item, false))}</ul>
                                        </section>
                                    );
                                })}
                                {!mainItems.length && <p className="text-sm text-slate-500">All your available links are in All the rest. Move a link back below to add it to your main sidebar.</p>}
                                <section aria-label="All the rest">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <h4 className="text-sm font-semibold text-slate-900">All the rest ({restItems.length})</h4>
                                        {!!restPaths.length && <button type="button" disabled={disabled} onClick={() => saveRestPaths([])} className={workspaceButtonClass({ tone: 'slate' })}>Restore all links</button>}
                                    </div>
                                    {restItems.length
                                        ? <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">{restItems.map((item) => renderLinkRow(item, true))}</ul>
                                        : <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">No available links have been moved here yet.</p>}
                                </section>
                            </div>
                        )}
                        {activePanel === 'Category order' && (
                            <div>
                                <p className="mb-4 text-sm text-slate-500">Move categories into the order you want. Dashboard items and Book Marks appear above these categories; All the rest appears below.</p>
                                <ol className="divide-y divide-slate-100 rounded-md border border-slate-200">
                                    {categoryOrder.map((category, index) => (
                                        <li key={category} className="flex items-center justify-between gap-3 p-3">
                                            <div><p className="text-sm font-semibold text-slate-900">{category}</p><p className="text-xs text-slate-500">Position {index + 1}</p></div>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => moveCategory(index, -1)} disabled={index === 0 || disabled} aria-label={`Move ${category} up`} className={workspaceButtonClass({ tone: 'slate', className: 'h-10 w-10 !p-2' })}><ArrowUpIcon className="h-4 w-4 shrink-0" /></button>
                                                <button type="button" onClick={() => moveCategory(index, 1)} disabled={index === categoryOrder.length - 1 || disabled} aria-label={`Move ${category} down`} className={workspaceButtonClass({ tone: 'slate', className: 'h-10 w-10 !p-2' })}><ArrowDownIcon className="h-4 w-4 shrink-0" /></button>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                                <button type="button" disabled={disabled} onClick={() => savePreference('companyNavigationCategoryOrder', DEFAULT_COMPANY_CATEGORY_ORDER, setCategoryOrder, categoryOrder, 'Navigation order updated.')} className={workspaceButtonClass({ tone: 'slate', className: 'mt-4' })}>Reset Default</button>
                            </div>
                        )}
                        {activePanel === 'Book Marks' && (
                            <div>
                                <p className="mb-4 text-sm text-slate-500">Choose pages from your main sidebar to show below Dashboard items. Move a link back from All the rest to bookmark it.</p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {bookmarkCandidates.map((item) => (
                                        <label key={item.path} className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 p-3 text-sm text-slate-700">
                                            <input type="checkbox" checked={bookmarkPaths.includes(item.path)} disabled={disabled} aria-label={`Bookmark ${item.title}`} onChange={() => savePreference('companyNavigationBookmarks', bookmarkPaths.includes(item.path) ? bookmarkPaths.filter((path) => path !== item.path) : [...bookmarkPaths, item.path], setBookmarkPaths, bookmarkPaths, 'Book marks updated.')} className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900" />
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-500 [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">{item.icon}</span>
                                            <span className="min-w-0 break-words font-medium">{item.title}</span>
                                        </label>
                                    ))}
                                </div>
                                {!bookmarkCandidates.length && <p className="text-sm text-slate-500">No bookmarkable pages are available in your main sidebar.</p>}
                            </div>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
                        <p className="text-xs text-slate-500" role="status">{isSaving ? 'Saving…' : 'Changes save automatically for your account.'}</p>
                        <button type="button" onClick={close} disabled={isSaving} className={workspaceButtonClass({ tone: 'blue' })}>Done</button>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
};

export default NavigationOrderDialog;
