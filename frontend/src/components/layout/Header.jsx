import GlassCard from "../shared/GlassCard";
import StatusBadge from "../shared/StatusBadge";
import { useI18n } from "../../i18n/I18nProvider";

export default function Header({ projectName }) {
  const { t } = useI18n();
  return (
    <GlassCard className="headerCard">
      <div>
        <div className="eyebrow">{t("legacy.header.eyebrow")}</div>
        <h1 className="headerTitle">{t("legacy.header.title")}</h1>
        <div className="muted">{projectName ? `${t("project.current")}：${projectName}` : t("legacy.header.preparingProject")}</div>
      </div>
      <StatusBadge label={t("legacy.header.skeletonCreated")} tone="success" />
    </GlassCard>
  );
}
