// The daemon issues a revocable per-device session token in exchange for
// a pairing token printed in its boot log. Held as a bearer token rather
// than a cookie so the same code works whether the API is same-origin
// (via the dev proxy) or reached directly.

import { Store } from "@tanstack/store"
import { useStore } from "@tanstack/react-store"

const STORAGE_KEY = "orchd.session_token"

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export const authStore = new Store<{ token: string | null }>({
  token: readStoredToken(),
})

export function setAuthToken(token: string) {
  localStorage.setItem(STORAGE_KEY, token)
  authStore.setState(() => ({ token }))
}

export function clearAuthToken() {
  localStorage.removeItem(STORAGE_KEY)
  authStore.setState(() => ({ token: null }))
}

export function getAuthToken(): string | null {
  return authStore.state.token
}

export function useAuthToken(): string | null {
  return useStore(authStore, (state) => state.token)
}
