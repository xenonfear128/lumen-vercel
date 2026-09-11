import handler from '../server/api-handler.cjs';

// Explicit rewrites preserve /api/... paths, including multi-segment endpoints.
// Vercel invokes this on demand; no listener or background process is needed.
export default handler.createApiHandler();
