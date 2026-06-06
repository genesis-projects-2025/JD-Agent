import React from "react";
import { PULSE_LOGO } from "@/lib/download-jd-pdf";

type Props = {
  data: any;
  roleTitle?: string;
  dept?: string;
};

// Helper functions mirroring the PDF logic
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
  const s = data?.working_relationships || data?.stakeholder_interactions || data?.stakeholders || {};
  const stakeholdersList = s.stakeholders || (Array.isArray(data?.stakeholders) ? data.stakeholders : []);
  
  if (Array.isArray(stakeholdersList)) {
    const prefix = type === "internal" ? "internal:" : "external:";
    const matches = stakeholdersList
      .filter((item: any) => typeof item === "string" && item.toLowerCase().includes(prefix))
      .map((item: string) => {
        const idx = item.toLowerCase().indexOf(prefix);
        return item.substring(idx + prefix.length).trim();
      });
    
    if (matches.length > 0) {
      return matches.join(", ");
    }
    
    // Fallback if no prefix matches but we have list items, classify as internal if they don't contain "external"
    if (type === "internal") {
      return stakeholdersList
        .filter((item: any) => typeof item === "string" && !item.toLowerCase().includes("external:"))
        .map((item: string) => {
          if (item.toLowerCase().includes("internal:")) {
            const idx = item.toLowerCase().indexOf("internal:");
            return item.substring(idx + "internal:".length).trim();
          }
          return item.trim();
        })
        .join(", ");
    }
  }

  const v = type === "internal"
    ? (s?.internal || s?.internal_stakeholders || "")
    : (s?.external || s?.external_stakeholders || "");
  return Array.isArray(v) ? v.join(", ") : (v || "");
}

interface LabelRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
}

const LabelRow = ({ label, value }: LabelRowProps) => (
  <tr>
    <td style={{ fontWeight: "bold", padding: "7px 10px", width: "35%", border: "1px solid #999", verticalAlign: "top", fontSize: "11pt" }}>{label}</td>
    <td style={{ padding: "7px 10px", border: "1px solid #999", verticalAlign: "top", fontSize: "11pt", whiteSpace: "pre-wrap" as const }}>{value}</td>
  </tr>
);

export function PdfDocumentView({ data, roleTitle, dept }: Props) {
  if (!data) return null;

  const designation = getField(data, "job_title", "title", "designation") || roleTitle || "—";
  const jobLevel = getField(data, "job_level", "joblevel", "grade");
  const func = getField(data, "department", "function") || dept || "—";
  const location = getField(data, "location");
  const reportingTo =
    getField(data, "reports_to", "reporting_to") ||
    data?.working_relationships?.reporting_to ||
    data?.team_structure?.reports_to || "—";

  const teamSize = String(
    data?.team_structure?.team_size ||
    data?.working_relationships?.team_size || "—"
  );

  const internal = getStakeholder(data, "internal") || "—";
  const external = getStakeholder(data, "external") || "Not applicable";
  const purpose = getField(data, "purpose", "role_summary");
  const responsibilities = getArray(data, "responsibilities", "key_responsibilities");
  const skills = getArray(data, "skills", "technical_skills");
  const tools = getArray(data, "tools", "tools_used", "tools_and_technologies");
  const allSkills = [...skills, ...tools.map((t: string) => `${t} (Tool/Platform)`)];

  // Safe extraction taking into account nested qualifications map
  const rawEducation = data.qualifications?.education || getField(data, "education") || data?.talent_bar?.education;
  const rawExperience = data.qualifications?.experience || getField(data, "experience") || data?.talent_bar?.experience;

  const eduExp = [rawEducation, rawExperience].filter(Boolean).map((s, i) => (
    <React.Fragment key={i}>
      {s}
      {i === 0 && rawExperience ? <><br /><br /></> : null}
    </React.Fragment>
  ));

  // Shared Styles mapping to PDF exactly
  const H = "#BFBFBF";
  const tableStyle = { width: "100%", borderCollapse: "collapse" as const, marginBottom: "14px", pageBreakInside: "avoid" as const };
  const thStyle = { background: H, fontWeight: "bold", textAlign: "center" as const, padding: "8px 10px", fontSize: "12pt", border: "1px solid #999" };
  const subThStyle = { background: H, fontWeight: "bold", textAlign: "center" as const, padding: "6px 10px", fontSize: "11pt", border: "1px solid #999" };
  const tdLabelStyle = { fontWeight: "bold", padding: "7px 10px", width: "35%", border: "1px solid #999", verticalAlign: "top", fontSize: "11pt" };
  const tdValueStyle = { padding: "7px 10px", border: "1px solid #999", verticalAlign: "top", fontSize: "11pt", whiteSpace: "pre-wrap" as const };

  return (
    <div style={{ fontFamily: "Calibri, Arial, sans-serif", fontSize: "11pt", color: "#000", background: "#fff", maxWidth: "860px", margin: "0 auto", padding: "40px" }} className="shadow-xl rounded-md border border-surface-200">

      {/* Logo */}
      <div style={{ paddingBottom: "20px", display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
        <img
          src={PULSE_LOGO}
          alt=""
          style={{ height: "48px", objectFit: "contain", display: "block" }}
        />
        <span style={{ fontFamily: "Arial, Helvetica, sans-serif", fontWeight: "bold", fontSize: "32px", color: "#5B2053", letterSpacing: "-0.5px" }}>Pulse</span>
      </div>

      {/* Table 1: Job / Role Information */}
      <table style={tableStyle}>
        <tbody>
          <tr><td colSpan={2} style={thStyle}>Job / Role Information</td></tr>
          <LabelRow label="Designation" value={designation} />
          <LabelRow label="Job Level" value={jobLevel} />
          <LabelRow label="Function" value={func} />
          <LabelRow label="Location" value={location} />

          {/* About Pulse */}
          <tr>
            <td colSpan={2} style={subThStyle}>About Pulse</td>
          </tr>
          <tr>
            <td colSpan={2} style={{ padding: "12px 10px", border: "1px solid #999", fontSize: "11pt", lineHeight: "1.6", textAlign: "justify" }}>
              Pulse is a fast-growing Pharmaceutical company with a vertically &amp; diagonally integrated business model, focused on providing innovative product solutions to a large number of people around the world, to help them manage their health better &amp; lead a quality life. We are passionate for Innovation and compassionate for people. We go by the philosophy, solving the unsolved, reaching the unreached and serving the unserved.
              <br /><br />
              We believe that health and wellbeing are the main sources of happiness for humankind. Our goal is to preserve that happiness by developing and producing patient friendly medicines.
            </td>
          </tr>

          <tr><td colSpan={2} style={subThStyle}>Job Description</td></tr>
          <tr>
            <td colSpan={2} style={{ padding: "10px", border: "1px solid #999", fontSize: "11pt" }}>
              {purpose && (
                <>
                  <div style={{ fontWeight: "bold", marginBottom: "6px" }}>Purpose of the Job / Role :</div>
                  <div style={{ marginBottom: "14px", paddingLeft: "4px", whiteSpace: "pre-wrap" }}>{purpose}</div>
                </>
              )}
              {responsibilities.length > 0 && (
                <>
                  <div style={{ fontWeight: "bold", marginBottom: "8px" }}>Job Responsibilities</div>
                  <ul style={{ margin: 0, paddingLeft: "22px", listStyleType: "disc" }}>
                    {responsibilities.map((r: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: "5px" }}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Table 2: Working Relationships */}
      <table style={tableStyle}>
        <tbody>
          <tr><td colSpan={2} style={thStyle}>Working Relationships</td></tr>
          <LabelRow label="Reporting to" value={reportingTo} />
          <LabelRow label="External Stakeholders" value={external} />
        </tbody>
      </table>

      {/* Table 3: Skills / Competencies */}
      <table style={tableStyle}>
        <tbody>
          <tr><td colSpan={2} style={thStyle}>Skills/ Competencies Required</td></tr>
          <tr>
            <td style={tdLabelStyle}>Skills</td>
            <td style={tdValueStyle}>
              {allSkills.length === 0 ? "To be confirmed with line manager." : (
                <ul style={{ margin: 0, paddingLeft: "20px", listStyleType: "disc" }}>
                  {allSkills.map((s, i) => (
                    <li key={i} style={{ marginBottom: "3px" }}>{s}</li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Table 4: Academic Qualifications & Experience */}
      <table style={tableStyle}>
        <tbody>
          <tr><td colSpan={2} style={thStyle}>Academic Qualifications &amp; Experience Required</td></tr>
          <tr>
            <td style={tdLabelStyle}>Required Educational Qualification &amp;<br />Relevant experience</td>
            <td style={tdValueStyle}>
              {eduExp.length > 0 ? eduExp : "To be confirmed with line manager."}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Footer */}
      <p style={{ fontSize: "9pt", color: "#333", marginTop: "16px", lineHeight: 1.5 }}>
        Pulse Pharma is an equal opportunity employer - we never differentiate candidates on the
        basis of religion, caste, gender, language, disabilities or ethnic group. Pulse reserves
        the right to place/move any candidate to any company location, partner location or
        customer location globally, in the best interest of Pulse business.
      </p>
    </div>
  );
}
