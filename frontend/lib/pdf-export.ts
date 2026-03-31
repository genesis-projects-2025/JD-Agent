export function exportJDToPDF(jdText: string, roleTitle?: string) {
  const title = roleTitle || "Job Description";
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title} — Pulse Pharma</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 13pt;
      color: #1a1a1a;
      background: #fff;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      max-width: 800px;
      margin: 0 auto;
      padding: 60px 64px;
    }

    .header {
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }

    .org-name {
      font-family: 'DM Mono', monospace;
      font-size: 9pt;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #555;
      margin-bottom: 12px;
    }

    .doc-title {
      font-size: 28pt;
      font-weight: 600;
      line-height: 1.15;
      margin-bottom: 8px;
    }

    .doc-meta {
      font-family: 'DM Mono', monospace;
      font-size: 8.5pt;
      color: #777;
      letter-spacing: 0.05em;
    }

    .content {
      white-space: pre-wrap;
      line-height: 1.75;
      font-size: 12pt;
    }

    .footer {
      margin-top: 48px;
      padding-top: 16px;
      border-top: 1px solid #ddd;
      font-family: 'DM Mono', monospace;
      font-size: 8pt;
      color: #aaa;
      display: flex;
      justify-content: space-between;
    }

    @media print {
      body { padding: 0; }
      .page { padding: 40px 48px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="org-name">Pulse Pharma · JD Intelligence</div>
      <h1 class="doc-title">${title}</h1>
      <div class="doc-meta">Generated ${date} · Confidential</div>
    </div>

    <div class="content">${jdText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>

    <div class="footer">
      <span>Pulse Pharma · JD Intelligence Agent</span>
      <span>Generated ${date}</span>
    </div>
  </div>

  <script>
    window.onload = () => {
      window.print();
      window.onafterprint = () => window.close();
    };
  </script>
</body>
</html>`;

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    alert("Please allow pop-ups to download the PDF.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}