// import React from 'react';
import { useRoutes } from 'react-router-dom';

const Router = ({allRoutes}) => {
    console.log('Router Rotues: ',allRoutes.length)
    // console.log(allRoutes)
    const routes = useRoutes([...allRoutes])
    return routes;
};

export default Router;