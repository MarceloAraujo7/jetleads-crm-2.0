/**
 * Bridges the wizard's friendly `[nome]`/`[loja]` variable syntax to
 * Meta's positional `{{1}}`/`{{2}}` syntax, which is the only form
 * Meta's API ever accepts (see template-validators.ts /
 * template-components.ts — both untouched, they still only know
 * `{{N}}`). This module is UI-facing only: it never talks to Meta.
 *
 * Body and header each have their own independent numbering (Meta
 * rule — a header can only ever reference `{{1}}`), so every function
 * here operates on one text field + its own ordered name list at a
 * time, mirroring the existing `sample_values`/`variable_names`
 * column shape of `{body: string[], header: string[]}`.
 */

const NAMED_VAR_RE = /\[([a-zA-Z0-9_]+)\]/g;

/** Friendly names found in `text`, in order of first appearance, deduplicated. */
export function extractNamedVariables(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(NAMED_VAR_RE)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/** `"Oi [nome], bem-vindo à [loja]"` + `["nome","loja"]` → `"Oi {{1}}, bem-vindo à {{2}}"`. */
export function namedToPositional(text: string, orderedNames: string[]): string {
  return text.replace(NAMED_VAR_RE, (match, name: string) => {
    const index = orderedNames.indexOf(name);
    return index === -1 ? match : `{{${index + 1}}}`;
  });
}

/** Inverse of `namedToPositional` — used to redisplay a saved template for editing. */
export function positionalToNamed(text: string, orderedNames: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (match, n: string) => {
    const name = orderedNames[Number(n) - 1];
    return name ? `[${name}]` : match;
  });
}
