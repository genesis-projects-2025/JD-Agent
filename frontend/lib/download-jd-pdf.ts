// frontend/lib/download-jd-pdf.ts
// Generates a branded Pulse Pharma JD as a print-ready HTML page.
// Opens in a new tab. User clicks "Save as PDF" or Ctrl+P.
// Pure browser approach — no react-dom/server, no SSR, no server round-trip.

export const PULSE_LOGO =
  "https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png";

function getField(data: any, ...keys: string[]): string {
  const emp = data?.employee_information || {};
  for (const k of keys) {
    let v = data?.[k] || emp?.[k];
    if (!v && data?.qualifications?.[k]) v = data.qualifications[k];
    if (v && typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function getArray(data: any, ...keys: string[]): string[] {
  for (const k of keys) {
    let v = data?.[k];
    if (!v && data?.qualifications?.[k]) v = data.qualifications[k];
    if (Array.isArray(v) && v.length > 0) return v.filter(Boolean);
    if (typeof v === "string" && v.trim()) {
      return v.split("\n").map(s => s.replace(/^[-\*\u2022]\s*/, "").trim()).filter(Boolean);
    }
  }
  return [];
}

function getStakeholder(data: any, type: "internal" | "external"): string {
  const s = data?.stakeholder_interactions || data?.stakeholders || data?.working_relationships || {};
  const v = type === "internal"
    ? (s?.internal || s?.internal_stakeholders || "")
    : (s?.external || s?.external_stakeholders || "");
  return Array.isArray(v) ? v.join(", ") : (v || "");
}

function esc(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listHtml(items: string[]): string {
  if (!items.length) return "To be confirmed with line manager.";
  return "<ul style=\"margin:0;padding-left:20px\">" +
    items.map(i => `<li style="margin-bottom:3px">${esc(i)}</li>`).join("") +
    "</ul>";
}

export function downloadJDPdfClient(data: any, roleTitle?: string, dept?: string): void {
  if (!data) { alert("No JD data available to download."); return; }

  const designation  = esc(getField(data, "job_title", "title", "designation") || roleTitle || "—");
  const band         = esc(getField(data, "band"));
  const grade        = esc(getField(data, "grade"));
  const func         = esc(getField(data, "department", "function") || dept || "—");
  const location     = esc(getField(data, "location"));
  const reportingTo  = esc(
    getField(data, "reports_to", "reporting_to") ||
    data?.working_relationships?.reporting_to ||
    data?.team_structure?.reports_to || "—"
  );
  const teamSize     = esc(String(
    data?.team_structure?.team_size ||
    data?.working_relationships?.team_size || "—"
  ));
  const internal     = esc(getStakeholder(data, "internal") || "—");
  const external     = esc(getStakeholder(data, "external") || "Not applicable");
  const purpose      = esc(getField(data, "purpose", "role_summary"));
  const responsibilities = getArray(data, "responsibilities", "key_responsibilities");
  const skills       = getArray(data, "skills", "required_skills");
  const tools        = getArray(data, "tools", "tools_used", "tools_and_technologies");
  const allSkills    = [...skills, ...tools.map((t: string) => `${t} (Tool/Platform)`)];
  const education    = esc(getField(data, "education") || data?.talent_bar?.education || "");
  const experience   = esc(getField(data, "experience") || data?.talent_bar?.experience || "");
  const eduExp       = [education, experience].filter(Boolean).join("<br/><br/>");
  const safeTitle    = esc(roleTitle || "Job Description");

  const H = "#BFBFBF"; // section header background — matches company template exactly

  const sectionHeader = (text: string) =>
    `<tr><td colspan="2" style="background:${H};font-weight:bold;text-align:center;
     padding:8px 10px;font-size:12pt;border:1px solid #999;">${text}</td></tr>`;

  const subHeader = (text: string) =>
    `<tr><td colspan="2" style="background:${H};font-weight:bold;text-align:center;
     padding:6px 10px;font-size:11pt;border:1px solid #999;">${text}</td></tr>`;

  const labelRow = (label: string, value: string, extraStyle = "") =>
    `<tr>
      <td style="font-weight:bold;padding:7px 10px;width:35%;border:1px solid #999;
                 vertical-align:top;font-size:11pt;${extraStyle}">${label}</td>
      <td style="padding:7px 10px;border:1px solid #999;vertical-align:top;
                 font-size:11pt;white-space:pre-wrap;${extraStyle}">${value}</td>
    </tr>`;

  const TABLE = `style="width:100%;border-collapse:collapse;margin-bottom:14px;page-break-inside:avoid;"`;

  const logoId = "pulse-company-logo";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${safeTitle} — Pulse Pharma</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000;background:#fff;
         -webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:A4;margin:15mm}
    @media print{.topbar{display:none!important}.content{margin-top:0!important}}
    .topbar{position:fixed;top:0;left:0;right:0;background:#1F4E79;color:#fff;
            padding:10px 20px;display:flex;align-items:center;
            justify-content:space-between;z-index:100;font-family:Arial,sans-serif;font-size:13px}
    .topbar button{background:#fff;color:#1F4E79;border:none;padding:7px 18px;
                   border-radius:5px;font-weight:bold;font-size:13px;cursor:pointer}
    .topbar button:hover{background:#dce8f4}
    .content{margin-top:52px;padding:20px 30px;max-width:860px;margin-left:auto;margin-right:auto}
  </style>
</head>
<body>
<div class="topbar">
  <span>📄 Pulse Pharma &mdash; ${safeTitle}</span>
  <button onclick="window.print()">⬇&nbsp; Save as PDF / Print</button>
</div>
<div class="content">

  <!-- Logo -->
  <div style="text-align:center;margin-bottom:18px">
    <img id="${logoId}" src="${PULSE_LOGO}" alt="Pulse Pharma" style="height:75px;object-fit:contain"/>
  </div>

  <!-- Table 1: Job / Role Information -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Job / Role Information")}
      ${labelRow("Designation", designation)}
      ${labelRow("Band &amp; Band Name", band)}
      ${labelRow("Grade", grade)}
      ${labelRow("Function", func)}
      ${labelRow("Location", location)}
      ${subHeader("Job Description")}
      <tr>
        <td colspan="2" style="padding:10px;border:1px solid #999;font-size:11pt">
          ${purpose ? `<div style="font-weight:bold;margin-bottom:6px">Purpose of the Job / Role :</div>
          <div style="margin-bottom:14px;padding-left:4px">${purpose}</div>` : ""}
          ${responsibilities.length ? `<div style="font-weight:bold;margin-bottom:8px">Job Responsibilities</div>
          <ul style="margin:0;padding-left:22px">
            ${responsibilities.map((r: string) => `<li style="margin-bottom:5px">${esc(r)}</li>`).join("")}
          </ul>` : ""}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Table 2: Working Relationships -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Working Relationships")}
      ${labelRow("Reporting to", reportingTo)}
      ${labelRow("Team", teamSize)}
      ${labelRow("Internal Stakeholders", internal)}
      ${labelRow("External Stakeholders", external)}
    </tbody>
  </table>

  <!-- Table 3: Skills / Competencies -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Skills/ Competencies Required")}
      <tr>
        <td style="font-weight:bold;padding:7px 10px;width:35%;border:1px solid #999;
                   vertical-align:top;font-size:11pt">Skills</td>
        <td style="padding:7px 10px;border:1px solid #999;vertical-align:top;font-size:11pt">
          ${listHtml(allSkills)}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Table 4: Academic Qualifications & Experience -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Academic Qualifications &amp; Experience Required")}
      <tr>
        <td style="font-weight:bold;padding:7px 10px;width:35%;border:1px solid #999;
                   vertical-align:top;font-size:11pt">
          Required Educational Qualification &amp;<br/>Relevant experience
        </td>
        <td style="padding:7px 10px;border:1px solid #999;vertical-align:top;font-size:11pt">
          ${eduExp || "To be confirmed with line manager."}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Footer -->
  <p style="font-size:9pt;color:#333;margin-top:16px;line-height:1.5">
    Pulse Pharma is an equal opportunity employer - we never differentiate candidates on the
    basis of religion, caste, gender, language, disabilities or ethnic group. Pulse reserves
    the right to place/move any candidate to any company location, partner location or
    customer location globally, in the best interest of Pulse business.
  </p>
</div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=920,height=720");
  if (!win) { alert("Please allow pop-ups to download the PDF."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();

  const printWhenReady = () => {
    const logo = win.document.getElementById(logoId) as HTMLImageElement | null;

    if (!logo) {
      win.print();
      return;
    }

    const safePrint = () => {
      setTimeout(() => win.print(), 150);
    };

    if (logo.complete) {
      safePrint();
      return;
    }

    logo.addEventListener("load", safePrint, { once: true });
    logo.addEventListener("error", safePrint, { once: true });
    setTimeout(safePrint, 1200);
  };

  setTimeout(printWhenReady, 150);
}
