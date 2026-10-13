/**
 * Workiz custom-field ids (account-specific). A leaf module with no imports so apn-hint.ts and
 * adeq.ts can both use it without an adeq ↔ apn-hint import cycle. adeq.ts re-exports it.
 * Custom fields are matched by id, never by fieldName (several names carry trailing spaces).
 */
export const WORKIZ_CF = {
  apn: "CF-nXNayb3y6x56kpwZ",
  waterSource: "CF-ypkPZr3dojlD9KnE",
  tankSize: "CF-mw5dG83Z9joVbYXE",
  effluentFilter: "CF-eWzopvxv6xPQglna",
  flowTestCompleted: "CF-JBDeg6xJWMlYV85W",
  tankRecommendation: "CF-p2ErD5xbe36Jl1XO",
  drainfieldRecommendation: "CF-y5W6qQMr9x1Rvld9",
  notableConcerns: "CF-2AblKqxDG3YeDga1",
  flowTestDescription: "CF-wlovONMYrjKBp4GE",
} as const;
