Always use context7 when I need code generation, setup or
configuration steps, or library/API documentation. This means
you should automatically use the Context7 MCP tools to resolve
library id and get library docs without me having to
explicitly ask.

##CODING Practices
Ensure each feature delivered has testing to accompany it to ensure that future updates do not impact current functionality.
Ensure all code is commented per best practices.
Update CLAUDE.MD as needed.

##Technology Stack
- **Frontend**: React Router v7 (framework mode)
- **Runtime**: Cloudflare Workers (edge deployment)
- **Database**: Prisma Postgres with PostGIS extension
- **ORM**: Prisma v7 with Accelerate for edge caching
- **Maps**: Google Maps JavaScript API via @vis.gl/react-google-maps
- **Testing**: Vitest with unit tests
- **Styling**: Tailwind CSS v4

##Google Maps Integration
- Uses @vis.gl/react-google-maps (v1.7.1) for React integration
- Supports satellite view, hybrid view, and street view
- Multi-modal directions: walking, biking, transit, driving
- Turn-by-turn navigation with step-by-step instructions
- API Key configured via VITE_GOOGLE_MAPS_API_KEY environment variable 