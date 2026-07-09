// frontend/lib/download-kra-export.ts
// Generates a print-ready branded Pulse Pharma Performance Framework (KRA & KPI).
// Generates Excel-compatible CSV spreadsheets.
// Pure client-side browser approach.

export interface FinalKRA {
  kra_id: string;
  title: string;
  weight: number;
  kpis: {
    kpi_id: string;
    title: string;
    description?: string;
    weight: number;
    target: string;
    threshold?: {
      below: string;
      meets: string;
      excellent: string;
    };
  }[];
}

const PULSE_LOGO = "https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png";

function esc(str: any): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function downloadKRAPdfClient(
  kras: FinalKRA[],
  jdData: any,
  roleTitle?: string,
  deptName?: string
): void {
  if (!kras || kras.length === 0) {
    alert("No KRA/KPI alignment data available to download.");
    return;
  }

  const employeeName = esc(jdData?.employee_name || "—");
  const employeeId   = esc(jdData?.employee_id || "—");
  const designation  = esc(jdData?.title || roleTitle || "—");
  const department   = esc(jdData?.department || deptName || "—");
  const managerName  = esc(jdData?.reporting_manager_name || "—");
  const managerCode  = esc(jdData?.reporting_manager_code || "—");
  
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const sectionBg = "#F2F4F7";
  const headerBg = "#5B2053"; // Pulse Purple branding

  let kraBlocksHtml = "";

  kras.forEach((kra, idx) => {
    let kpiRows = "";
    const kpis = kra.kpis || [];

    kpis.forEach((kpi) => {
      kpiRows += `
        <tr>
          <td style="padding:10px;border:1px solid #D0D5DD;font-size:10pt;vertical-align:top;width:25%;">
            <strong>${esc(kpi.title)}</strong>
            ${kpi.description ? `<p style="font-size:8.5pt;color:#475467;margin-top:4px;">${esc(kpi.description)}</p>` : ""}
          </td>
          <td style="padding:10px;border:1px solid #D0D5DD;font-size:10pt;text-align:center;vertical-align:top;width:8%;">
            <strong>${esc(kpi.weight)}%</strong>
          </td>
          <td style="padding:10px;border:1px solid #D0D5DD;font-size:10pt;vertical-align:top;width:22%;">
            ${esc(kpi.target)}
          </td>
          <td style="padding:10px;border:1px solid #D0D5DD;font-size:9.5pt;background:#FEF3F2;color:#B42220;vertical-align:top;width:15%;">
            ${esc(kpi.threshold?.below || (kpi.threshold as any)?.below_expectation || "Not defined")}
          </td>
          <td style="padding:10px;border:1px solid #D0D5DD;font-size:9.5pt;background:#F9F5FF;color:#6941C6;vertical-align:top;width:15%;">
            ${esc(kpi.threshold?.meets || (kpi.threshold as any)?.meets_expectation || "Not defined")}
          </td>
          <td style="padding:10px;border:1px solid #D0D5DD;font-size:9.5pt;background:#ECFDF3;color:#027A48;vertical-align:top;width:15%;">
            ${esc(kpi.threshold?.excellent || "Not defined")}
          </td>
        </tr>
      `;
    });

    kraBlocksHtml += `
      <div style="margin-bottom:24px;page-break-inside:avoid;">
        <table style="width:100%;border-collapse:collapse;margin-top:8px;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
          <thead>
            <tr style="background:${sectionBg};">
              <td colspan="6" style="padding:12px;border:1px solid #98A2B3;font-size:11pt;font-weight:bold;color:#101828;">
                KRA ${idx + 1}: ${esc(kra.title)} <span style="float:right;color:#6941C6;font-size:10.5pt;">Weight: ${esc(kra.weight)}%</span>
              </td>
            </tr>
            <tr style="background:#FCFCFD;font-weight:bold;text-align:left;color:#344054;border-bottom:2px solid #D0D5DD;">
              <td style="padding:10px;border:1px solid #D0D5DD;font-size:9pt;text-transform:uppercase;letter-spacing:0.05em;width:25%;">KPI Description</td>
              <td style="padding:10px;border:1px solid #D0D5DD;font-size:9pt;text-transform:uppercase;letter-spacing:0.05em;text-align:center;width:8%;">Weight</td>
              <td style="padding:10px;border:1px solid #D0D5DD;font-size:9pt;text-transform:uppercase;letter-spacing:0.05em;width:22%;">Target</td>
              <td style="padding:10px;border:1px solid #D0D5DD;font-size:9pt;text-transform:uppercase;letter-spacing:0.05em;color:#B42220;width:15%;">Below (Needs Imp.)</td>
              <td style="padding:10px;border:1px solid #D0D5DD;font-size:9pt;text-transform:uppercase;letter-spacing:0.05em;color:#6941C6;width:15%;">Meets Expectations</td>
              <td style="padding:10px;border:1px solid #D0D5DD;font-size:9pt;text-transform:uppercase;letter-spacing:0.05em;color:#027A48;width:15%;">Excellent (Outstanding)</td>
            </tr>
          </thead>
          <tbody>
            ${kpiRows || `<tr><td colspan="6" style="padding:12px;text-align:center;color:#667085;font-size:10pt;">No KPIs defined for this Key Result Area.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  });

  const totalKraWeight = kras.reduce((s, k) => s + (k.weight ?? 0), 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>KRA_KPI_${employeeId} — Pulse Pharma</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Segoe UI,Calibri,Arial,sans-serif;font-size:10pt;color:#1D2939;background:#fff;
         -webkit-print-color-adjust:exact;print-color-adjust:exact;line-height:1.5;}
    @page{size:A4 landscape;margin:12mm}
    @media print{.topbar{display:none!important}.content{margin-top:0!important}}
    .topbar{position:fixed;top:0;left:0;right:0;background:${headerBg};color:#fff;
            padding:10px 24px;display:flex;align-items:center;
            justify-content:space-between;z-index:100;font-family:Arial,sans-serif;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.15);}
    .topbar button{background:#fff;color:${headerBg};border:none;padding:7px 18px;
                   border-radius:5px;font-weight:bold;font-size:13px;cursor:pointer;transition:all 0.2s;}
    .topbar button:hover{background:#F9F5FF;box-shadow:0 2px 4px rgba(0,0,0,0.1);}
    .content{margin-top:58px;padding:10px 20px;max-width:1120px;margin-left:auto;margin-right:auto}
  </style>
</head>
<body>
<div class="topbar">
  <span>🎯 Pulse Pharma Performance Framework (KRA & KPI Alignment) &mdash; ${employeeName}</span>
  <button onclick="window.print()">⬇&nbsp; Save as PDF / Print</button>
</div>
<div class="content">

  <!-- Header Section -->
  <div style="display:flex;justify-content:between;align-items:center;margin-bottom:20px;border-bottom:2px solid ${headerBg};padding-bottom:12px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="${PULSE_LOGO}" alt="Pulse Logo" style="height:46px;object-fit:contain;"/>
      <div>
        <span style="font-family:Arial,sans-serif;font-weight:bold;font-size:26px;color:#5B2053;letter-spacing:-0.5px;">Pulse</span>
        <span style="font-size:11px;color:#667085;display:block;text-transform:uppercase;letter-spacing:0.1em;font-weight:bold;margin-top:-2px;">Performance Alignment</span>
      </div>
    </div>
    <div style="text-align:right;margin-left:auto;">
      <h2 style="font-size:16pt;font-weight:bold;color:${headerBg};margin-bottom:2px;">KRA &amp; KPI Goal Sheet</h2>
      <p style="font-size:9pt;color:#667085;">Generated ${date} · Confidential</p>
    </div>
  </div>

  <!-- Employee Info Panel -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,0.02);">
    <tbody>
      <tr>
        <td style="padding:8px 12px;border:1px solid #EAECF0;background:#FCFCFD;font-weight:bold;width:15%;font-size:9.5pt;color:#475467;">Employee Name:</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;width:35%;font-size:9.5pt;color:#101828;">${employeeName}</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;background:#FCFCFD;font-weight:bold;width:15%;font-size:9.5pt;color:#475467;">Designation:</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;width:35%;font-size:9.5pt;color:#101828;">${designation}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #EAECF0;background:#FCFCFD;font-weight:bold;font-size:9.5pt;color:#475467;">Employee ID:</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;font-size:9.5pt;color:#101828;">${employeeId}</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;background:#FCFCFD;font-weight:bold;font-size:9.5pt;color:#475467;">Department:</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;font-size:9.5pt;color:#101828;">${department}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #EAECF0;background:#FCFCFD;font-weight:bold;font-size:9.5pt;color:#475467;">Reporting Manager:</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;font-size:9.5pt;color:#101828;">${managerName} (${managerCode})</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;background:#FCFCFD;font-weight:bold;font-size:9.5pt;color:#475467;">Framework Weight:</td>
        <td style="padding:8px 12px;border:1px solid #EAECF0;font-size:9.5pt;color:#101828;"><strong>${totalKraWeight}% / 100%</strong></td>
      </tr>
    </tbody>
  </table>

  <!-- Performance Alignment Tables -->
  ${kraBlocksHtml}

  <!-- Footer block -->
  <div style="margin-top:30px;padding-top:12px;border-top:1px solid #EAECF0;display:flex;justify-content:space-between;align-items:center;font-size:8.5pt;color:#98A2B3;">
    <span>Pulse Pharma &bull; Employee Performance Goal Alignment System</span>
    <span style="font-style:italic;">I agree to the performance framework, targets, and expectation matrices outlined above.</span>
  </div>

  <div style="margin-top:60px;display:flex;justify-content:space-between;page-break-inside:avoid;">
    <div style="width:40%;border-top:1px solid #667085;padding-top:6px;text-align:center;">
      <p style="font-size:9.5pt;font-weight:bold;color:#344054;">${employeeName}</p>
      <p style="font-size:8.5pt;color:#667085;margin-top:2px;">Employee Signature / Date</p>
    </div>
    <div style="width:40%;border-top:1px solid #667085;padding-top:6px;text-align:center;">
      <p style="font-size:9.5pt;font-weight:bold;color:#344054;">${managerName}</p>
      <p style="font-size:8.5pt;color:#667085;margin-top:2px;">Reporting Manager Signature / Date</p>
    </div>
  </div>

</div>

<script>
  window.onload = () => {
    // Auto trigger print in window
    setTimeout(() => { window.print(); }, 400);
  };
</script>
</body>
</html>`;

  const printWindow = window.open("", "_blank", "width=1200,height=800");
  if (!printWindow) {
    alert("Please allow pop-ups to download the Performance Goal Sheet.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}

export function downloadKRACSVClient(kras: FinalKRA[], jdData: any): void {
  if (!kras || kras.length === 0) {
    alert("No KRA/KPI alignment data available to download.");
    return;
  }

  const employeeName = esc(jdData?.employee_name || "Employee");
  const employeeId   = esc(jdData?.employee_id || "N/A");
  const designation  = esc(jdData?.title || "N/A");
  const department   = esc(jdData?.department || "N/A");
  
  let excelRowsHtml = "";
  kras.forEach((kra) => {
    const kpis = kra.kpis || [];
    const rowSpan = kpis.length || 1;
    
    if (kpis.length === 0) {
      excelRowsHtml += `
        <tr>
          <td style="font-weight:bold;background-color:#ffffff;border:1px solid #D0D5DD;vertical-align:middle;font-family:Arial,sans-serif;">${esc(kra.title)}</td>
          <td style="text-align:center;font-weight:bold;background-color:#ffffff;border:1px solid #D0D5DD;vertical-align:middle;font-family:Arial,sans-serif;">${esc(kra.weight)}%</td>
          <td colspan="6" style="text-align:center;color:#667085;border:1px solid #D0D5DD;font-family:Arial,sans-serif;background-color:#ffffff;">No KPIs defined for this Key Result Area.</td>
        </tr>
      `;
    } else {
      kpis.forEach((kpi, idx) => {
        const belowVal = kpi.threshold?.below || (kpi.threshold as any)?.below_expectation || "";
        const meetsVal = kpi.threshold?.meets || (kpi.threshold as any)?.meets_expectation || "";
        const excelVal = kpi.threshold?.excellent || "";
        
        excelRowsHtml += `
          <tr>
            ${idx === 0 ? `<td rowspan="${rowSpan}" style="font-weight:bold;background-color:#ffffff;border:1px solid #D0D5DD;vertical-align:middle;font-family:Arial,sans-serif;">${esc(kra.title)}</td>` : ""}
            ${idx === 0 ? `<td rowspan="${rowSpan}" style="text-align:center;font-weight:bold;background-color:#ffffff;border:1px solid #D0D5DD;vertical-align:middle;font-family:Arial,sans-serif;">${esc(kra.weight)}%</td>` : ""}
            <td style="border:1px solid #D0D5DD;vertical-align:top;font-family:Arial,sans-serif;background-color:#ffffff;"><strong>${esc(kpi.title)}</strong>${kpi.description ? `<br/><span style="font-size:8.5pt;color:#475467;">${esc(kpi.description)}</span>` : ""}</td>
            <td style="text-align:center;border:1px solid #D0D5DD;vertical-align:top;font-family:Arial,sans-serif;background-color:#ffffff;">${esc(kpi.weight)}%</td>
            <td style="border:1px solid #D0D5DD;vertical-align:top;font-family:Arial,sans-serif;background-color:#ffffff;">${esc(kpi.target)}</td>
            <td style="border:1px solid #D0D5DD;vertical-align:top;font-family:Arial,sans-serif;background-color:#ffffff;">${esc(belowVal)}</td>
            <td style="border:1px solid #D0D5DD;vertical-align:top;font-family:Arial,sans-serif;background-color:#ffffff;">${esc(meetsVal)}</td>
            <td style="border:1px solid #D0D5DD;vertical-align:top;font-family:Arial,sans-serif;background-color:#ffffff;">${esc(excelVal)}</td>
          </tr>
        `;
      });
    }
  });

  const excelHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>KRA & KPI Sheet</x:Name>
          <x:WorksheetOptions>
            <x:DisplayGridlines/>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #D0D5DD; padding: 8px; font-size: 10pt; }
    .title-row { font-size: 14pt; font-weight: bold; color: #101828; text-align: left; }
    .metadata-label { background-color: #F9FAFB; font-weight: bold; color: #344054; border: 1px solid #D0D5DD; }
    .metadata-value { color: #101828; border: 1px solid #D0D5DD; background-color: #ffffff; }
    .header-cell { background-color: #F9FAFB; color: #101828; font-weight: bold; text-align: center; border: 1px solid #D0D5DD; }
  </style>
</head>
<body>
  <table>
    <tbody>
      <tr>
        <td colspan="8" class="title-row" style="text-align:left;font-size:15pt;font-weight:bold;color:#101828;height:40px;vertical-align:middle;border:none;font-family:Arial,sans-serif;">
          PULSE PHARMA - PERFORMANCE KRA & KPI SHEET
        </td>
      </tr>
      <tr><td colspan="8" style="border:none;height:10px;"></td></tr>
      <tr>
        <td class="metadata-label" style="font-weight:bold;background-color:#F9FAFB;font-family:Arial,sans-serif;border:1px solid #D0D5DD;">Employee Name:</td>
        <td class="metadata-value" colspan="3" style="font-family:Arial,sans-serif;border:1px solid #D0D5DD;">${employeeName}</td>
        <td class="metadata-label" style="font-weight:bold;background-color:#F9FAFB;font-family:Arial,sans-serif;border:1px solid #D0D5DD;">Employee ID:</td>
        <td class="metadata-value" colspan="3" style="font-family:Arial,sans-serif;border:1px solid #D0D5DD;">${employeeId}</td>
      </tr>
      <tr>
        <td class="metadata-label" style="font-weight:bold;background-color:#F9FAFB;font-family:Arial,sans-serif;border:1px solid #D0D5DD;">Designation:</td>
        <td class="metadata-value" colspan="3" style="font-family:Arial,sans-serif;border:1px solid #D0D5DD;">${designation}</td>
        <td class="metadata-label" style="font-weight:bold;background-color:#F9FAFB;font-family:Arial,sans-serif;border:1px solid #D0D5DD;">Department:</td>
        <td class="metadata-value" colspan="3" style="font-family:Arial,sans-serif;border:1px solid #D0D5DD;">${department}</td>
      </tr>
      <tr><td colspan="8" style="border:none;height:15px;"></td></tr>
      <tr style="background-color:#F9FAFB;color:#101828;font-weight:bold;text-align:center;height:28px;">
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:250px;font-family:Arial,sans-serif;">KRA Title</th>
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:100px;font-family:Arial,sans-serif;">KRA Weight (%)</th>
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:250px;font-family:Arial,sans-serif;">KPI Title</th>
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:100px;font-family:Arial,sans-serif;">KPI Weight (%)</th>
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:300px;font-family:Arial,sans-serif;">KPI Target Description</th>
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:180px;font-family:Arial,sans-serif;">Below Expectations (Needs Imp.)</th>
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:180px;font-family:Arial,sans-serif;">Meets Expectations</th>
        <th class="header-cell" style="background-color:#F9FAFB;color:#101828;border:1px solid #D0D5DD;width:180px;font-family:Arial,sans-serif;">Excellent Performance (Outstanding)</th>
      </tr>
      ${excelRowsHtml}
    </tbody>
  </table>
</body>
</html>`;

  // Download logic for Excel file
  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), excelHtml], {
    type: "application/vnd.ms-excel;charset=utf-8;"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const cleanDesignation = designation.replace(/[^a-zA-Z0-9]/g, "_");
  
  link.setAttribute("href", url);
  link.setAttribute("download", `KRA_KPI_${employeeId}_${cleanDesignation}.xls`);
  link.style.visibility = "hidden";
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
