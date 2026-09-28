// Syntax themes for Expressive Code, built from the brand rather than borrowed.
// Four roles only -- ink for plain text, the logo orange for commands and
// literals, one teal for strings, gray for comments -- because a code block is
// read, not decorated. Every colour clears 5:1 on its background.
//
// The background is the page's own paper (--bk-code-bg in custom.css is the
// same value): a code block is set apart by its frame and orange edge, not by
// a grey fill. It must match, because Expressive Code checks token contrast
// against the theme's own background at build time and would otherwise
// "correct" colours against the wrong surface.

const roles = (c) => [
  {
    scope: ['comment', 'punctuation.definition.comment'],
    settings: { foreground: c.comment },
  },
  {
    scope: ['string', 'string.quoted', 'punctuation.definition.string', 'string.unquoted.argument'],
    settings: { foreground: c.teal },
  },
  {
    scope: [
      'entity.name.command',
      'entity.name.function',
      'support.function',
      'support.function.builtin',
      'keyword',
      'storage',
      'constant.numeric',
      'constant.language',
      'constant.character',
    ],
    settings: { foreground: c.orange },
  },
  {
    scope: ['support.type.property-name', 'meta.object-literal.key', 'variable', 'variable.parameter'],
    settings: { foreground: c.text },
  },
  {
    scope: ['punctuation', 'meta.brace', 'keyword.operator', 'keyword.operator.list'],
    settings: { foreground: c.punct },
  },
];

const make = (name, type, c) => ({
  name,
  type,
  colors: { 'editor.background': c.bg, 'editor.foreground': c.text },
  tokenColors: roles(c),
});

export const bukmarkLight = make('bukmark-light', 'light', {
  bg: '#fbf7f3',
  text: '#0e0f13',
  orange: '#b1300c',
  teal: '#0b5c66',
  comment: '#5d5853',
  punct: '#46413d',
});

export const bukmarkDark = make('bukmark-dark', 'dark', {
  bg: '#100c0b',
  text: '#efeae4',
  orange: '#ff7d55',
  teal: '#6fcfc3',
  comment: '#a59e97',
  punct: '#c2bbb4',
});
