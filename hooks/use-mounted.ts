"use client";

import * as React from "react";

/**
 * A store that never changes, for `useSyncExternalStore` reads of a value
 * that is fixed for the page's life but differs between server and client.
 */
export const neverChanges = () => () => {};

const onClient = () => true;
const onServer = () => false;

/**
 * False on the server and through hydration, true from the first client
 * render after it — for a value only the browser knows (the resolved theme,
 * a cache filled before this boundary hydrated), whose first client render
 * has to match the server's. `useSyncExternalStore` rather than a state set
 * in an effect, which the compiler lint rejects and which renders twice.
 */
export function useMounted(): boolean {
  return React.useSyncExternalStore(neverChanges, onClient, onServer);
}
