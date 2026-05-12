/** remark plugin: convert [[Title]] inside text nodes into link nodes
 *  whose URL uses our internal `lyst-note:` scheme. The MDEditor preview
 *  pairs this with a custom `a` renderer that resolves the title to a
 *  note id at click-time and navigates. */
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;

export function remarkWikilinks() {
  // The plugin returns a transformer over the mdast root.
  return (tree: any) => {
    walk(tree);
  };
}

function walk(node: any): void {
  if (!node || !Array.isArray(node.children)) return;
  const out: any[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('[[')) {
      out.push(...splitText(child.value));
    } else {
      walk(child);
      out.push(child);
    }
  }
  node.children = out;
}

function splitText(value: string): any[] {
  const out: any[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(value)) !== null) {
    if (m.index > lastIdx) {
      out.push({ type: 'text', value: value.slice(lastIdx, m.index) });
    }
    const title = m[1].trim();
    out.push({
      type: 'link',
      url: `lyst-note:${encodeURIComponent(title)}`,
      children: [{ type: 'text', value: title }],
    });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < value.length) {
    out.push({ type: 'text', value: value.slice(lastIdx) });
  }
  return out;
}

export const WIKILINK_URL_PREFIX = 'lyst-note:';
export function parseWikilinkUrl(url: string | undefined): string | null {
  if (!url || !url.startsWith(WIKILINK_URL_PREFIX)) return null;
  try {
    return decodeURIComponent(url.slice(WIKILINK_URL_PREFIX.length));
  } catch {
    return null;
  }
}
