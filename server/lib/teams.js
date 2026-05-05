import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../database.js';

export function listTeamsForUser(db, userId) {
  return dbAll(db, `
    SELECT t.*, COUNT(tm.id) AS member_count
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id
    WHERE t.owner_id = ? AND t.status = 'active'
    GROUP BY t.id
    ORDER BY t.updated_at DESC
  `, [userId]);
}

export function getTeam(db, teamId) {
  const team = dbGet(db, 'SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!team) return null;
  const members = dbAll(db, `
    SELECT tm.id, tm.team_id, tm.project_id, tm.purpose, tm.display_order,
           p.name AS project_name, p.description AS project_description,
           p.default_model, p.system_prompt
    FROM team_members tm
    JOIN projects p ON p.id = tm.project_id
    WHERE tm.team_id = ?
    ORDER BY tm.display_order ASC, tm.created_at ASC
  `, [teamId]);
  return { ...team, members };
}

export function createTeam(db, ownerId, { name, description = null, playbook = null }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `
    INSERT INTO teams (id, owner_id, name, description, playbook, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `, [id, ownerId, name, description, playbook, now, now]);
  return getTeam(db, id);
}

export function updateTeam(db, teamId, { name, description, playbook }) {
  const t = dbGet(db, 'SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!t) return null;
  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE teams SET name = ?, description = ?, playbook = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : t.name,
    description !== undefined ? description : t.description,
    playbook !== undefined ? playbook : t.playbook,
    now,
    teamId,
  ]);
  return getTeam(db, teamId);
}

export function archiveTeam(db, teamId) {
  const now = new Date().toISOString();
  dbRun(db, `UPDATE teams SET status = 'archived', updated_at = ? WHERE id = ?`, [now, teamId]);
}

export function addMember(db, teamId, { project_id, purpose = null, display_order = null }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  let order = display_order;
  if (order === null) {
    const row = dbGet(db, 'SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM team_members WHERE team_id = ?', [teamId]);
    order = row?.next ?? 0;
  }
  dbRun(db, `
    INSERT INTO team_members (id, team_id, project_id, purpose, display_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, teamId, project_id, purpose, order, now]);
  return dbGet(db, 'SELECT * FROM team_members WHERE id = ?', [id]);
}

export function updateMember(db, memberId, { purpose, display_order }) {
  const m = dbGet(db, 'SELECT * FROM team_members WHERE id = ?', [memberId]);
  if (!m) return null;
  dbRun(db, `
    UPDATE team_members SET purpose = ?, display_order = ?
    WHERE id = ?
  `, [
    purpose !== undefined ? purpose : m.purpose,
    display_order !== undefined ? display_order : m.display_order,
    memberId,
  ]);
  return dbGet(db, 'SELECT * FROM team_members WHERE id = ?', [memberId]);
}

export function removeMember(db, memberId) {
  dbRun(db, 'DELETE FROM team_members WHERE id = ?', [memberId]);
}

/**
 * Build the system-prompt augmentation injected when a team is active.
 * Returns a string to be appended to the orchestrator's system prompt, or '' if no team.
 */
export function buildTeamSystemPromptBlock(team) {
  if (!team || !team.members || team.members.length === 0) return '';
  const playbook = (team.playbook || '').trim();
  const roster = team.members.map((m, i) => {
    const purpose = (m.purpose || m.project_description || '').trim() || '(no description)';
    return `${i + 1}. **${m.project_name}** (project_id: \`${m.project_id}\`) — ${purpose}`;
  }).join('\n');

  const sections = [
    `## Team: ${team.name}`,
    team.description ? team.description.trim() : null,
    playbook ? `### Playbook\n${playbook}` : null,
    `### Available sub-agents\nYou have a \`dispatch_agent\` tool. Each member below is a sub-agent you can dispatch by passing its \`project_id\`. The sub-agent runs in its own context window with the project's system prompt, model, files, and tools. It returns one final message string. Multiple \`dispatch_agent\` calls in the same response run in parallel; calls in separate responses run sequentially.\n\n${roster}\n\nRules:\n- One level deep — sub-agents cannot dispatch other agents.\n- The \`prompt\` you pass to a sub-agent is the only context it gets. If a sub-agent needs another sub-agent's output, write it into the prompt yourself.\n- Always summarize the final synthesis for the user after sub-agents return.`,
  ].filter(Boolean);

  return sections.join('\n\n');
}
