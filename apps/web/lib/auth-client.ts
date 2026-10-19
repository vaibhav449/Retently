import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { Auth } from "./auth";

/** Browser-side auth calls. Same origin as the app, so no baseURL is needed. */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>()],
});
