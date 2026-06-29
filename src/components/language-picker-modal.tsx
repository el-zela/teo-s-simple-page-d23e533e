"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { hasChosenLanguage, setAppLanguage } from "@/i18n";
import { Globe } from "lucide-react";

export function LanguagePickerModal() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasChosenLanguage()) setOpen(true);
  }, []);

  function choose(lang: "en" | "sw") {
    setAppLanguage(lang);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !hasChosenLanguage()) return; setOpen(v); }}>
      <DialogContent className="z-[120] max-w-md p-6 sm:p-8">
        <DialogHeader className="space-y-2 text-center sm:text-left">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary sm:mx-0">
            <Globe className="h-5 w-5" />
          </div>
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {t("language.title")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("language.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => choose("en")}
            className="rounded-2xl border border-border bg-secondary/30 px-5 py-4 text-left transition hover:border-primary/50 hover:bg-primary/10"
          >
            <p className="text-base font-semibold">{t("language.english")}</p>
            <p className="mt-1 text-xs text-muted-foreground">Continue in English</p>
          </button>
          <button
            type="button"
            onClick={() => choose("sw")}
            className="rounded-2xl border border-border bg-secondary/30 px-5 py-4 text-left transition hover:border-primary/50 hover:bg-primary/10"
          >
            <p className="text-base font-semibold">{t("language.swahili")}</p>
            <p className="mt-1 text-xs text-muted-foreground">Endelea kwa Kiswahili</p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
