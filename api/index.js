// Vercel serverless entry: every /api/* and /auth/* request is rewritten here
// (see vercel.json). Static files come from web/dist via the CDN.
import app from "../server/app.js";
export default app;
