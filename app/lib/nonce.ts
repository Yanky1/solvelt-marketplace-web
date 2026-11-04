import { createContext, useContext } from "react";

/** CSP nonce for inline scripts. Provided during SSR (entry.server); empty on the client (browsers hide nonces after parse). */
export const NonceContext = createContext("");
export const useNonce = () => useContext(NonceContext);
