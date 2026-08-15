"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  Upload,
  Plus,
  X,
  Trash2,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from "@/lib/whatsapp/template-validators";
import {
  extractNamedVariables,
  namedToPositional,
  positionalToNamed,
} from "@/lib/whatsapp/template-variable-names";
import {
  COUNTRY_CODES,
  splitPhoneNumber,
  combinePhoneNumber,
} from "@/lib/whatsapp/phone-country-codes";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { TemplateBubblePreview } from "@/components/whatsapp/template-bubble-preview";
import type { MessageTemplate, TemplateButton, TemplateSampleValues } from "@/types";
import { useTranslations } from "next-intl";

type Category = MessageTemplate["category"];
type HeaderFormat = "none" | "text" | "image" | "video" | "document";

const CATEGORIES: Category[] = ["Marketing", "Utility", "Authentication"];
const HEADER_FORMATS: HeaderFormat[] = ["none", "text", "image", "video", "document"];
const COMMON_LANGUAGES = ["pt_BR", "en_US", "es_ES", "es_MX", "en_GB", "fr_FR", "de", "it"];

function emptyButton(type: TemplateButton["type"]): TemplateButton {
  switch (type) {
    case "QUICK_REPLY":
      return { type: "QUICK_REPLY", text: "" };
    case "URL":
      return { type: "URL", text: "", url: "" };
    case "PHONE_NUMBER":
      return { type: "PHONE_NUMBER", text: "", phone_number: `+${COUNTRY_CODES[0].digits}` };
    case "COPY_CODE":
      return { type: "COPY_CODE", text: "", example: "" };
  }
}

interface TemplateWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this template — locks name/language once it's been
   *  submitted to Meta (has meta_template_id). */
  template?: MessageTemplate | null;
  /** Prefill from this template's fields but save as a brand-new one
   *  (name blanked, never touches the original's Meta submission). */
  duplicateFrom?: MessageTemplate | null;
  onSaved: () => void;
  onDeleted: () => void;
}

const STEP_KEYS = ["identification", "header", "content", "buttons", "review"] as const;

export function TemplateWizardDialog({
  open,
  onOpenChange,
  template,
  duplicateFrom,
  onSaved,
  onDeleted,
}: TemplateWizardDialogProps) {
  const t = useTranslations("Settings.templates.wizard");
  const source = template ?? duplicateFrom ?? null;
  const isEditingSubmitted = Boolean(template?.meta_template_id);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("Marketing");
  const [language, setLanguage] = useState("pt_BR");

  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>("none");
  const [headerContent, setHeaderContent] = useState("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [headerSample, setHeaderSample] = useState("");
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);

  const [bodyText, setBodyText] = useState("");
  const [bodySamplesByName, setBodySamplesByName] = useState<Record<string, string>>({});
  const [footerText, setFooterText] = useState("");

  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [nextButtonKind, setNextButtonKind] = useState<"QUICK_REPLY" | "URL" | "PHONE_NUMBER">(
    "QUICK_REPLY",
  );

  const [isDefault, setIsDefault] = useState(false);
  const [submitNow, setSubmitNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setConfirmDelete(false);

    if (source) {
      const isDup = !template && Boolean(duplicateFrom);
      const bodyVarNames =
        source.variable_names?.body?.length === extractVariableIndices(source.body_text).length
          ? source.variable_names.body
          : extractVariableIndices(source.body_text).map((i) => `variavel_${i}`);
      const headerCount = source.header_type === "text" ? extractVariableIndices(source.header_content ?? "").length : 0;
      const headerVarNames =
        source.variable_names?.header?.length === headerCount
          ? source.variable_names.header
          : Array.from({ length: headerCount }, (_, i) => `variavel_${i + 1}`);

      setName(isDup ? `${source.name}_copia` : source.name);
      setCategory(source.category);
      setLanguage(source.language || "pt_BR");
      setHeaderFormat((source.header_type as HeaderFormat) ?? "none");
      setHeaderContent(
        source.header_type === "text"
          ? positionalToNamed(source.header_content ?? "", headerVarNames)
          : "",
      );
      setHeaderMediaUrl(source.header_media_url ?? "");
      setHeaderSample(source.sample_values?.header?.[0] ?? "");
      setBodyText(positionalToNamed(source.body_text, bodyVarNames));
      const samples: Record<string, string> = {};
      bodyVarNames.forEach((n, i) => {
        samples[n] = source.sample_values?.body?.[i] ?? "";
      });
      setBodySamplesByName(samples);
      setFooterText(source.footer_text ?? "");
      setButtons(source.buttons ?? []);
      setIsDefault(isDup ? false : (source.is_default_for_broadcasts ?? false));
      setSubmitNow(true);
    } else {
      setName("");
      setCategory("Marketing");
      setLanguage("pt_BR");
      setHeaderFormat("none");
      setHeaderContent("");
      setHeaderMediaUrl("");
      setHeaderSample("");
      setBodyText("");
      setBodySamplesByName({});
      setFooterText("");
      setButtons([]);
      setIsDefault(false);
      setSubmitNow(true);
    }
  }, [open, template, duplicateFrom, source]);

  const bodyVarNames = useMemo(() => extractNamedVariables(bodyText), [bodyText]);
  const headerVarNames = useMemo(
    () => (headerFormat === "text" ? extractNamedVariables(headerContent).slice(0, 1) : []),
    [headerFormat, headerContent],
  );

  const steps = STEP_KEYS.map((key) => ({ key, label: t(`steps.${key}`) }));

  const nameValid = TEMPLATE_LIMITS.nameRegex.test(name);
  const step1Valid = nameValid && language.trim().length > 0;
  const step2Valid =
    headerFormat === "none" ||
    (headerFormat === "text" && headerContent.trim().length > 0) ||
    (headerFormat !== "text" && headerMediaUrl.trim().length > 0);
  const step3Valid =
    bodyText.trim().length > 0 && bodyVarNames.every((n) => bodySamplesByName[n]?.trim());
  const stepValid = [step1Valid, step2Valid, step3Valid, true, true][step];

  function insertBodyVariable() {
    const nextName = `variavel_${bodyVarNames.length + 1}`;
    setBodyText((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}[${nextName}]`);
  }

  function insertHeaderVariable() {
    if (headerVarNames.length > 0) return;
    setHeaderContent((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}[loja]`);
  }

  async function handleHeaderImageFile(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast.error(t("toastInvalidImage"));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(t("toastImageTooLarge", { size: (file.size / 1024 / 1024).toFixed(1) }));
      return;
    }
    setUploadingHeader(true);
    try {
      const { publicUrl } = await uploadAccountMedia("chat-media", file);
      setHeaderMediaUrl(publicUrl);
      toast.success(t("toastUploadSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastUploadFailed"));
    } finally {
      setUploadingHeader(false);
    }
  }

  function addButton() {
    if (buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) return;
    setButtons((prev) => [...prev, emptyButton(nextButtonKind)]);
  }

  function removeButton(index: number) {
    setButtons((prev) => prev.filter((_, i) => i !== index));
  }

  type ButtonPatch = { text?: string; url?: string; phone_number?: string; example?: string };
  function updateButton(index: number, patch: ButtonPatch) {
    setButtons((prev) => {
      const current = prev[index];
      if (!current) return prev;
      const next = [...prev];
      switch (current.type) {
        case "QUICK_REPLY":
          next[index] = { ...current, ...(patch.text !== undefined && { text: patch.text }) };
          break;
        case "URL":
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case "PHONE_NUMBER":
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && { phone_number: patch.phone_number }),
          };
          break;
        case "COPY_CODE":
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
      }
      return next;
    });
  }

  function toggleUrlDynamic(index: number, dynamic: boolean) {
    const btn = buttons[index];
    if (btn.type !== "URL") return;
    const base = btn.url.replace(/\{\{1\}\}$/, "").replace(/\s+$/, "");
    updateButton(index, { url: dynamic ? `${base}{{1}}` : base, example: dynamic ? btn.example : "" });
  }

  function buildPayload() {
    const bodyPositional = namedToPositional(bodyText, bodyVarNames);
    const headerPositional =
      headerFormat === "text" ? namedToPositional(headerContent, headerVarNames) : undefined;

    const sample_values: TemplateSampleValues = {};
    if (bodyVarNames.length > 0) {
      sample_values.body = bodyVarNames.map((n) => bodySamplesByName[n]?.trim() ?? "");
    }
    if (headerVarNames.length > 0 && headerSample.trim()) {
      sample_values.header = [headerSample.trim()];
    }

    const variable_names: TemplateSampleValues = {};
    if (bodyVarNames.length > 0) variable_names.body = bodyVarNames;
    if (headerVarNames.length > 0) variable_names.header = headerVarNames;

    return {
      name: name.trim(),
      category,
      language: language.trim(),
      header_type: headerFormat === "none" ? undefined : headerFormat,
      header_content: headerFormat === "text" ? headerPositional?.trim() : undefined,
      header_media_url:
        headerFormat !== "none" && headerFormat !== "text" ? headerMediaUrl.trim() || undefined : undefined,
      body_text: bodyPositional.trim(),
      footer_text: footerText.trim() || undefined,
      buttons: buttons.length > 0 ? buttons : undefined,
      sample_values: Object.keys(sample_values).length > 0 ? sample_values : undefined,
      variable_names: Object.keys(variable_names).length > 0 ? variable_names : undefined,
      is_default_for_broadcasts: isDefault,
      submitNow: isEditingSubmitted ? true : submitNow,
    };
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const isEdit = isEditingSubmitted && template;
      const url = isEdit ? `/api/whatsapp/templates/${template!.id}` : "/api/whatsapp/templates/submit";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t("toastSaveFailed"));
      toast.success(
        !isEdit && !submitNow
          ? t("toastDraftSaved")
          : isEdit
            ? t("toastResubmitted")
            : t("toastSubmitted"),
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!template) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/whatsapp/templates/${template.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t("toastDeleteFailed"));
      toast.success(t("toastDeleted"));
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  const previewButtons = useMemo(
    () =>
      buttons.map((b) =>
        b.type === "PHONE_NUMBER" ? { ...b, text: b.text || t("callButtonFallback") } : b,
      ),
    [buttons, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,820px)] w-full flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground sm:max-w-3xl">
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b border-border/50 p-4">
            <h2 className="text-base font-bold text-popover-foreground">
              {template ? t("editTitle") : t("newTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("stepOf", { step: step + 1, total: steps.length, label: steps[step].label })}
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              {steps.map((s, i) => (
                <div key={s.key} className="flex flex-1 items-center gap-1.5">
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      i < step
                        ? "bg-primary text-primary-foreground"
                        : i === step
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      "hidden truncate text-[11px] font-medium sm:inline",
                      i <= step ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                  {i < steps.length - 1 && <div className="h-px flex-1 bg-border" />}
                </div>
              ))}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-4 lg:grid-cols-[1fr_260px]">
            <div className="space-y-4">
              {step === 0 && (
                <>
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("name")}</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("namePlaceholder")}
                      disabled={isEditingSubmitted}
                      className="border-border bg-muted text-foreground disabled:opacity-60"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {isEditingSubmitted ? t("nameFixed") : t("nameHint")}
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("category")}</Label>
                    <div className="flex rounded-lg bg-muted p-1">
                      {CATEGORIES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCategory(c)}
                          className={cn(
                            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                            category === c
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t(`categoryOptions.${c}`)}
                        </button>
                      ))}
                    </div>
                    {category === "Authentication" && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <p>{t("authWarning")}</p>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("language")}</Label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      disabled={isEditingSubmitted}
                      className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary disabled:opacity-60"
                    >
                      {COMMON_LANGUAGES.map((code) => (
                        <option key={code} value={code}>
                          {t(`languageOptions.${code}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("headerType")}</Label>
                    <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                      {HEADER_FORMATS.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setHeaderFormat(f)}
                          className={cn(
                            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                            headerFormat === f
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t(`headerOptions.${f}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {headerFormat === "text" && (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-muted-foreground">{t("headerText")}</Label>
                        <span className="text-[11px] text-muted-foreground">
                          {headerContent.length} / {TEMPLATE_LIMITS.headerTextMaxLength}
                        </span>
                      </div>
                      <Input
                        value={headerContent}
                        onChange={(e) => setHeaderContent(e.target.value)}
                        maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                        placeholder={t("headerTextPlaceholder")}
                        className="border-border bg-muted text-foreground"
                      />
                      <button
                        type="button"
                        onClick={insertHeaderVariable}
                        disabled={headerVarNames.length > 0}
                        className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3" />
                        {t("insertVariable")}
                      </button>
                      {headerVarNames.length > 0 && (
                        <Input
                          value={headerSample}
                          onChange={(e) => setHeaderSample(e.target.value)}
                          placeholder={t("headerSamplePlaceholder", { name: headerVarNames[0] })}
                          className="border-border bg-muted text-foreground"
                        />
                      )}
                    </div>
                  )}

                  {(headerFormat === "image" || headerFormat === "video" || headerFormat === "document") && (
                    <div className="grid gap-2">
                      <Label className="text-muted-foreground">{t("mediaUpload")}</Label>
                      <div className="rounded-xl border border-dashed border-border bg-card-2 p-4 text-center">
                        {headerFormat === "image" && (
                          <>
                            <input
                              ref={headerFileRef}
                              type="file"
                              accept="image/jpeg,image/png"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void handleHeaderImageFile(f);
                                e.target.value = "";
                              }}
                            />
                            <p className="text-xs text-muted-foreground">{t("dropzoneHint")}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {t("dropzoneSpecs")}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={uploadingHeader}
                              onClick={() => headerFileRef.current?.click()}
                              className="mt-3"
                            >
                              {uploadingHeader ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Upload className="h-3.5 w-3.5" />
                              )}
                              {t("uploadMedia")}
                            </Button>
                          </>
                        )}
                        {headerFormat !== "image" && (
                          <p className="text-xs text-muted-foreground">{t("mediaUrlHint")}</p>
                        )}
                        <Input
                          value={headerMediaUrl}
                          onChange={(e) => setHeaderMediaUrl(e.target.value)}
                          placeholder={t("mediaUrlPlaceholder")}
                          className="mt-3 border-border bg-muted text-foreground"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">{t("bodyText")}</Label>
                      <span className="text-[11px] text-muted-foreground">
                        {bodyText.length} / {TEMPLATE_LIMITS.bodyMaxLength}
                      </span>
                    </div>
                    <Textarea
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                      maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                      rows={5}
                      placeholder={t("bodyPlaceholder")}
                      className="resize-none border-border bg-muted text-foreground"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">{t("variables")}:</span>
                      {bodyVarNames.map((n) => (
                        <span
                          key={n}
                          className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary"
                        >
                          [{n}]
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={insertBodyVariable}
                        className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
                      >
                        <Plus className="h-3 w-3" />
                        {t("insertVariable")}
                      </button>
                    </div>
                  </div>

                  {bodyVarNames.length > 0 && (
                    <div className="grid gap-2">
                      <Label className="text-muted-foreground">{t("sampleValues")}</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {bodyVarNames.map((n) => (
                          <div key={n} className="grid gap-1">
                            <span className="text-[11px] text-muted-foreground">[{n}]</span>
                            <Input
                              value={bodySamplesByName[n] ?? ""}
                              onChange={(e) =>
                                setBodySamplesByName((prev) => ({ ...prev, [n]: e.target.value }))
                              }
                              className="border-border bg-muted text-foreground"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">{t("footer")}</Label>
                      <span className="text-[11px] text-muted-foreground">
                        {footerText.length} / {TEMPLATE_LIMITS.footerMaxLength}
                      </span>
                    </div>
                    <Input
                      value={footerText}
                      onChange={(e) => setFooterText(e.target.value)}
                      maxLength={TEMPLATE_LIMITS.footerMaxLength}
                      placeholder={t("footerPlaceholder")}
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="flex rounded-lg bg-muted p-1">
                    <button
                      type="button"
                      onClick={() => setNextButtonKind("QUICK_REPLY")}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        nextButtonKind === "QUICK_REPLY"
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t("quickReplyTab")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNextButtonKind("URL")}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        nextButtonKind !== "QUICK_REPLY"
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t("ctaTab")}
                    </button>
                  </div>

                  {nextButtonKind !== "QUICK_REPLY" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setNextButtonKind("URL")}
                        className={cn(
                          "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                          nextButtonKind === "URL"
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {t("btnVisitSite")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setNextButtonKind("PHONE_NUMBER")}
                        className={cn(
                          "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                          nextButtonKind === "PHONE_NUMBER"
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {t("btnCall")}
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={addButton}
                    disabled={buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-xs font-medium text-primary hover:bg-primary-soft disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("addButton", { max: TEMPLATE_LIMITS.maxButtonsTotal })}
                  </button>

                  <div className="space-y-2">
                    {buttons.map((btn, i) => {
                      const isDynamic = btn.type === "URL" && extractVariableIndices(btn.url).length > 0;
                      const phoneParts =
                        btn.type === "PHONE_NUMBER" ? splitPhoneNumber(btn.phone_number) : null;
                      return (
                        <div key={i} className="rounded-xl bg-card-2 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                              {t(`btnTypeLabel.${btn.type}`)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeButton(i)}
                              className="text-muted-foreground hover:text-red-400"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <Input
                            value={btn.text}
                            onChange={(e) => updateButton(i, { text: e.target.value })}
                            maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                            placeholder={t("btnTextPlaceholder")}
                            className="mt-2 h-8 border-border bg-muted text-xs text-foreground"
                          />

                          {btn.type === "URL" && (
                            <div className="mt-2 space-y-2">
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleUrlDynamic(i, false)}
                                  className={cn(
                                    "flex-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                                    !isDynamic
                                      ? "border-primary bg-primary-soft text-primary"
                                      : "border-border text-muted-foreground",
                                  )}
                                >
                                  {t("urlStatic")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleUrlDynamic(i, true)}
                                  className={cn(
                                    "flex-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                                    isDynamic
                                      ? "border-primary bg-primary-soft text-primary"
                                      : "border-border text-muted-foreground",
                                  )}
                                >
                                  {t("urlDynamic")}
                                </button>
                              </div>
                              <Input
                                value={btn.url}
                                onChange={(e) => updateButton(i, { url: e.target.value })}
                                placeholder={t("urlPlaceholder")}
                                className="h-8 border-border bg-muted text-xs text-foreground"
                              />
                              {isDynamic && (
                                <Input
                                  value={btn.example ?? ""}
                                  onChange={(e) => updateButton(i, { example: e.target.value })}
                                  placeholder={t("urlSamplePlaceholder")}
                                  className="h-8 border-border bg-muted text-xs text-foreground"
                                />
                              )}
                            </div>
                          )}

                          {btn.type === "PHONE_NUMBER" && phoneParts && (
                            <div className="mt-2 grid grid-cols-[110px_1fr] gap-2">
                              <select
                                value={phoneParts.countryDigits}
                                onChange={(e) =>
                                  updateButton(i, {
                                    phone_number: combinePhoneNumber(e.target.value, phoneParts.rest),
                                  })
                                }
                                className="h-8 rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                              >
                                {COUNTRY_CODES.map((c) => (
                                  <option key={c.iso} value={c.digits}>
                                    {c.label} +{c.digits}
                                  </option>
                                ))}
                              </select>
                              <Input
                                value={phoneParts.rest}
                                onChange={(e) =>
                                  updateButton(i, {
                                    phone_number: combinePhoneNumber(phoneParts.countryDigits, e.target.value),
                                  })
                                }
                                placeholder={t("phonePlaceholder")}
                                className="h-8 border-border bg-muted text-xs text-foreground"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {step === 4 && (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-xl bg-card-2">
                    {[
                      { label: t("reviewName"), value: name },
                      { label: t("reviewCategory"), value: `${t(`categoryOptions.${category}`)} · ${language}` },
                      {
                        label: t("reviewHeader"),
                        value: headerFormat === "none" ? t("headerOptions.none") : t(`headerOptions.${headerFormat}`),
                      },
                      { label: t("reviewBody"), value: bodyText || "—" },
                      { label: t("reviewFooter"), value: footerText || "—" },
                      {
                        label: t("reviewButtons"),
                        value:
                          buttons.length === 0
                            ? t("reviewNoButtons")
                            : buttons.map((b) => b.text || t(`btnTypeLabel.${b.type}`)).join(" · "),
                      },
                    ].map((row, i) => (
                      <div
                        key={row.label}
                        className={cn("flex items-start justify-between gap-4 px-3.5 py-2.5 text-sm", i > 0 && "border-t border-border/60")}
                      >
                        <span className="shrink-0 text-muted-foreground">{row.label}</span>
                        <span className="text-right text-foreground">{row.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-card-2 px-3.5 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{t("useAsDefault")}</p>
                      <p className="text-xs text-muted-foreground">{t("useAsDefaultHint")}</p>
                    </div>
                    <Switch checked={isDefault} onCheckedChange={setIsDefault} />
                  </div>

                  {!isEditingSubmitted && (
                    <div className="flex items-center justify-between rounded-xl bg-card-2 px-3.5 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{t("submitNow")}</p>
                        <p className="text-xs text-muted-foreground">{t("submitNowHint")}</p>
                      </div>
                      <Switch
                        checked={submitNow}
                        onCheckedChange={setSubmitNow}
                        disabled={category === "Authentication"}
                      />
                    </div>
                  )}
                  {isEditingSubmitted && (
                    <p className="rounded-xl bg-card-2 px-3.5 py-3 text-xs text-muted-foreground">
                      {t("resubmitNote")}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="lg:sticky lg:top-0 lg:self-start">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("previewTitle")}
              </p>
              <div className="rounded-2xl bg-card p-2 shadow-[var(--shadow)]">
                <TemplateBubblePreview
                  headerType={headerFormat === "none" ? undefined : headerFormat}
                  headerContent={headerContent}
                  headerMediaUrl={headerMediaUrl}
                  headerSamples={headerSample ? [headerSample] : []}
                  bodyText={bodyText}
                  bodySamples={bodyVarNames.map((n) => bodySamplesByName[n] ?? "")}
                  footerText={footerText}
                  buttons={previewButtons}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{t("previewHint")}</p>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/50 bg-popover/80 p-4">
            <div className="flex items-center gap-2">
              {template && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              {step > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setStep((s) => s - 1)}
                  className="border-border bg-transparent text-muted-foreground hover:bg-muted"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("back")}
                </Button>
              )}
              <div className="flex-1" />
              {step < steps.length - 1 ? (
                <Button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!stepValid}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {t("continue")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("saveTemplate")}
                </Button>
              )}
            </div>

            {confirmDelete && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                <span className="text-red-300">{t("deletePrompt")}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? t("deleting") : t("confirm")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
