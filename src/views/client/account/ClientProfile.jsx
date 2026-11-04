import React, { useContext, useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
const fieldsFrom = (profile = {}, user = {}) => ({
  firstName: profile.firstName || '',
  lastName: profile.lastName || '',
  email: user.email || profile.email || '',
  phoneNumber: profile.phoneNumber || profile.phone || ''
});
export default function ClientProfile() {
  const {
    user,
    dataBaseUser,
    setDataBaseUser
  } = useContext(Context);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(() => fieldsFrom(dataBaseUser, user));
  useEffect(() => {
    if (!editing) setForm(fieldsFrom(dataBaseUser, user));
  }, [dataBaseUser, user, editing]);
  const change = event => setForm(value => ({
    ...value,
    [event.target.name]: event.target.value
  }));
  const save = async event => {
    event.preventDefault();
    if (saving || !user) return;
    const changes = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phoneNumber: form.phoneNumber.trim()
    };
    if (!changes.firstName || !changes.lastName) {
      setError('Enter your first and last name.');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        ...changes,
        name: `${changes.firstName} ${changes.lastName}`
      });
      setDataBaseUser(previous => ({
        ...previous,
        ...changes
      }));
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError('Your changes could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  if (!user) return <p className="p-6">Sign in to view your profile.</p>;
  const profile = fieldsFrom(dataBaseUser, user);
  return <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <header className="flex items-center justify-between gap-3"><h1 className="text-2xl font-bold text-slate-950">My profile</h1>
            {!editing && <button onClick={() => {
        setEditing(true);
        setSaved(false);
      }} className="min-h-[44px] rounded-lg border border-slate-300 px-4 font-semibold">Edit profile</button>}
        </header>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            {editing ? <form onSubmit={save} className="space-y-5">
                {[['firstName', 'First name', 'given-name', 'text'], ['lastName', 'Last name', 'family-name', 'text'], ['phoneNumber', 'Phone number', 'tel', 'tel']].map(([name, label, autoComplete, type]) => <label key={name} className="block text-sm font-semibold">{label}<input name={name} type={type} autoComplete={autoComplete} value={form[name]} onChange={change} required={name !== 'phoneNumber'} className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-base" /></label>)}
                <p className="text-sm text-slate-500">Your sign-in email is {profile.email}.</p>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                <div className="flex gap-3"><button disabled={saving} type="submit" className="min-h-[44px] flex-1 rounded-lg bg-blue-600 px-4 font-semibold text-white">{saving ? 'Saving…' : 'Save changes'}</button><button disabled={saving} type="button" onClick={() => {
            setEditing(false);
            setError('');
          }} className="min-h-[44px] rounded-lg border px-4">Cancel</button></div>
            </form> : <dl className="space-y-5">{[['Full name', [profile.firstName, profile.lastName].filter(Boolean).join(' ') || dataBaseUser?.name || 'Add your name'], ['Email address', profile.email], ['Phone number', profile.phoneNumber || 'Not provided']].map(([label, value]) => <div key={label}><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-900">{value}</dd></div>)}</dl>}
        </section>
        {saved && <p role="status" className="text-sm text-emerald-700">Profile saved.</p>}
        <Link to="/client/settings" className="inline-flex min-h-[44px] items-center font-semibold text-blue-700">Notification settings</Link>
    </div>;
}
