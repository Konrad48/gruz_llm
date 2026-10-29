export interface HighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function normalizeText(text: string) {
  let value = "";
  const offsets: number[] = [];
  let offset = 0;
  for (const character of text) {
    const normalized = character.normalize("NFKC").toLocaleLowerCase();
    for (const part of normalized) {
      if (/[\p{L}\p{N}]/u.test(part)) {
        value += part;
        for (let i = 0; i < part.length; i++) offsets.push(offset);
      }
    }
    offset += character.length;
  }
  return { value, offsets };
}

export function matchCitation(
  text: string,
  excerpt: string,
): { start: number; end: number; partial: boolean } | null {
  const haystack = normalizeText(text),
    needle = normalizeText(excerpt).value;
  if (!needle) return null;
  const full = haystack.value.indexOf(needle);
  if (full >= 0)
    return {
      start: haystack.offsets[full],
      end: haystack.offsets[full + needle.length - 1] + 1,
      partial: false,
    };
  // Text extraction order can differ across PDF engines. Require a substantial
  // exact phrase instead of highlighting an unrelated approximate match.
  for (const size of [160, 96, 48, 24]) {
    if (needle.length < size) continue;
    for (
      let start = 0;
      start <= needle.length - size;
      start += Math.max(12, Math.floor(size / 2))
    ) {
      const found = haystack.value.indexOf(needle.slice(start, start + size));
      if (found >= 0)
        return {
          start: haystack.offsets[found],
          end: haystack.offsets[found + size - 1] + 1,
          partial: true,
        };
    }
  }
  return null;
}

export function citationBoxes(root: HTMLElement, excerpt: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-no-highlight]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = "",
    node: Node | null;
  while ((node = walker.nextNode())) {
    const start = text.length;
    text += node.textContent || "";
    nodes.push({ node: node as Text, start, end: text.length });
  }
  const match = matchCitation(text, excerpt);
  if (!match) return { boxes: [] as HighlightBox[], partial: false };
  const parent = root.getBoundingClientRect(),
    boxes: HighlightBox[] = [];
  for (const item of nodes) {
    const start = Math.max(match.start, item.start),
      end = Math.min(match.end, item.end);
    if (start >= end) continue;
    const range = document.createRange();
    range.setStart(item.node, start - item.start);
    range.setEnd(item.node, end - item.start);
    for (const rect of Array.from(range.getClientRects()))
      if (rect.width > 0 && rect.height > 0)
        boxes.push({
          left: rect.left - parent.left + root.scrollLeft,
          top: rect.top - parent.top + root.scrollTop,
          width: rect.width,
          height: rect.height,
        });
  }
  return { boxes, partial: match.partial };
}
