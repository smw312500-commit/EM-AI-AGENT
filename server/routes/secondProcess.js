import { Router } from "express";
import { db } from "../db/index.js";
import { secondProcessSessions, eventLogs } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

const now = () => new Date().toISOString();

// 전체 조회
router.get("/", (req, res) => {
  const rows = db.select().from(secondProcessSessions).orderBy(secondProcessSessions.createdAt).all();
  res.json(rows);
});

// 기계별 조회
router.get("/machine/:machineId", (req, res) => {
  const rows = db.select().from(secondProcessSessions)
    .where(eq(secondProcessSessions.machineId, Number(req.params.machineId)))
    .orderBy(secondProcessSessions.createdAt)
    .all();
  res.json(rows);
});

// 단건 조회
router.get("/:id", (req, res) => {
  const row = db.select().from(secondProcessSessions).where(eq(secondProcessSessions.id, Number(req.params.id))).get();
  if (!row) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });
  res.json(row);
});

// 작업 시작
router.post("/start", (req, res) => {
  const { orderId, machineId, processType, unitsPerHour, workDate, targetQty, parentSessionId, restartFromQty, note } = req.body;

  const startedAt = now();
  const result = db.insert(secondProcessSessions).values({
    orderId: orderId ?? null,
    machineId,
    processType,
    unitsPerHour,
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
    sessionType: "SECOND",
    sessionId: id,
    orderId: orderId ?? null,
    machineId,
    timestamp: startedAt,
    note: parentSessionId
      ? `공정불량 재시작 (원본 세션 #${parentSessionId}, ${restartFromQty}장에서 중단)`
      : `2차 공정 작업 시작 (기계 #${machineId})`,
  }).run();

  // 1차 공정 차감 이벤트 (현황판 차감 기록)
  db.insert(eventLogs).values({
    eventType: "FIRST_TO_SECOND",
    sessionType: "SECOND",
    sessionId: id,
    orderId: orderId ?? null,
    machineId,
    qty: targetQty,
    timestamp: startedAt,
    note: `1차 공정 롤 → 2차 공정 투입 (기계 #${machineId}, ${targetQty}개)`,
  }).run();

  res.status(201).json({ id, startedAt });
});

// 공정불량 중단
router.patch("/:id/defect-stop", (req, res) => {
  const { stoppedAtQty, note } = req.body;
  const endedAt = now();

  const session = db.select().from(secondProcessSessions).where(eq(secondProcessSessions.id, Number(req.params.id))).get();
  if (!session) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });

  const workMinutes = session.startedAt
    ? Math.round((new Date(endedAt) - new Date(session.startedAt)) / 60000)
    : null;

  db.update(secondProcessSessions).set({
    status: "DEFECT_STOPPED",
    restartFromQty: stoppedAtQty,
    endedAt,
    outputQty: stoppedAtQty,
    workMinutes,
  }).where(eq(secondProcessSessions.id, Number(req.params.id))).run();

  db.insert(eventLogs).values({
    eventType: "PROCESS_DEFECT",
    sessionType: "SECOND",
    sessionId: Number(req.params.id),
    orderId: session.orderId,
    machineId: session.machineId,
    qty: stoppedAtQty,
    timestamp: endedAt,
    note: note ?? `기계 #${session.machineId} - ${stoppedAtQty}장에서 공정불량 발생`,
  }).run();

  res.json({ ok: true, endedAt, workMinutes });
});

// 작업 완료
router.patch("/:id/done", (req, res) => {
  const { outputQty, shortQty, note } = req.body;
  const endedAt = now();

  const session = db.select().from(secondProcessSessions).where(eq(secondProcessSessions.id, Number(req.params.id))).get();
  if (!session) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });

  const workMinutes = session.startedAt
    ? Math.round((new Date(endedAt) - new Date(session.startedAt)) / 60000)
    : null;

  db.update(secondProcessSessions).set({
    status: "DONE",
    outputQty,
    shortQty: shortQty ?? 0,
    endedAt,
    workMinutes,
  }).where(eq(secondProcessSessions.id, Number(req.params.id))).run();

  // 이벤트: 작업 완료
  db.insert(eventLogs).values({
    eventType: "WORK_DONE",
    sessionType: "SECOND",
    sessionId: Number(req.params.id),
    orderId: session.orderId,
    machineId: session.machineId,
    qty: outputQty,
    timestamp: endedAt,
    note: note ?? `기계 #${session.machineId} 완료 (생산 ${outputQty}, 불량 ${shortQty ?? 0}, ${workMinutes}분 소요)`,
  }).run();

  // 이벤트: 2차 공정 완료 (출고)
  db.insert(eventLogs).values({
    eventType: "SECOND_PROCESS_DONE",
    sessionType: "SECOND",
    sessionId: Number(req.params.id),
    orderId: session.orderId,
    machineId: session.machineId,
    qty: outputQty,
    timestamp: endedAt,
  }).run();

  res.json({ ok: true, endedAt, workMinutes });
});

// 쇼트(불량) 기록
router.post("/:id/short", (req, res) => {
  const { qty, note } = req.body;
  const timestamp = now();

  const session = db.select().from(secondProcessSessions).where(eq(secondProcessSessions.id, Number(req.params.id))).get();
  if (!session) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });

  db.update(secondProcessSessions).set({ shortQty: (session.shortQty ?? 0) + qty }).where(eq(secondProcessSessions.id, Number(req.params.id))).run();

  db.insert(eventLogs).values({
    eventType: "SHORT_RECORD",
    sessionType: "SECOND",
    sessionId: Number(req.params.id),
    orderId: session.orderId,
    machineId: session.machineId,
    qty,
    timestamp,
    note: note ?? `기계 #${session.machineId} 불량 ${qty}개 기록`,
  }).run();

  res.json({ ok: true });
});

export default router;
