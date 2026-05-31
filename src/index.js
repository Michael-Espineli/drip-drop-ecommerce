import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { Toaster } from 'react-hot-toast';
import { AuthContext } from "./context/AuthContext";
import { Provider } from 'react-redux';
import { BrowserRouter, useLocation } from 'react-router-dom';
import ScrollToTop from './utils/ScrollToTop';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  // <React.StrictMode>
  <AuthContext>
    <BrowserRouter
      future={{
        v7_startTransition: true,
      }}>
      <ScrollToTop />
      <Suspense>
        <App />
        <Toaster
          toastOptions={{
            position: 'top-right',
            style: {
              background: '#283046',
              color: 'white'
            }
          }}
        />
      </Suspense>
    </BrowserRouter>
  </AuthContext>
  // </React.StrictMode>

);

reportWebVitals();
