import { adminRoutes } from "./adminRoutes";
import { sellerRoutes } from "./sellerRoutes";
import { clientRoutes } from './clientRoutes';

export const privateRoutes = [
    ...adminRoutes,
    ...sellerRoutes,
    ...clientRoutes

]
 