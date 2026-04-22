"use client";

import { createContext, useContext } from "react";
import type { LemonUser } from "../types.js";

interface AuthContextValue {
  user: LemonUser | null;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
});

export function AuthProvider({
  user,
  children,
}: {
  user: LemonUser | null;
  children: React.ReactNode;
}) {
  return (
    <AuthContext value={{ user, isAuthenticated: user !== null }}>
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
