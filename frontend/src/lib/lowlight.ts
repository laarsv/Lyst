/** Single lowlight instance for the TipTap CodeBlockLowlight extension.
 *
 *  Registers the languages we ship by name (the user types `js` or
 *  `javascript` after the opening fence and lowlight tokenises with that
 *  grammar). Anything else falls through as plain text — TipTap's default
 *  language picker also limits the dropdown to these names.
 *
 *  Themed via `highlight.js/styles/atom-one-light.css` / `atom-one-dark.css`
 *  (imported in `index.css`) so each `hljs-*` class lights up the right
 *  colour per token without us inventing a palette.
 */
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';

export const lowlight = createLowlight();

lowlight.register('javascript', javascript);
lowlight.register('js', javascript);
lowlight.register('typescript', typescript);
lowlight.register('ts', typescript);
lowlight.register('python', python);
lowlight.register('py', python);
lowlight.register('bash', bash);
lowlight.register('sh', bash);
lowlight.register('shell', bash);
lowlight.register('json', json);
lowlight.register('yaml', yaml);
lowlight.register('yml', yaml);
lowlight.register('sql', sql);
lowlight.register('css', css);
// highlight.js exposes the HTML grammar under `xml` — register both
// aliases so users can fence with either.
lowlight.register('html', xml);
lowlight.register('xml', xml);

/** Languages exposed by the toolbar's code-block language picker. Same
 *  order the user typically thinks in (most-used first). */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: '', label: 'Klartext' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'sql', label: 'SQL' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
];
