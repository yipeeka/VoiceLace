import GlassCard from "../shared/GlassCard";
import { useI18n } from "../../i18n/I18nProvider";

export default function ProjectEventsCard({ projectEvents }) {
  const { t } = useI18n();
  return (
    <GlassCard className="fullWidthCard">
      <h2>{t("legacy.text.projectEventsTitle")}</h2>
      <p className="muted">{t("legacy.text.projectEventsSubtitle")}</p>
      <pre className="codeBlock compactLog">{projectEvents.length ? JSON.stringify(projectEvents.slice(-20), null, 2) : t("legacy.text.projectEventsEmpty")}</pre>
    </GlassCard>
  );
}
