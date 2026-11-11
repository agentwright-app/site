// Build-time syntax highlighting (no JavaScript shipped to the reader).
// `hl(code, lang)` returns escaped HTML with hljs-* spans; HL_CSS colours them in both themes.
import hljs from "highlight.js/lib/common";

const ALIAS = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", sh: "bash", shell: "bash", yml: "yaml", text: "plaintext", txt: "plaintext" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function hl(code, lang = "") {
  const name = ALIAS[lang] ?? lang;
  if (!name || name === "plaintext" || !hljs.getLanguage(name)) return esc(code);
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return esc(code);
  }
}

/** A marked extension: fenced code blocks with a known language are highlighted. */
export const markedHighlight = {
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0];
      const cls = language ? ` class="language-${esc(language)}"` : "";
      return `<pre><code${cls}>${hl(text, language)}</code></pre>\n`;
    },
  },
};

// Token colours: readable on the light card (#FFFFFF) and the dark card (#1C1917).
export const HL_CSS = `
.hljs-comment,.hljs-quote{color:#78716C;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-meta .hljs-keyword{color:#9A3412}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute{color:#166534}
.hljs-number,.hljs-symbol,.hljs-bullet{color:#1D4ED8}
.hljs-title,.hljs-title.function_,.hljs-title.class_,.hljs-section{color:#6D28D9}
.hljs-built_in,.hljs-type,.hljs-params .hljs-type{color:#0E7490}
.hljs-meta,.hljs-deletion{color:#B91C1C}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .hljs-comment,:root:not([data-theme="light"]) .hljs-quote{color:#A8A29E}
:root:not([data-theme="light"]) .hljs-keyword,:root:not([data-theme="light"]) .hljs-selector-tag,:root:not([data-theme="light"]) .hljs-literal,:root:not([data-theme="light"]) .hljs-meta .hljs-keyword{color:#FDBA74}
:root:not([data-theme="light"]) .hljs-string,:root:not([data-theme="light"]) .hljs-regexp,:root:not([data-theme="light"]) .hljs-addition,:root:not([data-theme="light"]) .hljs-attribute{color:#86EFAC}
:root:not([data-theme="light"]) .hljs-number,:root:not([data-theme="light"]) .hljs-symbol,:root:not([data-theme="light"]) .hljs-bullet{color:#93C5FD}
:root:not([data-theme="light"]) .hljs-title,:root:not([data-theme="light"]) .hljs-title.function_,:root:not([data-theme="light"]) .hljs-title.class_,:root:not([data-theme="light"]) .hljs-section{color:#C4B5FD}
:root:not([data-theme="light"]) .hljs-built_in,:root:not([data-theme="light"]) .hljs-type{color:#67E8F9}
:root:not([data-theme="light"]) .hljs-meta,:root:not([data-theme="light"]) .hljs-deletion{color:#FCA5A5}}
:root[data-theme="dark"] .hljs-comment,:root[data-theme="dark"] .hljs-quote{color:#A8A29E}
:root[data-theme="dark"] .hljs-keyword,:root[data-theme="dark"] .hljs-selector-tag,:root[data-theme="dark"] .hljs-literal,:root[data-theme="dark"] .hljs-meta .hljs-keyword{color:#FDBA74}
:root[data-theme="dark"] .hljs-string,:root[data-theme="dark"] .hljs-regexp,:root[data-theme="dark"] .hljs-addition,:root[data-theme="dark"] .hljs-attribute{color:#86EFAC}
:root[data-theme="dark"] .hljs-number,:root[data-theme="dark"] .hljs-symbol,:root[data-theme="dark"] .hljs-bullet{color:#93C5FD}
:root[data-theme="dark"] .hljs-title,:root[data-theme="dark"] .hljs-title.function_,:root[data-theme="dark"] .hljs-title.class_,:root[data-theme="dark"] .hljs-section{color:#C4B5FD}
:root[data-theme="dark"] .hljs-built_in,:root[data-theme="dark"] .hljs-type{color:#67E8F9}
:root[data-theme="dark"] .hljs-meta,:root[data-theme="dark"] .hljs-deletion{color:#FCA5A5}
`;
