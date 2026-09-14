import { Router } from "express";

/** Express 4 does not catch rejected promises from async handlers; this Router
 *  forwards them to the error middleware so the client gets a JSON error. */
export function asyncRouter() {
  const router = Router();
  for (const m of ["get", "post", "put", "patch", "delete"]) {
    const orig = router[m].bind(router);
    router[m] = (path, ...fns) => orig(path, ...fns.map((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)));
  }
  return router;
}
