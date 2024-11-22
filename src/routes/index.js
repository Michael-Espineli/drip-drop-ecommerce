import MainLayout from '../layout/MainLayout';
import { privateRoutes } from './routes/privateRoutes';
import { Protected } from './Protected';


export const getRoutes = () => {

privateRoutes.map( r=> {
    // console.log(r)
    r.element = <Protected route={r}>{r.element}</Protected>
})
    return {
        path : '/',
        element : <MainLayout/>,
        children : privateRoutes
    }
}