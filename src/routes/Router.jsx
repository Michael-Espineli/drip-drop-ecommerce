// import React from 'react';
import { useRoutes } from 'react-router-dom';

const Router = ({allRoutes}) => {
    console.log('Routes ',allRoutes.length)
    const routes = useRoutes([...allRoutes])
    return routes;
};

export default Router;