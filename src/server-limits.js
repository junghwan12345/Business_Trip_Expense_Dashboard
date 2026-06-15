export const DEFAULT_JSON_BODY_LIMIT = 2_000_000;
export const PPT_JSON_BODY_LIMIT = 100_000_000;

export function jsonBodyLimitForPath(pathname) {
  return pathname === "/api/travel-proof/ppt-build" ? PPT_JSON_BODY_LIMIT : DEFAULT_JSON_BODY_LIMIT;
}
