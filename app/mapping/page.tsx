"use client";

import { MappingView } from "@/components/mapping/mapping-view";

/**
 * Route shell only. Everything this screen does — the confirmation rule, the
 * viewport, the rail — is MappingView's, because none of it is chrome: the rule
 * that every act here is confirmed is the page's reason for existing, and a
 * state machine in a route file is a state machine nothing else can mount or
 * test. See CLAUDE.md > Layering.
 */
export default function MappingPage() {
  return <MappingView />;
}
