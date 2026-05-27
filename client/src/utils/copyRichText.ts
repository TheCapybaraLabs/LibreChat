/**
 * Build a Word/Docs-friendly HTML payload from a rendered `.message-content`
 * element. Strips chrome (code-block headers, copy buttons), expands soft
 * newlines into `<br>`, and replaces KaTeX with LaTeX text (`$…$` / `$$…$$`),
 * which is the lowest-common-denominator math format across Word, Docs and
 * Gmail.
 */
export function buildRichTextHtml(rootEl: HTMLElement): string {
  const clones = Array.from(rootEl.querySelectorAll<HTMLElement>('.message-content')).map(
    (el) => el.cloneNode(true) as HTMLElement,
  );
  if (clones.length === 0) {
    return '';
  }

  for (const clone of clones) {
    replaceCodeBlocks(clone);
    expandSoftNewlines(clone);
    replaceKatex(clone);
    stripButtons(clone);
  }

  return clones.map((c) => c.innerHTML).join('<br>');
}

function replaceCodeBlocks(root: HTMLElement): void {
  const wrappers = Array.from(root.querySelectorAll<HTMLElement>('.rounded-md.bg-gray-900'));
  for (const wrapper of wrappers) {
    if (!wrapper.parentNode) continue;
    const code = wrapper.querySelector('code');
    const text = (code?.textContent ?? wrapper.textContent ?? '').trim();

    const pre = document.createElement('pre');
    pre.setAttribute(
      'style',
      'white-space: pre-wrap; font-family: Consolas, "Courier New", monospace; ' +
        'background: #f5f5f5; padding: 8px; border-radius: 4px;',
    );

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      pre.appendChild(document.createTextNode(lines[i]));
      if (i < lines.length - 1) pre.appendChild(document.createElement('br'));
    }

    wrapper.parentNode.replaceChild(pre, wrapper);
  }
}

function expandSoftNewlines(root: HTMLElement): void {
  const skipTags = new Set(['math', 'pre', 'code']);
  const targets = Array.from(root.querySelectorAll<HTMLElement>('.whitespace-pre-wrap'));
  for (const target of targets) {
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        let parent: Node | null = node.parentNode;
        while (parent && parent !== target) {
          if (skipTags.has(parent.nodeName.toLowerCase())) return NodeFilter.FILTER_REJECT;
          parent = parent.parentNode;
        }
        return (node.nodeValue ?? '').includes('\n')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    for (const node of textNodes) {
      const segments = (node.nodeValue ?? '').split('\n');
      const frag = document.createDocumentFragment();
      for (let i = 0; i < segments.length; i++) {
        frag.appendChild(document.createTextNode(segments[i]));
        if (i < segments.length - 1) frag.appendChild(document.createElement('br'));
      }
      node.parentNode?.replaceChild(frag, node);
    }
  }
}

function replaceKatex(root: HTMLElement): void {
  const katexEls = Array.from(root.querySelectorAll<HTMLElement>('.katex'));
  for (const katex of katexEls) {
    const display = katex.closest<HTMLElement>('.katex-display');
    const outer = display ?? katex;
    if (!outer.parentNode) continue;

    const annotation = katex.querySelector<HTMLElement>('annotation[encoding="application/x-tex"]');
    const latex = annotation?.textContent?.trim();
    if (latex) {
      const delim = display ? '$$' : '$';
      outer.parentNode.replaceChild(document.createTextNode(`${delim}${latex}${delim}`), outer);
      continue;
    }

    const fallback = katex.querySelector<HTMLElement>('.katex-mathml')?.textContent?.trim() ?? '';
    outer.parentNode.replaceChild(document.createTextNode(fallback), outer);
  }
}

function stripButtons(root: HTMLElement): void {
  const buttons = Array.from(root.querySelectorAll('button'));
  for (const btn of buttons) btn.parentNode?.removeChild(btn);
}
