// frontend/config/version.ts

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  badge: "Major Release" | "Feature Update" | "Patch / Bug Fix";
  highlights: string[];
}

export const APP_VERSION = "1.0.1";

export const RELEASE_HISTORY: ReleaseNote[] = [
  {
    version: "1.0.1",
    date: "2026-07-23",
    title: "v1.0.1 Enterprise Observability & Optimization Update",
    badge: "Feature Update",
    highlights: [
      "Enterprise LLM Observability Console: Real-time live request tracking, token metrics, cost calculations in ₹ INR / $ USD, and 1-click CSV exports in Admin.",
      "99.8% Prompt Token Optimization: Sanitized chat history turns and isolated JSON state payloads, cutting prompt tokens per turn from ~402,000 to ~2,500.",
      "DeepDive & Extraction Engine Optimization: 97.2% reduction in DeepDive extraction tokens via phase-scoped prompt serialization.",
      "Latency & Anomaly Tracing: Interactive trace inspector with P50/P95 latency percentiles and automated anomaly detection.",
    ],
  },
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
