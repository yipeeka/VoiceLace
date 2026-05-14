import GlassCard from "../shared/GlassCard";
import { useI18n } from "../../i18n/I18nProvider";

export default function ParsePreviewCard({ llmStreamOutput }) {
  const { t } = useI18n();
  return (
    <GlassCard>
      <h2>{t("text.parsePreviewTitle")}</h2>
      <p className="muted">{t("legacy.text.parsePreviewLegacySubtitle")}</p>
      <pre className="codeBlock">{llmStreamOutput || t("text.waitingParse")}</pre>
    </GlassCard>
  );
}
