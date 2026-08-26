import { parse, parseFragment } from 'parse5';
import { SaxesParser } from 'saxes';

function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) visit(child, callback);
  if (node.content) visit(node.content, callback);
}

export function parseXml(source) {
  return new SaxesParser({ xmlns: true }).write(source).close();
}

export function extractSvgs(markup, fragment = false) {
  const document = fragment
    ? parseFragment(markup, { sourceCodeLocationInfo: true })
    : parse(markup, { sourceCodeLocationInfo: true });
  const direct = [];
  const srcdocs = [];

  visit(document, (node) => {
    if (node.tagName === 'svg' && node.sourceCodeLocation) {
      direct.push(markup.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset));
    }
    const srcdoc = node.attrs?.find((attribute) => attribute.name === 'srcdoc');
    if (srcdoc) srcdocs.push(srcdoc.value);
  });

  return {
    direct,
    embedded: srcdocs.flatMap((srcdoc) => {
      const nested = extractSvgs(srcdoc, true);
      return [...nested.direct, ...nested.embedded];
    }),
  };
}
