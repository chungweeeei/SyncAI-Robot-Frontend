import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

import { ActiveTaskProvider } from "@/components/console/active-task-provider";
import { EstopProvider } from "@/components/console/estop-provider";
import { NavRail } from "@/components/console/nav-rail";
import { RobotStateProvider } from "@/components/console/robot-state-provider";
import { StatusStrip } from "@/components/console/status-strip";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";

// `axes: ["wdth"]`, or next/font ships the wght-only subset and
// `instrument-label` silently renders at normal width.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SyncAI Robot Console",
  description: "Live telemetry, map and navigation control for one robot",
};

// `cover` makes env(safe-area-inset-bottom) non-zero, so the rail can pad
// itself above the home indicator.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9eef2" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1014" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="overflow-hidden">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/*
           * The console's two polls, mounted once so every screen reads the
           * same snapshot and the job state survives navigation. Separate
           * providers because they fail differently (see ActiveTaskProvider).
           */}
          <QueryProvider>
            <RobotStateProvider>
              <ActiveTaskProvider>
                {/* Inside both polls: the stop reads the robot's lock from the
                  * first and the jobs to cancel from the second. */}
                <EstopProvider>
                  <div className="flex h-dvh flex-col lg:flex-row">
                    <NavRail />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <StatusStrip />
                      {/* Pages own their scrolling. */}
                      <main className="min-h-0 flex-1 overflow-hidden">
                        {children}
                      </main>
                    </div>
                  </div>
                </EstopProvider>
              </ActiveTaskProvider>
            </RobotStateProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
