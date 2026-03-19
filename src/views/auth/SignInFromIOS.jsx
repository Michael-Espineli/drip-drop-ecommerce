// src/views/auth/SignInFromIOS.jsx (Example)
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase'; // your firebase config
import { signInWithCustomToken } from 'firebase/auth';
// You would also need a function to call your backend, e.g., from a service file
import { exchangeCodeForToken } from '../../services/authService';

const SignInFromIOS = () => {
    const [message, setMessage] = useState('Signing you in...');
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const code = queryParams.get('code');

        if (!code) {
            setMessage('Invalid sign-in link.');
            return;
        }

        const performSignIn = async () => {
            try {
                // Call your backend function to exchange the code for a custom token
                const { customToken } = await exchangeCodeForToken(code);

                // Sign in on the web with the custom token
                await signInWithCustomToken(auth, customToken);

                // Redirect to the dashboard
                navigate('/company/dashboard');

            } catch (error) {
                console.error("Failed to sign in from iOS:", error);
                setMessage('Sign-in failed. The link may have expired.');
            }
        };

        performSignIn();
    }, [location, navigate]);

    return (
        <div>
            <h1>{message}</h1>
        </div>
    );
};

export default SignInFromIOS;