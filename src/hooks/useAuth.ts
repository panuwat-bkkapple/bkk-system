// src/hooks/useAuth.ts
import { useState, useEffect } from 'react';

export const useAuth = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem('bkk_session');
    if (saved) {
      setCurrentUser(JSON.parse(saved));
    }
  }, []);

  const hasAccess = (allowedRoles: string[]) => {
    if (!currentUser) return false;
    return allowedRoles.includes(currentUser.role);
  };

  return { currentUser, hasAccess };
};