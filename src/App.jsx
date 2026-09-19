import React, { useState, useEffect, useRef, useMemo } from "react";
import * as mammoth from "mammoth";
import Papa from "papaparse";
import {
  Plus,
  Trash2,
  Pencil,
  Printer,
  Download,
  Upload,
  Loader2,
  FileText,
  Info,
  Clipboard,
  Users,
} from "lucide-react";

/* ---------------------------------- helpers ---------------------------------- */

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(html) {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resizeImageFile(file, maxDim = 320) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function fileToTemplateHtml(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return result.value;
  }
  if (ext === "txt") {
    const text = await file.text();
    return text
      .split(/\r?\n/)
      .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p><br/></p>"))
      .join("");
  }
  return await file.text();
}

function formatDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function todayLong() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function safeGet(key, shared) {
  try {
    const res = await window.storage.get(key, shared);
    return res ? res.value : null;
  } catch (e) {
    return null;
  }
}

const PLACEHOLDER_TOKENS = [
  { token: "{{OrgName}}", label: "Organization name" },
  { token: "{{Prefix}}", label: "Mr / Ms / Dr…" },
  { token: "{{CandidateName}}", label: "Candidate name" },
  { token: "{{FullName}}", label: "Prefix + name" },
  { token: "{{Department}}", label: "Department" },
  { token: "{{Designation}}", label: "Designation" },
  { token: "{{JoiningDate}}", label: "Joining date" },
  { token: "{{Salary}}", label: "Salary amount" },
  { token: "{{SalaryPeriod}}", label: "per annum / per month" },
  { token: "{{CurrencySymbol}}", label: "Currency symbol" },
  { token: "{{TodayDate}}", label: "Today's date" },
];

const DEFAULT_TEMPLATE_CONTENT = `<p style="text-align:right;">{{TodayDate}}</p>
<p><strong>{{FullName}}</strong></p>
<p>Subject: Offer of Employment &mdash; {{Designation}}</p>
<p>Dear {{Prefix}} {{CandidateName}},</p>
<p>We are delighted to offer you the position of <strong>{{Designation}}</strong> in the <strong>{{Department}}</strong> department at {{OrgName}}. This letter outlines the key terms of your employment with us.</p>
<p>Your date of joining will be <strong>{{JoiningDate}}</strong>, subject to completion of any pre-joining formalities we may ask of you.</p>
<p>Your compensation will be <strong>{{CurrencySymbol}}{{Salary}} {{SalaryPeriod}}</strong>, payable in line with the company's standard payroll cycle and compensation policy.</p>
<p>This offer is contingent on the successful completion of any background verification and documentation we require. Your employment will be governed by the company's standard policies, including any applicable probation period, details of which will be shared separately by Human Resources.</p>
<p>We're looking forward to having you on the team. Please sign and return a copy of this letter to confirm your acceptance of this offer.</p>
<p style="margin-top:36px;">Warm regards,</p>
<p style="margin:0;">Human Resources</p>
<p style="margin:0 0 36px;">{{OrgName}}</p>
<p style="border-top:1px solid var(--hairline-strong); width:230px; padding-top:6px; margin-top:20px;">Candidate signature &amp; date</p>`;

function defaultTemplate() {
  return {
    id: uid(),
    name: "Standard Offer Letter",
    scope: "global",
    department: "",
    designation: "",
    content: DEFAULT_TEMPLATE_CONTENT,
    updatedAt: new Date().toISOString(),
  };
}

function findBestTemplate(templates, department, designation) {
  const dep = (department || "").trim().toLowerCase();
  const des = (designation || "").trim().toLowerCase();
  let match = templates.find(
    (t) => t.scope === "specific" && t.department.trim().toLowerCase() === dep && t.designation.trim().toLowerCase() === des && dep && des
  );
  if (match) return { template: match, matchType: "Exact match" };
  match = templates.find((t) => t.scope === "department" && t.department.trim().toLowerCase() === dep && dep);
  if (match) return { template: match, matchType: "Department default" };
  match = templates.find((t) => t.scope === "global");
  if (match) return { template: match, matchType: "Global default" };
  return { template: templates[0] || null, matchType: templates[0] ? "Only template available" : "None" };
}

function renderLetterContent(template, data) {
  if (!template || !template.content) {
    return '<p class="muted">No template selected yet. Create a template to see the letter here.</p>';
  }
  const map = {
    "{{OrgName}}": data.orgName || "Your Organization",
    "{{Prefix}}": data.prefix || "",
    "{{CandidateName}}": data.candidateName || "[Candidate Name]",
    "{{FullName}}": `${data.prefix || ""} ${data.candidateName || "[Candidate Name]"}`.trim(),
    "{{Department}}": data.department || "[Department]",
    "{{Designation}}": data.designation || "[Designation]",
    "{{JoiningDate}}": data.joiningDateFormatted || "[Joining Date]",
    "{{Salary}}": data.salaryFormatted || "[Salary]",
    "{{SalaryPeriod}}": data.salaryPeriod || "per annum",
    "{{CurrencySymbol}}": data.currency || "₹",
    "{{TodayDate}}": data.todayDate || todayLong(),
  };
  let html = template.content;
  Object.keys(map).forEach((token) => {
    html = html.split(token).join(map[token]);
  });
  return html;
}

/* ---------------------------------- bulk import helpers ---------------------------------- */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseFlexibleDate(str) {
  if (!str) return "";
  const s = String(str).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

function parseSalaryNumber(str) {
  if (!str) return "";
  const cleaned = String(str).replace(/[^0-9.]/g, "");
  return cleaned;
}

function normalizeKey(k) {
  return String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES = {
  prefix: ["prefix", "salutation"],
  candidateName: ["name", "candidatename", "candidate", "fullname"],
  department: ["department", "dept"],
  designation: ["designation", "title", "role", "jobtitle", "position"],
  joiningDate: ["joiningdate", "dateofjoining", "startdate", "joindate"],
  salary: ["salary", "ctc", "compensation", "annualsalary"],
  salaryPeriod: ["period", "salaryperiod", "frequency"],
};

function mapCsvRowToCandidate(row) {
  if (!row || typeof row !== "object") return null;
  const normalized = {};
  Object.keys(row).forEach((k) => {
    normalized[normalizeKey(k)] = row[k];
  });
  const get = (field) => {
    for (const alias of HEADER_ALIASES[field]) {
      if (normalized[alias] !== undefined && String(normalized[alias]).trim() !== "") return normalized[alias];
    }
    return "";
  };
  const candidateName = String(get("candidateName") || "").trim();
  if (!candidateName) return null;
  const rawPeriod = String(get("salaryPeriod") || "").toLowerCase();
  return {
    id: uid(),
    prefix: String(get("prefix") || "Mr.").trim() || "Mr.",
    candidateName,
    department: String(get("department") || "").trim(),
    designation: String(get("designation") || "").trim(),
    joiningDate: parseFlexibleDate(String(get("joiningDate") || "").trim()),
    salary: parseSalaryNumber(String(get("salary") || "")),
    salaryPeriod: rawPeriod.includes("month") ? "per month" : "per annum",
  };
}

/* ---------------------------------- export / download helpers ---------------------------------- */

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function letterHeadHtml(orgSettings) {
  return `<div class="letter-head">
${orgSettings.logo ? `<img class="letter-logo" src="${orgSettings.logo}"/>` : ""}
<div class="letter-org-name">${escapeHtml(orgSettings.orgName || "Your Organization")}</div>
<div class="rule"></div>
</div>`;
}

const EXPORT_STYLE = `
body{font-family:Georgia,'Times New Roman',serif; color:#16233F; font-size:15px; line-height:1.75;}
.letter-page{max-width:760px; margin:40px auto; padding:0 24px;}
.letter-head{text-align:center; margin-bottom:32px;}
.letter-logo{max-height:56px; max-width:220px; object-fit:contain; margin-bottom:10px;}
.letter-org-name{font-family:Arial,sans-serif; font-weight:700; font-size:19px; letter-spacing:.02em;}
.rule{height:3px; width:56px; background:#9C7A2E; margin:14px auto 0;}
p{margin:0 0 .9em;}
.letter-page + .letter-page{border-top:1px dashed #C7CCC3; padding-top:40px;}
@media print{
  .letter-page:not(:last-child){page-break-after:always;}
  .letter-page + .letter-page{border-top:none; padding-top:0;}
}
`;

function buildLetterDocument(title, pagesHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${EXPORT_STYLE}</style></head><body>${pagesHtml}</body></html>`;
}

/* ---------------------------------- styles ---------------------------------- */

const STYLES = `
:root{
  --paper:#FDFDFB;
  --canvas:#EFF2EF;
  --panel:#FFFFFF;
  --ink:#16233F;
  --ink-soft:#5B6472;
  --seal:#9A3324;
  --brass:#9C7A2E;
  --hairline:#DCE0DA;
  --hairline-strong:#C7CCC3;
  --font-sans:'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --font-serif:'IBM Plex Serif', Georgia, serif;
  --font-mono:'IBM Plex Mono', ui-monospace, monospace;
}
.app-shell{margin:0; min-height:100vh; background:var(--canvas); color:var(--ink); font-family:var(--font-sans); -webkit-font-smoothing:antialiased;}
.app-shell *{box-sizing:border-box;}
.app-shell *:focus-visible{outline:2px solid var(--seal); outline-offset:2px;}

.app-header{display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 28px; background:var(--panel); border-bottom:1px solid var(--hairline); flex-wrap:wrap;}
.brand{display:flex; align-items:center; gap:12px;}
.brand-mark{width:38px; height:38px; border-radius:7px; background:var(--seal); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; letter-spacing:.02em; flex-shrink:0;}
.brand-name{font-weight:600; font-size:16px; line-height:1.2;}
.brand-tag{font-size:12px; color:var(--ink-soft); line-height:1.2; margin-top:2px;}

.tab-bar{display:flex; gap:4px; background:var(--canvas); border:1px solid var(--hairline); border-radius:8px; padding:4px;}
.tab-btn{border:none; background:transparent; padding:8px 16px; font-family:var(--font-sans); font-weight:500; font-size:13.5px; color:var(--ink-soft); border-radius:6px; cursor:pointer; transition:background .15s ease, color .15s ease;}
.tab-btn:hover{color:var(--ink);}
.tab-btn.active{background:var(--ink); color:#fff;}

.app-main{max-width:1180px; margin:0 auto; padding:28px;}
.loading-state{display:flex; align-items:center; gap:10px; color:var(--ink-soft); font-size:14px; padding:40px 0; justify-content:center;}
.spin{animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}

.toast{position:fixed; top:16px; right:16px; background:var(--ink); color:#fff; padding:12px 18px; border-radius:8px; font-size:13.5px; font-weight:500; box-shadow:0 8px 24px rgba(0,0,0,.2); z-index:1000; max-width:320px;}
.toast-error{background:var(--seal);}

.panel{background:var(--panel); border:1px solid var(--hairline); border-radius:8px; padding:24px;}
.panel-title{font-family:var(--font-sans); font-size:17px; font-weight:600; margin:0 0 4px;}
.panel-desc{font-size:13px; color:var(--ink-soft); margin:0 0 20px; line-height:1.5;}
.panel-head{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:6px;}

.helper-note{display:flex; gap:8px; align-items:flex-start; font-size:12px; color:var(--ink-soft); background:var(--canvas); border:1px solid var(--hairline); border-radius:6px; padding:10px 12px; margin-bottom:20px; line-height:1.5;}
.helper-note svg{flex-shrink:0; margin-top:1px;}

.field{margin-bottom:16px;}
.field-label{display:block; font-size:12px; font-weight:600; color:var(--ink-soft); margin-bottom:6px; text-transform:uppercase; letter-spacing:.04em;}
.field-hint{font-size:12px; color:var(--ink-soft); margin-top:5px; line-height:1.5;}
.field-row{display:flex; gap:14px;}
.field-row .field{flex:1; min-width:0;}

.input{width:100%; font-family:var(--font-sans); font-size:14px; padding:9px 12px; border:1px solid var(--hairline-strong); border-radius:6px; background:#fff; color:var(--ink);}
.input:focus{outline:none; border-color:var(--ink); box-shadow:0 0 0 3px rgba(22,35,63,.08);}
.input.error{border-color:var(--seal); background:#FDF4F2;}
textarea.input{font-family:var(--font-mono); font-size:12.5px; line-height:1.6; resize:vertical;}

.btn{display:inline-flex; align-items:center; gap:8px; padding:10px 18px; font-family:var(--font-sans); font-weight:600; font-size:13.5px; border-radius:6px; border:1px solid transparent; cursor:pointer; transition:transform .12s ease, box-shadow .12s ease, opacity .12s ease; white-space:nowrap;}
.btn:active{transform:translateY(1px);}
.btn[disabled]{opacity:.45; cursor:not-allowed; transform:none; box-shadow:none;}
.btn-primary{background:var(--ink); color:#fff;}
.btn-primary:hover:not([disabled]){box-shadow:0 4px 14px rgba(22,35,63,.25);}
.btn-seal{background:var(--seal); color:#fff;}
.btn-seal:hover:not([disabled]){box-shadow:0 4px 14px rgba(154,51,36,.3);}
.btn-ghost{background:transparent; color:var(--ink); border-color:var(--hairline-strong);}
.btn-ghost:hover:not([disabled]){border-color:var(--ink);}
.btn-text{background:none; border:none; color:var(--ink-soft); font-weight:500; text-decoration:underline; padding:6px 4px; cursor:pointer; font-size:13px;}

.icon-btn{border:1px solid var(--hairline-strong); background:#fff; width:30px; height:30px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink-soft); flex-shrink:0;}
.icon-btn:hover{color:var(--ink); border-color:var(--ink);}
.icon-btn.danger:hover{color:var(--seal); border-color:var(--seal);}

.badge{display:inline-block; font-size:10.5px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; padding:3px 8px; border-radius:4px; background:var(--canvas); color:var(--ink-soft); border:1px solid var(--hairline-strong);}
.badge-global{color:var(--brass); border-color:var(--brass);}
.badge-dept{color:var(--ink); border-color:var(--ink-soft);}
.badge-specific{color:var(--seal); border-color:var(--seal);}

.template-group-title{font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); margin:24px 0 10px;}
.template-group-title.first{margin-top:0;}
.template-card{border:1px solid var(--hairline); border-radius:8px; padding:16px 18px; background:#fff; margin-bottom:10px;}
.template-card-head{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:6px;}
.template-card-name{font-weight:600; font-size:14.5px;}
.template-card-meta{font-size:12px; color:var(--ink-soft); margin-bottom:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
.template-card-snippet{font-size:12.5px; color:var(--ink-soft); line-height:1.5;}
.template-card-actions{display:flex; gap:6px; flex-shrink:0;}

.empty-state{text-align:center; padding:48px 20px; color:var(--ink-soft);}
.empty-state svg{margin-bottom:10px; opacity:.5;}
.empty-state p{margin:0 0 16px; font-size:13.5px;}

.upload-box{border:1.5px dashed var(--hairline-strong); border-radius:8px; padding:16px; text-align:center; background:var(--canvas);}
.upload-box p{margin:8px 0 0; font-size:12px; color:var(--ink-soft); line-height:1.5;}
.file-error{color:var(--seal); font-size:12px; margin-top:8px;}

.token-chip-row{display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 4px;}
.token-chip{font-family:var(--font-mono); font-size:11px; background:var(--canvas); border:1px solid var(--hairline-strong); color:var(--ink); padding:4px 8px; border-radius:4px; cursor:pointer;}
.token-chip:hover{border-color:var(--ink);}

.scope-option{display:flex; align-items:flex-start; gap:10px; border:1px solid var(--hairline-strong); border-radius:6px; padding:10px 12px; margin-bottom:8px; cursor:pointer;}
.scope-option.selected{border-color:var(--ink); background:#F7F8F6;}
.scope-option input{margin-top:3px;}
.scope-option-title{font-weight:600; font-size:13.5px;}
.scope-option-desc{font-size:12px; color:var(--ink-soft); margin-top:2px;}

.divider{height:1px; background:var(--hairline); margin:20px 0;}
.form-actions{display:flex; gap:10px; margin-top:18px; flex-wrap:wrap;}

.logo-preview{width:84px; height:84px; border:1px solid var(--hairline-strong); border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--canvas); flex-shrink:0;}
.logo-preview img{max-width:100%; max-height:100%; object-fit:contain;}
.logo-row{display:flex; gap:16px; align-items:center;}
.currency-quickpicks{display:flex; gap:6px; margin-top:8px;}
.currency-quickpick{width:34px; height:34px; border:1px solid var(--hairline-strong); background:#fff; border-radius:6px; cursor:pointer; font-family:var(--font-sans); font-size:14px;}
.currency-quickpick:hover{border-color:var(--ink);}
.currency-quickpick.active{border-color:var(--ink); background:var(--ink); color:#fff;}

.generate-grid{display:grid; grid-template-columns:380px 1fr; gap:24px; align-items:start;}
.template-indicator{background:var(--canvas); border:1px solid var(--hairline); border-radius:6px; padding:12px 14px; font-size:12.5px; margin-bottom:16px; line-height:1.5;}
.template-indicator strong{color:var(--ink);}

.paper-wrap{position:relative; display:flex; justify-content:center; padding:0 0 8px;}
.paper{position:relative; width:100%; max-width:720px; background:var(--paper); border:1px solid var(--hairline); border-radius:3px; box-shadow:0 12px 32px rgba(22,35,63,.08); padding:56px 60px;}
.watermark{position:absolute; top:22px; right:26px; color:var(--seal); opacity:.55; font-family:var(--font-sans); font-weight:700; font-size:11px; letter-spacing:.12em; text-transform:uppercase; border:1.5px solid currentColor; padding:4px 10px; border-radius:3px; transform:rotate(8deg); pointer-events:none;}
.letter-head{text-align:center; margin-bottom:30px;}
.letter-logo{max-height:56px; max-width:220px; object-fit:contain; display:block; margin:0 auto 10px;}
.letter-org-name{font-family:var(--font-sans); font-weight:600; font-size:19px; letter-spacing:.02em; color:var(--ink);}
.letter-rule{width:56px; height:3px; background:var(--brass); margin:14px auto 0;}
.letter-body{font-family:var(--font-serif); font-size:15px; line-height:1.75; color:var(--ink);}
.letter-body p{margin:0 0 .9em;}
.letter-body ul, .letter-body ol{padding-left:1.3em; margin:0 0 .9em;}
.letter-body .muted{color:var(--ink-soft); font-family:var(--font-sans); font-style:italic;}

.bulk-toolbar{display:flex; gap:8px; flex-wrap:wrap; align-items:center;}
.paste-box{margin-top:14px; padding-top:14px; border-top:1px solid var(--hairline);}
.bulk-table-wrap{overflow-x:auto; border:1px solid var(--hairline); border-radius:8px; margin-top:16px;}
.bulk-table{width:100%; border-collapse:collapse; min-width:840px;}
.bulk-table th{text-align:left; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-soft); padding:10px; background:var(--canvas); border-bottom:1px solid var(--hairline); white-space:nowrap;}
.bulk-table td{padding:6px; border-bottom:1px solid var(--hairline); vertical-align:middle;}
.bulk-table tr:last-child td{border-bottom:none;}
.bulk-table .input{padding:7px 8px; font-size:13px;}
.bulk-table td.remove-cell{width:36px; padding:6px 10px;}
.bulk-letter{margin-bottom:32px;}
.bulk-letter-label{font-size:12px; font-weight:600; color:var(--ink-soft); margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em;}

@media (max-width:860px){
  .generate-grid{grid-template-columns:1fr;}
}
@media (max-width:640px){
  .app-main{padding:16px;}
  .app-header{padding:14px 16px;}
  .paper{padding:32px 24px;}
  .field-row{flex-direction:column; gap:0;}
}
@media (prefers-reduced-motion: reduce){
  .app-shell *{transition:none !important; animation:none !important;}
}
@media print{
  .no-print{display:none !important;}
  .app-main{padding:0 !important; max-width:none !important;}
  .generate-grid{display:block !important;}
  .paper-wrap{padding:0 !important;}
  .paper{box-shadow:none !important; border:none !important; width:100% !important; max-width:none !important; margin:0 !important; padding:0 !important;}
  .bulk-letter{margin-bottom:0 !important;}
  .bulk-letter:not(:last-child){page-break-after:always;}
  body{background:#fff !important;}
}
`;

/* ---------------------------------- small components ---------------------------------- */

function TabButton({ active, onClick, children }) {
  return (
    <button type="button" className={`tab-btn${active ? " active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function PaperSheet({ orgSettings, template, data, watermarkText }) {
  const rendered = useMemo(() => renderLetterContent(template, data), [template, data]);
  return (
    <div className="paper">
      {watermarkText && <div className="watermark no-print">{watermarkText}</div>}
      <div className="letter-head">
        {orgSettings.logo && <img src={orgSettings.logo} alt="" className="letter-logo" />}
        <div className="letter-org-name">{orgSettings.orgName || "Your Organization Name"}</div>
        <div className="letter-rule" />
      </div>
      <div className="letter-body" dangerouslySetInnerHTML={{ __html: rendered }} />
    </div>
  );
}

function LetterPreview({ orgSettings, template, data, watermarkText }) {
  return (
    <div className="paper-wrap">
      <PaperSheet orgSettings={orgSettings} template={template} data={data} watermarkText={watermarkText} />
    </div>
  );
}

function BulkLetterPage({ index, total, orgSettings, template, data }) {
  return (
    <div className="bulk-letter">
      <div className="bulk-letter-label no-print">
        Letter {index + 1} of {total} — {data.prefix} {data.candidateName}
      </div>
      <PaperSheet orgSettings={orgSettings} template={template} data={data} />
    </div>
  );
}

/* ---------------------------------- Organization panel ---------------------------------- */

function OrganizationPanel({ value, onChange, onSave, saving }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleLogoFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      const dataUrl = await resizeImageFile(file, 320);
      onChange({ logo: dataUrl });
    } catch (err) {
      setUploadError("Could not use that image. Try a PNG or JPG file.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const quickCurrencies = ["₹", "$", "€", "£"];

  return (
    <div className="panel">
      <div className="panel-title">Organization</div>
      <div className="panel-desc">
        This name, logo, and currency appear on every offer letter you generate.
      </div>

      <div className="field">
        <label className="field-label">Organization name</label>
        <input
          className="input"
          type="text"
          placeholder="Acme Technologies Pvt. Ltd."
          value={value.orgName}
          onChange={(e) => onChange({ orgName: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label">Logo</label>
        <div className="logo-row">
          <div className="logo-preview">
            {value.logo ? (
              <img src={value.logo} alt="Logo preview" />
            ) : (
              <FileText size={22} color="var(--hairline-strong)" />
            )}
          </div>
          <div>
            <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
              <Upload size={15} />
              {uploading ? "Uploading…" : value.logo ? "Replace logo" : "Upload logo"}
              <input type="file" accept="image/*" onChange={handleLogoFile} style={{ display: "none" }} />
            </label>
            {value.logo && (
              <button type="button" className="btn-text" style={{ marginLeft: 10 }} onClick={() => onChange({ logo: "" })}>
                Remove
              </button>
            )}
            {uploadError && <div className="file-error">{uploadError}</div>}
          </div>
        </div>
      </div>

      <div className="field">
        <label className="field-label">Currency symbol</label>
        <input
          className="input"
          style={{ maxWidth: 140 }}
          type="text"
          maxLength={4}
          value={value.currency}
          onChange={(e) => onChange({ currency: e.target.value })}
        />
        <div className="currency-quickpicks">
          {quickCurrencies.map((c) => (
            <button
              type="button"
              key={c}
              className={`currency-quickpick${value.currency === c ? " active" : ""}`}
              onClick={() => onChange({ currency: c })}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 size={15} className="spin" /> : null}
          Save organization details
        </button>
      </div>

      <div className="field-hint" style={{ marginTop: 18 }}>
        Organization details and templates are shared with everyone who opens this app.
      </div>
    </div>
  );
}

/* ---------------------------------- Template form ---------------------------------- */

function TemplateForm({ editingTemplate, orgSettings, departmentOptions, designationOptions, onSave, onCancel }) {
  const [draft, setDraft] = useState(
    () =>
      editingTemplate
        ? { ...editingTemplate }
        : { id: null, name: "", scope: "global", department: "", designation: "", content: "" }
  );
  const [fileError, setFileError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [validationError, setValidationError] = useState("");
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileError("");
    setParsing(true);
    try {
      const html = await fileToTemplateHtml(file);
      setDraft((d) => ({ ...d, content: html, name: d.name || file.name.replace(/\.[^.]+$/, "") }));
    } catch (err) {
      setFileError("Could not read that file. Try a .docx, .html, or .txt file, or paste the text below instead.");
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function insertToken(token) {
    const ta = textareaRef.current;
    if (!ta) {
      setDraft((d) => ({ ...d, content: d.content + token }));
      return;
    }
    const start = ta.selectionStart ?? draft.content.length;
    const end = ta.selectionEnd ?? draft.content.length;
    const next = draft.content.slice(0, start) + token + draft.content.slice(end);
    setDraft((d) => ({ ...d, content: next }));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setValidationError("Give this template a name.");
      return;
    }
    if (!draft.content.trim()) {
      setValidationError("Add some content to the template — write it below or upload a file.");
      return;
    }
    if (draft.scope !== "global" && !draft.department.trim()) {
      setValidationError("Enter a department for this template.");
      return;
    }
    if (draft.scope === "specific" && !draft.designation.trim()) {
      setValidationError("Enter a designation for this template.");
      return;
    }
    setValidationError("");
    onSave(draft);
  }

  const sampleData = {
    prefix: "Ms.",
    candidateName: "Ananya Sharma",
    department: draft.department || "Product",
    designation: draft.designation || "Product Manager",
    joiningDateFormatted: formatDateLong(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)),
    salaryFormatted: (1200000).toLocaleString("en-IN"),
    salaryPeriod: "per annum",
    currency: orgSettings.currency || "₹",
    orgName: orgSettings.orgName || "Acme Technologies",
    todayDate: todayLong(),
  };

  const scopeOptions = [
    { value: "global", title: "Global default", desc: "Used when no more specific template matches." },
    { value: "department", title: "All designations in a department", desc: "Used for any role in that department." },
    { value: "specific", title: "One specific designation", desc: "Used only for that exact department + designation." },
  ];

  return (
    <div className="panel">
      <div className="panel-title">{editingTemplate ? "Edit template" : "New template"}</div>
      <div className="panel-desc">Upload a starting file or write the letter directly, then place placeholder tokens wherever details should be filled in.</div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="field-label">Template name</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. Engineering — Senior Roles"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>

        <div className="field">
          <label className="field-label">Applies to</label>
          {scopeOptions.map((opt) => (
            <label key={opt.value} className={`scope-option${draft.scope === opt.value ? " selected" : ""}`}>
              <input
                type="radio"
                name="scope"
                checked={draft.scope === opt.value}
                onChange={() => setDraft((d) => ({ ...d, scope: opt.value }))}
              />
              <div>
                <div className="scope-option-title">{opt.title}</div>
                <div className="scope-option-desc">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {draft.scope !== "global" && (
          <div className="field-row">
            <div className="field">
              <label className="field-label">Department</label>
              <input
                className="input"
                list="dept-options-form"
                type="text"
                placeholder="e.g. Engineering"
                value={draft.department}
                onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
              />
              <datalist id="dept-options-form">
                {departmentOptions.map((d) => (
                  <option value={d} key={d} />
                ))}
              </datalist>
            </div>
            {draft.scope === "specific" && (
              <div className="field">
                <label className="field-label">Designation</label>
                <input
                  className="input"
                  list="designation-options-form"
                  type="text"
                  placeholder="e.g. Software Engineer"
                  value={draft.designation}
                  onChange={(e) => setDraft((d) => ({ ...d, designation: e.target.value }))}
                />
                <datalist id="designation-options-form">
                  {designationOptions.map((d) => (
                    <option value={d} key={d} />
                  ))}
                </datalist>
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label className="field-label">Start from a file (optional)</label>
          <div className="upload-box">
            <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
              <Upload size={15} />
              {parsing ? "Reading file…" : "Upload .docx, .html, or .txt"}
              <input ref={fileInputRef} type="file" accept=".docx,.html,.htm,.txt" onChange={handleFile} style={{ display: "none" }} disabled={parsing} />
            </label>
            <p>We'll pull the text in below so you can add placeholder tokens and edit it.</p>
            {fileError && <div className="file-error">{fileError}</div>}
          </div>
        </div>

        <div className="field">
          <label className="field-label">Letter content</label>
          <div className="token-chip-row">
            {PLACEHOLDER_TOKENS.map((t) => (
              <button type="button" key={t.token} className="token-chip" title={t.label} onClick={() => insertToken(t.token)}>
                {t.token}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="input"
            rows={14}
            value={draft.content}
            onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            placeholder="Write or paste your offer letter here, using tokens like {{CandidateName}} where details should go."
          />
          <div className="field-hint">Click a token above to insert it at your cursor. HTML tags like &lt;p&gt; and &lt;strong&gt; are supported.</div>
        </div>

        <button type="button" className="btn-text" onClick={() => setShowPreview((s) => !s)}>
          {showPreview ? "Hide preview" : "Preview with sample data"}
        </button>

        {showPreview && (
          <div style={{ marginTop: 16 }}>
            <LetterPreview orgSettings={orgSettings} template={draft} data={sampleData} watermarkText="Sample data" />
          </div>
        )}

        {validationError && <div className="file-error" style={{ marginTop: 12 }}>{validationError}</div>}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Save template</button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------- Templates panel ---------------------------------- */

function TemplatesPanel({ templates, orgSettings, onSaveTemplate, onDeleteTemplate, departmentOptions, designationOptions }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  function openNew() {
    setEditingTemplate(null);
    setShowForm(true);
  }
  function openEdit(t) {
    setEditingTemplate(t);
    setShowForm(true);
  }
  function handleSave(draft) {
    onSaveTemplate(draft);
    setShowForm(false);
    setEditingTemplate(null);
  }

  if (showForm) {
    return (
      <TemplateForm
        editingTemplate={editingTemplate}
        orgSettings={orgSettings}
        departmentOptions={departmentOptions}
        designationOptions={designationOptions}
        onSave={handleSave}
        onCancel={() => {
          setShowForm(false);
          setEditingTemplate(null);
        }}
      />
    );
  }

  const globalTemplates = templates.filter((t) => t.scope === "global");
  const deptGroups = {};
  templates
    .filter((t) => t.scope !== "global")
    .forEach((t) => {
      const key = t.department || "Unassigned";
      (deptGroups[key] = deptGroups[key] || []).push(t);
    });

  function renderCard(t) {
    const scopeBadge =
      t.scope === "global" ? (
        <span className="badge badge-global">Global default</span>
      ) : t.scope === "department" ? (
        <span className="badge badge-dept">All of {t.department}</span>
      ) : (
        <span className="badge badge-specific">{t.designation}</span>
      );
    return (
      <div className="template-card" key={t.id}>
        <div className="template-card-head">
          <div className="template-card-name">{t.name}</div>
          <div className="template-card-actions">
            <button className="icon-btn" title="Edit" onClick={() => openEdit(t)}>
              <Pencil size={14} />
            </button>
            <button className="icon-btn danger" title="Delete" onClick={() => onDeleteTemplate(t.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="template-card-meta">{scopeBadge}</div>
        <div className="template-card-snippet">{stripHtml(t.content).slice(0, 140)}…</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Templates</div>
          <div className="panel-desc" style={{ marginBottom: 0 }}>
            Add a template for each department or designation. The most specific match is used automatically when you generate a letter.
          </div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={15} /> Add template
        </button>
      </div>

      <div className="helper-note">
        <Info size={14} />
        <span>Offer letters can carry legal weight — have HR or legal review your template wording before sending it to candidates.</span>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state">
          <FileText size={32} />
          <p>No templates yet. Add one to start generating letters.</p>
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={15} /> Add template
          </button>
        </div>
      ) : (
        <>
          {globalTemplates.length > 0 && (
            <>
              <div className="template-group-title first">Global</div>
              {globalTemplates.map(renderCard)}
            </>
          )}
          {Object.keys(deptGroups).map((dept) => (
            <div key={dept}>
              <div className={`template-group-title${globalTemplates.length === 0 && dept === Object.keys(deptGroups)[0] ? " first" : ""}`}>{dept}</div>
              {deptGroups[dept].map(renderCard)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------------------------- Generate panel ---------------------------------- */

function GeneratePanel({ orgSettings, templates, form, onFormChange, manualTemplateId, onManualTemplateChange, departmentOptions, designationOptions, onReset }) {
  const { template: autoTemplate, matchType } = useMemo(
    () => findBestTemplate(templates, form.department, form.designation),
    [templates, form.department, form.designation]
  );
  const selectedTemplate = manualTemplateId ? templates.find((t) => t.id === manualTemplateId) || autoTemplate : autoTemplate;
  const effectiveMatchType = manualTemplateId && templates.find((t) => t.id === manualTemplateId) ? "Manually selected" : matchType;

  const locale = (orgSettings.currency || "₹") === "₹" ? "en-IN" : "en-US";
  const previewData = {
    prefix: form.prefix,
    candidateName: form.candidateName,
    department: form.department,
    designation: form.designation,
    joiningDateFormatted: formatDateLong(form.joiningDate),
    salaryFormatted: form.salary ? Number(form.salary).toLocaleString(locale) : "",
    salaryPeriod: form.salaryPeriod,
    currency: orgSettings.currency || "₹",
    orgName: orgSettings.orgName,
    todayDate: todayLong(),
  };

  const isComplete = form.candidateName && form.department && form.designation && form.joiningDate && form.salary;

  function handlePrint() {
    window.print();
  }

  function handleDownload() {
    const rendered = renderLetterContent(selectedTemplate, previewData);
    const page = `<div class="letter-page">${letterHeadHtml(orgSettings)}${rendered}</div>`;
    const doc = buildLetterDocument(`Offer Letter - ${form.candidateName || "Candidate"}`, page);
    downloadTextFile(`Offer Letter - ${form.candidateName || "candidate"}.html`, doc, "text/html");
  }

  return (
    <div className="generate-grid">
      <div className="panel no-print">
        <div className="panel-title">New offer</div>
        <div className="panel-desc">Fill in the candidate's details. The letter on the right updates as you type.</div>

        <div className="field-row">
          <div className="field" style={{ maxWidth: 110, flex: "0 0 110px" }}>
            <label className="field-label">Prefix</label>
            <select className="input" value={form.prefix} onChange={(e) => onFormChange({ prefix: e.target.value })}>
              <option>Mr.</option>
              <option>Ms.</option>
              <option>Mrs.</option>
              <option>Dr.</option>
              <option>Mx.</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Candidate name</label>
            <input className="input" type="text" placeholder="Ananya Sharma" value={form.candidateName} onChange={(e) => onFormChange({ candidateName: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label className="field-label">Department</label>
          <input className="input" list="dept-options-gen" type="text" placeholder="Engineering" value={form.department} onChange={(e) => onFormChange({ department: e.target.value })} />
          <datalist id="dept-options-gen">
            {departmentOptions.map((d) => (
              <option value={d} key={d} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label className="field-label">Designation</label>
          <input className="input" list="designation-options-gen" type="text" placeholder="Software Engineer" value={form.designation} onChange={(e) => onFormChange({ designation: e.target.value })} />
          <datalist id="designation-options-gen">
            {designationOptions.map((d) => (
              <option value={d} key={d} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label className="field-label">Joining date</label>
          <input className="input" type="date" value={form.joiningDate} onChange={(e) => onFormChange({ joiningDate: e.target.value })} />
        </div>

        <div className="field-row">
          <div className="field">
            <label className="field-label">Salary</label>
            <input className="input" type="number" min="0" placeholder="1200000" value={form.salary} onChange={(e) => onFormChange({ salary: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 140, flex: "0 0 140px" }}>
            <label className="field-label">Period</label>
            <select className="input" value={form.salaryPeriod} onChange={(e) => onFormChange({ salaryPeriod: e.target.value })}>
              <option value="per annum">per annum</option>
              <option value="per month">per month</option>
            </select>
          </div>
        </div>

        <div className="divider" />

        <div className="template-indicator">
          <div>
            Using: <strong>{selectedTemplate ? selectedTemplate.name : "No template available"}</strong>
          </div>
          <div style={{ color: "var(--ink-soft)", marginTop: 2 }}>{effectiveMatchType}</div>
        </div>

        <div className="field">
          <label className="field-label">Change template</label>
          <select className="input" value={manualTemplateId} onChange={(e) => onManualTemplateChange(e.target.value)}>
            <option value="">Auto ({matchType})</option>
            {templates.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button className="btn btn-seal" onClick={handlePrint} disabled={!selectedTemplate}>
            <Printer size={15} /> Print / Save as PDF
          </button>
          <button className="btn btn-ghost" onClick={handleDownload} disabled={!selectedTemplate}>
            <Download size={15} /> Download HTML
          </button>
          <button className="btn-text" onClick={onReset}>Reset form</button>
        </div>
        {!isComplete && <div className="field-hint">Fill in every field above before sending — placeholders stay visible in the letter until you do.</div>}
      </div>

      <LetterPreview orgSettings={orgSettings} template={selectedTemplate} data={previewData} watermarkText="Preview" />
    </div>
  );
}

/* ---------------------------------- Bulk generate panel ---------------------------------- */

function BulkGeneratePanel({
  orgSettings,
  templates,
  rows,
  templateId,
  onTemplateChange,
  onRowChange,
  onRowRemove,
  onAddEmptyRow,
  onAddRows,
  onClearAll,
  departmentOptions,
  designationOptions,
}) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;
  const locale = (orgSettings.currency || "₹") === "₹" ? "en-IN" : "en-US";

  const validRows = useMemo(
    () =>
      rows
        .filter((r) => r.candidateName.trim() && r.department.trim() && r.designation.trim() && r.joiningDate && r.salary)
        .map((r) => ({
          prefix: r.prefix,
          candidateName: r.candidateName.trim(),
          department: r.department.trim(),
          designation: r.designation.trim(),
          joiningDateFormatted: formatDateLong(r.joiningDate),
          salaryFormatted: Number(r.salary).toLocaleString(locale),
          salaryPeriod: r.salaryPeriod,
          currency: orgSettings.currency || "₹",
          orgName: orgSettings.orgName,
          todayDate: todayLong(),
        })),
    [rows, orgSettings, locale]
  );

  function handleCsvFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const mapped = (results.data || []).map(mapCsvRowToCandidate).filter(Boolean);
        onAddRows(mapped);
      },
    });
    e.target.value = "";
  }

  function handlePasteParse() {
    if (!pasteText.trim()) return;
    Papa.parse(pasteText.trim(), {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const mapped = (results.data || []).map(mapCsvRowToCandidate).filter(Boolean);
        onAddRows(mapped);
        setPasteText("");
        setShowPaste(false);
      },
    });
  }

  function handleDownloadTemplateCsv() {
    const csv = Papa.unparse([
      ["Prefix", "Name", "Department", "Designation", "Joining Date", "Salary", "Period"],
      ["Ms.", "Ananya Sharma", "Product", "Product Manager", "01/09/2026", "1200000", "per annum"],
    ]);
    downloadTextFile("candidate-list-template.csv", csv, "text/csv");
  }

  function handleDownloadCombined() {
    const pages = validRows
      .map((data) => `<div class="letter-page">${letterHeadHtml(orgSettings)}${renderLetterContent(selectedTemplate, data)}</div>`)
      .join("\n");
    const doc = buildLetterDocument("Offer Letters", pages);
    downloadTextFile(`Offer Letters - ${validRows.length} candidates.html`, doc, "text/html");
  }

  function handleDownloadIndividual() {
    validRows.forEach((data, i) => {
      setTimeout(() => {
        const page = `<div class="letter-page">${letterHeadHtml(orgSettings)}${renderLetterContent(selectedTemplate, data)}</div>`;
        const doc = buildLetterDocument(`Offer Letter - ${data.candidateName}`, page);
        downloadTextFile(`Offer Letter - ${data.candidateName || "candidate-" + (i + 1)}.html`, doc, "text/html");
      }, i * 350);
    });
  }

  return (
    <>
      <div className="panel no-print">
        <div className="panel-title">Bulk generate</div>
        <div className="panel-desc">Pick one template, add your candidate list, then generate every offer letter in one pass.</div>
        <div className="field" style={{ maxWidth: 420 }}>
          <label className="field-label">Template</label>
          <select className="input" value={templateId} onChange={(e) => onTemplateChange(e.target.value)}>
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel no-print" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title" style={{ fontSize: 15, marginBottom: 2 }}>
              Candidates
            </div>
            <div className="panel-desc" style={{ marginBottom: 0 }}>
              {rows.length === 0 ? "Add your candidate list to get started." : `${validRows.length} of ${rows.length} ready to generate.`}
            </div>
          </div>
        </div>

        <div className="bulk-toolbar" style={{ marginTop: 16 }}>
          <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
            <Upload size={15} /> Upload CSV
            <input type="file" accept=".csv" onChange={handleCsvFile} style={{ display: "none" }} />
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => setShowPaste((s) => !s)}>
            <Clipboard size={15} /> Paste rows
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleDownloadTemplateCsv}>
            <Download size={15} /> CSV template
          </button>
          <button type="button" className="btn btn-primary" onClick={onAddEmptyRow}>
            <Plus size={15} /> Add candidate
          </button>
          {rows.length > 0 && (
            <button type="button" className="btn-text" onClick={onClearAll}>
              Clear all
            </button>
          )}
        </div>

        {showPaste && (
          <div className="paste-box">
            <textarea
              className="input"
              rows={6}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Paste rows copied from Excel or Google Sheets, including a header row, e.g.\nName\tDepartment\tDesignation\tJoining Date\tSalary"}
            />
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handlePasteParse}>
                Add pasted rows
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setShowPaste(false);
                  setPasteText("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="empty-state">
            <Users size={32} />
            <p>No candidates yet. Upload a CSV, paste rows from a spreadsheet, or add them one by one.</p>
          </div>
        ) : (
          <div className="bulk-table-wrap">
            <table className="bulk-table">
              <thead>
                <tr>
                  <th>Prefix</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Joining date</th>
                  <th>Salary</th>
                  <th>Period</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <select className="input" value={r.prefix} onChange={(e) => onRowChange(r.id, { prefix: e.target.value })}>
                        <option>Mr.</option>
                        <option>Ms.</option>
                        <option>Mrs.</option>
                        <option>Dr.</option>
                        <option>Mx.</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className={`input${r.candidateName.trim() ? "" : " error"}`}
                        type="text"
                        placeholder="Full name"
                        value={r.candidateName}
                        onChange={(e) => onRowChange(r.id, { candidateName: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className={`input${r.department.trim() ? "" : " error"}`}
                        type="text"
                        list="dept-options-bulk"
                        value={r.department}
                        onChange={(e) => onRowChange(r.id, { department: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className={`input${r.designation.trim() ? "" : " error"}`}
                        type="text"
                        list="designation-options-bulk"
                        value={r.designation}
                        onChange={(e) => onRowChange(r.id, { designation: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className={`input${r.joiningDate ? "" : " error"}`}
                        type="date"
                        value={r.joiningDate}
                        onChange={(e) => onRowChange(r.id, { joiningDate: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className={`input${r.salary ? "" : " error"}`}
                        type="number"
                        min="0"
                        value={r.salary}
                        onChange={(e) => onRowChange(r.id, { salary: e.target.value })}
                      />
                    </td>
                    <td>
                      <select className="input" value={r.salaryPeriod} onChange={(e) => onRowChange(r.id, { salaryPeriod: e.target.value })}>
                        <option value="per annum">per annum</option>
                        <option value="per month">per month</option>
                      </select>
                    </td>
                    <td className="remove-cell">
                      <button className="icon-btn danger" title="Remove" onClick={() => onRowRemove(r.id)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="dept-options-bulk">
              {departmentOptions.map((d) => (
                <option value={d} key={d} />
              ))}
            </datalist>
            <datalist id="designation-options-bulk">
              {designationOptions.map((d) => (
                <option value={d} key={d} />
              ))}
            </datalist>
          </div>
        )}
      </div>

      {templateId && rows.length > 0 && validRows.length === 0 && (
        <div className="helper-note" style={{ marginTop: 20 }}>
          <Info size={14} />
          <span>Fill in every field for at least one candidate to generate letters — incomplete rows are outlined above.</span>
        </div>
      )}

      {templateId && validRows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="panel no-print" style={{ marginBottom: 20 }}>
            <div className="panel-title" style={{ fontSize: 15 }}>
              Ready to generate — {validRows.length} letter{validRows.length === 1 ? "" : "s"}
            </div>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-seal" onClick={() => window.print()}>
                <Printer size={15} /> Print all / Save as PDF
              </button>
              <button className="btn btn-ghost" onClick={handleDownloadCombined}>
                <Download size={15} /> Download combined HTML
              </button>
              <button className="btn btn-ghost" onClick={handleDownloadIndividual}>
                <Download size={15} /> Download separate files
              </button>
            </div>
            <div className="field-hint" style={{ marginTop: 10 }}>
              "Print all" produces one PDF with every letter as its own page. Separate files may prompt your browser to allow multiple downloads.
            </div>
          </div>

          {validRows.map((data, i) => (
            <BulkLetterPage key={i} index={i} total={validRows.length} orgSettings={orgSettings} template={selectedTemplate} data={data} />
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------------------------- App ---------------------------------- */

export default function App() {
  const [tab, setTab] = useState("generate");
  const [loading, setLoading] = useState(true);
  const [orgSettings, setOrgSettings] = useState({ orgName: "", logo: "", currency: "₹" });
  const [templates, setTemplates] = useState([]);
  const [savingOrg, setSavingOrg] = useState(false);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({
    prefix: "Mr.",
    candidateName: "",
    department: "",
    designation: "",
    joiningDate: "",
    salary: "",
    salaryPeriod: "per annum",
  });
  const [manualTemplateId, setManualTemplateId] = useState("");
  const [bulkCandidates, setBulkCandidates] = useState([]);
  const [bulkTemplateId, setBulkTemplateId] = useState("");

  useEffect(() => {
    const id = "offer-desk-font-link";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgRaw = await safeGet("org-settings", true);
        if (!cancelled && orgRaw) {
          try {
            const parsed = JSON.parse(orgRaw);
            setOrgSettings((prev) => ({ ...prev, ...parsed }));
          } catch (e) {}
        }
        const tplRaw = await safeGet("templates", true);
        let tpls = [];
        if (tplRaw) {
          try {
            tpls = JSON.parse(tplRaw);
          } catch (e) {
            tpls = [];
          }
        }
        if (!Array.isArray(tpls) || tpls.length === 0) {
          tpls = [defaultTemplate()];
          try {
            await window.storage.set("templates", JSON.stringify(tpls), true);
          } catch (e) {}
        }
        if (!cancelled) setTemplates(tpls);
      } catch (err) {
        if (!cancelled) setTemplates([defaultTemplate()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  function showNotice(text, isError) {
    setNotice({ text, isError: !!isError });
  }

  async function saveOrgSettings() {
    setSavingOrg(true);
    try {
      await window.storage.set("org-settings", JSON.stringify(orgSettings), true);
      showNotice("Organization details saved");
    } catch (e) {
      showNotice("Could not save — check your connection and try again", true);
    } finally {
      setSavingOrg(false);
    }
  }

  async function persistTemplates(next) {
    setTemplates(next);
    try {
      await window.storage.set("templates", JSON.stringify(next), true);
    } catch (e) {
      showNotice("Could not save template changes", true);
    }
  }

  function handleSaveTemplate(draft) {
    let next;
    if (draft.id && templates.some((t) => t.id === draft.id)) {
      next = templates.map((t) => (t.id === draft.id ? { ...draft, updatedAt: new Date().toISOString() } : t));
    } else {
      next = [...templates, { ...draft, id: uid(), updatedAt: new Date().toISOString() }];
    }
    persistTemplates(next);
    showNotice("Template saved");
  }

  function handleDeleteTemplate(id) {
    if (!window.confirm("Delete this template? This cannot be undone.")) return;
    persistTemplates(templates.filter((t) => t.id !== id));
    showNotice("Template deleted");
  }

  function handleResetForm() {
    setForm({
      prefix: "Mr.",
      candidateName: "",
      department: "",
      designation: "",
      joiningDate: "",
      salary: "",
      salaryPeriod: "per annum",
    });
    setManualTemplateId("");
  }

  function handleBulkRowChange(id, patch) {
    setBulkCandidates((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function handleBulkRowRemove(id) {
    setBulkCandidates((prev) => prev.filter((r) => r.id !== id));
  }

  function handleBulkAddEmptyRow() {
    setBulkCandidates((prev) => [
      ...prev,
      { id: uid(), prefix: "Mr.", candidateName: "", department: "", designation: "", joiningDate: "", salary: "", salaryPeriod: "per annum" },
    ]);
  }

  function handleBulkAddRows(newRows) {
    const valid = (newRows || []).filter(Boolean);
    if (valid.length === 0) {
      showNotice("No candidate rows found — check that your file has a Name column", true);
      return;
    }
    setBulkCandidates((prev) => [...prev, ...valid]);
    showNotice(`Added ${valid.length} candidate${valid.length === 1 ? "" : "s"}`);
  }

  function handleBulkClearAll() {
    if (!window.confirm("Remove all candidates from this list?")) return;
    setBulkCandidates([]);
  }

  const departmentOptions = useMemo(
    () => Array.from(new Set(templates.map((t) => t.department).filter(Boolean))),
    [templates]
  );
  const designationOptions = useMemo(
    () => Array.from(new Set(templates.map((t) => t.designation).filter(Boolean))),
    [templates]
  );

  return (
    <div className="app-shell">
      <style>{STYLES}</style>

      <header className="app-header no-print">
        <div className="brand">
          <div className="brand-mark">OD</div>
          <div>
            <div className="brand-name">Offer Desk</div>
            <div className="brand-tag">{orgSettings.orgName || "Offer letters, made consistent"}</div>
          </div>
        </div>
        <nav className="tab-bar">
          <TabButton active={tab === "organization"} onClick={() => setTab("organization")}>Organization</TabButton>
          <TabButton active={tab === "templates"} onClick={() => setTab("templates")}>Templates</TabButton>
          <TabButton active={tab === "generate"} onClick={() => setTab("generate")}>New Offer</TabButton>
          <TabButton active={tab === "bulk"} onClick={() => setTab("bulk")}>Bulk Generate</TabButton>
        </nav>
      </header>

      {notice && <div className={`toast no-print${notice.isError ? " toast-error" : ""}`}>{notice.text}</div>}

      <main className="app-main">
        {loading ? (
          <div className="loading-state no-print">
            <Loader2 size={18} className="spin" /> Loading your saved data…
          </div>
        ) : (
          <>
            {tab === "organization" && (
              <OrganizationPanel
                value={orgSettings}
                onChange={(patch) => setOrgSettings((prev) => ({ ...prev, ...patch }))}
                onSave={saveOrgSettings}
                saving={savingOrg}
              />
            )}
            {tab === "templates" && (
              <TemplatesPanel
                templates={templates}
                orgSettings={orgSettings}
                onSaveTemplate={handleSaveTemplate}
                onDeleteTemplate={handleDeleteTemplate}
                departmentOptions={departmentOptions}
                designationOptions={designationOptions}
              />
            )}
            {tab === "generate" && (
              <GeneratePanel
                orgSettings={orgSettings}
                templates={templates}
                form={form}
                onFormChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                manualTemplateId={manualTemplateId}
                onManualTemplateChange={setManualTemplateId}
                departmentOptions={departmentOptions}
                designationOptions={designationOptions}
                onReset={handleResetForm}
              />
            )}
            {tab === "bulk" && (
              <BulkGeneratePanel
                orgSettings={orgSettings}
                templates={templates}
                rows={bulkCandidates}
                templateId={bulkTemplateId}
                onTemplateChange={setBulkTemplateId}
                onRowChange={handleBulkRowChange}
                onRowRemove={handleBulkRowRemove}
                onAddEmptyRow={handleBulkAddEmptyRow}
                onAddRows={handleBulkAddRows}
                onClearAll={handleBulkClearAll}
                departmentOptions={departmentOptions}
                designationOptions={designationOptions}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
