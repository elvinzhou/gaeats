import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("airports/:code", "routes/airports.$code.tsx"),
  route("map", "routes/map.tsx"),
  route("api/pois/nearby", "routes/api.pois.nearby.ts"),
  route("api/restaurants/nearby", "routes/api.restaurants.nearby.ts"),
  route("api/airports/nearby", "routes/api.airports.nearby.ts"),
  route("api/airports/:code", "routes/api.airports.$code.ts"),
] satisfies RouteConfig;
