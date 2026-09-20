import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * Hosts the dev server will accept dev/HMR requests from.
 *
 * Next 16 blocks cross-origin requests to dev-only endpoints and trusts only
 * `localhost` by default, so opening the dashboard from any other origin (a
 * robot's LAN address, a container's bridge IP) breaks the webpack-hmr
 * WebSocket unless that origin is listed. Hardcoding a list meant editing this
 * file every time the machine landed on a different network.
 *
 * Instead, enumerate this host's own addresses at startup: on a laptop that is
 * the current LAN IP, inside a container it is the bridge IP the browser
 * actually connects to. Next matches on hostname only — no scheme, no port —
 * so bare addresses are the right shape.
 *
 * The list is fixed when the dev server boots, so a network change (new Wi-Fi,
 * new DHCP lease) needs a restart to be picked up.
 */
function localDevOrigins(): string[] {
  const origins = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal) continue;
      if (address.family === "IPv6") {
        // Link-local needs a scope id (`[fe80::1%en0]`) that a browser Origin
        // header never carries, so these entries could not match anything.
        if (address.address.toLowerCase().startsWith("fe80:")) continue;
        // Next parses the Origin with the WHATWG URL parser, which keeps IPv6
        // literals bracketed — the allowlist entry has to match that shape.
        origins.add(`[${address.address}]`);
      } else {
        origins.add(address.address);
      }
    }
  }

  // Escape hatch for origins this host cannot discover about itself — a
  // reverse proxy, a tunnel, a name that resolves elsewhere. Comma-separated.
  for (const extra of (process.env.SYNCAI_DEV_ORIGINS ?? "").split(",")) {
    const trimmed = extra.trim();
    if (trimmed) origins.add(trimmed);
  }

  return [...origins];
}

const nextConfig: NextConfig = {
  // Production Dockerfile ships only .next/standalone (+ static assets); the
  // dev flow (`npm run dev` against the mounted workspace) is unaffected.
  output: "standalone",
  allowedDevOrigins: localDevOrigins(),
};

export default nextConfig;
