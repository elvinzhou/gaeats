import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("map", "routes/map.tsx"),
] satisfies RouteConfig;
