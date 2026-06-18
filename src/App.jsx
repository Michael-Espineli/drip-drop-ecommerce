import React, { useContext, useEffect, useMemo, useState} from "react";
import publicRoutes from './routes/routes/publicRoutes';
import { getRoutes } from "./routes";
import Router from "./routes/Router"
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { useLocation } from "react-router-dom";
import { Context } from "./context/AuthContext";
import AppErrorBoundary from "./components/AppErrorBoundary";
import AppErrorReporter from "./components/AppErrorReporter";

// export default function App() {

//   const allRoutes = [...publicRoutes, ...getRoutes()];

//   return (
//         <Router allRoutes={allRoutes}/>
//   );
// }
const AppShell = () => {

  const [allRoutes,setAllRoutes] = useState([...publicRoutes]);
  const { resolvedTheme } = useTheme();
  const {
    user,
    accountType,
    recentlySelectedCompany,
    recentlySelectedCompanyName,
  } = useContext(Context);
  const location = useLocation();

  useEffect(() => {
    const routes = getRoutes()
    setAllRoutes([...publicRoutes,routes])

  },[])

  const errorContext = useMemo(() => {
    const companyId = recentlySelectedCompany?.id || recentlySelectedCompany || '';
    const pathname = location.pathname || '';
    const appLocation = `${pathname}${location.search || ''}${location.hash || ''}`;

    return {
      userId: user?.uid || '',
      userEmail: user?.email || '',
      accountType: accountType || '',
      companyId,
      companyName: recentlySelectedCompanyName || '',
      pathname,
      location: typeof window === 'undefined' ? appLocation : window.location.href,
    };
  }, [
    accountType,
    location.hash,
    location.pathname,
    location.search,
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    user?.email,
    user?.uid,
  ]);

  return (
        // <RouterProvider router={allRoutes}/>
        <div className={`dark-theme app-theme-root theme-${resolvedTheme}`}>
          <AppErrorReporter context={errorContext} />
          <AppErrorBoundary context={errorContext}>
            <Router allRoutes={allRoutes}/>
          </AppErrorBoundary>
        </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
