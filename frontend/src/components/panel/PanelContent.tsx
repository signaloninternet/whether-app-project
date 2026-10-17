import { useEffect } from "react";
import { draftProblem, runPlan, useStore } from "../../state/store";
import { PlanForm } from "../plan/PlanForm";
import { Results } from "../results/Results";
import { RouteDetail } from "../results/RouteDetail";
import { ui } from "../ui/controls";
import { Icon } from "../ui/Icon";
import formStyles from "../plan/form.module.css";
import styles from "./panel.module.css";

/** Edit form, route list or one route, shared by the desktop panel and the mobile sheet. */
export function PanelContent() {
  const view = useStore((s) => s.view);
  const plan = useStore((s) => s.plan);

  // New view, fresh scroll position.
  useEffect(() => {
    document.getElementById("panel-body")?.scrollTo({ top: 0 });
  }, [view, plan]);

  if (!plan || view === "edit") return <PlanForm />;
  return view === "route" ? <RouteDetail /> : <Results />;
}

export function PanelFooter() {
  const view = useStore((s) => s.view);
  const plan = useStore((s) => s.plan);
  const draft = useStore((s) => s.draft);
  const loading = useStore((s) => s.planStatus === "loading");
  if (plan && view !== "edit") return null;
  const problem = draftProblem(draft);
  return (
    <div className={styles.footer}>
      {problem && (draft.origin || draft.destination) ? <p className={formStyles.problem}>{problem}</p> : null}
      <button type="button" className={`${ui.primary} ${ui.block}`} disabled={loading || Boolean(problem)} onClick={() => runPlan()}>
        {loading ? "Checking routes and forecast…" : <><Icon name="route" size={18} /> {plan ? "Update routes" : "Find the safest route"}</>}
      </button>
    </div>
  );
}

