import React, { createContext, useContext, useEffect, useState } from 'react';
import { DEFAULT_BRAND_SETTINGS } from '../config/constants';
import { BrandSettings } from '../types/domain';

interface BrandContextValue {
  brand: BrandSettings;
  updateBrand: (partial: Partial<BrandSettings>) => void;
  resetBrand: () => void;
}

const STORAGE_KEY = 'nexora_brand_settings_v1';

const BrandContext = createContext<BrandContextValue | undefined>(undefined);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<BrandSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_BRAND_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {
      // Ignore storage errors
    }
    return DEFAULT_BRAND_SETTINGS;
  });

  useEffect(() => {
    document.title = `${brand.siteName} — ${brand.tagline}`;
  }, [brand.siteName, brand.tagline]);

  const updateBrand = (partial: Partial<BrandSettings>) => {
    setBrand((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const resetBrand = () => {
    setBrand(DEFAULT_BRAND_SETTINGS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  return (
    <BrandContext.Provider value={{ brand, updateBrand, resetBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  const ctx = useContext(BrandContext);
  if (!ctx) {
    throw new Error('useBrand must be used within a BrandProvider');
  }
  return ctx;
}
