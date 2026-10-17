import { getDatabase } from './db.js';

export interface UserParlayRecord {
  id: string;
  userId: string;
  guildId?: string;
  parlayId: string;
  status: string;
  locked: boolean;
  oddsSnapshot?: any;
  createdAt: string;
  updatedAt: string;
}

export class UserParlayRepository {
  private db = getDatabase();

  async save(record: Omit<UserParlayRecord, 'createdAt' | 'updatedAt'>): Promise<void> {
    const sql = `
      INSERT INTO user_parlays (id, user_id, guild_id, parlay_id, status, locked, odds_snapshot)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, locked = EXCLUDED.locked, odds_snapshot = EXCLUDED.odds_snapshot, updated_at = CURRENT_TIMESTAMP
    `;
    await this.db.query(sql, [
      record.id,
      record.userId,
      record.guildId || null,
      record.parlayId,
      record.status,
      record.locked,
      record.oddsSnapshot ? JSON.stringify(record.oddsSnapshot) : null,
    ]);
  }

  async getByUser(userId: string): Promise<UserParlayRecord[]> {
    const res = await this.db.query('SELECT * FROM user_parlays WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return res.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      guildId: r.guild_id,
      parlayId: r.parlay_id,
      status: r.status,
      locked: r.locked,
      oddsSnapshot: r.odds_snapshot,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM user_parlays WHERE id = $1 AND user_id = $2', [id, userId]);
    return (res as any).rowCount > 0;
  }
}