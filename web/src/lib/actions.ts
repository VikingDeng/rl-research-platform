'use server';

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(process.cwd(), '../analysis_outputs/research_insights_topconf_100.db');

function getDbPath() {
  const previewPath = path.resolve(process.cwd(), '../analysis_outputs/research_insights_topconf_100.db');
  return fs.existsSync(previewPath) ? previewPath : path.resolve(process.cwd(), '../analysis_outputs/research_insights.db');
}

export async function getOpenGaps(topicId: number) {
  const db = new Database(getDbPath());
  try {
    const gaps = db.prepare(`
      SELECT g.*, p.title as paper_title
      FROM open_gaps g
      LEFT JOIN papers p ON g.falsifiable_claim LIKE '%' || p.paper_uid || '%'
      WHERE g.topic_id = ?
      ORDER BY g.patchability_score DESC
    `).all(topicId);

    return gaps.map((gap: any) => {
      // --- 审计逻辑：检查质量 ---
      const isTemplate = gap.falsifiable_claim.includes('若统一预算与评测协议后');
      const hasEvidence = gap.evidence_index_json && gap.evidence_index_json !== '{}';
      
      // 计算质量评分：10分制
      let qualityScore = 10;
      if (isTemplate) qualityScore -= 7; // 模版化扣 7 分
      if (!hasEvidence) qualityScore -= 2; // 无证据扣 2 分
      if (gap.description.length < 20) qualityScore -= 1; // 描述太短扣 1 分

      // 替换标题
      let claim = gap.falsifiable_claim;
      if (gap.paper_title) {
        const shortTitle = gap.paper_title.includes(':') ? gap.paper_title.split(':')[0] : gap.paper_title.slice(0, 30);
        claim = claim.replace(/doi:[0-9.\/a-z]+/gi, `《${shortTitle}》`);
      }

      return {
        ...gap,
        falsifiable_claim: claim,
        is_template: isTemplate,
        quality_score: qualityScore,
        audit_label: qualityScore < 4 ? '低质模版' : (qualityScore < 7 ? '解析受限' : '高价值洞察')
      };
    });
  } finally {
    db.close();
  }
}

export async function getPaperAnatomy(paperUid: string) {
  const db = new Database(getDbPath());
  try {
    const row = db.prepare(`SELECT * FROM paper_ledgers_v2 WHERE paper_uid = ?`).get(paperUid) as any;
    const relations = db.prepare(`
      SELECT r.*, p_a.title as title_a, p_b.title as title_b
      FROM paper_diffs r
      LEFT JOIN papers p_a ON r.paper_a_uid = p_a.paper_uid
      LEFT JOIN papers p_b ON r.paper_b_uid = p_b.paper_uid
      WHERE r.paper_a_uid = ? OR r.paper_b_uid = ?
    `).all(paperUid, paperUid);

    if (!row) return { mode: 'legacy', relations: JSON.parse(JSON.stringify(relations)), readiness: 0, status: 'none' };

    // 审计解剖质量
    const ledger = JSON.parse(row.ledger_json);
    const audit_logs = [];
    if (!ledger.problem_statement.text) audit_logs.push("缺失问题定义 (Problem)");
    if (!ledger.contribution_summary.text) audit_logs.push("缺失核心贡献 (Contribution)");
    if (ledger.results_facts.length === 0) audit_logs.push("缺失实验事实 (Facts)");

    return {
      mode: 'systematic',
      ledger,
      evidence_index: JSON.parse(row.evidence_index_json),
      status: row.status,
      readiness: row.readiness_score,
      audit_logs,
      relations: JSON.parse(JSON.stringify(relations))
    };
  } finally {
    db.close();
  }
}

// ... 保持 getTopics, getIngestStatus 等基础函数导出 ...
export async function getTopics() {
  const db = new Database(getDbPath());
  try {
    const rows = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM topic_assignments ta WHERE ta.topic_id = t.topic_id) as paper_count FROM topics t ORDER BY paper_count DESC`).all();
    return rows.map((r: any) => ({ ...r, top_terms: JSON.parse(r.top_terms_json || '[]') }));
  } finally { db.close(); }
}
export async function getIngestStatus() {
  const db = new Database(getDbPath());
  try { return db.prepare(`SELECT parse_status, COUNT(*) as count FROM paper_texts GROUP BY parse_status`).all(); } finally { db.close(); }
}
export async function getLineage(topicId: number) {
  const db = new Database(getDbPath());
  try {
    const snapshot = db.prepare(`SELECT graph_json FROM lineage_graph_snapshots WHERE topic_id = ?`).get(topicId) as any;
    return snapshot ? JSON.parse(snapshot.graph_json) : { nodes: [], edges: [] };
  } finally { db.close(); }
}
export async function getPaperDiff(a: string, b: string) {
  const db = new Database(getDbPath());
  try {
    const diff = db.prepare(`SELECT * FROM paper_diffs WHERE (paper_a_uid = ? AND paper_b_uid = ?) OR (paper_a_uid = ? AND paper_b_uid = ?)`).get(a, b, b, a) as any;
    if (diff) return { ...diff, delta_json: JSON.parse(diff.delta_json), evidence_index_json: JSON.parse(diff.evidence_index_json) };
    return null;
  } finally { db.close(); }
}
export async function getFrontier(topicId: number, windowDays: number) {
  const frontierPath = path.resolve(process.cwd(), '../analysis_outputs/frontier_latest.json');
  if (fs.existsSync(frontierPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(frontierPath, 'utf-8'));
      if (data && data.groups) data.groups = data.groups.filter((g: any) => g.frontier && g.frontier.length > 0);
      return data;
    } catch (e) { console.error(e); }
  }
  return null;
}
export async function getVenueSyncStatus() {
  const db = new Database(getDbPath());
  try { return db.prepare(`SELECT venue_label, year, expected_count, fetched_count, failed_count FROM venue_sync_reports ORDER BY created_at DESC`).all(); } finally { db.close(); }
}
