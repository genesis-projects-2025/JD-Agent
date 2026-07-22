// frontend/config/version.ts

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  badge: "Major Release" | "Feature Update" | "Patch / Bug Fix";
  highlights: string[];
}

export const APP_VERSION = "1.0.0";

export const RELEASE_HISTORY: ReleaseNote[] = [
  {
    version: "1.0.0",
    date: "2026-07-22",
    title: "v1.0.0 Production Release",
    badge: "Major Release",
    highlights: [
      "Multi-Tab Session Isolation: HR can work on multiple employee profiles in separate tabs without data cross-contamination.",
      "Live Role Blueprint Sidebar: Real-time visual tracking of extracted responsibilities, tools, and skills during interviews.",
      "HR Admin Command Center: Department progress overview, manager bottleneck tracking, and bulk exports.",
      "App Version Bell: Interactive version updates & release notes drawer in the top navigation bar.",
      "Enhanced Voice Mode: Hands-free voice interview support with real-time audio waveform feedback.",
    ],
  },
];
