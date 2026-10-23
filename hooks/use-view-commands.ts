"use client";

import * as React from "react";

import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";

export interface ViewCommands {
  /** Bumped by every Fit; a counter, so the button works again after a pan. */
  fitNonce: number;
  /** A fresh object per press, so the same step twice still reaches the view. */
  zoomStep: { factor: number } | null;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

/**
 * The toolbar's Fit and zoom buttons, as props a canvas reacts to by
 * identity. Every map surface steps by the same factor, so a press zooms as
 * far on the dashboard as in either editor.
 */
export function useViewCommands(): ViewCommands {
  const [fitNonce, setFitNonce] = React.useState(0);
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  const fit = React.useCallback(() => setFitNonce((n) => n + 1), []);
  const zoomIn = React.useCallback(() => setZoomStep({ factor: ZOOM_STEP_FACTOR }), []);
  const zoomOut = React.useCallback(() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR }), []);
  return { fitNonce, zoomStep, fit, zoomIn, zoomOut };
}
