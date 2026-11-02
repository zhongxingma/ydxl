// 设计方案见 docs/MULTI_USER_DESIGN.md 第 6 节
//
// 幂等性：通过 schema_meta(key='multi_user_migrated') 标记防重，重复执行直接返回
// 原子性：全部步骤包裹在单个 better-sqlite3 事务中，失败整体回滚，下次启动重试
// 安全性：迁移前自动备份数据库文件到 server/data/backups/（:memory: 测试库跳过）
import { logger } from './logger.js'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { db, databasePath } from './db.js'
import { createUser } from './auth.js'

// 需要回填 userId + id 前缀的私有表（与 db.ts 的 PRIVATE_TABLES_FOR_USERID 一致）
const PRIVATE_TABLES = ['words', 'reviews', 'stats', 'readingSessions', 'achievements'] as const

/** 迁移前备份数据库文件（WAL 先 checkpoint，保证备份完整） */
function backupDatabaseFile(): void {
  if (databasePath === ':memory:') return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    const backupDir = join(dirname(databasePath), 'backups')
    mkdirSync(backupDir, { recursive: true })
    const backupPath = join(backupDir, `ydxl-pre-multiuser-${Date.now()}.db`)
    copyFileSync(databasePath, backupPath)
    logger.info(`[ydxl-server] 多用户迁移前备份完成：${backupPath}`)
  } catch (err) {
    // 备份失败不阻断迁移（迁移本身事务保护），但显眼告警
    logger.warn('[ydxl-server] 迁移前备份失败（继续迁移）', err)
  }
}

/**
 * 执行多用户迁移（幂等）
 * 步骤：创建首个管理员 → 私有表回填 userId → id/引用列加用户前缀 →
 *       articles.readAt/startedAt 剥离到 user_article_states → 写入完成标记
 */
export function runMultiUserMigration(): void {
  const migrated = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'multi_user_migrated'`)
    .get() as { value: string } | undefined
  if (migrated) return

  backupDatabaseFile()

  const migrate = db.transaction(() => {
    // 1. 确保存在管理员账号（users 表为空时创建首个 admin）
    let admin = db.prepare('SELECT id FROM users ORDER BY createdAt ASC LIMIT 1').get() as
      | { id: string }
      | undefined
    if (!admin) {
      const username = process.env.ADMIN_USERNAME ?? 'admin'
      const initialPassword = process.env.ADMIN_INITIAL_PASSWORD ?? randomBytes(4).toString('hex')
      const user = createUser({
        username,
        displayName: '管理员',
        password: initialPassword,
        role: 'admin',
      })
      admin = { id: user.id }
      if (!process.env.ADMIN_INITIAL_PASSWORD) {
        // 随机初始密码仅打印一次到服务端控制台，请尽快登录后修改
        logger.info(
          `[ydxl-server] 初始管理员账号已创建：${username} / ${initialPassword}（请尽快登录修改密码）`,
        )
      } else {
        logger.info(`[ydxl-server] 初始管理员账号已创建：${username}`)
      }
    }
    const adminId = admin.id

    // 2. 私有表历史数据归属首个管理员：回填 userId + id 加前缀
    //    instr(id, ':') = 0 保证只处理未加前缀的旧 id，重复执行安全（另有 schema_meta 防重）
    for (const table of PRIVATE_TABLES) {
      db.prepare(`UPDATE ${table} SET userId = ? WHERE userId IS NULL`).run(adminId)
      db.prepare(`UPDATE ${table} SET id = ? || ':' || id WHERE instr(id, ':') = 0`).run(adminId)
    }
    // reviews.wordId 引用 words.id（私有），同样加前缀
    db.prepare(`UPDATE reviews SET wordId = ? || ':' || wordId WHERE instr(wordId, ':') = 0`).run(
      adminId,
    )

    // 3. articles 的 readAt/startedAt（私有阅读状态）剥离到 user_article_states
    //    articles 表保留原列一个版本用于回滚，新代码不再读写这两列
    db.prepare(
      `INSERT OR REPLACE INTO user_article_states (userId, articleId, startedAt, readAt, updated_at)
       SELECT ?, id, startedAt, readAt, ? FROM articles
       WHERE startedAt IS NOT NULL OR readAt IS NOT NULL`,
    ).run(adminId, Date.now())

    // 4. 写入迁移完成标记（同事务，保证标记与数据一致）
    db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('multi_user_migrated', '1')`).run()
  })

  migrate()
  logger.info('[ydxl-server] 多用户数据迁移完成')
}
