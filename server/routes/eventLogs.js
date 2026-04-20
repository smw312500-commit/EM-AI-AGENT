import { Router } from "express";
import { db } from "../db/index.js";
import { eventLogs } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const router = Router();

// 전체 조회 (최신순)
router.get("/", (req, res) => {
  const rows = db.select().from(eventLogs).orderBy(desc(eventLogs.timestamp)).all();
  res.json(rows);
});

// 세션별 조회
router.get("/session/:type/:sessionId", (req, res) => {
  const rows = db.select().from(eventLogs)
    .where(eq(eventLogs.sessionId, Number(req.params.sessionId)))
    .orderBy(eventLogs.timestamp)
    .all();
  res.json(rows);
});

// 이벤트 타입별 조회
router.get("/type/:eventType", (req, res) => {
  const rows = db.select().from(eventLogs)
    .where(eq(eventLogs.eventType, req.params.eventType))
    .orderBy(desc(eventLogs.timestamp))
    .all();
  res.json(rows);
});

export default router;
