import { Router } from "express";
import { db } from "../db/index.js";
import { orders } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// 전체 조회
router.get("/", (req, res) => {
  const rows = db.select().from(orders).orderBy(orders.createdAt).all();
  res.json(rows);
});

// 단건 조회
router.get("/:id", (req, res) => {
  const row = db.select().from(orders).where(eq(orders.id, req.params.id)).get();
  if (!row) return res.status(404).json({ error: "수주를 찾을 수 없습니다." });
  res.json(row);
});

// 등록
router.post("/", (req, res) => {
  const { id, orderNumber, customerName, productType, quantity, jobType, cutting, priority, status, dueDate, createdAt } = req.body;
  db.insert(orders).values({ id, orderNumber, customerName, productType, quantity, jobType, cutting, priority, status, dueDate, createdAt }).run();
  res.status(201).json({ id });
});

// 상태/정보 수정
router.patch("/:id", (req, res) => {
  const allowed = ["status", "priority", "jobType", "cutting", "dueDate", "quantity"];
  const updates = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "수정할 필드가 없습니다." });

  // 완료 처리 시각 자동 기록
  if (updates.status === "DONE") {
    updates.completedAt = new Date().toISOString();
  } else if (updates.status !== undefined) {
    // DONE에서 다른 상태로 되돌릴 경우 초기화
    updates.completedAt = null;
  }

  db.update(orders).set(updates).where(eq(orders.id, req.params.id)).run();
  res.json({ ok: true });
});

// 삭제
router.delete("/:id", (req, res) => {
  db.delete(orders).where(eq(orders.id, req.params.id)).run();
  res.json({ ok: true });
});

export default router;
