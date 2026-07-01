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
      <DialogContent className="z-[120] max-w-xs p-4 sm:max-w-sm sm:p-5">
        <DialogHeader className="space-y-1.5 text-center sm:text-left">
          <div className="mx-auto grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary sm:mx-0 sm:h-9 sm:w-9">
            <Globe className="h-4 w-4" />
          </div>
          <DialogTitle className="text-base font-semibold tracking-tight sm:text-lg">
            {t("language.title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("language.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => choose("en")}
            className="rounded-lg border border-border bg-secondary/30 px-2.5 py-2 text-left transition hover:border-primary/50 hover:bg-primary/10"
          >
            <p className="text-xs font-semibold sm:text-sm">{t("language.english")}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">Continue in English</p>
          </button>
          <button
            type="button"
            onClick={() => choose("sw")}
            className="rounded-lg border border-border bg-secondary/30 px-2.5 py-2 text-left transition hover:border-primary/50 hover:bg-primary/10"
          >
            <p className="text-xs font-semibold sm:text-sm">{t("language.swahili")}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">Endelea kwa Kiswahili</p>
          </button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
