// Shared order; report rendering must not import the state mutation commands.
export const STEPS = [
  'explore', 'planner', 'worktrees', 'implement', 'immutability',
  'ui-acceptance', 'review', 'score', 'clean', 'project-gates',
];
export const STEP_STATUS = ['in_progress', 'done', 'failed', 'skipped'];
