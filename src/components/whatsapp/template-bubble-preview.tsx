"use client";

import { FileText, Film, File as FileIcon, Reply, ExternalLink, Phone, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateButton } from "@/types";
import { useTranslations } from "next-intl";

/**
 * Substitutes both variable notations that can reach this preview:
 * Meta's positional `{{1}}`/`{{2}}` (what a saved template's body_text
 * actually stores, e.g. when the template list previews an existing
 * template) and the wizard's friendly `[name]` syntax (what the
 * editor's live textarea holds while a template is being authored —
 * see template-variable-names.ts). `samples` is ordered to match
 * each: positionally for `{{n}}`, and by first-appearance order for
 * `[name]` (mirroring extractNamedVariables's dedup order), so a name
 * reused later in the text still resolves to its first index instead
 * of being treated as a new, unmapped variable.
 */
function renderWithSamples(text: string, samples: string[]): string {
  const seenNames: string[] = [];
  return text.replace(/\{\{(\d+)\}\}|\[([a-zA-Z0-9_]+)\]/g, (match, position?: string, name?: string) => {
    let index: number;
    if (position !== undefined) {
      index = Number(position) - 1;
    } else {
      index = seenNames.indexOf(name!);
      if (index === -1) {
        index = seenNames.length;
        seenNames.push(name!);
      }
    }
    const value = samples[index];
    return value?.trim() ? value : match;
  });
}

interface TemplateBubblePreviewProps {
  headerType?: "text" | "image" | "video" | "document";
  headerContent?: string;
  headerMediaUrl?: string;
  headerSamples?: string[];
  bodyText?: string;
  bodySamples?: string[];
  footerText?: string;
  buttons?: TemplateButton[];
  className?: string;
}

const BUTTON_ICON: Record<TemplateButton["type"], typeof Reply> = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  COPY_CODE: Copy,
};

export function TemplateBubblePreview({
  headerType,
  headerContent,
  headerMediaUrl,
  headerSamples = [],
  bodyText = "",
  bodySamples = [],
  footerText,
  buttons = [],
  className,
}: TemplateBubblePreviewProps) {
  const t = useTranslations("Settings.templates.preview");

  return (
    <div className={cn("overflow-hidden rounded-xl bg-card-2", className)}>
      {headerType === "text" && headerContent && (
        <p className="px-3 pt-2.5 text-sm font-semibold text-foreground">
          {renderWithSamples(headerContent, headerSamples)}
        </p>
      )}
      {headerType === "image" && (
        headerMediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={headerMediaUrl} alt="" className="h-32 w-full object-cover" />
        ) : (
          <div className="flex h-24 flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
            <FileText className="size-6" />
            <span className="text-[11px]">{t("imagePlaceholder")}</span>
          </div>
        )
      )}
      {headerType === "video" && (
        <div className="flex h-24 items-center justify-center bg-muted text-muted-foreground">
          <Film className="size-6" />
        </div>
      )}
      {headerType === "document" && (
        <div className="flex h-14 items-center gap-2 bg-muted px-3 text-muted-foreground">
          <FileIcon className="size-5" />
          <span className="text-xs">{t("documentPlaceholder")}</span>
        </div>
      )}

      <div className="px-3 py-2.5">
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {bodyText ? (
            renderWithSamples(bodyText, bodySamples)
          ) : (
            <span className="text-muted-foreground">{t("bodyPlaceholder")}</span>
          )}
        </p>
        {footerText && <p className="mt-1 text-xs text-muted-foreground">{footerText}</p>}
      </div>

      {buttons.length > 0 && (
        <div className="border-t border-border/60">
          {buttons.map((btn, i) => {
            const Icon = BUTTON_ICON[btn.type];
            const isCta = btn.type === "URL" || btn.type === "PHONE_NUMBER";
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium",
                  isCta ? "text-primary" : "text-foreground",
                  i > 0 && "border-t border-border/60",
                )}
              >
                <Icon className="size-3.5" />
                <span className="truncate">{btn.text || t("untitledButton")}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
