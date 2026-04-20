import { Router } from "express";
import { db } from "../db/index.js";
import { firstProcessSessions, eventLogs } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

const now = () => new Date().toISOString();

// 전체 조회
router.get("/", (req, res) => {
  const rows = db.select().from(firstProcessSessions).orderBy(firstProcessSessions.createdAt).all();
  res.json(rows);
});

// 단건 조회
router.get("/:id", (req, res) => {
  const row = db.select().from(firstProcessSessions).where(eq(firstProcessSessions.id, Number(req.params.id))).get();
  if (!row) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });
  res.json(row);
});

// 작업 시작 (새 세션 생성)
router.post("/start", (req, res) => {
  const { orderId, processType, workDate, targetQty, parentSessionId, restartFromQty, note } = req.body;

  const startedAt = now();
  const result = db.insert(firstProcessSessions).values({
    orderId: orderId ?? null,
    processType,
    workDate,
    targetQty,
    shortQty: 0,
    startedAt,
    status: "IN_PROGRESS",
    parentSessionId: parentSessionId ?? null,
    restartFromQty: restartFromQty ?? null,
    note: note ?? null,
    createdAt: startedAt,
  }).run();

  const id = Number(result.lastInsertRowid);

  // 이벤트 로그: 작업 시작
  db.insert(eventLogs).values({
    eventType: parentSessionId ? "PROCESS_DEFECT_RESTART" : "WORK_START",
    sessionType: "FIRST",
    sessionId: id,
    orderId: orderId ?? null,
    timestamp: startedAt,
    note: parentSessionId ? `공정불량 재시작 (원본 세션 #${parentSessionId}, ${restartFromQty}장에서 중단)` : "1차 공정 작업 시작",
  }).run();

  // 원자재 투입 이벤트
  db.insert(eventLogs).values({
    eventType: "MATERIAL_TO_FIRST",
    sessionType: "FIRST",
    sessionId: id,
    orderId: orderId ?? null,
    qty: targetQty,
    timestamp: startedAt,
    note: `${processType} 원자재 투입`,
  }).run();

  res.status(201).json({ id, startedAt });
});

// 공정불량 중단 (현재 세션 DEFECT_STOPPED 처리)
router.patch("/:id/defect-stop", (req, res) => {
  const { stoppedAtQty, note } = req.body;
  const endedAt = now();

  db.update(firstProcessSessions).set({
    status: "DEFECT_STOPPED",
    restartFromQty: stoppedAtQty,
    endedAt,
    outputQty: stoppedAtQty,
  }).where(eq(firstProcessSessions.id, Number(req.params.id))).run();

  db.insert(eventLogs).values({
    eventType: "PROCESS_DEFECT",
    sessionType: "FIRST",
    sessionId: Number(req.params.id),
    qty: stoppedAtQty,
    timestamp: endedAt,
    note: note ?? `${stoppedAtQty}장에서 공정불량 발생`,
  }).run();

  res.json({ ok: true, endedAt });
});

// 작업 완료
router.patch("/:id/done", (req, res) => {
  const { outputQty, shortQty, note } = req.body;
  const endedAt = now();

  db.update(firstProcessSessions).set({
    status: "DONE",
    outputQty,
    shortQty: shortQty ?? 0,
    endedAt,
  }).where(eq(firstProcessSessions.id, Number(req.params.id))).run();

  db.insert(eventLogs).values({
    eventType: "WORK_DONE",
    sessionType: "FIRST",
    sessionId: Number(req.params.id),
    qty: outputQty,
    timestamp: endedAt,
    note: note ?? `1차 공정 완료 (생산 ${outputQty}, 불량 ${shortQty ?? 0})`,
  }).run();

  res.json({ ok: true, endedAt });
});

// 쇼트(불량) 기록
router.post("/:id/short", (req, res) => {
  const { qty, note } = req.body;
  const timestamp = now();

  const session = db.select().from(firstProcessSessions).where(eq(firstProcessSessions.id, Number(req.params.id))).get();
  if (!session) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });

  db.update(firstProcessSessions).set({ shortQty: (session.shortQty ?? 0) + qty }).where(eq(firstProcessSessions.id, Number(req.params.id))).run();

  db.insert(eventLogs).values({
    eventType: "SHORT_RECORD",
    sessionType: "FIRST",
    sessionId: Number(req.params.id),
    qty,
    timestamp,
    note: note ?? `불량 ${qty}개 기록`,
  }).run();

  res.json({ ok: true });
});

export default router;
