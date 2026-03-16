// frontend/lib/download-jd-pdf.ts
// Renders the JD template into a hidden iframe and triggers browser print-to-PDF.
// No server round-trip needed — uses the same data already on the page.

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

/**
 * Opens a styled print window with the Pulse Pharma JD template populated
 * with the given structured JD data, then triggers the browser print dialog.
 * The user saves as PDF from the print dialog.
 */
export function downloadJDPdfClient(data: any, roleTitle?: string, dept?: string): void {
  // Lazy import to avoid SSR issues
  import("@/components/jd/JDPrintTemplate").then(({ JDPrintTemplate }) => {
    // Render the React component to static HTML
    const element = React.createElement(JDPrintTemplate, {
      data,
      title: roleTitle,
      department: dept,
    });
    const bodyHtml = renderToStaticMarkup(element);

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      alert("Please allow pop-ups to download the PDF.");
      return;
    }

    const safeTitle = (roleTitle || "Job Description").replace(/[<>"]/g, "");

    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} - Pulse Pharma JD</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Calibri, Arial, sans-serif;
      font-size: 11pt;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @page {
      size: A4;
      margin: 15mm 15mm 15mm 15mm;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
      table { page-break-inside: avoid; }
    }
    /* Print button - hidden during actual print */
    .print-bar {
      position: fixed;
      top: 0; left: 0; right: 0;
      background: #1F4E79;
      color: white;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 1000;
      font-family: Arial, sans-serif;
      font-size: 14px;
    }
    .print-bar button {
      background: #fff;
      color: #1F4E79;
      border: none;
      padding: 8px 20px;
      border-radius: 6px;
      font-weight: bold;
      font-size: 14px;
      cursor: pointer;
    }
    .print-bar button:hover { background: #e0e8f0; }
    .content-wrapper { margin-top: 56px; }
    @media print {
      .print-bar { display: none; }
      .content-wrapper { margin-top: 0; }
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <span>📄 Pulse Pharma — ${safeTitle}</span>
    <button onclick="window.print()">⬇ Save as PDF / Print</button>
  </div>
  <div class="content-wrapper">
    ${bodyHtml}
  </div>
  <script>
    // Auto-focus so Ctrl+P works immediately
    window.focus();
  </script>
</body>
</html>`);

    printWindow.document.close();
  });
}