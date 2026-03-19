import { adminRoutes } from "./adminRoutes";
import { sellerRoutes } from "./sellerRoutes";
import { clientRoutes } from './clientRoutes';
import { businessRoutes } from './businessRoutes';

export const privateRoutes = [
    ...adminRoutes,
    ...sellerRoutes,
    ...clientRoutes,
    ...businessRoutes

]
 