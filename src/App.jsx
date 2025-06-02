import React, { useEffect, useState} from "react";
import publicRoutes from './routes/routes/publicRoutes';
import { getRoutes } from "./routes";
import Router from "./routes/Router"

export default function App() {

  const [allRoutes,setAllRoutes] = useState([...publicRoutes]);

  useEffect(() => {
    const routes = getRoutes()
    setAllRoutes([...allRoutes,routes])

  },[])

  return (
        // <RouterProvider router={allRoutes}/>
        <Router allRoutes={allRoutes}/>
  );
}