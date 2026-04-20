import { Router } from "express";
import { db } from "../db/index.js";
import { rawStockReceipts, eventLogs } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

const now = () => new Date().toISOString();

// 전체 조회
router.get("/", (req, res) => {
  const rows = db.select().from(rawStockReceipts).orderBy(rawStockReceipts.receivedDate).all();
  res.json(rows);
});

// 입고 등록
router.post("/", (req, res) => {
  const { materialType, quantity, receivedDate, note } = req.body;

  const result = db.insert(rawStockReceipts).values({
    materialType,
    quantity,
    receivedDate,
    note: note ?? null,
    createdAt: now(),
  }).run();

  const id = Number(result.lastInsertRowid);

  // 이벤트 로그: 원자재 입고
  db.insert(eventLogs).values({
    eventType: "MATERIAL_RECEIPT",
    qty: quantity,
    materialType,
    timestamp: now(),
    note: `${materialType} ${quantity} 입고`,
  }).run();

  res.status(201).json({ id });
});

// 삭제
router.delete("/:id", (req, res) => {
  db.delete(rawStockReceipts).where(eq(rawStockReceipts.id, Number(req.params.id))).run();
  res.json({ ok: true });
});

export default router;
