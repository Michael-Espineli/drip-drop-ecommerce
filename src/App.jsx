import React, { useEffect, useState} from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import publicRoutes from './routes/routes/publicRoutes';
import { getRoutes } from "./routes";
import Router from "./routes/Router"

export default function App() {

  // const router = createBrowserRouter(publicRoutes);
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