
import React, { useState, useEffect, useContext } from 'react';
import { Switch } from '@headlessui/react';
import { BellIcon, EnvelopeIcon, CogIcon } from '@heroicons/react/24/outline';
import { Context } from '../../../context/AuthContext';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';

const ClientSettings = () => {
    const { user, userData, setUserData } = useContext(Context);
    const [settings, setSettings] = useState({
        emailNotifications: true,
        pushNotifications: false,
    });
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (userData?.settings) {
            setSettings(prev => ({ ...prev, ...userData.settings }));
        }
        setLoading(false);
    }, [userData]);

    const handleSettingChange = async (setting, value) => {
        if (!user) return;
        
        const newSettings = { ...settings, [setting]: value };
        setSettings(newSettings);
        setIsSaving(true);
        setError(null);

        try {
            const userDocRef = doc(db, 'users', user.uid);
            await updateDoc(userDocRef, { 
                [`settings.${setting}`]: value
            });
            // Optionally update context after successful save
            setUserData(prev => ({...prev, settings: newSettings}));
        } catch (err) {
            console.error("Error updating settings:", err);
            setError("Failed to save setting. Please try again.");
            // Revert on failure
            setSettings(prev => ({ ...prev, [setting]: !value }));
        } finally {
            setIsSaving(false);
        }
    };
    
    if (loading) {
        return <div className="p-8 text-center">Loading settings...</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900">Settings</h1>

                <div className="mt-8 bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="p-6">
                        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-3">
                            <BellIcon className="w-6 h-6 text-gray-600"/>
                            Notification Settings
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">Manage how you receive notifications from the app.</p>
                    </div>
                    <ul className="divide-y divide-gray-200">
                        <SettingToggle
                            label="Email Notifications"
                            description="Receive updates and alerts via email."
                            icon={EnvelopeIcon}
                            enabled={settings.emailNotifications}
                            onChange={(val) => handleSettingChange('emailNotifications', val)}
                            isSaving={isSaving}
                        />
                        <SettingToggle
                            label="Push Notifications"
                            description="Get real-time alerts on your device (coming soon)."
                            icon={CogIcon} // Placeholder icon
                            enabled={settings.pushNotifications}
                            onChange={(val) => handleSettingChange('pushNotifications', val)}
                            isSaving={isSaving}
                            disabled={true} // Feature is not ready
                        />
                    </ul>
                    {error && <p className="p-4 text-sm text-center text-red-600 bg-red-50">{error}</p>}
                </div>
            </div>
        </div>
    );
};

const SettingToggle = ({ label, description, icon: Icon, enabled, onChange, isSaving, disabled = false }) => (
    <li className={`p-6 flex justify-between items-center ${disabled ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-4">
            <Icon className="w-6 h-6 text-gray-500" />
            <div>
                <h3 className={`font-semibold text-gray-800 ${disabled ? 'cursor-not-allowed' : ''}`}>{label}</h3>
                <p className={`text-sm text-gray-500 ${disabled ? 'cursor-not-allowed' : ''}`}>{description}</p>
            </div>
        </div>
        <Switch
            checked={enabled}
            onChange={onChange}
            disabled={isSaving || disabled}
            className={`${enabled ? 'bg-blue-600' : 'bg-gray-200'}
              relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
              transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
              disabled:cursor-not-allowed`}
        >
            <span className="sr-only">Use setting</span>
            <span
                aria-hidden="true"
                className={`${enabled ? 'translate-x-5' : 'translate-x-0'}
                pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
                transition duration-200 ease-in-out`}
            />
        </Switch>
    </li>
);

export default ClientSettings;
