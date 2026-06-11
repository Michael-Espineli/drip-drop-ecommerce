import React, { useEffect, useState} from "react";
import publicRoutes from './routes/routes/publicRoutes';
import { getRoutes } from "./routes";
import Router from "./routes/Router"
import { ThemeProvider, useTheme } from "./context/ThemeContext";

// export default function App() {

//   const allRoutes = [...publicRoutes, ...getRoutes()];

//   return (
//         <Router allRoutes={allRoutes}/>
//   );
// }
const AppShell = () => {

  const [allRoutes,setAllRoutes] = useState([...publicRoutes]);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const routes = getRoutes()
    setAllRoutes([...publicRoutes,routes])

  },[])

  return (
        // <RouterProvider router={allRoutes}/>
        <div className={`dark-theme app-theme-root theme-${resolvedTheme}`}>
          <Router allRoutes={allRoutes}/>
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
